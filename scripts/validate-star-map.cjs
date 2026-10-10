'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

let pageUrl = new URL('life.html', process.argv[2] === '--serve' ? 'http://127.0.0.1/' : process.argv[2] || 'http://localhost:8765/').href;
let localServer = null;
const outputDirectory = path.resolve(__dirname, '../.render-work/star-map');
const useBakedFixtures = process.argv.includes('--baked-fixtures');
const useHostedAtlas = process.argv.includes('--hosted');
assert(!(useBakedFixtures && useHostedAtlas), 'Hosted atlas validation must use real remote frames, not fixtures');
const fixtureDirectory = path.resolve(__dirname, '../.render-work/baked-viewer-fixtures');
const launchOptions = {
    headless: true,
    ...(process.env.CHROME_EXECUTABLE_PATH
        ? { executablePath: process.env.CHROME_EXECUTABLE_PATH }
        : { channel: 'chrome' }),
    args: ['--enable-unsafe-swiftshader']
};
const errors = [];
const checks = [];
const selectedGroup = process.argv.slice(3).find(argument => !argument.startsWith('--')) || 'all';
assert(['all', 'input', 'desktop', 'mobile', 'fallback', 'reduced-motion'].includes(selectedGroup),
    'Test group must be all, input, desktop, mobile, fallback, or reduced-motion');

function check(condition, message) {
    assert(condition, message);
    checks.push(message);
    console.log('PASS ' + message);
}

function monitor(page, label) {
    page.stylesheetDiagnostics = [];
    page.on('pageerror', error => errors.push(`${label}: ${error.stack || error.message}`));
    page.on('console', message => {
        if (message.type() === 'error' && !message.location().url?.endsWith('/favicon.ico')) {
            errors.push(`${label}: ${message.text()}`);
        }
    });
    page.on('requestfailed', request => {
        if (new URL(request.url()).origin === new URL(pageUrl).origin && request.failure()?.errorText !== 'net::ERR_ABORTED') {
            errors.push(`${label}: ${request.failure()?.errorText} ${request.url()}`);
        }
    });
    page.on('response', response => {
        const url = new URL(response.url());
        if (url.pathname.includes('/assets/life/') && /\.(?:css|js)$/.test(url.pathname)) {
            response.body().then(buffer => {
                const localPath = path.resolve(__dirname, '..', ...decodeURIComponent(url.pathname).replace(/^\/+/, '').split('/'));
                page.stylesheetDiagnostics.push({
                    url: response.url(), status: response.status(), type: response.headers()['content-type'],
                    length: buffer.length, beginning: buffer.toString('utf8').slice(0, 90),
                    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
                    diskSha256: fs.existsSync(localPath) ? crypto.createHash('sha256').update(fs.readFileSync(localPath)).digest('hex') : null
                });
            }).catch(error => page.stylesheetDiagnostics.push({ url: response.url(), error: error.message }));
        }
        if (url.origin === new URL(pageUrl).origin && response.status() >= 400 && url.pathname !== '/favicon.ico') {
            errors.push(`${label}: HTTP ${response.status()} ${url.pathname}`);
        }
    });
}

async function load(page) {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.lifeStarMap?.initialized && window.lifeStarMap.lastFrame > 0).catch(error => {
        console.error('Initialization asset diagnostics:', page.stylesheetDiagnostics);
        throw error;
    });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('link[rel="stylesheet"][href*="assets/life/styles/"]'))
        .every(link => Boolean(link.sheet)));
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    const styles = await page.evaluate(() => ({
        portal: getComputedStyle(document.querySelector('#portalPanel')).position,
        celestial: getComputedStyle(document.querySelector('#celestialPanel')).position,
        oldCanvas: getComputedStyle(document.querySelector('#spaceCanvas')).display
    }));
    if (styles.portal !== 'fixed' || styles.celestial !== 'fixed' || styles.oldCanvas !== 'none') {
        console.error('Stylesheet diagnostics:', page.stylesheetDiagnostics);
        console.error('Applied stylesheet rules:', await page.evaluate(() => Array.from(document.styleSheets).map(sheet => {
            try {
                return { href: sheet.href, disabled: sheet.disabled, rules: sheet.cssRules.length,
                    panelRules: Array.from(sheet.cssRules).filter(rule => ['.portal-panel', '.celestial-panel'].includes(rule.selectorText)).map(rule => rule.cssText) };
            } catch (error) { return { href: sheet.href, disabled: sheet.disabled, error: error.message }; }
        })));
    }
    assert.deepEqual(styles, { portal: 'fixed', celestial: 'fixed', oldCanvas: 'none' },
        'All star map and existing detail stylesheets must be loaded and applied');
}

async function settle(page) {
    await page.waitForFunction(() => {
        const map = window.lifeStarMap;
        return !map.flight && Math.abs(map.distance - map.target.distance) < 0.15
            && Math.abs(map.yaw - map.target.yaw) < 0.001
            && Math.abs(map.pitch - map.target.pitch) < 0.001
            && map.center.every((value, axis) => Math.abs(value - map.target.center[axis]) < 0.15);
    });
}

async function pose(page) {
    return page.evaluate(() => window.lifeStarMap.snapshot());
}

function samePose(actual, expected, label) {
    const matches = Math.abs(actual.distance - expected.distance) < 0.3
        && Math.abs(actual.yaw - expected.yaw) < 0.003
        && Math.abs(actual.pitch - expected.pitch) < 0.003
        && actual.center.every((value, axis) => Math.abs(value - expected.center[axis]) < 0.3);
    if (!matches) console.error({ actual, expected });
    check(matches, label);
}

async function emptyPoint(page) {
    return page.evaluate(() => {
        for (const horizontal of [0.18, 0.82, 0.35, 0.65, 0.5]) {
            for (const vertical of [0.38, 0.55, 0.72]) {
                const x = innerWidth * horizontal;
                const y = innerHeight * vertical;
                if (document.elementFromPoint(x, y)?.closest('#galaxyWorld')) return { x, y };
            }
        }
        throw new Error('No unobstructed map point is available for dragging');
    });
}

async function drag(page, button, deltaX, deltaY) {
    const point = await emptyPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down({ button });
    await page.mouse.move(point.x + deltaX, point.y + deltaY, { steps: 8 });
    await page.mouse.up({ button });
    await settle(page);
}

async function zoomToBoundary(page, delta) {
    const point = await emptyPoint(page);
    await page.mouse.move(point.x, point.y);
    for (let step = 0; step < 15; step++) {
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(35);
    }
    await settle(page);
}

async function reset(page) {
    await page.locator('#galaxyWorld').press('r');
    await settle(page);
}

async function screenshot(page, name) {
    await page.screenshot({ path: path.join(outputDirectory, name + (useBakedFixtures ? '-fixture' : '') + '.png') });
}

async function wheelInputChecks(page, selector, solar = false) {
    const samples = await page.evaluate(({ selector, solar }) => {
        const map = window.lifeStarMap;
        const view = solar ? map.solarSystem : map;
        const surface = document.querySelector(selector);
        const read = () => JSON.parse(JSON.stringify(view.target));
        const dispatch = options => {
            const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options });
            surface.dispatchEvent(event);
            return { ...read(), prevented: event.defaultPrevented };
        };
        map.clearInput();
        const before = read();
        const vertical = dispatch({ deltaY: 12 });
        const horizontal = dispatch({ deltaX: 20 });
        const momentum = dispatch({ deltaY: 120 });
        const pinchIn = dispatch({ deltaY: -35, ctrlKey: true });
        const pinchOut = dispatch({ deltaY: 20, metaKey: true });
        const fractional = dispatch({ deltaX: 2.5, deltaY: 1.5 });
        map.clearInput();
        const wheel = dispatch({ deltaY: 100 });
        const lines = dispatch({ deltaY: -3, deltaMode: 1 });
        const pages = dispatch({ deltaY: -1, deltaMode: 2 });
        const modalOpen = state.modalOpen;
        state.modalOpen = true;
        const blockedSlide = dispatch({ deltaX: 15, deltaY: 10 });
        const blockedPinch = dispatch({ deltaY: -20, ctrlKey: true });
        state.modalOpen = modalOpen;
        map.clearInput();
        return { before, vertical, horizontal, momentum, pinchIn, pinchOut, fractional, wheel, lines, pages, blockedSlide, blockedPinch };
    }, { selector, solar });
    const label = `${solar ? 'Solar System' : 'Star map'} ${selector}`;
    const sameAngles = (first, second) => first.yaw === second.yaw && first.pitch === second.pitch;
    check(samples.vertical.pitch > samples.before.pitch && samples.vertical.yaw === samples.before.yaw
        && samples.vertical.distance === samples.before.distance,
        `${label}: vertical trackpad movement rotates without zooming`);
    check(samples.horizontal.yaw < samples.vertical.yaw && samples.horizontal.pitch === samples.vertical.pitch
        && samples.horizontal.distance === samples.before.distance,
        `${label}: horizontal trackpad movement rotates without zooming`);
    check(samples.momentum.pitch > samples.horizontal.pitch && samples.momentum.distance === samples.before.distance,
        `${label}: faster movement in the same gesture stays in rotation mode`);
    check(sameAngles(samples.pinchIn, samples.momentum) && samples.pinchIn.distance < samples.momentum.distance
        && sameAngles(samples.pinchOut, samples.pinchIn) && samples.pinchOut.distance > samples.pinchIn.distance,
        `${label}: pinch modifiers change only zoom, even immediately after sliding`);
    check(samples.fractional.yaw < samples.pinchOut.yaw && samples.fractional.pitch > samples.pinchOut.pitch
        && samples.fractional.distance === samples.pinchOut.distance,
        `${label}: fractional diagonal movement resumes rotation after pinching`);
    check(sameAngles(samples.wheel, samples.fractional) && samples.wheel.distance > samples.fractional.distance
        && sameAngles(samples.lines, samples.wheel) && samples.lines.distance < samples.wheel.distance
        && sameAngles(samples.pages, samples.lines) && samples.pages.distance < samples.lines.distance,
        `${label}: mouse wheel steps and line/page units retain zoom after input is cleared`);
    for (const sample of Object.values(samples)) {
        assert.deepEqual(sample.center, samples.before.center, `${label}: wheel gestures must not pan`);
    }
    check(['vertical', 'horizontal', 'momentum', 'pinchIn', 'pinchOut', 'fractional', 'wheel', 'lines', 'pages']
        .every(name => samples[name].prevented), `${label}: handled gestures prevent browser scrolling and zooming`);
    check([samples.blockedSlide, samples.blockedPinch].every(sample => sameAngles(sample, samples.pages)
        && sample.distance === samples.pages.distance), `${label}: open content blocks camera gestures`);
    await reset(page);
}

async function inputChecks(browser) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    monitor(page, 'input');
    await load(page);
    for (const selector of ['#galaxyWorld', '#portalNav', '#mapEntities']) await wheelInputChecks(page, selector);
    const point = await emptyPoint(page);
    const beforePinch = await pose(page);
    const client = await context.newCDPSession(page);
    await client.send('Input.synthesizePinchGesture', { ...point, scaleFactor: 1.4, relativeSpeed: 600, gestureSourceType: 'mouse' });
    await settle(page);
    const afterPinch = await pose(page);
    check(afterPinch.distance < beforePinch.distance && Math.abs(afterPinch.yaw - beforePinch.yaw) < 0.003
        && Math.abs(afterPinch.pitch - beforePinch.pitch) < 0.003 && await page.evaluate(() => visualViewport.scale === 1),
        'A browser-generated trackpad pinch zooms the star map without rotating or scaling the page');
    await reset(page);
    await page.locator('[data-map-entity="solar"]').click();
    await page.waitForFunction(() => window.lifeStarMap.solarSystem.active);
    for (const selector of ['#galaxyWorld', '.solar-map-points']) await wheelInputChecks(page, selector, true);
    await context.close();
}

async function prepareBakedFixtures(browser) {
    fs.mkdirSync(fixtureDirectory, { recursive: true });
    const page = await browser.newPage();
    const bodies = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
    const manifest = { version: 1, testFixture: true, bodies: {} };
    for (const [index, body] of bodies.entries()) {
        const image = await page.evaluate(({ body, index }) => {
            const canvas = document.createElement('canvas');
            canvas.width = 960;
            canvas.height = 540;
            const context = canvas.getContext('2d');
            context.fillStyle = '#020208';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = `hsl(${index * 34} 50% 55%)`;
            context.beginPath();
            context.arc(280, 320, 250, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = 'white';
            context.font = '24px sans-serif';
            context.fillText(`TEST FIXTURE: ${body}`, 30, 90);
            return canvas.toDataURL('image/png').split(',')[1];
        }, { body, index });
        fs.writeFileSync(path.join(fixtureDirectory, body + '.png'), Buffer.from(image, 'base64'));
        manifest.bodies[body] = { azimuthCount: 72, elevations: [-90, -60, -30, 0, 30, 60, 90],
            width: 960, height: 540, framePattern: `${body}/e{elevation}/a{azimuth}.png`,
            poster: `${body}/poster.png`, defaultAzimuth: 0, defaultElevation: 3 };
    }
    fs.writeFileSync(path.join(fixtureDirectory, 'manifest.json'), JSON.stringify(manifest));
    await page.close();
}

async function openBakedBody(page, body) {
    await page.locator(`.solar-body-item[data-body="${body}"]`).click();
    await page.waitForFunction(expected => window.lifeStarMap.solarSystem.visit?.phase === 'observing'
        && bakedCelestialViewer.profile?.id === expected && Boolean(bakedCelestialViewer.lastImage)
        && !bakedCelestialViewer.error, body);
}

async function openEarthMoon(page) {
    const solar = page.locator('.solar-body-item[data-system="earth-moon"]');
    if (await solar.count() && await solar.first().isVisible()) {
        await solar.first().click();
        await page.waitForFunction(() => window.lifeStarMap.solarSystem.level === 'earth-moon');
    }
}

async function bakedControlsAreUncovered(page) {
    return page.evaluate(() => [...document.querySelectorAll('.baked-celestial-buttons button')].every(button => {
        const rectangle = button.getBoundingClientRect();
        return rectangle.width > 0 && rectangle.height > 0
            && document.elementFromPoint(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2)?.closest('button') === button;
    }));
}

async function bakedInteractionChecks(page, label) {
    const initial = await page.evaluate(() => ({ azimuth: bakedCelestialViewer.azimuth, elevation: bakedCelestialViewer.elevation }));
    await page.waitForFunction(start => bakedCelestialViewer.azimuth > start + 0.2, initial.azimuth);
    check(await page.locator('.baked-celestial-pause').isVisible(), `${label}: the pre-rendered view rotates automatically`);
    await page.locator('.baked-celestial-pause').click();
    const paused = await page.evaluate(() => bakedCelestialViewer.azimuth);
    await page.waitForTimeout(180);
    check(await page.evaluate(start => bakedCelestialViewer.paused && bakedCelestialViewer.azimuth === start, paused),
        `${label}: the pause button stops rotation`);
    await page.locator('#bakedCelestialView').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowUp');
    check(await page.evaluate(start => Math.abs(bakedCelestialViewer.azimuth - start.azimuth) > 3
        && bakedCelestialViewer.elevation === start.elevation + 10, initial), `${label}: keyboard input explores baked angles`);
    const point = await page.locator('.baked-celestial-canvas').boundingBox();
    await page.mouse.move(point.x + point.width * 0.25, point.y + point.height * 0.35);
    await page.mouse.down();
    const beforeDrag = await page.evaluate(() => bakedCelestialViewer.azimuth);
    await page.mouse.move(point.x + point.width * 0.25 + 80, point.y + point.height * 0.35 + 20, { steps: 6 });
    await page.mouse.up();
    check(await page.evaluate(start => Math.abs(bakedCelestialViewer.azimuth - start) > 10 && !bakedCelestialViewer.drag, beforeDrag),
        `${label}: pointer dragging changes the baked angle and releases capture`);
    const sampling = await page.evaluate(() => ({
        samples: bakedCelestialViewer.samples(),
        azimuth: bakedCelestialViewer.azimuth,
        elevation: bakedCelestialViewer.elevation,
        body: bakedCelestialViewer.body,
        manifestUrl: bakedCelestialViewer.manifestUrl
    }));
    const spacing = 360 / sampling.body.azimuthCount;
    const azimuth = ((sampling.azimuth % 360) + 360) % 360;
    const nearestElevation = sampling.body.elevations.map((value, index) => ({
        index, distance: Math.abs(value - sampling.elevation)
    })).sort((first, second) => first.distance - second.distance)[0].index;
    const capturedAngles = Array.from({ length: sampling.body.azimuthCount }, (unused, index) => {
        const difference = Math.abs(index * spacing - azimuth);
        const distance = Math.min(difference, 360 - difference);
        const pathname = sampling.body.framePattern.replace('{elevation}', String(nearestElevation))
            .replace('{azimuth}', String(index).padStart(3, '0'));
        return { url: new URL(pathname, sampling.manifestUrl).href, distance,
            weight: Math.max(0, 1 - distance / spacing) };
    });
    const expectedSamples = spacing > 2
        ? capturedAngles.filter(sample => sample.distance <= spacing * 0.5 + 1e-9)
        : capturedAngles.filter(sample => sample.weight > 0.001);
    const samplesMatch = sampling.samples.every(sample => {
        const expected = expectedSamples.find(candidate => candidate.url === sample.url);
        return expected && Number.isFinite(sample.weight) && sample.weight > 0 && sample.weight <= 1
            && Math.abs(sample.weight - (spacing > 2 ? 1 : expected.weight)) < 1e-9;
    });
    const totalWeight = sampling.samples.reduce((total, sample) => total + sample.weight, 0);
    check(samplesMatch && new Set(sampling.samples.map(sample => sample.url)).size === sampling.samples.length
        && sampling.samples.length === (spacing > 2 ? 1 : expectedSamples.length)
        && Math.abs(totalWeight - 1) <= 0.001 + 1e-9,
    `${label}: captured angles follow manifest spacing, nearest latitude and valid blend weights`);
    await page.waitForFunction(() => bakedCelestialViewer.activeLoads === 0 && bakedCelestialViewer.queue.length === 0);
    check(await page.evaluate(() => bakedCelestialViewer.cacheBytes <= bakedCelestialViewer.cacheBudget
        && [...bakedCelestialViewer.cache.values()].every(image => image.width > 0 && image.height > 0)),
        `${label}: decoded images stay within the memory budget`);
    await page.locator('.baked-celestial-return').click();
    await page.waitForFunction(() => !window.lifeStarMap.solarSystem.visit);
    check(await page.evaluate(() => !bakedCelestialViewer.profile && !bakedCelestialViewer.cache.size
        && !bakedCelestialViewer.pending.size && bakedCelestialViewer.cacheBytes === 0),
        `${label}: returning releases decoded frames and pending work`);
}

async function desktopChecks(browser) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    monitor(page, 'desktop');
    await load(page);
    check(await page.evaluate(() => window.lifeStarMap.renderer.ready), 'The desktop star map initializes WebGL');
    check(await page.locator('[data-map-entity="solar"]:visible').count() === 1
        && await page.locator('.solar-body-hit:visible, #celestialNav button:visible').count() === 0,
    'The local map exposes one Solar System entity without individual planet targets');
    await screenshot(page, 'local-desktop');

    const initial = await pose(page);
    await page.mouse.move(350, 350);
    await page.mouse.move(800, 520, { steps: 8 });
    await settle(page);
    samePose(await pose(page), initial, 'Free cursor movement preserves the camera');
    await drag(page, 'right', 115, 34);
    const rotated = await pose(page);
    check(Math.abs(rotated.yaw - initial.yaw) > 0.1 && Math.abs(rotated.pitch - initial.pitch) > 0.04,
        'Holding the right mouse button and dragging rotates the map');
    await drag(page, 'left', 170, 80);
    check(Math.hypot(...(await pose(page)).center) > 10, 'Left dragging pans the mapped region');
    for (let step = 0; step < 4; step++) await drag(page, 'left', 430, 180);
    const boundedCenter = await page.evaluate(() => ({
        length: Math.hypot(...window.lifeStarMap.center), limit: STAR_MAP_LIMITS.panRadius
    }));
    check(boundedCenter.length <= boundedCenter.limit + 0.2 && boundedCenter.length > boundedCenter.limit - 1,
        'Repeated panning stops at the mapped region boundary');
    await reset(page);

    const beforePortal = await pose(page);
    await page.locator('[data-portal-button="gallery"]').click();
    await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'gallery');
    await page.locator('#portalPanel').waitFor({ state: 'visible' });
    check(await page.locator('#portalPanel').getAttribute('aria-hidden') === 'false'
        && await page.locator('#gallery').getAttribute('hidden') === null, 'Selecting a constellation opens its existing life content');
    await page.locator('[data-star-portal="gallery"][data-star-hip="746"]').click();
    check(await page.locator('#starReaderTitle').textContent() !== ''
        && await page.locator('[data-portal-entry="gallery-qiandao-2024-11"]').isVisible(),
    'Selecting a constellation star reveals its associated story');
    await page.locator('[data-portal-entry="gallery-qiandao-2024-11"] .gallery-item').first().click();
    await page.locator('#lightbox.active').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#lightbox').classList.contains('active'));
    check(await page.evaluate(() => state.scene === 'detail' && state.activePortal?.id === 'gallery'
        && document.activeElement.matches('.gallery-item')),
    'Escape closes a gallery image while preserving its constellation and keyboard focus');
    await screenshot(page, 'constellation-detail');
    await page.locator('#portalClose').click();
    await settle(page);
    samePose(await pose(page), beforePortal, 'Closing a constellation restores the previous camera');

    const drawerTitles = [];
    for (const language of ['en', 'zh-CN', 'zh-TW']) {
        await page.locator(`.lang-btn[data-lang="${language}"]`).click();
        await page.locator('#sectionDrawerToggle').click();
        await page.waitForFunction(() => state.sectionDrawerOpen);
        const entries = await page.locator('#sectionDrawerList button').evaluateAll(buttons => buttons.map(button => ({
            id: button.dataset.portalId, label: button.getAttribute('aria-label'), inert: button.inert,
            disabled: button.disabled, text: button.textContent.trim()
        })));
        check(entries.length === 9 && entries.every(entry => entry.label && entry.text && !entry.inert && !entry.disabled),
            `${language}: all nine life sections remain accessible through the index`);
        drawerTitles.push(await page.locator('#sectionDrawerList').getAttribute('aria-label'));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !state.sectionDrawerOpen);
    }
    check(new Set(drawerTitles).size === 3, 'The constellation index switches between all three languages');
    await page.locator('.lang-btn[data-lang="en"]').click();
    await page.locator('#sectionDrawerToggle').click();
    await page.locator('#sectionDrawerList [data-portal-id="notes"]').click();
    await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'notes');
    check(await page.locator('#notes').getAttribute('hidden') === null, 'An index entry opens its matching content');
    await page.keyboard.press('Escape');
    await settle(page);

    await zoomToBoundary(page, -700);
    check(await page.evaluate(() => Math.abs(window.lifeStarMap.distance - STAR_MAP_LIMITS.minDistance) < 0.2),
        'Scrolling inward reaches a bounded minimum distance');
    const near = await pose(page);
    await zoomToBoundary(page, -700);
    samePose(await pose(page), near, 'Further inward scrolling cannot cross the minimum distance');
    await zoomToBoundary(page, 700);
    check(await page.evaluate(() => Math.abs(window.lifeStarMap.distance - STAR_MAP_LIMITS.maxDistance) < 0.2),
        'Scrolling outward reaches a bounded maximum distance');
    check(await page.evaluate(() => window.lifeStarMap.mapLevel === 'galaxy'),
        'Crossing the local zoom limit completes the transition into the galaxy overview');
    const far = await pose(page);
    await zoomToBoundary(page, 700);
    samePose(await pose(page), far, 'Further outward scrolling cannot escape the mapped galaxy');
    check(await page.locator('.map-portal:visible, [data-map-entity="solar"]:visible').count() === 0
        && await page.locator('[data-map-entity="region"]:visible').count() === 1,
    'The galaxy overview collapses local constellations and the Solar System into the local region');
    await screenshot(page, 'galaxy-overview');

    await page.locator('[data-map-entity="m31"]').click();
    await page.locator('#deepSkyView').waitFor({ state: 'visible' });
    check(/Andromeda/i.test(await page.locator('#deepSkyTitle').textContent())
        && (await page.locator('.deep-sky-description').textContent()).length > 80,
    'Selecting M31 approaches the external galaxy and opens its description');
    await page.waitForFunction(() => document.querySelector('.deep-sky-image')?.naturalWidth > 0);
    await screenshot(page, 'andromeda-detail');
    await page.keyboard.press('Escape');
    await settle(page);
    samePose(await pose(page), far, 'Closing an external galaxy restores the galaxy overview');
    const galaxyPoint = await emptyPoint(page);
    await page.mouse.move(galaxyPoint.x, galaxyPoint.y);
    await page.mouse.wheel(0, -100);
    await page.waitForFunction(() => window.lifeStarMap.mapLevel === 'local' && !window.lifeStarMap.flight);
    await settle(page);
    check(await page.evaluate(() => window.lifeStarMap.distance <= STAR_MAP_LIMITS.localMaxDistance)
        && await page.locator('[data-map-entity="solar"]:visible').count() === 1,
    'Scrolling inward from the galaxy automatically returns to the local region');
    await reset(page);

    const beforeSolar = await pose(page);
    await page.locator('[data-map-entity="solar"]').click();
    await page.waitForFunction(() => window.lifeStarMap.solarSystem.active);
    check(await page.locator('.solar-body-item:visible').count() === 9
        && await page.locator('.solar-body-item[data-system="earth-moon"]:visible').count() === 1
        && await page.locator('.solar-body-item[data-body="earth"]:visible, .solar-body-item[data-body="moon"]:visible').count() === 0,
        'Entering the Solar System reveals eight worlds and a single Earth–Moon system entry');
    await page.waitForFunction(() => window.lifeStarMap.solarSystem.bodies.every(body => body.textureReady && body.sphere));
    await screenshot(page, 'solar-system');
    for (const body of ['sun']) {
        await page.locator(`.solar-body-item[data-body="${body}"]`).click();
        await page.waitForFunction(expected => state.activeCelestial?.id === expected
            && document.querySelector('#celestialPanel').getAttribute('aria-hidden') === 'false', body);
        check((await page.locator('#celestialDescription').textContent()).length > 50,
            `${body}: selecting an inner body opens its astronomical description`);
        await page.waitForFunction(() => Boolean(bakedCelestialViewer.lastImage) && !bakedCelestialViewer.error);
        check(await page.evaluate(() => !celestialCloseupRenderer.activeProfile), `${body}: solar-system close-ups do not prepare a realtime 3D body`);
        if (body === 'earth') await screenshot(page, 'earth-detail');
        await page.locator('#celestialClose').click();
        await page.waitForFunction(() => window.lifeStarMap.solarSystem.active && !window.lifeStarMap.solarSystem.visit);
    }
    await page.locator('.solar-body-item[data-system="earth-moon"]').click();
    await page.waitForFunction(() => window.lifeStarMap.solarSystem.level === 'earth-moon');
    check(await page.locator('.solar-body-item:visible').count() === 2
        && await page.locator('.solar-body-item[data-body="earth"]:visible').count() === 1
        && await page.locator('.solar-body-item[data-body="moon"]:visible').count() === 1,
        'Opening the Earth–Moon system reveals Earth and Moon as its child bodies');
    for (const body of ['earth', 'moon']) {
        await page.locator(`.solar-body-item[data-body="${body}"]`).click();
        await page.waitForFunction(expected => state.activeCelestial?.id === expected
            && document.querySelector('#celestialPanel').getAttribute('aria-hidden') === 'false', body);
        check((await page.locator('#celestialDescription').textContent()).length > 50,
            `${body}: selecting a child body opens its astronomical description`);
        await page.waitForFunction(() => Boolean(bakedCelestialViewer.lastImage) && !bakedCelestialViewer.error);
        await page.locator('#celestialClose').click();
        await page.waitForFunction(() => window.lifeStarMap.solarSystem.level === 'earth-moon'
            && window.lifeStarMap.solarSystem.active && !window.lifeStarMap.solarSystem.visit);
    }
    await page.locator('.solar-map-back').click();
    await page.waitForFunction(() => window.lifeStarMap.solarSystem.level === 'solar');
    check(await page.locator('.solar-body-item[data-system="earth-moon"]:visible').count() === 1,
        'Returning from the Earth–Moon system restores the Solar System level');
    await page.locator('.solar-map-back').click();
    await page.waitForFunction(() => !window.lifeStarMap.solarSystem.active);
    await settle(page);
    samePose(await pose(page), beforeSolar, 'Leaving the Solar System restores the local star map');
    const contextLoss = await page.evaluateHandle(() => window.lifeStarMap.renderer.gl.getExtension('WEBGL_lose_context'));
    await contextLoss.evaluate(extension => extension.loseContext());
    await page.locator('#starMapFallbackCanvas').waitFor({ state: 'visible' });
    check(!await page.evaluate(() => window.lifeStarMap.renderer.ready), 'Losing WebGL switches the active map to its canvas fallback');
    await contextLoss.evaluate(extension => extension.restoreContext());
    await page.waitForFunction(() => window.lifeStarMap.renderer.ready);
    await page.locator('#starMapCanvas').waitFor({ state: 'visible' });
    check(await page.locator('[data-map-entity="solar"]').isVisible(), 'Restoring WebGL recovers the map and its interactive entities');
    await contextLoss.dispose();
    await context.close();
}

async function mobileChecks(browser) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    monitor(page, 'mobile');
    await load(page);
    const before = await pose(page);
    const session = await context.newCDPSession(page);
    const pinchOrigin = await page.evaluate(() => {
        const x = innerWidth * 0.5;
        for (const fraction of [0.55, 0.7, 0.35, 0.8]) {
            const y = innerHeight * fraction;
            if ([x - 40, x + 40].every(horizontal => document.elementFromPoint(horizontal, y)?.closest('#galaxyWorld'))) return { x, y };
        }
        throw new Error('No unobstructed pair of map points is available for pinching');
    });
    const touchPoints = span => [{ x: pinchOrigin.x - span, y: pinchOrigin.y, id: 1 }, { x: pinchOrigin.x + span, y: pinchOrigin.y, id: 2 }];
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints(40) });
    for (let step = 0; step < 6; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoints(45 + step * 12) });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page);
    const afterPinch = await pose(page);
    if (afterPinch.distance >= before.distance - 30) console.error({ before, afterPinch, pinchOrigin });
    check(afterPinch.distance < before.distance - 30, 'A two-finger pinch approaches the mobile star map');
    await reset(page);
    const beforeLabelPinch = await pose(page);
    const labelPinch = await page.evaluate(() => {
        const labels = document.querySelectorAll('.map-portal:not([hidden]):not([data-portal-button="home"])');
        for (const label of labels) {
            const rectangle = label.getBoundingClientRect();
            const first = { x: rectangle.left + rectangle.width * 0.5, y: rectangle.top + rectangle.height * 0.5, id: 1 };
            if (!document.elementFromPoint(first.x, first.y)?.closest('.map-portal')) continue;
            for (const offset of [100, -100, 135, -135]) {
                const second = { x: first.x + offset, y: first.y, id: 2 };
                if (second.x < 45 || second.x > innerWidth - 45) continue;
                if (document.elementFromPoint(second.x, second.y)?.closest('#galaxyWorld')) return { first, second, sign: Math.sign(offset) };
            }
        }
        throw new Error('No visible constellation label has an adjacent unobstructed map point');
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [labelPinch.first, labelPinch.second] });
    for (let step = 1; step <= 5; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [
            { ...labelPinch.first, x: labelPinch.first.x - step * 7 * labelPinch.sign },
            { ...labelPinch.second, x: labelPinch.second.x + step * 7 * labelPinch.sign }
        ] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await settle(page);
    check((await pose(page)).distance < beforeLabelPinch.distance - 30
        && await page.evaluate(() => state.scene === 'roam'),
    'Pinching from a constellation label zooms without opening the constellation');
    await reset(page);
    await screenshot(page, 'local-mobile');
    const tapLabel = page.locator('.map-portal:not([hidden]):not([data-portal-button="home"])').first();
    const tappedPortal = await tapLabel.getAttribute('data-portal-button');
    await tapLabel.tap();
    await page.waitForFunction(expected => state.scene === 'detail' && state.activePortal?.id === expected, tappedPortal);
    check(await page.locator(`#${tappedPortal}`).getAttribute('hidden') === null,
        'A single tap on a constellation label still opens the matching constellation');
    await page.locator('#portalClose').tap();
    await settle(page);
    await page.locator('#sectionDrawerToggle').tap();
    await page.locator('#sectionDrawerList [data-portal-id="gallery"]').tap();
    await page.waitForFunction(() => state.scene === 'detail');
    await page.locator('#portalPanel').waitFor({ state: 'visible' });
    check(await page.locator('#gallery').getAttribute('hidden') === null, 'Touch users can reach life content through the constellation index');
    await screenshot(page, 'constellation-mobile');
    await page.locator('#portalClose').tap();
    await settle(page);
    await page.locator('[data-map-entity="solar"]').tap();
    await page.waitForFunction(() => window.lifeStarMap.solarSystem.active);
    await openEarthMoon(page);
    await openBakedBody(page, 'earth');
    check(await bakedControlsAreUncovered(page), 'The mobile close-up controls are visible above the information panel');
    await screenshot(page, 'earth-mobile');
    await page.setViewportSize({ width: 700, height: 390 });
    await page.waitForFunction(() => !bakedCelestialViewer.element.classList.contains('is-compact'));
    check(await bakedControlsAreUncovered(page), 'The close-up controls remain usable beside the landscape phone information panel');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => bakedCelestialViewer.element.classList.contains('is-compact'));
    await bakedInteractionChecks(page, 'mobile');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The mobile star map has no horizontal page overflow');
    await context.close();
}

async function fallbackChecks() {
    const browser = await chromium.launch({ ...launchOptions, args: [...launchOptions.args, '--disable-webgl'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
        monitor(page, 'fallback');
        await load(page);
        check(await page.locator('#starMapFallbackCanvas').isVisible()
            && !await page.evaluate(() => window.lifeStarMap.renderer.ready),
        'A browser without WebGL receives the canvas star map fallback');
        const before = await pose(page);
        await drag(page, 'right', 90, 0);
        check(Math.abs((await pose(page)).yaw - before.yaw) > 0.1, 'Orbit controls remain usable without WebGL');
        await page.evaluate(() => {
            celestialCloseupRenderer.prepare = () => { throw new Error('Realtime body preparation is forbidden in the baked view'); };
            celestialCloseupRenderer.render = () => { throw new Error('Realtime body rendering is forbidden in the baked view'); };
        });
        await page.locator('[data-map-entity="solar"]').click();
        await page.waitForFunction(() => window.lifeStarMap.solarSystem.active);
        await openEarthMoon(page);
        await openBakedBody(page, 'earth');
        await bakedInteractionChecks(page, 'without WebGL');
        await screenshot(page, 'canvas-fallback');
    } finally {
        await browser.close();
    }
}

async function reducedMotionChecks(browser) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    monitor(page, 'reduced-motion');
    await load(page);
    const before = await pose(page);
    await page.locator('[data-portal-button="gallery"]').click();
    await page.waitForFunction(() => state.scene === 'detail');
    check(await page.evaluate(() => REDUCED_MOTION && !window.lifeStarMap.flight),
        'Reduced-motion visitors can enter constellations without an animated camera flight');
    await page.keyboard.press('Escape');
    await settle(page);
    samePose(await pose(page), before, 'Reduced-motion navigation restores the original view');
    await page.locator('[data-map-entity="solar"]').click();
    await page.waitForFunction(() => window.lifeStarMap.solarSystem.active);
    await openEarthMoon(page);
    await openBakedBody(page, 'earth');
    const angle = await page.evaluate(() => bakedCelestialViewer.azimuth);
    await page.waitForTimeout(180);
    check(await page.evaluate(previous => bakedCelestialViewer.paused && bakedCelestialViewer.azimuth === previous, angle),
        'Reduced-motion visitors receive a stationary baked close-up');
    await page.locator('#bakedCelestialView').focus();
    await page.keyboard.press('ArrowRight');
    check(await page.evaluate(previous => bakedCelestialViewer.azimuth !== previous, angle),
        'Reduced-motion visitors can still explore the captured angles manually');
    await page.locator('.baked-celestial-return').click();
    await page.waitForFunction(() => !window.lifeStarMap.solarSystem.visit);
    await context.close();
}

async function serveRepository() {
    const root = path.resolve(__dirname, '..');
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
        '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };
    localServer = http.createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
            if (useBakedFixtures && pathname.startsWith('/assets/celestial/baked/')) {
                const match = pathname.match(/^\/assets\/celestial\/baked\/([a-z]+)\/(?:poster|e[0-6]\/a0(?:[0-6]\d|7[01]))\.png$/);
                const fixture = pathname.endsWith('/manifest.json') ? 'manifest.json' : match ? match[1] + '.png' : null;
                if (!fixture) { response.writeHead(404).end(); return; }
                const buffer = await fs.promises.readFile(path.join(fixtureDirectory, fixture));
                response.writeHead(200, { 'Content-Type': fixture.endsWith('.json') ? 'application/json' : 'image/png', 'Cache-Control': 'no-store' });
                response.end(buffer);
                return;
            }
            const filename = path.resolve(root, '.' + pathname);
            const relative = path.relative(root, filename);
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
                response.writeHead(403).end();
                return;
            }
            const stats = await fs.promises.stat(filename);
            if (!stats.isFile()) { response.writeHead(404).end(); return; }
            response.writeHead(200, { 'Content-Type': types[path.extname(filename).toLowerCase()] || 'application/octet-stream',
                'Content-Length': stats.size, 'Cache-Control': 'no-store' });
            fs.createReadStream(filename).on('error', () => response.destroy()).pipe(response);
        } catch { response.writeHead(404).end(); }
    });
    await new Promise((resolve, reject) => {
        localServer.once('error', reject);
        localServer.listen(0, '127.0.0.1', resolve);
    });
    pageUrl = `http://127.0.0.1:${localServer.address().port}/life.html`;
}

async function main() {
    fs.mkdirSync(outputDirectory, { recursive: true });
    if (useBakedFixtures) {
        assert.equal(process.argv[2], '--serve', 'Baked fixtures are only available with the local test server');
        const browser = await chromium.launch(launchOptions);
        try { await prepareBakedFixtures(browser); } finally { await browser.close(); }
    }
    if (process.argv[2] === '--serve') await serveRepository();
    if (useHostedAtlas) {
        const hostedPage = new URL(pageUrl);
        hostedPage.searchParams.set('celestialAtlas', 'hosted');
        pageUrl = hostedPage.href;
    }
    for (const [group, run] of [['input', inputChecks], ['desktop', desktopChecks], ['mobile', mobileChecks], ['reduced-motion', reducedMotionChecks]]) {
        if (selectedGroup !== 'all' && selectedGroup !== group) continue;
        const browser = await chromium.launch(launchOptions);
        try {
            await run(browser);
        } finally {
            await browser.close();
        }
    }
    if (selectedGroup === 'all' || selectedGroup === 'fallback') await fallbackChecks();
    assert.deepEqual(errors, [], 'All star map workflows must complete without browser or local resource errors');
    console.log(`Star map validation passed (${checks.length} interaction checks; screenshots in ${outputDirectory}).`);
}

main().catch(error => {
    console.error(error);
    if (errors.length) console.error(errors.join('\n'));
    process.exitCode = 1;
}).finally(() => {
    localServer?.closeAllConnections();
    localServer?.close();
});
