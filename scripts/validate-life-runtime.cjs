const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const lifePath = path.join(root, 'life.html');
const indexPath = path.join(root, 'index.html');
const astronomyPath = path.join(
    root,
    'assets',
    'vendor',
    'astronomy-engine-2.1.19.min.js'
);
const life = fs.readFileSync(lifePath, 'utf8');
const index = fs.readFileSync(indexPath, 'utf8');

function inlineScripts(html) {
    return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
        .map(match => match[1])
        .filter(source => source.trim());
}

for (const [file, html] of [['index.html', index], ['life.html', life]]) {
    for (const [scriptIndex, source] of inlineScripts(html).entries()) {
        assert.doesNotThrow(
            () => new Function(source),
            `${file} inline script ${scriptIndex} must parse`
        );
    }
}
for (const [styleIndex, style] of [
    ...life.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)
].map((match, index) => [index, match[1]])) {
    const openings = (style.match(/\{/g) || []).length;
    const closings = (style.match(/\}/g) || []).length;
    assert.equal(openings, closings, `life.html style block ${styleIndex} braces`);
}

const domBlock = life.match(/const dom = \{([\s\S]*?)\n\};/);
assert(domBlock, 'life.html must declare its DOM registry');
const declaredDomKeys = new Set(
    [...domBlock[1].matchAll(/^\s*([A-Za-z_$][\w$]*):/gm)]
        .map(match => match[1])
);
const usedDomKeys = new Set(
    [...life.matchAll(/\bdom\.([A-Za-z_$][\w$]*)/g)]
        .map(match => match[1])
);
const missingDomKeys = [...usedDomKeys].filter(key => !declaredDomKeys.has(key));
assert.deepEqual(missingDomKeys, [], `Undeclared dom keys: ${missingDomKeys.join(', ')}`);

const registeredIds = [
    ...domBlock[1].matchAll(/getElementById\('([^']+)'\)/g)
].map(match => match[1]);
const htmlIds = new Set(
    [...life.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
);
const allHtmlIds = [...life.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(
    htmlIds.size,
    allHtmlIds.length,
    'life.html must not contain duplicate ids'
);
const missingIds = registeredIds.filter(id => !htmlIds.has(id));
assert.deepEqual(missingIds, [], `Missing HTML ids: ${missingIds.join(', ')}`);

assert(!/homeRouteIndex|home-route-index|home-route-button/.test(life));
for (const required of [
    'previewHomeRoute',
    'launchHomeRoute',
    'interstellarRouteFraming',
    'refreshAstronomicalSky',
    'startCelestialFlight',
    'beginCelestialReturn',
    'completeCelestialReturn',
    'celestialStageLayout',
    'drawMeteorShower',
    'updateEntryLocationCopy'
]) {
    assert(
        life.includes(`function ${required}`),
        `life.html must contain ${required}()`
    );
}
for (const required of [
    'quatConjugate',
    'orientationFromYawPitchRoll',
    'decomposeYawPitchRoll',
    'constrainOrientationAboveHorizon',
    'isAboveHorizon',
    'horizonScreenValue',
    'clipViewportToGround',
    'buildSectionDrawer',
    'openSectionDrawer',
    'closeSectionDrawer',
    'navigateFromSectionDrawer'
]) {
    assert(
        life.includes(`function ${required}`),
        `life.html must contain ${required}()`
    );
}
assert(
    /const MIN_CAMERA_ALTITUDE = 0\.25 \* DEG;/.test(life),
    'The camera center must keep a precise 0.25 degree clearance above the horizon'
);
assert(htmlIds.has('entryLocation'), 'The entry gate must explain the observing location');
assert(
    /aria-describedby="entryHint entryLocation"/.test(life),
    'The entry-gate location must participate in its accessible description'
);
assert(
    !/GEOMETRIC HORIZON · 0°|几何地平线 · 0°|幾何地平線 · 0°/.test(life),
    'The geometric-horizon text marker must stay removed'
);
assert(
    life.includes('Spes non confundit') &&
    life.includes('望德不叫人蒙羞') &&
    life.includes('Misericordiae Vultus') &&
    life.includes('慈悲面容'),
    'Both essays must expose their approved papal-bull titles'
);
for (const id of [
    'sectionDrawerToggle',
    'sectionDrawer',
    'sectionDrawerList',
    'sectionDrawerHome',
    'sectionDrawerClose'
]) {
    assert(htmlIds.has(id), `The section drawer must expose #${id}`);
}
const altRecovery = life.match(
    /function recoverMissingAltKeyup\(\) \{([\s\S]*?)\n\}/
);
assert(altRecovery);
assert(altRecovery[1].includes('restoreViewAfterAlt()'));
assert(!altRecovery[1].includes('showResumeGate'));
assert(
    /state\.altHeld && event\.key !== 'Alt' && !event\.altKey[\s\S]*?recoverMissingAltKeyup\(\)/.test(life),
    'A non-Alt keydown must recover a missing Alt keyup'
);
assert(
    /function scheduleGazeCopyClear\(\)[\s\S]*?580/.test(life),
    'Gaze copy must remain until its visual fade completes'
);
assert(
    !/<section class="home-route-preview"[^>]*aria-live/.test(life),
    'The route card must not nest a second live region'
);
assert(
    /id="portalPanel"[^>]*\sinert/.test(life) &&
    /id="celestialPanel"[^>]*\sinert/.test(life),
    'Closed detail panels must start inert'
);
assert(
    /startCelestialFlight\(profile, event\.detail === 0 \? 'keyboard' : 'pointer'\)/.test(life) &&
    /startPortalFlight\(portal, event\.detail === 0 \? 'keyboard' : 'pointer'\)/.test(life),
    'Synthetic keyboard clicks must retain their activation source'
);
assert(
    /function handleViewportResize\(\)/.test(life),
    'Viewport changes must have a testable flight-reframing path'
);
assert(
    /@media \(max-aspect-ratio: 3\/2\),\s*\(max-width: 1024px\) and \(max-aspect-ratio: 16\/9\)[\s\S]*?\.portal-panel,[\s\S]*?\.celestial-panel/.test(life) &&
    /const COMPACT_SKY_MAX_WIDTH = 1024;/.test(life) &&
    /const COMPACT_SKY_MAX_ASPECT = 3 \/ 2;/.test(life) &&
    /const COMPACT_SKY_NARROW_MAX_ASPECT = 16 \/ 9;/.test(life) &&
    /const SHORT_SKY_MAX_HEIGHT = 520;/.test(life) &&
    /const SHORT_SKY_MIN_ASPECT = 3 \/ 2;/.test(life) &&
    /@media \(max-height: 520px\) and \(min-aspect-ratio: 3\/2\)[\s\S]*?width: clamp\(180px, 34vw, 280px\)/.test(life) &&
    /@media \(max-width: 1024px\), \(max-aspect-ratio: 3\/2\)[\s\S]*?body\.route-preview-active \.portal-panel/.test(life),
    'CSS and camera logic must share the compact sky-panel breakpoint'
);
assert(!/\bid:\s*'earth'/.test(life), 'Earth must not be added as a selectable body');
const expectedCelestialIds = [
    'sun',
    'mercury',
    'venus',
    'mars',
    'jupiter',
    'saturn',
    'uranus',
    'neptune',
    'pluto'
];
for (const bodyId of expectedCelestialIds) {
    assert(
        life.includes(`id: '${bodyId}'`),
        `${bodyId} must be present in the live sky`
    );
}

const celestialAssetPaths = [
    'assets/celestial/sun.webp',
    'assets/celestial/mercury.webp',
    'assets/celestial/venus.webp',
    'assets/celestial/mars.webp',
    'assets/celestial/jupiter.webp',
    'assets/celestial/saturn.webp',
    'assets/celestial/uranus.webp',
    'assets/celestial/neptune.webp',
    'assets/celestial/pluto.webp',
    'assets/celestial/saturn-ring.png'
];
for (const assetPath of celestialAssetPaths) {
    const absolutePath = path.join(root, ...assetPath.split('/'));
    assert(fs.existsSync(absolutePath), `${assetPath} must exist locally`);
    assert(fs.statSync(absolutePath).size > 0, `${assetPath} must not be empty`);
}
const surfaceTextureReferences = [
    ...life.matchAll(/^\s*texture:\s*'(assets\/celestial\/[^']+)'/gm)
].map(match => match[1]);
assert.equal(
    surfaceTextureReferences.length,
    9,
    'Each selectable celestial body must declare exactly one local surface texture'
);
assert.deepEqual(
    new Set(surfaceTextureReferences),
    new Set(celestialAssetPaths.slice(0, 9)),
    'The nine celestial profiles must reference the expected local surface textures'
);
assert(
    life.includes("ringTexture: 'assets/celestial/saturn-ring.png'"),
    'Saturn must declare its local ring texture'
);
assert(
    !/<(?:img|source)\b[^>]*(?:src|srcset)=["'][^"']*assets\/celestial\//i.test(life),
    'Celestial textures must not be requested by first-screen HTML image elements'
);
assert(
    !/<link\b[^>]*(?:rel=["']preload["'][^>]*href=["'][^"']*assets\/celestial\/|href=["'][^"']*assets\/celestial\/[^>]*rel=["']preload["'])/i.test(life),
    'Celestial textures must not be preloaded on first screen'
);

assert(!/\bdrawRadius\b/.test(life), 'Distant bodies must not use illustrative drawRadius values');
const distantBodyRenderer = life.match(
    /function drawCelestialBodies\([^)]*\) \{([\s\S]*?)\n\}\n\nfunction orderedPortalNames/
);
assert(distantBodyRenderer, 'Could not extract the distant celestial renderer');
assert(
    !/\bellipse\s*\(/.test(distantBodyRenderer[1]) &&
    !/profile\.id\s*===\s*['"]saturn['"]/.test(distantBodyRenderer[1]),
    'Saturn must remain a point source in the distant naked-eye sky'
);
assert(
    !/time\s*\*\s*0\.00005/.test(life) &&
    !/for\s*\([^)]*index\s*<\s*8[^)]*\)[\s\S]{0,700}profile\.id\s*===\s*['"]sun['"]/.test(life),
    'The distant Sun must not use decorative radial rays'
);
assert(
    !/context\.arc\(\s*point\.x\s*-\s*radius\s*\*\s*0\.3[\s\S]{0,180}point\.y\s*-\s*radius\s*\*\s*0\.3/.test(life),
    'Distant bodies must not use the old fake specular highlight'
);
assert(
    /current\.nakedEyeVisible/.test(distantBodyRenderer[1]) &&
    /drawNakedEyePoint/.test(distantBodyRenderer[1]) &&
    /drawAngularSun/.test(distantBodyRenderer[1]) &&
    /drawObservationReticle/.test(distantBodyRenderer[1]),
    'The distant renderer must separate natural point sources from assisted finding reticles'
);

for (const mode of [
    'naked-eye',
    'marginal',
    'telescope',
    'daylight',
    'below-horizon'
]) {
    assert(
        life.includes(`'${mode}'`),
        `Celestial visibility classification must include ${mode}`
    );
}
const closeupRendererSource = life.match(
    /class CelestialCloseupRenderer \{([\s\S]*?)\n\}\n\nconst galaxyRenderer/
);
assert(closeupRendererSource, 'Could not extract the celestial close-up renderer');
assert(
    /uFlattening/.test(closeupRendererSource[1]) &&
    /polarRadius/.test(closeupRendererSource[1]) &&
    /profile\.flattening/.test(closeupRendererSource[1]),
    'The close-up renderer must apply each body’s physical flattening'
);
assert(
    /uLightView/.test(closeupRendererSource[1]) &&
    /terminator/.test(closeupRendererSource[1]) &&
    /incidence/.test(closeupRendererSource[1]) &&
    /profile\.current\?\.hc/.test(closeupRendererSource[1]),
    'The close-up renderer must light the visible phase from the current Sun direction'
);
assert(
    /Astronomy\.RotationAxis\(profile\.body,\s*skyModel\.time\)/.test(life) &&
    /bodyMatrices\(profile,\s*basis\)/.test(closeupRendererSource[1]) &&
    /current\?\.spin/.test(closeupRendererSource[1]) &&
    /current\?\.northEqj/.test(closeupRendererSource[1]),
    'Close-up body orientation must follow Astronomy.RotationAxis'
);
assert(
    /ring_tilt/.test(life) &&
    /ringDistance\s*<\s*sphereNear/.test(closeupRendererSource[1]) &&
    /ringOutsideBody/.test(closeupRendererSource[1]) &&
    /lightBody\s*=\s*normalize\(uViewToBody\s*\*\s*lightView\)/.test(
        closeupRendererSource[1]
    ) &&
    /ringShadowDistance/.test(closeupRendererSource[1]) &&
    /planetShadow/.test(closeupRendererSource[1]),
    'Saturn’s ring plane, lighting, tilt and front/back body occlusion must be modeled'
);
assert(
    /const paths = \[profile\.texture\]/.test(closeupRendererSource[1]) &&
    /if \(profile\.ringTexture\) paths\.push\(profile\.ringTexture\)/.test(closeupRendererSource[1]) &&
    /celestialCloseupRenderer\.prepare\(visit\.profile\)/.test(life) &&
    !/celestialBodies\.(?:forEach|map)\([\s\S]{0,240}(?:prepare|loadImage)/.test(life),
    'Only the selected celestial profile may prepare/load its surface resources'
);
assert(
    /if \(state\.scene === 'flying'\) \{[\s\S]{0,180}cancelFlight\('keyboard'\)/.test(life) &&
    /function cancelFlight\([^)]*\) \{[\s\S]{0,180}state\.celestialVisit[\s\S]{0,120}beginCelestialReturn/.test(life),
    'Escape during a celestial approach must begin the shared return path'
);

const galaxyRendererSource = life.match(
    /class GalaxyRenderer \{([\s\S]*?)\n\}\n\nfunction celestialStageLayout/
);
assert(galaxyRendererSource, 'Could not extract the Milky Way renderer');
const galaxySource = galaxyRendererSource[1];
assert(
    (galaxySource.match(/uniform vec3 uZenith;/g) || []).length >= 2 &&
    /uniform vec3 uSunDirection;/.test(galaxySource) &&
    /uniform float uSunAltitude;/.test(galaxySource) &&
    /uniform float uMagnitudeLimit;/.test(galaxySource),
    'The WebGL sky and star passes must receive horizon, Sun and limiting-magnitude state'
);
assert(
    /dot\(\s*ray\s*,\s*uZenith\s*\)/.test(galaxySource) &&
    /dot\(\s*aDirection\s*,\s*uZenith\s*\)/.test(galaxySource),
    'Both WebGL passes must classify directions against the real local horizon'
);
assert(
    /attribute float aMagnitude;/.test(galaxySource) &&
    /aMagnitude[\s\S]{0,320}uMagnitudeLimit|uMagnitudeLimit[\s\S]{0,320}aMagnitude/.test(
        galaxySource
    ),
    'Hipparcos star visibility must be filtered by apparent magnitude in the shader'
);
for (const uniform of [
    'uZenith',
    'uSunDirection',
    'uSunAltitude',
    'uMagnitudeLimit'
]) {
    assert(
        galaxySource.includes(`getUniformLocation(this.`) &&
        galaxySource.includes(`'${uniform}'`),
        `The renderer must bind ${uniform}`
    );
}
assert(
    /float\s+skyAltitude\s*=\s*clamp\(\s*sinAltitude\s*,\s*0\.0\s*,\s*1\.0\s*\)\s*;/.test(
        galaxySource
    ) &&
    /float\s+altitudeTone\s*=\s*pow\(\s*skyAltitude\s*,\s*0\.42\s*\)\s*;/.test(
        galaxySource
    ) &&
    /vec3\s+base\s*=\s*mix\([\s\S]{0,240}\baltitudeTone\s*\)\s*;/.test(
        galaxySource
    ),
    'Night-sky base color must use a real altitude-derived tone'
);
assert(
    /galaxy\s*\*=\s*smoothstep\(\s*0\.0\s*,\s*sin\(\s*radians\(\s*8\.0\s*\)\s*\)\s*,\s*sinAltitude\s*\)\s*;/.test(
        galaxySource
    ),
    'Milky Way transmission must rise from zero at 0 degrees to full strength at 8 degrees altitude'
);
assert(
    /vec3\s+skyColor\s*=\s*mix\(\s*nightSky\s*,\s*twilightSky\s*,\s*twilightLift\s*\)\s*;\s*skyColor\s*=\s*mix\(\s*skyColor\s*,\s*daylightSky\s*,\s*daylight\s*\)\s*;/.test(
        galaxySource
    ),
    'Sky color must blend night into twilight before blending that result into daylight'
);

const smoothstepValue = (edge0, edge1, value) => {
    const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
    return amount * amount * (3 - 2 * amount);
};
const galaxyTransmission = [0, 2, 4, 6, 8].map(altitude =>
    smoothstepValue(
        0,
        Math.sin(8 * Math.PI / 180),
        Math.sin(altitude * Math.PI / 180)
    )
);
[
    0,
    0.1571095096915875,
    0.5018314199207012,
    0.8449497920746681,
    1
].forEach((expected, index) => {
    assert(
        Math.abs(galaxyTransmission[index] - expected) < 1e-12,
        'The 0-to-8-degree Milky Way transmission curve must remain continuous'
    );
});
const scalarMix = (from, to, amount) => from + (to - from) * amount;
const twoStageSkyMix = scalarMix(
    scalarMix(0, 10, 0.25),
    100,
    0.4
);
const wrongOrderSkyMix = scalarMix(
    0,
    scalarMix(10, 100, 0.4),
    0.25
);
assert.equal(twoStageSkyMix, 41.5);
assert.equal(wrongOrderSkyMix, 11.5);
assert.notEqual(
    twoStageSkyMix,
    wrongOrderSkyMix,
    'Night-to-twilight-to-daylight blending must remain order-sensitive'
);

const fallbackRendererSource = life.match(
    /function drawFallbackSpace\([^)]*\) \{([\s\S]*?)\n\}\n\nfunction createStarGlowSprite/
);
assert(fallbackRendererSource, 'Could not extract the 2D sky fallback');
assert(
    /star\.magnitude/.test(fallbackRendererSource[1]) &&
    /(?:skyMagnitudeLimit|magnitudeLimit)/.test(fallbackRendererSource[1]) &&
    /isAboveHorizon\(/.test(fallbackRendererSource[1]),
    'The 2D fallback must share the WebGL horizon and limiting-magnitude rules'
);
assert(
    /fallbackStars\.push\(\{[\s\S]{0,600}\bmagnitude\b/.test(life),
    'Fallback stars must retain catalog magnitudes for twilight filtering'
);
assert(
    /const\s+altitudeGradient\s*=\s*\[\s*dot\(\s*basis\.right\s*,\s*sky\.zenith\s*\)\s*\/\s*focal\s*,\s*-\s*dot\(\s*basis\.up\s*,\s*sky\.zenith\s*\)\s*\/\s*focal\s*\]\s*;/.test(
        fallbackRendererSource[1]
    ),
    'Fallback altitude gradients must project the real catalog zenith into the camera basis'
);

const skyParametersSource = life.match(
    /function skyRenderingParameters\(\) \{([\s\S]*?)\n\}\n\nfunction starVisibilityAtDirection/
);
assert(skyParametersSource, 'Could not extract skyRenderingParameters()');
assert(
    /const\s+sunHorizonLocal\s*=\s*horizontalSunLength\s*>\s*1e-8\s*\?\s*\[\s*localSunDirection\[0\]\s*\/\s*horizontalSunLength\s*,\s*0\s*,\s*localSunDirection\[2\]\s*\/\s*horizontalSunLength\s*\]\s*:\s*null\s*;/.test(
        skyParametersSource[1]
    ),
    'Projected solar azimuth must lie exactly on the local y=0 horizon'
);
const localHorizonSource = life.match(
    /function drawLocalHorizon\([^)]*\) \{([\s\S]*?)\n\}\n\nfunction randomUnit/
);
assert(localHorizonSource, 'Could not extract drawLocalHorizon()');
assert(
    /const\s+sunAmount\s*=\s*sunPoint\?\.visible\s*\?[\s\S]{0,300}:\s*null\s*;/.test(
        localHorizonSource[1]
    ),
    'Horizon warmth must require a projectable, visible solar azimuth'
);
const guardedHorizonWarmth = localHorizonSource[1].match(
    /if\s*\(\s*sunAmount\s*!==\s*null\s*\)\s*\{([\s\S]*?)\n\s*\}/
);
assert(guardedHorizonWarmth, 'Horizon warm stops must remain visibility-guarded');
assert(
    /atmosphericGlow\.addColorStop\(\s*sunAmount\s*,\s*warm\s*\)/.test(
        guardedHorizonWarmth[1]
    )
);
assert.equal(
    (
        localHorizonSource[1].match(
            /atmosphericGlow\.addColorStop\([^;]*\bwarm\b[^;]*\)/g
        ) || []
    ).length,
    1,
    'The horizon renderer must not add an unguarded warm fallback stop'
);

assert(index.includes("const WEATHER_LOCATION_STORAGE_KEY = 'runde:weather-location:v1'"));
assert(index.includes("new URL('https://api.open-meteo.com/v1/forecast')"));
assert(life.includes("const WEATHER_LOCATION_STORAGE_KEY = 'runde:weather-location:v1'"));

const astronomyHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(astronomyPath))
    .digest('hex')
    .toUpperCase();
assert.equal(
    astronomyHash,
    'F41139A87941EA017AB902B954C9389FA27EA72083D7FAB4971756D7769D14E6'
);

const Astronomy = require(astronomyPath);
const fixedDate = new Date('2026-07-29T06:55:00.000Z');
const time = Astronomy.MakeTime(fixedDate);
const observer = new Astronomy.Observer(31.2304, 121.4737, 0);
const eqjToHor = Astronomy.Rotation_EQJ_HOR(time, observer);
const horToEqj = Astronomy.Rotation_HOR_EQJ(time, observer);

function length(vector) {
    return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector) {
    const magnitude = length(vector);
    return vector.map(value => value / magnitude);
}

function projectEqjToLocal(direction) {
    const eqj = new Astronomy.Vector(
        direction[2],
        direction[0],
        direction[1],
        time
    );
    const hor = Astronomy.RotateVector(eqjToHor, eqj);
    return normalize([-hor.y, hor.z, hor.x]);
}

function localToProjectEqj(direction) {
    const hor = new Astronomy.Vector(
        direction[2],
        -direction[0],
        direction[1],
        time
    );
    const eqj = Astronomy.RotateVector(horToEqj, hor);
    return normalize([eqj.y, eqj.z, eqj.x]);
}

const roundTripSource = normalize([0.31, -0.42, 0.85]);
const roundTrip = localToProjectEqj(projectEqjToLocal(roundTripSource));
assert(
    length(roundTrip.map((value, index) => value - roundTripSource[index])) < 1e-12,
    'Project EQJ/local-horizontal conversion must round-trip'
);

const expectedAltitude = new Map([
    ['Sun', 48.8437],
    ['Mercury', 32.271],
    ['Venus', 62.436],
    ['Mars', 10.410],
    ['Jupiter', 49.277],
    ['Saturn', -49.260],
    ['Uranus', -4.398],
    ['Neptune', -56.248],
    ['Pluto', -49.944]
]);
for (const [body, expected] of expectedAltitude) {
    const equator = Astronomy.Equator(body, time, observer, false, true);
    const horizontalVector = Astronomy.RotateVector(eqjToHor, equator.vec);
    const horizontal = Astronomy.HorizonFromVector(horizontalVector, null);
    assert(
        Math.abs(horizontal.lat - expected) < 0.003,
        `${body} altitude should match the verified Shanghai reference`
    );
}

const validationDates = [
    '2025-01-01T00:00:00Z',
    '2025-03-20T09:01:00Z',
    '2025-06-21T02:42:00Z',
    '2025-09-22T18:19:00Z',
    '2025-12-21T15:03:00Z',
    '2026-07-29T06:55:00Z'
];
const validationObservers = [
    [-33.8688, 151.2093],
    [0, 0],
    [31.2304, 121.4737],
    [51.5072, -0.1276],
    [64.1466, -21.9426],
    [78.2232, 15.6469]
];
let astronomyGridCases = 0;
for (const dateText of validationDates) {
    const gridTime = Astronomy.MakeTime(new Date(dateText));
    for (const [latitude, longitude] of validationObservers) {
        const gridObserver = new Astronomy.Observer(latitude, longitude, 0);
        const rotation = Astronomy.Rotation_EQJ_HOR(gridTime, gridObserver);
        const inverse = Astronomy.Rotation_HOR_EQJ(gridTime, gridObserver);
        const sample = new Astronomy.Vector(0.31, -0.42, 0.85, gridTime);
        const recovered = Astronomy.RotateVector(
            inverse,
            Astronomy.RotateVector(rotation, sample)
        );
        assert(
            Math.hypot(
                recovered.x - sample.x,
                recovered.y - sample.y,
                recovered.z - sample.z
            ) < 1e-12,
            `Sky rotation must round-trip at ${latitude}, ${longitude} on ${dateText}`
        );
        for (const body of expectedAltitude.keys()) {
            const equator = Astronomy.Equator(
                body,
                gridTime,
                gridObserver,
                false,
                true
            );
            const horizontal = Astronomy.HorizonFromVector(
                Astronomy.RotateVector(rotation, equator.vec),
                null
            );
            const illumination = Astronomy.Illumination(body, gridTime);
            assert(
                [
                    horizontal.lat,
                    horizontal.lon,
                    equator.dist,
                    illumination.mag,
                    illumination.phase_fraction
                ].every(Number.isFinite),
                `${body} must remain finite at ${latitude}, ${longitude} on ${dateText}`
            );
            assert(horizontal.lat >= -90 && horizontal.lat <= 90);
            assert(horizontal.lon >= 0 && horizontal.lon < 360);
            assert(equator.dist > 0);
            assert(
                illumination.phase_fraction >= 0 &&
                illumination.phase_fraction <= 1
            );
            astronomyGridCases += 1;
        }
    }
}

const catalogContext = {
    window: {},
    atob: encoded => Buffer.from(encoded, 'base64').toString('binary')
};
vm.createContext(catalogContext);
vm.runInContext(
    fs.readFileSync(path.join(root, 'assets', 'hipparcos-stars.js'), 'utf8'),
    catalogContext
);
assert.equal(catalogContext.window.HipparcosSky.count, 45934);
assert.equal(catalogContext.window.HipparcosSky.directions.length, 45934 * 3);
const catalog = catalogContext.window.HipparcosSky;

class MockClassList {
    constructor() {
        this.values = new Set();
    }
    add(...names) {
        names.forEach(name => this.values.add(name));
    }
    remove(...names) {
        names.forEach(name => this.values.delete(name));
    }
    toggle(_name, force) {
        if (force === undefined) {
            if (this.values.has(_name)) {
                this.values.delete(_name);
                return false;
            }
            this.values.add(_name);
            return true;
        }
        if (force) this.values.add(_name);
        else this.values.delete(_name);
        return Boolean(force);
    }
    contains(name) {
        return this.values.has(name);
    }
}

function mockGradient() {
    return { addColorStop() {} };
}

function mockCanvasContext() {
    return {
        arc() {},
        beginPath() {},
        clearRect() {},
        clip() {},
        createLinearGradient: mockGradient,
        createRadialGradient: mockGradient,
        drawImage() {},
        ellipse() {},
        fill() {},
        fillRect() {},
        fillText() {},
        lineTo() {},
        moveTo() {},
        restore() {},
        save() {},
        setLineDash() {},
        setTransform() {},
        stroke() {}
    };
}

function addMockListener(target, type, listener, options = undefined) {
    if (
        typeof listener !== 'function' &&
        typeof listener?.handleEvent !== 'function'
    ) return;
    if (!target._listeners) target._listeners = new Map();
    if (!target._listeners.has(type)) target._listeners.set(type, []);
    target._listeners.get(type).push({
        listener,
        once: Boolean(options && typeof options === 'object' && options.once)
    });
}

function removeMockListener(target, type, listener) {
    const listeners = target._listeners?.get(type);
    if (!listeners) return;
    target._listeners.set(
        type,
        listeners.filter(entry => entry.listener !== listener)
    );
}

function dispatchMockEvent(target, event) {
    const dispatched = typeof event === 'string' ? { type: event } : event;
    assert(dispatched?.type, 'Mock events must declare a type');
    if (!('target' in dispatched)) dispatched.target = target;
    dispatched.currentTarget = target;
    if (!('defaultPrevented' in dispatched)) dispatched.defaultPrevented = false;
    if (typeof dispatched.preventDefault !== 'function') {
        dispatched.preventDefault = () => {
            dispatched.defaultPrevented = true;
        };
    }
    const listeners = [...(target._listeners?.get(dispatched.type) || [])];
    listeners.forEach(entry => {
        if (typeof entry.listener === 'function') {
            entry.listener.call(target, dispatched);
        } else {
            entry.listener.handleEvent(dispatched);
        }
        if (entry.once) {
            removeMockListener(target, dispatched.type, entry.listener);
        }
    });
    return !dispatched.defaultPrevented;
}

class MockElement {
    constructor(tagName = 'div', id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.className = '';
        this.classList = new MockClassList();
        this.style = { setProperty() {} };
        this.attributes = new Map();
        this.dataset = {};
        this.children = [];
        this.parentElement = null;
        this.hidden = false;
        this.inert = false;
        this.width = 1;
        this.height = 1;
        this.textContent = '';
    }
    addEventListener(type, listener, options) {
        addMockListener(this, type, listener, options);
    }
    append(...children) {
        const inserted = children.flatMap(child =>
            child?.tagName === 'FRAGMENT' ? child.children : [child]
        );
        inserted.forEach(child => {
            if (child && typeof child === 'object') child.parentElement = this;
        });
        this.children.push(...inserted);
    }
    appendChild(child) {
        if (child?.tagName === 'FRAGMENT') {
            this.append(...child.children);
            return child;
        }
        if (child && typeof child === 'object') child.parentElement = this;
        this.children.push(child);
        return child;
    }
    closest() {
        return null;
    }
    contains(target) {
        if (target === this) return true;
        return this.children.some(child =>
            child && typeof child.contains === 'function' && child.contains(target)
        );
    }
    dispatchEvent(event) {
        return dispatchMockEvent(this, event);
    }
    focus() {
        mockDocument.activeElement = this;
    }
    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }
    getBoundingClientRect() {
        return { left: 0, right: 420, top: 80, bottom: 720, width: 420, height: 640 };
    }
    getClientRects() {
        return [];
    }
    getContext(kind) {
        if (
            (this.id === 'spaceCanvas' || this.id === 'celestialCloseupCanvas') &&
            kind !== '2d'
        ) return null;
        return mockCanvasContext();
    }
    querySelector(selector) {
        if (selector.startsWith('.')) {
            const className = selector.slice(1).split(/[\s>:]/)[0];
            const child = this.children.find(item =>
                String(item.className).split(/\s+/).includes(className)
            );
            if (child) return child;
        }
        return new MockElement('button');
    }
    querySelectorAll() {
        return [];
    }
    removeEventListener(type, listener) {
        removeMockListener(this, type, listener);
    }
    removeAttribute(name) {
        this.attributes.delete(name);
    }
    requestPointerLock() {
        mockDocument.pointerLockElement = this;
    }
    replaceChildren(...children) {
        const inserted = children.flatMap(child =>
            child?.tagName === 'FRAGMENT' ? child.children : [child]
        );
        this.children = inserted;
        inserted.forEach(child => {
            if (child && typeof child === 'object') child.parentElement = this;
        });
    }
    scrollTo() {}
    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }
    setPointerCapture() {}
    toggleAttribute(name, force) {
        const enabled = force === undefined ? !this.attributes.has(name) : Boolean(force);
        if (enabled) this.attributes.set(name, '');
        else this.attributes.delete(name);
        return enabled;
    }
}

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, String(value));
        },
        removeItem(key) {
            values.delete(key);
        }
    };
}

const elementsById = new Map();
function elementById(id) {
    if (!elementsById.has(id)) {
        const tag = /Canvas$/.test(id) ? 'canvas' : 'div';
        elementsById.set(id, new MockElement(tag, id));
    }
    return elementsById.get(id);
}

const selectorElements = new Map();
const mockDocument = {
    body: new MockElement('body', 'body'),
    documentElement: new MockElement('html', 'html'),
    activeElement: null,
    fonts: {
        check() {
            return true;
        },
        async load() {
            return [{ status: 'loaded' }];
        }
    },
    hidden: false,
    pointerLockElement: null,
    referrer: '',
    addEventListener(type, listener, options) {
        addMockListener(this, type, listener, options);
    },
    createDocumentFragment() {
        return new MockElement('fragment');
    },
    createElement(tagName) {
        return new MockElement(tagName);
    },
    exitPointerLock() {
        this.pointerLockElement = null;
    },
    dispatchEvent(event) {
        return dispatchMockEvent(this, event);
    },
    getElementById: elementById,
    querySelector(selector) {
        if (!selectorElements.has(selector)) {
            selectorElements.set(selector, new MockElement('div'));
        }
        return selectorElements.get(selector);
    },
    querySelectorAll(selector) {
        if (selector === '[data-section-drawer-inert="true"]') {
            return this.body.children.filter(element =>
                element?.dataset?.sectionDrawerInert === 'true'
            );
        }
        return [];
    },
    removeEventListener(type, listener) {
        removeMockListener(this, type, listener);
    }
};
mockDocument.activeElement = mockDocument.body;

const localStorage = createStorage();
const sessionStorage = createStorage();
let animationFrameId = 0;
const animationFrames = new Map();
function mockRequestAnimationFrame(callback) {
    animationFrameId += 1;
    if (typeof callback === 'function') animationFrames.set(animationFrameId, callback);
    return animationFrameId;
}
function mockCancelAnimationFrame(id) {
    animationFrames.delete(id);
}

let mockTimerId = 0;
const mockTimers = new Map();
function mockSetTimeout(callback, delay = 0, ...args) {
    mockTimerId += 1;
    mockTimers.set(mockTimerId, {
        callback,
        delay: Number(delay) || 0,
        args
    });
    return mockTimerId;
}
function mockClearTimeout(id) {
    mockTimers.delete(id);
}
const mockTimerControl = {
    reset() {
        mockTimers.clear();
    },
    count() {
        return mockTimers.size;
    },
    snapshot() {
        return [...mockTimers.entries()].map(([id, timer]) => ({
            id,
            delay: timer.delay
        }));
    },
    runAll() {
        const pending = [...mockTimers.entries()];
        pending.forEach(([id, timer]) => {
            if (!mockTimers.has(id)) return;
            mockTimers.delete(id);
            timer.callback(...timer.args);
        });
        return pending.length;
    }
};
const mockAnimationFrameControl = {
    reset() {
        animationFrames.clear();
    },
    count() {
        return animationFrames.size;
    },
    run(id, time = performance.now()) {
        const callback = animationFrames.get(id);
        if (!callback) return false;
        animationFrames.delete(id);
        callback(time);
        return true;
    }
};
const mockWindow = {
    Astronomy,
    HipparcosSky: catalog,
    StellarTransit: null,
    crypto: crypto.webcrypto,
    devicePixelRatio: 1,
    history: { length: 1, back() {} },
    innerHeight: 900,
    innerWidth: 1440,
    localStorage,
    location: {
        href: 'https://example.test/life.html',
        origin: 'https://example.test',
        pathname: '/life.html'
    },
    matchMedia() {
        return { matches: false };
    },
    sessionStorage,
    addEventListener(type, listener, options) {
        addMockListener(this, type, listener, options);
    },
    clearTimeout: mockClearTimeout,
    dispatchEvent(event) {
        return dispatchMockEvent(this, event);
    },
    removeEventListener(type, listener) {
        removeMockListener(this, type, listener);
    },
    requestAnimationFrame: mockRequestAnimationFrame,
    setTimeout: mockSetTimeout
};

const runtimeContext = {
    Astronomy,
    CustomEvent: class {},
    Date,
    Element: MockElement,
    HTMLImageElement: MockElement,
    URL,
    URLSearchParams,
    __mockAnimationFrames: mockAnimationFrameControl,
    __mockTimers: mockTimerControl,
    atob: encoded => Buffer.from(encoded, 'base64').toString('binary'),
    cancelAnimationFrame: mockCancelAnimationFrame,
    clearTimeout: mockClearTimeout,
    console,
    crypto: crypto.webcrypto,
    document: mockDocument,
    localStorage,
    matchMedia: mockWindow.matchMedia,
    navigator: {},
    performance,
    requestAnimationFrame: mockRequestAnimationFrame,
    sessionStorage,
    setTimeout: mockSetTimeout,
    window: mockWindow
};
runtimeContext.globalThis = runtimeContext;
vm.createContext(runtimeContext);
assert.doesNotThrow(
    () => vm.runInContext(inlineScripts(life)[1], runtimeContext, {
        filename: 'life.inline.js',
        timeout: 10000
    }),
    'life.html main script must initialize with a minimal DOM'
);

const horizonCameraState = JSON.parse(vm.runInContext(`(() => {
    const saved = {
        orientation: camera.orientation.slice(),
        targetOrientation: camera.targetOrientation.slice(),
        lastStableYaw: camera.lastStableYaw,
        scene: state.scene,
        hasEntered: state.hasEntered,
        gateOpen: state.gateOpen,
        modalOpen: state.modalOpen,
        touchMode: state.touchMode,
        altHeld: state.altHeld
    };
    const quaternionDot = (left, right) => Math.abs(left.reduce(
        (sum, value, index) => sum + value * right[index],
        0
    ));
    const wrappedDistance = (left, right) =>
        Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
    let decompositionCases = 0;
    let constraintCases = 0;
    let maximumReconstructionError = 0;
    let maximumAltitudeDeficit = 0;
    let maximumRollError = 0;
    let maximumIdempotenceError = 0;
    let inverseError = 0;

    [-2.8, -1.1, 0, 0.7, 2.6].forEach(yaw => {
        [-78, -21, 0, 44, 82].forEach(pitchDegrees => {
            [-2.4, -0.8, 0, 1.15, 2.5].forEach(roll => {
                const orientation = orientationFromYawPitchRoll(
                    yaw,
                    pitchDegrees * DEG,
                    roll
                );
                const pose = decomposeYawPitchRoll(orientation, yaw);
                const reconstructed = orientationFromYawPitchRoll(
                    pose.yaw,
                    pose.pitch,
                    pose.roll
                );
                const reconstructionError = 2 * Math.acos(clamp(
                    quaternionDot(orientation, reconstructed),
                    -1,
                    1
                ));
                maximumReconstructionError = Math.max(
                    maximumReconstructionError,
                    reconstructionError
                );
                const identity = quatMultiply(
                    orientation,
                    quatConjugate(orientation)
                );
                inverseError = Math.max(
                    inverseError,
                    Math.hypot(identity[0], identity[1], identity[2]) +
                        Math.abs(Math.abs(identity[3]) - 1)
                );
                decompositionCases += 1;
            });
        });
    });

    [-2.7, -0.4, 1.3, 2.9].forEach(yaw => {
        [-87, -35, -4, -0.2, 0].forEach(pitchDegrees => {
            [-2.3, -0.45, 0, 0.9, 2.65].forEach(roll => {
                const constrained = constrainOrientationAboveHorizon(
                    orientationFromYawPitchRoll(
                        yaw,
                        pitchDegrees * DEG,
                        roll
                    ),
                    yaw
                );
                const forward = quatRotate(constrained, [0, 0, 1]);
                const altitude = Math.asin(clamp(forward[1], -1, 1));
                const pose = decomposeYawPitchRoll(constrained, yaw);
                maximumAltitudeDeficit = Math.max(
                    maximumAltitudeDeficit,
                    MIN_CAMERA_ALTITUDE - altitude
                );
                maximumRollError = Math.max(
                    maximumRollError,
                    wrappedDistance(pose.roll, roll)
                );
                const twice = constrainOrientationAboveHorizon(constrained, yaw);
                maximumIdempotenceError = Math.max(
                    maximumIdempotenceError,
                    2 * Math.acos(clamp(
                        quaternionDot(constrained, twice),
                        -1,
                        1
                    ))
                );
                constraintCases += 1;
            });
        });
    });

    const legalOrientation = orientationFromYawPitchRoll(0.72, 31 * DEG, -1.1);
    const legalConstrained = constrainOrientationAboveHorizon(legalOrientation);
    const legalPoseUnchanged =
        quaternionDot(legalOrientation, legalConstrained) > 1 - 1e-12;
    const zenithOrientation = orientationFromYawPitchRoll(0.72, 90 * DEG, -1.1);
    const zenithConstrained = constrainOrientationAboveHorizon(
        zenithOrientation,
        0.72
    );
    const legalZenithUnchanged =
        quaternionDot(zenithOrientation, zenithConstrained) > 1 - 1e-12;

    state.scene = 'roam';
    state.hasEntered = true;
    state.gateOpen = false;
    state.modalOpen = false;
    state.touchMode = false;
    state.altHeld = false;
    camera.targetOrientation = orientationFromYawPitchRoll(0.2, 10 * DEG, 0.7);
    applyLook(0, 900);
    const lookForward = quatRotate(camera.targetOrientation, [0, 0, 1]);
    const lookAltitude = Math.asin(clamp(lookForward[1], -1, 1));

    camera.targetOrientation = orientationFromYawPitchRoll(0.35, 90 * DEG, 0.7);
    const exactZenithForward = quatRotate(
        camera.targetOrientation,
        [0, 0, 1]
    );
    applyLook(80, 0);
    const lateralZenithForward = quatRotate(
        camera.targetOrientation,
        [0, 0, 1]
    );
    const lateralZenithDeflection = Math.acos(clamp(
        dot(exactZenithForward, lateralZenithForward),
        -1,
        1
    ));
    const lateralZenithFinite = lateralZenithForward.every(Number.isFinite);

    camera.targetOrientation = orientationFromYawPitchRoll(
        0.35,
        89.5 * DEG,
        0
    );
    const beforeCrossing = quatRotate(camera.targetOrientation, [0, 0, 1]);
    applyLook(0, -20);
    const afterCrossing = quatRotate(camera.targetOrientation, [0, 0, 1]);
    const beforeCrossingHorizontal = normalize([
        beforeCrossing[0],
        0,
        beforeCrossing[2]
    ]);
    const afterCrossingHorizontal = normalize([
        afterCrossing[0],
        0,
        afterCrossing[2]
    ]);
    const crossedZenith =
        dot(beforeCrossingHorizontal, afterCrossingHorizontal) < -0.99 &&
        Math.asin(clamp(afterCrossing[1], -1, 1)) < 89 * DEG &&
        afterCrossing[1] > 0;

    const rolledStart = orientationFromYawPitchRoll(0.4, 50 * DEG, 0.8);
    const rolledForward = quatRotate(rolledStart, [0, 0, 1]);
    const rolledRight = quatRotate(rolledStart, [1, 0, 0]);
    const rolledUp = quatRotate(rolledStart, [0, 1, 0]);
    camera.targetOrientation = rolledStart.slice();
    applyLook(18, 0);
    const rolledHorizontalForward = quatRotate(
        camera.targetOrientation,
        [0, 0, 1]
    );
    camera.targetOrientation = rolledStart.slice();
    applyLook(0, 18);
    const rolledVerticalForward = quatRotate(
        camera.targetOrientation,
        [0, 0, 1]
    );
    const rolledScreenAxesPreserved =
        dot(
            rolledHorizontalForward.map((value, index) =>
                value - rolledForward[index]
            ),
            rolledRight
        ) > 0.02 &&
        dot(
            rolledVerticalForward.map((value, index) =>
                value - rolledForward[index]
            ),
            rolledUp
        ) < -0.02;

    camera.orientation = orientationFromYawPitchRoll(-0.9, -45 * DEG, 1.4);
    camera.targetOrientation = orientationFromYawPitchRoll(1.1, -72 * DEG, -0.8);
    enforceCameraSkyDome();
    const enforcedOrientationAltitude = Math.asin(clamp(
        quatRotate(camera.orientation, [0, 0, 1])[1],
        -1,
        1
    ));
    const enforcedTargetAltitude = Math.asin(clamp(
        quatRotate(camera.targetOrientation, [0, 0, 1])[1],
        -1,
        1
    ));

    camera.orientation = saved.orientation;
    camera.targetOrientation = saved.targetOrientation;
    camera.lastStableYaw = saved.lastStableYaw;
    state.scene = saved.scene;
    state.hasEntered = saved.hasEntered;
    state.gateOpen = saved.gateOpen;
    state.modalOpen = saved.modalOpen;
    state.touchMode = saved.touchMode;
    state.altHeld = saved.altHeld;

    return JSON.stringify({
        minimumAltitude: MIN_CAMERA_ALTITUDE,
        decompositionCases,
        constraintCases,
        maximumReconstructionError,
        maximumAltitudeDeficit,
        maximumRollError,
        maximumIdempotenceError,
        inverseError,
        legalPoseUnchanged,
        legalZenithUnchanged,
        lookAltitude,
        lateralZenithDeflection,
        lateralZenithFinite,
        crossedZenith,
        rolledScreenAxesPreserved,
        enforcedOrientationAltitude,
        enforcedTargetAltitude
    });
})()`, runtimeContext));
assert.equal(
    horizonCameraState.minimumAltitude,
    0.25 * Math.PI / 180,
    'MIN_CAMERA_ALTITUDE must equal exactly 0.25 degrees'
);
assert.equal(horizonCameraState.decompositionCases, 125);
assert.equal(horizonCameraState.constraintCases, 100);
assert(
    horizonCameraState.maximumReconstructionError < 1e-7,
    `Yaw/pitch/roll reconstruction drifted by ${horizonCameraState.maximumReconstructionError}`
);
assert(
    horizonCameraState.inverseError < 1e-11,
    `Quaternion conjugation must produce the identity; error ${horizonCameraState.inverseError}`
);
assert(
    horizonCameraState.maximumAltitudeDeficit < 1e-10,
    `Camera constraint crossed the horizon by ${horizonCameraState.maximumAltitudeDeficit} radians`
);
assert(
    horizonCameraState.maximumRollError < 1e-8,
    `Camera constraint changed roll by ${horizonCameraState.maximumRollError} radians`
);
assert(
    horizonCameraState.maximumIdempotenceError < 1e-7,
    `Camera constraint must be idempotent; error ${horizonCameraState.maximumIdempotenceError}`
);
assert(horizonCameraState.legalPoseUnchanged);
assert(
    horizonCameraState.legalZenithUnchanged,
    'The horizon constraint must not turn the zenith into an artificial upper wall'
);
assert(
    horizonCameraState.lateralZenithFinite &&
    horizonCameraState.lateralZenithDeflection > 7 * Math.PI / 180,
    'Horizontal look input at the zenith must move the gaze instead of merely spinning it'
);
assert(
    horizonCameraState.crossedZenith,
    'Upward look input must pass smoothly across the zenith'
);
assert(
    horizonCameraState.rolledScreenAxesPreserved,
    'Mouse look must continue to follow screen axes after A/D camera roll'
);
assert(
    horizonCameraState.lookAltitude >= horizonCameraState.minimumAltitude - 1e-10,
    'Mouse look must never move the camera center below the real horizon'
);
assert(
    horizonCameraState.enforcedOrientationAltitude >=
        horizonCameraState.minimumAltitude - 1e-10 &&
    horizonCameraState.enforcedTargetAltitude >=
        horizonCameraState.minimumAltitude - 1e-10,
    'Every render path must constrain both the current and target camera pose'
);

const entryLocationState = JSON.parse(vm.runInContext(`(() => {
    const savedLocation = skyModel.location;
    const savedObserver = skyModel.observer;
    const savedLanguage = state.currentLang;
    const savedStorage = localStorage.getItem(WEATHER_LOCATION_STORAGE_KEY);
    const fallbackEnglish = dom.entryLocation.textContent;
    localStorage.setItem(WEATHER_LOCATION_STORAGE_KEY, JSON.stringify({
        v: 1,
        latitude: 30.2741,
        longitude: 120.1551,
        height: 0,
        timezone: 'Asia/Shanghai',
        label: {
            en: 'Hangzhou',
            'zh-CN': '杭州',
            'zh-TW': '杭州'
        },
        source: 'homepage-weather'
    }));
    window.dispatchEvent({
        type: 'storage',
        key: WEATHER_LOCATION_STORAGE_KEY
    });
    const syncedEnglish = dom.entryLocation.textContent;
    setLang('zh-CN');
    const syncedSimplified = dom.entryLocation.textContent;
    setLang('zh-TW');
    const syncedTraditional = dom.entryLocation.textContent;

    if (savedStorage === null) {
        localStorage.removeItem(WEATHER_LOCATION_STORAGE_KEY);
    } else {
        localStorage.setItem(WEATHER_LOCATION_STORAGE_KEY, savedStorage);
    }
    skyModel.location = savedLocation;
    skyModel.observer = savedObserver;
    setLang(savedLanguage);
    return JSON.stringify({
        fallbackEnglish,
        syncedEnglish,
        syncedSimplified,
        syncedTraditional
    });
})()`, runtimeContext));
assert.deepEqual(entryLocationState, {
    fallbackEnglish: 'Current observing location: Shanghai · default location',
    syncedEnglish: 'Current observing location: Hangzhou · synced from homepage weather',
    syncedSimplified: '当前观测位置：杭州 · 与主页天气同步',
    syncedTraditional: '目前觀測位置：杭州 · 與主頁天氣同步'
}, 'The entry gate must distinguish the default observer from the homepage weather location');

const horizonClipState = JSON.parse(vm.runInContext(`(() => {
    const polygonArea = points => {
        let doubled = 0;
        points.forEach((point, index) => {
            const next = points[(index + 1) % points.length];
            const x = point.x ?? point[0];
            const y = point.y ?? point[1];
            const nextX = next.x ?? next[0];
            const nextY = next.y ?? next[1];
            doubled += x * nextY - nextX * y;
        });
        return Math.abs(doubled) * 0.5;
    };
    const viewports = [
        [320, 800],
        [844, 390],
        [1440, 900],
        [2560, 1080]
    ];
    const rolls = [-2.65, -Math.PI / 2, -0.48, 0, 0.83, 2.4];
    const pitches = [MIN_CAMERA_ALTITUDE, 6 * DEG, 24 * DEG, 58 * DEG];
    const fovs = [35 * DEG, 62 * DEG, 105 * DEG];
    const failures = [];
    let cases = 0;
    let mixedCases = 0;
    let maximumAreaFractionError = 0;

    viewports.forEach(([width, height]) => {
        rolls.forEach(roll => {
            pitches.forEach(pitch => {
                fovs.forEach(fov => {
                    const orientation = orientationFromYawPitchRoll(
                        0.73,
                        pitch,
                        roll
                    );
                    const basis = {
                        right: quatRotate(orientation, [1, 0, 0]),
                        up: quatRotate(orientation, [0, 1, 0]),
                        forward: quatRotate(orientation, [0, 0, 1])
                    };
                    const polygon = clipViewportToGround(
                        basis,
                        width,
                        height,
                        fov
                    );
                    const finiteAndInside = Array.isArray(polygon) &&
                        polygon.every(point => {
                            const x = point.x ?? point[0];
                            const y = point.y ?? point[1];
                            return (
                            Number.isFinite(x) &&
                            Number.isFinite(y) &&
                            x >= -1e-7 &&
                            x <= width + 1e-7 &&
                            y >= -1e-7 &&
                            y <= height + 1e-7 &&
                            horizonScreenValue(
                                x,
                                y,
                                basis,
                                width,
                                height,
                                fov
                            ) <= 1e-7
                            );
                        });

                    const samples = 41;
                    let groundSamples = 0;
                    let classificationValid = true;
                    for (let row = 0; row < samples; row += 1) {
                        for (let column = 0; column < samples; column += 1) {
                            const x = (column + 0.5) / samples * width;
                            const y = (row + 0.5) / samples * height;
                            const value = horizonScreenValue(
                                x,
                                y,
                                basis,
                                width,
                                height,
                                fov
                            );
                            const focal = height * 0.5 / Math.tan(fov * 0.5);
                            const analytic =
                                basis.forward[1] +
                                basis.right[1] * ((x - width * 0.5) / focal) +
                                basis.up[1] * ((height * 0.5 - y) / focal);
                            if (
                                Math.sign(value) !== Math.sign(analytic) &&
                                Math.abs(value) > 1e-10 &&
                                Math.abs(analytic) > 1e-10
                            ) {
                                classificationValid = false;
                            }
                            if (value <= 0) groundSamples += 1;
                        }
                    }
                    const sampledFraction =
                        groundSamples / (samples * samples);
                    const polygonFraction = polygonArea(polygon) /
                        (width * height);
                    const fractionError = Math.abs(
                        sampledFraction - polygonFraction
                    );
                    maximumAreaFractionError = Math.max(
                        maximumAreaFractionError,
                        fractionError
                    );
                    if (sampledFraction > 0.01 && sampledFraction < 0.99) {
                        mixedCases += 1;
                    }
                    if (
                        !classificationValid ||
                        !finiteAndInside ||
                        polygon.length > 6 ||
                        fractionError > 0.032
                    ) {
                        failures.push({
                            kind: 'polygon',
                            width,
                            height,
                            roll,
                            pitch,
                            fov,
                            polygon,
                            sampledFraction,
                            polygonFraction,
                            finiteAndInside
                        });
                    }
                    cases += 1;
                });
            });
        });
    });
    return JSON.stringify({
        cases,
        mixedCases,
        maximumAreaFractionError,
        failures
    });
})()`, runtimeContext));
assert.equal(horizonClipState.cases, 288);
assert(horizonClipState.mixedCases > 100);
assert.deepEqual(
    horizonClipState.failures,
    [],
    'The ground half-plane must clip the viewport correctly at every roll, FOV and aspect ratio'
);

const celestialNavigationState = JSON.parse(vm.runInContext(`(() => {
    const ids = celestialBodies.map(profile => profile.id);
    const buttons = celestialBodies.map(profile => profile.button);
    return JSON.stringify({
        ids,
        uniqueIds: new Set(ids).size,
        buttonCount: buttons.filter(Boolean).length,
        buttonIds: buttons.map(button => button?.dataset?.celestialId || null),
        imageCount: celestialCloseupRenderer.images.size,
        pendingImageCount: celestialCloseupRenderer.imagePromises.size,
        textureCount: celestialCloseupRenderer.textures.size,
        activeProfile: celestialCloseupRenderer.activeProfile?.id || null
    });
})()`, runtimeContext));
assert.deepEqual(
    celestialNavigationState,
    {
        ids: expectedCelestialIds,
        uniqueIds: 9,
        buttonCount: 9,
        buttonIds: expectedCelestialIds,
        imageCount: 0,
        pendingImageCount: 0,
        textureCount: 0,
        activeProfile: null
    },
    'The live sky must build exactly nine non-Earth hit targets without loading close-up textures'
);
assert.ok(
    !life.includes('celestial-catalog') &&
    !life.includes('catalogButton') &&
    !/\^Digit\[1-9\]/.test(life),
    'The removed 1–9 observation catalog and its numeric shortcut must not return'
);

const sectionDrawerMarkup = life.match(
    /<aside\b[^>]*\bid="sectionDrawer"[\s\S]*?<\/aside>/
);
assert(sectionDrawerMarkup, 'The left-edge section drawer must exist');
const drawerListMarkup = sectionDrawerMarkup[0].match(
    /<nav\b[^>]*\bid="sectionDrawerList"[^>]*>([\s\S]*?)<\/nav>/
);
assert(drawerListMarkup, 'The section drawer must expose a dedicated portal list');
assert(
    !/sectionDrawerHome/.test(drawerListMarkup[1]) &&
    /id="sectionDrawerHome"/.test(sectionDrawerMarkup[0]),
    'Home must remain a visually and semantically separate drawer destination'
);
assert(
    /id="sectionDrawerToggle"[^>]*aria-expanded="false"[^>]*aria-controls="sectionDrawer"/.test(
        life
    ) &&
    /id="sectionDrawer"[^>]*aria-hidden="true"[\s\S]{0,180}\sinert/.test(life),
    'The section drawer must start closed with an accessible disclosure contract'
);

const sectionDrawerState = JSON.parse(vm.runInContext(`(() => {
    buildSectionDrawer();
    const expectedContentIds = portalDefinitions
        .filter(portal => !portal.home)
        .map(portal => portal.id);
    const listedButtons = dom.sectionDrawerList.children.filter(
        child => child.tagName === 'BUTTON'
    );
    const listedIds = listedButtons.map(button => button.dataset.portalId);
    const uniqueIds = new Set(listedIds).size;
    const home = portalDefinitions.find(portal => portal.home);
    const homeSeparated = (
        dom.sectionDrawerHome.parentElement !== dom.sectionDrawerList &&
        (
            dom.sectionDrawerHome.dataset.portalId === home.id ||
            dom.sectionDrawerHome.dataset.portal === home.id
        )
    );

    const saved = {
        scene: state.scene,
        hasEntered: state.hasEntered,
        gateOpen: state.gateOpen,
        modalOpen: state.modalOpen,
        touchMode: state.touchMode,
        lock: state.lock,
        pointerLockElement: document.pointerLockElement
    };
    state.scene = 'roam';
    state.hasEntered = true;
    state.gateOpen = false;
    state.modalOpen = false;
    state.touchMode = false;
    state.lock = 'keyboard-free';
    document.pointerLockElement = null;
    openSectionDrawer('keyboard');
    const accessibleOpen = (
        dom.sectionDrawer.getAttribute('aria-hidden') === 'false' &&
        !dom.sectionDrawer.inert &&
        dom.sectionDrawerToggle.getAttribute('aria-expanded') === 'true'
    );
    closeSectionDrawer({ restoreControl: false, focusToggle: false });
    const accessibleClosed = (
        dom.sectionDrawer.getAttribute('aria-hidden') === 'true' &&
        dom.sectionDrawer.inert &&
        dom.sectionDrawerToggle.getAttribute('aria-expanded') === 'false'
    );

    state.scene = saved.scene;
    state.hasEntered = saved.hasEntered;
    state.gateOpen = saved.gateOpen;
    state.modalOpen = saved.modalOpen;
    state.touchMode = saved.touchMode;
    state.lock = saved.lock;
    document.pointerLockElement = saved.pointerLockElement;
    return JSON.stringify({
        expectedContentIds,
        listedIds,
        uniqueIds,
        listedCount: listedButtons.length,
        homeSeparated,
        accessibleOpen,
        accessibleClosed
    });
})()`, runtimeContext));
assert.equal(sectionDrawerState.listedCount, 9);
assert.equal(sectionDrawerState.uniqueIds, 9);
assert.deepEqual(
    sectionDrawerState.listedIds,
    sectionDrawerState.expectedContentIds,
    'The drawer must list all nine content portals once, in their authored order'
);
assert(sectionDrawerState.homeSeparated);
assert(sectionDrawerState.accessibleOpen);
assert(sectionDrawerState.accessibleClosed);

const drawerModalState = JSON.parse(vm.runInContext(`(() => {
    const stateSnapshot = { ...state };
    const pointerLockSnapshot = document.pointerLockElement;
    const hiddenSnapshot = document.hidden;
    const renderingSnapshot = renderingEnabled;
    const bodyChildrenSnapshot = document.body.children.slice();
    const background = [
        dom.entryGate,
        dom.world,
        dom.panel,
        dom.celestialPanel,
        dom.lightbox,
        dom.portalNav,
        dom.celestialNav,
        dom.starNav
    ];
    const managed = [
        ...background,
        dom.sectionDrawerToggle,
        dom.sectionDrawerScrim,
        dom.sectionDrawer
    ];
    const inertSnapshot = managed.map(element => element.inert);
    const attributesSnapshot = managed.map(element =>
        new Map(element.attributes)
    );
    const trackedBodyClasses = [
        'panel-open',
        'celestial-open',
        'section-drawer-open',
        'cursor-free',
        'view-locked'
    ];
    const bodyClassSnapshot = trackedBodyClasses.map(name =>
        dom.body.classList.contains(name)
    );
    const entryGateHiddenClass = dom.entryGate.classList.contains('is-hidden');

    document.body.children = [
        ...background,
        dom.sectionDrawerToggle,
        dom.sectionDrawerScrim,
        dom.sectionDrawer
    ];
    const allBackgroundInert = () => background.every(element => element.inert);
    const dispatchEscape = () => {
        const event = {
            type: 'keydown',
            key: 'Escape',
            code: 'Escape',
            altKey: false,
            target: dom.sectionDrawerClose
        };
        document.dispatchEvent(event);
        return event;
    };
    const configureRoam = () => {
        state.scene = 'roam';
        state.hasEntered = true;
        state.gateOpen = false;
        state.modalOpen = false;
        state.sectionDrawerOpen = false;
        state.touchMode = false;
        state.lock = 'keyboard-free';
        state.lockIntent = null;
        state.altHeld = false;
        state.altReturnMode = null;
        state.altPreviousLock = null;
        state.relockPending = false;
        state.pendingDrawerPortal = null;
        state.pendingDrawerHome = false;
        state.drawerNavigationSource = null;
        state.drawerReturn = null;
        state.flight = null;
        state.celestialFlight = null;
        state.celestialVisit = null;
        document.pointerLockElement = null;
        dom.body.classList.remove(
            'panel-open',
            'celestial-open',
            'section-drawer-open',
            'view-locked'
        );
        dom.body.classList.add('cursor-free');
        dom.sectionDrawer.setAttribute('aria-hidden', 'true');
        dom.sectionDrawer.inert = true;
        dom.sectionDrawerToggle.setAttribute('aria-expanded', 'false');
        setGateState(false);
    };

    configureRoam();
    const gateDrawerOpened = openSectionDrawer('keyboard');
    const inertImmediately = allBackgroundInert();
    hideEntryGate();
    const inertAfterHideEntryGate = allBackgroundInert();
    setGateState(false);
    const inertAfterExplicitGateClose = allBackgroundInert();
    setGateState(true);
    const inertAfterGateOpen = allBackgroundInert();
    const gateEscape = dispatchEscape();
    const gateRestoredAfterEscape = {
        prevented: gateEscape.defaultPrevented,
        drawerClosed: !state.sectionDrawerOpen,
        modalClosed: !state.modalOpen,
        keyboardFree: state.lock === 'keyboard-free',
        gateHidden: !state.gateOpen &&
            dom.entryGate.classList.contains('is-hidden'),
        worldRestored: !dom.world.inert,
        panelInert: dom.panel.inert,
        celestialPanelInert: dom.celestialPanel.inert,
        portalNavRestored: !dom.portalNav.inert,
        celestialNavRestored: !dom.celestialNav.inert,
        starNavInert: dom.starNav.inert,
        drawerInert: dom.sectionDrawer.inert,
        toggleRestored: !dom.sectionDrawerToggle.inert
    };

    configureRoam();
    state.scene = 'detail';
    state.lock = 'detail-free';
    state.activePortal = portalDefinitions.find(portal => !portal.home);
    dom.body.classList.add('panel-open');
    setGateState(false);
    const detailBefore = {
        world: dom.world.inert,
        panel: dom.panel.inert,
        portalNav: dom.portalNav.inert,
        celestialNav: dom.celestialNav.inert,
        starNav: dom.starNav.inert
    };
    const detailDrawerOpened = openSectionDrawer('keyboard');
    hideEntryGate();
    const detailInertWhileOpen = allBackgroundInert();
    closeSectionDrawer();
    const detailRestoredAfterClose = (
        state.scene === 'detail' &&
        !state.sectionDrawerOpen &&
        !state.modalOpen &&
        state.lock === 'detail-free' &&
        dom.world.inert === detailBefore.world &&
        dom.panel.inert === detailBefore.panel &&
        dom.portalNav.inert === detailBefore.portalNav &&
        dom.celestialNav.inert === detailBefore.celestialNav &&
        dom.starNav.inert === detailBefore.starNav
    );

    configureRoam();
    state.lock = 'locked';
    document.pointerLockElement = dom.world;
    releaseCursorForAlt();
    handlePointerLockChange();
    const altReleased = (
        state.altHeld &&
        state.altReturnMode === 'locked' &&
        document.pointerLockElement === null
    );
    const altDrawerOpened = openSectionDrawer('pointer');
    const tokenBeforeAltKeyup = state.lockRequestToken;
    const altKeyup = {
        type: 'keyup',
        key: 'Alt',
        code: 'AltLeft',
        altKey: false,
        target: dom.sectionDrawer
    };
    window.dispatchEvent(altKeyup);
    const altReleaseStayedModal = (
        altKeyup.defaultPrevented &&
        altDrawerOpened &&
        state.sectionDrawerOpen &&
        state.modalOpen &&
        !state.altHeld &&
        state.altReturnMode === null &&
        !state.relockPending &&
        state.lockRequestToken === tokenBeforeAltKeyup &&
        state.lock !== 'requesting' &&
        document.pointerLockElement === null
    );
    closeSectionDrawer({ restoreControl: false, focusToggle: false });

    configureRoam();
    openSectionDrawer('pointer');
    state.pendingDrawerPortal = portalDefinitions.find(portal => !portal.home);
    state.pendingDrawerHome = true;
    state.drawerNavigationSource = 'keyboard';
    state.altHeld = true;
    state.altReturnMode = 'locked';
    state.relockPending = true;
    state.lockRequestTimer = setTimeout(() => {}, 900);
    state.lockRequestSource = 'drawer-test';
    window.dispatchEvent({ type: 'blur' });
    const blurClearedDrawerAndPending = (
        !state.sectionDrawerOpen &&
        !state.modalOpen &&
        state.pendingDrawerPortal === null &&
        !state.pendingDrawerHome &&
        state.drawerNavigationSource === null &&
        !state.altHeld &&
        state.altReturnMode === null &&
        !state.relockPending &&
        state.lockRequestTimer === null &&
        state.lockRequestSource === null &&
        dom.sectionDrawer.inert &&
        dom.sectionDrawer.getAttribute('aria-hidden') === 'true'
    );

    configureRoam();
    openSectionDrawer('pointer');
    state.pendingDrawerPortal = portalDefinitions.find(portal => !portal.home);
    state.pendingDrawerHome = true;
    state.drawerNavigationSource = 'pointer';
    state.altHeld = true;
    state.altReturnMode = 'locked';
    state.relockPending = true;
    state.lockRequestTimer = setTimeout(() => {}, 901);
    state.lockRequestSource = 'drawer-test';
    document.hidden = true;
    document.dispatchEvent({ type: 'visibilitychange' });
    const visibilityClearedDrawerAndPending = (
        !state.sectionDrawerOpen &&
        !state.modalOpen &&
        state.pendingDrawerPortal === null &&
        !state.pendingDrawerHome &&
        state.drawerNavigationSource === null &&
        !state.altHeld &&
        state.altReturnMode === null &&
        !state.relockPending &&
        state.lockRequestTimer === null &&
        state.lockRequestSource === null &&
        dom.sectionDrawer.inert &&
        dom.sectionDrawer.getAttribute('aria-hidden') === 'true' &&
        !renderingEnabled
    );
    document.hidden = false;
    document.dispatchEvent({ type: 'visibilitychange' });
    const renderingResumed = renderingEnabled;

    if (state.sectionDrawerOpen) {
        closeSectionDrawer({ restoreControl: false, focusToggle: false });
    }
    Object.assign(state, stateSnapshot);
    document.pointerLockElement = pointerLockSnapshot;
    document.hidden = hiddenSnapshot;
    document.body.children = bodyChildrenSnapshot;
    managed.forEach((element, index) => {
        element.inert = inertSnapshot[index];
        element.attributes = new Map(attributesSnapshot[index]);
        delete element.dataset.sectionDrawerInert;
    });
    trackedBodyClasses.forEach((name, index) => {
        dom.body.classList.toggle(name, bodyClassSnapshot[index]);
    });
    dom.entryGate.classList.toggle('is-hidden', entryGateHiddenClass);
    if (renderingSnapshot && !renderingEnabled) startRendering();
    if (!renderingSnapshot && renderingEnabled) stopRendering();

    return JSON.stringify({
        gateDrawerOpened,
        inertImmediately,
        inertAfterHideEntryGate,
        inertAfterExplicitGateClose,
        inertAfterGateOpen,
        gateRestoredAfterEscape,
        detailDrawerOpened,
        detailInertWhileOpen,
        detailRestoredAfterClose,
        altReleased,
        altReleaseStayedModal,
        blurClearedDrawerAndPending,
        visibilityClearedDrawerAndPending,
        renderingResumed
    });
})()`, runtimeContext));
assert.deepEqual(drawerModalState, {
    gateDrawerOpened: true,
    inertImmediately: true,
    inertAfterHideEntryGate: true,
    inertAfterExplicitGateClose: true,
    inertAfterGateOpen: true,
    gateRestoredAfterEscape: {
        prevented: true,
        drawerClosed: true,
        modalClosed: true,
        keyboardFree: true,
        gateHidden: true,
        worldRestored: true,
        panelInert: true,
        celestialPanelInert: true,
        portalNavRestored: true,
        celestialNavRestored: true,
        starNavInert: true,
        drawerInert: true,
        toggleRestored: true
    },
    detailDrawerOpened: true,
    detailInertWhileOpen: true,
    detailRestoredAfterClose: true,
    altReleased: true,
    altReleaseStayedModal: true,
    blurClearedDrawerAndPending: true,
    visibilityClearedDrawerAndPending: true,
    renderingResumed: true
}, 'The section drawer must remain an isolated modal across gate, Alt, blur and visibility transitions');

const drawerCloseSourceState = JSON.parse(vm.runInContext(`(() => {
    const savedState = { ...state };
    const savedPointerLock = document.pointerLockElement;
    const savedActiveElement = document.activeElement;
    const savedRequestViewLock = requestViewLock;
    const savedRequestAnimationFrame = globalThis.requestAnimationFrame;
    const savedBodyClasses = [...dom.body.classList.values];
    const managed = [
        dom.world,
        dom.panel,
        dom.celestialPanel,
        dom.lightbox,
        dom.portalNav,
        dom.celestialNav,
        dom.starNav,
        dom.sectionDrawer,
        dom.sectionDrawerToggle
    ];
    const savedManaged = managed.map(element => ({
        inert: element.inert,
        hidden: element.hidden,
        attributes: new Map(element.attributes),
        classes: [...element.classList.values]
    }));
    const lockRequests = [];
    requestViewLock = source => {
        lockRequests.push(source);
        state.lock = 'requesting';
        return true;
    };
    globalThis.requestAnimationFrame = callback => {
        if (typeof callback === 'function') callback(performance.now());
        return -1;
    };
    const configureLockedRoam = () => {
        state.scene = 'roam';
        state.hasEntered = true;
        state.gateOpen = false;
        state.modalOpen = false;
        state.sectionDrawerOpen = false;
        state.sectionDrawerUnavailable = false;
        state.touchMode = false;
        state.altHeld = false;
        state.altReturnMode = null;
        state.altPreviousLock = null;
        state.relockPending = false;
        state.lock = 'locked';
        state.lockIntent = null;
        state.drawerReturn = null;
        document.pointerLockElement = dom.world;
        dom.body.classList.remove('panel-open', 'celestial-open', 'section-drawer-open');
        dom.body.classList.add('view-locked');
        dom.sectionDrawer.inert = true;
        dom.sectionDrawer.setAttribute('aria-hidden', 'true');
        dom.sectionDrawerToggle.inert = false;
        dom.sectionDrawerToggle.setAttribute('aria-expanded', 'false');
        setGateState(false);
        lockRequests.length = 0;
    };
    const dispatchEscape = () => {
        const event = {
            type: 'keydown',
            key: 'Escape',
            code: 'Escape',
            altKey: false,
            target: dom.sectionDrawerClose
        };
        document.dispatchEvent(event);
        return event;
    };

    configureLockedRoam();
    const keyboardOpened = openSectionDrawer('keyboard');
    const keyboardEscape = dispatchEscape();
    const keyboardClose = keyboardOpened &&
        keyboardEscape.defaultPrevented &&
        !state.sectionDrawerOpen &&
        state.lock === 'keyboard-free' &&
        document.activeElement === dom.sectionDrawerToggle &&
        lockRequests.length === 0;

    const pointerCloseCase = target => {
        configureLockedRoam();
        const opened = openSectionDrawer('pointer');
        const focusSentinel = document.createElement('button');
        focusSentinel.focus();
        lockRequests.length = 0;
        target.dispatchEvent({ type: 'click', detail: 1 });
        return opened &&
            !state.sectionDrawerOpen &&
            document.activeElement === focusSentinel &&
            lockRequests.length === 1 &&
            lockRequests[0] === 'drawer-close';
    };
    const pointerToggleClose = pointerCloseCase(dom.sectionDrawerToggle);
    const pointerButtonClose = pointerCloseCase(dom.sectionDrawerClose);
    const pointerScrimClose = pointerCloseCase(dom.sectionDrawerScrim);

    requestViewLock = savedRequestViewLock;
    globalThis.requestAnimationFrame = savedRequestAnimationFrame;
    Object.assign(state, savedState);
    document.pointerLockElement = savedPointerLock;
    document.activeElement = savedActiveElement;
    dom.body.classList.values = new Set(savedBodyClasses);
    managed.forEach((element, index) => {
        const saved = savedManaged[index];
        element.inert = saved.inert;
        element.hidden = saved.hidden;
        element.attributes = new Map(saved.attributes);
        element.classList.values = new Set(saved.classes);
    });
    return JSON.stringify({
        keyboardClose,
        pointerToggleClose,
        pointerButtonClose,
        pointerScrimClose
    });
})()`, runtimeContext));
assert.deepEqual(drawerCloseSourceState, {
    keyboardClose: true,
    pointerToggleClose: true,
    pointerButtonClose: true,
    pointerScrimClose: true
}, 'Keyboard drawer closes must stay cursor-free and focus the toggle, while pointer closes may restore lock without forcing focus');

const belowHorizonHitState = JSON.parse(vm.runInContext(`(() => {
    const saved = {
        scene: state.scene,
        activePortal: state.activePortal
    };
    const projected = {
        visible: true,
        x: overlayWidth * 0.5,
        y: overlayHeight * 0.5,
        z: 1
    };
    const below = [0, -0.02, Math.sqrt(1 - 0.02 * 0.02)];
    const above = [0, 0.2, Math.sqrt(1 - 0.2 * 0.2)];

    const portal = portalDefinitions.find(candidate => !candidate.home);
    const savedPortalDirection = portal.direction;
    const savedPortalVisible = portal.buttonVisible;
    const savedPortalSkyVisibility = portal.skyVisibility;
    state.scene = 'roam';
    portal.buttonVisible = undefined;
    portal.skyVisibility = 1;
    portal.button.hidden = false;
    portal.button.inert = false;
    portal.direction = below;
    updatePortalButton(portal, projected);
    const portalBelowDisabled = portal.button.hidden && portal.button.inert;
    portal.direction = above;
    updatePortalButton(portal, projected);
    const portalAboveEnabled = !portal.button.hidden && !portal.button.inert;

    const celestial = celestialBodies.find(profile => profile.id === 'venus');
    const savedCelestialCurrent = celestial.current;
    const savedCelestialVisible = celestial.buttonVisible;
    celestial.buttonVisible = undefined;
    celestial.button.hidden = false;
    celestial.button.inert = false;
    celestial.current = {
        ...(savedCelestialCurrent || {}),
        direction: below,
        nakedEyeVisible: true,
        observationMode: 'naked-eye'
    };
    updateCelestialButton(celestial, projected);
    const celestialBelowDisabled =
        celestial.button.hidden && celestial.button.inert;
    celestial.current.direction = above;
    updateCelestialButton(celestial, projected);
    const celestialAboveEnabled =
        !celestial.button.hidden && !celestial.button.inert;

    const hip = portal.patternHips[0];
    const starIndex = portal.patternHips.indexOf(hip);
    const savedStarDirection = portal.patternPoints[starIndex];
    const starButton = portal.starButtons.get(hip);
    const starCache = portal.starButtonScreens.get(hip);
    const savedStarCache = { ...starCache };
    state.scene = 'detail';
    state.activePortal = portal;
    portal.patternPoints[starIndex] = below;
    starCache.visible = undefined;
    starButton.hidden = false;
    starButton.inert = false;
    updateStarButtonPosition(portal, hip, projected, below);
    const starBelowDisabled = starButton.hidden && starButton.inert;
    portal.patternPoints[starIndex] = above;
    updateStarButtonPosition(portal, hip, projected, above);
    const starAboveEnabled = !starButton.hidden && !starButton.inert;

    portal.direction = savedPortalDirection;
    portal.buttonVisible = savedPortalVisible;
    portal.skyVisibility = savedPortalSkyVisibility;
    celestial.current = savedCelestialCurrent;
    celestial.buttonVisible = savedCelestialVisible;
    portal.patternPoints[starIndex] = savedStarDirection;
    Object.assign(starCache, savedStarCache);
    state.scene = saved.scene;
    state.activePortal = saved.activePortal;
    return JSON.stringify({
        portalBelowDisabled,
        portalAboveEnabled,
        celestialBelowDisabled,
        celestialAboveEnabled,
        starBelowDisabled,
        starAboveEnabled,
        horizonRejected: !isAboveHorizon([0, 0, 1]),
        positiveAltitudeAccepted: isAboveHorizon([0, 0.01, 0.99995]),
        marginHonored: !isAboveHorizon([0, 0.01, 0.99995], 0.02)
    });
})()`, runtimeContext));
assert.deepEqual(belowHorizonHitState, {
    portalBelowDisabled: true,
    portalAboveEnabled: true,
    celestialBelowDisabled: true,
    celestialAboveEnabled: true,
    starBelowDisabled: true,
    starAboveEnabled: true,
    horizonRejected: true,
    positiveAltitudeAccepted: true,
    marginHonored: true
}, 'No portal, planet or constellation-star hit target may remain active below the horizon');

const drawerNavigationState = JSON.parse(vm.runInContext(`(() => {
    const contentPortals = portalDefinitions.filter(portal => !portal.home);
    const hiddenPortal = contentPortals[0];
    const visiblePortal = contentPortals[1];
    const savedHiddenDirection = hiddenPortal.direction;
    const savedVisibleDirection = visiblePortal.direction;
    const savedState = {
        scene: state.scene,
        hasEntered: state.hasEntered,
        gateOpen: state.gateOpen,
        modalOpen: state.modalOpen,
        sectionDrawerOpen: state.sectionDrawerOpen,
        celestialFlight: state.celestialFlight,
        celestialVisit: state.celestialVisit,
        flight: state.flight
    };
    const originalStartPortalFlight = startPortalFlight;
    const originalOpenPortalPanel = openPortalPanel;
    const originalCloseSectionDrawer = closeSectionDrawer;
    const originalPortalAvailableInSky = portalAvailableInSky;
    const savedHiddenSkyVisibility = hiddenPortal.skyVisibility;
    const savedVisibleSkyVisibility = visiblePortal.skyVisibility;
    const calls = [];
    startPortalFlight = (...args) => calls.push({
        kind: 'flight',
        portal: args[0]?.id,
        source: args[1]
    });
    openPortalPanel = (...args) => calls.push({
        kind: 'panel',
        portal: args[0]?.id,
        preferredHip: args[2] ?? null
    });
    closeSectionDrawer = (...args) => calls.push({
        kind: 'close',
        restoreFocus: args[0]
    });
    portalAvailableInSky = portal => portal === visiblePortal;

    hiddenPortal.direction = [0, -0.2, Math.sqrt(0.96)];
    visiblePortal.direction = [0, 0.2, Math.sqrt(0.96)];
    hiddenPortal.skyVisibility = 1;
    visiblePortal.skyVisibility = 1;
    state.scene = 'roam';
    state.hasEntered = true;
    state.gateOpen = false;
    state.modalOpen = false;
    state.celestialFlight = null;
    state.celestialVisit = null;
    state.flight = null;
    state.sectionDrawerOpen = true;
    navigateFromSectionDrawer(hiddenPortal, 'keyboard');
    const hiddenCalls = calls.splice(0);
    state.sectionDrawerOpen = true;
    navigateFromSectionDrawer(visiblePortal, 'pointer');
    const visibleCalls = calls.splice(0);

    startPortalFlight = originalStartPortalFlight;
    openPortalPanel = originalOpenPortalPanel;
    closeSectionDrawer = originalCloseSectionDrawer;
    portalAvailableInSky = originalPortalAvailableInSky;
    hiddenPortal.direction = savedHiddenDirection;
    visiblePortal.direction = savedVisibleDirection;
    hiddenPortal.skyVisibility = savedHiddenSkyVisibility;
    visiblePortal.skyVisibility = savedVisibleSkyVisibility;
    Object.assign(state, savedState);
    return JSON.stringify({
        hiddenCalls,
        visibleCalls,
        hiddenFirstHip: firstContentStarHip(hiddenPortal)
    });
})()`, runtimeContext));
assert(
    drawerNavigationState.hiddenCalls.some(call =>
        call.kind === 'panel' &&
        call.portal === sectionDrawerState.expectedContentIds[0] &&
        call.preferredHip === drawerNavigationState.hiddenFirstHip
    ) &&
    !drawerNavigationState.hiddenCalls.some(call => call.kind === 'flight'),
    'A below-horizon drawer destination must open its content directly without an underground flight'
);
assert(
    drawerNavigationState.visibleCalls.some(call =>
        call.kind === 'flight' &&
        call.portal === sectionDrawerState.expectedContentIds[1]
    ) &&
    !drawerNavigationState.visibleCalls.some(call => call.kind === 'panel'),
    'An above-horizon drawer destination should retain the constellation flight'
);

const indexedNavigationRuntimeState = JSON.parse(vm.runInContext(`(() => {
    const contentPortals = portalDefinitions.filter(portal => !portal.home);
    const belowPortal = contentPortals[0];
    const daylightPortal = contentPortals[1];
    const flightPortal = contentPortals[2];
    const managedPortals = [belowPortal, daylightPortal, flightPortal];
    const savedState = { ...state };
    const savedCamera = {
        orientation: camera.orientation.slice(),
        targetOrientation: camera.targetOrientation.slice(),
        inspectionOrientation: camera.inspectionOrientation?.slice() || null,
        fov: camera.fov,
        targetFov: camera.targetFov
    };
    const savedPortals = managedPortals.map(portal => ({
        direction: portal.direction,
        patternPoints: portal.patternPoints,
        patternMagnitudes: portal.patternMagnitudes,
        screen: portal.screen,
        buttonHidden: portal.button.hidden,
        buttonInert: portal.button.inert,
        buttonVisible: portal.buttonVisible
    }));
    const sun = celestialBodies.find(profile => profile.id === 'sun');
    const savedSunCurrent = sun.current;
    const savedWidth = window.innerWidth;
    const savedHeight = window.innerHeight;
    const savedActiveElement = document.activeElement;
    const savedBodyClasses = [...dom.body.classList.values];
    const managedElements = [
        dom.world,
        dom.panel,
        dom.celestialPanel,
        dom.lightbox,
        dom.portalNav,
        dom.celestialNav,
        dom.starNav,
        dom.sectionDrawer,
        dom.sectionDrawerToggle
    ];
    const savedElements = managedElements.map(element => ({
        inert: element.inert,
        hidden: element.hidden,
        attributes: new Map(element.attributes),
        classes: [...element.classList.values]
    }));
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    const originalConstellationFraming = constellationFraming;
    globalThis.requestAnimationFrame = callback => {
        if (typeof callback === 'function') callback(performance.now());
        return -1;
    };

    const sameQuaternion = (left, right) => Math.abs(
        Math.abs(left.reduce(
            (sum, value, index) => sum + value * right[index],
            0
        )) - 1
    ) < 1e-12;
    const configureRoam = () => {
        state.scene = 'roam';
        state.hasEntered = true;
        state.gateOpen = false;
        state.modalOpen = false;
        state.sectionDrawerOpen = false;
        state.flight = null;
        state.celestialFlight = null;
        state.celestialVisit = null;
        state.activePortal = null;
        state.activeCelestial = null;
        state.routePreview = null;
        state.portalReturnFocusTarget = null;
        state.activePortalOpenedThroughIndex = false;
        state.altHeld = false;
        state.touchMode = false;
        state.lock = 'keyboard-free';
        document.pointerLockElement = null;
        dom.body.classList.remove(
            'panel-open',
            'panel-left',
            'celestial-open',
            'section-drawer-open',
            'view-locked'
        );
        dom.body.classList.add('cursor-free');
        setGateState(false);
    };
    const installVisiblePattern = portal => {
        portal.direction = normalize([0.18, 0.62, 0.76]);
        portal.patternPoints = portal.patternHips.map((_, index) =>
            normalize([
                -0.28 + index * 0.08,
                0.48 + (index % 3) * 0.09,
                0.82 - index * 0.025
            ])
        );
        portal.patternMagnitudes = portal.patternHips.map(() => 2);
    };
    const setCameraPose = seed => {
        const orientation = orientationFromYawPitchRoll(
            (0.31 + seed * 0.17) % (Math.PI * 2),
            0.24 + seed * 0.03,
            -0.19 + seed * 0.02
        );
        camera.orientation = orientation.slice();
        camera.targetOrientation = orientation.slice();
        camera.inspectionOrientation = orientation.slice();
        camera.fov = 0.74 + seed * 0.03;
        camera.targetFov = camera.fov;
    };
    const directResizeCase = (portal, mode, seed) => {
        configureRoam();
        installVisiblePattern(portal);
        sun.current = {
            ...(savedSunCurrent || {}),
            direction: savedSunCurrent?.direction || normalize([0.4, 0.5, 0.7]),
            altitude: mode === 'daylight' ? 12 : -30
        };
        if (mode === 'below') {
            portal.direction = normalize([0.12, -0.28, 0.95]);
        }
        window.innerWidth = 1440;
        window.innerHeight = 900;
        resizeOverlay();
        setCameraPose(seed);
        const unavailableBeforeOpen = !portalAvailableInSky(portal);
        const opened = performDrawerPortalNavigation(portal, 'keyboard');
        const openedDirectly = opened &&
            state.scene === 'detail' &&
            state.activePortal === portal &&
            state.activePortalOpenedThroughIndex &&
            state.flight === null;
        const before = {
            orientation: camera.orientation.slice(),
            targetOrientation: camera.targetOrientation.slice(),
            inspectionOrientation: camera.inspectionOrientation?.slice() || null,
            fov: camera.fov,
            targetFov: camera.targetFov
        };
        window.innerWidth = 600;
        window.innerHeight = 900;
        handleViewportResize();
        const cameraStable = sameQuaternion(
            before.orientation,
            camera.orientation
        ) &&
            sameQuaternion(before.targetOrientation, camera.targetOrientation) &&
            Boolean(before.inspectionOrientation) ===
                Boolean(camera.inspectionOrientation) &&
            (
                !before.inspectionOrientation ||
                sameQuaternion(
                    before.inspectionOrientation,
                    camera.inspectionOrientation
                )
            ) &&
            Math.abs(before.fov - camera.fov) < 1e-12 &&
            Math.abs(before.targetFov - camera.targetFov) < 1e-12;
        closePortalPanel(false, 'drawer');
        return { unavailableBeforeOpen, openedDirectly, cameraStable };
    };

    const belowResize = directResizeCase(belowPortal, 'below', 1);
    const daylightResize = directResizeCase(daylightPortal, 'daylight', 2);

    configureRoam();
    installVisiblePattern(flightPortal);
    sun.current = {
        ...(savedSunCurrent || {}),
        direction: savedSunCurrent?.direction || normalize([-0.3, -0.5, 0.8]),
        altitude: -30
    };
    flightPortal.screen = {
        ...(flightPortal.screen || {}),
        visible: true,
        x: 1320,
        y: 360
    };
    window.innerWidth = 1440;
    window.innerHeight = 900;
    resizeOverlay();
    setCameraPose(3);
    let framingCalls = 0;
    constellationFraming = (...args) => {
        framingCalls += 1;
        return originalConstellationFraming(...args);
    };
    startPortalFlight(
        flightPortal,
        'drawer',
        'open',
        firstContentStarHip(flightPortal)
    );
    const initialFlight = state.flight;
    const initialEndOrientation = initialFlight?.endOrientation.slice();
    const initialPanelOnLeft = initialFlight?.panelOnLeft;
    window.innerWidth = 600;
    handleViewportResize();
    const recomputedFlight = state.flight;
    const visibleFlightReframed = Boolean(
        initialFlight &&
        recomputedFlight === initialFlight &&
        framingCalls >= 2 &&
        initialPanelOnLeft &&
        !recomputedFlight.panelOnLeft &&
        !sameQuaternion(
            initialEndOrientation,
            recomputedFlight.endOrientation
        )
    );

    flightPortal.button.hidden = true;
    flightPortal.button.inert = true;
    flightPortal.buttonVisible = false;
    document.activeElement = dom.world;
    const flightEscape = {
        type: 'keydown',
        key: 'Escape',
        code: 'Escape',
        altKey: false,
        target: dom.world
    };
    document.dispatchEvent(flightEscape);
    const drawerFlightEscapeFocus = (
        flightEscape.defaultPrevented &&
        state.scene === 'roam' &&
        state.flight === null &&
        document.activeElement === dom.sectionDrawerToggle &&
        flightPortal.button.hidden &&
        flightPortal.button.inert &&
        flightPortal.buttonVisible === false
    );

    configureRoam();
    installVisiblePattern(daylightPortal);
    sun.current = {
        ...(savedSunCurrent || {}),
        direction: savedSunCurrent?.direction || normalize([0.4, 0.5, 0.7]),
        altitude: 12
    };
    daylightPortal.button.hidden = true;
    daylightPortal.button.inert = true;
    daylightPortal.buttonVisible = false;
    const indexedPanelOpened = openPortalThroughIndex(
        daylightPortal,
        firstContentStarHip(daylightPortal),
        'drawer'
    );
    const panelEscape = {
        type: 'keydown',
        key: 'Escape',
        code: 'Escape',
        altKey: false,
        target: dom.panelClose
    };
    document.dispatchEvent(panelEscape);
    const drawerPanelEscapeFocus = (
        indexedPanelOpened &&
        panelEscape.defaultPrevented &&
        state.scene === 'roam' &&
        !dom.body.classList.contains('panel-open') &&
        document.activeElement === dom.sectionDrawerToggle &&
        daylightPortal.button.hidden &&
        daylightPortal.button.inert &&
        daylightPortal.buttonVisible === false
    );

    constellationFraming = originalConstellationFraming;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    managedPortals.forEach((portal, index) => {
        const saved = savedPortals[index];
        portal.direction = saved.direction;
        portal.patternPoints = saved.patternPoints;
        portal.patternMagnitudes = saved.patternMagnitudes;
        portal.screen = saved.screen;
        portal.button.hidden = saved.buttonHidden;
        portal.button.inert = saved.buttonInert;
        portal.buttonVisible = saved.buttonVisible;
    });
    sun.current = savedSunCurrent;
    window.innerWidth = savedWidth;
    window.innerHeight = savedHeight;
    resizeOverlay();
    Object.assign(state, savedState);
    camera.orientation = savedCamera.orientation;
    camera.targetOrientation = savedCamera.targetOrientation;
    camera.inspectionOrientation = savedCamera.inspectionOrientation;
    camera.fov = savedCamera.fov;
    camera.targetFov = savedCamera.targetFov;
    dom.body.classList.values = new Set(savedBodyClasses);
    managedElements.forEach((element, index) => {
        const saved = savedElements[index];
        element.inert = saved.inert;
        element.hidden = saved.hidden;
        element.attributes = new Map(saved.attributes);
        element.classList.values = new Set(saved.classes);
    });
    document.activeElement = savedActiveElement;

    return JSON.stringify({
        belowResize,
        daylightResize,
        visibleFlightReframed,
        drawerFlightEscapeFocus,
        drawerPanelEscapeFocus
    });
})()`, runtimeContext));
assert.deepEqual(indexedNavigationRuntimeState, {
    belowResize: {
        unavailableBeforeOpen: true,
        openedDirectly: true,
        cameraStable: true
    },
    daylightResize: {
        unavailableBeforeOpen: true,
        openedDirectly: true,
        cameraStable: true
    },
    visibleFlightReframed: true,
    drawerFlightEscapeFocus: true,
    drawerPanelEscapeFocus: true
}, 'Indexed navigation must preserve direct-open views, reframe visible flights, and return Escape focus without revealing hidden sky targets');

const runtimeSky = JSON.parse(vm.runInContext(`(() => {
    skyModel.location = {
        ...DEFAULT_OBSERVER_LOCATION,
        latitude: 31.2304,
        longitude: 121.4737,
        height: 0
    };
    skyModel.observer = null;
    refreshAstronomicalSky(new Date('2026-07-29T06:55:00.000Z'));
    return JSON.stringify(celestialBodies.map(profile => ({
        id: profile.id,
        body: profile.body,
        altitude: profile.current?.altitude,
        apparentAltitude: profile.current?.apparentAltitude,
        azimuth: profile.current?.azimuth,
        direction: profile.current?.direction,
        geometricDirection: profile.current?.geometricDirection,
        angularDiameter: profile.current?.angularDiameter,
        northEqj: profile.current?.northEqj,
        spin: profile.current?.spin,
        phase: profile.current?.phase,
        phaseAngle: profile.current?.phaseAngle,
        ringTilt: profile.current?.ringTilt,
        observationMode: profile.current?.observationMode,
        nakedEyeVisible: profile.current?.nakedEyeVisible
    })));
})()`, runtimeContext));
for (const body of runtimeSky) {
    const expected = expectedAltitude.get(body.body);
    assert.notEqual(expected, undefined, `Unexpected runtime body ${body.body}`);
    assert(
        Math.abs(body.altitude - expected) < 0.003,
        `${body.body} runtime altitude must match the verified reference`
    );
    assert(body.direction?.every(Number.isFinite));
    const directionAltitude = Math.asin(body.direction[1]) * 180 / Math.PI;
    const directionAzimuth = (
        Math.atan2(body.direction[0], body.direction[2]) * 180 / Math.PI + 360
    ) % 360;
    const displayAltitude = body.id === 'sun'
        ? body.apparentAltitude
        : body.altitude;
    assert(
        Math.abs(directionAltitude - displayAltitude) < 1e-10,
        `${body.body} scene direction must preserve its display altitude`
    );
    assert(
        Math.abs(directionAzimuth - body.azimuth) < 1e-10,
        `${body.body} scene direction must preserve azimuth`
    );
    const azimuthRadians = body.azimuth * Math.PI / 180;
    const altitudeRadians = displayAltitude * Math.PI / 180;
    const reconstructedDirection = [
        Math.sin(azimuthRadians) * Math.cos(altitudeRadians),
        Math.sin(altitudeRadians),
        Math.cos(azimuthRadians) * Math.cos(altitudeRadians)
    ];
    reconstructedDirection.forEach((value, index) => {
        assert(
            Math.abs(value - body.direction[index]) < 1e-10,
            `${body.body} direction must retain the east-up-north azimuth/altitude convention`
        );
    });
    if (body.id === 'sun') {
        const expectedApparentAltitude = body.altitude +
            Astronomy.Refraction('normal', body.altitude);
        assert(
            Math.abs(body.apparentAltitude - expectedApparentAltitude) < 1e-10,
            'Sun apparent altitude must equal geometric altitude plus atmospheric refraction'
        );
        assert(
            Math.abs(
                body.direction[1] -
                Math.sin(body.apparentAltitude * Math.PI / 180)
            ) < 1e-12,
            'Sun scene direction must use its refracted apparent altitude'
        );
    } else {
        assert(body.geometricDirection?.every(Number.isFinite));
        body.direction.forEach((value, index) => {
            assert(
                Math.abs(value - body.geometricDirection[index]) < 1e-12,
                `${body.body} must retain the unrefracted geometric direction`
            );
        });
    }
    assert(body.angularDiameter > 0, `${body.body} must have a positive angular diameter`);
    assert(body.northEqj?.every(Number.isFinite), `${body.body} must expose a finite rotation axis`);
    assert(Number.isFinite(body.spin), `${body.body} must expose a finite rotation phase`);
    assert(body.phase >= 0 && body.phase <= 1, `${body.body} phase must remain normalized`);
    assert(Number.isFinite(body.phaseAngle), `${body.body} phase angle must remain finite`);
    assert(Number.isFinite(body.ringTilt), `${body.body} ring tilt must remain finite`);
    assert(
        [
            'naked-eye',
            'marginal',
            'telescope',
            'daylight',
            'below-horizon'
        ].includes(body.observationMode),
        `${body.body} must receive a physical observation-mode classification`
    );
}

const solarUpperLimbState = JSON.parse(vm.runInContext(`(() => {
    const sun = celestialBodies.find(profile => profile.id === 'sun');
    const savedCurrent = sun.current;
    sun.current = {
        altitude: -1,
        apparentAltitude: -0.2,
        angularDiameter: 0.532 * DEG,
        magnitude: -26.7
    };
    classifyCelestialVisibility(sun, -10);
    const apparentUpperLimbVisible =
        sun.current.observationMode === 'naked-eye' &&
        sun.current.nakedEyeVisible;
    sun.current.apparentAltitude = -0.4;
    classifyCelestialVisibility(sun, -10);
    const apparentUpperLimbBelow =
        sun.current.observationMode === 'below-horizon' &&
        !sun.current.nakedEyeVisible;
    sun.current = savedCurrent;
    return JSON.stringify({
        apparentUpperLimbVisible,
        apparentUpperLimbBelow
    });
})()`, runtimeContext));
assert.deepEqual(solarUpperLimbState, {
    apparentUpperLimbVisible: true,
    apparentUpperLimbBelow: true
}, 'Solar visibility must follow the refracted apparent upper limb');

const visibilityState = JSON.parse(vm.runInContext(`(() => {
    const classify = ({
        id = 'test',
        altitude = 45,
        apparentAltitude = altitude,
        angularDiameter = 0.532 * DEG,
        magnitude = 0,
        sunAltitude = -20
    }) => {
        const profile = {
            id,
            current: {
                altitude,
                apparentAltitude,
                angularDiameter,
                magnitude
            }
        };
        classifyCelestialVisibility(profile, sunAltitude);
        return {
            mode: profile.current.observationMode,
            visible: profile.current.nakedEyeVisible
        };
    };
    return JSON.stringify({
        nakedEye: classify({ id: 'mars', magnitude: 0.5 }),
        marginal: classify({ id: 'uranus', magnitude: 5.7 }),
        telescopeNeptune: classify({ id: 'neptune', magnitude: 7.8 }),
        telescopePluto: classify({ id: 'pluto', magnitude: 14.1 }),
        daylight: classify({
            id: 'jupiter',
            magnitude: -2,
            sunAltitude: 8
        }),
        belowHorizon: classify({
            id: 'venus',
            altitude: -0.01,
            magnitude: -4
        }),
        sunAbove: classify({
            id: 'sun',
            altitude: -0.8,
            apparentAltitude: -0.2,
            magnitude: -26.7
        }),
        sunBelow: classify({
            id: 'sun',
            altitude: -0.9,
            apparentAltitude: -0.4,
            magnitude: -26.7
        })
    });
})()`, runtimeContext));
assert.deepEqual(visibilityState, {
    nakedEye: { mode: 'naked-eye', visible: true },
    marginal: { mode: 'marginal', visible: true },
    telescopeNeptune: { mode: 'telescope', visible: false },
    telescopePluto: { mode: 'telescope', visible: false },
    daylight: { mode: 'daylight', visible: false },
    belowHorizon: { mode: 'below-horizon', visible: false },
    sunAbove: { mode: 'naked-eye', visible: true },
    sunBelow: { mode: 'below-horizon', visible: false }
}, 'Visibility modes must keep Neptune and Pluto out of the natural naked-eye sky');

const skyVisibilityState = JSON.parse(vm.runInContext(`(() => {
    const sun = celestialBodies.find(profile => profile.id === 'sun');
    const savedCurrent = sun.current;
    const limits = [-30, -18, -12, -6, 0, 12].map(twilightMagnitudeLimit);
    sun.current = {
        ...(savedCurrent || {}),
        altitude: -30,
        direction: [0, -0.5, Math.sqrt(0.75)]
    };
    const nightBright = starVisibilityAtDirection([0, 0.8, 0.6], 1);
    const nightDim = starVisibilityAtDirection([0, 0.8, 0.6], 6.4);
    const below = starVisibilityAtDirection([0, -0.01, 0.99995], -5);
    const nearHorizon = starVisibilityAtDirection(
        [0, Math.sin(0.2 * DEG), Math.cos(0.2 * DEG)],
        0
    );
    const highAltitude = starVisibilityAtDirection(
        [0, Math.sin(45 * DEG), Math.cos(45 * DEG)],
        0
    );
    sun.current.altitude = 12;
    const daylightOrdinary = starVisibilityAtDirection([0, 0.8, 0.6], 0);
    const daylightExceptional = starVisibilityAtDirection([0, 0.8, 0.6], -5);
    const daytimeParameters = skyRenderingParameters();
    sun.current = savedCurrent;
    return JSON.stringify({
        limits,
        fallbackMagnitudeCount: fallbackStars.filter(star =>
            Number.isFinite(star.magnitude)
        ).length,
        fallbackCount: fallbackStars.length,
        nightBright,
        nightDim,
        below,
        nearHorizon,
        highAltitude,
        daylightOrdinary,
        daylightExceptional,
        daytimeMagnitudeLimit: daytimeParameters.magnitudeLimit,
        daytimeAltitude: daytimeParameters.sunAltitude,
        daytimeZenithLength: vectorLength(daytimeParameters.zenith),
        daytimeSunLength: vectorLength(daytimeParameters.sunDirection)
    });
})()`, runtimeContext));
[6.5, 6.5, 4.4, 1.2, -4, -4].forEach((expected, index) => {
    assert(
        Math.abs(skyVisibilityState.limits[index] - expected) < 1e-12,
        'Civil, nautical and astronomical twilight must share one limiting-magnitude curve'
    );
});
assert.equal(
    skyVisibilityState.fallbackMagnitudeCount,
    skyVisibilityState.fallbackCount,
    'Every fallback star must retain a finite apparent catalog magnitude'
);
assert(skyVisibilityState.nightBright > skyVisibilityState.nightDim);
assert.equal(skyVisibilityState.below, 0);
assert(skyVisibilityState.nearHorizon < skyVisibilityState.highAltitude);
assert.equal(skyVisibilityState.daylightOrdinary, 0);
assert(skyVisibilityState.daylightExceptional > 0);
assert.equal(skyVisibilityState.daytimeMagnitudeLimit, -4);
assert.equal(skyVisibilityState.daytimeAltitude, 12);
assert(Math.abs(skyVisibilityState.daytimeZenithLength - 1) < 1e-10);
assert(Math.abs(skyVisibilityState.daytimeSunLength - 1) < 1e-10);

const atmosphericRenderState = JSON.parse(vm.runInContext(`(() => {
    const sun = celestialBodies.find(profile => profile.id === 'sun');
    const savedSunCurrent = sun.current;
    const savedSkyRenderingParameters = skyRenderingParameters;
    const savedFallbackStars = fallbackStars;
    const savedOverlayWidth = overlayWidth;
    const savedOverlayHeight = overlayHeight;
    const savedFov = camera.fov;
    const savedCreateLinearGradient = overlayContext.createLinearGradient;
    const savedClosePath = overlayContext.closePath;

    sun.current = {
        ...(savedSunCurrent || {}),
        altitude: -6,
        direction: [0.6, 0.8, 0]
    };
    const projectedSolarAzimuth = skyRenderingParameters();
    sun.current.direction = [0, 1, 0];
    const verticalSolarAzimuth = skyRenderingParameters();
    sun.current.direction = [1e-8, 1, 0];
    const thresholdSolarAzimuth = skyRenderingParameters();

    overlayWidth = 800;
    overlayHeight = 400;
    camera.fov = Math.PI / 2;
    fallbackStars = [];
    const gradientRecords = [];
    overlayContext.createLinearGradient = (...args) => {
        const record = { args, stops: [] };
        gradientRecords.push(record);
        return {
            addColorStop(offset, color) {
                record.stops.push([offset, color]);
            }
        };
    };
    overlayContext.closePath = () => {};
    skyRenderingParameters = () => ({
        zenith: [0.6, 0.8, 0],
        east: [1, 0, 0],
        north: [0, 0, 1],
        sunDirection: [0, -1, 0],
        sunHorizonDirection: null,
        sunHorizonLocal: null,
        sunAltitude: -12,
        magnitudeLimit: 4.4,
        daylight: 0,
        twilightLift: 1,
        twilight: 0
    });
    drawFallbackSpace({
        right: [1, 0, 0],
        up: [0, 1, 0],
        forward: [0, 0, 1]
    }, 0);
    const fallbackGradient = gradientRecords[0];
    const expectedFallbackGradient = [160, 520, 640, -120];
    const fallbackUsesProjectedZenith = Boolean(
        fallbackGradient &&
        fallbackGradient.args.length === 4 &&
        fallbackGradient.args.every(
            (value, index) =>
                Math.abs(value - expectedFallbackGradient[index]) < 1e-9
        )
    );

    gradientRecords.length = 0;
    skyRenderingParameters = () => ({
        zenith: [0, 1, 0],
        east: [1, 0, 0],
        north: [0, 0, 1],
        sunDirection: [1, 0, 0],
        sunHorizonDirection: [1, 0, 0],
        sunHorizonLocal: [1, 0, 0],
        sunAltitude: -6,
        magnitudeLimit: 1.2,
        daylight: 0,
        twilightLift: 1,
        twilight: 1
    });
    drawLocalHorizon({
        right: [1, 0, 0],
        up: [0, 1, 0],
        forward: [0, 0, 1]
    });
    const atmosphericGradient = gradientRecords[0];
    const unprojectableSunAddsNoWarmStop = Boolean(
        atmosphericGradient &&
        atmosphericGradient.stops.length === 2 &&
        atmosphericGradient.stops[0][0] === 0 &&
        atmosphericGradient.stops[1][0] === 1 &&
        atmosphericGradient.stops.every(([, color]) =>
            color === 'rgba(132,170,220,0.055)' &&
            !color.includes('255,156,90')
        )
    );

    skyRenderingParameters = savedSkyRenderingParameters;
    fallbackStars = savedFallbackStars;
    overlayWidth = savedOverlayWidth;
    overlayHeight = savedOverlayHeight;
    camera.fov = savedFov;
    overlayContext.createLinearGradient = savedCreateLinearGradient;
    if (savedClosePath === undefined) {
        delete overlayContext.closePath;
    } else {
        overlayContext.closePath = savedClosePath;
    }
    sun.current = savedSunCurrent;

    return JSON.stringify({
        solarAzimuthOnHorizon:
            projectedSolarAzimuth.sunHorizonLocal[0] === 1 &&
            projectedSolarAzimuth.sunHorizonLocal[1] === 0 &&
            projectedSolarAzimuth.sunHorizonLocal[2] === 0,
        verticalSolarAzimuthNull:
            verticalSolarAzimuth.sunHorizonLocal === null &&
            verticalSolarAzimuth.sunHorizonDirection === null,
        thresholdSolarAzimuthNull:
            thresholdSolarAzimuth.sunHorizonLocal === null &&
            thresholdSolarAzimuth.sunHorizonDirection === null,
        fallbackUsesProjectedZenith,
        unprojectableSunAddsNoWarmStop
    });
})()`, runtimeContext));
assert.deepEqual(atmosphericRenderState, {
    solarAzimuthOnHorizon: true,
    verticalSolarAzimuthNull: true,
    thresholdSolarAzimuthNull: true,
    fallbackUsesProjectedZenith: true,
    unprojectableSunAddsNoWarmStop: true
}, 'Fallback atmosphere rendering must follow the real zenith and visible solar horizon azimuth');

const closeupGeometryState = JSON.parse(vm.runInContext(`(() => {
    const basis = cameraBasis();
    const determinant = matrix => (
        matrix[0] * (matrix[4] * matrix[8] - matrix[7] * matrix[5]) -
        matrix[3] * (matrix[1] * matrix[8] - matrix[7] * matrix[2]) +
        matrix[6] * (matrix[1] * matrix[5] - matrix[4] * matrix[2])
    );
    return JSON.stringify(celestialBodies.map(profile => {
        const matrices = celestialCloseupRenderer.bodyMatrices(profile, basis);
        const light = celestialCloseupRenderer.lightInView(profile, basis);
        return {
            id: profile.id,
            flattening: profile.flattening,
            viewDeterminant: determinant(matrices.viewToBody),
            bodyDeterminant: determinant(matrices.bodyToView),
            matricesFinite: [
                ...matrices.viewToBody,
                ...matrices.bodyToView
            ].every(Number.isFinite),
            lightFinite: light.every(Number.isFinite),
            lightLength: vectorLength(light),
            phase: profile.current.phase,
            ringTilt: profile.current.ringTilt
        };
    }));
})()`, runtimeContext));
assert.equal(closeupGeometryState.length, 9);
for (const body of closeupGeometryState) {
    assert(body.flattening >= 0 && body.flattening < 0.2);
    assert(body.matricesFinite, `${body.id} close-up matrices must remain finite`);
    assert(body.lightFinite, `${body.id} close-up light vector must remain finite`);
    assert(Math.abs(Math.abs(body.viewDeterminant) - 1) < 1e-5);
    assert(Math.abs(Math.abs(body.bodyDeterminant) - 1) < 1e-5);
    assert(Math.abs(body.lightLength - 1) < 1e-10);
    assert(body.phase >= 0 && body.phase <= 1);
    assert(Number.isFinite(body.ringTilt));
}
assert(
    closeupGeometryState.find(body => body.id === 'saturn').flattening >
    closeupGeometryState.find(body => body.id === 'jupiter').flattening,
    'Saturn’s greater oblateness must be represented in the close-up geometry'
);

const closeupFailureState = JSON.parse(vm.runInContext(`(() => {
    const profile = celestialBodies.find(body => body.id === 'venus');
    const basis = cameraBasis();
    const visit = {
        profile,
        panelOnLeft: false,
        startScreen: { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 },
        textureReady: true,
        visualProgress: 1
    };
    const makeFallbackCanvas = counter => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const originalDrawImage = context.drawImage;
        context.drawImage = (...args) => {
            counter.frames += 1;
            return originalDrawImage(...args);
        };
        canvas.getContext = kind => kind === '2d' ? context : null;
        return canvas;
    };
    const renderFrames = renderer => {
        let successfulFrames = 0;
        for (let frame = 0; frame < 60; frame += 1) {
            if (renderer.render(frame * (1000 / 60), visit, basis)) {
                successfulFrames += 1;
            }
        }
        return successfulFrames;
    };

    const noContextCounter = { frames: 0 };
    let noContextRequests = 0;
    const noContextCanvas = document.createElement('canvas');
    noContextCanvas.getContext = kind => {
        if (kind === 'webgl' || kind === 'experimental-webgl') {
            noContextRequests += 1;
        }
        return null;
    };
    const noContextRenderer = new CelestialCloseupRenderer(
        noContextCanvas,
        makeFallbackCanvas(noContextCounter)
    );
    noContextRenderer.installFallbackSurface(profile);
    const noContextFrames = renderFrames(noContextRenderer);

    const shaderCounter = { frames: 0 };
    let shaderContextRequests = 0;
    let programAttempts = 0;
    let shaderAttempts = 0;
    let compileAttempts = 0;
    const failingGl = {
        VERTEX_SHADER: 1,
        FRAGMENT_SHADER: 2,
        COMPILE_STATUS: 3,
        createProgram() {
            programAttempts += 1;
            return {};
        },
        createShader() {
            shaderAttempts += 1;
            return {};
        },
        shaderSource() {},
        compileShader() {
            compileAttempts += 1;
        },
        getShaderParameter() {
            return false;
        },
        getShaderInfoLog() {
            return 'forced shader compile failure';
        },
        deleteShader() {}
    };
    const shaderCanvas = document.createElement('canvas');
    shaderCanvas.getContext = kind => {
        if (kind === 'webgl' || kind === 'experimental-webgl') {
            shaderContextRequests += 1;
            return failingGl;
        }
        return null;
    };
    const shaderRenderer = new CelestialCloseupRenderer(
        shaderCanvas,
        makeFallbackCanvas(shaderCounter)
    );
    shaderRenderer.installFallbackSurface(profile);
    const originalWarn = console.warn;
    console.warn = () => {};
    const shaderFrames = renderFrames(shaderRenderer);
    console.warn = originalWarn;

    const originalCloseupRender = celestialCloseupRenderer.render;
    const originalConsoleError = console.error;
    const wasRendering = renderingEnabled;
    __mockAnimationFrames.reset();
    celestialCloseupRenderer.render = () => {
        throw new Error('forced close-up frame failure');
    };
    console.error = () => {};
    renderingEnabled = true;
    renderFrame(performance.now());
    const frameLoopRecovered = __mockAnimationFrames.count() === 1;
    celestialCloseupRenderer.render = originalCloseupRender;
    console.error = originalConsoleError;
    if (wasRendering) startRendering();
    else stopRendering();

    return JSON.stringify({
        frameLoopRecovered,
        noContext: {
            contextRequests: noContextRequests,
            fallbackFrames: noContextCounter.frames,
            successfulFrames: noContextFrames,
            failedLatched: noContextRenderer.webglFailed,
            ready: noContextRenderer.ready
        },
        shader: {
            contextRequests: shaderContextRequests,
            programAttempts,
            shaderAttempts,
            compileAttempts,
            fallbackFrames: shaderCounter.frames,
            successfulFrames: shaderFrames,
            failedLatched: shaderRenderer.webglFailed,
            failureReported: shaderRenderer.failureReported,
            ready: shaderRenderer.ready
        }
    });
})()`, runtimeContext));
assert.deepEqual(closeupFailureState, {
    frameLoopRecovered: true,
    noContext: {
        contextRequests: 2,
        fallbackFrames: 60,
        successfulFrames: 60,
        failedLatched: true,
        ready: false
    },
    shader: {
        contextRequests: 1,
        programAttempts: 1,
        shaderAttempts: 1,
        compileAttempts: 1,
        fallbackFrames: 60,
        successfulFrames: 60,
        failedLatched: true,
        failureReported: true,
        ready: false
    }
}, 'WebGL acquisition or shader failure must latch once and keep every frame alive through the 2D fallback');

const tangentContinuity = JSON.parse(vm.runInContext(`(() => {
    const samples = [];
    for (const sign of [-1, 1]) {
        for (const azimuth of [0, 0.7, 1.4, 2.9, 4.8]) {
            const directions = [0.919999, 0.920001].map(vertical => {
                const y = sign * vertical;
                const horizontal = Math.sqrt(1 - y * y);
                return [
                    Math.sin(azimuth) * horizontal,
                    y,
                    Math.cos(azimuth) * horizontal
                ];
            });
            const tangents = directions.map(direction => tangentBasis(direction).tangent);
            const orientations = directions.map(direction =>
                routePointFraming(direction, false, 32 * DEG)
            );
            samples.push({
                tangentDot: dot(tangents[0], tangents[1]),
                orientationDot: Math.abs(orientations[0].reduce(
                    (sum, value, index) =>
                        sum + value * orientations[1][index],
                    0
                ))
            });
        }
    }
    return JSON.stringify(samples);
})()`, runtimeContext));
assert(
    tangentContinuity.every(sample =>
        sample.tangentDot > 1 - 1e-12 &&
        sample.orientationDot > 1 - 1e-9
    ),
    'Camera roll must remain continuous when a target crosses 0.92 vertical direction'
);

const routeFramingState = JSON.parse(vm.runInContext(`(() => {
    const savedWidth = window.innerWidth;
    const savedHeight = window.innerHeight;
    const savedOrientation = camera.orientation.slice();
    const savedFov = camera.fov;
    const home = portalDefinitions.find(portal => portal.home);
    const viewports = [
        { width: 1920, height: 1080, panelOnLeft: false },
        { width: 1920, height: 1080, panelOnLeft: true },
        { width: 1440, height: 900, panelOnLeft: false },
        { width: 1440, height: 900, panelOnLeft: true },
        { width: 1280, height: 720, panelOnLeft: false },
        { width: 1280, height: 720, panelOnLeft: true },
        { width: 1100, height: 800, panelOnLeft: false },
        { width: 1100, height: 800, panelOnLeft: true },
        { width: 1100, height: 1099, panelOnLeft: false },
        { width: 1100, height: 1099, panelOnLeft: true },
        { width: 1100, height: 1200, panelOnLeft: false },
        { width: 1100, height: 1200, panelOnLeft: true },
        { width: 1100, height: 1466, panelOnLeft: false },
        { width: 1100, height: 1466, panelOnLeft: true },
        { width: 1100, height: 1600, panelOnLeft: false },
        { width: 1100, height: 1600, panelOnLeft: true },
        { width: 1280, height: 1706, panelOnLeft: false },
        { width: 1280, height: 1706, panelOnLeft: true },
        { width: 1280, height: 1279, panelOnLeft: false },
        { width: 1280, height: 1279, panelOnLeft: true },
        { width: 1280, height: 1400, panelOnLeft: false },
        { width: 1280, height: 1400, panelOnLeft: true },
        { width: 1280, height: 959, panelOnLeft: false },
        { width: 1280, height: 959, panelOnLeft: true },
        { width: 1200, height: 900, panelOnLeft: false },
        { width: 1201, height: 900, panelOnLeft: false },
        { width: 1201, height: 900, panelOnLeft: true },
        { width: 1200, height: 800, panelOnLeft: false },
        { width: 1201, height: 800, panelOnLeft: false },
        { width: 1201, height: 800, panelOnLeft: true },
        { width: 1280, height: 1920, panelOnLeft: false },
        { width: 1280, height: 1920, panelOnLeft: true },
        { width: 1440, height: 1919, panelOnLeft: false },
        { width: 1440, height: 1919, panelOnLeft: true },
        { width: 1440, height: 1439, panelOnLeft: false },
        { width: 1440, height: 1439, panelOnLeft: true },
        { width: 1440, height: 1079, panelOnLeft: false },
        { width: 1440, height: 1079, panelOnLeft: true },
        { width: 1440, height: 2560, panelOnLeft: false },
        { width: 1440, height: 2560, panelOnLeft: true },
        { width: 1025, height: 1366, panelOnLeft: false },
        { width: 1025, height: 1366, panelOnLeft: true },
        { width: 1025, height: 1024, panelOnLeft: false },
        { width: 1025, height: 1024, panelOnLeft: true },
        { width: 1025, height: 768, panelOnLeft: false },
        { width: 1025, height: 768, panelOnLeft: true },
        { width: 1024, height: 768, panelOnLeft: false },
        { width: 820, height: 1180, panelOnLeft: false },
        { width: 768, height: 1024, panelOnLeft: false },
        { width: 600, height: 900, panelOnLeft: false },
        { width: 414, height: 896, panelOnLeft: false },
        { width: 390, height: 844, panelOnLeft: false },
        { width: 375, height: 667, panelOnLeft: false },
        { width: 360, height: 800, panelOnLeft: false },
        { width: 320, height: 568, panelOnLeft: false },
        { width: 844, height: 390, panelOnLeft: false },
        { width: 844, height: 390, panelOnLeft: true },
        { width: 740, height: 360, panelOnLeft: false },
        { width: 740, height: 360, panelOnLeft: true },
        { width: 720, height: 405, panelOnLeft: false },
        { width: 720, height: 405, panelOnLeft: true },
        { width: 720, height: 420, panelOnLeft: false },
        { width: 720, height: 420, panelOnLeft: true },
        { width: 720, height: 421, panelOnLeft: false },
        { width: 720, height: 421, panelOnLeft: true },
        { width: 667, height: 390, panelOnLeft: false },
        { width: 667, height: 390, panelOnLeft: true },
        { width: 667, height: 420, panelOnLeft: false },
        { width: 667, height: 420, panelOnLeft: true },
        { width: 667, height: 421, panelOnLeft: false },
        { width: 667, height: 421, panelOnLeft: true },
        { width: 640, height: 360, panelOnLeft: false },
        { width: 640, height: 360, panelOnLeft: true },
        { width: 640, height: 420, panelOnLeft: false },
        { width: 640, height: 420, panelOnLeft: true },
        { width: 640, height: 421, panelOnLeft: false },
        { width: 640, height: 421, panelOnLeft: true },
        { width: 800, height: 450, panelOnLeft: false },
        { width: 800, height: 450, panelOnLeft: true },
        { width: 600, height: 360, panelOnLeft: false },
        { width: 600, height: 360, panelOnLeft: true },
        { width: 540, height: 360, panelOnLeft: false },
        { width: 540, height: 360, panelOnLeft: true },
        { width: 568, height: 320, panelOnLeft: false },
        { width: 480, height: 320, panelOnLeft: false },
        { width: 1024, height: 576, panelOnLeft: false },
        { width: 1024, height: 575, panelOnLeft: false },
        { width: 1024, height: 575, panelOnLeft: true },
        { width: 900, height: 520, panelOnLeft: false },
        { width: 900, height: 521, panelOnLeft: false },
        { width: 800, height: 520, panelOnLeft: false },
        { width: 800, height: 521, panelOnLeft: false },
        { width: 780, height: 520, panelOnLeft: false },
        { width: 780, height: 521, panelOnLeft: false }
    ];
    let cases = 0;
    let allVisible = true;
    let allInsideSafeFrame = true;
    let maximumFov = 0;
    let maximumFovCase = null;
    let minimumBasisDeterminant = Infinity;
    let maximumAngularError = 0;
    const failures = [];
    viewports.forEach(viewport => {
        window.innerWidth = viewport.width;
        window.innerHeight = viewport.height;
        resizeOverlay();
        Object.entries(homeStarTargets).forEach(([sourceHipText, action]) => {
            const sourceHip = Number(sourceHipText);
            const sourceIndex = home.patternHips.indexOf(sourceHip);
            const source = home.patternPoints[sourceIndex];
            const destination = routeDestination(home, action);
            const target = destination.direction || source;
            const framing = interstellarRouteFraming(
                source,
                target,
                viewport.panelOnLeft
            );
            if (framing.fov / DEG > maximumFov) {
                maximumFov = framing.fov / DEG;
                maximumFovCase = { viewport, sourceHip, action };
            }
            camera.orientation = framing.orientation.slice();
            camera.fov = framing.fov;
            const basis = cameraBasis();
            minimumBasisDeterminant = Math.min(
                minimumBasisDeterminant,
                dot(cross(basis.right, basis.up), basis.forward)
            );
            const points = [source, target].map(direction =>
                projectDirection(
                    direction,
                    basis,
                    viewport.width,
                    viewport.height,
                    framing.fov
                )
            );
            const focal = (viewport.height * 0.5) /
                Math.tan(framing.fov * 0.5);
            const screenRays = points.map(point => normalize([
                (point.x - viewport.width * 0.5) / focal,
                (viewport.height * 0.5 - point.y) / focal,
                1
            ]));
            const screenSeparation = Math.atan2(
                vectorLength(cross(screenRays[0], screenRays[1])),
                dot(screenRays[0], screenRays[1])
            );
            const worldSeparation = Math.atan2(
                vectorLength(cross(source, target)),
                dot(source, target)
            );
            maximumAngularError = Math.max(
                maximumAngularError,
                Math.abs(screenSeparation - worldSeparation)
            );
            allVisible = allVisible && points.every(point => point?.visible);
            let safeLeft;
            let safeRight;
            let safeTop;
            let safeBottom;
            if (usesCompactRouteLayout(viewport.width, viewport.height)) {
                safeLeft = 30;
                safeRight = viewport.width - 30;
                safeTop = 66;
                const shortCompactRoute =
                    viewport.width <= 1024 && viewport.height <= 520;
                safeBottom = Math.max(
                    safeTop + 100,
                    shortCompactRoute
                        ? viewport.height * 0.64 - 50
                        : viewport.height -
                            Math.min(viewport.height * 0.44, 188) -
                            50
                );
            } else {
                const panelWidth = clamp(viewport.width * 0.3, 320, 370);
                safeTop = 76;
                safeBottom = viewport.height - 48;
                if (viewport.panelOnLeft) {
                    safeLeft = 28 + panelWidth + 38;
                    safeRight = viewport.width - 38;
                } else {
                    safeLeft = 38;
                    safeRight = viewport.width - 28 - panelWidth - 38;
                }
            }
            if (safeRight - safeLeft < 150) {
                safeLeft = 30;
                safeRight = viewport.width - 30;
            }
            allInsideSafeFrame = allInsideSafeFrame && points.every(point =>
                point &&
                point.x >= safeLeft - 1 &&
                point.x <= safeRight + 1 &&
                point.y >= safeTop - 1 &&
                point.y <= safeBottom + 1
            );
            if (
                !points.every(point => point?.visible) ||
                !points.every(point =>
                    point &&
                    point.x >= safeLeft - 1 &&
                    point.x <= safeRight + 1 &&
                    point.y >= safeTop - 1 &&
                    point.y <= safeBottom + 1
                )
            ) {
                failures.push({
                    viewport,
                    sourceHip,
                    action: action.type === 'home' ? 'home' : action.portalId,
                    fov: framing.fov / DEG,
                    points,
                    safe: [safeLeft, safeRight, safeTop, safeBottom]
                });
            }
            cases += 1;
        });
    });
    window.innerWidth = savedWidth;
    window.innerHeight = savedHeight;
    resizeOverlay();
    camera.orientation = savedOrientation;
    camera.fov = savedFov;
    return JSON.stringify({
        cases,
        viewportCount: viewports.length,
        routeTargetCount: Object.keys(homeStarTargets).length,
        maximumFov,
        maximumFovCase,
        minimumBasisDeterminant,
        maximumAngularError,
        allVisible,
        allInsideSafeFrame,
        failures
    });
})()`, runtimeContext));
assert.equal(
    routeFramingState.cases,
    routeFramingState.viewportCount * routeFramingState.routeTargetCount
);
assert.equal(routeFramingState.cases, 940);
assert(
    routeFramingState.maximumFov < 125,
    `Responsive route framing must stay below the visual-quality FOV limit: ` +
    JSON.stringify(routeFramingState.maximumFovCase)
);
assert(routeFramingState.minimumBasisDeterminant > 1 - 1e-10);
assert(
    routeFramingState.maximumAngularError < 1e-8,
    `Route projection angular error: ${routeFramingState.maximumAngularError}`
);
assert.deepEqual(
    routeFramingState.failures,
    [],
    'Every Home route must fit both stars inside the desktop and mobile safe frames'
);

const routeOrientationContinuity = JSON.parse(vm.runInContext(`(() => {
    const savedWidth = window.innerWidth;
    const savedHeight = window.innerHeight;
    const home = portalDefinitions.find(portal => portal.home);
    const sourceHip = 70692;
    const source = home.patternPoints[home.patternHips.indexOf(sourceHip)];
    const destination = routeDestination(home, homeStarTargets[sourceHip]);
    const orientations = [1025, 1026].map(width => {
        window.innerWidth = width;
        window.innerHeight = 683;
        resizeOverlay();
        return interstellarRouteFraming(
            source,
            destination.direction,
            false
        ).orientation;
    });
    const quaternionDot = Math.abs(orientations[0].reduce(
        (sum, value, index) => sum + value * orientations[1][index],
        0
    ));
    const angularChange = 2 * Math.acos(clamp(quaternionDot, -1, 1)) / DEG;
    window.innerWidth = savedWidth;
    window.innerHeight = savedHeight;
    resizeOverlay();
    return JSON.stringify({ angularChange });
})()`, runtimeContext));
assert(
    routeOrientationContinuity.angularChange < 5,
    `A one-pixel viewport change must not flip the route composition: ` +
    `${routeOrientationContinuity.angularChange.toFixed(3)}°`
);

const constellationFramingState = JSON.parse(vm.runInContext(`(() => {
    const savedWidth = window.innerWidth;
    const savedHeight = window.innerHeight;
    const savedOrientation = camera.orientation.slice();
    const savedFov = camera.fov;
    const viewports = [
        { width: 1440, height: 900, panelOnLeft: false },
        { width: 1440, height: 900, panelOnLeft: true },
        { width: 1366, height: 768, panelOnLeft: false },
        { width: 1366, height: 768, panelOnLeft: true },
        { width: 1201, height: 800, panelOnLeft: false },
        { width: 1201, height: 800, panelOnLeft: true },
        { width: 1200, height: 900, panelOnLeft: false },
        { width: 1024, height: 600, panelOnLeft: false },
        { width: 1024, height: 576, panelOnLeft: false },
        { width: 1024, height: 575, panelOnLeft: false },
        { width: 1024, height: 575, panelOnLeft: true },
        { width: 900, height: 520, panelOnLeft: false },
        { width: 900, height: 520, panelOnLeft: true },
        { width: 900, height: 521, panelOnLeft: false },
        { width: 900, height: 521, panelOnLeft: true },
        { width: 800, height: 520, panelOnLeft: false },
        { width: 800, height: 520, panelOnLeft: true },
        { width: 800, height: 521, panelOnLeft: false },
        { width: 800, height: 521, panelOnLeft: true },
        { width: 780, height: 520, panelOnLeft: false },
        { width: 780, height: 520, panelOnLeft: true },
        { width: 780, height: 521, panelOnLeft: false },
        { width: 780, height: 521, panelOnLeft: true },
        { width: 844, height: 390, panelOnLeft: false },
        { width: 844, height: 390, panelOnLeft: true },
        { width: 740, height: 360, panelOnLeft: false },
        { width: 740, height: 360, panelOnLeft: true },
        { width: 720, height: 405, panelOnLeft: false },
        { width: 720, height: 405, panelOnLeft: true },
        { width: 720, height: 420, panelOnLeft: false },
        { width: 720, height: 420, panelOnLeft: true },
        { width: 720, height: 421, panelOnLeft: false },
        { width: 720, height: 421, panelOnLeft: true },
        { width: 667, height: 390, panelOnLeft: false },
        { width: 667, height: 390, panelOnLeft: true },
        { width: 667, height: 420, panelOnLeft: false },
        { width: 667, height: 420, panelOnLeft: true },
        { width: 667, height: 421, panelOnLeft: false },
        { width: 667, height: 421, panelOnLeft: true },
        { width: 640, height: 360, panelOnLeft: false },
        { width: 640, height: 360, panelOnLeft: true },
        { width: 640, height: 420, panelOnLeft: false },
        { width: 640, height: 420, panelOnLeft: true },
        { width: 640, height: 421, panelOnLeft: false },
        { width: 640, height: 421, panelOnLeft: true },
        { width: 800, height: 450, panelOnLeft: false },
        { width: 800, height: 450, panelOnLeft: true },
        { width: 600, height: 360, panelOnLeft: false },
        { width: 600, height: 360, panelOnLeft: true },
        { width: 540, height: 360, panelOnLeft: false },
        { width: 540, height: 360, panelOnLeft: true },
        { width: 568, height: 320, panelOnLeft: false },
        { width: 568, height: 320, panelOnLeft: true },
        { width: 480, height: 320, panelOnLeft: false },
        { width: 480, height: 320, panelOnLeft: true },
        { width: 768, height: 1024, panelOnLeft: false },
        { width: 414, height: 896, panelOnLeft: false },
        { width: 390, height: 844, panelOnLeft: false },
        { width: 360, height: 800, panelOnLeft: false },
        { width: 320, height: 568, panelOnLeft: false }
    ];
    const failures = [];
    let cases = 0;
    viewports.forEach(viewport => {
        window.innerWidth = viewport.width;
        window.innerHeight = viewport.height;
        resizeOverlay();
        const compact = usesCompactSkyLayout(viewport.width, viewport.height);
        const hitRadius = viewport.width <= 760 ? 38 : 32;
        const aspect = viewport.width / viewport.height;
        const shortLandscape =
            viewport.height <= SHORT_SKY_MAX_HEIGHT &&
            aspect >= SHORT_SKY_MIN_ASPECT;
        const narrowLandscape = !shortLandscape &&
            viewport.width <= COMPACT_SKY_MAX_WIDTH &&
            aspect > COMPACT_SKY_NARROW_MAX_ASPECT;
        const panelWidth = shortLandscape
            ? clamp(viewport.width * 0.34, 180, 280)
            : (
                narrowLandscape
                    ? clamp(viewport.width * 0.42, 286, 340)
                    : clamp(viewport.width * 0.42, 370, 610)
            );
        const panelInset = shortLandscape ? 18 : 28;
        const panelLeft = viewport.panelOnLeft
            ? panelInset
            : viewport.width - panelInset - panelWidth;
        const panelRight = panelLeft + panelWidth;
        const panelTop = viewport.height * 0.5 - 34;
        portalDefinitions.forEach(portal => {
            const framing = constellationFraming(portal, viewport.panelOnLeft);
            camera.orientation = framing.orientation.slice();
            camera.fov = framing.fov;
            const basis = cameraBasis();
            portal.patternPoints.forEach((direction, index) => {
                const point = projectDirection(
                    direction,
                    basis,
                    viewport.width,
                    viewport.height,
                    framing.fov
                );
                const insideViewport = point?.visible &&
                    point.x - hitRadius >= -1 &&
                    point.x + hitRadius <= viewport.width + 1 &&
                    point.y - hitRadius >= -1 &&
                    point.y + hitRadius <= viewport.height + 1;
                const clearOfPanel = compact
                    ? point?.y + hitRadius <= panelTop - 7
                    : (
                        viewport.panelOnLeft
                            ? point?.x - hitRadius >= panelRight + 7
                            : point?.x + hitRadius <= panelLeft - 7
                    );
                if (!insideViewport || !clearOfPanel) {
                    failures.push({
                        viewport,
                        portal: portal.id,
                        hip: portal.patternHips[index],
                        point,
                        hitRadius,
                        panel: compact
                            ? { compact, top: panelTop }
                            : { compact, left: panelLeft, right: panelRight }
                    });
                }
                cases += 1;
            });
        });
    });
    window.innerWidth = savedWidth;
    window.innerHeight = savedHeight;
    resizeOverlay();
    camera.orientation = savedOrientation;
    camera.fov = savedFov;
    return JSON.stringify({ cases, viewportCount: viewports.length, failures });
})()`, runtimeContext));
assert(constellationFramingState.cases > 1000);
assert.deepEqual(
    constellationFramingState.failures,
    [],
    'Every constellation star hit target must remain fully clear of its detail panel'
);

const cameraRollState = JSON.parse(vm.runInContext(`(() => {
    const savedOrientation = camera.orientation.slice();
    const savedTargetOrientation = camera.targetOrientation.slice();
    const savedFov = camera.fov;
    const savedTargetFov = camera.targetFov;
    const identity = [0, 0, 0, 1];
    const configureRoam = () => {
        state.scene = 'roam';
        state.hasEntered = true;
        state.gateOpen = false;
        state.modalOpen = false;
        state.touchMode = false;
        state.altHeld = false;
        state.altReturnMode = null;
        state.relockPending = false;
        state.flight = null;
        state.celestialFlight = null;
        state.celestialVisit = null;
        state.routePreview = null;
        state.lock = 'keyboard-free';
        state.lockIntent = null;
        document.pointerLockElement = null;
        clearCameraRoll();
    };
    const dispatchKeyDown = (code, { altKey = false } = {}) => {
        const event = {
            type: 'keydown',
            code,
            key: code === 'KeyA' ? 'a' : code === 'KeyD' ? 'd' : 'Alt',
            altKey,
            target: dom.world
        };
        document.dispatchEvent(event);
        return event;
    };
    const dispatchKeyUp = code => {
        const event = {
            type: 'keyup',
            code,
            key: code === 'KeyA' ? 'a' : code === 'KeyD' ? 'd' : 'Alt',
            altKey: false,
            target: dom.world
        };
        window.dispatchEvent(event);
        return event;
    };
    const quaternionDot = (left, right) => Math.abs(left.reduce(
        (sum, value, index) => sum + value * right[index],
        0
    ));
    const sampleHold = (frames, deltaSeconds) => {
        configureRoam();
        camera.orientation = identity.slice();
        camera.targetOrientation = identity.slice();
        const event = dispatchKeyDown('KeyA');
        for (let frame = 0; frame < frames; frame += 1) {
            updateCameraRoll(deltaSeconds);
        }
        dispatchKeyUp('KeyA');
        return {
            orientation: camera.targetOrientation.slice(),
            prevented: event.defaultPrevented
        };
    };
    const sixtyFps = sampleHold(60, 1 / 60);
    const thirtyFps = sampleHold(30, 1 / 30);
    const frameRateAngularError = 2 * Math.acos(clamp(
        quaternionDot(sixtyFps.orientation, thirtyFps.orientation),
        -1,
        1
    ));
    const forward = quatRotate(sixtyFps.orientation, [0, 0, 1]);
    const right = quatRotate(sixtyFps.orientation, [1, 0, 0]);
    const forwardInvariant = dot(forward, [0, 0, 1]) > 1 - 1e-12;
    const rightRotated = dot(right, [1, 0, 0]) < 0.9;

    configureRoam();
    camera.orientation = identity.slice();
    camera.targetOrientation = identity.slice();
    dispatchKeyDown('KeyA');
    for (let frame = 0; frame < 60; frame += 1) updateCameraRoll(1 / 60);
    dispatchKeyUp('KeyA');
    for (let frame = 0; frame < 180; frame += 1) updateCameraRoll(1 / 60);
    const afterA = camera.targetOrientation.slice();
    dispatchKeyDown('KeyD');
    for (let frame = 0; frame < 60; frame += 1) updateCameraRoll(1 / 60);
    dispatchKeyUp('KeyD');
    for (let frame = 0; frame < 180; frame += 1) updateCameraRoll(1 / 60);
    const afterAD = camera.targetOrientation.slice();
    const aThenDReturns = (
        quaternionDot(identity, afterA) < 0.99 &&
        quaternionDot(identity, afterAD) > 1 - 1e-10
    );

    configureRoam();
    const altChordEvent = dispatchKeyDown('KeyA', { altKey: true });
    const altChordPassesThrough = (
        !altChordEvent.defaultPrevented &&
        !state.rollLeftHeld &&
        state.rollVelocity === 0
    );

    const primeRoll = () => {
        configureRoam();
        dispatchKeyDown('KeyA');
        updateCameraRoll(1 / 60);
    };
    primeRoll();
    state.lock = 'locked';
    document.pointerLockElement = dom.world;
    dispatchKeyDown('Alt', { altKey: true });
    const altClears = (
        state.altHeld &&
        !state.rollLeftHeld &&
        !state.rollRightHeld &&
        state.rollVelocity === 0
    );

    primeRoll();
    window.dispatchEvent({ type: 'blur' });
    const blurClears = (
        !state.rollLeftHeld &&
        !state.rollRightHeld &&
        state.rollVelocity === 0
    );

    primeRoll();
    document.hidden = true;
    document.dispatchEvent({ type: 'visibilitychange' });
    const visibilityClears = (
        !state.rollLeftHeld &&
        !state.rollRightHeld &&
        state.rollVelocity === 0
    );
    document.hidden = false;
    startRendering();

    primeRoll();
    const portal = portalDefinitions.find(candidate => !candidate.home);
    startPortalFlight(portal, 'keyboard');
    const flightClears = (
        state.scene === 'flying' &&
        !state.rollLeftHeld &&
        !state.rollRightHeld &&
        state.rollVelocity === 0
    );
    cancelFlight('keyboard');

    primeRoll();
    state.scene = 'detail';
    updateCameraRoll(1 / 60);
    const nonRoamClears = (
        !state.rollLeftHeld &&
        !state.rollRightHeld &&
        state.rollVelocity === 0
    );
    const detailKey = dispatchKeyDown('KeyD');
    const nonRoamIgnoresKey = (
        !detailKey.defaultPrevented &&
        !state.rollRightHeld
    );

    configureRoam();
    camera.orientation = savedOrientation;
    camera.targetOrientation = savedTargetOrientation;
    camera.fov = savedFov;
    camera.targetFov = savedTargetFov;
    return JSON.stringify({
        keyAccepted: sixtyFps.prevented,
        forwardInvariant,
        rightRotated,
        aThenDReturns,
        frameRateAngularError,
        altChordPassesThrough,
        altClears,
        blurClears,
        visibilityClears,
        flightClears,
        nonRoamClears,
        nonRoamIgnoresKey
    });
})()`, runtimeContext));
assert(cameraRollState.keyAccepted, 'A must engage continuous roll in roam mode');
assert(cameraRollState.forwardInvariant, 'Local-Z camera roll must preserve the view forward vector');
assert(cameraRollState.rightRotated, 'Local-Z camera roll must rotate the camera right/up basis');
assert(cameraRollState.aThenDReturns, 'Equal settled A/D holds must return near the original orientation');
assert(
    cameraRollState.frameRateAngularError < 0.01,
    `Camera roll must remain frame-rate independent; angular error ${cameraRollState.frameRateAngularError}`
);
for (const cleanup of [
    'altChordPassesThrough',
    'altClears',
    'blurClears',
    'visibilityClears',
    'flightClears',
    'nonRoamClears',
    'nonRoamIgnoresKey'
]) {
    assert(cameraRollState[cleanup], `Camera roll input regression failed: ${cleanup}`);
}

const altState = JSON.parse(vm.runInContext(`(() => {
    state.hasEntered = true;
    state.scene = 'roam';
    state.gateOpen = false;
    state.modalOpen = false;
    state.touchMode = false;
    state.lock = 'locked';
    document.pointerLockElement = dom.world;
    releaseCursorForAlt();
    const released = state.altHeld &&
        state.altReturnMode === 'locked' &&
        document.pointerLockElement === null;
    handlePointerLockChange();
    const freeWhileHeld = state.altHeld && state.lock === 'alt-free';
    recoverMissingAltKeyup();
    const requestedAgain = !state.altHeld &&
        state.lock === 'requesting' &&
        document.pointerLockElement === dom.world;
    handlePointerLockChange();
    return JSON.stringify({
        released,
        freeWhileHeld,
        requestedAgain,
        relocked: state.lock === 'locked' && !state.altHeld
    });
})()`, runtimeContext));
assert.deepEqual(altState, {
    released: true,
    freeWhileHeld: true,
    requestedAgain: true,
    relocked: true
}, 'Alt must act as a hold-to-release, release-to-relock clutch');

const panelState = JSON.parse(vm.runInContext(`(() => {
    const testPortal = portalDefinitions.find(portal => !portal.home);
    state.activationSource = 'pointer';
    state.gateOpen = false;
    state.scene = 'roam';
    document.pointerLockElement = null;
    openPortalPanel(testPortal, true);
    const portalOpened = !dom.panel.inert &&
        dom.body.classList.contains('panel-open') &&
        state.panelSidePreference;
    document.activeElement = dom.panel;
    closePortalPanel(true, 'keyboard');
    const portalClosed = dom.panel.inert &&
        !dom.body.classList.contains('panel-open') &&
        state.scene === 'roam' &&
        state.lock === 'keyboard-free';

    const testBody = celestialBodies.find(profile => profile.id === 'jupiter');
    state.activationSource = 'pointer';
    dom.celestialPanelBody.scrollTop = 77;
    const visit = {
        profile: testBody,
        phase: 'approach',
        preferredPanelOnLeft: true,
        panelOnLeft: true,
        visualProgress: 1,
        origin: {
            orientation: camera.orientation.slice(),
            targetOrientation: camera.targetOrientation.slice(),
            fov: camera.fov,
            targetFov: camera.targetFov,
            wasPointerLocked: false,
            lock: state.lock
        }
    };
    state.celestialVisit = visit;
    state.activeCelestial = testBody;
    openCelestialPanel(testBody, true);
    const celestialOpened = !dom.celestialPanel.inert &&
        dom.body.classList.contains('celestial-open') &&
        visit.phase === 'observing' &&
        state.panelSidePreference &&
        dom.celestialPanelBody.scrollTop === 0;
    document.activeElement = dom.celestialPanel;
    closeCelestialPanel(true, 'keyboard');
    const celestialClosed = dom.celestialPanel.inert &&
        !dom.body.classList.contains('celestial-open') &&
        state.scene === 'flying' &&
        visit.phase === 'returning' &&
        state.activeCelestial === testBody;
    completeCelestialReturn(visit);
    return JSON.stringify({ portalOpened, portalClosed, celestialOpened, celestialClosed });
})()`, runtimeContext));
assert.deepEqual(panelState, {
    portalOpened: true,
    portalClosed: true,
    celestialOpened: true,
    celestialClosed: true
}, 'Detail panels must open interactively and celestial close must retain its return state');

const routeState = JSON.parse(vm.runInContext(`(() => {
    const home = portalDefinitions.find(portal => portal.home);
    const sun = celestialBodies.find(profile => profile.id === 'sun');
    const savedSunAltitude = sun.current?.altitude;
    if (sun.current) sun.current.altitude = -30;
    const sourceHip = Number(Object.keys(homeStarTargets).find(hip =>
        homeStarTargets[hip].type === 'portal' &&
        portalAvailableInSky(
            routeDestination(home, homeStarTargets[hip]).portal
        )
    ));
    state.activationSource = 'keyboard';
    state.gateOpen = false;
    state.scene = 'roam';
    state.flight = null;
    const originalPanelRect = dom.panel.getBoundingClientRect;
    dom.panel.getBoundingClientRect = () => {
        const routeClass = dom.body.classList.contains('route-preview-active');
        const routeVisible = !dom.homeRoutePreview.hidden;
        const width = routeClass === routeVisible
            ? (routeClass ? 320 : 600)
            : 444;
        return {
            left: 1440 - 28 - width,
            right: 1440 - 28,
            top: 78,
            bottom: 866,
            width,
            height: 788
        };
    };
    openPortalPanel(home, false);
    if (!dom.panel.contains(dom.homeRoutePreview)) {
        dom.panel.append(dom.homeRoutePreview);
        dom.homeRoutePreview.append(dom.homeRouteLaunch, dom.homeRouteCancel);
    }
    previewHomeRoute(home, sourceHip);
    const previewCreated = Boolean(state.routePreview) &&
        state.flight === null &&
        !dom.homeRoutePreview.hidden &&
        dom.body.classList.contains('route-preview-active') &&
        state.panelRect.width === 320;
    cancelHomeRoutePreview();
    const previewCancelledCleanly =
        !dom.body.classList.contains('route-preview-active') &&
        state.panelRect.width === 600;
    previewHomeRoute(home, sourceHip);
    const expectedArrivalHip = state.routePreview.targetHip;
    launchHomeRoute();
    const blockedUntilConfirmed = state.flight === null &&
        Boolean(state.routePreview);
    state.routePreview.settled = true;
    document.activeElement = dom.homeRouteLaunch;
    launchHomeRoute();
    const launchedAfterConfirmation = state.scene === 'flying' &&
        state.routePreview === null &&
        state.flight?.arrivalHip === expectedArrivalHip &&
        state.activationSource === 'keyboard' &&
        dom.panel.inert &&
        document.activeElement === dom.world &&
        !dom.body.classList.contains('route-preview-active');
    cancelFlight();
    dom.panel.getBoundingClientRect = originalPanelRect;
    if (sun.current) sun.current.altitude = savedSunAltitude;
    return JSON.stringify({
        previewCreated,
        previewCancelledCleanly,
        blockedUntilConfirmed,
        launchedAfterConfirmation
    });
})()`, runtimeContext));
assert.deepEqual(routeState, {
    previewCreated: true,
    previewCancelledCleanly: true,
    blockedUntilConfirmed: true,
    launchedAfterConfirmation: true
}, 'Home routes must remain a preview-first, explicit-confirmation navigation');

const belowHorizonHomeRouteState = JSON.parse(vm.runInContext(`(() => {
    const home = portalDefinitions.find(portal => portal.home);
    const routeEntry = Object.entries(homeStarTargets).find(([, action]) => {
        if (action.type !== 'portal') return false;
        const destination = routeDestination(home, action);
        return destination?.portal && !isAboveHorizon(destination.direction);
    });
    if (!routeEntry) {
        return JSON.stringify({ available: false });
    }
    const [sourceHipText, action] = routeEntry;
    const destination = routeDestination(home, action);
    const savedPreview = state.routePreview;
    const originalStartPortalFlight = startPortalFlight;
    const originalOpenPortalPanel = openPortalPanel;
    const calls = [];
    startPortalFlight = (...args) => calls.push({
        kind: 'flight',
        portal: args[0]?.id
    });
    openPortalPanel = (...args) => calls.push({
        kind: 'panel',
        portal: args[0]?.id,
        preferredHip: args[2] ?? null
    });
    state.routePreview = {
        sourcePortal: home,
        sourceHip: Number(sourceHipText),
        action,
        targetPortal: destination.portal,
        targetHip: destination.hip,
        settled: true
    };
    launchHomeRoute('keyboard');
    const previewCleared = state.routePreview === null;
    startPortalFlight = originalStartPortalFlight;
    openPortalPanel = originalOpenPortalPanel;
    state.routePreview = savedPreview;
    return JSON.stringify({
        available: true,
        targetPortal: destination.portal.id,
        targetHip: destination.hip,
        previewCleared,
        calls
    });
})()`, runtimeContext));
assert(belowHorizonHomeRouteState.available);
assert(belowHorizonHomeRouteState.previewCleared);
assert(
    belowHorizonHomeRouteState.calls.some(call =>
        call.kind === 'panel' &&
        call.portal === belowHorizonHomeRouteState.targetPortal &&
        call.preferredHip === belowHorizonHomeRouteState.targetHip
    ) &&
    !belowHorizonHomeRouteState.calls.some(call => call.kind === 'flight'),
    'A confirmed Home route below the horizon must open its target star directly'
);

const routeResizeState = JSON.parse(vm.runInContext(`(() => {
    const savedWidth = window.innerWidth;
    const savedHeight = window.innerHeight;
    const home = portalDefinitions.find(portal => portal.home);
    const sourceHip = Number(Object.keys(homeStarTargets).find(hip =>
        homeStarTargets[hip].type === 'portal'
    ));
    state.activationSource = 'keyboard';
    state.gateOpen = false;
    state.scene = 'roam';
    window.innerWidth = 1440;
    resizeOverlay();
    openPortalPanel(home, false);
    previewHomeRoute(home, sourceHip);
    const preview = state.routePreview;
    preview.startedAt = performance.now() - preview.duration * 0.72;
    updateCamera(performance.now());
    const beforeOrientation = camera.orientation.slice();
    const beforeFov = camera.fov;
    const beforeReveal = homeRouteReveal(preview, performance.now());
    window.innerWidth = 600;
    handleViewportResize();
    const continuedDestinationLeg = preview.sourceStop === 0;
    const afterReveal = homeRouteReveal(preview, preview.startedAt);
    const revealContinuous = afterReveal >= beforeReveal &&
        afterReveal - beforeReveal < 0.05;
    updateCamera(preview.startedAt);
    const orientationDot = Math.abs(beforeOrientation.reduce(
        (sum, value, index) => sum + value * camera.orientation[index],
        0
    ));
    const noRewind = orientationDot > 1 - 1e-12 &&
        Math.abs(camera.fov - beforeFov) < 1e-12;
    cancelHomeRoutePreview();
    closePortalPanel(false);

    window.innerWidth = 1024;
    window.innerHeight = 592;
    resizeOverlay();
    state.scene = 'roam';
    openPortalPanel(home, false);
    previewHomeRoute(home, 70692);
    const settledPreview = state.routePreview;
    const settledAt = performance.now();
    settledPreview.startedAt = settledAt - settledPreview.duration;
    updateCamera(settledAt);
    const settledOrientation = camera.orientation.slice();
    const settledFov = camera.fov;
    window.innerWidth = 1025;
    handleViewportResize();
    const immediateDot = Math.abs(settledOrientation.reduce(
        (sum, value, index) => sum + value * camera.orientation[index],
        0
    ));
    const settledResizeDoesNotSnap = immediateDot > 1 - 1e-12 &&
        Math.abs(camera.fov - settledFov) < 1e-12;
    const targetDot = Math.abs(settledOrientation.reduce(
        (sum, value, index) => sum + value * camera.targetOrientation[index],
        0
    ));
    const breakpointTargetChange =
        2 * Math.acos(clamp(targetDot, -1, 1)) / DEG;
    const breakpointTargetUpdated = breakpointTargetChange > 20 &&
        state.detailFov === settledPreview.destinationFov &&
        camera.targetFov === settledPreview.destinationFov;
    updateCamera(settledAt + 50);
    const movedDot = Math.abs(settledOrientation.reduce(
        (sum, value, index) => sum + value * camera.orientation[index],
        0
    ));
    const remainingDot = Math.abs(camera.orientation.reduce(
        (sum, value, index) =>
            sum + value * camera.targetOrientation[index],
        0
    ));
    const movedAngle = 2 * Math.acos(clamp(movedDot, -1, 1)) / DEG;
    const remainingAngle = 2 * Math.acos(clamp(remainingDot, -1, 1)) / DEG;
    const settledResizeTransitions = movedAngle > 0.01 &&
        remainingAngle > 0.01 &&
        movedAngle < breakpointTargetChange &&
        remainingAngle < breakpointTargetChange;
    cancelHomeRoutePreview();
    closePortalPanel(false);
    window.innerWidth = savedWidth;
    window.innerHeight = savedHeight;
    resizeOverlay();
    return JSON.stringify({
        continuedDestinationLeg,
        noRewind,
        revealContinuous,
        settledResizeDoesNotSnap,
        breakpointTargetUpdated,
        settledResizeTransitions
    });
})()`, runtimeContext));
assert.deepEqual(routeResizeState, {
    continuedDestinationLeg: true,
    noRewind: true,
    revealContinuous: true,
    settledResizeDoesNotSnap: true,
    breakpointTargetUpdated: true,
    settledResizeTransitions: true
}, 'Resizing a route preview must preserve phase and smoothly cross layout breakpoints');

const selectedTextureState = JSON.parse(vm.runInContext(`(() => {
    const originalPrepare = celestialCloseupRenderer.prepare;
    const prepareCalls = [];
    celestialCloseupRenderer.prepare = profile => {
        prepareCalls.push(profile.id);
        return {
            then() {
                return { catch() {} };
            }
        };
    };
    const testBody = celestialBodies.find(profile => profile.id === 'jupiter');
    const savedOrientation = camera.orientation.slice();
    const savedTargetOrientation = camera.targetOrientation.slice();
    const savedFov = camera.fov;
    const savedTargetFov = camera.targetFov;
    testBody.screen = { visible: true, x: 1100, y: 420 };
    state.scene = 'roam';
    state.gateOpen = false;
    state.modalOpen = false;
    state.touchMode = false;
    state.celestialVisit = null;
    state.celestialFlight = null;
    state.flight = null;
    document.pointerLockElement = null;
    startCelestialFlight(testBody, 'keyboard');
    const selected = state.celestialVisit?.profile?.id;
    const visit = state.celestialVisit;
    visit.restoreFocus = false;
    completeCelestialReturn(visit);
    celestialCloseupRenderer.prepare = originalPrepare;
    camera.orientation = savedOrientation;
    camera.targetOrientation = savedTargetOrientation;
    camera.fov = savedFov;
    camera.targetFov = savedTargetFov;
    return JSON.stringify({ prepareCalls, selected });
})()`, runtimeContext));
assert.deepEqual(selectedTextureState, {
    prepareCalls: ['jupiter'],
    selected: 'jupiter'
}, 'Starting a close-up must prepare only the selected celestial profile');

const celestialTextureWatchdogState = JSON.parse(vm.runInContext(`(() => {
    __mockTimers.reset();
    const profile = celestialBodies.find(body => body.id === 'venus');
    const savedScreen = profile.screen;
    const savedSurface = celestialCloseupRenderer.images.get(profile.texture);
    const hadSurface = celestialCloseupRenderer.images.has(profile.texture);
    const hadImageConstructor = 'Image' in globalThis;
    const originalImageConstructor = globalThis.Image;
    class NeverSettlingImage {
        set src(value) {
            this.currentSrc = value;
        }
    }
    globalThis.Image = NeverSettlingImage;
    profile.screen = { visible: true, x: 980, y: 390 };
    state.scene = 'roam';
    state.hasEntered = true;
    state.gateOpen = false;
    state.modalOpen = false;
    state.touchMode = false;
    state.altHeld = false;
    state.celestialVisit = null;
    state.celestialFlight = null;
    state.flight = null;
    document.pointerLockElement = null;

    startCelestialFlight(profile, 'keyboard');
    const visit = state.celestialVisit;
    const timersBefore = __mockTimers.snapshot();
    const watchdogDelay = timersBefore.find(
        timer => timer.id === visit.textureWatchdog
    )?.delay ?? null;
    const imageTimeoutDelay = Math.max(
        ...timersBefore
            .filter(timer => timer.id !== visit.textureWatchdog)
            .map(timer => timer.delay)
    );
    const originalWarn = console.warn;
    console.warn = () => {};
    __mockTimers.runAll();
    console.warn = originalWarn;
    const fallbackInstalled = (
        celestialCloseupRenderer.images.get(profile.texture)?.tagName === 'CANVAS'
    );
    const fallbackReady = (
        visit.textureReady &&
        visit.textureError &&
        visit.textureWatchdog === null &&
        Number.isFinite(visit.visualStartedAt)
    );
    const observingAt = Math.max(
        visit.transition.startedAt + visit.transition.duration,
        visit.visualStartedAt + visit.visualDuration
    ) + 1;
    updateCamera(observingAt);
    const observingReached = (
        visit.profile.id === 'venus' &&
        visit.phase === 'observing' &&
        state.scene === 'detail' &&
        state.celestialVisit === visit &&
        state.celestialFlight === null &&
        !dom.celestialPanel.inert
    );

    completeCelestialReturn(visit);
    celestialCloseupRenderer.imagePromises.delete(profile.texture);
    if (hadSurface) {
        celestialCloseupRenderer.images.set(profile.texture, savedSurface);
    } else {
        celestialCloseupRenderer.images.delete(profile.texture);
    }
    profile.screen = savedScreen;
    if (hadImageConstructor) {
        globalThis.Image = originalImageConstructor;
    } else {
        delete globalThis.Image;
    }
    __mockTimers.reset();
    return JSON.stringify({
        imageTimeoutDelay,
        watchdogDelay,
        watchdogFollowsImageTimeout: watchdogDelay > imageTimeoutDelay,
        fallbackInstalled,
        fallbackReady,
        observingReached
    });
})()`, runtimeContext));
assert.deepEqual(celestialTextureWatchdogState, {
    imageTimeoutDelay: 4000,
    watchdogDelay: 4800,
    watchdogFollowsImageTimeout: true,
    fallbackInstalled: true,
    fallbackReady: true,
    observingReached: true
}, 'A never-settling Venus image must time out to a generated surface and still complete its observing approach');

const celestialStageState = JSON.parse(vm.runInContext(`(() => {
    const profiles = [
        celestialBodies.find(profile => profile.id === 'jupiter'),
        celestialBodies.find(profile => profile.id === 'saturn')
    ];
    const viewports = [
        [320, 568],
        [360, 800],
        [568, 320],
        [844, 390],
        [1024, 576],
        [1025, 683],
        [1440, 900],
        [2560, 1080]
    ];
    const failures = [];
    let cases = 0;
    viewports.forEach(([width, height]) => {
        profiles.forEach(profile => {
            const layouts = [false, true].map(panelOnLeft =>
                celestialStageLayout(profile, panelOnLeft, width, height)
            );
            layouts.forEach((stage, index) => {
                const panelOnLeft = Boolean(index);
                const finite = [
                    stage.centerX,
                    stage.centerY,
                    stage.radius
                ].every(Number.isFinite) && stage.radius > 0;
                const diskInsideViewport = finite &&
                    stage.centerX - stage.radius >= -0.5 &&
                    stage.centerX + stage.radius <= width + 0.5 &&
                    stage.centerY - stage.radius >= -0.5 &&
                    stage.centerY + stage.radius <= height + 0.5;
                let clearOfDesktopPanel = true;
                if (!usesCompactSkyLayout(width, height)) {
                    const shortLandscape =
                        height <= SHORT_SKY_MAX_HEIGHT &&
                        width / Math.max(1, height) >= SHORT_SKY_MIN_ASPECT;
                    const panelWidth = shortLandscape
                        ? clamp(width * 0.33, 176, 270)
                        : clamp(width * 0.38, 350, 540);
                    const panelInset = shortLandscape ? 18 : 28;
                    if (panelOnLeft) {
                        clearOfDesktopPanel =
                            stage.centerX - stage.radius >=
                            Math.min(width, panelInset + panelWidth + 18) - 0.5;
                    } else {
                        clearOfDesktopPanel =
                            stage.centerX + stage.radius <=
                            Math.max(
                                0,
                                width - panelInset - panelWidth - 18
                            ) + 0.5;
                    }
                }
                if (!finite || !diskInsideViewport || !clearOfDesktopPanel) {
                    failures.push({
                        width,
                        height,
                        profile: profile.id,
                        panelOnLeft,
                        stage,
                        finite,
                        diskInsideViewport,
                        clearOfDesktopPanel
                    });
                }
                cases += 1;
            });
            const compact = usesCompactSkyLayout(width, height);
            const mirrored = compact
                ? Math.abs(layouts[0].centerX - layouts[1].centerX) < 1e-9
                : Math.abs(layouts[0].centerX + layouts[1].centerX - width) < 1e-9;
            if (!mirrored) {
                failures.push({
                    width,
                    height,
                    profile: profile.id,
                    mirrored: false,
                    layouts
                });
            }
        });
    });
    return JSON.stringify({ cases, failures });
})()`, runtimeContext));
assert.equal(celestialStageState.cases, 32);
assert.deepEqual(
    celestialStageState.failures,
    [],
    'The magnified celestial stage must remain responsive and clear of its panel'
);

const celestialVisitState = JSON.parse(vm.runInContext(`(() => {
    const originalPrepare = celestialCloseupRenderer.prepare;
    const prepareCalls = [];
    celestialCloseupRenderer.prepare = profile => {
        prepareCalls.push(profile.id);
        return {
            then() {
                return { catch() {} };
            }
        };
    };
    const savedWidth = window.innerWidth;
    const savedHeight = window.innerHeight;
    const testBody = celestialBodies.find(profile => profile.id === 'jupiter');
    window.innerWidth = 1440;
    window.innerHeight = 900;
    resizeOverlay();
    testBody.screen = { visible: true, x: 1200, y: 420 };
    state.scene = 'roam';
    state.gateOpen = false;
    state.modalOpen = false;
    state.touchMode = false;
    state.lock = 'keyboard-free';
    state.celestialVisit = null;
    state.celestialFlight = null;
    state.flight = null;
    state.activeCelestial = null;
    document.pointerLockElement = null;

    const originOrientation = orientationFromYawPitch(0.37, -0.21);
    const originTargetOrientation = orientationFromYawPitch(0.44, -0.17);
    camera.orientation = originOrientation.slice();
    camera.targetOrientation = originTargetOrientation.slice();
    camera.fov = 0.91;
    camera.targetFov = 0.87;
    startCelestialFlight(testBody, 'keyboard');
    const visit = state.celestialVisit;
    const originJson = JSON.stringify(visit.origin);
    const approachCreated = visit.phase === 'approach' &&
        state.scene === 'flying' &&
        state.celestialFlight === visit &&
        dom.portalNav.inert &&
        dom.celestialNav.inert &&
        dom.body.classList.contains('celestial-transition') &&
        prepareCalls.join(',') === 'jupiter';

    const approachTime = visit.transition.startedAt +
        visit.transition.duration * 0.43;
    updateCamera(approachTime);
    const beforeResizeOrientation = camera.orientation.slice();
    const beforeResizeFov = camera.fov;
    window.innerWidth = 600;
    window.innerHeight = 900;
    handleViewportResize();
    const resizeDot = Math.abs(beforeResizeOrientation.reduce(
        (sum, value, index) => sum + value * camera.orientation[index],
        0
    ));
    const responsiveApproach = !visit.panelOnLeft &&
        resizeDot > 1 - 1e-12 &&
        Math.abs(camera.fov - beforeResizeFov) < 1e-12 &&
        visit.transition.fromOrientation.every(Number.isFinite) &&
        visit.transition.toOrientation.every(Number.isFinite) &&
        Number.isFinite(visit.transition.fromFov) &&
        Number.isFinite(visit.transition.toFov) &&
        JSON.stringify(visit.origin) === originJson;

    resolveCelestialTextureFallback(visit);
    updateCamera(Math.max(
        visit.transition.startedAt + visit.transition.duration,
        visit.visualStartedAt + visit.visualDuration
    ) + 1);
    const observingReached = visit.phase === 'observing' &&
        state.scene === 'detail' &&
        state.celestialVisit === visit &&
        state.celestialFlight === null &&
        state.activeCelestial === testBody &&
        !dom.celestialPanel.inert &&
        dom.body.classList.contains('celestial-closeup');

    const beforeEscapeOrientation = camera.orientation.slice();
    const beforeEscapeFov = camera.fov;
    cancelFlight('keyboard');
    const escapeDot = Math.abs(beforeEscapeOrientation.reduce(
        (sum, value, index) => sum + value * camera.orientation[index],
        0
    ));
    const escapeStartsReturnWithoutSnap = visit.phase === 'returning' &&
        state.scene === 'flying' &&
        state.celestialVisit === visit &&
        state.celestialFlight === visit &&
        dom.celestialPanel.inert &&
        dom.body.classList.contains('celestial-returning') &&
        escapeDot > 1 - 1e-12 &&
        Math.abs(camera.fov - beforeEscapeFov) < 1e-12;

    updateCamera(visit.transition.startedAt + visit.transition.duration + 1);
    const exactOriginRestored =
        state.celestialVisit === null &&
        state.celestialFlight === null &&
        state.scene === 'roam' &&
        camera.orientation.every(
            (value, index) => Math.abs(value - originOrientation[index]) < 1e-12
        ) &&
        camera.targetOrientation.every(
            (value, index) =>
                Math.abs(value - originTargetOrientation[index]) < 1e-12
        ) &&
        Math.abs(camera.fov - 0.91) < 1e-12 &&
        Math.abs(camera.targetFov - 0.87) < 1e-12 &&
        !dom.body.classList.contains('celestial-transition') &&
        !dom.body.classList.contains('celestial-closeup') &&
        !dom.body.classList.contains('celestial-returning') &&
        !dom.portalNav.inert &&
        !dom.celestialNav.inert;

    celestialCloseupRenderer.prepare = originalPrepare;
    window.innerWidth = savedWidth;
    window.innerHeight = savedHeight;
    resizeOverlay();
    return JSON.stringify({
        approachCreated,
        responsiveApproach,
        observingReached,
        escapeStartsReturnWithoutSnap,
        exactOriginRestored
    });
})()`, runtimeContext));
assert.deepEqual(celestialVisitState, {
    approachCreated: true,
    responsiveApproach: true,
    observingReached: true,
    escapeStartsReturnWithoutSnap: true,
    exactOriginRestored: true
}, 'Celestial visits must approach, observe, return smoothly, and restore their exact origin');

const meteorState = JSON.parse(vm.runInContext(`(() => {
    const originalCrypto = window.crypto;
    const originalRandom = Math.random;
    const sun = celestialBodies.find(profile => profile.id === 'sun');
    const originalSunCurrent = sun.current;
    const originalHasEntered = state.hasEntered;
    window.crypto = null;
    Math.random = () => 0.1;
    const shower = createMeteorShowerSelection();
    state.hasEntered = true;
    sun.current = {
        ...(originalSunCurrent || {}),
        altitude: 10
    };
    armMeteorShower(shower, 1000);
    const daylightPending = shower.selected &&
        !shower.armed &&
        shower.meteors.length === 0;
    const twilightAlpha = [-18, -15, -12].map(altitude => {
        sun.current.altitude = altitude;
        return meteorShowerSkyVisibility();
    });
    sun.current.altitude = -30;
    armMeteorShower(shower, 1000);
    const tangentOrthogonal = shower.meteors.every(meteor =>
        Math.abs(dot(shower.radiantEquatorial, meteor.tangent)) < 1e-10
    );
    const pathsFiniteAndUnit = shower.meteors.every(meteor => {
        const start = meteorDirection(shower, meteor, meteor.startAngle);
        const finish = meteorDirection(
            shower,
            meteor,
            meteor.startAngle + meteor.travel
        );
        return [...start, ...finish].every(Number.isFinite) &&
            Math.abs(vectorLength(start) - 1) < 1e-12 &&
            Math.abs(vectorLength(finish) - 1) < 1e-12;
    });
    sun.current = originalSunCurrent;
    state.hasEntered = originalHasEntered;
    Math.random = originalRandom;
    window.crypto = originalCrypto;
    return JSON.stringify({
        selected: shower.selected,
        daylightPending,
        twilightAlpha,
        count: shower.meteors.length,
        tangentOrthogonal,
        pathsFiniteAndUnit
    });
})()`, runtimeContext));
assert.deepEqual(meteorState, {
    selected: true,
    daylightPending: true,
    twilightAlpha: [1, 0.5, 0],
    count: 42,
    tangentOrthogonal: true,
    pathsFiniteAndUnit: true
}, 'Meteor showers must remain pending in daylight, fade through twilight, and share a valid great-circle radiant geometry');

function evaluateLiteral(pattern, label) {
    const match = life.match(pattern);
    assert(match, `Could not extract ${label}`);
    return vm.runInNewContext(`(${match[1]})`);
}

const portals = evaluateLiteral(
    /const portalDefinitions = (\[[\s\S]*?\n\]);\n\nconst constellationPatterns/,
    'portalDefinitions'
);
const patterns = evaluateLiteral(
    /const constellationPatterns = (\{[\s\S]*?\n\});\n\nconst constellationStories/,
    'constellationPatterns'
);
const homeTargets = evaluateLiteral(
    /const homeStarTargets = (\{[\s\S]*?\n\});\n\nconst starUiCopy/,
    'homeStarTargets'
);
function catalogDirection(hip) {
    const index = catalog.indexByHip.get(Number(hip));
    assert.notEqual(index, undefined, `HIP ${hip} must exist in the catalog`);
    const offset = index * 3;
    return normalize([
        catalog.directions[offset],
        catalog.directions[offset + 1],
        catalog.directions[offset + 2]
    ]);
}

function contentHips(portalId) {
    const marker = `data-portal-content="${portalId}"`;
    const start = life.indexOf(marker);
    assert(start >= 0, `Portal content ${portalId} must exist`);
    const next = life.indexOf('data-portal-content="', start + marker.length);
    const segment = life.slice(start, next >= 0 ? next : life.length);
    return new Set(
        [...segment.matchAll(/data-star-hip="(\d+)"/g)]
            .map(match => Number(match[1]))
    );
}

const portalById = new Map(portals.map(portal => [portal.id, portal]));
const homePortal = portalById.get('home');
const homePattern = patterns[homePortal.pattern];
let maximumRouteSeparation = 0;
for (const [sourceHip, action] of Object.entries(homeTargets)) {
    if (action.type !== 'portal') continue;
    const targetPortal = portalById.get(action.portalId);
    assert(targetPortal, `Route target ${action.portalId} must exist`);
    const targetPattern = patterns[targetPortal.pattern];
    const populated = contentHips(targetPortal.id);
    const targetHip = targetPattern.contentOrder.find(hip => populated.has(hip)) ??
        targetPattern.contentOrder[0] ??
        targetPattern.hips[0];
    const separation = Math.acos(Math.max(
        -1,
        Math.min(
            1,
            catalogDirection(sourceHip).reduce(
                (sum, value, index) =>
                    sum + value * catalogDirection(targetHip)[index],
                0
            )
        )
    ));
    maximumRouteSeparation = Math.max(maximumRouteSeparation, separation);
}
assert(
    maximumRouteSeparation < 95 * Math.PI / 180,
    'The route framing limit must contain every Home route'
);

console.log(
    `life runtime validation passed; maximum Home route separation ` +
    `${(maximumRouteSeparation * 180 / Math.PI).toFixed(2)}°; ` +
    `${routeFramingState.cases} responsive route frames ` +
    `(max FOV ${routeFramingState.maximumFov.toFixed(1)}°); ` +
    `${constellationFramingState.cases} star hit-area frames; ` +
    `${celestialStageState.cases} close-up stage frames; ` +
    `${closeupGeometryState.length} close-up body geometries; ` +
    `${astronomyGridCases} astronomy grid cases`
);
