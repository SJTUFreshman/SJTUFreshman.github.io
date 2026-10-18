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
assert(['all', 'startup', 'motion', 'input', 'desktop', 'mobile', 'visuals', 'content', 'footprints', 'fallback', 'reduced-motion'].includes(selectedGroup),
    'Test group must be all, startup, motion, input, desktop, mobile, visuals, content, footprints, fallback, or reduced-motion');

function check(condition, message) {
    assert(condition, message);
    checks.push(message);
    console.log('PASS ' + message);
}

function monitor(page, label) {
    page.stylesheetDiagnostics = [];
    page.retiredRequests = [];
    page.galaxyRequests = [];
    page.on('request', request => {
        if (/assets\/life\/galaxy\/.*\.webp/.test(request.url())) page.galaxyRequests.push(request.url());
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
        return !map.flight && !map.pendingGalaxy && Math.abs(map.distance - map.target.distance) < 0.15
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

async function startupChecks(browser) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    let releaseRuntime;
    const runtimeGate = new Promise(resolve => { releaseRuntime = resolve; });
    try {
        const page = await context.newPage();
        monitor(page, 'startup');
        const projectRequests = [];
        page.on('request', request => {
            if (/images\/(?:AppCopilot|TeachMaster)\.png/.test(request.url())) projectRequests.push(request.url());
        });
        await page.addInitScript(() => {
            window.startupWebGLContexts = [];
            const getContext = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (kind, ...options) {
                if (kind.includes('webgl')) window.startupWebGLContexts.push(this.id);
                return getContext.call(this, kind, ...options);
            };
        });
        await page.route('**/19-star-map.js?*', async route => {
            await runtimeGate;
            await route.continue();
        });
        await page.goto(pageUrl, { waitUntil: 'commit' });
        await page.waitForFunction(() => document.readyState !== 'loading'
            && Array.from(document.querySelectorAll('link[href*="assets/life/styles/"]')).every(link => link.sheet));
        const retiredHints = '#entryGate, #entryTrigger, #entryFallback, .control-legend, .reticle, .gaze-label, .gaze-instruction';
        check(await page.locator(retiredHints).count() === 0
            && await page.evaluate(() => document.body.classList.contains('star-map') && !window.lifeStarMap),
        'A delayed star-map script never exposes the retired entry, pointer-lock, or gaze prompts');
        releaseRuntime();
        await page.waitForFunction(() => window.lifeStarMap?.initialized && window.lifeStarMap.lastFrame > 0);
        await page.evaluate(() => document.fonts.ready);
        await settle(page);
        check(await page.evaluate(() => !window.startupWebGLContexts.includes('spaceCanvas')
            && window.startupWebGLContexts.includes('starMapCanvas')),
        'Startup creates only the current star-map WebGL context');
        check(page.galaxyRequests.length === 0 && projectRequests.length === 0,
            'Local startup does not download galaxy textures or hidden project images');
        for (const language of ['zh-CN', 'zh-TW', 'en']) {
            await page.locator(`.lang-btn[data-lang="${language}"]`).click();
            await page.locator('#sectionDrawerToggle').click();
            await page.waitForFunction(() => state.sectionDrawerOpen);
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !state.sectionDrawerOpen);
        }
        await page.locator('[data-portal-button="gallery"]').click();
        await page.waitForFunction(() => state.scene === 'detail');
        await page.locator('#portalClose').click();
        await settle(page);
        check(await page.locator(retiredHints).count() === 0
            && await page.evaluate(() => !state.gateOpen && !dom.world.inert && !document.pointerLockElement),
        'Language changes and closing navigation or content preserve the freely controlled map without retired prompts');
        await page.locator('#sectionDrawerToggle').click();
        check(await page.locator('#news, #publications, #projects, [data-portal-id="news"], [data-portal-id="publications"], [data-portal-id="projects"]').count() === 0,
            'Retired academic sections have no Life content or navigation targets');
        await page.locator('#sectionDrawerList [data-portal-id="wine"]').click();
        await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'wine');
        await page.locator('#wine-orgasm').waitFor({ state: 'visible' });
        await page.locator('#wine-margarita').waitFor({ state: 'visible' });
        check(projectRequests.length === 0,
            'Wine Diary opens both cocktail entries without downloading removed project illustrations', projectRequests);
    } finally {
        releaseRuntime();
        await context.close();
    }
}

async function motionChecks(browser) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 });
    try {
        const page = await context.newPage();
        monitor(page, 'motion');
        await load(page);
        const response = await page.evaluate(async () => {
            const map = window.lifeStarMap;
            const before = map.snapshot();
            map.orbit(35, 18);
            const actual = map.snapshot(), target = { ...map.target };
            // Observe an actual drag across animation frames. A single input's
            // 150ms moving window can end before a second automation round trip
            // when a newly decoded sky texture is being uploaded.
            const moving = await new Promise(resolve => {
                let frames = 0, sample = null;
                const advance = () => {
                    const renderer = map.renderer;
                    if (map.currentView.moving) sample = {
                        cloud: [renderer.cloudWidth, renderer.cloudHeight],
                        canvas: [renderer.canvas.width, renderer.canvas.height]
                    };
                    if (++frames >= 8) { resolve(sample); return; }
                    map.orbit(2, 0);
                    requestAnimationFrame(advance);
                };
                requestAnimationFrame(advance);
            });
            return { before, actual, target, moving };
        });
        check(Math.abs(response.actual.yaw - response.target.yaw) < 0.001
            && Math.abs(response.actual.pitch - response.target.pitch) < 0.001
            && Math.abs(response.actual.yaw - response.before.yaw) > 0.1,
        'Active orbit input updates the camera immediately without an extra easing delay');
        const movingLocal = response.moving;
        check(movingLocal && movingLocal.cloud[0] <= 720 && movingLocal.cloud[1] <= 480,
            'The local soft volume stays within its fixed half-resolution pixel budget');
        await page.waitForFunction(() => !window.lifeStarMap.currentView.moving);
        check(await page.evaluate(moving => {
            const renderer = window.lifeStarMap.renderer;
            return renderer.cloudWidth === moving.cloud[0] && renderer.cloudHeight === moving.cloud[1]
                && renderer.canvas.width === moving.canvas[0] && renderer.canvas.height === moving.canvas[1];
        }, movingLocal), 'Stopping a drag preserves both the cloud grid and full-resolution star canvas');
        await reset(page);
        await page.evaluate(() => {
            const map = window.lifeStarMap;
            const renderer = map.renderer;
            window.motionUploads = [];
            const upload = renderer.uploadGalacticAssets.bind(renderer);
            renderer.uploadGalacticAssets = (...args) => {
                window.motionUploads.push({ flight: Boolean(map.flight), mix: map.galaxyMix });
                return upload(...args);
            };
            window.galaxyBlendFrames = [];
            const render = map.render.bind(map);
            map.render = time => {
                render(time);
                if (map.levelTransition) window.galaxyBlendFrames.push({ time, mix: map.galaxyMix, width: renderer.cloudWidth, height: renderer.cloudHeight });
            };
            map.showGalaxy();
        });
        await settle(page);
        const transition = await page.evaluate(() => ({ frames: window.galaxyBlendFrames, uploads: window.motionUploads }));
        const firstTen = transition.frames.find(frame => frame.mix >= 0.1);
        const firstNinety = transition.frames.find(frame => frame.mix >= 0.9);
        check(firstTen && firstNinety && firstNinety.time - firstTen.time >= 500,
            'The main galaxy blend spans at least half a second instead of a brief distance-threshold jump');
        check(transition.frames.every((frame, index, frames) => !index || frame.mix >= frames[index - 1].mix),
            'The local-to-galaxy blend progresses continuously without reversing');
        check(transition.frames.every(frame => frame.width <= 1080 && frame.height <= 720),
            'The overlapping local and galaxy volume passes stay within the bounded volume budget');
        check(transition.uploads.length > 0 && transition.uploads.every(upload => !upload.flight && upload.mix === 0),
            'Galaxy textures finish uploading before the camera flight starts');
        await page.waitForFunction(() => !window.lifeStarMap.currentView.moving);
        const galaxyCanvas = await page.evaluate(() => {
            const renderer = window.lifeStarMap.renderer;
            return [renderer.canvas.width, renderer.canvas.height, renderer.cloudWidth, renderer.cloudHeight];
        });
        await page.evaluate(() => window.lifeStarMap.orbit(40, 0));
        await page.waitForFunction(() => window.lifeStarMap.currentView.moving);
        check(await page.evaluate(canvas => {
            const renderer = window.lifeStarMap.renderer;
            return renderer.cloudWidth === canvas[2] && renderer.cloudHeight === canvas[3]
                && renderer.canvas.width === canvas[0] && renderer.canvas.height === canvas[1]
                && renderer.galacticImage.naturalWidth === 4096;
        }, galaxyCanvas), 'Galaxy rotation keeps a stable volume grid and the full-resolution disk');
        await page.waitForFunction(() => !window.lifeStarMap.currentView.moving);
        check(await page.evaluate(canvas => window.lifeStarMap.renderer.cloudWidth === canvas[2]
            && window.lifeStarMap.renderer.cloudHeight === canvas[3], galaxyCanvas),
            'A settled galaxy retains the same volume grid without a quality pop');
        await page.evaluate(() => {
            const map = window.lifeStarMap;
            map.openPortal(portalDefinitions.find(portal => portal.id === 'gallery'));
            map.cancelFlight();
        });
        await settle(page);
        check(await page.evaluate(() => window.lifeStarMap.mapLevel === 'galaxy' && window.lifeStarMap.galaxyMix === 1),
            'Cancelling a constellation flight from the galaxy restores both its view and zoom level');
        await page.evaluate(() => window.lifeStarMap.showLocal());
        await settle(page);
        check(await page.evaluate(() => window.lifeStarMap.galaxyMix === 0),
            'Returning from the galaxy completes the blend back to a clean local map');
    } finally {
        await context.close();
    }
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
        `${label}: the Solar System marker is an available destination selector`);
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
        await page.locator('#solarDestination').waitFor({ state: 'visible' });
        check(await page.evaluate(() => state.modalOpen && !window.lifeStarMap.canMove()),
            `${label}: Solar System ${activation} opens the modal choice and suspends map gestures`);
        const home = page.locator('#solarHome');
        if (activation === 'tap') await home.tap();
        else if (activation === 'click') await home.click();
        else { await home.focus(); await page.keyboard.press(activation); }
        await page.waitForURL(url => url.origin === new URL(pageUrl).origin && /^\/(?:index(?:\.html)?)?$/.test(url.pathname));
        await page.locator('.hero-title').waitFor({ state: 'visible' });
        check(true, `${label}: the right-hand choice activated with ${activation} returns to the homepage`);
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
        check(entries.length === 7 && entries.every(entry => entry.label && entry.text && !entry.inert && !entry.disabled),
            `${language}: all seven life sections remain accessible through the index`);
        drawerTitles.push(await page.locator('#sectionDrawerList').getAttribute('aria-label'));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !state.sectionDrawerOpen);
    }
    check(new Set(drawerTitles).size === 3, 'The constellation index switches between all three languages');
    await page.locator('.lang-btn[data-lang="en"]').click();
    await page.locator('#sectionDrawerToggle').click();
    await page.locator('#sectionDrawerList [data-portal-id="profile"]').click();
    await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'profile');
    check(await page.locator('#profile').getAttribute('hidden') === null, 'An index entry opens its matching content');
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
        await page.locator('#sectionDrawerList [data-portal-id="wine"]').click();
        await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'wine');
        await settle(page);
        for (const [language, expected] of [['en', 'Wine Diary'], ['zh-CN', '品酒日记'], ['zh-TW', '品酒日記']]) {
            await page.locator(`.lang-btn[data-lang="${language}"]`).click();
            check(await page.locator('#portalPanelTitle').textContent() === expected
                && await page.locator('#constellationMeaningText').isVisible()
                && await page.locator('#wine-orgasm').isVisible()
                && await page.locator('#wine-margarita').isVisible(),
                `${label}: Wine Diary shows its constellation meaning and both cocktails in ${language}`);
        }
        await screenshot(page, `wine-${label}`);
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

async function visualChecks(browser) {
    for (const device of [
        { name: 'desktop', viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 },
        { name: 'desktop-retina', viewport: { width: 1440, height: 960 }, deviceScaleFactor: 2 },
        { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    ]) {
        const { name, ...options } = device;
        const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
        try {
            const page = await context.newPage();
            monitor(page, name);
            await load(page);
            check(page.galaxyRequests.length === 0, `${name}: the local map starts without downloading galaxy textures`);
            check(await page.evaluate(() => window.lifeStarMap.renderer.ready && window.lifeStarMap.galaxyMix === 0),
                `${name}: the local map starts without leaking galactic particles`);
            const home = await pose(page);
            await page.evaluate(() => { window.lifeStarMap.target.distance = STAR_MAP_LIMITS.localMaxDistance; });
            await settle(page);
            check(await page.evaluate(() => window.lifeStarMap.galaxyMix === 0),
                `${name}: the outer local zoom boundary retains the local star colours`);
            await page.evaluate(home => { window.lifeStarMap.target = home; }, home);
            await settle(page);
            const result = await page.evaluate(() => {
                const map = window.lifeStarMap;
                const renderer = map.renderer;
                const graphics = renderer.gl;
                const originalStars = renderer.stars;
                const view = { position: [0, 0, 320], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], fov: map.fov, galaxy: 0 };
                const focal = renderer.height * 0.5 / Math.tan(view.fov * 0.5);
                const samples = [];
                const stars = [];
                const profiles = [{ size: 2.8, light: 0.3 }, { size: 4.5, light: 0.65 }, { size: 14, light: 1.7 }, { size: 4.5, light: 0.15 }];
                for (const [row, profile] of profiles.entries()) {
                    for (const [column, colourIndex] of [-0.2, 0.65, 1.8].entries()) {
                        const horizontal = (column - 1) * 64 + 0.27;
                        const vertical = (row - 1.5) * 52 + 0.37;
                        stars.push(horizontal * 320 / focal, -vertical * 320 / focal, 0,
                            ...map.color(colourIndex), profile.light, profile.size, 0);
                        samples.push({ horizontal, vertical, column, row });
                    }
                }
                const capture = () => samples.map(sample => {
                    const size = Math.round(24 * renderer.dpr);
                    const pixels = new Uint8Array(size * size * 4);
                    const left = Math.round((renderer.width * 0.5 + sample.horizontal) * renderer.dpr - size * 0.5);
                    const bottom = Math.round((renderer.height * 0.5 - sample.vertical) * renderer.dpr - size * 0.5);
                    graphics.readPixels(left, bottom, size, size, graphics.RGBA, graphics.UNSIGNED_BYTE, pixels);
                    return pixels;
                });
                try {
                    renderer.stars = new Float32Array(stars);
                    const dark = renderer.stars.map((value, index) => index % 9 === 6 ? 0 : value);
                    graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
                    graphics.bufferData(graphics.ARRAY_BUFFER, dark, graphics.STATIC_DRAW);
                    renderer.render(view);
                    const backgrounds = capture();
                    graphics.bufferData(graphics.ARRAY_BUFFER, renderer.stars, graphics.STATIC_DRAW);
                    renderer.render(view);
                    const readings = capture().map((pixels, sampleIndex) => {
                        const channels = [0, 0, 0];
                        for (let offset = 0; offset < pixels.length; offset += 4) {
                            channels.forEach((value, channel) => {
                                channels[channel] += Math.max(0, pixels[offset + channel] - backgrounds[sampleIndex][offset + channel]);
                            });
                        }
                        return channels;
                    });
                    return { readings, error: graphics.getError() };
                } finally {
                    renderer.stars = originalStars;
                    graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
                    graphics.bufferData(graphics.ARRAY_BUFFER, originalStars, graphics.STATIC_DRAW);
                    renderer.render(map.currentView);
                }
            });
            check(result.error === 0, `${name}: the star render completes without WebGL errors`);
            const brightness = result.readings.map(channels => channels.reduce((sum, value) => sum + value, 0));
            check(brightness.every(value => Number.isFinite(value) && value > 0),
                `${name}: all sampled star sizes and brightness levels remain visible`);
            check([0, 1, 2].every(column => brightness[3 + column] > brightness[9 + column] * 3),
                `${name}: equal-sized faint stars remain at least three times dimmer than brighter stars`);
            check([0, 1, 2].every(column => brightness[6 + column] > brightness[3 + column] * 3),
                `${name}: constellation stars retain a clear brightness hierarchy above ordinary stars`);
            await screenshot(page, `local-${name}`);
            await page.evaluate(() => window.lifeStarMap.showGalaxy());
            await page.waitForFunction(() => {
                const renderer = window.lifeStarMap.renderer;
                return renderer.galacticAssetsReady && renderer.galacticUploadVersion === renderer.assetVersion;
            });
            await settle(page);
            check(await page.evaluate(() => {
                const renderer = window.lifeStarMap.renderer;
                return renderer.galacticImage.naturalWidth === 4096 && renderer.galacticDustImage.naturalWidth === 2048;
            }), `${name}: the Gaia reconstruction textures preserve 4K starlight and 2K structure`);
            check(page.galaxyRequests.length === 2, `${name}: entering the galaxy requests each texture only once`);
            check(await page.evaluate(() => {
                const renderer = window.lifeStarMap.renderer;
                const expected = Math.min(devicePixelRatio, 3, Math.sqrt(8294400 / (innerWidth * innerHeight)));
                return renderer.canvas.width === Math.round(innerWidth * expected)
                    && renderer.canvas.height === Math.round(innerHeight * expected);
            }), `${name}: the galactic disk renders at the display's pixel density within its pixel budget`);
            const framing = await page.evaluate(() => {
                const map = window.lifeStarMap;
                return (map.project([360, 0, 0], map.currentView, true).x
                    - map.project([-360, 0, 0], map.currentView, true).x) / innerWidth;
            });
            check(framing > 0.55 && framing < 0.85, `${name}: the galactic disk fills the viewport without losing its outer arms`);
            const galacticColour = await page.evaluate(() => {
                const map = window.lifeStarMap, renderer = map.renderer, graphics = renderer.gl;
                renderer.render(map.currentView);
                const pixels = new Uint8Array(renderer.canvas.width * renderer.canvas.height * 4);
                graphics.readPixels(0, 0, renderer.canvas.width, renderer.canvas.height,
                    graphics.RGBA, graphics.UNSIGNED_BYTE, pixels);
                let disk = 0, magenta = 0, blue = 0, core = 0, warm = 0;
                for (let offset = 0; offset < pixels.length; offset += 4) {
                    const [red, green, cool] = pixels.subarray(offset, offset + 3);
                    const light = red * 0.2126 + green * 0.7152 + cool * 0.0722;
                    if (light > 25 && light < 150) {
                        disk++;
                        if (Math.min(red, cool) > green * 1.045 + 1) magenta++;
                        if (cool > red * 1.04 && green > red) blue++;
                    }
                    if (light > 180) {
                        core++;
                        if (red > green && green > cool) warm++;
                    }
                }
                return { disk, magenta, blue, core, warm, area: pixels.length / 4, error: graphics.getError() };
            });
            check(galacticColour.error === 0 && galacticColour.disk > galacticColour.area * 0.015
                && galacticColour.magenta < galacticColour.disk * 0.02,
            `${name}: the visible galaxy disk has no broad pink or violet cast`);
            check(galacticColour.blue > galacticColour.disk * 0.02 && galacticColour.core > 50
                && galacticColour.warm > galacticColour.core * 0.8,
            `${name}: the galaxy retains distinct cool stellar arms and a warm bright core`);
            await screenshot(page, `galaxy-${name}`);
            if (name === 'desktop') {
                for (const [angle, pitch] of [['edge', 0], ['inclined', 0.20], ['upper', 1.3], ['lower', -0.7]]) {
                    await page.evaluate(pitch => {
                        const map = window.lifeStarMap;
                        map.target.pitch = pitch;
                        map.target.yaw = pitch === 0 ? 0 : 0.8;
                    }, pitch);
                    await settle(page);
                    check(await page.evaluate(() => window.lifeStarMap.renderer.gl.getError() === 0),
                        `The ${angle} galactic view renders without WebGL errors`);
                    if (angle === 'edge') {
                        check(await page.evaluate(() => {
                            const map = window.lifeStarMap;
                            const renderer = map.renderer;
                            const graphics = renderer.gl;
                            renderer.render(map.currentView);
                            return [24, -24].every(height => {
                                const projected = map.project([0, height, 0], map.currentView, true);
                                const pixels = new Uint8Array(3 * 3 * 4);
                                graphics.readPixels(Math.round(projected.x * renderer.dpr) - 1,
                                    Math.round((renderer.height - projected.y) * renderer.dpr) - 1,
                                    3, 3, graphics.RGBA, graphics.UNSIGNED_BYTE, pixels);
                                let brightness = 0;
                                for (let offset = 0; offset < pixels.length; offset += 4) brightness += pixels[offset];
                                return brightness / 9 > 35;
                            });
                        }), 'The edge-on bulge emits above and below the thin absorbing disk');
                        check(await page.evaluate(() => {
                            const map = window.lifeStarMap;
                            const renderer = map.renderer;
                            const graphics = renderer.gl;
                            renderer.render(map.currentView);
                            const brightness = height => {
                                const projected = map.project([0, height, 0], map.currentView, true);
                                const pixel = new Uint8Array(4);
                                graphics.readPixels(Math.round(projected.x * renderer.dpr),
                                    Math.round((renderer.height - projected.y) * renderer.dpr),
                                    1, 1, graphics.RGBA, graphics.UNSIGNED_BYTE, pixel);
                                return pixel[0] + pixel[1] + pixel[2];
                            };
                            return brightness(0) < Math.min(brightness(8), brightness(-8)) * 0.45;
                        }), 'The exactly edge-on dust lane remains darker than the bulge on either side');
                    }
                    await screenshot(page, `galaxy-${angle}`);
                }
            }
            const backgroundClean = await page.evaluate(() => {
                const map = window.lifeStarMap;
                const renderer = map.renderer;
                const view = { position: [0, 550, 600], right: [1, 0, 0], up: [0, 0, 1], forward: [0, 1, 0], fov: map.fov, galaxy: 1 };
                const graphics = renderer.gl;
                renderer.render(view);
                const pixels = new Uint8Array(renderer.canvas.width * renderer.canvas.height * 4);
                graphics.readPixels(0, 0, renderer.canvas.width, renderer.canvas.height, graphics.RGBA, graphics.UNSIGNED_BYTE, pixels);
                let brightPixels = 0;
                for (let offset = 0; offset < pixels.length; offset += 4) {
                    if (pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 105) brightPixels++;
                }
                renderer.render(map.currentView);
                return brightPixels < renderer.canvas.width * renderer.canvas.height * 0.001;
            });
            check(backgroundClean, `${name}: rays facing away from the galaxy do not repeat its texture across the sky`);
            if (name === 'desktop') {
                const extensionAvailable = await page.evaluate(() => {
                    const extension = window.lifeStarMap.renderer.gl.getExtension('WEBGL_lose_context');
                    if (!extension) return false;
                    window.visualContextRecovery = extension;
                    extension.loseContext();
                    return true;
                });
                check(extensionAvailable, 'The galaxy renderer supports a context recovery check');
                await page.waitForFunction(() => !window.lifeStarMap.renderer.ready);
                await page.evaluate(() => window.visualContextRecovery.restoreContext());
                await page.waitForFunction(() => window.lifeStarMap.renderer.ready
                    && window.lifeStarMap.renderer.galacticUploadVersion === window.lifeStarMap.renderer.assetVersion);
                await settle(page);
                check(await page.evaluate(() => {
                    const map = window.lifeStarMap;
                    const renderer = map.renderer;
                    renderer.render(map.currentView);
                    const pixel = new Uint8Array(4);
                    renderer.gl.readPixels(Math.floor(renderer.canvas.width / 2), Math.floor(renderer.canvas.height / 2),
                        1, 1, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, pixel);
                    return pixel[0] > 80 && renderer.gl.getError() === 0;
                }), 'Restoring WebGL uploads the galaxy textures again and preserves the luminous core');
            }
        } finally {
            await context.close();
        }
    }
    const context = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
    let releaseAssets;
    const assetsGate = new Promise(resolve => { releaseAssets = resolve; });
    try {
        const page = await context.newPage();
        monitor(page, 'delayed-galaxy');
        await page.route('**/assets/life/galaxy/*.webp?*', async route => {
            await assetsGate;
            await route.continue();
        });
        await load(page);
        await page.evaluate(() => { window.lifeStarMap.showGalaxy(); });
        await page.waitForFunction(() => window.lifeStarMap.pendingGalaxy);
        check(await page.evaluate(() => !window.lifeStarMap.renderer.galacticAssetsReady
            && window.lifeStarMap.galaxyMix === 0 && window.lifeStarMap.canMove()),
            'A slow galaxy download keeps the local map visible and controllable');
        check(await page.evaluate(() => {
            const map = window.lifeStarMap;
            const before = map.yaw;
            map.orbit(30, 0);
            return Math.abs(map.yaw - before) > 0.1 && Boolean(map.pendingGalaxy);
        }), 'Preparing galaxy assets does not block orbit input');
        releaseAssets();
        await settle(page);
        check(await page.evaluate(() => window.lifeStarMap.mapLevel === 'galaxy'
            && window.lifeStarMap.renderer.galacticUploadVersion === window.lifeStarMap.renderer.assetVersion
            && !window.lifeStarMap.renderer.fallbackDiskImage),
            'The first galaxy flight uses prepared high-resolution images without a temporary procedural disk');
    } finally {
        releaseAssets();
        await context.close();
    }
    const localContext = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
    let releaseLocalAssets;
    const localAssetsGate = new Promise(resolve => { releaseLocalAssets = resolve; });
    try {
        const page = await localContext.newPage();
        monitor(page, 'deferred-galaxy-upload');
        await page.route('**/assets/life/galaxy/*.webp?*', async route => {
            await localAssetsGate;
            await route.continue();
        });
        await load(page);
        await page.evaluate(() => { window.lifeStarMap.showGalaxy(); });
        await page.waitForFunction(() => window.lifeStarMap.pendingGalaxy);
        await page.evaluate(() => window.lifeStarMap.showLocal());
        await settle(page);
        check(await page.evaluate(() => {
            const map = window.lifeStarMap;
            map.showGalaxy();
            map.zoom(-30);
            return !map.pendingGalaxy && map.galaxyMix === 0;
        }), 'Zooming inward cancels a pending galaxy visit');
        await settle(page);
        await page.evaluate(() => { window.lifeStarMap.showGalaxy(); });
        await page.keyboard.press('Escape');
        check(await page.evaluate(() => !window.lifeStarMap.pendingGalaxy && !window.lifeStarMap.flight),
            'Escape cancels preparation without starting an unwanted camera flight');
        await page.evaluate(() => {
            const renderer = window.lifeStarMap.renderer;
            const upload = renderer.uploadGalacticAssets.bind(renderer);
            renderer.uploadsAfterLocalReturn = 0;
            renderer.uploadGalacticAssets = (...args) => {
                renderer.uploadsAfterLocalReturn++;
                return upload(...args);
            };
        });
        releaseLocalAssets();
        await page.waitForFunction(() => window.lifeStarMap.renderer.galacticAssetsReady);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        check(await page.evaluate(() => window.lifeStarMap.galaxyMix === 0
            && window.lifeStarMap.renderer.uploadsAfterLocalReturn === 0),
        'A galaxy download finishing after returning to the local map does not upload its large textures');
        await page.evaluate(() => window.lifeStarMap.showGalaxy());
        await settle(page);
        check(await page.evaluate(() => window.lifeStarMap.renderer.uploadsAfterLocalReturn === 1)
            && page.galaxyRequests.length === 2,
        'Returning to the galaxy uploads the downloaded textures once without downloading them again');
    } finally {
        releaseLocalAssets();
        await localContext.close();
    }
}

async function fallbackChecks() {
    const browser = await chromium.launch({ ...launchOptions, args: [...launchOptions.args, '--disable-webgl'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
        monitor(page, 'fallback');
        await load(page);
        check(page.galaxyRequests.length === 0, 'The canvas local map starts without downloading galaxy textures');
        check(await page.locator('#starMapFallbackCanvas').isVisible()
            && !await page.evaluate(() => window.lifeStarMap.renderer.ready),
        'A browser without WebGL receives the canvas star map fallback');
        const before = await pose(page);
        await drag(page, 'right', 90, 0);
        check(Math.abs((await pose(page)).yaw - before.yaw) > 0.1, 'Orbit controls remain usable without WebGL');
        await reset(page);
        await solarMarkerChecks(page, 'without WebGL');
        await screenshot(page, 'canvas-fallback');
        await page.evaluate(() => window.lifeStarMap.showGalaxy());
        await settle(page);
        await page.waitForFunction(() => window.lifeStarMap.renderer.galacticAssetsReady);
        check(await page.evaluate(() => {
            const renderer = window.lifeStarMap.renderer;
            const pixels = renderer.fallback.getImageData(
                Math.floor(renderer.canvas.width * 0.5), Math.floor(renderer.canvas.height * 0.5), 1, 1).data;
            return renderer.fallbackDisk().width === 4096 && pixels[0] > 80;
        }), 'The canvas fallback preserves the galactic disk and luminous core');
        await screenshot(page, 'galaxy-fallback');
        await page.evaluate(() => window.lifeStarMap.showLocal());
        await settle(page);
        check(await page.locator('[data-map-entity="solar"]').isVisible(),
            'The canvas fallback returns from the galaxy to the local region');
        const unavailable = await browser.newPage({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
        await unavailable.route('**/assets/life/galaxy/*.webp?*', route => route.abort('aborted'));
        await load(unavailable);
        await unavailable.evaluate(() => window.lifeStarMap.showGalaxy());
        await unavailable.waitForFunction(() => window.lifeStarMap.renderer.galacticAssetsFailed);
        await settle(unavailable);
        check(await unavailable.evaluate(() => {
            const renderer = window.lifeStarMap.renderer;
            renderer.render(window.lifeStarMap.currentView);
            return renderer.fallback.getImageData(Math.floor(renderer.canvas.width / 2),
                Math.floor(renderer.canvas.height / 2), 1, 1).data[0] > 80;
        }), 'Unavailable galaxy images retain a visible procedural fallback');
        await unavailable.close();
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
    for (const [group, run] of [['startup', startupChecks], ['motion', motionChecks], ['input', inputChecks], ['desktop', desktopChecks], ['mobile', mobileChecks], ['visuals', visualChecks], ['content', contentChecks], ['footprints', footprintsChecks], ['reduced-motion', reducedMotionChecks]]) {
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
