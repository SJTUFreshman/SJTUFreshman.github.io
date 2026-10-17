'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8787/';
const output = path.resolve(__dirname, '../.render-work/constellation-entry');
const checks = [], errors = [];
const check = (condition, message) => { assert(condition, message); checks.push(message); console.log(`PASS ${message}`); };

async function settle(page) {
    await page.waitForFunction(() => window.lifeStarMap?.lastFrame > 0 && !window.lifeStarMap.flight
        && !window.lifeStarMap.currentView.moving && state.scene !== 'flying');
}

async function pointFor(page, id) {
    return page.evaluate(id => {
        const map = window.lifeStarMap, group = map.groups.get(id);
        const stars = group.points.map((position, index) => ({ ...map.project(position), hip: group.portal.patternHips[index] }));
        return stars.find(point => point.visible && point.x > 30 && point.y > 120 && point.x < innerWidth - 30 && point.y < innerHeight - 120
            && document.elementFromPoint(point.x, point.y)?.closest('#galaxyWorld')
            && map.portalStarAt(point.x, point.y)?.portal.id === id);
    }, id);
}

async function load(page, route) {
    await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.evaluate(() => document.fonts.ready);
}

async function labels(browser) {
    for (const viewport of [{ width: 1365, height: 768 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
        page.on('pageerror', error => errors.push(error.message));
        try {
            await load(page, 'life.html');
            for (const language of ['en', 'zh-CN', 'zh-TW']) {
                await page.locator(`.lang-btn[data-lang="${language}"]`).click();
                const notes = page.locator('[data-portal-button="notes"]');
                const label = await notes.boundingBox();
                check(await notes.isVisible() && label.y > 100 && label.y + label.height < viewport.height - 55,
                    `${viewport.width} × ${viewport.height}/${language}: the Notes label is visible above the footer at the default angle`);
                await notes.click();
                await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'notes');
                check(await page.locator('#notes').isVisible(), `${viewport.width}/${language}: Notes text opens the notes content`);
                await page.locator('#portalClose').click();
                await settle(page);
            }
            await page.locator('.lang-btn[data-lang="zh-CN"]').click();
            await page.screenshot({ path: path.join(output, `labels-${viewport.width}.png`) });
        } finally { await page.close(); }
    }
}

async function entry(browser, route, mobile) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 768 },
        isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const label = `${route}/${mobile ? 'touch' : 'mouse'}`;
    page.on('pageerror', error => errors.push(error.message));
    try {
        await load(page, route);
        // Reorient the actual observer sky to bring each real constellation into view.
        for (const id of ['notes', 'gallery', 'friends', 'thoughts']) {
            if (route === 'observatory.html') {
                await page.evaluate(id => {
                    const map = window.lifeStarMap, vector = normalize(map.groups.get(id).center);
                    map.yaw = map.target.yaw = Math.atan2(-vector[0], -vector[2]);
                    map.pitch = map.target.pitch = Math.asin(-vector[1]);
                    map.distance = map.target.distance = 430;
                }, id);
                await page.waitForFunction(() => window.lifeStarMap.currentView.forward.every((value, axis) => Math.abs(value - window.lifeStarMap.view().forward[axis]) < 1e-6));
            }
            const point = await pointFor(page, id);
            check(Boolean(point), `${label}: ${id} has a reachable visible star outside its text label`);
            if (mobile) await page.touchscreen.tap(point.x, point.y);
            else await page.mouse.click(point.x, point.y);
            await page.waitForFunction(({ id, hip }) => state.scene === 'detail' && state.activePortal?.id === id && state.activeStarHip === hip, { id, hip: point.hip });
            check(true, `${label}: clicking a ${id} star enters that constellation and selects the clicked star`);
            await page.locator('#portalClose').click();
            await settle(page);
        }
        const point = await pointFor(page, route === 'life.html' ? 'notes' : 'thoughts');
        assert(point, `${label}: gesture target must be visible`);
        if (mobile) {
            const session = await context.newCDPSession(page);
            const touch = (x, y, id) => ({ x, y, id, radiusX: 1, radiusY: 1 });
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(point.x, point.y, 1)] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(point.x + 40, point.y + 10, 1)] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await settle(page);
            check(await page.evaluate(() => state.scene === 'roam' && !window.lifeStarMap.selected), `${label}: dragging from a star rotates without opening its content`);
            const next = await pointFor(page, route === 'life.html' ? 'notes' : 'thoughts');
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(next.x, next.y, 1), touch(next.x + 45, next.y, 2)] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(next.x - 10, next.y, 1), touch(next.x + 55, next.y, 2)] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await settle(page);
            check(await page.evaluate(() => state.scene === 'roam' && !window.lifeStarMap.selected), `${label}: pinching from a star zooms without opening content`);
        } else {
            for (const button of ['left', 'right']) {
                const star = await pointFor(page, route === 'life.html' ? 'notes' : 'thoughts');
                await page.mouse.move(star.x, star.y);
                await page.mouse.down({ button });
                await page.mouse.move(star.x + 45, star.y + 10, { steps: 5 });
                await page.mouse.up({ button });
                await settle(page);
                check(await page.evaluate(() => state.scene === 'roam' && !window.lifeStarMap.selected), `${label}: ${button} drag from a star moves the map without opening content`);
            }
        }
        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawerList [data-portal-id="friends"]').click();
        await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'friends');
        const links = await page.locator('#friends a').evaluateAll(elements => elements.map(element => ({ text: element.textContent, href: element.href })));
        check(JSON.stringify(links) === JSON.stringify([
            { text: 'Agentic AI Lab (AAIL)', href: 'https://www.aail.cn/' },
            { text: 'Yuheng Wang', href: 'https://hendrick-wang.github.io/' },
            { text: 'Qiran Zhang', href: 'https://positionprivacy.github.io/' }
        ]), `${label}: Friends contains exactly the three requested websites and no old placeholders`);
    } finally { await context.close(); }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    try {
        await labels(browser);
        for (const route of ['life.html', 'observatory.html']) for (const mobile of [false, true]) await entry(browser, route, mobile);
    } finally { await browser.close(); }
    check(errors.length === 0, `No page exceptions: ${errors.join('; ')}`);
    console.log(`Constellation entry validation: ${checks.length} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
