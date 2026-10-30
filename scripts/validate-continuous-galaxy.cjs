'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8797/';
const output = path.resolve(__dirname, '../.render-work/continuous-galaxy');
const errors = [];
const checks = [];
const check = (condition, message) => { assert(condition, message); checks.push(message); console.log(`PASS ${message}`); };
const magnitude = values => Math.hypot(...values);
const separation = (first, second) => magnitude(first.map((value, axis) => value - second[axis]));

async function load(browser, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
        if (response.url().startsWith(base) && response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`HTTP ${response.status()} ${response.url()}`);
    });
    await page.goto(new URL('life.html', base).href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.lifeStarMap?.renderer.galacticLoadedAt != null && window.lifeStarMap.renderer.skyUploaded);
    await page.waitForFunction(() => lifeStarMap.renderer.galacticOpacity() === 1 && lifeStarMap.renderer.skyOpacity() === 1);
    return { context, page };
}

async function settle(page) {
    await page.waitForFunction(() => {
        const map = lifeStarMap;
        return !map.flight && Math.abs(map.distance - map.target.distance) < 0.0001
            && map.center.every((value, axis) => Math.abs(value - map.target.center[axis]) < 0.000001);
    });
}

async function pose(page) {
    return page.evaluate(() => ({ ...lifeStarMap.snapshot(), position: lifeStarMap.view().position, forward: lifeStarMap.view().forward }));
}

async function desktop(browser) {
    const { context, page } = await load(browser, { deviceScaleFactor: 2 });
    try {
        const initial = await pose(page);
        check(initial.distance === 430 && initial.yaw === 0 && initial.pitch === 0.48
            && initial.center.every(value => value === 0), 'The original desktop camera pose is preserved');
        check(await page.evaluate(() => lifeStarMap.renderer.ready && lifeStarMap.renderer.galacticStars.length > 30000 * 9),
            'WebGL compiles and the extended stellar population is available');
        check(await page.evaluate(() => {
            const renderer = lifeStarMap.renderer;
            return renderer.galacticImage.width === 5000 && renderer.galacticDustImage.width === 4096
                && renderer.galacticTextureSizes.every(size => size.every(dimension => Number.isInteger(Math.log2(dimension))
                    && dimension <= renderer.maxTextureSize)) && renderer.gl.getError() === renderer.gl.NO_ERROR;
        }), 'Native 5K starlight and 4K dust upload as valid mipmapped WebGL textures');
        const fixed = await page.evaluate(() => ({
            local: Array.from(lifeStarMap.renderer.localStars),
            global: Array.from(lifeStarMap.renderer.galacticStars),
            solar: lifeStarMap.entities.find(entity => entity.id === 'solar').position.slice()
        }));
        await page.screenshot({ path: path.join(output, 'local.png') });
        const crossed = await page.evaluate(async () => {
            const map = lifeStarMap;
            const samples = [];
            for (let step = 0; step < 16; step++) {
                map.zoom(120);
                await new Promise(resolve => requestAnimationFrame(resolve));
                samples.push({ scene: state.scene, flight: Boolean(map.flight), pending: Boolean(map.pendingGalaxy), target: map.target.distance, camera: map.view().position });
            }
            return samples;
        });
        check(crossed.every(sample => sample.scene === 'roam' && !sample.flight && !sample.pending),
            'Zooming across the old boundaries never starts a transition or locks input');
        check(crossed.some(sample => sample.target > 50000) && crossed.every((sample, index) => !index || sample.target >= crossed[index - 1].target),
            'The same zoom control travels continuously from local to galactic scale');
        await settle(page);
        check(await page.evaluate(() => !document.getElementById('starMapCanvas').hidden), 'The WebGL canvas remains active at galactic scale');
        check(await page.evaluate(() => {
            const renderer = lifeStarMap.renderer;
            return renderer.dpr === 2 && renderer.canvas.width === innerWidth * 2
                && renderer.cloudWidth === Math.round(innerWidth * 0.75);
        }), 'The galactic overview uses the full Retina resolution and a finer volume sampling grid');
        const far = await pose(page);
        await page.screenshot({ path: path.join(output, 'galaxy.png') });
        const stable = await page.evaluate(original => {
            const renderer = lifeStarMap.renderer;
            return original.local.every((value, index) => value === renderer.localStars[index])
                && original.global.every((value, index) => value === renderer.galacticStars[index])
                && original.solar.every((value, axis) => value === lifeStarMap.entities.find(entity => entity.id === 'solar').position[axis]);
        }, fixed);
        check(stable, 'All stellar buffers and the Sun keep identical world positions throughout zoom');
        await page.evaluate(() => lifeStarMap.zoom(-120));
        check(await page.evaluate(() => lifeStarMap.target.distance > 10000 && !lifeStarMap.flight),
            'Reversing the wheel stays at the current scale instead of returning to the local scene');
        await settle(page);
        await page.evaluate(() => lifeStarMap.openPortal(portalDefinitions.find(portal => portal.id === 'shelf'), 'keyboard'));
        await page.waitForFunction(() => state.scene === 'detail' && !lifeStarMap.flight);
        const detail = await pose(page);
        await page.keyboard.down('w');
        await page.waitForTimeout(200);
        await page.keyboard.up('w');
        check(separation((await pose(page)).position, detail.position) < 0.01, 'Typing movement keys cannot move the camera behind an open card');
        await page.keyboard.press('Escape');
        await settle(page);
        check((await pose(page)).distance > 10000, 'Closing a card restores the galactic view it was opened from');
        await page.evaluate(() => { lifeStarMap.reset(); document.getElementById('galaxyWorld').focus(); });
        await settle(page);
        check(await page.locator('.galactic-tools button').count() === 3
            && await page.locator('[data-flight-action], [data-flight-key], .galactic-pad').count() === 0,
        'The controls expose only zoom and reset, with no free-flight switch or directional pad');
        const beforeKeys = await pose(page);
        for (const key of ['w', 'a', 's', 'd', 'q', 'e']) {
            await page.keyboard.down(key);
            await page.waitForTimeout(120);
            await page.keyboard.up(key);
        }
        await page.keyboard.down('Shift');
        await page.keyboard.down('w');
        await page.waitForTimeout(200);
        await page.keyboard.up('w');
        await page.keyboard.up('Shift');
        check(separation((await pose(page)).position, beforeKeys.position) < 0.001,
            'WASD, QE and Shift no longer translate or rotate the camera');
        const beforeLook = await pose(page);
        await page.mouse.move(1050, 300);
        await page.mouse.down({ button: 'right' });
        await page.mouse.move(1170, 345, { steps: 12 });
        await page.mouse.up({ button: 'right' });
        const looked = await pose(page);
        check(separation(looked.center, beforeLook.center) < 0.001 && looked.distance === beforeLook.distance
            && Math.abs(looked.yaw - beforeLook.yaw) > 0.1, 'Right dragging orbits around the existing viewpoint');
        for (const button of ['left', 'middle']) {
            const before = await pose(page);
            await page.mouse.move(1050, 300);
            await page.mouse.down({ button });
            await page.mouse.move(1120, 330, { steps: 8 });
            await page.mouse.up({ button });
            const after = await pose(page);
            check(separation(after.center, before.center) < 0.001 && after.distance === before.distance
                && Math.abs(after.yaw - before.yaw) > 0.1, `${button} dragging rotates without panning the camera`);
        }
        await page.keyboard.press('Shift+ArrowRight');
        check(separation((await pose(page)).center, initial.center) < 0.001, 'Shift-arrow controls cannot pan the viewpoint');
        const beforeZoom = await pose(page);
        await page.keyboard.down('w');
        await page.mouse.wheel(0, 120);
        await settle(page);
        await page.keyboard.up('w');
        const zoomed = await pose(page);
        check(zoomed.distance > beforeZoom.distance && separation(zoomed.center, initial.center) < 0.001,
            'The wheel keeps zooming around the original centre even while W is held');
        await page.evaluate(() => {
            const input = document.createElement('input');
            input.id = 'galaxy-test-input';
            document.body.append(input);
            input.focus();
        });
        const beforeTyping = await pose(page);
        await page.keyboard.type('wasdqe');
        await page.waitForTimeout(160);
        check(separation((await pose(page)).position, beforeTyping.position) < 0.001, 'Text fields keep WASD and QE input without moving the camera');
        await page.evaluate(() => { document.getElementById('galaxy-test-input').remove(); lifeStarMap.reset(); });
        await settle(page);
        const reset = await pose(page);
        check(separation(reset.position, initial.position) < 0.001, 'Initial view restores the exact starting camera and orbit controls');
        const calibration = await page.evaluate(() => ({
            solar: GALACTIC_SPACE.toDisk(GALACTIC_SPACE.solar),
            restored: GALACTIC_SPACE.fromDisk(GALACTIC_SPACE.toDisk(GALACTIC_SPACE.solar))
        }));
        check(Math.abs(calibration.solar[2] * 40 + 8178) < 0.001 && Math.abs(calibration.solar[1] * 40 - 20.8) < 0.001
            && separation(calibration.restored, fixed.solar) < 0.001, 'The Sun and the galaxy use a consistent 8.178 kpc / 20.8 pc placement');
        await page.evaluate(() => {
            const map = lifeStarMap;
            map.center = map.target.center = GALACTIC_SPACE.center.slice();
            map.distance = map.target.distance = 43000;
            map.pitch = map.target.pitch = 0.035;
            map.labelLayout.clear();
        });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(output, 'edge-on.png') });
        check(await page.evaluate(() => lifeStarMap.renderer.ready), 'The galaxy remains rendered when viewed edge-on');
        await page.evaluate(() => {
            const map = lifeStarMap;
            map.pitch = map.target.pitch = 1.35;
            map.rendererViewKey = null;
            map.labelLayout.clear();
        });
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(output, 'face-on.png') });
        const beforeIdle = await pose(page);
        await page.waitForTimeout(4700);
        check(separation((await pose(page)).position, beforeIdle.position) < 0.001, 'The camera stays where it is left instead of starting an automatic orbit');
        await page.evaluate(() => {
            const renderer = lifeStarMap.renderer;
            window.galaxyContextTest = renderer.gl.getExtension('WEBGL_lose_context');
            window.galaxyContextTest.loseContext();
        });
        await page.waitForFunction(() => !lifeStarMap.renderer.ready && !document.getElementById('starMapFallbackCanvas').hidden);
        await page.screenshot({ path: path.join(output, 'fallback.png') });
        check(await page.evaluate(() => lifeStarMap.canMove()), 'Context loss retains navigation in the Canvas fallback');
        await page.evaluate(() => window.galaxyContextTest.restoreContext());
        await page.waitForFunction(() => lifeStarMap.renderer.ready && lifeStarMap.renderer.galacticUploadVersion === lifeStarMap.renderer.assetVersion);
        check(await page.evaluate(() => !document.getElementById('starMapCanvas').hidden), 'WebGL restores the current galactic position and texture resources');
        check(far.distance > 50000, 'The final overview is reached by camera distance, not a thumbnail state');
    } finally { await context.close(); }
}

async function mobile(browser) {
    const { context, page } = await load(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
        deviceScaleFactor: 2, reducedMotion: 'reduce' });
    try {
        check((await pose(page)).distance === 600, 'The original mobile initial framing is preserved');
        check(await page.evaluate(() => lifeStarMap.renderer.galacticTextureSizes.every(size => size.every(dimension => dimension <= 4096))),
            'Touch devices cap galaxy texture uploads at 4K');
        for (const language of ['en', 'zh-CN', 'zh-TW']) {
            await page.locator(`.lang-btn[data-lang="${language}"]`).tap();
            const bounds = await page.locator('.galactic-navigation').boundingBox();
            check(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844,
                `${language}: mobile view controls fit the screen`);
            check(!/WASD|Q\s*\/\s*E|Free flight|自由飛行|自由飞行|平移/.test(await page.locator('.galactic-navigation, #mapInputHint').allTextContents().then(text => text.join(' '))),
                `${language}: movement controls and instructions are removed`);
        }
        const initial = await pose(page);
        await page.locator('[data-map-action="out"]').tap();
        await settle(page);
        check((await pose(page)).distance > initial.distance && separation((await pose(page)).center, initial.center) < 0.001,
            'Touch zoom controls retain the original orbit centre');
        await page.locator('[data-map-action="reset"]').tap();
        await settle(page);
        const touch = await context.newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: 300, id: 1 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 330, y: 320, id: 1 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        check(Math.abs((await pose(page)).yaw - initial.yaw) > 0.1 && separation((await pose(page)).center, initial.center) < 0.001,
            'A single finger rotates around the original viewpoint');
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 140, y: 420, id: 1 }, { x: 240, y: 420, id: 2 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: 440, id: 1 }, { x: 280, y: 440, id: 2 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await settle(page);
        check((await pose(page)).distance < initial.distance && separation((await pose(page)).center, initial.center) < 0.001,
            'Two-finger pinch zooms without translating the viewpoint');
        await page.locator('[data-map-action="reset"]').tap();
        await settle(page);
        check(separation((await pose(page)).position, initial.position) < 0.001, 'Reduced-motion reset returns to the original mobile view');
        await page.screenshot({ path: path.join(output, 'mobile.png') });
        await page.evaluate(() => { lifeStarMap.target.distance = 32000; });
        await settle(page);
        check(await page.evaluate(() => lifeStarMap.renderer.dpr <= 2 && lifeStarMap.renderer.ready
            && lifeStarMap.renderer.gl.getError() === lifeStarMap.renderer.gl.NO_ERROR),
        'Mobile galactic detail stays within its pixel budget without WebGL errors');
    } finally { await context.close(); }
}

async function limitedTextures(browser) {
    const context = await browser.newContext({ viewport: { width: 960, height: 640 }, reducedMotion: 'reduce' });
    try {
        await context.addInitScript(() => {
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                return parameter === this.MAX_TEXTURE_SIZE ? 2048 : getParameter.call(this, parameter);
            };
            window.createImageBitmap = undefined;
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(new URL('life.html', base).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.lifeStarMap?.renderer.galacticLoadedAt != null);
        await page.evaluate(() => { lifeStarMap.target.distance = 32000; });
        await settle(page);
        check(await page.evaluate(() => {
            const renderer = lifeStarMap.renderer;
            return renderer.ready && renderer.galacticTextureSizes.length === 2
                && renderer.galacticTextureSizes.every(size => size.every(dimension => dimension === 2048))
                && renderer.gl.getError() === renderer.gl.NO_ERROR;
        }), 'A 2K GPU limit and missing ImageBitmap still render both textures through the Canvas upload path');
    } finally { await context.close(); }
}

async function unavailableAssets(browser) {
    const context = await browser.newContext({ viewport: { width: 960, height: 640 }, reducedMotion: 'reduce' });
    try {
        await context.route('**/assets/life/galaxy/**', route => route.abort());
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(new URL('life.html', base).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.lifeStarMap?.initialized);
        const movable = await page.evaluate(() => {
            for (let step = 0; step < 15; step++) lifeStarMap.zoom(120);
            return lifeStarMap.canMove() && !lifeStarMap.flight && !lifeStarMap.pendingGalaxy;
        });
        check(movable, 'Galaxy texture requests never block camera control');
        await page.waitForFunction(() => lifeStarMap.renderer.galacticLoadedAt != null);
        await settle(page);
        check(await page.evaluate(() => lifeStarMap.renderer.galacticAssetsFailed && lifeStarMap.renderer.ready
            && !document.getElementById('starMapCanvas').hidden && lifeStarMap.distance > 10000),
        'Unavailable galaxy textures use a procedural disk in the same navigable space');
        await page.screenshot({ path: path.join(output, 'unavailable-textures.png') });
    } finally { await context.close(); }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    try {
        await desktop(browser);
        await mobile(browser);
        await limitedTextures(browser);
        await unavailableAssets(browser);
        assert.deepEqual(errors, [], 'No page errors or missing local resources');
        fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify({ checks, errors }, null, 2));
        console.log(`Validated ${checks.length} continuous-galaxy checks.`);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
