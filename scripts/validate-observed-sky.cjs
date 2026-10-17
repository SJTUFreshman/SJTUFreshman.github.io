'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const pageUrl = new URL('observatory.html', process.argv[2] || 'http://127.0.0.1:8784/').href;
const selected = process.argv[3] || 'all';
const outputDirectory = path.resolve(__dirname, '../.render-work/local-sky-tests');
const launchOptions = {
    headless: true,
    ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }),
    args: ['--enable-unsafe-swiftshader']
};
const checks = [];
const errors = [];
const skyPattern = '**/assets/life/sky/*.webp?*';

function check(condition, message, details) {
    assert(condition, details ? `${message}\n${JSON.stringify(details, null, 2)}` : message);
    checks.push(message);
    console.log(`PASS ${message}`);
}

function monitor(page, label, expectedSkyFailure = false) {
    page.skyRequests = [];
    page.galaxyRequests = [];
    page.on('request', request => {
        if (request.url().includes('/assets/life/sky/')) page.skyRequests.push(request.url());
        if (request.url().includes('/assets/life/galaxy/')) page.galaxyRequests.push(request.url());
    });
    page.on('pageerror', error => errors.push(`${label}: ${error.stack || error.message}`));
    page.on('console', message => {
        const url = message.location().url || '';
        if (message.type() !== 'error' || url.endsWith('/favicon.ico')) return;
        if (expectedSkyFailure && url.includes('/assets/life/sky/')) return;
        errors.push(`${label}: ${message.text()}`);
    });
    page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin !== new URL(pageUrl).origin || response.status() < 400 || url.pathname === '/favicon.ico') return;
        if (expectedSkyFailure && url.pathname.includes('/assets/life/sky/')) return;
        errors.push(`${label}: HTTP ${response.status()} ${url.pathname}`);
    });
}

async function load(page) {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.lifeStarMap?.initialized && window.lifeStarMap.lastFrame > 0);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('link[href*="assets/life/styles/"]')).every(link => link.sheet));
}

async function settle(page) {
    await page.waitForFunction(() => {
        const map = window.lifeStarMap;
        return !map.flight && !map.pendingGalaxy && !map.currentView.moving
            && Math.abs(map.distance - map.target.distance) < 0.05
            && map.currentView.forward.every((value, axis) => Math.abs(value - map.view().forward[axis]) < 1e-6)
            && Math.abs(map.currentView.fov - map.view().fov) < 1e-6;
    });
}

async function skyReady(page) {
    await page.waitForFunction(() => {
        const renderer = window.lifeStarMap.renderer;
        return renderer.skyImage?.naturalWidth > 2048 && renderer.skyOpacity() === 1
            && (!renderer.ready || renderer.skyUploaded && renderer.skyTextureWidth > 2048);
    }, null, { timeout: 60000 });
    await settle(page);
}

async function frameSignature(page) {
    return page.evaluate(() => {
        const map = window.lifeStarMap, renderer = map.renderer;
        renderer.render(map.currentView);
        const width = renderer.canvas.width, height = renderer.canvas.height;
        const pixels = renderer.ready ? new Uint8Array(width * height * 4)
            : renderer.fallback.getImageData(0, 0, width, height).data;
        if (renderer.ready) renderer.gl.readPixels(0, 0, width, height, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, pixels);
        let hash = 2166136261, sum = 0;
        for (let offset = 0; offset < pixels.length; offset += 68) {
            for (let channel = 0; channel < 3; channel++) {
                hash = Math.imul(hash ^ pixels[offset + channel], 16777619);
                sum += pixels[offset + channel];
            }
        }
        return { hash: hash >>> 0, sum, error: renderer.ready ? renderer.gl.getError() : 0 };
    });
}

async function interaction(page, label) {
    const before = await page.evaluate(() => ({ yaw: window.lifeStarMap.yaw, fov: window.lifeStarMap.currentView.fov }));
    const image = await frameSignature(page);
    await page.evaluate(() => window.lifeStarMap.orbit(95, 18));
    await page.waitForFunction(yaw => Math.abs(window.lifeStarMap.yaw - yaw) > 0.2, before.yaw);
    await settle(page);
    const rotated = await frameSignature(page);
    check(rotated.hash !== image.hash && rotated.error === 0, `${label}: rotation redraws the observed sky without rendering errors`, { image, rotated });
    await page.evaluate(() => window.lifeStarMap.zoom(-110));
    await settle(page);
    const zoomed = await frameSignature(page);
    check(await page.evaluate(fov => window.lifeStarMap.currentView.fov < fov * 0.9
        && window.lifeStarMap.currentView.position.every(value => Math.abs(value) < 1e-8), before.fov)
        && zoomed.hash !== rotated.hash && zoomed.error === 0,
    `${label}: zoom changes angular field of view while keeping the observer at the origin`);
}

async function desktop(browser) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    try {
        const page = await context.newPage();
        monitor(page, 'desktop');
        await load(page);
        await skyReady(page);
        const state = await page.evaluate(() => {
            const map = window.lifeStarMap, renderer = map.renderer;
            return { ready: renderer.ready, image: [renderer.skyImage.naturalWidth, renderer.skyImage.naturalHeight],
                texture: renderer.skyTextureWidth, version: renderer.skyVersion, observer: map.currentView.observer,
                galaxy: map.galaxyMix, visible: !renderer.canvas.hidden };
        });
        check(state.ready && state.visible && state.observer && state.galaxy === 0
            && state.image[0] === state.image[1] * 2 && state.texture === 6000 && state.version >= 2,
        'Desktop loads preview and high-resolution observed equirectangular sky', state);
        check(page.skyRequests.length === 2 && page.galaxyRequests.length === 0,
            'Local startup requests its two sky images without exterior galaxy textures');
        const pixels = await frameSignature(page);
        check(pixels.sum > 1000 && pixels.error === 0, 'The observed sky produces nonempty WebGL pixels');
        await page.evaluate(() => {
            const renderer = window.lifeStarMap.renderer;
            renderer.localSkyTestOpacity = renderer.skyOpacity;
            renderer.skyOpacity = () => 0;
        });
        let withoutSky;
        try { withoutSky = await frameSignature(page); }
        finally {
            await page.evaluate(() => {
                const renderer = window.lifeStarMap.renderer;
                renderer.skyOpacity = renderer.localSkyTestOpacity;
                delete renderer.localSkyTestOpacity;
                window.lifeStarMap.rendererViewKey = null;
            });
        }
        check(pixels.hash !== withoutSky.hash && pixels.sum > withoutSky.sum,
            'The downloaded panorama contributes visible sky pixels beyond the catalogue stars');
        await page.screenshot({ path: path.join(outputDirectory, 'desktop-observed-sky.png') });
        await page.evaluate(() => window.lifeStarMap.orbit((Math.PI / 2) / 0.0042, 0));
        await settle(page);
        await page.screenshot({ path: path.join(outputDirectory, 'desktop-observed-sky-90.png') });
        await page.evaluate(() => window.lifeStarMap.reset());
        await settle(page);
        await interaction(page, 'Desktop');
        for (const id of ['gallery', 'thoughts', 'projects']) {
            await page.locator('#sectionDrawerToggle').click();
            await page.locator(`#sectionDrawerList [data-portal-id="${id}"]`).click();
            await page.waitForFunction(id => state.scene === 'detail' && state.activePortal?.id === id, id);
            await settle(page);
            const alignment = await page.evaluate(id => {
                const map = window.lifeStarMap, group = map.groups.get(id), renderer = map.renderer;
                const errors = [], projected = [];
                for (let index = 0; index < group.points.length; index++) {
                    const hip = group.portal.patternHips[index];
                    const star = map.starHips.indexOf(hip);
                    if (star < 0) { errors.push(`Missing catalogue star ${hip}`); continue; }
                    const bufferPoint = Array.from(renderer.stars.subarray(star * 9, star * 9 + 3));
                    const pixel = map.project(group.points[index]), gpuPixel = map.project(bufferPoint);
                    if (Math.hypot(pixel.x - gpuPixel.x, pixel.y - gpuPixel.y) > 0.03) errors.push(`Line/star projection mismatch ${hip}`);
                    if (!pixel.visible) continue;
                    const button = group.portal.starButtons.get(hip), rect = button.getBoundingClientRect();
                    if (button.hidden || button.inert || Math.hypot(rect.x + rect.width / 2 - pixel.x, rect.y + rect.height / 2 - pixel.y) > 1.5) {
                        errors.push(`Click target mismatch ${hip}`);
                    }
                    projected.push({ hip, x: pixel.x, y: pixel.y });
                }
                const segments = [], context = overlayContext, move = context.moveTo, line = context.lineTo;
                let pen = null;
                context.moveTo = function (x, y) { pen = [x, y]; return move.call(this, x, y); };
                context.lineTo = function (x, y) { if (pen) segments.push([...pen, x, y]); pen = [x, y]; return line.call(this, x, y); };
                try { map.drawGroups(0); } finally { context.moveTo = move; context.lineTo = line; }
                for (const [from, to] of group.portal.patternEdges) {
                    const a = map.project(group.points[from]), b = map.project(group.points[to]);
                    if (a.depth <= 8 || b.depth <= 8) continue;
                    if (!segments.some(segment => Math.hypot(segment[0] - a.x, segment[1] - a.y, segment[2] - b.x, segment[3] - b.y) < 0.01)) {
                        errors.push(`Missing projected constellation edge ${from}/${to}`);
                    }
                }
                return { errors, projected };
            }, id);
            check(!alignment.errors.length && alignment.projected.length >= 2,
                `${id}: constellation lines, catalogue stars and clickable star targets use matching projections`, alignment);
            const starPixels = await page.evaluate(points => {
                const map = window.lifeStarMap, renderer = map.renderer, gl = renderer.gl;
                const saved = renderer.stars;
                const capture = () => points.map(point => {
                    const pixels = new Uint8Array(7 * 7 * 4);
                    gl.readPixels(Math.round(point.x * renderer.dpr) - 3,
                        Math.round((renderer.height - point.y) * renderer.dpr) - 3,
                        7, 7, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
                    return pixels;
                });
                try {
                    renderer.stars = new Float32Array(0);
                    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.starBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, renderer.stars, gl.STATIC_DRAW);
                    renderer.render(map.currentView);
                    const background = capture();
                    renderer.stars = saved;
                    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.starBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, saved, gl.STATIC_DRAW);
                    renderer.render(map.currentView);
                    const stars = capture();
                    return stars.map((pixels, index) => pixels.reduce((sum, value, offset) =>
                        sum + (offset % 4 === 3 ? 0 : Math.max(0, value - background[index][offset])), 0));
                } finally {
                    renderer.stars = saved;
                    gl.bindBuffer(gl.ARRAY_BUFFER, renderer.starBuffer);
                    gl.bufferData(gl.ARRAY_BUFFER, saved, gl.STATIC_DRAW);
                    renderer.render(map.currentView);
                }
            }, alignment.projected);
            check(starPixels.every(value => value > 0), `${id}: actual GPU star pixels coincide with the projected line endpoints`, starPixels);
            const hip = alignment.projected[0].hip;
            await page.locator(`#starNav [data-star-portal="${id}"][data-star-hip="${hip}"]`).click();
            check(await page.evaluate(hip => state.activeStarHip === hip, hip), `${id}: a projected star target selects its content`);
            await page.locator('#portalClose').click();
            await settle(page);
        }
        const version = await page.evaluate(() => {
            const renderer = window.lifeStarMap.renderer;
            window.localSkyContextRecovery = renderer.gl.getExtension('WEBGL_lose_context');
            if (!window.localSkyContextRecovery) throw new Error('WEBGL_lose_context is unavailable');
            const version = renderer.skyVersion;
            window.localSkyContextRecovery.loseContext();
            return version;
        });
        await page.waitForFunction(() => !window.lifeStarMap.renderer.ready);
        await page.evaluate(() => window.localSkyContextRecovery.restoreContext());
        await page.waitForFunction(version => {
            const renderer = window.lifeStarMap.renderer;
            return renderer.ready && renderer.skyUploaded && renderer.skyVersion > version;
        }, version);
        await settle(page);
        const recovered = await frameSignature(page);
        check(recovered.sum > 1000 && recovered.error === 0 && await page.locator('#starMapCanvas').isVisible(),
            'Context restoration reuploads the observed sky and redraws WebGL');
    } finally { await context.close(); }
}

async function delayed(browser) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
        const page = await context.newPage();
        monitor(page, 'delayed');
        await page.route(skyPattern, async route => { await gate; await route.continue(); });
        await load(page);
        await page.waitForFunction(() => Boolean(window.lifeStarMap.renderer.skyAssetsPromise));
        check(await page.evaluate(() => !window.lifeStarMap.renderer.skyImage && window.lifeStarMap.canMove()),
            'A delayed sky download leaves local navigation available');
        await interaction(page, 'Delayed sky');
        release();
        await skyReady(page);
        check(await page.evaluate(() => window.lifeStarMap.renderer.skyOpacity() === 1 && window.lifeStarMap.canMove()),
            'The delayed observed sky appears when available without blocking navigation');
    } finally { release(); await context.close(); }
}

async function failed(browser) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
    try {
        const page = await context.newPage();
        monitor(page, 'failed', true);
        await page.route(skyPattern, route => route.fulfill({ status: 503, body: 'Simulated unavailable sky image' }));
        await load(page);
        await page.evaluate(() => window.lifeStarMap.renderer.loadSkyAssets());
        check(await page.evaluate(() => !window.lifeStarMap.renderer.skyImage && window.lifeStarMap.canMove()),
            'Unavailable sky files preserve local star navigation');
        await interaction(page, 'Failed sky');
    } finally { await context.close(); }
}

async function competing(browser) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 780 } });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
        const page = await context.newPage();
        monitor(page, 'competing');
        await page.route('**/assets/life/sky/milky-way-sky-native.webp?*', async route => { await gate; await route.continue(); });
        await load(page);
        await page.waitForFunction(() => window.lifeStarMap.renderer.skyUploaded && window.lifeStarMap.renderer.skyImage?.naturalWidth <= 2048);
        await page.evaluate(() => { void window.lifeStarMap.showGalaxy(); });
        await page.waitForFunction(() => Boolean(window.lifeStarMap.flight && window.lifeStarMap.levelTransition));
        release();
        await page.waitForFunction(() => window.lifeStarMap.mapLevel === 'galaxy' && !window.lifeStarMap.flight);
        await skyReady(page);
        const result = await frameSignature(page);
        check(result.error === 0 && await page.evaluate(() => window.lifeStarMap.renderer.ready && !window.lifeStarMap.renderer.canvas.hidden),
            'A sky download competing with the exterior-galaxy flight preserves the WebGL renderer');
        await page.evaluate(() => window.lifeStarMap.showLocal());
        await settle(page);
        check(await page.evaluate(() => window.lifeStarMap.galaxyMix === 0 && window.lifeStarMap.renderer.skyUploaded),
            'Returning from the exterior galaxy displays the downloaded local sky');
    } finally { release(); await context.close(); }
}

async function fallback() {
    const browser = await chromium.launch({ ...launchOptions, args: ['--disable-webgl', '--disable-webgl2'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
        monitor(page, 'fallback');
        await load(page);
        await skyReady(page);
        check(await page.evaluate(() => !window.lifeStarMap.renderer.ready && Boolean(window.lifeStarMap.renderer.skyImage))
            && await page.locator('#starMapFallbackCanvas').isVisible(),
        'Canvas fallback loads the same observed Milky Way panorama');
        await interaction(page, 'Canvas fallback');
        await page.screenshot({ path: path.join(outputDirectory, 'canvas-observed-sky.png') });
    } finally { await browser.close(); }
}

async function mobile(browser) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
        isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    try {
        const page = await context.newPage();
        monitor(page, 'mobile');
        await load(page);
        await skyReady(page);
        check(await page.evaluate(() => window.lifeStarMap.renderer.ready && window.lifeStarMap.renderer.skyTextureWidth === 6000
            && window.lifeStarMap.currentView.observer && window.lifeStarMap.galaxyMix === 0),
        'Mobile displays the observed local sky at native 6K resolution');
        await page.screenshot({ path: path.join(outputDirectory, 'mobile-observed-sky.png') });
        await page.evaluate(() => window.lifeStarMap.orbit((Math.PI / 2) / 0.0042, 0));
        await settle(page);
        await page.screenshot({ path: path.join(outputDirectory, 'mobile-observed-sky-90.png') });
        const pixels = await frameSignature(page);
        check(pixels.error === 0 && pixels.sum > 1000, 'Mobile can turn ninety degrees through the observed sky');
    } finally { await context.close(); }
}

async function limited(browser) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
    try {
        await context.addInitScript(() => {
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function (parameter) {
                return parameter === this.MAX_TEXTURE_SIZE ? 4096 : getParameter.call(this, parameter);
            };
        });
        const page = await context.newPage();
        monitor(page, 'limited GPU');
        await load(page);
        await skyReady(page);
        const pixels = await frameSignature(page);
        check(await page.evaluate(() => window.lifeStarMap.renderer.skyImage.naturalWidth === 6000
            && window.lifeStarMap.renderer.skyTextureWidth === 4096 && window.lifeStarMap.renderer.ready)
            && pixels.sum > 1000 && pixels.error === 0,
        'A GPU limited to 4K downsamples the native sky into a valid, visible texture');
    } finally { await context.close(); }
}

async function main() {
    const groups = { desktop, mobile, delayed, failed, competing, limited, fallback };
    assert(selected === 'all' || groups[selected], 'Group must be all, desktop, mobile, delayed, failed, competing, limited, or fallback');
    fs.mkdirSync(outputDirectory, { recursive: true });
    for (const [name, run] of Object.entries(groups)) {
        if (selected !== 'all' && selected !== name) continue;
        if (name === 'fallback') await run();
        else {
            const browser = await chromium.launch(launchOptions);
            try { await run(browser); } finally { await browser.close(); }
        }
    }
    check(errors.length === 0, 'No unexpected HTTP, JavaScript, Canvas or WebGL console errors', errors);
    console.log(`Local sky validation: ${checks.length} checks passed.`);
}

main().catch(error => {
    console.error(error.stack || error);
    if (errors.length) console.error('Observed errors:', errors);
    process.exitCode = 1;
});
