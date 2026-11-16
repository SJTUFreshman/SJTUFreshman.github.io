'use strict';
// Targeted regression for the demand-loaded DEM mesh, independent of atlas text/photo QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { serve, culture } = require('./validate-admin-explorer.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.render-work/admin-explorer-validation');
const UNIT = process.env.ADMIN_3D_TEST_UNIT || '320500';
const ISLAND = process.env.ADMIN_3D_TEST_ISLAND || 'TW-KIN';
let checks = 0;
function check(value, name) { assert(value, name); checks++; console.log('PASS ' + name); }
function documentFor(id) { return JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/maps/administrative', id.toLowerCase().replaceAll(':', '-') + '.json'))); }
function verifyMesh(info, name) {
    const bytes = fs.readFileSync(path.join(ROOT, info.file));
    check(bytes.toString('ascii', 0, 4) === 'ATM1', name + ' is an actual binary terrain mesh');
    const vertices = bytes.readUInt32LE(4), indices = bytes.readUInt32LE(8);
    check(vertices > 3 && vertices <= 65535 && indices > 3 && indices % 3 === 0 && bytes.length === 12 + vertices * 24 + indices * 2, name + ' mesh dimensions and triangles are valid');
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < vertices * 3; i++) {
        assert(Number.isFinite(bytes.readFloatLE(12 + i * 4)), name + ' finite position');
        assert(Number.isFinite(bytes.readFloatLE(12 + vertices * 12 + i * 4)), name + ' finite normal');
        if (i % 3 === 2) { zmin = Math.min(zmin, bytes.readFloatLE(12 + i * 4)); zmax = Math.max(zmax, bytes.readFloatLE(12 + i * 4)); }
    }
    for (let i = 0; i < indices; i++) assert(bytes.readUInt16LE(12 + vertices * 24 + i * 2) < vertices, name + ' valid index');
    check(zmax > zmin, name + ' contains depth, not a flat image quad');
}
function auditInstrumentation() {
    const state = { contexts: [], listeners: new Map(), observers: new Set() };
    window.__terrainAudit = state;
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (name, ...args) {
        const gl = getContext.call(this, name, ...args);
        if (gl && name === 'webgl' && this.classList.contains('admin-terrain-canvas') && !gl.__audited) {
            gl.__audited = true;
            const record = { gl, canvas: this, buffers: new Set(), shaders: new Set(), programs: new Set() };
            state.contexts.push(record);
            for (const [type, set] of [['Buffer', record.buffers], ['Shader', record.shaders], ['Program', record.programs]]) {
                const create = gl['create' + type].bind(gl), remove = gl['delete' + type].bind(gl);
                gl['create' + type] = (...a) => { const object = create(...a); if (object) set.add(object); return object; };
                gl['delete' + type] = object => { set.delete(object); return remove(object); };
            }
        }
        return gl;
    };
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (this instanceof HTMLCanvasElement && this.classList.contains('admin-terrain-canvas')) {
            if (!state.listeners.has(this)) state.listeners.set(this, new Map());
            const map = state.listeners.get(this); if (!map.has(type)) map.set(type, new Set()); map.get(type).add(listener);
        }
        return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        state.listeners.get(this)?.get(type)?.delete(listener);
        return remove.call(this, type, listener, options);
    };
    const OriginalObserver = window.ResizeObserver;
    window.ResizeObserver = class extends OriginalObserver {
        observe(element, options) { if (element.classList?.contains('admin-terrain-canvas')) state.observers.add(this); return super.observe(element, options); }
        disconnect() { state.observers.delete(this); return super.disconnect(); }
    };
}
async function openUnit(page, parent, id) {
    const dialog = await culture(page, parent);
    await dialog.locator(`.region-district-tabs button[data-unit="${id}"]`).click();
    await dialog.locator('.admin-explorer-layout').waitFor();
    return dialog;
}
async function setup(browser, url, mobile, noWebGL = false) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    await context.addInitScript(auditInstrumentation);
    if (noWebGL) await context.addInitScript(() => {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type === 'webgl' && this.classList.contains('admin-terrain-canvas') ? null : original.call(this, type, ...args); };
    });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('.lang-btn[data-lang="zh-TW"]').click();
    await page.locator('#sectionDrawerToggle').click();
    await page.locator('#sectionDrawer [data-portal-id="footprints"]').click();
    await page.locator('#chinaMap .footprints-preview-hits').waitFor();
    return { context, page };
}
async function released(page, name) {
    await page.waitForFunction(() => window.__terrainAudit.contexts.every(r => r.gl.isContextLost()));
    const report = await page.evaluate(() => {
        const a = window.__terrainAudit;
        return { contexts: a.contexts.length, buffers: a.contexts.reduce((n, r) => n + r.buffers.size, 0), shaders: a.contexts.reduce((n, r) => n + r.shaders.size, 0), programs: a.contexts.reduce((n, r) => n + r.programs.size, 0),
            listeners: [...a.listeners.values()].reduce((n, map) => n + [...map.values()].reduce((sum, set) => sum + set.size, 0), 0), observers: a.observers.size };
    });
    check(report.contexts > 0 && ['buffers', 'shaders', 'programs', 'listeners', 'observers'].every(key => report[key] === 0), name + ' releases GL resources, listeners and resize observers');
    check(await page.locator('.admin-terrain-canvas').count() === 0, name + ' removes all model canvases');
}
async function testInteraction(browser, url, mobile) {
    const device = mobile ? 'touch' : 'desktop', { context, page } = await setup(browser, url, mobile);
    const errors = [], requests = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    try {
        const dialog = await openUnit(page, 'CHN:wuyue', UNIT);
        const doc = documentFor(UNIT), files = Object.values(doc.views).map(v => v.mesh.file);
        check(!requests.some(r => files.some(file => r.includes(file))) && await dialog.locator('canvas.admin-terrain-canvas').count() === 0, device + ' does not load mesh or canvas before requested');
        const panel = dialog.locator('[data-admin-view="urban"]');
        const flatLines = await panel.locator('.admin-photo-leader').evaluateAll(es => es.map(e => e.getAttribute('d')));
        await panel.locator('.admin-model-toggle').click();
        const canvas = panel.locator('.admin-terrain-canvas[data-rendered="true"]'); await canvas.waitFor();
        check(await panel.locator('.admin-model-toggle').getAttribute('aria-pressed') === 'true', device + ' explicitly activates the real terrain model');
        await canvas.scrollIntoViewIfNeeded();
        const start = await canvas.getAttribute('data-rotation'), before = await canvas.screenshot();
        const bounds = await canvas.boundingBox(), x = bounds.x + bounds.width * .5, y = bounds.y + bounds.height * .5;
        if (mobile) {
            const cdp = await context.newCDPSession(page);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 55, y: y - 20, id: 1 }] });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
        } else {
            await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 65, y - 25, { steps: 5 }); await page.mouse.up();
        }
        const after = await canvas.screenshot();
        check(await canvas.getAttribute('data-rotation') !== start, device + ' drag changes actual model rotation');
        check(crypto.createHash('sha256').update(before).digest('hex') !== crypto.createHash('sha256').update(after).digest('hex'), device + ' rotation changes rendered pixels');
        const leaders = await panel.locator('.admin-photo-leader').evaluateAll(es => es.map(e => ({ d: e.getAttribute('d'), hidden: e.getAttribute('visibility') === 'hidden' })));
        check(leaders.length && leaders.every((line, i) => line.hidden || line.d !== flatLines[i]), device + ' visible photo leaders follow projected 3D positions');
        await canvas.focus(); const rotated = await canvas.getAttribute('data-rotation'); await canvas.press('ArrowLeft');
        check(await canvas.getAttribute('data-rotation') !== rotated, device + ' arrow keys rotate the focused model');
        await canvas.press('+'); check(Number((await canvas.getAttribute('data-rotation')).split(',')[2]) > 1, device + ' keyboard zoom works');
        await canvas.press('Home'); check(await canvas.getAttribute('data-rotation') === start, device + ' Home restores the initial angle and scale');
        await panel.locator('.admin-model-controls button').last().click();
        check(Number((await canvas.getAttribute('data-rotation')).split(',')[2]) > 1, device + ' visible zoom button works');
        await panel.locator('.admin-model-controls button').first().click(); check(await canvas.getAttribute('data-rotation') === start, device + ' visible reset works');
        await canvas.screenshot({ path: path.join(OUT, device + '-real-3d.png') });
        await panel.locator('.admin-model-toggle').click();
        await released(page, device + ' returning to map view');
        check(JSON.stringify(await panel.locator('.admin-photo-leader').evaluateAll(es => es.map(e => e.getAttribute('d')))) === JSON.stringify(flatLines), device + ' restores original flat photo leader geometry');
        // Each administrative model can coexist; returning up a level must retire both.
        for (const key of ['whole', 'urban']) { await dialog.locator(`[data-admin-view="${key}"] .admin-model-toggle`).click(); await dialog.locator(`[data-admin-view="${key}"] canvas[data-rendered="true"]`).waitFor(); }
        check(await dialog.locator('.admin-terrain-canvas').count() === 2, device + ' whole and urban are independently interactive');
        await page.keyboard.press('Escape'); await dialog.locator('.region-landscape-svg').waitFor(); await released(page, device + ' returning to culture');
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        if (!mobile) {
            const islands = await openUnit(page, 'CHN:taiwan', ISLAND), whole = islands.locator('[data-admin-view="whole"]');
            await whole.locator('.admin-model-toggle').click(); await whole.locator('canvas[data-rendered="true"]').waitFor();
            const parts = whole.locator('.admin-model-part'); check(await parts.locator('option').count() > 1, 'offshore dependencies have selectable real 3D parts');
            const previous = await whole.locator('canvas').elementHandle(); await parts.selectOption('1'); await whole.locator('canvas[data-rendered="true"]').waitFor();
            check(await previous.evaluate(el => !el.isConnected), 'switching island parts retires the former canvas');
            const islandPart = documentFor(ISLAND).views.whole.mesh.parts[0];
            const visibleIds = await whole.locator('.admin-map-photo').evaluateAll(elements => elements.filter(el => !el.hidden && getComputedStyle(el).display !== 'none').map(el => el.dataset.adminPlace));
            check((!Object.keys(islandPart.points || {}).length || visibleIds.length > 0) && visibleIds.every(id => islandPart.points?.[id]), 'island close-up only displays photographs anchored to the selected island mesh');
            const islandLineIds = await whole.locator('.admin-photo-leader').evaluateAll(elements => elements.filter(el => el.getAttribute('visibility') !== 'hidden').map(el => el.dataset.adminPlace));
            check(islandLineIds.every(id => islandPart.points?.[id]), 'island close-up leaders correspond to real positions on that island');
            await whole.screenshot({ path: path.join(OUT, 'desktop-island-real-3d.png') });
            await page.keyboard.press('Escape'); await islands.locator('.region-landscape-svg').waitFor(); await released(page, 'leaving island 3D view');
        }
        check(errors.length === 0, device + ' terrain interaction has no JavaScript exceptions: ' + errors.join('; '));
    } catch (error) { await page.screenshot({ path: path.join(OUT, device + '-3d-failure.png'), fullPage: true }); throw error; }
    finally { await context.close(); }
}
async function testFallback(browser, url) {
    const { context, page } = await setup(browser, url, false, true);
    try {
        const dialog = await openUnit(page, 'CHN:wuyue', UNIT), panel = dialog.locator('[data-admin-view="whole"]');
        await panel.locator('.admin-model-toggle').click();
        await panel.locator('.admin-model-help').filter({ hasText: '無法' }).waitFor();
        check(await panel.locator('canvas').count() === 0 && await panel.locator('.admin-model-toggle').getAttribute('aria-pressed') === 'false', 'WebGL failure removes failed model and resets control');
        check(await panel.locator('.region-terrain-image').isVisible() && await panel.locator('.admin-map-photo').count() > 0, 'WebGL failure preserves relief map and photo guide');
        await page.keyboard.press('Escape'); await dialog.locator('.region-landscape-svg').waitFor();
    } finally { await context.close(); }
}
async function testDefaultFit(browser, url) {
    // Run the public renderer projection on real vertex buffers. These formerly
    // clipped models exercise both mountain height and an off-centre urban crop.
    const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
    const page = await context.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const cases = [
            { id: '440100', view: 'urban', mesh: documentFor('440100').views.urban.mesh.file },
            { id: 'BTN', view: 'whole', mesh: documentFor('BTN').views.whole.mesh.file }
        ];
        const reports = await page.evaluate(async cases => {
            const { mountTerrain } = await import('/assets/life/scripts/24-terrain-model.mjs');
            const reports = [];
            for (const sample of cases) {
                const bytes = await (await fetch('/' + sample.mesh)).arrayBuffer();
                const count = new DataView(bytes).getUint32(4, true);
                const positions = new Float32Array(bytes, 12, count * 3);
                for (const [width, height] of [[640, 450], [300, 450]]) {
                    const canvas = document.createElement('canvas');
                    canvas.className = 'admin-terrain-canvas';
                    canvas.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
                    document.body.append(canvas);
                    const model = await mountTerrain(canvas, '/' + sample.mesh);
                    const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
                    for (let i = 0; i < positions.length; i += 3) {
                        const point = model.project(positions.subarray(i, i + 3));
                        for (let axis = 0; axis < 2; axis++) {
                            min[axis] = Math.min(min[axis], point[axis]);
                            max[axis] = Math.max(max[axis], point[axis]);
                        }
                    }
                    reports.push({ id: sample.id, view: sample.view, width, height, count, min, max });
                    model.dispose(); canvas.remove();
                }
            }
            return reports;
        }, cases);
        for (const report of reports) {
            check(report.count > 3 && report.min.every(n => Number.isFinite(n) && n >= .05 - 1e-6) && report.max.every(n => Number.isFinite(n) && n <= .95 + 1e-6),
                `${report.id}/${report.view} all ${report.count} vertices fit within 5% canvas margins at ${report.width}x${report.height}`);
        }
        fs.writeFileSync(path.join(OUT, '3d-default-fit.json'), JSON.stringify(reports, null, 2));
    } finally { await context.close(); }
}
async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    const doc = documentFor(UNIT); for (const [key, view] of Object.entries(doc.views)) verifyMesh(view.mesh, UNIT + '/' + key);
    const island = documentFor(ISLAND).views.whole.mesh; verifyMesh(island, ISLAND + '/whole'); for (const part of island.parts || []) verifyMesh(part, ISLAND + '/part');
    check(!/requestAnimationFrame|setInterval/.test(fs.readFileSync(path.join(ROOT, 'assets/life/scripts/24-terrain-model.mjs'), 'utf8')), 'terrain viewer draws on interaction instead of a permanent animation loop');
    const { server, url } = await serve();
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }), args: ['--enable-unsafe-swiftshader'] });
    try { await testInteraction(browser, url, false); await testInteraction(browser, url, true); await testFallback(browser, url); await testDefaultFit(browser, url); }
    finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
    console.log('PASS ' + checks + ' targeted real-3D terrain checks');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
