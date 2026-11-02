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
    { name: 'arm', distance: 6000, pitch: 0.48 },
    { name: 'outer', distance: 18000, pitch: 0.48 },
    { name: 'overview', distance: 43000, pitch: 0.48 },
    { name: 'edge', distance: 43000, pitch: 0.035, center: [-47, -10.8, 8184] },
    { name: 'face', distance: 43000, pitch: 1.35, center: [-47, -10.8, 8184] },
    { name: 'remote', distance: 1400, pitch: 0.34, center: [6800, 30, 12000] }
];

async function inspect(page, scenario) {
    return page.evaluate(scenario => {
        const map = lifeStarMap;
        map.center = map.target.center = scenario.center || [0, 0, 0];
        map.distance = map.target.distance = scenario.distance;
        map.pitch = map.target.pitch = scenario.pitch;
        map.yaw = map.target.yaw = 0;
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
        const capture = (moving = false, yaw = 0) => {
            map.yaw = yaw;
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
            renderer.stars = savedStars.subarray(0, renderer.localStars.length + renderer.environmentStars.length);
            const withoutStars = capture();
            renderer.stars = new Float32Array();
            const resting = capture();
            const moving = capture(true);
            const tiny = capture(true, 0.00001);
            const turned = capture(true, 0.08);
            const returned = capture();
            renderer.galacticNoise = neutral;
            const withoutStructure = capture();
            renderer.galacticNoise = savedNoise;
            const started = performance.now();
            capture();
            return { stars: difference(full, withoutStars), motion: difference(resting, moving),
                tiny: difference(resting, tiny), turned: difference(resting, turned), returned: difference(resting, returned),
                clouds: difference(resting, withoutStructure), frameMilliseconds: performance.now() - started,
                glError: context.getError() };
        } finally {
            renderer.stars = savedStars;
            renderer.galacticNoise = savedNoise;
            context.deleteTexture(neutral);
            map.yaw = 0;
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
                await page.goto(new URL('life.html', base).href, { waitUntil: 'domcontentloaded' });
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
                const local = await inspect(page, { distance: mobile ? 600 : 430, pitch: mobile ? 0.55 : 0.48 });
                if (!mobile) assert(local.stars.mean === 0 && local.clouds.mean === 0);
                for (const scenario of scenarios.filter(item => !mobile || ['arm', 'overview', 'remote'].includes(item.name))) {
                    const report = await inspect(page, scenario);
                    assert(report.stars.resolved > 50, `${mode}/${scenario.name}: independent stellar points remain visible`);
                    assert(report.clouds.mean > 0.002, `${mode}/${scenario.name}: nonuniform 3D clouds contribute outside the solar region`);
                    assert(report.motion.mean === 0 && report.returned.mean === 0, `${mode}/${scenario.name}: motion state and return preserve the same cloud`);
                    assert(report.tiny.mean < 0.4 && report.turned.mean > report.tiny.mean + 0.02,
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
