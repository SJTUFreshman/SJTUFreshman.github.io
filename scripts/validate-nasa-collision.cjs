'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv.slice(2).find(value => !value.startsWith('--')) || path.join(root, '.render-work/authored-worlds-20260927/runtime-collision/nasa-collision.json'));
const assetDirectory = path.join(root, 'assets/life/models/nasa-iss-cupola');
const sourcePath = path.join(assetDirectory, 'nasa-iss-internal.gltf');
const sourceText = fs.readFileSync(sourcePath, 'utf8');
const source = JSON.parse(sourceText);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
global.window = global;
global.self = global;
global.THREE = require(path.join(root, 'assets/vendor/three-0.160.1.min.js'));
global.document = { baseURI: 'https://nasa-fixture.test/life.html' };
global.location = { origin: 'https://nasa-fixture.test' };
const T = THREE;
let buildSamples = [], textureLoads = 0;
const memorySamples = [];
global.recordNasaBVH = (bvh, started, temporaryBytes, mesh) => {
    const retainedBytes = Object.values(bvh).filter(value => ArrayBuffer.isView(value)).reduce((sum, value) => sum + value.byteLength, 0);
    let maximumDepth = 0, maximumLeafTriangles = 0;
    const stack = [[0, 1]];
    while (stack.length) {
        const [node, depth] = stack.pop();
        maximumDepth = Math.max(maximumDepth, depth);
        maximumLeafTriangles = Math.max(maximumLeafTriangles, bvh.nodeCount[node]);
        if (!bvh.nodeCount[node]) stack.push([bvh.nodeLeft[node], depth + 1], [bvh.nodeRight[node], depth + 1]);
    }
    buildSamples.push({ mesh: mesh.name, triangles: bvh.order.length, allocatedNodes: bvh.nodeCount.length, usedNodes: bvh.nodeTotal,
        maximumDepth, maximumLeafTriangles, retainedBytes, temporaryBytes, milliseconds: performance.now() - started });
    memorySamples.push(process.memoryUsage());
};
vm.runInThisContext(fs.readFileSync(path.join(root, 'assets/vendor/night-gltf-loader-0.160.1.js'), 'utf8'));
const originalFileLoad = T.FileLoader.prototype.load;
T.FileLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    const resolved = new URL(this.manager.resolveURL((this.path || '') + url), document.baseURI);
    assert.equal(resolved.origin, location.origin);
    const local = path.resolve(root, '.' + decodeURIComponent(resolved.pathname));
    assert(local.startsWith(root + path.sep));
    this.manager.itemStart(resolved.href);
    queueMicrotask(() => {
        try {
            const bytes = fs.readFileSync(local);
            onLoad(this.responseType === 'arraybuffer' ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes.toString('utf8'));
        } catch (error) { onError?.(error); this.manager.itemError(resolved.href); }
        finally { this.manager.itemEnd(resolved.href); }
    });
};
const NativeLoader = NightGLTFLoader;
window.NightGLTFLoader = class extends NativeLoader {
    constructor(manager) {
        manager.addHandler(/\.png$/i, { load(url, onLoad) {
            assert(fs.existsSync(path.resolve(root, '.' + decodeURIComponent(new URL(url).pathname))));
            const texture = new T.Texture(); textureLoads++;
            queueMicrotask(() => onLoad(texture)); return texture;
        } });
        super(manager);
    }
};
vm.runInThisContext(fs.readFileSync(path.join(root, 'assets/life/scripts/19-world-kit.js'), 'utf8'));
const runtimePath = path.join(root, 'assets/life/scripts/25-authored-worlds.js');
let runtimeSource = fs.readFileSync(runtimePath, 'utf8');
const instrumentStart = 'function buildBVH(mesh) {';
const instrumentEnd = 'return { vertices, triangleBounds, order, nodeMin, nodeMax, nodeLeft, nodeRight, nodeStart, nodeCount, nodeTotal };';
assert(runtimeSource.includes(instrumentStart) && runtimeSource.includes(instrumentEnd), 'Update the read-only instrumentation when BVH implementation changes.');
runtimeSource = runtimeSource.replace(instrumentStart, instrumentStart + ' const auditStarted = performance.now();');
runtimeSource = runtimeSource.replace('const mesh = new T.Mesh(source.geometry, collisionMaterial);', 'const mesh = new T.Mesh(source.geometry, collisionMaterial); mesh.name = source.name;');
runtimeSource = runtimeSource.replace(instrumentEnd, 'const auditBVH = { vertices, triangleBounds, order, nodeMin, nodeMax, nodeLeft, nodeRight, nodeStart, nodeCount, nodeTotal }; recordNasaBVH(auditBVH, auditStarted, centers.byteLength, mesh); return auditBVH;');
vm.runInThisContext(runtimeSource);
const spawn = { x: 0, y: 1.68, z: -9.95 };
const model = { url: '/assets/life/models/nasa-iss-cupola/nasa-iss-internal.gltf', position: [0, -96.32, 8.55], scale: 1 };
const glassPath = path.join(assetDirectory, 'collision-window.gltf');
if (fs.existsSync(glassPath)) model.collisionUrl = '/assets/life/models/nasa-iss-cupola/collision-window.gltf';
if (process.argv.includes('--require-glass')) assert(model.collisionUrl, 'Original source window collision asset is required');
const metadata = { observation: { position: Object.values(spawn), yaw: 0, pitch: 0 }, spawn: Object.values(spawn),
    navigation: 'float', distanceUnit: 'source', radius: .25, moveSpeed: 5,
    bounds: { minX: -55.3818626404, maxX: 171.2721557617, minZ: -25.621779632, maxZ: 59.764050293 } };
const pointArray = point => [point.x, point.y, point.z];
const displacement = (first, second) => Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
const timingSummary = values => {
    const sorted = values.slice().sort((first, second) => first - second);
    return { count: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], maximumMs: sorted[sorted.length - 1] };
};
function axisTravel(world, direction, limit = 80) {
    let position = { ...spawn }, distance = 0, stop = 'limit';
    const timings = [];
    for (let step = 0; step < Math.ceil(limit / .1); step++) {
        const target = { x: position.x + direction[0] * .1, y: position.y + direction[1] * .1, z: position.z + direction[2] * .1 };
        const started = performance.now(), result = world.fly(position, target);
        timings.push(performance.now() - started);
        distance += displacement(position, result.position); position = result.position;
        if (result.blocked) { stop = result.reason; break; }
    }
    return { direction, distance, finalPosition: pointArray(position), stop, queries: timingSummary(timings) };
}
function tracePath(world, waypoints) {
    let position = { ...spawn };
    const segments = [];
    for (const waypoint of waypoints) {
        const initial = { ...position }, target = { x: waypoint[0], y: waypoint[1], z: waypoint[2] };
        const length = displacement(initial, target), steps = Math.ceil(length / .1), timings = [];
        let stop = null;
        for (let step = 1; step <= steps; step++) {
            const next = { x: initial.x + (target.x - initial.x) * step / steps,
                y: initial.y + (target.y - initial.y) * step / steps, z: initial.z + (target.z - initial.z) * step / steps };
            const started = performance.now(), result = world.fly(position, next);
            timings.push(performance.now() - started); position = result.position;
            if (result.blocked) { stop = result.reason; break; }
        }
        segments.push({ start: pointArray(initial), requested: waypoint, finalPosition: pointArray(position), distance: displacement(initial, position), stop,
            independentNearestSurface: closestSurface(world.group, position), queries: timingSummary(timings) });
        if (stop) break;
    }
    return { segments, complete: segments.length === waypoints.length && !segments.some(segment => segment.stop) };
}
function inspectGeometry(group) {
    group.updateWorldMatrix(true, true);
    const sceneBounds = new T.Box3().setFromObject(group), materialSet = new Set(), geometrySet = new Set();
    let meshes = 0, triangles = 0, skinnedMeshes = 0, instancedMeshes = 0;
    const relevantObjects = [];
    group.traverse(object => {
        if (!object.isMesh) return;
        meshes++; skinnedMeshes += Number(Boolean(object.isSkinnedMesh)); instancedMeshes += Number(Boolean(object.isInstancedMesh));
        triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3;
        geometrySet.add(object.geometry);
        (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materialSet.add(material));
        if (/Cupola|Node3.*(Bulkhead|Enclosure|Hatch)/i.test(object.name)) {
            const bounds = new T.Box3().setFromObject(object);
            relevantObjects.push({ name: object.name, min: bounds.min.toArray(), max: bounds.max.toArray() });
        }
    });
    const buffers = new Set();
    for (const geometry of geometrySet) for (const attribute of [geometry.index, ...Object.values(geometry.attributes)]) {
        if (attribute) buffers.add((attribute.isInterleavedBufferAttribute ? attribute.data.array : attribute.array).buffer);
    }
    return { meshes, triangles, skinnedMeshes, instancedMeshes, materialInstances: materialSet.size, uniqueGeometries: geometrySet.size,
        geometryBackingArrayBufferBytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0),
        min: sceneBounds.min.toArray(), max: sceneBounds.max.toArray(), relevantObjects };
}
function closestSurface(group, position) {
    const target = new T.Vector3().fromArray(pointArray(position)), triangle = new T.Triangle(), closest = new T.Vector3();
    let best = { distance: Infinity };
    group.traverse(mesh => {
        if (!mesh.isMesh) return;
        const geometry = mesh.geometry, indices = geometry.index, vertices = geometry.attributes.position;
        const count = indices?.count || vertices.count;
        for (let offset = 0; offset < count; offset += 3) {
            [triangle.a, triangle.b, triangle.c].forEach((vertex, corner) => vertex.fromBufferAttribute(vertices, indices ? indices.getX(offset + corner) : offset + corner).applyMatrix4(mesh.matrixWorld));
            triangle.closestPointToPoint(target, closest);
            const distance = closest.distanceTo(target);
            if (distance < best.distance) best = { mesh: mesh.name, triangle: offset / 3, distance, point: closest.toArray() };
        }
    });
    return best;
}
function verifyCollisionVertices(group) {
    const evidencePath = path.join(root, '.render-work/nasa-original-views-20260927/explore-export/collision-evidence.json');
    const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    assert(Array.isArray(evidence.source_world_vertices), 'Collision export evidence must include evaluated source world vertices');
    const exportedPoints = [], vertex = new T.Vector3();
    group.traverse(mesh => {
        if (!mesh.isMesh) return;
        const positions = mesh.geometry.attributes.position;
        for (let index = 0; index < positions.count; index++) {
            vertex.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
            exportedPoints.push([vertex.x - model.position[0], vertex.y - model.position[1], vertex.z - model.position[2]]);
        }
    });
    const maximumNearestError = (firstPoints, secondPoints) => Math.max(...firstPoints.map(first => Math.min(...secondPoints.map(second =>
        Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2])))));
    const verification = { evidenceSha256: sha256(fs.readFileSync(evidencePath)), sourceVertices: evidence.source_world_vertices.length,
        exportedVertices: exportedPoints.length, sourceToExportMaximumError: maximumNearestError(evidence.source_world_vertices, exportedPoints),
        exportToSourceMaximumError: maximumNearestError(exportedPoints, evidence.source_world_vertices) };
    assert(verification.sourceToExportMaximumError < .0001 && verification.exportToSourceMaximumError < .0001,
        'Collision-only window geometry must preserve every evaluated source world vertex');
    return verification;
}
function textureInventory() {
    let pixels = 0, compressedBytes = 0;
    const dimensions = {};
    for (const definition of source.images) {
        const imagePath = path.join(assetDirectory, definition.uri), descriptor = fs.openSync(imagePath, 'r');
        const header = Buffer.alloc(24);
        try { fs.readSync(descriptor, header, 0, 24, 0); } finally { fs.closeSync(descriptor); }
        assert.equal(header.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
        dimensions[width + 'x' + height] = (dimensions[width + 'x' + height] || 0) + 1;
        pixels += width * height; compressedBytes += fs.statSync(imagePath).size;
    }
    return { images: source.images.length, dimensions, compressedBytes, rgba8BaseLevelBytes: pixels * 4,
        rgba8ApproximateMipBytes: pixels * 4 * 4 / 3,
        limitation: 'Theoretical RGBA8 allocation only. Actual image decoding, format choices, texture duplicates, GPU limits and renderer overhead are not measured.' };
}
(async () => {
    const runs = [];
    let world;
    for (let repeat = 0; repeat < 3; repeat++) {
        if (world) world.dispose();
        global.gc?.(); buildSamples = [];
        const before = process.memoryUsage(), started = performance.now();
        world = AuthoredWorlds.createBuilder('spaceship', metadata, model)(NightWorldKit);
        await world.loadPromise;
        assert.equal(world.error, ''); assert(world.ready);
        const setupMs = performance.now() - started, after = process.memoryUsage();
        global.gc?.();
        runs.push({ setupMs, bvhBuildMs: buildSamples.reduce((sum, sample) => sum + sample.milliseconds, 0),
            maximumMeshBuildMs: Math.max(...buildSamples.map(sample => sample.milliseconds)),
            triangles: buildSamples.reduce((sum, sample) => sum + sample.triangles, 0),
            retainedTypedArrayBytes: buildSamples.reduce((sum, sample) => sum + sample.retainedBytes, 0),
            allocatedNodes: buildSamples.reduce((sum, sample) => sum + sample.allocatedNodes, 0),
            usedNodes: buildSamples.reduce((sum, sample) => sum + sample.usedNodes, 0),
            largestMeshTemporaryCentersBytes: Math.max(...buildSamples.map(sample => sample.temporaryBytes)),
            maximumDepth: Math.max(...buildSamples.map(sample => sample.maximumDepth)),
            slowestMeshes: buildSamples.slice().sort((first, second) => second.milliseconds - first.milliseconds).slice(0, 5),
            maximumLeafTriangles: Math.max(...buildSamples.map(sample => sample.maximumLeafTriangles)), before, after, afterGC: process.memoryUsage() });
    }
    const geometry = inspectGeometry(world.group.children[0].children[0]);
    const collisionOnlyGeometry = model.collisionUrl ? inspectGeometry(world.group.children[0].children[1]) : null;
    const collisionSource = model.collisionUrl ? JSON.parse(fs.readFileSync(glassPath, 'utf8')) : null;
    const collisionVertexVerification = model.collisionUrl ? verifyCollisionVertices(world.group.children[0].children[1]) : null;
    const clearance = world.fly(spawn, spawn);
    const nearest = closestSurface(world.group, spawn);
    const directions = Object.fromEntries(Object.entries({ front: [0, 0, -1], rear: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] }).map(([name, direction]) => [name, axisTravel(world, direction)]));
    const frontStop = directions.front.finalPosition;
    const frontContact = closestSurface(world.group, { x: frontStop[0], y: frontStop[1], z: frontStop[2] });
    const rearPath = tracePath(world, [[0, 1.68, 0], [0, 1.68, 8.55], [0, -25, 8.55]]);
    const idleTimings = [];
    for (let index = 0; index < 1000; index++) {
        const started = performance.now(); world.fly(spawn, spawn); idleTimings.push(performance.now() - started);
    }
    const report = { generatedAt: new Date().toISOString(), command: 'node --expose-gc scripts/validate-nasa-collision.cjs',
        limitation: 'CPU-only Node execution with real GLTFLoader geometry/material parsing and empty image textures. No WebGL, browser, image-decoding, GPU or target-device guarantee. Instrumentation reads typed-array sizes and completed-build memory samples; it cannot observe an exact process peak inside sorting/GC.',
        host: { platform: process.platform, architecture: process.arch, node: process.version, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
        hashes: { gltf: sha256(sourceText), bin: sha256(fs.readFileSync(path.join(assetDirectory, source.buffers[0].uri))), loader: sha256(fs.readFileSync(runtimePath)),
            collisionGltf: model.collisionUrl ? sha256(fs.readFileSync(glassPath)) : null },
        source: { nodes: source.nodes.length, meshes: source.meshes.length, materials: source.materials.length, skins: source.skins?.length || 0, animations: source.animations?.length || 0, images: source.images.length, textureStubsLoaded: textureLoads },
        collisionSource: collisionSource ? { skins: collisionSource.skins?.length || 0, animations: collisionSource.animations?.length || 0,
            binSha256: sha256(fs.readFileSync(path.join(assetDirectory, collisionSource.buffers[0].uri))), hidden: !world.group.children[0].children[1].visible } : null,
        configuration: { metadata, model }, geometry, textures: textureInventory(), collisionOnlyGeometry, collisionVertexVerification, clearance, nearest, directions, frontContact, rearPath, initialization: runs,
        idleQuery: timingSummary(idleTimings), sampledMemoryMaximum: Object.fromEntries(['rss', 'heapUsed', 'external', 'arrayBuffers'].map(key => [key, Math.max(...memorySamples.map(sample => sample[key]))])) };
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    assert.equal(clearance.blocked, false, 'NASA spawn must have sphere clearance');
    assert(nearest.distance > metadata.radius, 'Independent triangle query must confirm spawn clearance');
    assert.equal(geometry.skinnedMeshes, 0); assert.equal(source.skins?.length || 0, 0);
    for (const run of runs) {
        assert.equal(run.allocatedNodes, run.usedNodes, 'BVH node allocation matches its exact balanced tree size');
        assert(run.maximumLeafTriangles <= 8);
        assert.equal(run.triangles, geometry.triangles + (collisionOnlyGeometry?.triangles || 0));
    }
    const exported = JSON.parse(fs.readFileSync(path.join(assetDirectory, 'export-evidence.json'), 'utf8'));
    for (const [axis, offset] of model.position.entries()) {
        assert(Math.abs(geometry.min[axis] - offset - exported.visible_bounds.min[axis]) < .0001, 'Source minimum bounds remain unchanged');
        assert(Math.abs(geometry.max[axis] - offset - exported.visible_bounds.max[axis]) < .0001, 'Source maximum bounds remain unchanged');
    }
    assert(rearPath.complete, 'Rear route through Cupola into the Node3 corridor must remain passable');
    if (model.collisionUrl) {
        assert.equal(collisionOnlyGeometry.skinnedMeshes, 0);
        assert.equal(collisionSource.skins?.length || 0, 0);
        assert.equal(collisionSource.animations?.length || 0, 0);
        assert.equal(directions.front.stop, 'obstacle', 'Original source glass blocks front-window exit');
        assert.match(frontContact.mesh, /Cupola_Int_Glass/, 'Front obstacle is the original source window glass');
        assert.equal(report.collisionSource.hidden, true);
    }
    console.log(JSON.stringify({ output, geometry: { meshes: geometry.meshes, triangles: geometry.triangles, materials: geometry.materialInstances }, nearest,
        directions: Object.fromEntries(Object.entries(directions).map(([name, value]) => [name, { distance: value.distance, stop: value.stop }])),
        rearPath, initialization: runs.map(run => ({ setupMs: run.setupMs, bvhBuildMs: run.bvhBuildMs, maximumMeshBuildMs: run.maximumMeshBuildMs, retainedTypedArrayBytes: run.retainedTypedArrayBytes, allocatedNodes: run.allocatedNodes, usedNodes: run.usedNodes })), idleQuery: report.idleQuery }, null, 2));
    world.dispose(); T.FileLoader.prototype.load = originalFileLoad;
})().catch(error => { console.error(error); process.exitCode = 1; });
