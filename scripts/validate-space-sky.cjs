'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = {
  window: { NightWorld: { ready: true, currentId: 'spaceship', mode: 'observe', skyPointVisible: () => true } },
  GEOMETRIC_HORIZON_EPSILON: .00001, DEG: Math.PI / 180, INITIAL_CAMERA: { yaw: 0 }, MIN_CAMERA_ALTITUDE: .005,
  celestialBodies: [{ id: 'sun', current: { altitude: 40, direction: [0,.64,.77] } }],
  state: { scene: 'roam', focusedPortal: null, hoverPortal: null }, COARSE_POINTER: false,
  hitAreaIntersectsViewport: projected => Boolean(projected?.visible), usesCompactSkyLayout: () => false,
  setFocusedPortal() {}, skyModel: { available: false }
};
vm.createContext(context);
for (const file of ['03-math-orientation.js', '05-astronomy.js', '12-detail-navigation.js']) vm.runInContext(fs.readFileSync(path.join(root, 'assets/life/scripts', file), 'utf8'), context, { filename: file });
context.usesCompactSkyLayout = () => false;
const button = () => ({ hidden: true, inert: true, style: {}, classList: { toggle() {} } });
const below = [0,-1,0], brightMagnitude = 1, observed = { x: 400, y: 300, visible: true };
for (const mode of ['observe','explore']) {
  context.window.NightWorld.mode = mode;
  assert(context.isAboveHorizon(below), `${mode}: lower hemisphere must be accessible in space`);
  assert.equal(context.naturalStarVisibilityAtDirection(below, brightMagnitude),1,`${mode}: bright lower-hemisphere star must remain visible without atmosphere`);
  const downward = context.orientationFromYawPitch(0,-Math.PI/3), constrained = context.constrainOrientationAboveHorizon(downward);
  assert(context.quatRotate(constrained,[0,0,1])[1]<-.8,`${mode}: detail framing must preserve downward view`);
  assert.equal(context.skyRenderingParameters().daylight,0,`${mode}: terrestrial daytime cannot suppress space stars`);
  const portal = { direction: below, skyVisibility: 1, button: button() };
  context.updatePortalButton(portal, observed);
  assert(!portal.button.hidden && !portal.button.inert,`${mode}: lower-hemisphere constellation portal must be clickable`);
  context.state.scene = 'detail'; context.state.activePortal = portal;
  assert(!context.skyHasHorizon(),`${mode}: detail must retain the ship's horizon-free projection`);
  portal.starButtons = new Map([[42,button()]]); portal.starButtonScreens = new Map();
  context.updateStarButtonPosition(portal,42,observed,below);
  assert(!portal.starButtons.get(42).hidden,`${mode}: lower-hemisphere detail star must be clickable`);
  const moon = { angularDisc:true,visibilityModel:'moon',current:{direction:below,altitude:-70,magnitude:-12} };
  context.classifyCelestialVisibility(moon,40);
  assert(moon.current.aboveHorizon && moon.current.nakedEyeVisible,`${mode}: lower-hemisphere celestial must remain observable`);
  context.state.scene = 'roam';
}
for (const setting of [{currentId:'spaceship',mode:'sky'},{currentId:'shelter',mode:'observe'},{currentId:'hogwarts',mode:'explore'}]) {
  Object.assign(context.window.NightWorld,setting);
  assert(!context.isAboveHorizon(below),'terrestrial sky must keep its geometric horizon');
  assert.equal(context.naturalStarVisibilityAtDirection(below,brightMagnitude),0,'terrestrial lower-hemisphere stars must stay hidden');
  const portal={direction:below,skyVisibility:1,button:button()};context.updatePortalButton(portal,observed);assert(portal.button.hidden,'terrestrial lower-hemisphere portal must be hidden');
}
const shader=fs.readFileSync(path.join(root,'assets/life/scripts/07-galaxy-renderer.js'),'utf8');
assert(shader.includes('max(0.0, (airmass - 1.0) * 0.2) * (1.0 - uSpace)'),'space star shader must bypass atmospheric extinction');
assert(/float horizonVisibility = mix\(smoothstep\([\s\S]*?\), 1\.0, uSpace\);/.test(shader),'space star shader must bypass the horizon');
assert(shader.includes('gl.uniform1f(this.starLocations.space, skyHasHorizon() ? 0 : 1)'),'star shader space state must follow CPU guards');
console.log('Space sky validation passed (lower-hemisphere portals, stars, celestial bodies, detail framing and shader/CPU parity).');
