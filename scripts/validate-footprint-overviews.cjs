'use strict';

// Focused checks for the two footprint map views. Run with --serve for this
// checkout, or pass a deployed site URL; no Blender work or archive edits occur.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.render-work/footprint-overviews');
const maps = [
    { id: 'china', key: 'china', cap: 300 },
    { id: 'east-asia', key: 'east_asia', cap: 200 },
    { id: 'euro-usa', key: 'europe_usa', cap: 200 }
];
const labels = {
    en: [['China', 'By province', 'Cities and routes'], ['East Asia', 'Cultural regions', 'Detailed regions'], ['Europe + USA', 'By country', 'Detailed regions']],
    'zh-CN': [['中国', '按省查看', '城市与路线'], ['东亚', '文化地区', '细分地区'], ['欧美', '按国家查看', '细分地区']],
    'zh-TW': [['中國', '按省查看', '城市與路線'], ['東亞', '文化地區', '細分地區'], ['歐美', '按國家查看', '細分地區']]
};
let pageUrl = new URL('life.html', process.argv[2] === '--serve' ? 'http://127.0.0.1/' : process.argv[2] || 'http://127.0.0.1:8765/').href;
let server;
let checks = 0;

function check(condition, message) {
    assert(condition, message);
    checks++;
    console.log('PASS ' + message);
}

async function serve() {
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
        '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
    server = http.createServer(async (request, response) => {
        try {
            const filename = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname));
            const relative = path.relative(root, filename);
            if (relative.startsWith('..') || path.isAbsolute(relative)) return response.writeHead(403).end();
            const stat = await fs.promises.stat(filename);
            if (!stat.isFile()) return response.writeHead(404).end();
            response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-store' });
            fs.createReadStream(filename).on('error', () => response.destroy()).pipe(response);
        } catch { response.writeHead(404).end(); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    pageUrl = `http://127.0.0.1:${server.address().port}/life.html`;
}

async function settle(page) {
    await page.waitForFunction(() => {
        const map = window.lifeStarMap;
        return map?.initialized && map.lastFrame > 0 && !map.flight && !map.pendingGalaxy
            && Math.abs(map.distance - map.target.distance) < 0.15;
    });
}

async function waitForMap(box) {
    await box.waitFor({ state: 'visible' });
    await box.evaluate(element => element.querySelector('.footprints-map-terrain').decode());
    await box.page().waitForFunction(id => {
        const element = document.getElementById(id);
        return !element.classList.contains('is-map-loading') || element.classList.contains('is-map-error');
    }, await box.getAttribute('id'));
    assert(!await box.evaluate(element => element.classList.contains('is-map-error')), 'Both map views must load without an asset error');
}

async function viewState(box, mode) {
    return box.evaluate((element, expected) => ({
        mode: element.dataset.mapView,
        shown: getComputedStyle(element.querySelector(`[data-atlas-view="${expected}"]`)).display !== 'none',
        hidden: getComputedStyle(element.querySelector(`[data-atlas-view="${expected === 'overview' ? 'detail' : 'overview'}"]`)).display === 'none',
        terrain: element.querySelector('.footprints-map-terrain').src
    }), mode);
}

async function geometryChecks(box, metadata, label) {
    const actual = await box.evaluate(element => ({
        provinces: [...element.querySelectorAll('[data-clip-region]')].map(node => node.dataset.clipRegion).sort(),
        cities: [...element.querySelectorAll('[data-clip-city]')].map(node => node.dataset.clipCity).sort(),
        routes: [...element.querySelectorAll('[data-route-id]')].map(node => node.dataset.routeId).sort(),
        width: element.querySelector('.footprints-map-terrain').naturalWidth,
        height: element.querySelector('.footprints-map-terrain').naturalHeight
    }));
    assert.deepEqual(actual.provinces, metadata.overview.regions.filter(region => region.visited).map(region => String(region.id)).sort(), `${label}: overview clips only visited regions`);
    assert.deepEqual(actual.cities, metadata.regions.filter(region => region.visited).map(region => String(region.id)).sort(), `${label}: detail keeps the original visited cities`);
    assert.deepEqual(actual.routes, metadata.routes.filter(route => route.corridor_path).map(route => String(route.id)).sort(), `${label}: detail keeps every original terrain corridor`);
    check(actual.width === metadata.width && actual.height === metadata.height, `${label}: both views share the native high-resolution terrain`);
}

async function capChecks(page, box, maximum, label) {
    const viewport = box.locator('.footprints-map-viewport');
    const readout = box.locator('.footprints-map-zoom');
    await box.locator('[data-map-action="maximum"]').click();
    for (let index = 0; index < 4; index++) {
        await viewport.dispatchEvent('wheel', { deltaY: -5000, ctrlKey: true, bubbles: true, cancelable: true });
    }
    await viewport.focus();
    await page.keyboard.press('+');
    check(await readout.textContent() === `${maximum}%` && await box.locator('[data-map-action="zoom-in"]').isDisabled(),
        `${label}: zoom shortcut, pinch/wheel, and keyboard stop at ${maximum}%`);
}

async function deviceChecks(browser, name, options, atlas) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    const errors = [];
    try {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => {
            const url = new URL(response.url());
            if (url.origin === new URL(pageUrl).origin && response.status() >= 400 && url.pathname !== '/favicon.ico') errors.push(`HTTP ${response.status()}: ${url.pathname}`);
        });
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await settle(page);
        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawerList [data-portal-id="footprints"]').click();
        await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'footprints');
        await settle(page);
        // Portal entry initially contains legacy map placeholders. Wait until
        // the asynchronous atlas has replaced all three before measuring them.
        await page.waitForFunction(() => document.querySelectorAll('.footprints-map-shell[data-map-view]').length === 3);
        for (const definition of maps) {
            const box = page.locator(`#${definition.id}Map`);
            await box.scrollIntoViewIfNeeded();
            await waitForMap(box);
            const initial = await viewState(box, 'overview');
            check(initial.mode === 'overview' && initial.shown && initial.hidden, `${name} ${definition.id}: defaults to the regional view`);
            await geometryChecks(box, atlas.maps[definition.key], `${name} ${definition.id}`);
        }
        // Language switching uses the actual site controls, including while the
        // footprints panel is open, so both the labels and retained mode matter.
        for (const language of ['en', 'zh-CN', 'zh-TW']) {
            await page.locator(`.lang-btn[data-lang="${language}"]`).click();
            for (const [index, definition] of maps.entries()) {
                const prefix = `${name} ${language} ${definition.id}`;
                const card = page.locator(`[data-atlas-card="${definition.id}"]`);
                const box = page.locator(`#${definition.id}Map`);
                const toggle = card.locator('[data-map-action="toggle-view"]');
                const [title, overviewLabel, detailLabel] = labels[language][index];
                await card.scrollIntoViewIfNeeded();
                check(await card.locator('[data-atlas-title]').textContent() === title
                    && await toggle.textContent() === detailLabel && await toggle.getAttribute('aria-pressed') === 'false', `${prefix}: translated heading and switch describe the default view`);
                await capChecks(page, box, definition.cap, `${prefix} overview`);
                await box.locator('.footprints-map-viewport').press('ArrowRight');
                const before = await box.locator('.footprints-map-stage').getAttribute('style');
                await toggle.click();
                await waitForMap(box);
                const detail = await viewState(box, 'detail');
                check(detail.mode === 'detail' && detail.shown && detail.hidden && await toggle.textContent() === overviewLabel
                    && await toggle.getAttribute('aria-pressed') === 'true', `${prefix}: one click restores the detailed view`);
                check(await box.locator('.footprints-map-stage').getAttribute('style') === before, `${prefix}: changing views preserves zoom and position`);
                await capChecks(page, box, definition.cap, `${prefix} detail`);
                await box.locator('[data-map-action="expand"]').click();
                const viewer = page.locator('.footprints-map-viewer[open]');
                const modalToggle = viewer.locator('[data-map-action="toggle-view"]');
                check(await viewer.locator('[data-atlas-title]').textContent() === title
                    && await modalToggle.textContent() === overviewLabel && await modalToggle.getAttribute('aria-pressed') === 'true', `${prefix}: the large map inherits detailed mode`);
                await capChecks(page, box, definition.cap, `${prefix} large detail`);
                await modalToggle.click();
                await waitForMap(box);
                const overview = await viewState(box, 'overview');
                check(overview.mode === 'overview' && overview.shown && overview.hidden && await toggle.getAttribute('aria-pressed') === 'false'
                    && await modalToggle.getAttribute('aria-pressed') === 'false', `${prefix}: the large-map switch synchronizes both buttons`);
                await capChecks(page, box, definition.cap, `${prefix} large overview`);
                await box.locator('[data-map-action="reset"]').click();
                if (language === 'zh-CN') await page.screenshot({ path: path.join(output, `${name}-${definition.id}.png`) });
                await viewer.locator('.footprints-viewer-close').click();
                await viewer.waitFor({ state: 'detached' });
                check(await box.getAttribute('data-map-view') === 'overview' && await box.locator('.footprints-map-zoom').textContent() === '100%',
                    `${prefix}: closing the large map retains the selected overview`);
            }
        }
        check(errors.length === 0, `${name}: no script or asset-loading errors (${errors.join('; ')})`);
    } finally { await context.close(); }
}

async function main() {
    if (process.argv[2] === '--serve') await serve();
    fs.mkdirSync(output, { recursive: true });
    const response = await fetch(new URL('assets/maps/relief/atlas.json', pageUrl));
    assert(response.ok, 'The atlas must be available');
    const atlas = await response.json();
    for (const definition of maps) assert(atlas.maps[definition.key].overview, `${definition.key}: missing overview data; package the atlas before running this check`);
    const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }),
        args: ['--enable-unsafe-swiftshader'] });
    try {
        await deviceChecks(browser, 'desktop', { viewport: { width: 1440, height: 960 } }, atlas);
        await deviceChecks(browser, 'mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, atlas);
    } finally { await browser.close(); }
    console.log(JSON.stringify({ checks, screenshots: output, url: pageUrl }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server?.closeAllConnections(); server?.close(); });
