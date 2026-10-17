'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || path.join(process.env.USERPROFILE,
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const base = process.argv[2] || 'http://127.0.0.1:8787/';
const output = path.resolve(__dirname, '../.render-work/cloud-stability');
const errors = [], measurements = [];
let checks = 0;
function check(condition, message, details) {
    assert(condition, `${message}\n${JSON.stringify(details || {})}`);
    checks++;
    console.log(`PASS ${message}`);
}

async function compare(page, label, galaxy) {
    const result = await page.evaluate(galaxy => {
        const map = window.lifeStarMap, renderer = map.renderer, gl = renderer.gl;
        const saved = { stars: renderer.stars, sky: renderer.skyUploaded, yaw: map.yaw };
        renderer.stars = new Float32Array();
        renderer.skyUploaded = false;
        const capture = (moving, angle) => {
            map.yaw = saved.yaw + angle;
            renderer.render({ ...map.view(), galaxy, moving });
            gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.framebuffer);
            const pixels = new Uint8Array(renderer.cloudWidth * renderer.cloudHeight * 4);
            gl.readPixels(0, 0, renderer.cloudWidth, renderer.cloudHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return { pixels, dimensions: [renderer.cloudWidth, renderer.cloudHeight] };
        };
        const difference = (a, b) => {
            if (a.pixels.length !== b.pixels.length) return { changed: Infinity, mean: Infinity };
            let changed = 0, sum = 0;
            for (let index = 0; index < a.pixels.length; index++) {
                const delta = Math.abs(a.pixels[index] - b.pixels[index]);
                if (delta) changed++;
                sum += delta;
            }
            return { changed, mean: sum / a.pixels.length };
        };
        try {
            const resting = capture(false, 0), moving = capture(true, 0), stopped = capture(false, 0);
            const tinyTurn = capture(true, 0.00001), turned = capture(true, 0.12), returned = capture(false, 0);
            return { dimensions: [resting.dimensions, moving.dimensions, stopped.dimensions],
                start: difference(resting, moving), stop: difference(resting, stopped),
                tiny: difference(resting, tinyTurn), turn: difference(resting, turned),
                return: difference(resting, returned), glError: gl.getError() };
        } finally {
            renderer.stars = saved.stars;
            renderer.skyUploaded = saved.sky;
            map.yaw = saved.yaw;
            renderer.render(map.currentView);
        }
    }, galaxy);
    check(result.start.changed === 0 && result.stop.changed === 0,
        `${label}: starting and stopping a drag preserves identical volume pixels at the same pose`, result);
    check(result.tiny.mean < 0.12 && result.turn.mean > result.tiny.mean + 0.02,
        `${label}: small angular motion changes the cloud smoothly, while rotation reveals its structure`, result);
    check(result.return.changed === 0 && result.glError === 0,
        `${label}: returning to the same angle exactly restores the cloud without WebGL errors`, result);
    measurements.push({ label, ...result });
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    try {
        for (const mobile of [false, true]) {
            const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
                deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            try {
                for (const route of ['life.html', 'observatory.html']) {
                    await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(() => window.lifeStarMap?.renderer.ready && window.lifeStarMap.lastFrame > 0);
                    await page.evaluate(() => window.lifeStarMap.renderer.skyAssetsPromise);
                    const label = `${route}/${mobile ? 'mobile' : 'desktop'}`;
                    if (route === 'life.html') {
                        await compare(page, label + '/local', 0);
                        await page.screenshot({ path: path.join(output, `local-${mobile ? 'mobile' : 'desktop'}.png`) });
                    }
                    await page.evaluate(() => window.lifeStarMap.showGalaxy());
                    await page.waitForFunction(() => !window.lifeStarMap.flight && !window.lifeStarMap.pendingGalaxy
                        && window.lifeStarMap.galaxyMix === 1);
                    await compare(page, label + '/galaxy', 1);
                }
            } finally { await context.close(); }
        }
    } finally { await browser.close(); }
    check(errors.length === 0, 'No browser exceptions during cloud rotation', errors);
    fs.writeFileSync(path.join(output, 'after.json'), JSON.stringify(measurements, null, 2) + '\n');
    console.log(`Cloud stability validation: ${checks} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
