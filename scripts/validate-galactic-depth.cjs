'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8797/';
const output = path.resolve(__dirname, '../.render-work/galactic-depth');
const reports = [];
const errors = [];
const scenarios = [
    { name: 'grazing', distance: 4560, pitch: 0.05, yaw: 4.0 },
    { name: 'grazing-below', distance: 4560, pitch: -0.05, yaw: 4.0 },
    { name: 'arm', distance: 6000, pitch: 0.48 },
    { name: 'outer', distance: 18000, pitch: 0.48 },
    { name: 'overview', distance: 43000, pitch: 0.48 },
    { name: 'edge', distance: 43000, pitch: 0.035, center: [-47, -10.8, 8184] },
    { name: 'face', distance: 43000, pitch: 1.35, center: [-47, -10.8, 8184] },
    { name: 'remote', distance: 1400, pitch: 0.34, center: [6800, 30, 12000] },
    { name: 'inner-neighborhood', distance: 430, pitch: 0.055, center: [-3500, 0, 9400], neighborhood: true },
    { name: 'outer-neighborhood', distance: 430, pitch: 0.48, center: [9100, 70, 15500], neighborhood: true }
];

// Introduce the comparison switch only in the browser under test. It disables
// the new close-range cloud structure while preserving the large-scale dust.
function instrumentNeighborhoodClouds() {
    const proto = WebGLRenderingContext.prototype;
    const shaderSource = proto.shaderSource;
    proto.shaderSource = function(shader, source) {
        if (source.includes('if (nearbyClouds > 0.0)')) {
            source = source.replace('void sampleGalacticMedium(', 'uniform float uTestSkipNearbyClouds;\nvoid sampleGalacticMedium(')
                .replace('if (nearbyClouds > 0.0)', 'if (nearbyClouds > 0.0 && uTestSkipNearbyClouds < 0.5)');
        }
        shaderSource.call(this, shader, source);
    };
}

async function inspect(page, scenario) {
    return page.evaluate(scenario => {
        const map = lifeStarMap;
        map.center = map.target.center = scenario.center || [0, 0, 0];
        map.distance = map.target.distance = scenario.distance;
        map.pitch = map.target.pitch = scenario.pitch;
        map.yaw = map.target.yaw = scenario.yaw || 0;
        map.rendererViewKey = null;
        map.render(performance.now());
        const renderer = map.renderer;
        const context = renderer.gl;
        const savedStars = renderer.stars;
        const savedNoise = renderer.galacticNoise;
        const read = () => {
            const pixels = new Uint8Array(renderer.canvas.width * renderer.canvas.height * 4);
            context.readPixels(0, 0, renderer.canvas.width, renderer.canvas.height, context.RGBA, context.UNSIGNED_BYTE, pixels);
            return pixels;
        };
        const capture = (moving = false, yaw = 0, pitch = 0) => {
            map.yaw = (scenario.yaw || 0) + yaw;
            map.pitch = scenario.pitch + pitch;
            renderer.render({ ...map.view(), moving });
            return read();
        };
        const difference = (first, second) => {
            let total = 0;
            let resolved = 0;
            for (let offset = 0; offset < first.length; offset += 4) {
                const amount = Math.abs(first[offset] - second[offset])
                    + Math.abs(first[offset + 1] - second[offset + 1]) + Math.abs(first[offset + 2] - second[offset + 2]);
                total += amount;
                if (amount > 18) resolved++;
            }
            return { mean: total / (first.length / 4), resolved };
        };
        const neutral = context.createTexture();
        context.bindTexture(context.TEXTURE_2D, neutral);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
        context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 1, 1, 0, context.RGBA, context.UNSIGNED_BYTE,
            new Uint8Array([128, 128, 128, 255]));
        try {
            const full = capture();
            let neighborhood;
            if (scenario.neighborhood) {
                const field = renderer.nearbyField;
                const update = field.update;
                const fallbackClouds = renderer.renderNearbyCloudsFallback;
                const noStars = new Float32Array();
                const captureFallback = () => {
                    renderer.renderFallback(map.view());
                    const canvas = renderer.fallbackCanvas;
                    return renderer.fallback.getImageData(0, 0, canvas.width, canvas.height).data;
                };
                const uniforms = [renderer.cloudProgram, renderer.copyProgram].map(program => {
                    const location = context.getUniformLocation(program, 'uTestSkipNearbyClouds');
                    if (!location) throw new Error('Missing neighborhood cloud comparison uniform');
                    return [program, location];
                });
                const skipClouds = value => {
                    for (const [program, location] of uniforms) {
                        context.useProgram(program);
                        context.uniform1f(location, value);
                    }
                };
                try {
                    const fallbackFull = captureFallback();
                    field.update = () => noStars;
                    const withoutNearbyStars = capture();
                    const fallbackWithoutStars = captureFallback();
                    field.update = update;
                    renderer.renderNearbyCloudsFallback = () => {};
                    const fallbackWithoutClouds = captureFallback();
                    renderer.renderNearbyCloudsFallback = fallbackClouds;
                    skipClouds(1);
                    const withoutNearbyClouds = capture();
                    skipClouds(0);
                    // Render from a distant coordinate to replace the nearby
                    // spatial cells, then revisit the original coordinates.
                    const view = map.view();
                    renderer.render({ ...view, position: view.position.map((v, i) => v + (i === 0 ? 10000 : 0)) });
                    let crossing;
                    if (scenario.center) {
                        const x = Math.round(view.position[0] / 320) * 320;
                        const crossAt = offset => {
                            renderer.render({ ...view, position: [x + offset, view.position[1], view.position[2]] });
                            const points = field.stars, coordinates = [];
                            for (let i = 0; i < points.length; i += 9) {
                                if (Math.hypot(points[i] - x, points[i + 1] - view.position[1], points[i + 2] - view.position[2]) < 630) {
                                    coordinates.push(points[i], points[i + 1], points[i + 2]);
                                }
                            }
                            return { coordinates, image: read() };
                        };
                        const left = crossAt(-0.001), right = crossAt(0.001);
                        crossing = { visible: left.coordinates.length / 3, image: difference(left.image, right.image),
                            fixed: left.coordinates.length === right.coordinates.length && left.coordinates.every((v, i) => v === right.coordinates[i]) };
                    }
                    // In the inner disk the middle of this view looks through
                    // the opaque dust lane. Stars in front must stay visible.
                    const band = data => data.subarray(Math.floor(renderer.canvas.height * 0.50) * renderer.canvas.width * 4,
                        Math.ceil(renderer.canvas.height * 0.58) * renderer.canvas.width * 4);
                    neighborhood = { stars: difference(full, withoutNearbyStars), clouds: difference(full, withoutNearbyClouds), crossing,
                        centralBandStars: difference(band(full), band(withoutNearbyStars)),
                        fallbackStars: difference(fallbackFull, fallbackWithoutStars),
                        fallbackClouds: difference(fallbackFull, fallbackWithoutClouds),
                        revisit: difference(full, capture()), pixels: full.length / 4 };
                } finally {
                    field.update = update;
                    renderer.renderNearbyCloudsFallback = fallbackClouds;
                    skipClouds(0);
                }
            }
            renderer.stars = savedStars.subarray(0, renderer.localStars.length + renderer.environmentStars.length);
            const withoutStars = capture();
            renderer.stars = new Float32Array();
            const resting = capture();
            const moving = capture(true);
            const tiny = capture(true, 0.00001);
            const tilted = capture(true, 0, 0.00001);
            const turned = capture(true, 0.08);
            const returned = capture();
            renderer.galacticNoise = neutral;
            const withoutStructure = capture();
            renderer.galacticNoise = savedNoise;
            const started = performance.now();
            capture();
            return { neighborhood, stars: difference(full, withoutStars), motion: difference(resting, moving),
                tiny: difference(resting, tiny), tilted: difference(resting, tilted),
                turned: difference(resting, turned), returned: difference(resting, returned),
                clouds: difference(resting, withoutStructure), frameMilliseconds: performance.now() - started,
                glError: context.getError() };
        } finally {
            renderer.stars = savedStars;
            renderer.galacticNoise = savedNoise;
            context.deleteTexture(neutral);
            map.yaw = scenario.yaw || 0;
            map.pitch = scenario.pitch;
            renderer.render(map.view());
        }
    }, scenario);
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    try {
        for (const mobile of [false, true]) {
            const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
                isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, reducedMotion: 'reduce' });
            const page = await context.newPage();
            const mode = mobile ? 'mobile' : 'desktop';
            page.on('pageerror', error => errors.push(error.message));
            try {
                await page.addInitScript(instrumentNeighborhoodClouds);
                await page.goto(new URL('life.html?music=off', base).href, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => window.lifeStarMap?.renderer.galacticLoadedAt != null && lifeStarMap.renderer.skyUploaded);
                const population = await page.evaluate(() => {
                    const renderer = lifeStarMap.renderer;
                    window.depthTestStars = renderer.galacticStars.slice();
                    const quadrants = [0, 0, 0, 0];
                    let above = 0, below = 0;
                    for (let offset = 0; offset < renderer.galacticStars.length; offset += 9) {
                        const position = GALACTIC_SPACE.toDisk(Array.from(renderer.galacticStars.subarray(offset, offset + 3)));
                        quadrants[(position[0] > 0 ? 1 : 0) + (position[2] > 0 ? 2 : 0)]++;
                        const warp = Math.sin(position[0] * 0.008) * Math.pow(Math.hypot(position[0], position[2]) / 480, 2) * 9;
                        if (position[1] - warp > 3) above++;
                        if (position[1] - warp < -3) below++;
                    }
                    return { count: renderer.galacticStars.length / 9, compact: COARSE_POINTER || navigator.deviceMemory <= 4,
                        quadrants, above, below, ready: renderer.ready, atlasBytes: renderer.galacticNoiseData.length };
                });
                assert(population.ready && population.count === (population.compact ? 98304 : 196608));
                assert(population.quadrants.every(count => count > population.count * 0.10));
                assert(population.above > population.count * 0.20 && population.below > population.count * 0.20);
                assert(population.atlasBytes < 2 * 1024 * 1024);
                console.log(`PASS ${mode}: fixed stars populate all quadrants and both sides of the disk within the memory budget`);
                const local = await inspect(page, { distance: mobile ? 600 : 430, pitch: mobile ? 0.55 : 0.48, neighborhood: true });
                if (!mobile) assert(local.stars.mean === 0 && local.clouds.mean === 0);
                assert.equal(local.neighborhood.stars.mean, 0, 'Original solar star field is preserved');
                assert.equal(local.neighborhood.clouds.mean, 0, 'Original solar cloud field is preserved');
                assert.equal(local.neighborhood.fallbackStars.mean, 0, 'Canvas preserves the solar star field');
                assert.equal(local.neighborhood.fallbackClouds.mean, 0, 'Canvas preserves the solar cloud field');
                for (const scenario of scenarios.filter(item => !mobile || item.neighborhood || ['grazing', 'arm', 'overview', 'remote'].includes(item.name))) {
                    const report = await inspect(page, scenario);
                    if (scenario.neighborhood) {
                        const detail = report.neighborhood;
                        assert(detail.stars.resolved > detail.pixels * 0.0002, `${mode}/${scenario.name}: nearby stars are individually visible: ${JSON.stringify(detail.stars)}`);
                        assert(detail.clouds.mean > 0.15, `${mode}/${scenario.name}: nearby cloud structure is visible: ${JSON.stringify(detail.clouds)}`);
                        assert(detail.fallbackStars.resolved > 20 && detail.fallbackClouds.mean > 0.05,
                            `${mode}/${scenario.name}: Canvas renders nearby stars and clouds: ${JSON.stringify(detail)}`);
                        assert.equal(detail.revisit.mean, 0, `${mode}/${scenario.name}: returning after a 10 kpc displacement restores every pixel`);
                        assert(detail.crossing.visible > 100 && detail.crossing.fixed && detail.crossing.image.mean < 0.15,
                            `${mode}/${scenario.name}: crossing a spatial cell preserves the visible stars: ${JSON.stringify(detail.crossing)}`);
                        if (scenario.name === 'inner-neighborhood') assert(detail.centralBandStars.resolved > 30,
                            `${mode}: the opaque inner dust lane retains foreground stars: ${JSON.stringify(detail.centralBandStars)}`);
                    }
                    assert(report.stars.resolved > 50, `${mode}/${scenario.name}: independent stellar points remain visible`);
                    assert(report.clouds.mean > 0.002, `${mode}/${scenario.name}: nonuniform 3D clouds contribute outside the solar region`);
                    assert(report.motion.mean === 0 && report.returned.mean === 0, `${mode}/${scenario.name}: motion state and return preserve the same cloud`);
                    assert(report.tiny.mean < 0.4 && report.tilted.mean < 0.4 && report.turned.mean > report.tiny.mean + 0.02,
                        `${mode}/${scenario.name}: camera rotation changes depth smoothly`);
                    assert.equal(report.glError, 0);
                    assert(await page.evaluate(() => window.depthTestStars.every((value, index) => value === lifeStarMap.renderer.galacticStars[index])));
                    await page.screenshot({ path: path.join(output, `${mode}-${scenario.name}.png`) });
                    reports.push({ mode, scenario: scenario.name, ...report });
                    console.log(`PASS ${mode}/${scenario.name}: stars, volume, smooth rotation, fixed coordinates; ${report.frameMilliseconds.toFixed(1)} ms including readback`);
                }
            } finally { await context.close(); }
        }
        assert.deepEqual(errors, []);
        fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify(reports, null, 2) + '\n');
        console.log('Galactic depth validation passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
