/* Numeric collision and async lifecycle checks; no browser or network requests. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = global;
global.THREE = require(path.join(root, 'assets/vendor/three-0.160.1.min.js'));
global.document = { baseURI: 'https://example.test/life.html' };
global.location = { origin: 'https://example.test' };
vm.runInThisContext(fs.readFileSync(path.join(root, 'assets/life/scripts/19-world-kit.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'assets/life/scripts/25-authored-worlds.js'), 'utf8'));
const T = THREE, kit = NightWorldKit;
let requests = [], supplied;
window.NightGLTFLoader = class {
    constructor(manager) { this.manager = manager; window.fixtureManager = manager; }
    loadAsync(url) { requests.push(url); return supplied(url); }
};
const metadata = { observation: { position: [0, 1.72, 0], yaw: .3, pitch: .05 } };
const model = { url: '/assets/life/models/fixture.glb' };
const point = (x, y = 1.72, z = 0) => ({ x, y, z });
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < .005, label + ': ' + actual);
function plane(width = 20, length = 20) {
    const mesh = new T.Mesh(new T.PlaneGeometry(width, length), new T.MeshBasicMaterial());
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
}
function box(x, y, z, width, height, depth) {
    const mesh = new T.Mesh(new T.BoxGeometry(width, height, depth), new T.MeshBasicMaterial());
    mesh.position.set(x, y, z); return mesh;
}
function scene(...meshes) { const group = new T.Group(); group.add(...meshes); return group; }
function imageBitmap() {
    return { closeCount: 0, close() { this.closeCount++; } };
}
function texturedScene(ownImage, sharedImage) {
    const ownTexture = new T.Texture(ownImage), duplicateTexture = new T.Texture(ownImage), sharedTexture = new T.Texture(sharedImage);
    sharedTexture.userData.shared = true;
    const first = new T.Mesh(new T.PlaneGeometry(20, 20), new T.MeshBasicMaterial({ map: ownTexture }));
    const second = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ map: duplicateTexture }));
    const shared = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: sharedTexture }));
    first.rotation.x = second.rotation.x = shared.rotation.x = -Math.PI / 2;
    return scene(first, second, shared);
}
async function loaded(source, spec = model, options = metadata) {
    supplied = () => Promise.resolve({ scene: source });
    const world = AuthoredWorlds.createBuilder('fixture', options, spec)(kit);
    assert.equal(world.ready, false);
    await world.loadPromise;
    assert.equal(world.error, '');
    assert.equal(world.ready, true);
    return world;
}
(async () => {
    assert.throws(() => AuthoredWorlds.createBuilder('bad', metadata, { url: 'https://other.test/world.glb' }), /site origin/);
    assert.throws(() => AuthoredWorlds.createBuilder('bad', metadata, { ...model, scale: 0 }), /positive/);
    assert.throws(() => AuthoredWorlds.createBuilder('bad', metadata, { ...model, quaternion: [0, 0, 0, 0] }), /nonzero/);
    const builder = AuthoredWorlds.createBuilder('fixture', metadata, model);
    assert.equal(requests.length, 0, 'creating a builder never loads an exploration model');
    supplied = () => Promise.resolve({ scene: scene(plane()) });
    let world = builder(kit);
    assert.equal(world.walk(point(0), point(1)).reason, 'loading', 'movement is blocked until loaded');
    await world.loadPromise;
    assert(AuthoredWorlds.canExplore(world));
    assert.throws(() => fixtureManager.resolveURL('https://other.test/texture.jpg'), /site origin/,
        'glTF external buffers and images must obey origin validation');
    assert.equal(requests.length, 1);
    near(world.sampleGround(0, 0, 0).y, 0, 'flat ground');
    assert.equal(world.walk(point(0), point(2)).blocked, false);
    assert.deepEqual(world.previewCamera, metadata.observation);
    assert.deepEqual(world.spawn, metadata.observation.position);
    world.dispose();
    assert.equal(world.status, 'disposed');
    assert.equal(AuthoredWorlds.canExplore(world), false);
    assert.equal(world.group.children.length, 0);

    world = await loaded(scene(plane(), box(1, 1.5, 0, .05, 3, 4)));
    const wall = world.walk(point(0), point(2));
    assert(wall.blocked && wall.position.x < .76, 'thin wall stops full-radius player without tunnelling');
    assert(world.walk(point(2), point(0)).blocked, 'reverse direction also collides');
    world.dispose();

    supplied = () => Promise.resolve({ scene: scene(box(0, 0, -2, 4, 4, .1)) });
    const floatMetadata = { observation: { position: [0, 0, 0], yaw: 0, pitch: 0 },
        navigation: 'float', radius: .25, eyeHeight: 1.72, moveSpeed: 3.1,
        bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10, minZ: -10, maxZ: 10 } };
    world = await loaded(scene(box(0, 0, -2, 4, 4, .1)), model, floatMetadata);
    assert.equal(world.navigation, 'float');
    assert.equal(world.distanceUnit, 'm');
    assert.equal(world.fly(point(0, 0, 0), point(0, 0, -3)).blocked, true, 'floating wall stops forward motion');
    assert.equal(world.fly(point(0, 0, 0), point(0, 0, 1)).blocked, false, 'floating clear direction moves');
    assert.equal(world.sampleGround(0, 0, 0), null, 'floating scene does not require ground');
    assert.equal(world.fly(point(0, 0, -1.8), point(0, 0, -1.8)).blocked, true, 'stationary arrival rejects sphere overlapping a wall');
    assert.equal(world.fly(point(0, 0, 0), point(0, 0, 0)).blocked, false, 'stationary arrival accepts free eye position');
    const rise = world.fly(point(0, 0, 0), point(0, 2, 0));
    assert.equal(rise.blocked, false, 'floating can rise with no ground support');
    near(rise.position.y, 2, 'float position uses source-unit vertical displacement');
    assert.equal(world.fly(point(0, 9.5, 0), point(0, 11, 0)).reason, 'bounds');
    world.group.position.set(100, 60, -20); world.group.rotation.set(.5, 1.1, -.2);
    world.group.updateMatrixWorld(true);
    assert.equal(world.fly(point(0, 0, 0), point(0, 0, -3)).blocked, true, 'floating collision is unchanged under ship motion');
    world.dispose();
    assert.throws(() => AuthoredWorlds.createBuilder('bad', { ...floatMetadata, distanceUnit: 'units' }, model), /distanceUnit/);
    world = await loaded(scene(plane()), model, { ...floatMetadata, distanceUnit: 'source' });
    assert.equal(world.distanceUnit, 'source');
    world.dispose();

    const disposedImage = imageBitmap(), sharedDisposedImage = imageBitmap();
    world = await loaded(texturedScene(disposedImage, sharedDisposedImage));
    world.dispose();
    assert.equal(disposedImage.closeCount, 1, 'owned ImageBitmap closes exactly once on world disposal');
    assert.equal(sharedDisposedImage.closeCount, 0, 'shared ImageBitmap remains open on world disposal');
    world.dispose();
    assert.equal(disposedImage.closeCount, 1, 'repeated world disposal does not close an image twice');
    const directlyDisposedImage = imageBitmap();
    world = await loaded(texturedScene(directlyDisposedImage, imageBitmap()));
    kit.disposeGroup(world.group);
    assert.equal(directlyDisposedImage.closeCount, 1, 'direct runtime group disposal closes owned ImageBitmaps');
    world.dispose();
    assert.equal(directlyDisposedImage.closeCount, 1);
    const aliasedSharedImage = imageBitmap();
    const aliasedScene = texturedScene(aliasedSharedImage, aliasedSharedImage);
    world = await loaded(aliasedScene);
    world.dispose();
    assert.equal(aliasedSharedImage.closeCount, 0, 'an image used by any shared texture stays open even through an owned texture');
    const sharedMaterialImage = imageBitmap();
    const sharedMaterialScene = texturedScene(sharedMaterialImage, imageBitmap());
    sharedMaterialScene.children[1].material.userData.shared = true;
    world = await loaded(sharedMaterialScene);
    world.dispose();
    assert.equal(sharedMaterialImage.closeCount, 0, 'an image on any shared material stays open');

    const normalImage = imageBitmap(), normalTexture = new T.Texture(normalImage);
    normalTexture.colorSpace = T.SRGBColorSpace;
    const normalMaterial = new T.MeshStandardMaterial();
    normalMaterial.userData.lifeObjectNormalTexture = 0;
    normalMaterial.normalScale.set(.4, .7);
    const normalMesh = plane(); normalMesh.material = normalMaterial;
    const secondNormalMesh = plane(); secondNormalMesh.material = normalMaterial.clone();
    const regularMaterial = new T.MeshStandardMaterial({ normalMap: new T.Texture() });
    const regularMesh = plane(); regularMesh.material = regularMaterial;
    let resolveNormal;
    const normalRequests = [];
    supplied = () => Promise.resolve({ scene: scene(normalMesh, secondNormalMesh, regularMesh),
        parser: { json: { textures: [{}] }, getDependency(kind, index) {
            normalRequests.push([kind, index]);
            return new Promise(done => { resolveNormal = done; });
        } } });
    world = builder(kit);
    while (!resolveNormal) await Promise.resolve();
    assert.equal(world.ready, false, 'object-space normal dependency must complete before exploration becomes ready');
    assert.deepEqual(normalRequests, [['texture', 0]], 'shared extras indices request one native texture dependency');
    resolveNormal(normalTexture);
    await world.loadPromise;
    assert(world.ready, world.error);
    assert.equal(normalMaterial.normalMap, normalTexture);
    assert.equal(secondNormalMesh.material.normalMap, normalTexture);
    assert.equal(normalMaterial.normalMapType, T.ObjectSpaceNormalMap);
    assert.equal(normalTexture.colorSpace, T.NoColorSpace, 'source-space normal channels remain linear data');
    assert.deepEqual(normalMaterial.normalScale.toArray(), [.4, .7], 'source normals are not rescaled');
    assert.equal(regularMaterial.normalMapType, T.TangentSpaceNormalMap, 'ordinary normal maps retain their convention');
    let normalDisposals = 0;
    normalTexture.addEventListener('dispose', () => normalDisposals++);
    world.dispose(); world.dispose();
    assert.equal(normalDisposals, 1, 'a normal texture shared by authored materials is disposed once');
    assert.equal(normalImage.closeCount, 1, 'normal ImageBitmap closes exactly once');

    const aliasImage = imageBitmap(), aliasTexture = new T.Texture(aliasImage);
    aliasTexture.colorSpace = T.SRGBColorSpace;
    const colorMaterial = new T.MeshStandardMaterial({ map: aliasTexture });
    const colorMesh = plane(); colorMesh.material = colorMaterial;
    const aliasMaterial = new T.MeshStandardMaterial();
    aliasMaterial.userData.lifeObjectNormalTexture = 0;
    const aliasMesh = plane(); aliasMesh.material = aliasMaterial;
    supplied = () => Promise.resolve({ scene: scene(colorMesh, aliasMesh),
        parser: { json: { textures: [{}] }, getDependency: () => Promise.resolve(aliasTexture) } });
    world = builder(kit); await world.loadPromise;
    assert(world.ready, world.error);
    assert.notEqual(aliasMaterial.normalMap, aliasTexture, 'a texture reused by a regular material receives a separate normal-map sampler');
    assert.equal(colorMaterial.map.colorSpace, T.SRGBColorSpace, 'normal setup cannot change an ordinary color texture');
    assert.equal(aliasMaterial.normalMap.colorSpace, T.NoColorSpace);
    let aliasNormalDisposals = 0;
    aliasMaterial.normalMap.addEventListener('dispose', () => aliasNormalDisposals++);
    world.dispose();
    assert.equal(aliasNormalDisposals, 1);
    assert.equal(aliasImage.closeCount, 1, 'sampler cloning retains single ImageBitmap ownership');

    for (const invalidIndex of [-1, 0.5, 2, null, '0']) {
        const invalidMesh = plane();
        invalidMesh.material.userData.lifeObjectNormalTexture = invalidIndex;
        let invalidRequests = 0, invalidDisposals = 0;
        invalidMesh.geometry.addEventListener('dispose', () => invalidDisposals++);
        supplied = () => Promise.resolve({ scene: scene(invalidMesh),
            parser: { json: { textures: [{}] }, getDependency() { invalidRequests++; } } });
        world = builder(kit); await world.loadPromise;
        assert.equal(world.status, 'error');
        assert.match(world.error, /glTF texture index/);
        assert.equal(invalidRequests, 0, 'invalid normal indices fail before loading any dependencies');
        assert.equal(invalidDisposals, 1, 'invalid extras release the loaded scene');
        world.dispose();
    }

    const partialNormalImage = imageBitmap(), partialNormal = new T.Texture(partialNormalImage);
    const firstFailedNormalMesh = plane(), secondFailedNormalMesh = plane();
    firstFailedNormalMesh.material.userData.lifeObjectNormalTexture = 0;
    secondFailedNormalMesh.material.userData.lifeObjectNormalTexture = 1;
    let partialNormalDisposals = 0;
    partialNormal.addEventListener('dispose', () => partialNormalDisposals++);
    supplied = () => Promise.resolve({ scene: scene(firstFailedNormalMesh, secondFailedNormalMesh),
        parser: { json: { textures: [{}, {}] }, getDependency(kind, index) {
            return index === 0 ? Promise.resolve(partialNormal) : Promise.reject(new Error('normal image missing'));
        } } });
    world = builder(kit); await world.loadPromise;
    assert.equal(world.status, 'error');
    assert.equal(world.error, 'normal image missing');
    assert.equal(partialNormalDisposals, 1, 'failure of one normal dependency releases successful normal dependencies');
    assert.equal(partialNormalImage.closeCount, 1);
    world.dispose();

    const delayedNormalImage = imageBitmap(), delayedNormal = new T.Texture(delayedNormalImage);
    const delayedNormalMesh = plane();
    delayedNormalMesh.material.userData.lifeObjectNormalTexture = 0;
    let delayedNormalResolve, delayedNormalDisposals = 0;
    delayedNormal.addEventListener('dispose', () => delayedNormalDisposals++);
    supplied = () => Promise.resolve({ scene: scene(delayedNormalMesh),
        parser: { json: { textures: [{}] }, getDependency: () => new Promise(done => { delayedNormalResolve = done; }) } });
    world = builder(kit);
    while (!delayedNormalResolve) await Promise.resolve();
    kit.disposeGroup(world.group);
    delayedNormalResolve(delayedNormal);
    await world.loadPromise;
    assert.equal(world.status, 'disposed');
    assert.equal(world.group.children.length, 0);
    assert.equal(delayedNormalMesh.material.normalMap, undefined, 'late normal loads never mutate disposed materials');
    assert.equal(delayedNormalDisposals, 1, 'late normal textures are freed even after their scene is gone');
    assert.equal(delayedNormalImage.closeCount, 1, 'late normal ImageBitmaps close once');
    world.dispose();
    assert.equal(delayedNormalDisposals, 1);
    assert.equal(delayedNormalImage.closeCount, 1);

    world = await loaded(scene(box(0, 1, 0, 4, .01, 4)), model, floatMetadata);
    const ceilingFloat = world.fly(point(0, 0, 0), point(0, 2, 0));
    assert(ceilingFloat.blocked && ceilingFloat.position.y < .75, 'floating sphere cannot tunnel through thin overhead panel');
    world.dispose();
    const smallEdge = box(.2, .2, -.5, .1, .1, .02);
    world = await loaded(scene(smallEdge), model, floatMetadata);
    assert(world.fly(point(0, 0, 0), point(0, 0, -1)).blocked, 'sphere sweep catches offset panel edge missed by a center ray');
    world.dispose();
    const instanced = new T.InstancedMesh(new T.BoxGeometry(.05, 3, 3), new T.MeshBasicMaterial(), 1);
    instanced.setMatrixAt(0, new T.Matrix4().makeTranslation(1, 0, 0));
    world = await loaded(scene(instanced), model, floatMetadata);
    assert(world.fly(point(0, 0, 0), point(2, 0, 0)).blocked, 'floating collision preserves authored instance transform');
    world.dispose();

    assert.throws(() => AuthoredWorlds.createBuilder('bad', metadata, { ...model, collisionUrl: 'https://other.test/glass.glb' }), /site origin/);
    const collisionScene = scene(box(1, 0, 0, .01, 4, 4));
    const displayScene = scene(box(10, 0, 0, 1, 4, 4));
    supplied = url => Promise.resolve({ scene: url.endsWith('/glass.glb') ? collisionScene : displayScene });
    world = AuthoredWorlds.createBuilder('fixture', floatMetadata,
        { ...model, collisionUrl: '/glass.glb', position: [10, 2, -3], scale: 2 })(kit);
    await world.loadPromise;
    assert(world.ready, world.error);
    assert.equal(collisionScene.visible, false, 'collision-only source glass stays invisible');
    assert.equal(collisionScene.userData.collisionOnly, true);
    const glassStop = world.fly(point(10, 2, -3), point(14, 2, -3));
    assert(glassStop.blocked && glassStop.position.x < 11.75, 'transformed invisible source glass stops the floating sphere');
    world.dispose();
    assert.equal(collisionScene.userData.disposed, true, 'collision-only assets dispose with the display model');
    assert.equal(world.group.children.length, 0);
    const partialImage = imageBitmap(), partialSharedImage = imageBitmap();
    const partialScene = texturedScene(partialImage, partialSharedImage);
    let partialDisposals = 0;
    partialScene.children[0].geometry.addEventListener('dispose', () => partialDisposals++);
    supplied = url => url.endsWith('/glass.glb') ? Promise.reject(new Error('glass missing')) : Promise.resolve({ scene: partialScene });
    world = AuthoredWorlds.createBuilder('fixture', floatMetadata, { ...model, collisionUrl: '/glass.glb' })(kit);
    await world.loadPromise;
    assert.equal(world.status, 'error');
    assert.equal(world.error, 'glass missing');
    assert.equal(partialDisposals, 1, 'failure of a required collision asset frees the loaded display asset');
    assert.equal(partialImage.closeCount, 1, 'collision failure closes owned display ImageBitmap once');
    assert.equal(partialSharedImage.closeCount, 0, 'collision failure leaves shared display ImageBitmap open');
    world.dispose();
    supplied = () => Promise.resolve({ scene: scene(new T.SkinnedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial())) });
    world = AuthoredWorlds.createBuilder('fixture', floatMetadata, model)(kit);
    await world.loadPromise;
    assert.equal(world.status, 'error');
    assert.match(world.error, /static evaluated geometry/);
    world.dispose();

    world = await loaded(scene(plane()), model, { ...metadata, bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } });
    assert.equal(world.walk(point(0), point(1)).reason, 'bounds');
    world.dispose();

    world = await loaded(scene(plane(), box(1.5, .15, 0, 1, .3, 4)));
    const step = world.walk(point(0), point(1.5));
    assert.equal(step.blocked, false, 'legal step is walkable');
    near(step.position.y, 2.02, 'step changes eye height');
    world.dispose();
    world = await loaded(scene(plane(), box(1.5, .3, 0, 1, .6, 4)));
    assert(world.walk(point(0), point(1.5)).blocked, 'oversized step is blocked');
    world.dispose();

    world = await loaded(scene(plane(2, 4)));
    const cliff = world.walk(point(0), point(2));
    assert(cliff.blocked && cliff.position.x < .9, 'footprint cannot cross unsupported edge');
    world.dispose();
    world = await loaded(scene(plane(), box(1, 1.4, 0, 1, .15, 4)));
    assert(world.walk(point(0), point(1)).blocked, 'low ceiling rejects player');
    world.dispose();

    const ramp = plane();
    ramp.rotation.y = Math.PI / 3; ramp.rotation.x = -Math.PI / 2;
    world = await loaded(scene(ramp));
    assert.equal(world.sampleGround(0, 0, 0), null, 'steep ground is not walkable');
    world.dispose();
    const original = scene(plane()); original.position.set(2, 0, 0);
    world = await loaded(original, { ...model, position: [10, 2, -3], quaternion: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)], scale: 2 });
    near(original.position.x, 2, 'glTF local translation remains untouched');
    near(original.getWorldPosition(new T.Vector3()).x, 10, 'explicit root transform x');
    near(original.getWorldPosition(new T.Vector3()).z, -7, 'explicit scale and quaternion transform z');
    near(world.sampleGround(10, -7, 2).y, 2, 'transformed collision surfaces');
    world.dispose();

    supplied = () => Promise.resolve({ scene: scene(plane(), box(1, 1.5, 0, .05, 3, 4)) });
    world = builder(kit);
    const parent = new T.Group();
    parent.position.set(-30, 15, 70); parent.rotation.set(.2, -.4, .1);
    parent.add(world.group);
    world.group.position.set(100, 60, -20); world.group.rotation.set(.4, .8, -.2);
    await world.loadPromise;
    near(world.sampleGround(0, 0, 0).y, 0, 'load under translated/rotated parent keeps local ground');
    const movedShip = world.walk(point(0), point(2));
    assert(movedShip.blocked && movedShip.position.x < .76, 'load under ship pose keeps local wall collision');
    world.group.position.set(-45, -10, 12); world.group.rotation.set(-.5, 2, .6);
    parent.rotation.set(-.7, .3, .2); parent.updateMatrixWorld(true);
    near(world.sampleGround(0, 0, 0).y, 0, 'moving ship after load does not move local ground');
    const movedAgain = world.walk(point(0), point(2));
    assert(movedAgain.blocked, 'moving ship after load keeps local wall collision');
    near(movedAgain.position.x, movedShip.position.x, 'ship pose leaves local movement result unchanged');
    world.dispose();

    let resolve;
    supplied = () => new Promise(done => { resolve = done; });
    world = builder(kit);
    await Promise.resolve();
    kit.disposeGroup(world.group); // Existing runtime currently uses this path.
    const lateImage = imageBitmap(), lateSharedImage = imageBitmap();
    const late = texturedScene(lateImage, lateSharedImage);
    let geometryDisposed = 0;
    late.children[0].geometry.addEventListener('dispose', () => geometryDisposed++);
    resolve({ scene: late });
    await world.loadPromise;
    assert.equal(world.status, 'disposed');
    assert.equal(world.group.children.length, 0, 'late model cannot reattach to removed world');
    assert.equal(geometryDisposed, 1, 'late load resources are freed');
    assert.equal(lateImage.closeCount, 1, 'stale load closes owned ImageBitmap once');
    assert.equal(lateSharedImage.closeCount, 0, 'stale load leaves shared ImageBitmap open');
    supplied = () => Promise.reject(new Error('fixture load failure'));
    world = builder(kit); await world.loadPromise;
    assert.equal(world.status, 'error');
    assert.equal(world.error, 'fixture load failure');
    assert.equal(world.walk(point(0), point(1)).blocked, true);
    assert.equal(world.group.children[0].children.length, 0, 'failure leaves no proxy geometry');
    world.dispose();
    console.log('Authored-world validation passed: lazy loading, source/local transforms, ground/step/slope walking, swept-sphere floating, arrival clearance, instances, moving ships, object-space normal textures, failure and disposal.');
})().catch(error => { console.error(error); process.exitCode = 1; });
