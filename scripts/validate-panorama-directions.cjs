/* Cross-check real site quaternion math, Three camera rays, and native NASA panorama axes. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require(path.join(__dirname, '../assets/vendor/three-0.160.1.min.js'));
const root = path.resolve(__dirname, '..');
const near = (actual, expected, label) => assert(Math.abs(actual - expected) < 1e-9, label + ': ' + actual + ' != ' + expected);
const wrap = value => ((value % 1) + 1) % 1;
const context = {
    window: {}, document: { readyState: 'loading', addEventListener() {} },
    Math, Number, Array, Object, Map, Set, INITIAL_CAMERA: { yaw: 0 }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/life/scripts/03-math-orientation.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/life/scripts/24-panorama.js'), 'utf8'), context);
const { project, multiply, rotate } = context.window.NightPanorama.projection;
// Execute the actual runtime camera conversion so this test catches future basis regressions.
const runtime = fs.readFileSync(path.join(root, 'assets/life/scripts/20-world-runtime.js'), 'utf8');
const start = runtime.indexOf('    function syncCamera() {');
const end = runtime.indexOf('\n    function findInteraction()', start);
assert(start >= 0 && end > start, 'runtime camera conversion must remain inspectable');
const cameraContext = {
    T, view: new T.PerspectiveCamera(), lookMatrix: new T.Matrix4(),
    player: { x: 0, y: 0, z: 0 }, world: null, DEG: Math.PI / 180,
    window: { innerWidth: 1600, innerHeight: 900 }, camera: { fov: Math.PI / 3 },
    cameraBasis: () => context.orientationBasis(context.testOrientation)
};
vm.createContext(cameraContext);
vm.runInContext(runtime.slice(start, end), cameraContext);
function verifyPose(yaw, pitch, roll, horizontal, vertical) {
    const orientation = context.orientationFromYawPitchRoll(yaw, pitch, roll);
    context.testOrientation = orientation;
    cameraContext.syncCamera();
    const ray = new T.Raycaster();
    ray.setFromCamera({ x: horizontal, y: vertical }, cameraContext.view);
    const direction = ray.ray.direction;
    // Measured r2 Blender camera is identity: +X/right, +Y/up, -Z/front.
    const nativeUV = [wrap(Math.atan2(direction.x, -direction.z) / (2 * Math.PI) + .5),
        .5 - Math.asin(Math.max(-1, Math.min(1, direction.y))) / Math.PI];
    const webUV = project(horizontal, vertical, {
        orientation, width: 1600, height: 900, fov: Math.PI / 3
    });
    near(Math.min(Math.abs(nativeUV[0] - webUV[0]), 1 - Math.abs(nativeUV[0] - webUV[0])), 0, 'native/world horizontal direction');
    near(webUV[1], nativeUV[1], 'native/world vertical direction');
    return { direction, uv: webUV };
}
const axes = [
    { name: 'front', yaw: 0, pitch: 0, direction: [0, 0, -1], uv: [.5, .5] },
    { name: 'right', yaw: Math.PI / 2, pitch: 0, direction: [1, 0, 0], uv: [.75, .5] },
    { name: 'left', yaw: -Math.PI / 2, pitch: 0, direction: [-1, 0, 0], uv: [.25, .5] },
    { name: 'rear', yaw: Math.PI, pitch: 0, direction: [0, 0, 1], uv: [0, .5] },
    { name: 'up', yaw: 0, pitch: Math.PI / 2, direction: [0, 1, 0], uv: [null, 0] },
    { name: 'down', yaw: 0, pitch: -Math.PI / 2, direction: [0, -1, 0], uv: [null, 1] }
];
for (const axis of axes) {
    const actual = verifyPose(axis.yaw, axis.pitch, 0, 0, 0);
    axis.direction.forEach((value, index) => near(actual.direction.getComponent(index), value, axis.name + ' Three ray'));
    if (axis.uv[0] !== null) near(actual.uv[0], axis.uv[0], axis.name + ' U');
    near(actual.uv[1], axis.uv[1], axis.name + ' V');
}
for (const yaw of [-2.6, -.7, 0, .9, 2.3]) for (const pitch of [-.8, .1, .9]) {
    for (const roll of [-.5, .35]) for (const x of [-.8, 0, .7]) for (const y of [-.5, .3]) {
        verifyPose(yaw, pitch, roll, x, y);
    }
}
// Existing per-layer orientation is texture -> navigation. Its inverse must be applied once.
const turn = context.orientationFromYawPitch(Math.PI / 2, 0);
const local = multiply(context.quatConjugate(turn), turn);
const centered = project(0, 0, { orientation: turn, width: 1600, height: 900, fov: 1 }, local);
near(centered[0], .5, 'matching view and panorama orientation center the original source front');
const identityForward = rotate(local, [0, 0, 1]);
near(identityForward[2], 1, 'orientation inverse cancels exactly');

// Blender default glTF Y-up export maps original (x,y,z) -> (x,z,-y).
// NASA source is already physically Y-up: either export_yup=False, or explicitly undo this.
const exportBasis = new T.Matrix4().makeRotationX(-Math.PI / 2);
const undoExport = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI / 2);
const sourceObserver = new T.Vector3(0, 98, -18.5), lifeOffset = new T.Vector3(0, -96.32, 8.55);
const restored = sourceObserver.clone().applyMatrix4(exportBasis).applyQuaternion(undoExport).add(lifeOffset);
[0, 1.68, -9.95].forEach((value, index) => near(restored.getComponent(index), value, 'NASA explicit glTF basis correction'));
const wrong = sourceObserver.clone().applyMatrix4(exportBasis).add(lifeOffset);
assert(wrong.distanceTo(restored) > 100, 'translation alone cannot compensate default Blender glTF axis conversion');

// Optional real render evidence from the current NASA review, without making the test depend on ignored files.
const calibration = path.join(root, '.render-work/nasa-original-views-20260927/r2/axis-calibration.json');
if (fs.existsSync(calibration)) {
    const report = JSON.parse(fs.readFileSync(calibration, 'utf8'));
    assert(report.passed && report.samples.every(sample => sample.passed), 'actual NASA r2 marker pixels must pass');
    const labels = {
        'three-positive-x-east': [.75, .5], 'three-negative-x-west': [.25, .5],
        'three-negative-z-front': [.5, .5], 'three-positive-z-back': [0, .5],
        'three-positive-y-up': [.5, 0], 'three-negative-y-down': [.5, 1]
    };
    for (const sample of report.samples) if (labels[sample.name]) {
        assert.deepEqual(sample.expected_top_origin_uv, labels[sample.name]);
    }
}
console.log('Panorama direction validation passed: actual runtime camera conversion, six axes, yaw/pitch/roll/off-center rays, layer orientation, NASA glTF export basis, and available rendered calibration.');
