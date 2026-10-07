'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const reviewRoot = path.resolve(process.env.CELESTIAL_REVIEW_ROOT || path.join(root, '.render-work/celestial-atlas'));
const output = path.join(reviewRoot, 'multires-browser-review');
const cases = [
    ['earth', 'baked-multires-v5-review', 3],
    ['saturn', 'baked-ring-detail-8k-review', 4],
    ['uranus', 'baked-ring-detail-8k-review', 4]
].map(([body, directory, row]) => {
    const source = path.join(reviewRoot, directory, body);
    const metadata = JSON.parse(fs.readFileSync(path.join(source, `render-${row}-0.json`), 'utf8'));
    assert.equal(metadata.width, 8192, `${body}: expected authentic 8K source`);
    return { body, source, row, metadata };
});

const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#020208;overflow:hidden}canvas{display:block}</style><canvas id="display"></canvas>');
        return;
    }
    let filename;
    if (pathname.startsWith('/source/')) {
        const [, , body, ...segments] = pathname.split('/');
        const entry = cases.find(item => item.body === body);
        const candidate = entry && path.resolve(entry.source, ...segments);
        if (candidate?.startsWith(entry.source + path.sep)) filename = candidate;
    } else if (pathname.startsWith('/assets/')) {
        const candidate = path.resolve(root, '.' + pathname);
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
    const browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const report = { source: 'Authentic 8192-pixel Blender sample layers, cropped with production request()/loadFrame()', cases: [] };
    const errors = [];
    try {
        for (const display of [
            { name: '4k', width: 3840, height: 2160, dpr: 1, compact: false, left: false },
            { name: '4k-left-panel', width: 1920, height: 1080, dpr: 2, compact: false, left: true },
            { name: 'mobile', width: 390, height: 844, dpr: 3, compact: true, left: false }
        ]) {
            const page = await browser.newPage({ viewport: { width: display.width, height: display.height }, deviceScaleFactor: display.dpr });
            page.on('pageerror', error => errors.push(error.stack || error.message));
            await page.goto(baseUrl);
            await page.evaluate(display => {
                window.COARSE_POINTER = display.compact;
                window.REDUCED_MOTION = true;
                window.usesCompactSkyLayout = () => display.compact;
                window.clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
                window.state = { currentLang: 'en' };
            }, display);
            for (const script of ['09-celestial-compositor.js', '09-baked-closeup.js']) {
                await page.addScriptTag({ url: `${baseUrl}/assets/life/scripts/${script}` });
            }
            for (const entry of cases) {
                const metrics = await page.evaluate(async ({ entry, display }) => {
                    const viewer = new BakedCelestialViewer();
                    viewer.canvas = document.querySelector('#display');
                    viewer.context = viewer.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
                    viewer.element = { classList: { toggle() {}, remove() {} } };
                    viewer.updateCopy = () => {};
                    viewer.body = { ...entry.metadata, ...entry.metadata.presentation, defaultElevation: entry.row,
                        framePattern: `/source/${entry.body}/e{elevation}/a{azimuth}.webp` };
                    if (viewer.body.cloudFramePattern) viewer.body.cloudFramePattern = `/source/${entry.body}/clouds/e{elevation}/a{azimuth}.webp`;
                    if (viewer.body.ringFramePattern) viewer.body.ringFramePattern = `/source/${entry.body}/rings/e{elevation}/a000.webp`;
                    viewer.profile = { id: entry.body };
                    viewer.visit = { panelOnLeft: display.left };
                    viewer.elevation = viewer.body.elevations[entry.row];
                    viewer.azimuth = 0;
                    viewer.cloudAzimuth = 0;
                    viewer.resize();
                    viewer.compositor = new CelestialSphereCompositor();
                    const draw = (image, sample) => {
                        viewer.context.fillStyle = '#020208';
                        viewer.context.fillRect(0, 0, viewer.canvas.width, viewer.canvas.height);
                        if (sample.layer === 'rings') viewer.drawRing(image, viewer.framing());
                        else {
                            const layer = viewer.sphereLayer(image, sample, viewer.framing(), sample.layer);
                            const composed = viewer.compositor.render([layer], viewer.canvas.width, viewer.canvas.height);
                            if (!composed) throw new Error('Real WebGL compositor unavailable');
                            viewer.context.drawImage(composed, 0, 0);
                        }
                        return viewer.context.getImageData(0, 0, viewer.canvas.width, viewer.canvas.height).data;
                    };
                    const compare = (expected, actual) => {
                        let absolute = 0;
                        let maximum = 0;
                        let missing = 0;
                        let over24 = 0;
                        for (let index = 0; index < expected.length; index += 4) {
                            const difference = Math.abs(expected[index] - actual[index]) + Math.abs(expected[index + 1] - actual[index + 1]) + Math.abs(expected[index + 2] - actual[index + 2]);
                            absolute += difference;
                            maximum = Math.max(maximum, difference);
                            if (difference > 24) over24 += 1;
                            if (expected[index] + expected[index + 1] + expected[index + 2] > 50 && actual[index] + actual[index + 1] + actual[index + 2] <= 12) missing += 1;
                        }
                        return { meanAbsoluteRgb: absolute / (expected.length / 4 * 3), maximumRgbSum: maximum,
                            fractionOver24: over24 / (expected.length / 4), missingPixels: missing };
                    };
                    const result = { body: entry.body, display: display.name, physicalCanvas: [viewer.canvas.width, viewer.canvas.height],
                        framing: viewer.framing(), layers: [] };
                    const samples = viewer.samples();
                    const ring = viewer.ringSample();
                    if (ring) samples.push(ring);
                    for (const sample of samples) {
                        const plan = viewer.decodePlan(sample);
                        const decoded = await viewer.request(sample.url, sample);
                        if (!decoded) throw new Error(`Production cropped decode failed: ${sample.url}`);
                        const metadata = viewer.imageMetadata.get(decoded);
                        if (!metadata?.crop) throw new Error('Production decode did not preserve crop metadata');
                        const blob = await (await fetch(sample.url)).blob();
                        const full = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
                        const rawCrop = await createImageBitmap(blob, plan.crop.x, plan.crop.y, plan.crop.width, plan.crop.height, { premultiplyAlpha: 'none' });
                        viewer.imageMetadata.set(rawCrop, plan);
                        const layerResult = { layer: sample.layer, sourceDimensions: [full.width, full.height], decodedDimensions: [decoded.width, decoded.height],
                            crop: plan.crop, decodedBytes: decoded.width * decoded.height * 4, angles: [] };
                        for (const angle of sample.layer === 'rings' ? [0] : [0, -2, 2]) {
                            viewer.azimuth = angle;
                            viewer.cloudAzimuth = angle;
                            const expected = draw(full, sample);
                            layerResult.angles.push({ angle, cropOnly: compare(expected, draw(rawCrop, sample)), production: compare(expected, draw(decoded, sample)) });
                        }
                        result.layers.push(layerResult);
                        full.close();
                        rawCrop.close();
                    }
                    const gl = viewer.compositor.gl;
                    const debug = gl.getExtension('WEBGL_debug_renderer_info');
                    result.renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
                    result.cacheBytes = viewer.cacheBytes;
                    result.cacheBudget = viewer.cacheBudget;
                    viewer.azimuth = 0.7;
                    viewer.cloudAzimuth = 0.784;
                    viewer.draw(viewer.samples(), performance.now());
                    window.reviewViewer = viewer;
                    return result;
                }, { entry, display });
                report.cases.push(metrics);
                for (const layer of metrics.layers) for (const angle of layer.angles) {
                    assert(angle.cropOnly.meanAbsoluteRgb < 0.12 && angle.cropOnly.fractionOver24 < 0.0001,
                        `${entry.body} ${display.name} ${layer.layer} ${angle.angle}: crop must preserve the complete source projection`);
                    assert(angle.production.meanAbsoluteRgb < 1.5 && angle.production.fractionOver24 < 0.02,
                        `${entry.body} ${display.name} ${layer.layer} ${angle.angle}: display-sized crop loses too much visible detail`);
                    assert(angle.cropOnly.missingPixels === 0, `${entry.body}: crop bounds must retain every visible sphere pixel`);
                }
                assert(metrics.cacheBytes <= metrics.cacheBudget);
                await page.screenshot({ path: path.join(output, `${entry.body}-${display.name}.png`) });
                await page.evaluate(() => reviewViewer.clear());
            }
            await page.close();
        }
        assert.deepEqual(errors, []);
        report.errors = errors;
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify(report, null, 2));
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; server.close(); });
