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
assert(['all', 'input', 'desktop', 'mobile', 'content', 'footprints', 'fallback', 'reduced-motion'].includes(selectedGroup),
    'Test group must be all, input, desktop, mobile, content, footprints, fallback, or reduced-motion');

function check(condition, message) {
    assert(condition, message);
    checks.push(message);
    console.log('PASS ' + message);
}

function monitor(page, label) {
    page.stylesheetDiagnostics = [];
    page.retiredRequests = [];
    page.on('request', request => {
        if (/assets\/celestial\/|solar-system-map|closeup|celestial-(?:starfield|compositor|visits)/.test(request.url())) {
            page.retiredRequests.push(request.url());
        }
    });
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
        oldCanvas: getComputedStyle(document.querySelector('#spaceCanvas')).display
    }));
    if (styles.portal !== 'fixed' || styles.oldCanvas !== 'none') {
        console.error('Stylesheet diagnostics:', page.stylesheetDiagnostics);
        console.error('Applied stylesheet rules:', await page.evaluate(() => Array.from(document.styleSheets).map(sheet => {
            try {
                return { href: sheet.href, disabled: sheet.disabled, rules: sheet.cssRules.length,
                    panelRules: Array.from(sheet.cssRules).filter(rule => ['.portal-panel'].includes(rule.selectorText)).map(rule => rule.cssText) };
            } catch (error) { return { href: sheet.href, disabled: sheet.disabled, error: error.message }; }
        })));
    }
    assert.deepEqual(styles, { portal: 'fixed', oldCanvas: 'none' },
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
    await page.screenshot({ path: path.join(outputDirectory, name + '.png') });
}

async function wheelInputChecks(page, selector) {
    const samples = await page.evaluate(({ selector }) => {
        const map = window.lifeStarMap;
        const view = map;
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
    }, { selector });
    const label = `Star map ${selector}`;
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
    await solarMarkerChecks(page, 'input');
    await context.close();
}

async function solarMarkerChecks(page, label, touch = false) {
    const marker = page.locator('[data-map-entity="solar"]');
    check(await marker.isVisible() && await marker.getAttribute('aria-disabled') !== 'true',
        `${label}: the Solar System marker is an available homepage link`);
    await page.route('https://api.open-meteo.com/v1/forecast?*', route => route.fulfill({
        json: { current: { temperature_2m: 21, weather_code: 0 } }
    }));
    await page.route('https://clustrmaps.com/**', route => route.fulfill({
        contentType: 'application/javascript', body: ''
    }));
    for (const activation of [touch ? 'tap' : 'click', 'Enter', 'Space']) {
        if (activation === 'tap') await marker.tap();
        else if (activation === 'click') await marker.click();
        else {
            await marker.focus();
            await page.keyboard.press(activation);
        }
        await page.waitForURL(url => url.origin === new URL(pageUrl).origin && /^\/(?:index(?:\.html)?)?$/.test(url.pathname));
        await page.locator('.hero-title').waitFor({ state: 'visible' });
        check(true, `${label}: Solar System ${activation} returns to the homepage`);
        await load(page);
    }
    check(page.retiredRequests.length === 0, `${label}: no retired solar scripts, textures, or frames are requested`);
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

    await solarMarkerChecks(page, 'desktop');
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
    await reset(page);
    await solarMarkerChecks(page, 'mobile', true);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The mobile star map has no horizontal page overflow');
    await context.close();
}

async function dismissThoughtReader(page, method, label) {
    if (method === 'button') {
        await page.locator('.thought-reader-close').click();
    } else if (method === 'cancel') {
        const cancellation = await page.evaluate(() => {
            const reader = document.querySelector('#thoughtReader');
            const opacity = Number(getComputedStyle(reader).opacity);
            const transform = getComputedStyle(reader).transform;
            const backdropColor = getComputedStyle(reader, '::backdrop').backgroundColor;
            const backdropBlur = getComputedStyle(reader, '::backdrop').backdropFilter;
            const event = new Event('cancel', { cancelable: true });
            reader.dispatchEvent(event);
            return event.defaultPrevented && Math.abs(Number(getComputedStyle(reader).opacity) - opacity) < 0.01
                && getComputedStyle(reader).transform === transform
                && getComputedStyle(reader, '::backdrop').backgroundColor === backdropColor
                && getComputedStyle(reader, '::backdrop').backdropFilter === backdropBlur;
        });
        check(cancellation, `${label}: native cancellation continues from the current entrance opacity and position`);
    } else {
        await page.keyboard.press('Escape');
    }
    const transition = await page.evaluate(() => {
        const reader = document.querySelector('#thoughtReader');
        const animation = reader.getAnimations().find(item => item.animationName === 'thought-reader-exit');
        if (!animation) return null;
        const startOpacity = Number(getComputedStyle(reader).opacity);
        animation.currentTime = animation.effect.getComputedTiming().duration / 2;
        const midpointOpacity = Number(getComputedStyle(reader).opacity);
        reader.dispatchEvent(new Event('cancel', { cancelable: true }));
        return {
            modal: reader.open && reader.matches(':modal') && state.modalOpen,
            focused: reader.contains(document.activeElement),
            backdrop: getComputedStyle(reader, '::backdrop').animationName === 'thought-reader-undim',
            fading: midpointOpacity <= startOpacity && midpointOpacity < 1,
            once: reader.getAnimations().filter(item => item.animationName === 'thought-reader-exit').length === 1
                && reader.getAnimations().includes(animation)
        };
    });
    check(transition?.modal && transition.focused && transition.backdrop && transition.fading && transition.once,
        `${label}: ${method} fades the paper and backdrop, keeping one modal exit until completion`);
    await page.waitForFunction(() => !state.modalOpen && !document.querySelector('#thoughtReader').open
        && !document.querySelector('#thoughtReader').classList.contains('is-closing'));
}

async function contentChecks(browser) {
    for (const [label, viewport] of [
        ['desktop', { width: 1440, height: 960 }],
        ['mobile', { width: 390, height: 844 }],
        ['small-mobile', { width: 320, height: 640 }]
    ]) {
        const context = await browser.newContext({ viewport, isMobile: label !== 'desktop', hasTouch: label !== 'desktop' });
        const page = await context.newPage();
        monitor(page, `content-${label}`);
        await load(page);
        await page.locator('.lang-btn[data-lang="zh-CN"]').click();
        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawerList [data-portal-id="thoughts"]').click();
        await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'thoughts');
        await settle(page);
        await page.locator('[data-star-portal="thoughts"][data-star-hip="95947"]').click();
        const trigger = page.locator('[data-portal-entry="thought-2026-06-29"] [data-thought-reader]');
        const before = await pose(page);
        await trigger.click();
        await page.locator('#thoughtReader[open]').waitFor();
        check(await page.evaluate(() => document.querySelector('#thoughtReader').getAnimations()
            .some(animation => animation.playState === 'running')),
        `${label}: opening an essay plays the paper entrance transition`);
        await page.evaluate(() => Promise.allSettled(document.querySelector('#thoughtReader')
            .getAnimations({ subtree: true }).map(animation => animation.finished)));
        const readingLayout = await page.evaluate(() => {
            const reader = document.querySelector('#thoughtReader');
            const article = reader.querySelector('.thought-reader-article');
            const body = reader.querySelector('.thought-reader-body');
            const scrollArea = reader.querySelector('.thought-reader-scroll');
            return {
                width: article.getBoundingClientRect().width,
                size: parseFloat(getComputedStyle(body).fontSize),
                font: getComputedStyle(body).fontFamily,
                writingMode: getComputedStyle(body).writingMode,
                overflow: reader.scrollWidth > reader.clientWidth || scrollArea.scrollWidth > scrollArea.clientWidth,
                scrollable: scrollArea.scrollHeight > scrollArea.clientHeight,
                focused: document.activeElement === scrollArea,
                modal: reader.matches(':modal') && state.modalOpen,
                title: reader.querySelector('h2').textContent,
                expectedTitle: document.querySelector('[data-moment="thought-2026-06-29"] h3').textContent,
                paragraphs: Array.from(body.querySelectorAll('p'), paragraph => paragraph.textContent),
                expectedParagraphs: i18n['zh-CN'].thought_0629.trim().split(/\n\s*\n/)
            };
        });
        check(readingLayout.width >= (label === 'desktop' ? 760 : viewport.width - 65)
            && readingLayout.size >= 22 && readingLayout.font.includes('EduKai')
            && readingLayout.writingMode === 'horizontal-tb'
            && !readingLayout.overflow, `${label}: essays use a wide, clear body without horizontal overflow`);
        check(readingLayout.scrollable && readingLayout.focused && readingLayout.modal,
            `${label}: the reader focuses its scrollable article and makes the background inactive`);
        assert.deepEqual(readingLayout.paragraphs, readingLayout.expectedParagraphs);
        check(readingLayout.title === readingLayout.expectedTitle,
            `${label}: the reader preserves the complete essay, title, and paragraph breaks`);
        await screenshot(page, `essay-${label}`);
        await page.keyboard.press('PageDown');
        await page.waitForFunction(() => document.querySelector('.thought-reader-scroll').scrollTop > 0);
        samePose(await pose(page), before, `${label}: reading and scrolling preserve the star map camera`);
        await page.locator('.thought-reader-language').selectOption('zh-TW');
        check(await page.evaluate(() => Array.from(document.querySelectorAll('.thought-reader-body p'), paragraph => paragraph.textContent)
            .join('\n\n') === i18n['zh-TW'].thought_0629.trim().split(/\n\s*\n/).join('\n\n')),
        `${label}: language changes update the complete essay inside the reader`);
        const verticalLayout = await page.evaluate(() => {
            const reader = document.querySelector('#thoughtReader');
            const scrollArea = reader.querySelector('.thought-reader-scroll');
            const body = reader.querySelector('.thought-reader-body');
            return {
                writingMode: getComputedStyle(body).writingMode,
                font: getComputedStyle(body).fontFamily,
                horizontal: scrollArea.scrollWidth > scrollArea.clientWidth,
                vertical: scrollArea.scrollHeight > scrollArea.clientHeight + 1,
                atStart: scrollArea.scrollLeft === 0 && scrollArea.scrollTop === 0,
                titleOnRight: reader.querySelector('h2').getBoundingClientRect().left >= body.getBoundingClientRect().right,
                previousDisabled: reader.querySelector('[data-reader-step="-1"]').disabled,
                nextEnabled: !reader.querySelector('[data-reader-step="1"]').disabled
            };
        });
        check(verticalLayout.writingMode === 'vertical-rl' && verticalLayout.font.includes('EduKai')
            && verticalLayout.horizontal && !verticalLayout.vertical && verticalLayout.atStart && verticalLayout.titleOnRight
            && verticalLayout.previousDisabled && verticalLayout.nextEnabled,
        `${label}: Traditional Chinese starts on the right and flows left in Kai columns without vertical clipping`);
        await screenshot(page, `essay-traditional-${label}`);
        const pageAdvance = await page.evaluate(() => {
            const scrollArea = document.querySelector('.thought-reader-scroll');
            const columnWidth = parseFloat(getComputedStyle(document.querySelector('.thought-reader-body')).lineHeight);
            const columns = Math.max(1, Math.floor(scrollArea.clientWidth / columnWidth) - 2);
            return Math.min(columns * columnWidth, scrollArea.scrollWidth - scrollArea.clientWidth);
        });
        await page.locator('[data-reader-step="1"]').click();
        await page.waitForFunction(distance => Math.abs(document.querySelector('.thought-reader-scroll').scrollLeft + distance) < 1,
            pageAdvance);
        await page.locator('.thought-reader-scroll').focus();
        await page.keyboard.press('Home');
        await page.waitForFunction(() => document.querySelector('.thought-reader-scroll').scrollLeft === 0);
        await page.keyboard.press('PageDown');
        await page.waitForFunction(distance => Math.abs(document.querySelector('.thought-reader-scroll').scrollLeft + distance) < 1,
            pageAdvance);
        check(true, `${label}: continuation controls and PageDown advance through the vertical essay`);
        await page.keyboard.press('Home');
        await page.locator('.thought-reader-scroll').dispatchEvent('wheel', { deltaY: 180, bubbles: true, cancelable: true });
        await page.waitForFunction(() => document.querySelector('.thought-reader-scroll').scrollLeft < -100);
        check(await page.evaluate(() => document.querySelector('.thought-reader-scroll')
            .dispatchEvent(new WheelEvent('wheel', { deltaY: 50, ctrlKey: true, cancelable: true }))),
        `${label}: the reader converts ordinary wheel scrolling but preserves pinch zoom`);
        if (label !== 'desktop') {
            await page.locator('.thought-reader-scroll').focus();
            await page.keyboard.press('Home');
            const bounds = await page.locator('.thought-reader-scroll').boundingBox();
            const session = await context.newCDPSession(page);
            const start = { x: bounds.x + bounds.width * 0.3, y: bounds.y + bounds.height * 0.5 };
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
            for (const distance of [20, 40, 60, 90, 120]) {
                await session.send('Input.dispatchTouchEvent', {
                    type: 'touchMove', touchPoints: [{ x: start.x + distance, y: start.y, id: 1 }]
                });
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await page.waitForFunction(() => document.querySelector('.thought-reader-scroll').scrollLeft < -20);
            check(true, `${label}: a horizontal touch swipe advances the vertical columns`);
            await session.detach();
        }
        await page.locator('.thought-reader-scroll').focus();
        await page.keyboard.press('End');
        await page.waitForFunction(() => document.querySelector('.thought-reader-progress').getAttribute('aria-valuenow') === '100');
        check(await page.evaluate(() => {
            const scrollArea = document.querySelector('.thought-reader-scroll');
            const paragraph = document.querySelector('.thought-reader-body p:last-child');
            const range = document.createRange();
            range.setStart(paragraph.firstChild, paragraph.textContent.length - 1);
            range.setEnd(paragraph.firstChild, paragraph.textContent.length);
            const lastCharacter = range.getBoundingClientRect();
            const viewport = scrollArea.getBoundingClientRect();
            return lastCharacter.left >= viewport.left && lastCharacter.right <= viewport.right
                && lastCharacter.top >= viewport.top && lastCharacter.bottom <= viewport.bottom
                && document.querySelector('[data-reader-step="1"]').disabled;
        }), `${label}: the final character remains reachable, with progress and continuation controls at the end`);
        samePose(await pose(page), before, `${label}: vertical reading leaves the star camera unchanged`);
        await page.locator('.thought-reader-language').selectOption('en');
        check(await page.locator('.thought-reader-body').textContent() === "See Chinese version, record of last night's dream.",
            `${label}: the reader preserves the existing English text`);
        check(await page.evaluate(() => {
            const body = document.querySelector('.thought-reader-body');
            const scrollArea = document.querySelector('.thought-reader-scroll');
            return getComputedStyle(body).writingMode === 'horizontal-tb'
                && getComputedStyle(body).fontFamily.includes('Newsreader')
                && scrollArea.scrollLeft === 0 && scrollArea.scrollTop === 0
                && document.querySelector('.thought-reader-pagination').hidden;
        }), `${label}: English returns to horizontal editorial type and resets the reading position`);
        await page.locator('.thought-reader-language').selectOption('zh-CN');
        await page.locator('.thought-reader-scroll').focus();
        for (let step = 0; step < 5; step++) {
            await page.keyboard.press('Tab');
            check(await page.evaluate(() => document.querySelector('#thoughtReader').contains(document.activeElement)),
                `${label}: Tab keeps keyboard focus within the reader (${step + 1})`);
        }
        await dismissThoughtReader(page, 'escape', label);
        samePose(await pose(page), before, `${label}: the exit transition preserves the star map camera`);
        check(await trigger.evaluate(button => document.activeElement === button)
            && await page.evaluate(() => state.scene === 'detail' && state.activePortal?.id === 'thoughts' && state.activeStarHip === 95947),
        `${label}: Escape returns focus to the same essay without closing its constellation`);
        await page.locator('[data-star-portal="thoughts"][data-star-hip="100453"]').click();
        const firstEssay = page.locator('[data-portal-entry="thought-2026-01-16"] [data-thought-reader]');
        await firstEssay.focus();
        await page.keyboard.press('Enter');
        await page.locator('#thoughtReader[open]').waitFor();
        check(await page.evaluate(() => document.querySelector('#thoughtReaderTitle').textContent
            === document.querySelector('[data-moment="thought-2026-01-16"] h3').textContent),
        `${label}: opening another essay replaces the reader content`);
        await dismissThoughtReader(page, 'cancel', label);
        await page.keyboard.press('Enter');
        await page.locator('#thoughtReader[open]').waitFor();
        check(await page.evaluate(() => state.modalOpen && document.querySelector('#thoughtReader').matches(':modal')),
            `${label}: Escape during entrance can be followed by reopening without a stuck modal`);
        await dismissThoughtReader(page, 'button', label);
        check(await firstEssay.evaluate(button => document.activeElement === button),
            `${label}: the close button restores the essay trigger`);
        await page.locator('#portalClose').click();
        await settle(page);

        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawerList [data-portal-id="publications"]').click();
        await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'publications');
        await settle(page);
        const publicationTitles = new Set();
        for (const hip of [113963, 677]) {
            await page.locator(`[data-star-portal="publications"][data-star-hip="${hip}"]`).focus();
            await page.keyboard.press('Enter');
            for (const title of await page.locator('#publications .publication-entry:not([hidden]) .pub-title-text').allTextContents()) {
                publicationTitles.add(title);
            }
        }
        check(publicationTitles.size === 5 && Array.from(publicationTitles).some(title => title.startsWith('AppCopilot:'))
            && await page.locator('#publications [data-portal-entry="AppCopilot_2025"] a.pub-btn').getAttribute('href') === 'https://arxiv.org/abs/2509.02444',
        `${label}: Pegasus includes all five complete publications, including AppCopilot`);
        for (const [language, expected] of [['en', 'Publications'], ['zh-CN', '论文'], ['zh-TW', '論文']]) {
            await page.locator(`.lang-btn[data-lang="${language}"]`).click();
            check(await page.evaluate(() => dom.panelTitle.textContent) === expected,
                `${label}: Pegasus uses the complete publication heading in ${language}`);
        }
        await screenshot(page, `publications-${label}`);
        await page.locator('#portalClose').click();
        await settle(page);

        if (label === 'desktop') {
            await page.route('https://api.open-meteo.com/v1/forecast?*', route => route.fulfill({
                json: { current: { temperature_2m: 21, weather_code: 0 } }
            }));
            await page.route('https://clustrmaps.com/**', route => route.fulfill({
                contentType: 'application/javascript', body: ''
            }));
            await page.goto(new URL('index.html', pageUrl).href, { waitUntil: 'domcontentloaded' });
            await page.getByRole('button', { name: 'EN', exact: true }).click();
            check(await page.getByRole('link', { name: 'Shanghai Jiao Tong University', exact: true }).getAttribute('href')
                === 'https://en.sjtu.edu.cn/', 'The English university link opens SJTU’s English website');
            const titles = await page.locator('#publications .pub-title-text').allTextContents();
            check(titles[0] === 'Collaborative Learning and Reasoning over Model Slices'
                && titles.length === 4 && titles.every(title => !title.includes('AppCopilot')),
            'Selected Publications leads with Model Slices and omits the AppCopilot publication');
            check(await page.locator('#publications .pub-item').first().locator('a.pub-btn').getAttribute('href')
                === 'https://arxiv.org/abs/2610.12927', 'The new paper links to its supplied arXiv page');
            check(await page.locator('a.pub-btn[href="#"], a.project-link[href="#"], a.pub-btn[href=""], a.project-link[href=""]').count() === 0
                && await page.locator('.pub-btn:disabled, .project-link:disabled').count() === 7,
            'All empty Paper and Code destinations are native disabled buttons');
            const paperButton = page.locator('#publications .pub-item').first().locator('a.pub-btn');
            await paperButton.focus();
            await page.keyboard.press('Tab');
            check(await page.evaluate(() => document.activeElement?.textContent.includes('Cite')),
                'Keyboard navigation skips unavailable Code buttons');
            const originalUrl = page.url();
            await page.locator('.pub-btn:disabled').first().click({ force: true });
            check(page.url() === originalUrl, 'Clicking an unavailable Code button does not jump or navigate');
            for (const [language, label, expected] of [['en', 'EN', 'Selected Publications'], ['zh-CN', '简', '精选论文'], ['zh-TW', '繁', '精選論文']]) {
                await page.getByRole('button', { name: label, exact: true }).click();
                check(await page.locator('.hero-title a').filter({ hasText: /Shanghai Jiao Tong University|上海交通大[学學]/ }).getAttribute('href')
                    === (language === 'en' ? 'https://en.sjtu.edu.cn/' : 'https://www.sjtu.edu.cn/'),
                `${language}: the university destination follows the selected language`);
                check(await page.locator('[data-key="title_pubs"]').textContent() === expected
                    && await page.locator('[data-key="nav_pubs"]').textContent() === expected,
                `${language}: the publication heading and navigation use the selected label`);
            }
            await page.locator('#publications').scrollIntoViewIfNeeded();
            await screenshot(page, 'selected-publications');
        }
        await context.close();
    }
}

async function footprintsChecks(browser) {
    const productionAtlas = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../assets/maps/relief/atlas.json'), 'utf8'));
    for (const [label, viewportSize] of [['desktop', { width: 1440, height: 960 }], ['mobile', { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport: viewportSize, hasTouch: true, isMobile: label === 'mobile' });
        const page = await context.newPage();
        monitor(page, `footprints-${label}`);
        await load(page);
        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawerList [data-portal-id="footprints"]').click();
        await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'footprints');
        await settle(page);
        await page.locator('.footprints-map-controls').first().waitFor();
        const session = await context.newCDPSession(page);
        for (const [identifier, atlasKey, maximum] of [['china', 'china', 300], ['east-asia', 'east_asia', 200], ['euro-usa', 'europe_usa', 200]]) {
            const metadata = productionAtlas.maps[atlasKey];
            const expectedSea = `rgb(${metadata.display_background.slice(1).match(/.{2}/g).map(channel => parseInt(channel, 16)).join(', ')})`;
            const box = page.locator(`#${identifier}Map`);
            const viewport = box.locator('.footprints-map-viewport');
            const readout = box.locator('.footprints-map-zoom');
            const resetView = () => box.locator('[data-map-action="reset"]').click();
            const assertZoom = async (expected, method) => check(await readout.textContent() === `${expected}%`,
                `${label} ${identifier}: ${method} respects ${maximum}% maximum`);
            await box.scrollIntoViewIfNeeded();
            await page.waitForFunction(id => !document.getElementById(id).classList.contains('is-map-loading'), `${identifier}Map`);
            check(await box.locator('.footprints-map-terrain').evaluate((image, width) => image.naturalWidth === width, metadata.width)
                && await box.evaluate((element, sea) => getComputedStyle(element).backgroundColor === sea, expectedSea),
            `${label} ${identifier}: the high-resolution map uses the new blue-grey sea`);
            for (const expanded of [false, true]) {
                if (expanded) await box.locator('[data-map-action="expand"]').click();
                await resetView();
                for (let attempt = 0; attempt < 6; attempt++) {
                    const zoomIn = box.locator('[data-map-action="zoom-in"]');
                    if (await zoomIn.isEnabled()) await zoomIn.click();
                }
                await assertZoom(maximum, `${expanded ? 'large map' : 'inline map'} buttons`);
                check(await box.locator('[data-map-action="zoom-in"]').isDisabled(), `${label} ${identifier}: the zoom-in button disables at the cap`);
                await resetView();
                await viewport.focus();
                for (let attempt = 0; attempt < 10; attempt++) await page.keyboard.press('+');
                await assertZoom(maximum, 'keyboard');
                await resetView();
                await viewport.dispatchEvent('wheel', { deltaY: -5000, ctrlKey: !expanded, bubbles: true, cancelable: true });
                await viewport.dispatchEvent('wheel', { deltaY: -5000, ctrlKey: !expanded, bubbles: true, cancelable: true });
                await viewport.dispatchEvent('wheel', { deltaY: -5000, ctrlKey: !expanded, bubbles: true, cancelable: true });
                await assertZoom(maximum, 'wheel / trackpad pinch');
                await resetView();
                for (let attempt = 0; attempt < (maximum === 300 ? 2 : 1); attempt++) await viewport.dblclick({ position: { x: 24, y: 24 } });
                await assertZoom(maximum, 'double-click');
                await viewport.dblclick({ position: { x: 24, y: 24 } });
                await assertZoom(100, 'double-click reset');
                await box.locator('[data-map-action="maximum"]').click();
                await assertZoom(maximum, 'maximum-zoom shortcut');
                await page.setViewportSize({ width: viewportSize.width - 30, height: viewportSize.height - 30 });
                await assertZoom(maximum, 'window resize');
                await page.setViewportSize(viewportSize);
                if (expanded) {
                    await resetView();
                    const bounds = await viewport.boundingBox();
                    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
                    const points = span => [{ x: center.x - span, y: center.y, id: 1 }, { x: center.x + span, y: center.y, id: 2 }];
                    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(15) });
                    for (const span of [30, 50, 75, 100]) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(span) });
                    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                    await assertZoom(maximum, 'touch pinch');
                    check(await page.evaluate(() => visualViewport.scale === 1), `${label} ${identifier}: pinching keeps page zoom unchanged`);
                    await resetView();
                    await screenshot(page, `footprints-${label}-${identifier}`);
                    await page.keyboard.press('Escape');
                    await assertZoom(100, 'large-map close');
                }
            }
        }
        await context.close();
    }
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
        await reset(page);
        await solarMarkerChecks(page, 'without WebGL');
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
    await page.locator('#sectionDrawerToggle').click();
    await page.locator('#sectionDrawerList [data-portal-id="thoughts"]').click();
    await page.waitForFunction(() => state.scene === 'detail');
    await page.locator('[data-star-portal="thoughts"][data-star-hip="95947"]').click();
    await page.locator('[data-portal-entry="thought-2026-06-29"] [data-thought-reader]').click();
    await page.locator('#thoughtReader[open]').waitFor();
    check(await page.evaluate(() => document.querySelector('#thoughtReader').getAnimations({ subtree: true }).length === 0),
        'Reduced-motion visitors enter the essay immediately without paper or text animations');
    await page.locator('.thought-reader-language').selectOption('zh-TW');
    await page.locator('[data-reader-step="1"]').click();
    check(await page.evaluate(() => document.querySelector('.thought-reader-scroll').scrollLeft < 0),
        'Reduced-motion vertical reading advances without smooth scrolling');
    check(await page.evaluate(() => {
        document.querySelector('.thought-reader-close').click();
        const reader = document.querySelector('#thoughtReader');
        return !reader.open && !reader.classList.contains('is-closing') && reader.getAnimations().length === 0;
    }), 'Reduced-motion visitors exit immediately without waiting for a closing animation');
    await page.waitForFunction(() => !state.modalOpen);
    await page.locator('#portalClose').click();
    await settle(page);
    await solarMarkerChecks(page, 'reduced motion');
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
    if (process.argv[2] === '--serve') await serveRepository();
    for (const [group, run] of [['input', inputChecks], ['desktop', desktopChecks], ['mobile', mobileChecks], ['content', contentChecks], ['footprints', footprintsChecks], ['reduced-motion', reducedMotionChecks]]) {
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
