#!/usr/bin/env node
/*
 * Regression checks for the seven environment builders.  This deliberately
 * runs without a browser/WebGL context: Three's real math and geometry classes
 * catch malformed transforms while small scene-specific assertions catch the
 * easy-to-miss exploration regressions.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
global.window = global;
global.THREE = require(path.join(root, 'assets', 'vendor', 'three-0.160.1.min.js'));
global.document = {
  createElement(type) {
    if (type !== 'canvas') return { style: {}, setAttribute() {} };
    return {
      width: 768, height: 128,
      getContext() { return { fillText() {}, measureText() { return { width: 0 }; } }; }
    };
  }
};
global.window.document = global.document;

function load(file) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
load('assets/life/scripts/19-world-kit.js');
load('assets/life/scripts/21-world-outdoors.js');
load('assets/life/scripts/22-world-interiors.js');

const builders = window.NightWorldBuilders;
const ids = ['transit', 'lakeshore', 'observatory', 'spaceship', 'train', 'room', 'loop'];
assert.deepEqual(Object.keys(builders).sort(), ids.slice().sort(), 'all seven builders must be registered');

function finiteWorld(world, id) {
  assert(world?.group?.isGroup, `${id}: builder must return a THREE.Group`);
  assert.equal(world.spawn.length, 3, `${id}: spawn must be xyz`);
  assert(world.spawn.every(Number.isFinite), `${id}: spawn must be finite`);
  world.group.updateMatrixWorld(true);
  const seenGeometry = new Set();
  world.group.traverse(object => {
    assert(object.matrixWorld.elements.every(Number.isFinite), `${id}: non-finite ${object.type} transform`);
    if(object.geometry && !seenGeometry.has(object.geometry)) {
      seenGeometry.add(object.geometry);
      const position=object.geometry.getAttribute('position');
      assert(!position || [...position.array].every(Number.isFinite), `${id}: non-finite geometry vertex`);
    }
  });
  assert(world.colliders.every(c => [c.x, c.z, c.w, c.d].every(Number.isFinite)), `${id}: non-finite collider`);
  assert(world.interactions.length > 0, `${id}: environment needs at least one interaction`);
  assert(world.interactions.every(item => item.position?.every(Number.isFinite)), `${id}: non-finite interaction`);
}

function blocked(world, x, z) {
  return world.colliders.some(c => c.enabled !== false &&
    Math.abs(x - c.x) < c.w / 2 + .25 && Math.abs(z - c.z) < c.d / 2 + .25);
}

for (const id of ids) {
  let world = builders[id](window.NightWorldKit);
  finiteWorld(world, id);
  assert(!blocked(world, world.spawn[0], world.spawn[2]), `${id}: spawn is inside a collider`);
  world.player = { x: world.spawn[0], y: world.spawn[1], z: world.spawn[2], distance: 0 };
  const beforeChildren = world.group.children.length;
  world.update(0, 0, world.player);
  world.update(.016, .25, world.player);

  for (const item of world.interactions) {
    assert.equal(typeof item.action, 'function', `${id}/${item.id}: action must be callable`);
    // Actions are intentionally scene-local; invoking them must not throw or
    // introduce NaN state even when the player starts at the scene spawn.
    const result = item.action.call(world);
    assert(result != null, `${id}/${item.id}: action needs a user-facing result`);
    world.update(.016, .5, world.player);
  }
  finiteWorld(world, id);
  window.NightWorldKit.disposeGroup(world.group);
  assert.equal(world.group.children.length, 0, `${id}: dispose must clear the scene group`);
  world = builders[id](window.NightWorldKit);
  world.player = { x: world.spawn[0], y: world.spawn[1], z: world.spawn[2], distance: 0 };

  if (id === 'lakeshore') {
    assert(blocked(world, 0, -25), 'lakeshore: water must not be walkable');
    assert(!blocked(world, -19, -25), 'lakeshore: dock approach must remain walkable');
  }
  if (id === 'observatory') {
    assert(!blocked(world, 4, -5), 'observatory: telescope area must remain reachable');
  }
  if (id === 'train') {
    const doors = world.interactions.find(item => item.id === 'train-door');
    const state = world.train;
    doors.action.call(world);
    for (let i = 0; i < 80; i++) world.update(.016, i * .016, world.player);
    assert(state.door > .8, 'train: doors should animate open with normal dt');
    assert(world.colliders.some(c => c.enabled === false), 'train: open doorway should disable its collider');
    Object.assign(world.player, { x: 2.43, z: 3 });
    doors.action.call(world);
    assert(state.open, 'train: doors must not close on a person in the doorway');
  }
  if (id === 'room') {
    const seat = world.interactions.find(item => item.id === 'balcony-bench');
    seat.action.call(world);
    assert.equal(world.player.y, 1.1, 'room: sitting should lower the player');
    world.player.x += .1;
    world.update(.016, 1, world.player);
    assert.equal(world.player.y, 1.68, 'room: moving should restore standing height');
  }
  if (id === 'loop') {
    const initialChildren = world.group.children.length;
    for (let i = 0; i < 30; i++) {
      world.player.z = -90; world._cooldown = 0;
      world.update(.05, i, world.player);
      assert.equal(world.group.children.length, initialChildren, 'loop: crossing must not leak props');
    }
    world.player.z = -90; world._cooldown = 0; world.update(.05, 31, world.player);
    const bell = world.interactions.find(item => item.id === 'loop-bell');
    assert.equal(bell.position[0], 41, 'loop: interaction must follow phase-one bell');
    assert.equal(bell.position[2], -29, 'loop: interaction must follow phase-one bell');
  }
  if (id === 'spaceship' || id === 'room') {
    const lights = []; world.group.traverse(object => { if(object.isPointLight) lights.push(object); });
    const original = lights.map(light => light.intensity);
    const action = world.interactions.find(item => item.id === (id === 'spaceship' ? 'cabin-lights' : 'reading-light'));
    action.action.call(world);
    assert(lights.some((light, i) => light.intensity < original[i]), `${id}: light switch must affect real lights`);
    action.action.call(world);
    assert(lights.every((light, i) => light.intensity === original[i]), `${id}: light switch must restore exact brightness`);
  }
  assert.equal(world.group.children.length, beforeChildren, `${id}: updates must not add scene children`);
  const shared = new Set(), owned = new Set(), disposed = new Set();
  world.group.traverse(object => {
    for(const resource of [object.geometry, ...(Array.isArray(object.material) ? object.material : [object.material])]) {
      if(!resource) continue;
      (resource.userData.shared ? shared : owned).add(resource);
      resource.addEventListener('dispose', () => disposed.add(resource));
    }
  });
  window.NightWorldKit.disposeGroup(world.group);
  assert.equal(world.group.children.length, 0, `${id}: dispose must clear the scene group`);
  assert([...owned].every(resource => disposed.has(resource)), `${id}: owned geometry/materials must be disposed`);
  assert([...shared].every(resource => !disposed.has(resource)), `${id}: shared geometry/materials must survive disposal`);
}

// Run the actual runtime with a narrow browser facade. Rendering is mocked;
// cameras, raycasts, matrices, geometry and quaternion helpers remain real.
function runtimeChecks() {
  const eventSurface = target => {
    const handlers = new Map();
    target.addEventListener = (type, fn) => { if(!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); };
    target.dispatchEvent = event => { for(const fn of handlers.get(event.type) || []) fn(event); return true; };
    return target;
  };
  const element = () => eventSurface({ style: {}, inert: false, disabled: false, classList: {
    values: new Set(), add(...names) { names.forEach(name=>this.values.add(name)); },
    remove(...names) { names.forEach(name=>this.values.delete(name)); },
    contains(name) { return this.values.has(name); },
    toggle(name, value) { if(value ?? !this.values.has(name)) this.values.add(name); else this.values.delete(name); }
  }});
  const canvas = element(), body = element(), documentMock = eventSurface({
    body, hidden:false, readyState:'complete', pointerLockElement:null,
    createElement: document.createElement, getElementById: () => canvas,
    exitPointerLock() { this.pointerLockElement = null; }
  });
  global.document = documentMock; eventSurface(global);
  global.innerWidth=1440;global.innerHeight=900;global.devicePixelRatio=1;
  global.localStorage={getItem(){return null;},setItem(){}};
  global.CustomEvent=class { constructor(type, options={}) { this.type=type;this.detail=options.detail; } };
  Object.assign(global, {
    COARSE_POINTER:false,REDUCED_MOTION:false,DEG:Math.PI/180,MIN_CAMERA_ALTITUDE:.005,INITIAL_CAMERA:{yaw:0},
    state:{scene:'roam',hasEntered:true,currentLang:'en',modalOpen:false,gateOpen:false,altHeld:false,lockRequestToken:0},
    camera:{orientation:[0,0,0,1],targetOrientation:[0,0,0,1],lastStableYaw:0,fov:1,targetFov:1},
    skyModel:{location:{longitude:0}},
    dom:{body,world:element(),portalNav:element(),celestialNav:element(),starNav:element(),sectionDrawerToggle:element(),entryTrigger:element()},
    refreshAstronomicalSky(){},updateEntryLocationCopy(){},syncSectionDrawerAvailability(){},
    isInteractiveKeyTarget: target=>Boolean(target?.isInteractive),
    hideEntryGate(){state.gateOpen=false;},setGateState(value){state.gateOpen=value;},
    settleUnlockedView(){},
    clearCameraRoll(){const p=decomposeYawPitchRoll(camera.targetOrientation,0);camera.targetOrientation=orientationFromYawPitch(p.yaw,p.pitch);}
  });
  load('assets/life/scripts/03-math-orientation.js');
  const RealRenderer=THREE.WebGLRenderer;
  let lastView;
  THREE.WebGLRenderer=class {
    constructor(options){this.domElement=options.canvas;this.shadowMap={};}
    setClearColor(){} setPixelRatio(){} setSize(){}
    render(scene,view){scene.updateMatrixWorld(true);lastView=view;}
  };
  try {
    load('assets/life/scripts/20-world-runtime.js');
    const api=window.NightWorld;
    assert(api.ready,`runtime failed to initialize: ${api.error}`);
    let time=0;
    const frames=(count=20)=>{for(let i=0;i<count;i++){time+=50;camera.orientation=camera.targetOrientation.slice();api.tick(time);}};
    const key=(code,up=false,target=null)=>{
      const event={type:up?'keyup':'keydown',code,target,repeat:false,preventDefault(){},stopImmediatePropagation(){}};
      (up?global:document).dispatchEvent(event);
    };
    for(const id of ids){assert(api.select(id),`runtime could not select ${id}`);frames(2);finiteWorld(api.world,id);}
    api.select('transit');frames(2);
    const start=api.player.z;
    key('KeyW');frames();key('KeyW',true);api.clearInput();
    assert(api.player.z<start-2,'runtime: W must move forward');
    const before={...api.player};
    key('KeyW',false,{isInteractive:true});frames(5);
    assert.equal(api.player.z,before.z,'runtime: form controls must not initiate movement');
    for(const flag of ['modalOpen','gateOpen','altHeld']){
      state[flag]=true;api.setMotion(1,0);frames(5);assert.equal(api.player.z,before.z,`runtime: ${flag} must freeze movement`);state[flag]=false;api.clearInput();
    }
    document.hidden=true;api.setMotion(1,0);frames(5);assert.equal(api.player.z,before.z,'runtime: hidden page must freeze movement');document.hidden=false;api.clearInput();
    const inertNodes=[dom.world,dom.portalNav,dom.celestialNav,dom.starNav,dom.sectionDrawerToggle];
    dom.portalNav.inert=true;
    const inertBefore=inertNodes.map(node=>node.inert);
    key('KeyW');document.dispatchEvent(new CustomEvent('nightworld:menu',{detail:{open:true}}));
    assert(inertNodes.every(node=>node.inert),'runtime: open chooser must make scene controls inert');
    frames(5);assert.equal(api.player.z,before.z,'runtime: chooser must clear held movement');
    document.dispatchEvent(new CustomEvent('nightworld:menu',{detail:{open:false}}));
    assert.deepEqual(inertNodes.map(node=>node.inert),inertBefore,'runtime: chooser must restore prior inert values');
    assert.equal(state.modalOpen,false,'runtime: chooser close must restore modal state');
    api.setViewMode('sky');api.setMotion(1,0);frames(5);
    assert.equal(api.player.z,before.z,'runtime: sky-only mode must not move the player');
    assert.equal(canvas.style.visibility,'hidden','runtime: sky-only mode must hide the environment');
    assert(api.skyPointVisible(720,450),'runtime: sky-only mode must not occlude sky targets');
    api.setViewMode('explore');api.clearInput();

    // Functional transitions must continue with reduced ambient motion.
    global.REDUCED_MOTION=true;api.select('train');
    api.world.interactions.find(item=>item.id==='train-door').action();frames(45);
    assert(api.world.train.door>.99,'runtime: reduced motion must not freeze an opening door');
    api.select('room');
    const curtains=api.world.group.children.filter(object=>object.isGroup&&object.userData.curtain);
    assert.equal(curtains.length,2,'runtime fixture: both curtain panels must be present');
    api.world.interactions.find(item=>item.id==='curtains').action();frames(35);
    assert(curtains.every(panel=>panel.scale.x>3),'runtime: reduced motion must not freeze closing curtains');
    global.REDUCED_MOTION=false;

    api.select('spaceship');frames(2);
    const ship=api.world,pilot=ship.pilot;
    ship.interactions.find(item=>item.id==='pilot-seat').action();
    api.setMotion(1,0);frames(60);api.clearInput();
    assert(pilot.speed>20,'runtime: pilot thrust must increase speed');
    assert(ship.flight.position.length()>20,'runtime: flight must change spatial position');
    const positionBeforeTurn=ship.flight.position.clone();
    key('KeyD');key('KeyQ');frames(15);key('KeyD',true);key('KeyQ',true);api.clearInput();
    assert(Math.abs(ship.flight.orientation[1])>.01,'runtime: yaw must affect ship orientation');
    assert(Math.abs(ship.flight.orientation[2])>.01,'runtime: roll must affect ship orientation');
    assert(ship.flight.position.distanceTo(positionBeforeTurn)>1,'runtime: vessel should keep translating while turning');
    finiteWorld(ship,'piloted spaceship');
    key('KeyF');frames(2);
    assert(!pilot.active,'runtime: F must leave the helm');
    assert.deepEqual([api.player.x,api.player.y,api.player.z],pilot.exit,'runtime: exiting helm must restore local cabin position');
    const expectedView=new THREE.Vector3(api.player.x,api.player.y,api.player.z).applyQuaternion(ship.group.quaternion).add(ship.flight.position);
    assert(lastView.position.distanceTo(expectedView)<1e-7,'runtime: cabin camera must follow ship transform');
    api.reset();frames(2);
    assert.equal(ship.flight.position.length(),0,'runtime: arrival reset must reset ship translation');
    assert.deepEqual([api.player.x,api.player.y,api.player.z],ship.spawn,'runtime: arrival reset must restore spawn');
    const exterior=ship.flight.exterior;api.select('room');
    assert.equal(exterior.children.length,0,'runtime: scene switch must dispose exterior flight objects');
    frames(2);
  } finally { THREE.WebGLRenderer=RealRenderer; }
}

function nightDateChecks() {
  const astronomy = require(path.join(root, 'assets/vendor/astronomy-engine-2.1.19.min.js'));
  const source = fs.readFileSync(path.join(root, 'assets/life/scripts/20-world-runtime.js'), 'utf8').replace(/\r\n?/g, '\n');
  const method = source.match(/        skyDate\(\) \{[\s\S]*?\n        \},/);
  assert(method, 'runtime: permanent-night method must be extractable');
  let calculations = 0;
  const context = {
    Date, startedAt: 0, nightDateCache: new Map(), skyModel: {location: {}},
    Astronomy: {...astronomy, Equator(...args) { calculations++; return astronomy.Equator(...args); }}
  };
  const skyDate = vm.runInNewContext(`({${method[0]}}).skyDate`, context);
  const altitude = (date, location) => {
    const observer = new astronomy.Observer(location.latitude, location.longitude, 0);
    const equatorial = astronomy.Equator('Sun', date, observer, true, true);
    return astronomy.Horizon(date, observer, equatorial.ra, equatorial.dec, 'normal').altitude;
  };
  let cases = 0;
  for (const visit of ['2026-03-20', '2026-06-21', '2026-09-07', '2026-12-21']) {
    context.startedAt = Date.parse(visit + 'T12:00:00Z');
    const start = new Date(context.startedAt);
    for (const latitude of [-90, -80, -70, -60, 0, 31.2304, 60, 70, 80, 90]) {
      for (const longitude of [-170, 0, 121.4737, 170]) {
        const location = {latitude, longitude, height: 0};
        context.skyModel.location = location;
        const normalMidnight = new Date(Date.UTC(2026, start.getUTCMonth(), start.getUTCDate(), 24) - longitude / 15 * 3600000);
        const originalAltitude = altitude(normalMidnight, location);
        const selected = skyDate();
        assert(altitude(selected, location) <= -18, `permanent night: ${visit}, ${latitude}/${longitude} remains twilight or daylight`);
        if (originalAltitude <= -18) assert.equal(+selected, +normalMidnight, 'permanent night: normal visit-date skies must be preserved');
        else {
          const winter = latitude < 0 ? astronomy.Seasons(2026).jun_solstice.date : astronomy.Seasons(2026).dec_solstice.date;
          const expected = Date.UTC(2026, winter.getUTCMonth(), winter.getUTCDate(), 24) - longitude / 15 * 3600000;
          assert.equal(+selected, expected, 'permanent night: polar/twilight fallback must use same-year winter-solstice midnight');
        }
        const before = calculations;
        assert.equal(+skyDate(), +selected, 'permanent night: observation time must stay fixed');
        assert.equal(calculations, before, 'permanent night: repeated calls must use the observation cache');
        const selectedTimestamp = +selected;
        selected.setUTCFullYear(2000);
        assert.equal(+skyDate(), selectedTimestamp, 'permanent night: returned Date mutation must not corrupt the cached timestamp');
        cases++;
      }
    }
  }
  delete context.Astronomy;
  context.nightDateCache.clear();
  assert(Number.isFinite(+skyDate()), 'permanent night: missing Astronomy must retain the ordinary-midnight fallback');
  return cases;
}

async function modelLifecycleChecks() {
  const requests=[];
  const isolated={window:{THREE,NightGLTFLoader:class {
    loadAsync(url){return new Promise((resolve,reject)=>requests.push({url,resolve,reject}));}
  }},console:{warn(){}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'assets/life/scripts/19-world-kit.js'),'utf8'),isolated);
  const kit=isolated.window.NightWorldKit,oldGroup=new THREE.Group(),newGroup=new THREE.Group();
  let staleCallbacks=0,activeCallbacks=0;
  const stale=kit.model(oldGroup,'fixture',0,0,0,{onLoad(){staleCallbacks++;}});
  const active=kit.model(newGroup,'fixture',0,0,0,{onLoad(){activeCallbacks++;}});
  assert.equal(requests.length,1,'models: simultaneous instances must share one request');
  kit.disposeGroup(oldGroup);
  const source=new THREE.Group(),sourceGeometry=new THREE.BoxGeometry(1,1,1);
  source.add(new THREE.Mesh(sourceGeometry,new THREE.MeshStandardMaterial()));
  requests[0].resolve({scene:source});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stale.children.length,0,'models: disposed holders must reject late attachments');
  assert.equal(staleCallbacks,0,'models: disposed holders must not run callbacks');
  assert.equal(active.children.length,1,'models: active holders must receive the shared asset');
  assert.equal(activeCallbacks,1,'models: active callback must run once');
  let sharedDisposals=0;sourceGeometry.addEventListener('dispose',()=>sharedDisposals++);
  kit.disposeGroup(newGroup);
  assert.equal(sharedDisposals,0,'models: shared source geometry must survive instance disposal');
  kit.model(new THREE.Group(),'retry',0,0,0);
  requests[1].reject(new Error('Transient model download failure'));
  await new Promise(resolve=>setImmediate(resolve));
  kit.model(new THREE.Group(),'retry',0,0,0);
  assert.equal(requests.length,3,'models: failed downloads must retry on revisit');
  requests[2].resolve({scene:source});
  const benchGroup=new THREE.Group(),bench=kit.bench(benchGroup,2,3,.4);
  requests[3].resolve({scene:source});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(benchGroup.children.length,1,'models: loaded bench must stay inside the returned transform');
  assert.equal(bench.children[0].visible,false,'models: loaded bench must hide its fallback');
  bench.position.set(5,0,-4);bench.rotation.y=1.2;benchGroup.updateMatrixWorld(true);
  const loadedPosition=bench.children[1].getWorldPosition(new THREE.Vector3());
  assert(Math.abs(loadedPosition.x-5)<1e-8&&Math.abs(loadedPosition.z+4)<1e-8,'models: moving a bench must also move its loaded model');
  kit.disposeGroup(benchGroup);
}

(async()=>{
  const nightCases = nightDateChecks();
  runtimeChecks();
  await modelLifecycleChecks();
  console.log(`Night world validation passed (${ids.length} builders; geometry, collision, actions, disposal, menu/input, reduced motion, flight, async models; ${nightCases} permanent-night observer cases).`);
})().catch(error=>{console.error(error);process.exitCode=1;});
