#!/usr/bin/env node
/* Download auditable Poly Haven CC0 glTF model packages for offline renders. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const outputRoot = process.env.WORLD_MODEL_ROOT
  ? path.resolve(process.env.WORLD_MODEL_ROOT)
  : path.join(root, 'assets', 'life', 'models');
const requested = process.argv.slice(2).filter(value => value !== '--dry-run');
const dryRun = process.argv.includes('--dry-run');
const assetIds = requested.length ? requested : ['modular_fort_01', 'mountainside', 'rock_07'];
const resolution = process.env.WORLD_MODEL_RESOLUTION || '4k';
const manifestPath = path.join(outputRoot, 'manifest.json');

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const validId = value => /^[a-z0-9][a-z0-9_]*$/.test(value);
const safeRelative = value => {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || !/^[a-zA-Z0-9._/-]+$/.test(normalized)) {
    throw new Error(`Unsafe model include path: ${value}`);
  }
  return normalized;
};

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function downloadFile(asset, relative, file, target) {
  const existing = fs.existsSync(target) ? fs.readFileSync(target) : null;
  if (existing && existing.length === file.size && crypto.createHash('md5').update(existing).digest('hex') === file.md5) {
    return { bytes: existing.length, md5: file.md5, sha256: sha256(existing), reused: true };
  }
  if (dryRun) return { bytes: file.size, md5: file.md5, sha256: null, reused: false, dryRun: true };
  const response = await fetch(file.url, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error(`${response.status} ${file.url}`);
  const data = Buffer.from(await response.arrayBuffer());
  const md5 = crypto.createHash('md5').update(data).digest('hex');
  if (data.length !== file.size) throw new Error(`Size mismatch for ${asset}/${relative}: ${data.length} !== ${file.size}`);
  if (md5 !== file.md5) throw new Error(`MD5 mismatch for ${asset}/${relative}: ${md5} !== ${file.md5}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return { bytes: data.length, md5, sha256: sha256(data), reused: false };
}

async function main() {
  if (!/^(1|2|4|8)k$/.test(resolution)) throw new Error(`Unsupported model resolution: ${resolution}`);
  for (const asset of assetIds) if (!validId(asset)) throw new Error(`Invalid asset ID: ${asset}`);
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { assets: [] };
  if (!Array.isArray(previous.assets)) throw new Error(`Invalid model manifest: ${manifestPath}`);
  const records = new Map(previous.assets.map(record => [`${record.id}:${record.resolution}`, record]));
  const retrieved = new Date().toISOString().slice(0, 10);
  for (const asset of new Set(assetIds)) {
    const files = await json(`https://api.polyhaven.com/files/${asset}`);
    const info = await json(`https://api.polyhaven.com/info/${asset}`);
    const packageInfo = files.gltf?.[resolution]?.gltf;
    if (!packageInfo?.url || !packageInfo.md5 || !Number.isSafeInteger(packageInfo.size) || !packageInfo.include) {
      throw new Error(`Missing glTF package for ${asset} at ${resolution}`);
    }
    const entries = [{ relative: `${asset}_${resolution}.gltf`, file: packageInfo }];
    for (const [relative, file] of Object.entries(packageInfo.include)) {
      if (!file?.url || !file.md5 || !Number.isSafeInteger(file.size) || file.size <= 0) {
        throw new Error(`Invalid include ${asset}/${relative}`);
      }
      entries.push({ relative: safeRelative(relative), file });
    }
    const record = {
      id: asset,
      resolution,
      provider: 'Poly Haven',
      license: 'CC0 1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      providerLicenseUrl: 'https://polyhaven.com/license',
      source: `https://polyhaven.com/a/${asset}`,
      filesApi: `https://api.polyhaven.com/files/${asset}`,
      infoApi: `https://api.polyhaven.com/info/${asset}`,
      description: info.description || null,
      authors: info.authors || {},
      polycount: Number.isSafeInteger(info.polycount) ? info.polycount : null,
      dimensions: Array.isArray(info.dimensions) ? info.dimensions : null,
      retrieved,
      files: [],
    };
    for (const entry of entries) {
      const target = path.join(outputRoot, asset, entry.relative);
      const result = await downloadFile(asset, entry.relative, entry.file, target);
      record.files.push({
        path: path.relative(root, target).replaceAll('\\', '/'),
        source: entry.file.url,
        bytes: result.bytes,
        md5: result.md5,
        sha256: result.sha256,
        reused: result.reused,
      });
    }
    records.set(`${asset}:${resolution}`, record);
    console.log(`${asset}: ${entries.length} files${dryRun ? ' (dry-run)' : ''}`);
  }
  if (dryRun) return;
  const manifest = {
    schemaVersion: 1,
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    provider: 'Poly Haven',
    providerLicenseUrl: 'https://polyhaven.com/license',
    updated: retrieved,
    assets: [...records.values()].sort((left, right) => `${left.id}:${left.resolution}`.localeCompare(`${right.id}:${right.resolution}`)),
  };
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
