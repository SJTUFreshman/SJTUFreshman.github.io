'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const normalize = value => value.replace(/\r\n?/g, '\n');

async function main() {
  const page = new URL(process.argv[2] || 'http://localhost:8765/life.html');
  const response = await fetch(page, { cache: 'no-store' });
  assert(response.ok, 'Life HTML must load over HTTP');
  const html = await response.text();
  const references = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"[^>]*>/g)].map(match => match[1]).filter(reference => reference.startsWith('assets/') && /\.(?:js|css)(?:\?|$)/.test(reference));
  const versions = references.map(reference => new URL(reference, page).searchParams.get('v'));
  assert(versions.length >= 32 && versions.every(Boolean), 'HTTP HTML must version every local runtime resource');
  assert.equal(new Set(versions).size, 1, 'HTTP HTML must use a single release version');
  const downloaded = new Map();
  for (const reference of references) {
    const url = new URL(reference, page);
    const resource = await fetch(url, { cache: 'no-store' });
    assert(resource.ok, `${reference}: resource must load successfully`);
    const source = await resource.text();
    const relative = decodeURIComponent(url.pathname).replace(/^\//, '');
    assert.equal(normalize(source), normalize(fs.readFileSync(path.join(root, relative), 'utf8')), `${relative}: served release must match the workspace`);
    if (relative.endsWith('.js')) assert.doesNotThrow(() => new vm.Script(source, { filename: reference }), `${reference}: served script must parse`);
    downloaded.set(relative, source);
  }
  const scripts = references.filter(reference => reference.includes('assets/life/scripts/')).map(reference => reference.split('?')[0]);
  assert(scripts.indexOf('assets/life/scripts/03-math-orientation.js') < scripts.indexOf('assets/life/scripts/05-astronomy.js'), 'Math helpers must precede astronomy');
  const context = { window: {}, GEOMETRIC_HORIZON_EPSILON: .00001, DEG: Math.PI/180, INITIAL_CAMERA:{yaw:0}, MIN_CAMERA_ALTITUDE:.005, celestialBodies:[] };
  vm.createContext(context);
  for (const file of ['assets/life/scripts/03-math-orientation.js','assets/life/scripts/05-astronomy.js']) vm.runInContext(downloaded.get(file), context, { filename: file });
  assert.equal(typeof context.skyHasHorizon, 'function', 'HTTP-delivered math must export skyHasHorizon before astronomy calls it');
  assert.equal(context.naturalStarVisibilityAtDirection([0,-1,0]), 0, 'HTTP-delivered astronomy must resolve the math helper');
  context.window.NightWorld={ready:true,currentId:'spaceship',mode:'observe'};
  assert.equal(context.naturalStarVisibilityAtDirection([0,-1,0]), 1, 'HTTP-delivered space astronomy must use the new helper');
  console.log(`Life HTTP validation passed (${references.length} versioned resources; ${versions[0]}; served bytes, syntax and cross-script helper linkage).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
