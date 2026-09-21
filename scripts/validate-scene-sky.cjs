const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = {
    window: { document: { body: { dataset: {} } } },
    console,
    Date,
    skyModel: { location: { latitude: 31.23, longitude: 121.47, height: 0 }, nextRefreshAt: 42 },
    celestialBodies: []
};
vm.createContext(context);
for (const filename of ['assets/vendor/astronomy-engine-2.1.19.min.js', 'assets/life/scripts/05-astronomy.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
}

const astronomy = context.window.Astronomy;
const sky = context.window.SceneSky;
const reference = new Date('2026-12-21T16:00:00Z');
assert.equal(sky.mode, 'live');
assert.equal(+sky.observationDate(reference), +reference);
assert.equal(sky.setMode('missing'), false);
assert.equal(sky.mode, 'live');
assert.equal(sky.setMode('day'), true);
assert.equal(sky.mode, 'clear');
assert.equal(context.skyModel.nextRefreshAt, 0);
assert.equal(context.window.document.body.dataset.skyMode, 'clear');
assert.throws(() => sky.observationDate('not-a-date'), /valid sky observation date/);

let cases = 0;
for (const latitude of [-89, -75, -31.23, 0, 31.23, 75, 89]) {
    for (const longitude of [-170, 0, 121.47, 170]) {
        context.skyModel.location = { latitude, longitude, height: 0 };
        for (const mode of ['night', 'clear', 'dusk']) {
            sky.setMode(mode);
            const date = sky.observationDate(reference);
            assert(Number.isFinite(+date), `${mode}: date must remain valid`);
            const observer = new astronomy.Observer(latitude, longitude, 0);
            const equatorial = astronomy.Equator('Sun', date, observer, true, true);
            const altitude = astronomy.Horizon(date, observer, equatorial.ra, equatorial.dec, 'normal').altitude;
            if (mode === 'night') assert.equal(+date, +reference, 'night must preserve the runtime-selected observation');
            if (mode === 'clear') assert(altitude > 17, `clear sky must retain daylight at ${latitude}/${longitude}`);
            if (mode === 'dusk') assert(altitude > 0 && altitude < 2, `dusk must retain low evening Sun at ${latitude}/${longitude}`);
            const timestamp = +date;
            date.setUTCFullYear(2001);
            assert.equal(+sky.observationDate(reference), timestamp, 'returned dates must not mutate the observation cache');
            cases += 1;
        }
    }
}

context.celestialBodies.push({ id: 'sun', current: { altitude: 22, direction: [0.5, 0.3, 0.8] } });
context.skyModel.date = reference;
const snapshot = sky.snapshot();
snapshot.sunDirection[0] = 100;
assert.equal(sky.snapshot().sunDirection[0], 0.5, 'presentation snapshots must not mutate astronomy directions');
assert.equal(sky.snapshot().observationDate, reference.toISOString());
assert(sky.snapshot().cloudCoverage > 0 && sky.snapshot().haze > 0);
const locationBefore = JSON.stringify(context.skyModel.location);
const dateBefore = +sky.observationDate(reference);
const calibration = { kind: 'art-direction-calibration', coordinateSystem: 'sky-y-up-plus-z', sunDirection: [0, 3, 4] };
assert.equal(sky.setAlignment(calibration), true);
calibration.sunDirection[0] = 20;
assert.equal(sky.snapshot().sunDirection[0], 0, 'calibration must copy input vectors');
assert(Math.abs(sky.snapshot().sunAltitude - 36.86989764584402) < 1e-10);
assert.equal(sky.snapshot().sunDirection[1], .6);
assert.equal(context.celestialSceneDirection(context.celestialBodies[0])[1], .6);
assert.equal(context.celestialSceneSunAltitude(), sky.snapshot().sunAltitude);
sky.snapshot().alignment.sunDirection[1] = -1;
sky.calibratedSunDirection[1] = -1;
assert.equal(sky.snapshot().sunDirection[1], .6, 'returned calibration vectors must not mutate presentation state');
assert.equal(context.celestialBodies[0].current.direction[0], .5, 'calibration must not change astronomical coordinates');
assert.equal(context.celestialBodies[0].current.altitude, 22);
assert.equal(JSON.stringify(context.skyModel.location), locationBefore, 'calibration must not overwrite the user observer');
assert.equal(+sky.observationDate(reference), dateBefore, 'calibration is not a fabricated capture epoch');
for (const value of [undefined, {}, { ...calibration, coordinateSystem: 'wrong' }, { ...calibration, sunDirection: [0,0,0] }, { ...calibration, sunDirection: [0,Infinity,0] }, { ...calibration, sunDirection: [0,1] }]) assert.equal(sky.setAlignment(value), false);
assert.equal(sky.snapshot().sunDirection[1], .6, 'invalid metadata must not alter valid alignment');
assert.equal(sky.setAlignment(null), true);
assert.equal(sky.snapshot().alignment, null);
assert.equal(sky.snapshot().sunAltitude, 22);
assert.equal(context.celestialSceneDirection(context.celestialBodies[0])[0], .5);
console.log(`Scene sky validation passed (${cases} fixed-observation cases; cache isolation, aliases, calibration and immutable astronomy).`);
