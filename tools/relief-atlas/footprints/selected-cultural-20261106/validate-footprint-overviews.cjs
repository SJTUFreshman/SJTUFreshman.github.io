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

async function waitForMap(box, fullResolution = false) {
    await box.waitFor({ state: 'visible' });
    await box.page().waitForFunction(({ id, full }) => {
        const element = document.getElementById(id);
        const terrain = element.querySelector('.footprints-map-terrain');
        return element.classList.contains('is-map-error') || (!element.classList.contains('is-map-loading')
            && terrain.complete && terrain.naturalWidth > 0
            && (!full || element.dataset.mapResolution === 'full'));
    }, { id: await box.getAttribute('id'), full: fullResolution });
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

function viewLabels(language, index, cultural) {
    const [, overview, detail] = labels[language][index];
    return cultural ? {
        overview, cultural: { en: 'Cultural regions', 'zh-CN': '文化区', 'zh-TW': '文化區' }[language], detail
    } : { overview, detail };
}

async function controlState(control, mode, expectedLabels, label) {
    if (await control.evaluate(element => element.tagName === 'SELECT')) {
        const options = await control.locator('option').evaluateAll(elements => elements.map(element => [element.value, element.textContent]));
        assert.deepEqual(options, Object.entries(expectedLabels), `${label}: view selector has every translated view`);
        check(await control.inputValue() === mode, `${label}: view selector retains ${mode}`);
    } else {
        const next = mode === 'overview' ? 'detail' : 'overview';
        check(await control.textContent() === expectedLabels[next] && await control.getAttribute('aria-pressed') === String(mode === 'detail'),
            `${label}: view switch describes the next view`);
    }
}

async function selectView(control, mode) {
    if (await control.evaluate(element => element.tagName === 'SELECT')) await control.selectOption(mode);
    else await control.click();
}

async function culturalChecks(box, metadata, label) {
    if (!metadata.cultural) return;
    const actual = await box.evaluate(element => ({
        clips: [...element.querySelectorAll('[data-clip-cultural]')].map(node => node.dataset.clipCultural).sort(),
        hits: [...element.querySelectorAll('[data-cultural-id]')].map(node => node.dataset.culturalId).sort(),
        labels: [...element.querySelectorAll('[data-cultural-id]')].map(node => [node.dataset.culturalId, node.getAttribute('aria-label')])
    }));
    const regions = metadata.cultural.regions;
    assert.deepEqual(actual.clips, regions.filter(region => region.visited || region.visited_members?.length).map(region => String(region.id)).sort(),
        `${label}: cultural colour clips follow visited members`);
    assert.deepEqual(actual.hits, regions.map(region => String(region.id)).sort(), `${label}: every cultural region is selectable`);
    for (const region of regions) {
        const text = actual.labels.find(([identifier]) => identifier === String(region.id))[1];
        const expectedCount = `${region.visited_members?.length || 0}/${region.members.length}`;
        assert(text.includes(expectedCount), `${label}: ${region.id} reports its visited member count`);
    }
    check(true, `${label}: cultural view keeps member counts and visit clips`);
}

async function geometryChecks(box, metadata, label, fullResolution = false) {
    const actual = await box.evaluate(element => ({
        provinces: [...element.querySelectorAll('[data-clip-region]')].map(node => node.dataset.clipRegion).sort(),
        cities: [...element.querySelectorAll('[data-clip-city]')].map(node => node.dataset.clipCity).sort(),
        routes: [...element.querySelectorAll('[data-route-id]')].map(node => node.dataset.routeId).sort(),
        width: element.querySelector('.footprints-map-terrain').naturalWidth,
        height: element.querySelector('.footprints-map-terrain').naturalHeight,
        source: element.querySelector('.footprints-map-terrain').src
    }));
    assert.deepEqual(actual.provinces, metadata.overview.regions.filter(region => region.visited).map(region => String(region.id)).sort(), `${label}: overview clips only visited regions`);
    assert.deepEqual(actual.cities, metadata.regions.filter(region => region.visited).map(region => String(region.id)).sort(), `${label}: detail keeps the original visited cities`);
    assert.deepEqual(actual.routes, metadata.routes.filter(route => route.corridor_path).map(route => String(route.id)).sort(), `${label}: detail keeps every original terrain corridor`);
    await culturalChecks(box, metadata, label);
    const preview = metadata.preview;
    const previewLoaded = preview?.image && new URL(actual.source, pageUrl).pathname.endsWith('/' + preview.image);
    const expected = !fullResolution && previewLoaded ? preview : metadata;
    check(actual.width === expected.width && actual.height === expected.height && (!fullResolution || !previewLoaded),
        `${label}: terrain dimensions match the published ${fullResolution ? 'native' : previewLoaded ? 'preview' : 'native'} asset`);
}

async function insetChecks(page, box, metadata, label, fullResolution = false) {
    const insets = Array.isArray(metadata.insets) ? metadata.insets : [];
    if (!insets.length) return;
    await page.waitForFunction(({ id, count, full }) => {
        const element = document.getElementById(id);
        const groups = [...element.querySelectorAll('.footprints-map-inset')];
        return groups.length === count && groups.every(group => {
            const image = group.querySelector('.footprints-map-inset-terrain');
            const source = image?.getAttribute('href');
            return source && !group.classList.contains('is-unavailable') && (!full || !source.includes('-preview.'));
        });
    }, { id: await box.getAttribute('id'), count: insets.length, full: fullResolution });
    const actual = await box.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const controls = element.querySelector('.footprints-map-controls').getBoundingClientRect();
        return [...element.querySelectorAll('.footprints-map-inset')].map(group => {
            const frame = group.querySelector('.footprints-map-inset-frame').getBoundingClientRect();
            const viewport = group.querySelector('.footprints-map-inset-viewport');
            const image = group.querySelector('.footprints-map-inset-terrain');
            const colour = group.querySelector('.footprints-map-inset-colour');
            return {
                id: group.dataset.insetId,
                source: image.getAttribute('href'),
                viewBox: viewport.getAttribute('viewBox'),
                frameInside: frame.left >= bounds.left - 1 && frame.top >= bounds.top - 1
                    && frame.right <= bounds.right + 1 && frame.bottom <= bounds.bottom + 1,
                controlsClear: frame.right <= controls.left + 1 || frame.left >= controls.right - 1
                    || frame.bottom <= controls.top + 1 || frame.top >= controls.bottom - 1,
                colourHidden: getComputedStyle(colour).display === 'none',
                colourSource: colour.getAttribute('href'),
                visitedPaths: [...viewport.querySelectorAll('clipPath path')].map(node => node.getAttribute('d'))
            };
        });
    });
    check(insets.length === 2 && actual.length === 2, `${label}: both geographic insets load`);
    for (const inset of insets) {
        const result = actual.find(item => item.id === String(inset.id));
        assert(result, `${label}: missing inset ${inset.id}`);
        const expectedImage = fullResolution ? inset.image : inset.preview?.image || inset.image;
        check(new URL(result.source, pageUrl).pathname.endsWith('/' + expectedImage)
            && result.viewBox === `0 0 ${inset.width} ${inset.height}`,
            `${label} ${inset.id}: loads the ${fullResolution ? 'full' : 'preview'} terrain in native map coordinates`);
        check(result.frameInside && result.controlsClear, `${label} ${inset.id}: frame stays inside the map and clear of map controls`);
        const regions = Array.isArray(inset.overview?.regions) ? inset.overview.regions : inset.regions || [];
        const visited = regions.filter(region => region.visited === true && typeof region.path === 'string' && region.path);
        assert.deepEqual(result.visitedPaths, visited.map(region => region.path), `${label} ${inset.id}: colour clips match configured visits`);
        check(visited.length ? !result.colourHidden : result.colourHidden && !result.colourSource,
            `${label} ${inset.id}: unvisited land retains the neutral terrain material`);
    }
    const clipIds = await page.locator('.footprints-map-svg clipPath[id]').evaluateAll(nodes => nodes.map(node => node.id));
    check(clipIds.length === new Set(clipIds).size, `${label}: map and inset clip IDs remain unique`);
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

async function deviceChecks(browser, name, options, atlas, insetsOnly = false) {
    const context = await browser.newContext({ ...options, reducedMotion: 'reduce' });
    const errors = [];
    const selectedMaps = insetsOnly ? maps.filter(definition => atlas.maps[definition.key].insets?.length) : maps;
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
        for (const definition of selectedMaps) {
            const box = page.locator(`#${definition.id}Map`);
            await box.scrollIntoViewIfNeeded();
            await waitForMap(box);
            const initial = await viewState(box, 'overview');
            check(initial.mode === 'overview' && initial.shown && initial.hidden, `${name} ${definition.id}: defaults to the regional view`);
            await geometryChecks(box, atlas.maps[definition.key], `${name} ${definition.id}`);
            await insetChecks(page, box, atlas.maps[definition.key], `${name} ${definition.id}`);
        }
        // Language switching uses the actual site controls, including while the
        // footprints panel is open, so both the labels and retained mode matter.
        for (const language of insetsOnly ? ['en'] : ['en', 'zh-CN', 'zh-TW']) {
            await page.locator(`.lang-btn[data-lang="${language}"]`).click();
            for (const [index, definition] of maps.entries()) {
                if (!selectedMaps.includes(definition)) continue;
                const prefix = `${name} ${language} ${definition.id}`;
                const card = page.locator(`[data-atlas-card="${definition.id}"]`);
                const box = page.locator(`#${definition.id}Map`);
                const metadata = atlas.maps[definition.key];
                const cultural = Boolean(metadata.cultural?.regions?.length);
                const toggle = card.locator(cultural ? '[data-map-action="select-view"]' : '[data-map-action="toggle-view"]');
                const [title, overviewLabel, detailLabel] = labels[language][index];
                await card.scrollIntoViewIfNeeded();
                check(await card.locator('[data-atlas-title]').textContent() === title
                    && (cultural ? await toggle.inputValue() === 'overview' : await toggle.textContent() === detailLabel
                        && await toggle.getAttribute('aria-pressed') === 'false'), `${prefix}: translated heading and switch describe the default view`);
                if (cultural) {
                    const expected = viewLabels(language, index, true);
                    await controlState(toggle, 'overview', { overview: expected.overview, cultural: expected.cultural, detail: expected.detail }, `${prefix} selector`);
                }
                await capChecks(page, box, definition.cap, `${prefix} overview`);
                await box.locator('.footprints-map-viewport').press('ArrowRight');
                const before = await box.locator('.footprints-map-stage').getAttribute('style');
                await selectView(toggle, cultural ? 'cultural' : 'detail');
                await waitForMap(box);
                const middle = await viewState(box, cultural ? 'cultural' : 'detail');
                check(middle.mode === (cultural ? 'cultural' : 'detail') && middle.shown && middle.hidden,
                    `${prefix}: view switch enters ${cultural ? 'cultural' : 'detailed'} mode`);
                check(await box.locator('.footprints-map-stage').getAttribute('style') === before, `${prefix}: changing views preserves zoom and position`);
                if (cultural) {
                    await culturalChecks(box, metadata, `${prefix} cultural`);
                    await selectView(toggle, 'detail');
                }
                await waitForMap(box);
                const detail = await viewState(box, 'detail');
                check(detail.mode === 'detail' && detail.shown && detail.hidden, `${prefix}: view switch enters detailed mode`);
                await capChecks(page, box, definition.cap, `${prefix} detail`);
                await card.locator('.footprints-map-open').click();
                const viewer = page.locator('.footprints-map-viewer[open]');
                const modalToggle = viewer.locator(cultural ? '[data-map-action="select-view"]' : '[data-map-action="toggle-view"]');
                await waitForMap(box, true);
                await geometryChecks(box, atlas.maps[definition.key], `${prefix} large`, true);
                check(await viewer.locator('[data-atlas-title]').textContent() === title
                    && (cultural ? await modalToggle.inputValue() === 'detail' : await modalToggle.textContent() === overviewLabel
                        && await modalToggle.getAttribute('aria-pressed') === 'true'), `${prefix}: the large map inherits detailed mode`);
                await capChecks(page, box, definition.cap, `${prefix} large detail`);
                await selectView(modalToggle, 'overview');
                await waitForMap(box, true);
                const overview = await viewState(box, 'overview');
                check(overview.mode === 'overview' && overview.shown && overview.hidden
                    && (cultural ? await toggle.inputValue() === 'overview' && await modalToggle.inputValue() === 'overview'
                        : await toggle.getAttribute('aria-pressed') === 'false' && await modalToggle.getAttribute('aria-pressed') === 'false'), `${prefix}: the large-map switch synchronizes both buttons`);
                await capChecks(page, box, definition.cap, `${prefix} large overview`);
                await box.locator('[data-map-action="reset"]').click();
                await insetChecks(page, box, atlas.maps[definition.key], `${prefix} large`, true);
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
        if (maps.some(definition => atlas.maps[definition.key].insets?.length)) {
            for (const width of [320, 375]) {
                await deviceChecks(browser, `mobile-${width}`, { viewport: { width, height: 844 }, isMobile: true, hasTouch: true }, atlas, true);
            }
        }
    } finally { await browser.close(); }
    console.log(JSON.stringify({ checks, screenshots: output, url: pageUrl }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server?.closeAllConnections(); server?.close(); });
