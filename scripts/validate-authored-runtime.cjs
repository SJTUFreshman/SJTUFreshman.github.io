/* Run the actual runtime against authored loaders; graphics output alone is stubbed. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = global;
global.THREE = require(path.join(root, 'assets/vendor/three-0.160.1.min.js'));
const T = THREE;
function events(target) {
    const handlers = new Map();
    target.addEventListener = (type, fn) => { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); };
    target.dispatchEvent = event => { for (const fn of handlers.get(event.type) || []) fn(event); };
    return target;
}
function element() {
    const names = new Set();
    return events({ style: {}, inert: false, disabled: false, classList: {
        add(...values) { values.forEach(value => names.add(value)); }, remove(...values) { values.forEach(value => names.delete(value)); },
        contains: value => names.has(value), toggle(value, enabled) { if (enabled) names.add(value); else names.delete(value); }
    } });
}
const canvas = element(), body = element();
global.document = events({ body, hidden: false, readyState: 'complete', baseURI: 'https://fixture.test/life.html',
    getElementById: () => canvas, createElement: () => ({ width: 128, height: 64, getContext: () => ({}) }) });
events(global);
Object.assign(global, {
    location: { origin: 'https://fixture.test' }, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1,
    localStorage: { getItem: () => 'shelter', setItem() {} }, CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    COARSE_POINTER: false, REDUCED_MOTION: false, DEG: Math.PI / 180, MIN_CAMERA_ALTITUDE: .005, INITIAL_CAMERA: { yaw: 0 },
    state: { scene: 'roam', hasEntered: true, currentLang: 'en', modalOpen: false, gateOpen: false, altHeld: false },
    camera: { orientation: [0, 0, 0, 1], targetOrientation: [0, 0, 0, 1], lastStableYaw: 0, fov: 1, targetFov: 1 },
    skyModel: { location: { longitude: 0 } }, dom: { body, world: element(), portalNav: element(), celestialNav: element(), starNav: element(), sectionDrawerToggle: element(), entryTrigger: element() },
    refreshAstronomicalSky() {}, updateEntryLocationCopy() {}, syncSectionDrawerAvailability() {},
    isInteractiveKeyTarget: () => false, hideEntryGate() {}, setGateState() {}, settleUnlockedView() {}
});
const load = file => vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
load('assets/life/scripts/03-math-orientation.js');
global.clearCameraRoll = () => { const pose = decomposeYawPitchRoll(camera.targetOrientation, 0); camera.targetOrientation = orientationFromYawPitch(pose.yaw, pose.pitch); };
load('assets/life/scripts/19-world-kit.js');
load('assets/life/scripts/25-authored-worlds.js');
const requests = [];
window.NightGLTFLoader = class {
    loadAsync(url) { return new Promise((resolve, reject) => requests.push({ url, resolve, reject })); }
};
const metadata = { observation: { position: [0, 0, 0], yaw: 0, pitch: 0 }, navigation: 'float', distanceUnit: 'source' };
const makeBuilder = id => AuthoredWorlds.createBuilder(id, metadata, { url: '/models/' + id + '.glb' });
window.NightWorldBuilders = { shelter: makeBuilder('shelter'), snowmountain: makeBuilder('snowmountain') };
let manifestReady = false, areaLights;
window.NightPanorama = { getScene: id => ({ observation: metadata.observation,
    ...(manifestReady ? { exploration: { ...metadata, areaLights, model: { url: '/models/' + id + '.glb' } } } : {}) }),
    select() {}, setMode() {}, render() {}, getSnapshot: () => ({ status: 'prerendered' }) };
let lastView;
THREE.WebGLRenderer = class {
    constructor(options) { this.domElement = options.canvas; this.shadowMap = {}; }
    setClearColor() {} setPixelRatio() {} setSize() {} dispose() {}
    render(scene, view) { scene.updateMatrixWorld(true); lastView = view; }
};
const sourceScene = (blocked = false) => {
    const group = new T.Group();
    const mesh = new T.Mesh(new T.BoxGeometry(.1, 10, 10), new T.MeshBasicMaterial());
    mesh.position.x = blocked ? 0 : 20; group.add(mesh); return group;
};
const flush = async () => { await new Promise(resolve => setImmediate(resolve)); };
let time = 0;
const frame = (api, count = 1) => { for (let index = 0; index < count; index++) { time += 50; camera.orientation = camera.targetOrientation.slice(); api.tick(time); } };
const key = (code, release = false) => (release ? window : document).dispatchEvent({
    type: release ? 'keyup' : 'keydown', code, repeat: false, preventDefault() {}, stopImmediatePropagation() {}
});
(async () => {
    load('assets/life/scripts/20-world-runtime.js');
    const api = NightWorld;
    assert(api.ready && api.mode === 'observe');
    assert.equal(requests.length, 0, 'observe performs no authored model requests');
    assert.equal(api.getSnapshot().distanceUnit, 'm');
    assert.equal(api.skyMode, 'night');
    const observationWorld = api.world, observationPosition = { ...api.player }, observationOrientation = camera.orientation.slice();
    let metadataNotifications = 0;
    const stopMetadataNotifications = api.onChange(() => metadataNotifications++);
    manifestReady = true;
    window.dispatchEvent(new CustomEvent('nightpanorama:metadata', { detail: {
        scene: api.currentId, skyMode: 'clear', metadata: NightPanorama.getScene(api.currentId)
    } }));
    assert.equal(api.getSnapshot().distanceUnit, 'source', 'late metadata updates source units even when the observation is identical');
    assert.equal(api.skyMode, 'clear', 'late metadata synchronizes the installed panorama phase');
    assert.equal(api.world, observationWorld, 'metadata refresh does not rebuild the observation world');
    assert.deepEqual(api.player, observationPosition);
    assert.deepEqual(camera.orientation, observationOrientation);
    assert(metadataNotifications > 0, 'same-position metadata refresh notifies the HUD');
    assert.equal(requests.length, 0, 'observation metadata refresh never fetches the exploration model');
    stopMetadataNotifications();
    const createBuilder = AuthoredWorlds.createBuilder;
    let failedWorld;
    AuthoredWorlds.createBuilder = (...args) => {
        const builder = createBuilder(...args);
        return kit => (failedWorld = builder(kit));
    };
    areaLights = [{ color: [1, 1, 1], width: 1, height: 1, position: [0, 3, 0], direction: [0, -1, 0], power: 10 }];
    api.explorationUnlocked = true;
    assert.equal(api.setViewMode('explore'), false, 'missing lighting support rejects the scene without throwing');
    await flush();
    assert.equal(api.mode, 'observe');
    assert.equal(api.world, observationWorld, 'failed preparation preserves the previous world');
    assert(observationWorld.group.parent, 'previous world remains attached');
    assert(!observationWorld.group.userData.disposed, 'previous world stays usable');
    assert.deepEqual(api.player, observationPosition);
    assert.equal(api.skyMode, 'clear');
    assert.equal(failedWorld.status, 'disposed', 'failed candidate is disposed before its asynchronous load starts');
    assert.equal(requests.length, 0);
    assert.match(api.error, /Area lighting support/);
    window.NightAreaLightUniforms = { init() { throw new Error('fixture area uniform initialization failure'); } };
    assert.equal(api.setViewMode('explore'), false, 'lighting initialization errors are also transactional');
    await flush();
    assert.equal(api.world, observationWorld);
    assert.equal(api.mode, 'observe');
    assert.equal(failedWorld.status, 'disposed');
    assert.equal(requests.length, 0);
    assert.match(api.error, /fixture area uniform initialization failure/);
    delete window.NightAreaLightUniforms;
    areaLights = undefined;
    AuthoredWorlds.createBuilder = createBuilder;
    api.unlockExploration(); await flush();
    assert(api.getSnapshot().loading);
    const start = { ...api.player };
    api.setMotion(1, 0); frame(api, 4);
    assert.deepEqual(api.player, start, 'loading prevents movement');
    const stale = api.world, staleRequest = requests.shift();
    api.select('snowmountain'); await flush();
    const current = api.world, currentRequest = requests.shift();
    staleRequest.reject(new Error('stale fixture failure')); await flush();
    assert.equal(api.world, current);
    assert.equal(api.mode, 'explore', 'late failure cannot force newer scene back to observe');
    assert.equal(stale.status, 'disposed');
    currentRequest.resolve({ scene: sourceScene() }); await flush();
    assert.equal(api.world, current);
    assert.equal(api.getSnapshot().loading, false);
    assert.equal(api.getSnapshot().distanceUnit, 'source');
    camera.orientation = camera.targetOrientation = orientationFromYawPitch(.7, .45);
    const before = new T.Vector3(api.player.x, api.player.y, api.player.z);
    api.setMotion(1, 0); frame(api, 2); api.clearInput();
    const movement = new T.Vector3(api.player.x, api.player.y, api.player.z).sub(before);
    const viewForward = lastView.getWorldDirection(new T.Vector3());
    assert(movement.length() > 0);
    assert(movement.clone().normalize().dot(viewForward) > .999999, 'float forward agrees with rendered camera ray');
    assert(api.player.y > before.y, 'looking upward and moving forward increases local eye height');
    key('Space'); const upStart = api.player.y; frame(api, 2); key('Space', true);
    assert(api.player.y > upStart, 'Space rises');
    key('KeyQ'); const downStart = api.player.y; frame(api, 2); key('KeyQ', true);
    assert(api.player.y < downStart, 'Q descends');
    api.select('shelter'); await flush();
    const disposedByObserve = api.world, oldSuccess = requests.shift();
    api.setViewMode('observe');
    oldSuccess.resolve({ scene: sourceScene() }); await flush();
    assert.equal(api.mode, 'observe', 'late success cannot undo explicit observe');
    assert.equal(disposedByObserve.group.children.length, 0);
    api.setViewMode('explore'); await flush();
    requests.shift().reject(new Error('active fixture failure')); await flush();
    assert.equal(api.mode, 'observe', 'active load failure restores observation');
    assert.match(api.error, /active fixture failure/);
    api.setViewMode('explore'); await flush();
    requests.shift().resolve({ scene: sourceScene(true) }); await flush();
    assert.equal(api.mode, 'observe', 'blocked arrival restores observation');
    assert.match(api.error, /arrival|safe|obstacle/i);
    api.select('spaceship');
    const shipWorld = api.world, shipOrientation = camera.orientation.slice();
    const pilot = { seat: [1, 2, 3], exit: [4, 5, 6] };
    window.dispatchEvent(new CustomEvent('nightpanorama:metadata', { detail: {
        scene: 'spaceship', skyMode: api.skyMode, metadata: { ...NightPanorama.getScene('spaceship'), pilot }
    } }));
    assert.equal(api.world, shipWorld, 'pilot-only metadata update preserves the world');
    assert.deepEqual(api.world.pilot.seat, pilot.seat);
    assert.deepEqual(api.world.pilot.exit, pilot.exit);
    assert.deepEqual([api.player.x, api.player.y, api.player.z], pilot.seat, 'active observation follows a late pilot seat');
    assert.deepEqual(camera.orientation, shipOrientation, 'pilot metadata refresh preserves the look direction');
    pilot.seat[0] = 100; pilot.exit[0] = 200;
    assert.equal(api.world.pilot.seat[0], 1, 'pilot metadata arrays are copied');
    assert.equal(api.world.pilot.exit[0], 4);
    assert.equal(requests.length, 0, 'pilot metadata does not fetch exploration resources');
    console.log('Authored runtime passed: transactional lighting failures, late metadata phase/units/pilot, real async scene switching, stale success/failure, loading lock, source units, camera-aligned float input, active failure and arrival fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; });
