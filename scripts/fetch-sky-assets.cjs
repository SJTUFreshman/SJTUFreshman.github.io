#!/usr/bin/env node
/* Fetch small, auditable Poly Haven pure-sky HDRIs for offline Blender lighting. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const resolution = process.env.SKY_RESOLUTION || '1k';
const outputRoot = path.resolve(process.env.SKY_ASSET_ROOT || path.join(root, '.render-work', 'hdri'));
const skies = [
  { id: 'kloofendal_48d_partly_cloudy_puresky', role: 'clear-day' },
  { id: 'kloppenheim_06_puresky', role: 'sunset' },
];
if (!/^(1|2|4|8|16)k$/.test(resolution)) throw new Error(`Unsupported SKY_RESOLUTION: ${resolution}`);

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
async function fetchFile(sky, file, target) {
  if (fs.existsSync(target) && fs.statSync(target).size === file.size) {
    const data = fs.readFileSync(target);
    if (crypto.createHash('md5').update(data).digest('hex') === file.md5) return { reused: true, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
  }
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`${response.status} ${file.url}`);
  const data = Buffer.from(await response.arrayBuffer());
  const md5 = crypto.createHash('md5').update(data).digest('hex');
  if (data.length !== file.size || md5 !== file.md5) throw new Error(`Integrity failure for ${sky.id}: size ${data.length}/${file.size}, md5 ${md5}/${file.md5}`);
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data);
  return { reused: false, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}
async function main() {
  const manifest = { schemaVersion: 1, license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', provider: 'Poly Haven', resolution, updated: new Date().toISOString(), assets: [] };
  for (const sky of skies) {
    const info = await json(`https://api.polyhaven.com/info/${sky.id}`);
    const files = await json(`https://api.polyhaven.com/files/${sky.id}`);
    const file = files.hdri?.[resolution]?.hdr;
    if (!file) throw new Error(`Missing HDR ${resolution} for ${sky.id}`);
    const target = path.join(outputRoot, `${sky.id}_${resolution}.hdr`);
    const result = await fetchFile(sky, file, target);
    manifest.assets.push({ id: sky.id, role: sky.role, name: info.name, description: info.description, source: `https://polyhaven.com/a/${sky.id}`, filesApi: `https://api.polyhaven.com/files/${sky.id}`, file: { path: path.relative(root, target).replaceAll('\\', '/'), url: file.url, bytes: result.bytes, md5: file.md5, sha256: result.sha256, reused: result.reused } });
    console.log(`${sky.role}: ${sky.id} ${resolution} ${result.bytes} bytes`);
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  const manifestPath = path.join(outputRoot, `manifest-${resolution}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Manifest: ${manifestPath}`);
}
main().catch(error => { console.error(error.stack || error); process.exit(1); });
