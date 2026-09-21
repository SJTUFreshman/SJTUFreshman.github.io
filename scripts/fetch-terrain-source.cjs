'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.render-work', 'terrain');
const source = 'https://elevation-tiles-prod.s3.amazonaws.com/skadi/N27/N27E086.hgt.gz';
const expected = '0e95b43508321ee2b3d9454797130bf1c972737377eff4cb07b4cf912138aad1';
const expectedRaw = '150d99a7cee9472de347cf7c5d2baf95b70b8c87d0f9ac992976774d94c8e717';
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

async function main() {
  const target = path.join(directory, 'N27E086.hgt.gz');
  let data = fs.existsSync(target) ? fs.readFileSync(target) : null;
  let reused = Boolean(data && sha256(data) === expected);
  if (!reused) {
    const response = await fetch(source, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Terrain download failed: ${response.status}`);
    data = Buffer.from(await response.arrayBuffer());
  }
  if (data.length !== 18934204 || sha256(data) !== expected) throw new Error('Terrain revision differs from the reviewed source; inspect licensing and data before updating the pinned hash.');
  const raw = zlib.gunzipSync(data);
  if (raw.length !== 25934402 || sha256(raw) !== expectedRaw) throw new Error('Invalid or changed HGT payload');
  let minimum = 32767, maximum = -32767, voids = 0;
  for (let offset = 0; offset < raw.length; offset += 2) {
    const value = raw.readInt16BE(offset);
    if (value === -32768) voids += 1;
    else { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  }
  if (voids) throw new Error(`Terrain contains ${voids} void samples`);
  fs.mkdirSync(directory, { recursive: true });
  if (!reused) fs.writeFileSync(target, data);
  const manifest = {
    schemaVersion: 1, verified: new Date().toISOString().slice(0, 10),
    provider: 'Mapzen Terrain Tiles via AWS Open Data Registry', source,
    licenseEvidence: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
    attribution: 'Terrain derived from Mapzen Terrain Tiles; SRTM and GMTED2010 terrain data courtesy of the U.S. Geological Survey. Artistically recentered and blended; not endorsed by USGS; not for navigation.',
    file: 'N27E086.hgt.gz', bytes: data.length, sha256: expected,
    decompressedBytes: raw.length, decompressedSha256: expectedRaw,
    dimensions: [3601, 3601], sampleType: 'signed 16-bit big-endian integer',
    horizontalCrs: 'EPSG:4326', verticalReference: 'EGM96 geoid', heightUnit: 'metres',
    rowOrder: 'north to south', sampleSpacingArcseconds: 1,
    coverage: { west: 86, east: 87, south: 27, north: 28 }, minimum, maximum, voids,
    candidateViewpoint: { latitude: 27.9718, longitude: 86.93, extentMetres: 5000, verticalExaggeration: 1 },
  };
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ source, target, reused, bytes: data.length, sha256: expected, minimum, maximum, voids }));
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
