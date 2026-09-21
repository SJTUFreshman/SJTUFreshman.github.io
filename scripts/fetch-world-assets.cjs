#!/usr/bin/env node
/* Download a deliberately small, auditable subset of Poly Haven CC0 materials. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const outputRoot = process.env.WORLD_ASSET_ROOT
  ? path.resolve(process.env.WORLD_ASSET_ROOT)
  : path.join(root, 'assets', 'life', 'textures', 'library');
const requested = process.argv.slice(2);
const assetIds = requested.length ? requested : ['snow_01', 'rock_face_01', 'rock_face_03', 'painted_metal_shutter', 'old_stone_wall'];
const size = process.env.WORLD_ASSET_RESOLUTION || '2k';
const manifestPath = path.join(outputRoot, 'manifest.json');
const channels = [
  ['Diffuse', 'diff'], ['nor_gl', 'nor'], ['Rough', 'rough'],
];

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
async function download(asset, channel, file, target) {
  if (fs.existsSync(target) && fs.statSync(target).size === file.size) {
    const data = fs.readFileSync(target);
    const md5 = crypto.createHash('md5').update(data).digest('hex');
    if (md5 === file.md5) {
      return {
        path: target,
        reused: true,
        bytes: data.length,
        md5,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
      };
    }
  }
  const response = await fetch(file.url);
  if (!response.ok) throw new Error(`${response.status} ${file.url}`);
  const data = Buffer.from(await response.arrayBuffer());
  const md5 = crypto.createHash('md5').update(data).digest('hex');
  if (data.length !== file.size) throw new Error(`Size mismatch for ${asset}/${channel}: ${data.length} !== ${file.size}`);
  if (md5 !== file.md5) throw new Error(`MD5 mismatch for ${asset}/${channel}: ${md5} !== ${file.md5}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return {
    path: target,
    reused: false,
    bytes: data.length,
    md5,
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
  };
}
async function main() {
  if (!/^(1|2|4|8|16)k$/.test(size)) throw new Error(`Unsupported material resolution: ${size}`);
  for (const asset of assetIds) {
    if (!/^[a-z0-9][a-z0-9_]*$/.test(asset)) throw new Error(`Invalid asset ID: ${asset}`);
  }
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { assets: [] };
  if (!Array.isArray(previous.assets)) throw new Error(`Invalid asset manifest: ${manifestPath}`);
  const records = new Map(previous.assets.map(asset => {
    const resolution = asset.resolution || previous.resolution;
    if (!asset.id || !resolution || !Array.isArray(asset.channels)) throw new Error(`Invalid asset record in ${manifestPath}`);
    return [`${asset.id}:${resolution}`, { ...asset, resolution }];
  }));
  const retrieved = new Date().toISOString().slice(0, 10);
  const manifest = {
    schemaVersion: 1,
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    provider: 'Poly Haven',
    providerLicenseUrl: 'https://polyhaven.com/license',
    updated: retrieved,
    assets: [],
  };
  for (const asset of new Set(assetIds)) {
    const files = await json(`https://api.polyhaven.com/files/${asset}`);
    const selected = channels.map(([key, label]) => {
      const file = files[key]?.[size]?.jpg;
      if (!file || !file.url || !file.md5 || !Number.isSafeInteger(file.size) || file.size <= 0) {
        throw new Error(`Missing required ${key}/${size}/jpg channel for ${asset}`);
      }
      return { label, file };
    });
    const record = {
      id: asset,
      resolution: size,
      source: `https://polyhaven.com/a/${asset}`,
      filesApi: `https://api.polyhaven.com/files/${asset}`,
      retrieved,
      channels: [],
    };
    for (const { label, file } of selected) {
      const target = path.join(outputRoot, asset, `${asset}_${label}_${size}.jpg`);
      const result = await download(asset, label, file, target);
      record.channels.push({
        channel: label,
        path: path.relative(root, target).replaceAll('\\', '/'),
        url: file.url,
        md5: result.md5,
        sha256: result.sha256,
        bytes: result.bytes,
        reused: result.reused,
      });
    }
    records.set(`${asset}:${size}`, record);
    console.log(`${asset}: ${record.channels.length} channels`);
  }
  manifest.assets = [...records.values()].sort((left, right) => `${left.id}:${left.resolution}`.localeCompare(`${right.id}:${right.resolution}`));
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
main().catch(error => { console.error(error.stack || error); process.exit(1); });
