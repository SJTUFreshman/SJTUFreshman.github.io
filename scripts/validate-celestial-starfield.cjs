'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let redraws = 0;
let composites = 0;
const skyContext = { fillRect() { redraws += 1; }, beginPath() {}, arc() {}, fill() {}, createRadialGradient() { return { addColorStop() {} }; } };
const context = {
    window: { innerWidth: 1000, HipparcosSky: { count: 3, directions: new Float32Array([0, 0, 1, 0, 0, -1, 1, 0, 0]),
        magnitudes: new Float32Array([3, 3, 9]), colorIndices: new Float32Array([0, 1, 0]) } },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => skyContext }) }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/life/scripts/09-celestial-starfield.js'), 'utf8')
    + '\nglobalThis.Starfield = CelestialStarfield;', context);
const field = new context.Starfield();
field.prepare();
assert.equal(field.stars.length, 2);
const initial = field.basis(0, 0);
assert.deepEqual(Array.from(field.project([0, 0, 1], initial, 1000, 600, 500)), [500, 300]);
assert.equal(field.project([0, 0, -1], initial, 1000, 600, 500), null);
const turned = field.project([0, 0, 1], field.basis(10, 0), 1000, 600, 500);
assert(turned[0] < 500 && Math.abs(turned[1] - 300) < 1e-9);
const upward = field.project([0, 0, 1], field.basis(0, 10), 1000, 600, 500);
assert(upward[1] > 300);
const wrapped = field.project([0, 0, 1], field.basis(360, 0), 1000, 600, 500);
assert(Math.abs(wrapped[0] - 500) < 1e-9);
const target = { drawImage() { composites += 1; } };
field.draw(target, 1000, 600);
field.draw(target, 1000, 600);
assert.equal(redraws, 1, 'Planet spin must reuse the fixed sky; only the camera pose changes the star projection.');
assert.equal(composites, 2);
field.draw(target, 1000, 600, { yaw: 10 });
assert.equal(redraws, 2);
field.clear();
assert.equal(field.canvas.width, 1);
console.log('Celestial starfield validation passed: catalogue filtering, projection, camera rotation, wrap and static-sky caching.');
