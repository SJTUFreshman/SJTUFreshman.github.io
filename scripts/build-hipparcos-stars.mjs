import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , inputArgument, outputArgument] = process.argv;

if (!inputArgument || !outputArgument) {
    console.error('Usage: node scripts/build-hipparcos-stars.mjs <catalog.csv> <output.js>');
    process.exit(1);
}

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const lines = readFileSync(inputPath, 'utf8')
    .trim()
    .split(/\r?\n/);

if (lines.shift() !== 'HIP,RAICRS,DEICRS,Vmag,B-V') {
    throw new Error('Unexpected Hipparcos CSV header');
}

const RECORD_SIZE = 9;
const payload = Buffer.allocUnsafe(lines.length * RECORD_SIZE);

const clamp = (value, minimum, maximum) =>
    Math.min(maximum, Math.max(minimum, value));

lines.forEach((line, index) => {
    const [hipText, raText, decText, magnitudeText, colorIndexText = ''] = line.split(',');
    const hip = Number(hipText);
    const raDegrees = Number(raText);
    const decDegrees = Number(decText);
    const magnitude = Number(magnitudeText);
    const colorIndex = colorIndexText === '' ? null : Number(colorIndexText);

    if (
        !Number.isInteger(hip) ||
        !Number.isFinite(raDegrees) ||
        !Number.isFinite(decDegrees) ||
        !Number.isFinite(magnitude) ||
        (colorIndex !== null && !Number.isFinite(colorIndex))
    ) {
        throw new Error(`Invalid catalog row ${index + 2}`);
    }

    const offset = index * RECORD_SIZE;
    payload.writeUIntLE(hip, offset, 3);
    payload.writeUInt16LE(
        clamp(Math.round((((raDegrees % 360) + 360) % 360) / 360 * 65535), 0, 65535),
        offset + 3
    );
    payload.writeInt16LE(
        clamp(Math.round(decDegrees / 90 * 32767), -32767, 32767),
        offset + 5
    );
    payload[offset + 7] = clamp(Math.round((magnitude + 1.5) * 20), 0, 254);
    payload[offset + 8] = colorIndex === null
        ? 255
        : clamp(Math.round((colorIndex + 0.5) * 40), 0, 254);
});

const chunks = payload
    .toString('base64')
    .match(/.{1,120}/g)
    .map(chunk => `        '${chunk}'`)
    .join(',\n');

const generated = `/**
 * Generated from the ESA Hipparcos Main Catalogue (I/239).
 * Contains the ${lines.length.toLocaleString('en-US')} brightest records with valid positions and Johnson V
 * magnitudes, ordered from brightest to faintest. See HIPPARCOS-NOTICE.md.
 */
(() => {
    'use strict';

    const RECORD_SIZE = ${RECORD_SIZE};
    const encoded = [
${chunks}
    ].join('');
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    const view = new DataView(bytes.buffer);
    const count = bytes.length / RECORD_SIZE;
    const hips = new Uint32Array(count);
    const directions = new Float32Array(count * 3);
    const magnitudes = new Float32Array(count);
    const colorIndices = new Float32Array(count);
    const indexByHip = new Map();

    for (let index = 0; index < count; index += 1) {
        const offset = index * RECORD_SIZE;
        const hip = view.getUint8(offset) |
            (view.getUint8(offset + 1) << 8) |
            (view.getUint8(offset + 2) << 16);
        const ra = view.getUint16(offset + 3, true) / 65535 * Math.PI * 2;
        const dec = view.getInt16(offset + 5, true) / 32767 * Math.PI * 0.5;
        const magnitude = view.getUint8(offset + 7) / 20 - 1.5;
        const colorCode = view.getUint8(offset + 8);
        const cosDec = Math.cos(dec);
        const directionOffset = index * 3;

        hips[index] = hip;
        directions[directionOffset] = Math.sin(ra) * cosDec;
        directions[directionOffset + 1] = Math.sin(dec);
        directions[directionOffset + 2] = Math.cos(ra) * cosDec;
        magnitudes[index] = magnitude;
        colorIndices[index] = colorCode === 255
            ? Number.NaN
            : colorCode / 40 - 0.5;
        indexByHip.set(hip, index);
    }

    window.HipparcosSky = Object.freeze({
        source: 'ESA Hipparcos Main Catalogue I/239',
        count,
        hips,
        directions,
        magnitudes,
        colorIndices,
        indexByHip,
        galacticNorth: Object.freeze([-0.198076, 0.455984, -0.867666]),
        galacticCenter: Object.freeze([-0.873437, -0.483835, -0.054876])
    });
})();
`;

writeFileSync(outputPath, generated, 'utf8');
console.log(`Wrote ${lines.length.toLocaleString('en-US')} stars to ${outputPath}`);
