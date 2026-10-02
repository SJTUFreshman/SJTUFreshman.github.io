'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const decodes = [];
const context = { URL, Map, Set, Promise, AbortController, performance, console,
    COARSE_POINTER: true, REDUCED_MOTION: false,
    clamp: (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value)),
    document: { baseURI: 'https://life.invalid/', hidden: false },
    window: { setTimeout, clearTimeout, innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 },
    usesCompactSkyLayout: () => true,
    fetch: async () => ({ ok: true, blob: async () => ({}) }),
    createImageBitmap: (blob, options) => new Promise(resolve => decodes.push({ options, resolve })) };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/life/scripts/09-baked-closeup.js'), 'utf8')
    + '\nglobalThis.Viewer = BakedCelestialViewer;', context);

function frame(width = 1024, height = 512) {
    return { width, height, closed: false, close() { this.closed = true; this.width = 0; this.height = 0; } };
}

function configuredViewer({ coarse = true, width = 390, height = 844, dpr = 3, compact = true } = {}) {
    context.COARSE_POINTER = coarse;
    Object.assign(context.window, { innerWidth: width, innerHeight: height, devicePixelRatio: dpr });
    context.usesCompactSkyLayout = () => compact;
    const viewer = new context.Viewer();
    viewer.body = { azimuthCount: 72, elevations: [-90, -60, -30, 0, 30, 60, 90], width: 7680, height: 4320,
        framePattern: 'earth/e{elevation}/a{azimuth}.webp' };
    viewer.profile = { id: 'earth' };
    viewer.azimuth = 2.5;
    viewer.elevation = 14;
    viewer.posterUrl = 'https://life.invalid/assets/celestial/baked/earth/poster.webp';
    viewer.updateCopy = () => {};
    viewer.canvas = { width: 1, height: 1, style: {} };
    viewer.element = { classList: { toggle() {}, remove() {} } };
    viewer.resize();
    return viewer;
}

async function main() {
    for (const [baseURI, expected] of [
        ['https://life.invalid/life.html', ['hosted']],
        ['http://127.0.0.1:8765/life.html', ['baked', 'hosted']],
        ['http://localhost:8765/life.html?celestialAtlas=hosted', ['hosted']],
        ['http://[::1]:8765/life.html', ['baked', 'hosted']],
        ['https://life.invalid/life.html?celestialAtlas=local', ['baked']]
    ]) {
        context.document.baseURI = baseURI;
        const selected = new context.Viewer();
        assert.equal(JSON.stringify(selected.manifestUrls), JSON.stringify(expected.map(directory => new URL(`assets/celestial/${directory}/manifest.json`, baseURI).href)),
            'Production must use hosted resources while local previews retain the complete local atlas');
    }
    context.document.baseURI = 'http://localhost:8765/life.html';
    const fallback = new context.Viewer();
    const originalFetch = context.fetch;
    const requestedManifests = [];
    context.fetch = async url => {
        requestedManifests.push(url);
        return url.includes('/baked/') ? { ok: false, status: 404 } : { ok: true, json: async () => ({ version: 1, bodies: {} }) };
    };
    await fallback.loadManifest();
    assert.equal(requestedManifests.length, 2, 'A checkout without ignored local frames must fall back to the hosted manifest');
    assert(fallback.manifestUrl.endsWith('/hosted/manifest.json'), 'Relative poster paths must resolve against the manifest that actually loaded');
    context.fetch = async () => { throw new Error('simulated network failure'); };
    await assert.rejects(new context.Viewer().loadManifest(), /simulated network failure/);
    context.fetch = originalFetch;
    context.document.baseURI = 'https://life.invalid/';
    const viewer = configuredViewer();
    assert.equal(viewer.samples().length, 1, 'Five-degree azimuth and thirty-degree elevation samples must not blend distant surface features');
    assert(viewer.samples()[0].url.includes('/e3/'), 'A coarse elevation selects the nearest captured latitude');
    viewer.body.azimuthCount = 360;
    assert.equal(viewer.samples().length, 2, 'Dense azimuth captures may crossfade horizontally');
    assert(viewer.samples().every(sample => sample.url.includes('/e3/')), 'Dense azimuth blending must not reintroduce coarse latitude blending');
    const size = viewer.decodeSize();
    assert.equal(viewer.cacheBudget, 64 * 1024 * 1024, 'Mobile decoded image storage must retain a bounded 64 MiB budget');
    assert.equal(viewer.canvas.width, 1170, 'Mobile canvas must follow its physical display pixels');
    assert.equal(size.resizeHeight, viewer.canvas.height, 'A portrait display must retain every pixel needed for the visible source crop');
    assert(size.resizeWidth < 3840 && size.resizeHeight < 2160, 'A small mobile display must decode only the detail it can show');
    const mobileRequests = [];
    viewer.request = url => { mobileRequests.push(url); return Promise.resolve(null); };
    viewer.prefetch(viewer.samples());
    assert.equal(mobileRequests.length, viewer.samples().length, 'Mobile high-density displays must reserve memory by omitting optional prefetches');

    for (const display of [{ width: 3840, height: 2160, dpr: 1 }, { width: 1920, height: 1080, dpr: 2 }]) {
        const desktop = configuredViewer({ ...display, coarse: false, compact: false });
        assert.equal(desktop.canvas.width, 3840, 'A physical 4K desktop viewport must retain its full canvas width');
        assert.equal(desktop.canvas.height, 2160, 'A physical 4K desktop viewport must retain its full canvas height');
        assert.equal(desktop.decodeSize().resizeWidth, 3840, 'An 8K source must decode at the full displayed 4K width');
        assert.equal(desktop.decodeSize().resizeHeight, 2160, 'An 8K source must decode at the full displayed 4K height');
        desktop.body.width = 3840;
        desktop.body.height = 2160;
        assert.equal(desktop.decodeSize().resizeWidth, 3840, 'Native 4K captures must not be downsampled on a 4K display');
        assert.equal(desktop.cacheBudget, 256 * 1024 * 1024, 'Desktop decoded image storage must have a bounded 256 MiB budget');
        const requested = [];
        desktop.request = url => { requested.push(url); return Promise.resolve(null); };
        desktop.prefetch(desktop.samples());
        assert(requested.length <= 5 && (requested.length + 3) * 3840 * 2160 * 4 <= desktop.cacheBudget,
            '4K prefetching must leave room for the displayed fallback and both pending decodes');
        desktop.clear();
    }

    viewer.cacheBudget = 3 * 1024 * 1024;
    const obsolete = frame();
    const current = frame();
    viewer.cache.set('obsolete', obsolete);
    viewer.cache.set(viewer.samples()[0].url, current);
    viewer.cacheBytes = 4 * 1024 * 1024;
    viewer.lastImage = current;
    viewer.evict();
    assert(obsolete.closed, 'Eviction must release the ImageBitmap decoder allocation');
    assert.equal(viewer.cacheBytes, 2 * 1024 * 1024, 'Eviction must subtract dimensions before ImageBitmap.close zeroes them');

    const racingViewer = configuredViewer();
    racingViewer.activeLoads = 1;
    const url = racingViewer.samples()[0].url;
    let resolved;
    const loading = racingViewer.loadFrame({ url, generation: racingViewer.generation,
        decodeSize: racingViewer.decodeSize(), resolve: image => { resolved = image; } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(decodes.length, 1, 'The request must reach a pending decoder before the visit changes');
    racingViewer.clear();
    const previousImage = frame();
    decodes.shift().resolve(previousImage);
    await loading;
    assert(previousImage.closed && resolved === null, 'A completed decode from the previous visit must be closed and discarded');
    assert.equal(racingViewer.cacheBytes, 0);
    assert.equal(racingViewer.activeLoads, 0);
    assert.equal(racingViewer.cache.size, 0);
    assert.equal(racingViewer.lastImage, null);

    const prefetchViewer = configuredViewer();
    const selectedImage = frame();
    prefetchViewer.lastImage = selectedImage;
    prefetchViewer.activeLoads = 1;
    const prefetch = prefetchViewer.loadFrame({ url: prefetchViewer.frameUrl(0, 40), generation: prefetchViewer.generation,
        decodeSize: prefetchViewer.decodeSize(), resolve: () => {} });
    await new Promise(resolve => setImmediate(resolve));
    decodes.shift().resolve(frame());
    await prefetch;
    assert.equal(prefetchViewer.lastImage, selectedImage, 'A late prefetch must not replace the currently displayed view');

    const resizedViewer = configuredViewer({ coarse: false, width: 1920, height: 1080, dpr: 1, compact: false });
    const resizedUrl = resizedViewer.samples()[0].url;
    const smallImage = frame(1920, 1080);
    resizedViewer.cache.set(resizedUrl, smallImage);
    resizedViewer.lastImage = smallImage;
    resizedViewer.cacheBytes = smallImage.width * smallImage.height * 4;
    context.window.devicePixelRatio = 2;
    resizedViewer.resize();
    const upgraded = resizedViewer.request(resizedUrl);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(decodes[0].options.resizeWidth, 3840, 'Resizing to 4K must reload a cached lower-resolution frame at its displayed size');
    assert(!smallImage.closed, 'The previously visible frame must remain usable while its 4K replacement loads');
    const largeImage = frame(3840, 2160);
    decodes.shift().resolve(largeImage);
    assert.equal(await upgraded, largeImage);
    assert.equal(resizedViewer.lastImage, smallImage, 'Replacing the cache must preserve the drawn frame until the next draw');
    assert.equal(resizedViewer.cacheBytes, (1920 * 1080 + 3840 * 2160) * 4, 'The retained old frame must remain part of memory accounting');
    resizedViewer.activeLoads = 1;
    const staleDecode = resizedViewer.loadFrame({ url: resizedUrl, generation: resizedViewer.generation,
        decodeSize: { resizeWidth: 1920, resizeHeight: 1080 }, resolve: () => {} });
    await new Promise(resolve => setImmediate(resolve));
    const lateSmallImage = frame(1920, 1080);
    decodes.shift().resolve(lateSmallImage);
    await staleDecode;
    assert(lateSmallImage.closed, 'An old lower-resolution decode must be released if a sharper frame is already cached');
    assert.equal(resizedViewer.cache.get(resizedUrl), largeImage, 'A stale request must not overwrite an already cached 4K frame');
    resizedViewer.clear();
    assert(smallImage.closed && largeImage.closed, 'Stopping must release both the retained previous frame and the replacement');
    prefetchViewer.clear();
    viewer.clear();
    console.log('Baked close-up validation passed: 4K display detail, mobile decode and prefetch budgets, angular sampling, bitmap eviction, stale decoding, resizing and late-prefetch ordering.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
