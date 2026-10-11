'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const output = path.resolve(__dirname, '../.render-work/celestial-autoplay-browser');
const bodies = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
const selectedBodies = process.env.CELESTIAL_AUTOPLAY_BODIES?.split(',') || bodies;
assert(selectedBodies.every(body => bodies.includes(body)));
const errors = [];
const report = [];
let server;

async function serve(directory) {
    const root = path.resolve(directory);
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
        '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
    server = http.createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            const filename = path.resolve(root, '.' + (pathname === '/life' ? '/life.html' : pathname));
            const relative = path.relative(root, filename);
            if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403).end(); return; }
            const stat = await fs.promises.stat(filename);
            if (!stat.isFile()) { response.writeHead(404).end(); return; }
            response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream',
                'Content-Length': stat.size });
            fs.createReadStream(filename).on('error', () => response.destroy()).pipe(response);
        } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}/life.html`;
}

async function phases(page) {
    return page.evaluate(() => ({ azimuth: bakedCelestialViewer.azimuth, elevation: bakedCelestialViewer.elevation,
        cloudAzimuth: bakedCelestialViewer.cloudAzimuth, cloudTime: bakedCelestialViewer.cloudTime }));
}

async function openBody(page, body) {
    await page.evaluate(bodyId => {
        const solar = window.lifeStarMap.solarSystem;
        solar.setLevel(['earth', 'moon'].includes(bodyId) ? 'earth-moon' : 'solar');
        solar.openBody(solar.bodies.find(candidate => candidate.id === bodyId), 'keyboard');
    }, body);
    await page.waitForFunction(bodyId => window.lifeStarMap.solarSystem.visit?.phase === 'observing'
        && bakedCelestialViewer.profile?.id === bodyId && bakedCelestialViewer.lastImage && !bakedCelestialViewer.loading
        && bakedCelestialViewer.samples().every(sample => bakedCelestialViewer.cache.has(sample.url))
        && bakedCelestialViewer.lastSurfaceSample?.url === bakedCelestialViewer.samples()[0].url
        && (!bakedCelestialViewer.ringSample() || bakedCelestialViewer.lastRingSample?.url === bakedCelestialViewer.ringSample().url), body,
        { timeout: 120000 });
}

async function controls(page, display) {
    assert(await page.locator('[data-playback-rate="1"]').getAttribute('aria-pressed') === 'true');
    const before = await phases(page);
    const buffering = await page.evaluate(() => {
        const viewer = bakedCelestialViewer;
        const starting = [viewer.azimuth, viewer.cloudAzimuth, viewer.cloudTime];
        const available = viewer.availableSample;
        viewer.availableSample = () => null;
        const advanced = viewer.advancePlayback(0.1);
        viewer.availableSample = available;
        return { advanced, starting, retained: [viewer.azimuth, viewer.cloudAzimuth, viewer.cloudTime], waiting: viewer.waitingSamples.length };
    });
    assert(!buffering.advanced && buffering.waiting === 2);
    assert.deepEqual(buffering.retained, buffering.starting, `${display.name}: a missing cloud frame retains the complete scene`);
    const canvas = await page.locator('.baked-celestial-canvas').boundingBox();
    await page.mouse.move(canvas.x + 24, canvas.y + 100);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 110, canvas.y + 155, { steps: 5 });
    await page.mouse.up();
    await page.locator('#bakedCelestialView').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    if (display.mobile) {
        const session = await page.context().newCDPSession(page);
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 25, y: 100 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 130, y: 160 }] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await session.detach();
    }
    assert.deepEqual(await phases(page), before, `${display.name}: dragging and arrows preserve every phase`);
    for (const rate of [0.5, 2, 1]) {
        await page.locator(`[data-playback-rate="${rate}"]`).click();
        assert(await page.evaluate(expected => bakedCelestialViewer.playbackRate === expected && bakedCelestialViewer.paused, rate));
    }
    assert(await page.evaluate(() => [...document.querySelectorAll('.baked-celestial-buttons button')].every(button => {
        const rectangle = button.getBoundingClientRect();
        return rectangle.width > 0 && rectangle.height > 0 && rectangle.right <= innerWidth && rectangle.bottom <= innerHeight
            && document.elementFromPoint(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2)?.closest('button') === button;
    })), `${display.name}: every playback button is visible and unobstructed`);
    await page.locator('.baked-celestial-pause').click();
    await page.waitForFunction(start => bakedCelestialViewer.azimuth > start.azimuth + 2
        && bakedCelestialViewer.cloudTime !== start.cloudTime, before, { timeout: 60000 });
    await page.waitForFunction(() => bakedCelestialViewer.samples().some(sample => sample.layer === 'clouds' && sample.timeIndex > 0), null,
        { timeout: 60000 });
    await page.locator('.baked-celestial-pause').click();
    const paused = await phases(page);
    await page.waitForTimeout(350);
    assert.deepEqual(await phases(page), paused, `${display.name}: pause freezes surface and weather`);
    await page.locator('#bakedCelestialView').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(start => !bakedCelestialViewer.paused && bakedCelestialViewer.azimuth !== start.azimuth, paused);
    await page.keyboard.press('Space');
}

async function inspect(browser, pageUrl, display) {
    const context = await browser.newContext({ viewport: { width: display.width, height: display.height },
        deviceScaleFactor: display.dpr || 1, isMobile: Boolean(display.mobile), hasTouch: Boolean(display.mobile),
        reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${display.name}: ${error.stack || error.message}`));
    page.on('response', response => {
        if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`HTTP ${response.status()} ${response.url()}`);
    });
    try {
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.lifeStarMap?.initialized);
        await page.locator('[data-map-entity="solar"]').click();
        await page.waitForFunction(() => window.lifeStarMap.solarSystem.active);
        for (const body of display.bodies.filter(body => selectedBodies.includes(body))) {
            await openBody(page, body);
            const metrics = await page.evaluate(() => {
                const viewer = bakedCelestialViewer;
                return { body: viewer.profile.id, paused: viewer.paused, rate: viewer.playbackRate,
                    azimuth: viewer.azimuth, elevation: viewer.elevation, cloudTime: viewer.cloudTime,
                    expectedAzimuth: viewer.body.defaultAzimuth * 360 / viewer.body.azimuthCount,
                    expectedElevation: viewer.body.elevations[viewer.body.defaultElevation],
                    samples: viewer.samples().map(sample => ({ layer: sample.layer, weight: sample.weight, timeIndex: sample.timeIndex })),
                    rotationSeconds: viewer.rotationSeconds(), climateCycle: viewer.climateConfig()
                        ? viewer.climateConfig().periodHours / viewer.climateConfig().hoursPerSecond : null,
                    tier: viewer.resolution().id, bytes: viewer.cacheBytes, budget: viewer.cacheBudget,
                    gpu: Boolean(viewer.compositor?.gl), error: viewer.error,
                    release: viewer.manifest.releaseVersion };
            });
            assert.equal(metrics.release, '20261011-climate-autoplay-v1');
            assert(metrics.paused && metrics.rate === 1 && !metrics.error);
            assert.equal(metrics.azimuth, metrics.expectedAzimuth);
            assert.equal(metrics.elevation, metrics.expectedElevation);
            assert.equal(metrics.rotationSeconds, ['earth', 'mars'].includes(body) ? 150 : ['jupiter', 'saturn'].includes(body) ? 90 : 120);
            assert(metrics.samples.every(sample => sample.weight === 1));
            assert.equal(metrics.samples.filter(sample => sample.layer === 'surface').length, 1);
            assert(metrics.samples.filter(sample => sample.layer === 'clouds').length <= 1);
            assert(metrics.bytes <= metrics.budget, `${display.name}/${body}: cache within budget`);
            if (['earth', 'mars'].includes(body)) assert.equal(metrics.climateCycle, 32);
            assert.equal(metrics.gpu, !display.fallback, `${display.name}/${body}: expected rendering path`);
            await page.screenshot({ path: path.join(output, `${display.name}-${body}.png`) });
            if (body === 'earth') await controls(page, display);
            report.push({ display: display.name, ...metrics });
            console.log(`PASS ${display.name}/${body}: fixed start, single-source layers, ${metrics.rotationSeconds}s rotation, ${metrics.tier}`);
            await page.locator('.baked-celestial-return').click();
            await page.waitForFunction(() => !window.lifeStarMap.solarSystem.visit);
            assert(await page.evaluate(() => bakedCelestialViewer.cache.size === 0 && bakedCelestialViewer.pending.size === 0));
        }
        if (display.bodies.includes('earth') && selectedBodies.includes('earth')) {
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => window.lifeStarMap?.initialized);
            await page.locator('[data-map-entity="solar"]').click();
            await page.waitForFunction(() => window.lifeStarMap.solarSystem.active);
            await openBody(page, 'earth');
            const refreshed = await phases(page);
            const first = report.find(entry => entry.display === display.name && entry.body === 'earth');
            assert.equal(refreshed.azimuth, first.azimuth);
            assert.equal(refreshed.elevation, first.elevation);
            assert.equal(refreshed.cloudTime, first.cloudTime);
            console.log(`PASS ${display.name}: reload restores the same Earth surface and cloud phase`);
        }
    } finally { await context.close(); }
}

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const target = process.argv[2] === '--serve' ? await serve(process.argv[3]) : process.argv[2];
    const pageUrl = new URL(target || 'https://sjtufreshman.pages.dev/life');
    pageUrl.searchParams.set('celestialAtlas', 'hosted');
    for (const display of [
        { name: 'desktop', width: 1440, height: 960, bodies },
        { name: 'mobile', width: 390, height: 844, dpr: 3, mobile: true, bodies: ['earth', 'mars', 'saturn'] },
        { name: 'canvas-fallback', width: 1100, height: 780, fallback: true, bodies: ['earth'] }
    ]) {
        const browser = await chromium.launch({ headless: true, channel: 'chrome',
            args: ['--enable-unsafe-swiftshader', ...(display.fallback ? ['--disable-webgl'] : [])] });
        try { await inspect(browser, pageUrl.href, display); } finally { await browser.close(); }
    }
    assert.deepEqual(errors, [], 'All real assets must load without HTTP or browser errors');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Autoplay browser validation passed: ${report.length} real-resource views.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
    server?.closeAllConnections();
    server?.close();
});
