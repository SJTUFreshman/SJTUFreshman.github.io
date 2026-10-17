"use strict";

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8787/';
const output = path.resolve(__dirname, '../.render-work/label-stability');
const checks = [], errors = [], reports = [];
function check(value, message, details) {
    assert(value, `${message}\n${JSON.stringify(details || {}, null, 2)}`);
    checks.push(message);
    console.log(`PASS ${message}`);
}

async function motion(browser, route, mobile) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 768 },
        hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce' });
    const page = await context.newPage(), name = `${route}/${mobile ? 'touch' : 'mouse'}`;
    page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
    try {
        await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.lifeStarMap?.lastFrame > 0 && !window.lifeStarMap.currentView.moving);
        await page.evaluate(() => document.fonts.ready);
        const result = await page.evaluate(() => {
            const map = window.lifeStarMap, initial = map.snapshot(), frames = [], hoverChanges = [];
            const capture = () => {
                map.currentView = map.view();
                map.drawGroups(1 / 60);
                map.drawEntities();
                const labels = [];
                const read = (id, button, anchor) => {
                    if (button.hidden || Number(getComputedStyle(button).opacity) < 0.15) return;
                    const rect = button.getBoundingClientRect();
                    labels.push({ id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, ax: anchor.x, ay: anchor.y });
                };
                for (const [id, group] of map.groups) read(id, group.portal.button, map.project(group.center));
                for (const entity of map.entities) read(entity.id, entity.button, map.project(entity.position, map.currentView, entity.level === 'galaxy'));
                return labels;
            };
            for (let index = 0; index < 720; index++) {
                map.yaw = map.target.yaw = initial.yaw + Math.sin(index / 170) * 0.6;
                map.pitch = map.target.pitch = initial.pitch + Math.sin(index / 230) * 0.22;
                frames.push(capture());
            }
            // A stationary pointer must not reshuffle other names after entering/leaving a label.
            map.yaw = map.target.yaw = initial.yaw;
            map.pitch = map.target.pitch = initial.pitch;
            for (let index = 0; index < 180; index++) capture();
            const before = capture();
            for (const group of map.groups.values()) {
                map.hover = group.portal;
                for (let index = 0; index < 20; index++) capture();
                const after = capture();
                for (const label of after) {
                    const old = before.find(value => value.id === label.id);
                    if (old && Math.hypot(label.x - old.x, label.y - old.y) > 1) hoverChanges.push(label.id);
                }
                map.hover = null;
            }
            const stable = capture();
            return { frames, hoverChanges, stable };
        });
        const jumps = [], rapidReappearances = [], lastSeen = new Map();
        let pairs = 0, maxResidual = 0;
        for (let frame = 0; frame < result.frames.length; frame++) {
            for (const current of result.frames[frame]) {
                const last = lastSeen.get(current.id);
                if (last && frame - last.frame > 1 && frame - last.frame < 8) rapidReappearances.push({ id: current.id, frame });
                if (last && frame - last.frame === 1) {
                    const previous = last.label;
                    const anchorMotion = Math.hypot(current.ax - previous.ax, current.ay - previous.ay);
                    if (anchorMotion < 8) {
                        const residual = Math.hypot(current.x - previous.x - (current.ax - previous.ax), current.y - previous.y - (current.ay - previous.ay));
                        maxResidual = Math.max(maxResidual, residual);
                        pairs++;
                        if (residual > 12) jumps.push({ id: current.id, frame, residual });
                    }
                }
                lastSeen.set(current.id, { frame, label: current });
            }
        }
        const report = { name, pairs, maxResidual, jumps, rapidReappearances, hoverChanges: result.hoverChanges };
        reports.push(report);
        fs.writeFileSync(path.join(output, `motion-${route}-${mobile ? 'mobile' : 'desktop'}.json`), JSON.stringify(report, null, 2) + '\n');
        check(pairs > 100, `${name}: rotation samples visible constellation and object labels`, { pairs });
        check(!jumps.length, `${name}: slow rotation never teleports a visible name`, { maxResidual, jumps: jumps.slice(0, 8) });
        check(!rapidReappearances.length, `${name}: labels do not flicker out and back within a few frames`, rapidReappearances.slice(0, 8));
        check(!result.hoverChanges.length, `${name}: hovering changes emphasis without rearranging names`, result.hoverChanges);
        // The observer's initial view faces the galactic centre, where none of the
        // authored content constellations need be visible. Aim at real Cygnus first.
        if (route === 'observatory.html') {
            await page.evaluate(() => {
                const map = window.lifeStarMap, vector = normalize(map.groups.get('thoughts').center);
                map.yaw = map.target.yaw = Math.atan2(-vector[0], -vector[2]);
                map.pitch = map.target.pitch = Math.asin(-vector[1]);
            });
            await page.waitForFunction(() => window.lifeStarMap.currentView.forward.every((value, axis) => Math.abs(value - window.lifeStarMap.view().forward[axis]) < 1e-6));
        }
        // Exercise actual input and the same DOM hit targets used for layout.
        await page.mouse.move(5, 5);
        if (mobile) {
            const session = await context.newCDPSession(page);
            const touch = (x, y) => [{ x, y, id: 1, radiusX: 2, radiusY: 2 }];
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(200, 430) });
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(215, 440) });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
            await page.mouse.move(680, 370);
            await page.mouse.down({ button: 'right' });
            await page.mouse.move(700, 380, { steps: 12 });
            await page.mouse.up({ button: 'right' });
        }
        await page.waitForFunction(() => !window.lifeStarMap.currentView.moving);
        const label = page.locator('.map-portal:visible').first();
        const id = await label.getAttribute('data-portal-button');
        if (mobile) await label.tap(); else await label.click();
        await page.waitForFunction(id => state.scene === 'detail' && state.activePortal?.id === id, id);
        check(true, `${name}: a label remains clickable after rotation`);
        await page.locator('#portalClose').click();
        await page.waitForFunction(() => state.scene === 'roam' && !window.lifeStarMap.currentView.moving);
        await page.screenshot({ path: path.join(output, `labels-${route}-${mobile ? 'mobile' : 'desktop'}.png`) });
    } finally { await context.close(); }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    try {
        for (const route of ['life.html', 'observatory.html']) for (const mobile of [false, true]) await motion(browser, route, mobile);
    } finally { await browser.close(); }
    check(!errors.length, 'Label workflows have no browser exceptions', errors);
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(reports, null, 2) + '\n');
    console.log(`Label stability validation passed (${checks.length} checks).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
