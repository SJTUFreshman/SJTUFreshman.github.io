/* Synthetic throughput evidence; not a real-model or target-device performance guarantee. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
global.window = global;
global.THREE = require(path.join(__dirname, '../assets/vendor/three-0.160.1.min.js'));
global.document = { baseURI: 'https://fixture.test/life.html' };
global.location = { origin: 'https://fixture.test' };
for (const file of ['19-world-kit.js', '25-authored-worlds.js']) {
    vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../assets/life/scripts', file), 'utf8'));
}
const T = THREE;
function geometry(triangleCount) {
    // A spherical shell has overlapping whole-mesh AABBs, while the centre is collision-free.
    const positions = new Float32Array(triangleCount * 9);
    for (let index = 0; index < triangleCount; index++) {
        const azimuth = index * 2.399963229728653, height = 1 - 2 * (index + .5) / triangleCount;
        const radial = Math.sqrt(1 - height * height);
        const center = new T.Vector3(Math.cos(azimuth) * radial, height, Math.sin(azimuth) * radial).multiplyScalar(5);
        for (let corner = 0; corner < 3; corner++) {
            positions[index * 9 + corner * 3] = center.x + (corner === 0 ? .03 : 0);
            positions[index * 9 + corner * 3 + 1] = center.y + (corner === 1 ? .03 : 0);
            positions[index * 9 + corner * 3 + 2] = center.z + (corner === 2 ? .03 : 0);
        }
    }
    return new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(positions, 3));
}
async function sample(overlap) {
    const group = new T.Group(), material = new T.MeshBasicMaterial(), count = 257, perMesh = 1846;
    for (let index = 0; index < count; index++) {
        const mesh = new T.Mesh(geometry(perMesh), material);
        if (!overlap && index) mesh.position.x = index * 15;
        group.add(mesh);
    }
    window.NightGLTFLoader = class { async loadAsync() { return { scene: group }; } };
    const start = performance.now();
    const world = AuthoredWorlds.createBuilder('benchmark', {
        observation: { position: [0, 0, 0], yaw: 0, pitch: 0 }, navigation: 'float', distanceUnit: 'source'
    }, { url: '/synthetic.glb' })(NightWorldKit);
    await world.loadPromise;
    const setupMs = performance.now() - start;
    const timings = [];
    for (let index = 0; index < 12; index++) {
        const before = performance.now();
        const result = world.fly({ x: 0, y: 0, z: 0 }, { x: .052, y: 0, z: 0 });
        if (result.blocked) throw new Error('Synthetic centre must be clear');
        timings.push(performance.now() - before);
    }
    timings.sort((a, b) => a - b); world.dispose();
    return { scenario: overlap ? 'worst-case-overlapping-mesh-bounds' : 'spatially-separated-mesh-bounds',
        meshes: count, triangles: count * perMesh, setupMs, medianMs: timings[6], maxMs: timings[11] };
}
(async () => console.log(JSON.stringify({ synthetic: true, node: process.version,
    note: 'CPU-only collision query. Not representative of real NASA topology, WebGL rendering, or browser/device performance.',
    measurements: [await sample(false), await sample(true)] }, null, 2)))().catch(error => { console.error(error); process.exitCode = 1; });
