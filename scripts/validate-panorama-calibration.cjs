'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/life/scripts/24-panorama.js'), 'utf8');
const skySource = fs.readFileSync(path.join(root, 'assets/life/scripts/05-astronomy.js'), 'utf8');
const quarterTurn = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
const metadata = { kind: 'art-direction-calibration', coordinateSystem: 'sky-y-up-plus-z', sunDirection: [0, .6, .8] };
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

function fixture(observation = metadata, orientation = quarterTurn, options = {}) {
    const callbacks = new Map();
    const requests = [];
    const context = {
        window: { document: { body: { dataset: {} } }, matchMedia: () => ({ matches: false }), dispatchEvent() {} },
        document: {
            readyState: 'loading', baseURI: 'http://localhost/life.html', addEventListener() {},
            getElementById: id => canvases.get(id),
            createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(128 * 64 * 4).fill(options.opaque ? 255 : 0) }) }) })
        },
        location: { origin: 'http://localhost' }, navigator: {},
        URL, AbortController, DOMException, console,
        CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
        skyModel: { nextRefreshAt: 42, location: { latitude: 31, longitude: 121, height: 0 } },
        celestialBodies: [{ id: 'sun', current: { direction: [0, -1, 0], altitude: -90 } }],
        createImageBitmap: async () => ({ width: 128, height: 64, close() {} })
    };
    const graphics = {};
    for (const method of ['createShader', 'createProgram', 'createBuffer', 'createTexture', 'getUniformLocation']) graphics[method] = () => ({});
    for (const method of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader', 'deleteProgram', 'bindBuffer', 'bufferData', 'bindTexture', 'pixelStorei', 'texParameteri', 'texImage2D', 'deleteTexture', 'deleteBuffer', 'viewport', 'useProgram', 'enableVertexAttribArray', 'vertexAttribPointer', 'activeTexture', 'uniform1i', 'uniform4fv', 'uniform2f', 'uniform1f', 'drawArrays']) graphics[method] = () => {};
    Object.assign(graphics, {
        NO_ERROR: 0, getError: () => 0, getShaderParameter: () => true, getProgramParameter: () => true,
        getShaderPrecisionFormat: () => ({ precision: 23 }), getParameter: () => 8192, getAttribLocation: () => 0
    });
    const canvases = new Map(['panoramaCanvas', 'panoramaSkyCanvas'].map(id => [id, {
        style: {}, getContext: () => graphics,
        addEventListener(name, callback) { callbacks.set(`${id}:${name}`, callback); }
    }]));
    const layerTiers = layer => Object.fromEntries((options.tiers || ['low']).map(tier => [tier, { src: `${layer}-${tier}.webp`, width: 128 }]));
    const variant = { production: 'review', tiers: layerTiers('foreground'), sky: { observation, orientation, tiers: layerTiers('sky') } };
    const manifest = { version: 1, projection: 'equirectangular', scenes: { hogwarts: { variants: { clear: variant } }, snowmountain: { variants: { clear: variant } } } };
    context.fetch = async url => { requests.push(url); return { ok: true, json: async () => manifest, blob: async () => ({ url }) }; };
    vm.createContext(context);
    vm.runInContext(skySource, context);
    vm.runInContext(source, context);
    return { context, callbacks, requests, canvases, panorama: context.window.NightPanorama, sky: context.window.SceneSky };
}

async function main() {
    const { context, callbacks, panorama, sky } = fixture();
    assert.equal(await panorama.select('hogwarts', 'clear'), true);
    assert.equal(panorama.getSnapshot().status, 'prerendered');
    near(sky.snapshot().sunDirection[0], .8);
    near(sky.snapshot().sunDirection[1], .6);
    near(sky.snapshot().sunDirection[2], 0);
    assert.equal(context.celestialBodies[0].current.altitude, -90);
    assert.equal(context.skyModel.location.longitude, 121);
    panorama.render({ orientation: quarterTurn, shipOrientation: quarterTurn, width: 1600, height: 900, fov: Math.PI / 3, visible: true });
    near(sky.snapshot().sunDirection[0], .8);
    assert.equal(panorama.coversSky(), true);
    panorama.setMode('explore');
    assert.equal(sky.snapshot().alignment, null);
    panorama.setMode('observe');
    near(sky.snapshot().sunDirection[0], .8);
    panorama.setMode('sky');
    assert.equal(sky.snapshot().alignment, null);
    panorama.setMode('observe');
    callbacks.get('panoramaSkyCanvas:webglcontextlost')({ preventDefault() {} });
    assert.equal(sky.snapshot().alignment, null);
    assert.equal(panorama.coversSky(), false);

    const disposable = fixture();
    await disposable.panorama.select('hogwarts', 'clear');
    disposable.panorama.dispose();
    assert.equal(disposable.sky.snapshot().alignment, null);

    for (const invalid of [{ ...metadata, sunDirection: null }, { ...metadata, sunDirection: [0, 0, 0] }, { ...metadata, sunDirection: [0, Infinity, 0] }, { ...metadata, coordinateSystem: 'unknown' }, { date: '2026-09-09T00:00:00Z' }]) {
        const candidate = fixture(invalid);
        assert.equal(await candidate.panorama.select('snowmountain', 'clear'), true, 'bad optional metadata must not prevent panorama fallback');
        assert.equal(candidate.sky.snapshot().alignment, null);
    }
    const masking = fixture(metadata, quarterTurn, { opaque: true });
    await masking.panorama.select('hogwarts', 'clear');
    assert.equal(masking.panorama.canSeeSky(0, 0), true, 'invisible panorama must never leave a blocking mask');
    masking.panorama.render({ visible: true, width: 1600, height: 900, fov: Math.PI / 3 });
    assert.equal(masking.panorama.canSeeSky(0, 0), false, 'visible opaque panorama must block the sky');
    masking.panorama.render({ visible: false });
    assert.equal(masking.panorama.canSeeSky(0, 0), true, 'hiding the panorama must immediately release masking');
    masking.panorama.render({ visible: true });
    const missing = masking.panorama.select('shelter', 'night');
    assert.equal(masking.panorama.canSeeSky(0, 0), true, 'loading a scene must not use the old scene mask');
    assert.equal(masking.panorama.coversSky(), false);
    assert.equal(masking.sky.snapshot().alignment, null);
    await missing;
    assert.equal(masking.panorama.getSnapshot().status, 'preview');
    assert.equal(masking.panorama.canSeeSky(0, 0), true, 'missing variants must not retain the old mask');

    const recovery = fixture(metadata, quarterTurn, { tiers: ['high', 'medium', 'low'], opaque: true });
    await recovery.panorama.select('hogwarts', 'clear');
    assert.equal(recovery.panorama.getSnapshot().tier, 'medium');
    recovery.panorama.render({ visible: true, width: 3840, height: 2160, fov: Math.PI / 3 });
    const lose = name => recovery.callbacks.get(`${name}:webglcontextlost`)({ preventDefault() {} });
    const restore = async name => { recovery.callbacks.get(`${name}:webglcontextrestored`)(); await new Promise(resolve => setImmediate(resolve)); };
    lose('panoramaCanvas');
    assert.equal(recovery.panorama.canSeeSky(0, 0), true, 'context errors must disable all masking');
    assert.equal(recovery.panorama.coversSky(), false, 'context errors must release underlying sky rendering');
    assert.equal(recovery.sky.snapshot().alignment, null);
    lose('panoramaSkyCanvas');
    assert.equal(recovery.panorama.getSnapshot().recoveryTier, 'low', 'paired context loss must count as one downgrade');
    const beforeRestore = recovery.requests.length;
    await restore('panoramaCanvas');
    assert.equal(recovery.requests.length, beforeRestore, 'recovery must wait until both contexts are restored');
    await restore('panoramaSkyCanvas');
    assert.equal(recovery.panorama.getSnapshot().tier, 'low', 'auto recovery must remember its reduced tier');
    recovery.panorama.render({ visible: true });
    const recoveredCanvas = recovery.canvases.get('panoramaCanvas');
    assert(recoveredCanvas.width * recoveredCanvas.height <= 1230000, 'recovery must reduce the framebuffer budget as well as texture tier');
    lose('panoramaCanvas');
    const beforeBlockedRestore = recovery.requests.length;
    await restore('panoramaCanvas');
    assert.equal(recovery.requests.length, beforeBlockedRestore, 'lowest-tier context loss must stop automatic retry loops');
    assert.equal(recovery.panorama.getSnapshot().status, 'error');
    assert.match(recovery.panorama.getSnapshot().error, /Select a quality to retry/);
    assert.equal(await recovery.panorama.select('snowmountain', 'clear'), false);
    assert.equal(recovery.requests.length, beforeBlockedRestore, 'scene changes must not silently undo the device safety ceiling');
    assert.equal(await recovery.panorama.setQuality('auto'), true, 'an explicit quality choice must permit a fresh attempt');
    assert.equal(recovery.panorama.getSnapshot().tier, 'medium');
    assert.equal(recovery.panorama.getSnapshot().recoveryTier, null);
    await recovery.panorama.setQuality('high');
    lose('panoramaCanvas');
    await restore('panoramaCanvas');
    assert.equal(recovery.panorama.getSnapshot().tier, 'medium', 'explicit high must recover one tier lower');
    console.log('Panorama calibration validation passed (direction calibration, immutable astronomy, lifecycle, masking, quality downgrade and bounded recovery).');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
