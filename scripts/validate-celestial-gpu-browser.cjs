'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const reviewRoot = path.resolve(process.env.CELESTIAL_REVIEW_ROOT || path.join(root, '.render-work/celestial-atlas'));
const output = path.resolve(process.env.CELESTIAL_GPU_QA_OUTPUT || path.join(reviewRoot, 'gpu-browser-review'));
const bodyNames = ['earth', 'sun', 'mercury', 'venus', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
const cases = bodyNames.map(body => {
    const directory = path.join(reviewRoot, ['saturn', 'uranus'].includes(body) ? 'baked-full-sphere-v4-review' : 'baked-full-sphere-v3', body);
    const metadataName = fs.readdirSync(directory).find(name => /^render-\d+-0\.json$/.test(name));
    assert(metadataName, `Missing real review metadata for ${body}`);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, metadataName), 'utf8'));
    const row = metadata.frames[0].row;
    const files = {};
    for (const [key, relative] of Object.entries({ surface: `e${row}/a000.webp`, clouds: `clouds/e${row}/a000.webp`, rings: `rings/e${row}/a000.webp`,
        nextSurface: `e${row}/a001.webp`, nextClouds: `clouds/e${row}/a001.webp` })) {
        if (fs.existsSync(path.join(directory, relative))) files[key] = relative;
    }
    assert(files.surface, `Missing real surface frame for ${body}`);
    return { body, directory, row, metadata, files };
});

const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#020208;overflow:hidden}canvas{display:block}</style><canvas id="display"></canvas>');
        return;
    }
    let filename;
    if (url.pathname.startsWith('/source/')) {
        const [, , body, ...parts] = url.pathname.split('/');
        const entry = cases.find(item => item.body === body);
        if (entry && Object.values(entry.files).includes(parts.join('/'))) filename = path.join(entry.directory, ...parts);
    } else if (url.pathname.startsWith('/assets/')) {
        const candidate = path.resolve(root, '.' + url.pathname);
        if (candidate.startsWith(path.join(root, 'assets') + path.sep)) filename = candidate;
    }
    if (!filename || !fs.existsSync(filename)) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : 'image/webp');
    fs.createReadStream(filename).pipe(response);
});

async function main() {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }) });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    const report = { source: 'Real Blender review frames; not a complete release atlas', cases: [], displays: [] };
    try {
        await page.goto(baseUrl);
        await page.evaluate(() => {
            window.COARSE_POINTER = false;
            window.REDUCED_MOTION = false;
            window.usesCompactSkyLayout = () => innerWidth < 700;
            window.clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
            window.state = { currentLang: 'en' };
        });
        for (const script of ['assets/hipparcos-stars.js', 'assets/life/scripts/09-celestial-starfield.js',
            'assets/life/scripts/09-celestial-compositor.js', 'assets/life/scripts/09-baked-closeup.js']) {
            await page.addScriptTag({ url: `${baseUrl}/${script}` });
        }
        await page.evaluate(() => {
            window.viewer = new BakedCelestialViewer();
            viewer.canvas = document.querySelector('#display');
            viewer.context = viewer.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
            viewer.evict = () => {};
            viewer.updateCopy = () => {};
            viewer.element = { classList: { toggle() {}, remove() {} } };
            window.loadReview = async entry => {
                viewer.compositor?.clear();
                for (const image of Object.values(window.reviewImages || {})) image.close();
                window.reviewImages = {};
                for (const [key, relative] of Object.entries(entry.files)) {
                    const response = await fetch(`/source/${entry.body}/${relative}`);
                    if (!response.ok) throw new Error(`Could not load real image ${entry.body}/${relative}`);
                    reviewImages[key] = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'none' });
                }
                viewer.body = { ...entry.metadata, ...entry.metadata.presentation, framePattern: `${entry.body}/e{elevation}/a{azimuth}.webp`,
                    defaultElevation: entry.row, defaultAzimuth: 0 };
                viewer.profile = { id: entry.body };
                viewer.elevation = entry.metadata.elevations[entry.row];
                viewer.azimuth = 0;
                viewer.cloudAzimuth = 0;
                viewer.lastImage = reviewImages.surface;
                viewer.lastCloudImage = reviewImages.clouds || null;
                viewer.lastRingImage = reviewImages.rings || null;
                viewer.lastRingSample = reviewImages.rings ? { layer: 'rings', elevation: entry.row } : null;
                viewer.lastSurfaceSample = { layer: 'surface', elevation: entry.row, azimuth: 0 };
                viewer.lastCloudSample = { layer: 'clouds', elevation: entry.row, azimuth: 0 };
                viewer.canvas.width = innerWidth;
                viewer.canvas.height = innerHeight;
                viewer.draw([], performance.now());
            };
            window.comparePixels = (first, second) => {
                let absolute = 0;
                let maximum = 0;
                let changed = 0;
                for (let index = 0; index < first.length; index += 4) {
                    const difference = Math.abs(first[index] - second[index]) + Math.abs(first[index + 1] - second[index + 1]) + Math.abs(first[index + 2] - second[index + 2]);
                    absolute += difference;
                    maximum = Math.max(maximum, difference);
                    if (difference > 24) changed += 1;
                }
                return { meanAbsoluteRgb: absolute / (first.length / 4 * 3), maximumRgbSum: maximum, fractionOver24: changed / (first.length / 4) };
            };
            window.captureLayers = (layers, compositor) => {
                const canvas = document.createElement('canvas');
                canvas.width = viewer.canvas.width;
                canvas.height = viewer.canvas.height;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                context.fillStyle = '#020208';
                context.fillRect(0, 0, canvas.width, canvas.height);
                if (compositor) {
                    const result = viewer.compositor.render(layers, canvas.width, canvas.height);
                    if (!result) throw new Error('WebGL compositing unavailable');
                    context.drawImage(result, 0, 0);
                } else {
                    const previous = viewer.context;
                    viewer.context = context;
                    viewer.drawLayerFrames(layers);
                    viewer.context = previous;
                }
                return context.getImageData(0, 0, canvas.width, canvas.height).data;
            };
            window.captureLayer = (layer, compositor) => captureLayers([layer], compositor);
        });
        for (const entry of cases) {
            await page.evaluate(entry => loadReview(entry), entry);
            const metrics = await page.evaluate(() => {
                const gl = viewer.compositor?.gl;
                if (!gl) throw new Error('Chrome has no WebGL context; image GPU validation cannot pass');
                const debug = gl.getExtension('WEBGL_debug_renderer_info');
                const result = { body: viewer.profile.id, renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
                    sourceDimensions: [reviewImages.surface.width, reviewImages.surface.height] };
                const framing = viewer.framing();
                const layer = viewer.sphereLayer(reviewImages.surface, viewer.lastSurfaceSample, framing);
                result.zeroRotation = comparePixels(captureLayer(layer, true), captureLayer(layer, false));
                if (reviewImages.clouds) {
                    const clouds = viewer.sphereLayer(reviewImages.clouds, viewer.lastCloudSample, framing, 'clouds');
                    result.cloudAlphaZero = comparePixels(captureLayer(clouds, true), captureLayer(clouds, false));
                    const nextClouds = viewer.sphereLayer(reviewImages.nextClouds || reviewImages.clouds,
                        { ...viewer.lastCloudSample, timeIndex: 1 }, framing, 'clouds');
                    clouds.key = 'clouds:0';
                    clouds.blendGroup = 'climate';
                    nextClouds.blendGroup = 'climate';
                    const firstPixels = captureLayer(clouds, true);
                    const nextPixels = captureLayer(nextClouds, true);
                    result.climateInterpolation = [];
                    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
                        clouds.opacity = 1 - fraction;
                        nextClouds.opacity = fraction;
                        const expected = new Uint8ClampedArray(firstPixels.length);
                        for (let index = 0; index < expected.length; index += 1) {
                            expected[index] = firstPixels[index] * (1 - fraction) + nextPixels[index] * fraction;
                        }
                        result.climateInterpolation.push({ fraction,
                            gpu: comparePixels(expected, captureLayers([clouds, nextClouds], true)),
                            fallback: comparePixels(expected, captureLayers([clouds, nextClouds], false)) });
                    }
                }
                if (reviewImages.nextSurface) {
                    viewer.azimuth = 1 - 0.00001;
                    const before = captureLayer(viewer.sphereLayer(reviewImages.surface, viewer.lastSurfaceSample, framing), true);
                    viewer.azimuth = 1 + 0.00001;
                    const after = captureLayer(viewer.sphereLayer(reviewImages.nextSurface, { ...viewer.lastSurfaceSample, azimuth: 2 }, framing), true);
                    result.sourceBoundary = comparePixels(before, after);
                    viewer.azimuth = 1 - 0.00001;
                    const wrongBeforeLayer = viewer.sphereLayer(reviewImages.surface, viewer.lastSurfaceSample, framing);
                    wrongBeforeLayer.angle *= -1;
                    const wrongBefore = captureLayer(wrongBeforeLayer, true);
                    viewer.azimuth = 1 + 0.00001;
                    const wrongAfterLayer = viewer.sphereLayer(reviewImages.nextSurface, { ...viewer.lastSurfaceSample, azimuth: 2 }, framing);
                    wrongAfterLayer.angle *= -1;
                    result.oppositeSignBoundary = comparePixels(wrongBefore, captureLayer(wrongAfterLayer, true));
                    viewer.azimuth = 0;
                    const original = captureLayer(viewer.sphereLayer(reviewImages.surface, viewer.lastSurfaceSample, framing), true);
                    viewer.azimuth = 2;
                    const neighbor = captureLayer(viewer.sphereLayer(reviewImages.nextSurface, { ...viewer.lastSurfaceSample, azimuth: 2 }, framing), true);
                    result.rawNeighborDifference = comparePixels(original, neighbor);
                }
                if (reviewImages.nextClouds) {
                    viewer.cloudAzimuth = 1 - 0.00001;
                    const beforeLayer = viewer.sphereLayer(reviewImages.clouds, viewer.lastCloudSample, framing, 'clouds');
                    const before = captureLayer(beforeLayer, true);
                    beforeLayer.angle *= -1;
                    const wrongBefore = captureLayer(beforeLayer, true);
                    viewer.cloudAzimuth = 1 + 0.00001;
                    const afterLayer = viewer.sphereLayer(reviewImages.nextClouds, { ...viewer.lastCloudSample, azimuth: 2 }, framing, 'clouds');
                    const after = captureLayer(afterLayer, true);
                    afterLayer.angle *= -1;
                    result.cloudSourceBoundary = comparePixels(before, after);
                    result.cloudOppositeSignBoundary = comparePixels(wrongBefore, captureLayer(afterLayer, true));
                    viewer.cloudAzimuth = 0;
                    const original = captureLayer(viewer.sphereLayer(reviewImages.clouds, viewer.lastCloudSample, framing, 'clouds'), true);
                    viewer.cloudAzimuth = 2;
                    const neighbor = captureLayer(viewer.sphereLayer(reviewImages.nextClouds, { ...viewer.lastCloudSample, azimuth: 2 }, framing, 'clouds'), true);
                    result.cloudRawNeighborDifference = comparePixels(original, neighbor);
                }
                viewer.azimuth = 0.65;
                viewer.cloudAzimuth = 0.73;
                viewer.draw([], performance.now());
                return result;
            });
            report.cases.push(metrics);
            assert(metrics.zeroRotation.meanAbsoluteRgb < 0.1 && metrics.zeroRotation.maximumRgbSum <= 6,
                `${entry.body}: zero rotation differs excessively from the source`);
            if (metrics.cloudAlphaZero) assert(metrics.cloudAlphaZero.meanAbsoluteRgb < 0.1 && metrics.cloudAlphaZero.maximumRgbSum <= 6,
                `${entry.body}: cloud alpha composition differs from the source`);
            for (const interpolation of metrics.climateInterpolation || []) for (const mode of ['gpu', 'fallback']) {
                assert(interpolation[mode].meanAbsoluteRgb < 0.6 && interpolation[mode].maximumRgbSum <= 9,
                    `${entry.body}: ${mode} climate crossfade at ${interpolation.fraction} must preserve premultiplied cloud brightness`);
            }
            if (metrics.sourceBoundary) assert(metrics.sourceBoundary.meanAbsoluteRgb < metrics.rawNeighborDifference.meanAbsoluteRgb,
                `${entry.body}: sphere reprojection must reduce the adjacent capture boundary discontinuity`);
            if (metrics.oppositeSignBoundary) assert(metrics.sourceBoundary.meanAbsoluteRgb < metrics.oppositeSignBoundary.meanAbsoluteRgb,
                `${entry.body}: the selected rotation sign must align adjacent surface captures better than its opposite`);
            if (metrics.cloudSourceBoundary) assert(metrics.cloudSourceBoundary.meanAbsoluteRgb < metrics.cloudRawNeighborDifference.meanAbsoluteRgb
                && metrics.cloudSourceBoundary.meanAbsoluteRgb < metrics.cloudOppositeSignBoundary.meanAbsoluteRgb,
            `${entry.body}: independently rotated clouds must align their captured source views`);
            await page.screenshot({ path: path.join(output, `${entry.body}-1080p.png`) });
        }
        const earth = cases.find(entry => entry.body === 'earth');
        await page.evaluate(entry => loadReview(entry), earth);
        for (const [name, width, height] of [['1080p', 1920, 1080], ['4k', 3840, 2160], ['portrait', 390, 844], ['ultrawide', 3440, 1440]]) {
            await page.setViewportSize({ width, height });
            const metrics = await page.evaluate(async ({ name, width, height }) => {
                viewer.canvas.width = width;
                viewer.canvas.height = height;
                const gl = viewer.compositor.gl;
                const elapsed = [];
                const intervals = [];
                let previous = 0;
                for (let index = 0; index < 36; index += 1) {
                    const timestamp = await new Promise(requestAnimationFrame);
                    if (previous) intervals.push(timestamp - previous);
                    previous = timestamp;
                    viewer.azimuth = 0.1 + index / 100;
                    viewer.cloudAzimuth = 0.2 + index / 90;
                    const started = performance.now();
                    viewer.draw([], timestamp);
                    gl.finish();
                    elapsed.push(performance.now() - started);
                }
                const summary = values => {
                    const sorted = values.slice(6).sort((first, second) => first - second);
                    return { median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], maximum: sorted.at(-1) };
                };
                return { name, width, height, frameWorkMsWithGpuFinish: summary(elapsed), rafIntervalMs: summary(intervals), textures: viewer.compositor.textures.size };
            }, { name, width, height });
            report.displays.push(metrics);
            assert(metrics.textures <= 2, `${name}: compositor exceeds two surface/cloud textures`);
            await page.screenshot({ path: path.join(output, `earth-${name}.png`) });
        }
        report.contextLoss = await page.evaluate(async () => {
            const extension = viewer.compositor.gl.getExtension('WEBGL_lose_context');
            if (!extension) return { supported: false };
            const lost = new Promise(resolve => viewer.compositor.canvas.addEventListener('webglcontextlost', resolve, { once: true }));
            extension.loseContext();
            await lost;
            const drawLayerFrame = viewer.drawLayerFrame;
            let fallbackLayers = 0;
            viewer.drawLayerFrame = function (...args) { fallbackLayers += 1; return drawLayerFrame.apply(this, args); };
            viewer.draw([], performance.now());
            viewer.drawLayerFrame = drawLayerFrame;
            const fallbackDrawn = Boolean(viewer.lastImage && viewer.compositor.lost && fallbackLayers === 2);
            const restored = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('WebGL context did not restore within 10 seconds')), 10000);
                viewer.compositor.canvas.addEventListener('webglcontextrestored', () => { clearTimeout(timeout); resolve(); }, { once: true });
            });
            await new Promise(resolve => setTimeout(resolve, 150));
            extension.restoreContext();
            await restored;
            viewer.draw([], performance.now());
            return { supported: true, fallbackDrawn, fallbackLayers, restored: Boolean(viewer.compositor.program && !viewer.compositor.lost) };
        });
        assert(!report.contextLoss.supported || report.contextLoss.fallbackDrawn && report.contextLoss.restored, 'Context loss must preserve fallback and recovery');
        assert.deepEqual(errors, [], 'Chrome emitted page errors');
        report.errors = errors;
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
