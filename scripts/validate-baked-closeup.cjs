'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const decodes = [];
const context = { URL, Map, Set, Promise, AbortController, performance, console,
    COARSE_POINTER: true, REDUCED_MOTION: false,
    state: { sectionDrawerOpen: false, modalOpen: false },
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
    const posterViewer = configuredViewer();
    const posterBody = { ...posterViewer.body, defaultElevation: 3, defaultAzimuth: 0,
        transparent: true, sphereRect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        poster: 'earth/poster.webp', cloudFramePattern: 'earth/clouds/e{elevation}/a{azimuth}.webp',
        ringFramePattern: 'earth/rings/e{elevation}/a000.webp', cloudPoster: 'earth/clouds/poster.webp', ringPoster: 'earth/rings/poster.webp' };
    posterViewer.create = () => {};
    posterViewer.loadManifest = async () => ({ version: 2, bodies: { earth: posterBody } });
    const posterRequests = [];
    posterViewer.request = (url, sample) => {
        posterRequests.push({ url, sample });
        return sample.layer === 'surface' ? Promise.resolve(frame()) : new Promise(() => {});
    };
    assert.equal(await posterViewer.prepare({ id: 'earth' }), true,
        'The surface becomes usable while the auxiliary posters are still loading');
    assert.equal(posterRequests.length, 4);
    assert.equal(posterRequests[2].sample.layer, 'clouds');
    assert.equal(posterRequests[3].sample.layer, 'rings');
    assert(posterRequests.slice(2).every(request => request.sample.elevation === 3 && posterViewer.posterUrls.has(request.url)),
        'Independent cloud and ring posters retain the surface elevation and remain protected in the request queue');
    posterViewer.clear();
    const viewer = configuredViewer();
    assert.equal(viewer.samples().length, 1, 'Five-degree azimuth and thirty-degree elevation samples must not blend distant surface features');
    assert(viewer.samples()[0].url.includes('/e3/'), 'A coarse elevation selects the nearest captured latitude');
    viewer.body.azimuthCount = 360;
    assert.equal(viewer.samples().length, 2, 'Legacy dense cropped captures retain their original adjacent-frame playback');
    assert(viewer.samples().every(sample => sample.url.includes('/e3/')), 'Angular selection must retain the nearest captured latitude');
    viewer.body.sphereRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    viewer.body.transparent = true;
    viewer.body.cloudFramePattern = 'earth/clouds/e{elevation}/a{azimuth}.webp';
    viewer.cloudAzimuth = 5.5;
    const layeredSamples = viewer.samples();
    assert.equal(layeredSamples.length, 2, 'An independent cloud layer must select its own source frame');
    assert.notEqual(layeredSamples[0].azimuth, layeredSamples[1].azimuth, 'Cloud phase must be independent from surface longitude');
    assert(layeredSamples.every(sample => sample.weight === 1), 'No pair of frames may use opacity interpolation');

    viewer.body.cloudFramePattern = 'earth/clouds/t{time}/e{elevation}/a{azimuth}.webp';
    const climateVariant = { width: 4096, height: 4096,
        cloudFramePattern: 'earth/clouds-4k/t{time}/e{elevation}/a{azimuth}.webp' };
    viewer.body.climate = {
        model: 'advected-noise-v1', seed: 17, frameCount: 8, timeStepSeconds: 10800, loopSeconds: 86400,
        interpolation: 'crossfade', allowTemporalBlend: true
    };
    viewer.cloudAzimuth = 42.5;
    viewer.cloudTime = 4.5;
    const climateSamples = viewer.samples().filter(sample => sample.layer === 'clouds');
    assert.equal(climateSamples.length, 2, 'Climate playback selects adjacent temporal cloud frames');
    assert.equal(climateSamples[0].timeIndex, 1);
    assert.equal(climateSamples[1].timeIndex, 2);
    assert(Math.abs(climateSamples[0].weight - 0.5) < 1e-12 && Math.abs(climateSamples[1].weight - 0.5) < 1e-12,
        'Adjacent climate frames crossfade by the fractional time position');
    assert(climateSamples[0].url.includes('/t001/') && climateSamples[1].url.includes('/t002/'),
        'Climate frame URLs include a stable three-digit time component');
    viewer.body.climate.allowTemporalBlend = false;
    const singleClimateSamples = viewer.samples().filter(sample => sample.layer === 'clouds');
    assert.equal(singleClimateSamples.length, 1, 'Climate playback uses one temporal source by default to avoid cloud ghosting');
    assert.equal(singleClimateSamples[0].weight, 1, 'Single-source climate playback keeps full opacity');
    assert.equal(singleClimateSamples[0].timeIndex, 2, 'Single-source climate playback selects the nearest temporal frame');
    assert(viewer.climateConfig().hoursPerSecond > 0.4, 'Climate playback uses a visibly responsive default cycle');
    const climateLayer = viewer.sphereLayer(frame(), singleClimateSamples[0], viewer.framing(), 'clouds');
    assert(Math.abs(climateLayer.climatePhase) > 0 && climateLayer.climateWarp > 0,
        'Climate clouds use a continuous latitude-dependent wind warp between keyframes');
    viewer.body.climate.allowTemporalBlend = true;
    assert.equal(viewer.frameUrl(3, 2, 'clouds', climateVariant, 1),
        'https://life.invalid/assets/celestial/hosted/earth/clouds-4k/t001/e3/a002.webp',
        'Climate playback uses the selected resolution cloud pattern when one is provided');
    delete viewer.body.cloudFramePattern;
    viewer.body.resolutions = [climateVariant];
    const variantClimateSamples = viewer.samples().filter(sample => sample.layer === 'clouds');
    assert.equal(variantClimateSamples[0].url,
        'https://life.invalid/assets/celestial/hosted/earth/clouds-4k/t001/e3/a043.webp',
        'Climate metadata can discover a timed cloud pattern from the selected resolution tier');
    assert.notEqual(climateSamples[0].azimuth, viewer.samples().find(sample => sample.layer === 'surface').azimuth,
        'Climate playback preserves the independent cloud azimuth phase');
    const climateBefore = viewer.cloudTime;
    viewer.body.climate.hoursPerSecond = 2;
    viewer.advanceClimate(1);
    assert(viewer.cloudTime > climateBefore, 'Observing playback advances the climate clock');
    viewer.body.climate.interpolation = 'step';
    assert.equal(viewer.samples().filter(sample => sample.layer === 'clouds').length, 1,
        'Step climate playback can disable temporal crossfading');
    viewer.body.climate.frameCount = 1;
    assert.equal(viewer.samples().filter(sample => sample.layer === 'clouds').length, 1,
        'A single climate frame remains usable as a static timed cloud layer');
    delete viewer.body.climate;

    const tierViewer = configuredViewer({ coarse: false, width: 1920, height: 1080, dpr: 1, compact: false });
    tierViewer.body = {
        ...tierViewer.body,
        width: 8192,
        height: 8192,
        transparent: true,
        sphereRect: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
        resolutions: [
            { id: '2k', width: 2048, height: 2048, sphereRect: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 }, framePattern: '2k/e{elevation}/a{azimuth}.webp' },
            { id: '4k', width: 4096, height: 4096, sphereRect: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 }, framePattern: '4k/e{elevation}/a{azimuth}.webp' },
            { id: '8k', width: 8192, height: 8192, sphereRect: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 }, framePattern: '8k/e{elevation}/a{azimuth}.webp' }
        ]
    };
    assert.equal(tierViewer.resolution().id, '8k', 'A close crop selects the tier whose physical sphere diameter covers the open viewport');
    tierViewer.canvas.width = 1200;
    tierViewer.canvas.height = 675;
    tierViewer.measureFramingLayout();
    assert.equal(tierViewer.resolution().id, '4k', 'A smaller physical viewport can use the lower tier without reducing the projected globe size');
    const tierSample = { layer: 'surface', elevation: 3, azimuth: 0, variant: tierViewer.resolution() };
    const cropPlan = tierViewer.decodePlan(tierSample);
    assert(cropPlan.crop.width < tierViewer.body.width && cropPlan.crop.height < tierViewer.body.height,
        'Full-sphere decoding requests only the source rectangle visible in the close crop');
    const cropScale = tierViewer.framing().radius / (cropPlan.sourceWidth * cropPlan.rectangle.width / 2);
    assert(cropPlan.resizeWidth / cropPlan.crop.width >= cropScale * 0.99,
        'The cropped decode retains the physical pixel scale required by the displayed sphere');
    const ringTier = { ...tierViewer.resolution(), ringWidth: 8192, ringHeight: 4096,
        ringSphereRect: { x: 0.25, y: 0.35, width: 0.5, height: 0.3 }, ringFramePattern: '4k/rings/e{elevation}/a{azimuth}.webp' };
    tierViewer.body.ringFramePattern = ringTier.ringFramePattern;
    const ringPlan = tierViewer.decodePlan({ layer: 'rings', elevation: 3, azimuth: 0, variant: ringTier });
    assert.equal(ringPlan.sourceWidth, 8192, 'Ring decoding uses the ring layer width instead of the surface tier width');
    assert.equal(ringPlan.sourceHeight, 4096, 'Ring decoding uses the independent ring layer height');
    const displayedFrame = frame();
    const framing = { x: 600, y: 500, radius: 400 };
    const surfaceLayer = viewer.sphereLayer(displayedFrame, layeredSamples[0], framing);
    const cloudLayer = viewer.sphereLayer(displayedFrame, layeredSamples[1], framing, 'clouds');
    assert.equal(surfaceLayer.image, displayedFrame);
    assert.equal(surfaceLayer.key, 'surface');
    assert.equal(cloudLayer.key, 'clouds');
    assert(Math.abs(surfaceLayer.angle + (viewer.azimuth - layeredSamples[0].azimuth) * Math.PI / 180) < 1e-12,
        'Continuous phase becomes sphere rotation around the captured view');
    viewer.azimuth = 359.5;
    assert(Math.abs(viewer.sphereLayer(displayedFrame, { elevation: 3, azimuth: 0 }, framing).angle - 0.5 * Math.PI / 180) < 1e-12,
        'The sphere rotation takes the shortest displacement across the zero-degree wrap');
    viewer.azimuth = 100;
    assert(Math.abs(viewer.sphereLayer(displayedFrame, { elevation: 3, azimuth: 0 }, framing).angle + Math.PI / 180) < 1e-12,
        'A delayed network frame must never stretch the surface more than one captured angular interval');
    viewer.azimuth = 2.5;
    const drawnFrames = [];
    viewer.context = { fillRect() {}, drawImage(...args) { drawnFrames.push(args); } };
    viewer.lastImage = displayedFrame;
    viewer.lastSurfaceSample = layeredSamples[0];
    viewer.lastCloudImage = displayedFrame;
    viewer.lastCloudSample = layeredSamples[1];
    viewer.compositor = { render: () => null, clear() {} };
    viewer.draw([], 1);
    assert.equal(drawnFrames.length, 2, 'Missing WebGL draws exactly the surface and cloud frames through Canvas2D');
    assert(drawnFrames.every(args => args[0] === displayedFrame), 'The fallback retains the original decoded images');
    const nextCloud = frame();
    const nextRing = frame();
    const nextCloudSample = { layer: 'clouds', elevation: 4, azimuth: 0, url: 'next-cloud' };
    viewer.body.ringFramePattern = 'earth/rings/e{elevation}/a000.webp';
    viewer.cache.set(nextCloudSample.url, nextCloud);
    viewer.cache.set(viewer.ringSample(4).url, nextRing);
    drawnFrames.length = 0;
    viewer.draw([nextCloudSample], 2);
    assert.equal(drawnFrames.length, 2, 'A newer cloud elevation must retain the old surface-matched cloud and omit a mismatched ring');
    assert(drawnFrames.every(args => args[0] === displayedFrame));
    const nextSurface = frame();
    const nextSurfaceSample = { layer: 'surface', elevation: 4, azimuth: 0, url: 'next-surface' };
    viewer.cache.set(nextSurfaceSample.url, nextSurface);
    drawnFrames.length = 0;
    viewer.draw([nextSurfaceSample], 3);
    assert.equal(drawnFrames.length, 2, 'A new surface row hides the stale cloud and draws only its matching ring');
    assert.equal(drawnFrames[0][0], nextSurface);
    assert.equal(drawnFrames[1][0], nextRing);
    assert.equal(viewer.lastRingSample.elevation, 4);
    const ringImage = frame(1000, 1000);
    const ringFraming = { x: 600, y: 500, radius: 200 };
    viewer.body.sphereRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
    viewer.body.ringSphereRect = { x: 0.35, y: 0.35, width: 0.3, height: 0.3 };
    drawnFrames.length = 0;
    viewer.drawRing(ringImage, ringFraming);
    assert.equal(drawnFrames.length, 1);
    assert.equal(drawnFrames[0][3], 1000 * 200 * 2 / (0.3 * 1000),
        'A ring layer uses its own source sphere rectangle for scale');
    assert.equal(drawnFrames[0][4], 1000 * 200 * 2 / (0.3 * 1000),
        'Ring fallback preserves the independent source aspect ratio');
    delete viewer.body.ringSphereRect;
    drawnFrames.length = 0;
    viewer.drawRing(ringImage, ringFraming);
    assert.equal(drawnFrames[0][3], 1000 * 200 * 2 / (0.8 * 1000),
        'Ring rendering falls back to the surface rectangle when no ring rectangle is provided');
    viewer.cache.clear();
    delete viewer.body.ringFramePattern;
    viewer.lastRingImage = null;
    viewer.lastRingSample = null;
    viewer.lastImage = null;
    viewer.lastCloudImage = null;
    delete viewer.body.sphereRect;
    delete viewer.body.transparent;
    delete viewer.body.cloudFramePattern;
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

    for (const display of [{ coarse: true, width: 390, height: 844, dpr: 3, compact: true },
        { coarse: false, width: 3840, height: 2160, dpr: 1, compact: false }]) {
        for (const bodyId of ['sun', 'earth', 'moon', 'saturn', 'uranus']) for (const panelOnLeft of [false, true]) for (const withRings of [false, true]) {
            const layeredViewer = configuredViewer(display);
            layeredViewer.profile = { id: bodyId };
            layeredViewer.visit = { panelOnLeft };
            Object.assign(layeredViewer.body, { width: 4096, height: 4096, transparent: true,
                sphereRect: { x: 0.07, y: 0.07, width: 0.86, height: 0.86 },
                cloudFramePattern: 'earth/clouds/e{elevation}/a{azimuth}.webp' });
            if (withRings) layeredViewer.body.ringFramePattern = 'earth/rings/e{elevation}/a000.webp';
            const decode = layeredViewer.decodeSize();
            const requiredFrames = (withRings ? 3 : 2) * 2 + 2;
            assert(decode.resizeWidth * decode.resizeHeight * 4 * requiredFrames <= layeredViewer.cacheBudget,
                'Layered full-sphere frames reserve memory for current, replacement and pending images within the cache budget');
            const framing = layeredViewer.framing();
            const centerX = panelOnLeft && !display.compact ? layeredViewer.canvas.width - framing.x : framing.x;
            assert(centerX <= 0 && framing.y > layeredViewer.canvas.height,
                'The close-up keeps the globe center beyond the open side and bottom edges');
            if (display.compact) {
                const topLimb = centerX + Math.sqrt(Math.max(0, framing.radius ** 2 - framing.y ** 2));
                assert(topLimb / layeredViewer.canvas.width >= 0.33 && topLimb / layeredViewer.canvas.width <= 0.47,
                    'Compact body compositions retain both a cropped surface and visible sky');
            } else {
                const midpointDepth = framing.y - layeredViewer.canvas.height * 0.5;
                const midpointLimb = centerX + Math.sqrt(framing.radius ** 2 - midpointDepth ** 2);
                const coverage = midpointLimb / (layeredViewer.canvas.width * layeredViewer.framingLayout.availableFraction);
                assert(coverage >= 0.53 && coverage <= 0.71,
                    'Desktop body compositions keep the limb within the unobstructed region beside the panel');
                assert(framing.radius / layeredViewer.canvas.height >= 1.3 && framing.radius / layeredViewer.canvas.height <= 2,
                    'Desktop crops retain an enlarged curved limb without filling the whole open area');
                if (panelOnLeft) assert(framing.x >= layeredViewer.canvas.width, 'A left information panel mirrors the globe to the right side');
            }
            layeredViewer.clear();
        }
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
    assert.equal(decodes[0].options.premultiplyAlpha, 'premultiply',
        'Production cloud and surface bitmaps must decode with premultiplied alpha to prevent filtered transparent-edge halos');
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
