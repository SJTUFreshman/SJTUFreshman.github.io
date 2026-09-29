import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = {
    input: null,
    output: resolve(repositoryRoot, 'assets/hipparcos-distances.js'),
    catalog: resolve(repositoryRoot, 'assets/hipparcos-stars.js'),
    'save-source': null
};

for (let argumentIndex = 2; argumentIndex < process.argv.length; argumentIndex += 2) {
    const option = process.argv[argumentIndex].replace(/^--/, '');
    const value = process.argv[argumentIndex + 1];
    if (!Object.hasOwn(options, option) || !value) {
        throw new Error('Usage: node scripts/build-hipparcos-distances.mjs [--input source.csv] [--output output.js] [--catalog hipparcos-stars.js] [--save-source source.csv]');
    }
    options[option] = resolve(value);
}

const maximumRelativeError = 0.25;
const query = 'SELECT TOP 120000 HIP, Plx, e_Plx FROM "I/239/hip_main" WHERE Plx > 0 AND e_Plx > 0 AND e_Plx <= 0.25 * Plx ORDER BY HIP';
const sourceUrl = new URL('https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync');
sourceUrl.search = new URLSearchParams({
    REQUEST: 'doQuery',
    LANG: 'ADQL',
    FORMAT: 'csv',
    MAXREC: '120000',
    QUERY: query
}).toString();

let source;
if (options.input) {
    source = readFileSync(options.input, 'utf8');
} else {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) {
        throw new Error(`VizieR returned HTTP ${response.status}`);
    }
    source = await response.text();
}
if (options['save-source']) {
    writeFileSync(options['save-source'], source, 'utf8');
}

const catalogContext = { window: {}, atob };
runInNewContext(readFileSync(options.catalog, 'utf8'), catalogContext);
const catalog = catalogContext.window.HipparcosSky;
if (!catalog?.indexByHip || catalog.count < 1) {
    throw new Error('The companion star catalogue is empty or invalid');
}

const lines = source.trim().split(/\r?\n/);
if (lines.shift().replace(/^\uFEFF/, '') !== 'HIP,Plx,e_Plx') {
    throw new Error('Unexpected VizieR CSV header; expected HIP,Plx,e_Plx');
}

const records = [];
const seenHips = new Set();
for (const [rowIndex, line] of lines.entries()) {
    const fields = line.split(',');
    if (fields.length !== 3 || fields.some(field => field.trim() === '')) {
        throw new Error(`Invalid source row ${rowIndex + 2}`);
    }
    const [hip, parallaxMas, errorMas] = fields.map(Number);
    if (!Number.isInteger(hip) || hip < 1 || hip >= 2 ** 24 || !Number.isFinite(parallaxMas) || !Number.isFinite(errorMas)) {
        throw new Error(`Invalid source measurement on row ${rowIndex + 2}`);
    }
    if (!catalog.indexByHip.has(hip) || parallaxMas <= 0 || errorMas <= 0 || errorMas / parallaxMas > maximumRelativeError) {
        continue;
    }
    if (seenHips.has(hip)) {
        throw new Error(`Duplicate HIP ${hip}`);
    }
    const parallaxCode = Math.round(parallaxMas * 100);
    const errorCode = Math.round(errorMas * 100);
    if (parallaxCode < 1 || parallaxCode >= 2 ** 24 || errorCode < 1 || errorCode >= 2 ** 16 || Math.abs(parallaxCode / 100 - parallaxMas) > 1e-6 || Math.abs(errorCode / 100 - errorMas) > 1e-6) {
        throw new Error(`Source precision or range exceeds the lossless encoding for HIP ${hip}`);
    }
    records.push({ hip, parallaxCode, errorCode });
    seenHips.add(hip);
}
records.sort((first, second) => first.hip - second.hip);
if (records.length < 10000) {
    throw new Error(`Only ${records.length} matched records; the catalogue response may be incomplete`);
}

const recordSize = 8;
const payload = Buffer.alloc(records.length * recordSize);
records.forEach((record, recordIndex) => {
    const offset = recordIndex * recordSize;
    payload.writeUIntLE(record.hip, offset, 3);
    payload.writeUIntLE(record.parallaxCode, offset + 3, 3);
    payload.writeUInt16LE(record.errorCode, offset + 6);
});
const chunks = payload.toString('base64').match(/.{1,160}/g)
    .map(chunk => `        '${chunk}'`)
    .join(',\n');
const sourceSha256 = createHash('sha256').update(source).digest('hex');

const generated = `(() => {
    'use strict';

    const recordSize = ${recordSize};
    const encoded = [
${chunks}
    ].join('');
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const byHip = new Map();

    for (let offset = 0; offset < bytes.length; offset += recordSize) {
        const hip = view.getUint8(offset) |
            (view.getUint8(offset + 1) << 8) |
            (view.getUint8(offset + 2) << 16);
        const parallaxMas = (view.getUint8(offset + 3) |
            (view.getUint8(offset + 4) << 8) |
            (view.getUint8(offset + 5) << 16)) / 100;
        const errorMas = view.getUint16(offset + 6, true) / 100;
        byHip.set(hip, Object.freeze({
            parsecs: 1000 / parallaxMas,
            parallaxMas,
            errorMas,
            relativeError: errorMas / parallaxMas
        }));
    }

    window.HipparcosDistances = Object.freeze({
        source: 'ESA Hipparcos Main Catalogue I/239, HIP / Plx / e_Plx',
        sourceUrl: ${JSON.stringify(sourceUrl.href)},
        sourceSha256: ${JSON.stringify(sourceSha256)},
        maximumRelativeError: ${maximumRelativeError},
        count: byHip.size,
        byHip
    });
})();
`;

writeFileSync(options.output, generated, 'utf8');
console.log(`Wrote ${records.length.toLocaleString('en-US')} measured distances (${Buffer.byteLength(generated).toLocaleString('en-US')} bytes) to ${options.output}`);
