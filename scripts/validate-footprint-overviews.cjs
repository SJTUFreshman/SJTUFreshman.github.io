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
let previews;

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
        shown: element.classList.contains('is-map-preview') || getComputedStyle(element.querySelector(`[data-atlas-view="${expected}"]`)).display !== 'none',
        hidden: element.classList.contains('is-map-preview') || getComputedStyle(element.querySelector(`[data-atlas-view="${expected === 'overview' ? 'detail' : 'overview'}"]`)).display === 'none',
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
    if (await box.evaluate(element => element.classList.contains('is-map-preview'))) {
        check((await box.locator('.footprints-map-terrain').getAttribute('src')).includes('-card-cultural.webp'),
            `${label}: the cultural card loads its composed preview`);
        return;
    }
    await box.evaluate(element => element.querySelector('[data-cultural-id]')?.classList.add('is-active'));
    const actual = await box.evaluate(element => ({
        clips: [...element.querySelectorAll('[data-clip-cultural]')].map(node => node.dataset.clipCultural).sort(),
        hits: [...element.querySelectorAll('[data-cultural-id]')].map(node => node.dataset.culturalId).sort(),
        labels: [...element.querySelectorAll('[data-cultural-id]')].map(node => [node.dataset.culturalId, node.getAttribute('aria-label')]),
        strokes: [...element.querySelectorAll('[data-cultural-id] .footprints-city-hit')].map(node => getComputedStyle(node).stroke),
        boundaries: [...element.querySelectorAll('[data-cultural-id]')].map(node => {
            const boundary = node.querySelector('.footprints-cultural-boundary');
            return [node.dataset.culturalId, boundary?.getAttribute('d'), boundary && getComputedStyle(boundary).stroke,
                boundary && getComputedStyle(boundary).fill];
        })
    }));
    await box.evaluate(element => element.querySelector('[data-cultural-id]')?.classList.remove('is-active'));
    const regions = metadata.cultural.regions;
    assert.deepEqual(actual.clips, regions.filter(region => region.visited || region.visited_members?.length).map(region => String(region.id)).sort(),
        `${label}: cultural colour clips follow visited members`);
    assert.deepEqual(actual.hits, regions.map(region => String(region.id)).sort(), `${label}: every cultural region is selectable`);
    for (const region of regions) {
        const text = actual.labels.find(([identifier]) => identifier === String(region.id))[1];
        assert(Object.values(region.label).includes(text), `${label}: ${region.id} shows only its established name`);
        const boundary = actual.boundaries.find(([identifier]) => identifier === String(region.id));
        assert(region.boundary_path && boundary[1] === region.boundary_path,
            `${label}: ${region.id} draws its dissolved cultural boundary`);
        assert(boundary[2] && !['none', 'transparent', 'rgba(0, 0, 0, 0)'].includes(boundary[2]) && boundary[3] === 'none',
            `${label}: ${region.id} boundary stays visible without covering terrain`);
    }
    assert(actual.strokes.every(stroke => stroke === 'rgba(0, 0, 0, 0)' || stroke === 'transparent'),
        `${label}: cultural regions do not expose internal boundary strokes`);
    check(true, `${label}: cultural view shows outer boundaries without member counts or internal city strokes`);
}

async function geometryChecks(box, metadata, label, fullResolution = false) {
    if (!fullResolution) {
        const actual = await box.evaluate(element => ({
            id: element.id, source: element.querySelector('.footprints-map-terrain').src,
            width: element.querySelector('.footprints-map-terrain').naturalWidth,
            height: element.querySelector('.footprints-map-terrain').naturalHeight,
            mode: element.dataset.mapView, svg: element.querySelectorAll('svg').length
        }));
        const definition = maps.find(item => actual.id === `${item.id}Map`);
        const expected = previews.maps[definition.key].views[actual.mode];
        check(new URL(actual.source).pathname.endsWith('/' + expected.image) && actual.width === expected.width
            && actual.height === expected.height && actual.width <= 960 && !actual.svg,
            `${label}: static card uses only a lightweight composed preview`);
        return;
    }
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
    const chineseCultures = metadata.overview.regions.filter(region => region.country === 'CHN' && region.unit === 'cultural-region');
    if (chineseCultures.length) {
        const actualCultures = await box.locator('[data-region-id^="CHN:"]').evaluateAll(elements => elements.map(element => ({
            id: element.dataset.regionId, label: element.getAttribute('aria-label'),
            boundary: element.querySelector('.footprints-cultural-boundary')?.getAttribute('d'),
            hitStroke: getComputedStyle(element.querySelector('.footprints-city-hit')).stroke
        })));
        assert.deepEqual(actualCultures.map(region => region.id).sort(), chineseCultures.map(region => region.id).sort());
        for (const region of chineseCultures) {
            const actualRegion = actualCultures.find(item => item.id === region.id);
            assert(Object.values(region.label).includes(actualRegion.label));
            assert.equal(actualRegion.boundary, region.boundary_path);
            assert(['transparent', 'rgba(0, 0, 0, 0)'].includes(actualRegion.hitStroke));
        }
        check(true, `${label}: East Asia displays Chinese cultural names and outer boundaries without province seams`);
    }
    const preview = metadata.preview;
    const previewLoaded = preview?.image && new URL(actual.source, pageUrl).pathname.endsWith('/' + preview.image);
    const expected = !fullResolution && previewLoaded ? preview : metadata;
    check(actual.width === expected.width && actual.height === expected.height && (!fullResolution || !previewLoaded),
        `${label}: terrain dimensions match the published ${fullResolution ? 'native' : previewLoaded ? 'preview' : 'native'} asset`);
}

async function insetChecks(page, box, metadata, label, fullResolution = false) {
    const insets = Array.isArray(metadata.insets) ? metadata.insets : [];
    if (!insets.length) return;
    if (!fullResolution) {
        const titles = await box.locator('.footprints-preview-inset-title').allTextContents();
        check(titles.length === insets.length && insets.every(inset => Object.values(inset.title).some(title => titles.includes(title))),
            `${label}: preview keeps both inset titles in the selected language`);
        return;
    }
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
    if (await box.evaluate(element => element.classList.contains('is-map-preview'))) {
        const unchanged = await viewport.evaluate(element => {
            const stage = element.querySelector('.footprints-map-stage');
            const before = stage.getAttribute('style');
            const wheel = new WheelEvent('wheel', { deltaY: -5000, ctrlKey: true, bubbles: true, cancelable: true });
            element.dispatchEvent(wheel);
            element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
            element.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }));
            return !wheel.defaultPrevented && before === stage.getAttribute('style');
        });
        check(unchanged && await box.locator('.footprints-map-controls').count() === 0,
            `${label}: cards have no zoom controls and do not intercept scrolling or zoom gestures`);
        return;
    }
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
        const requested = [];
        page.on('request', request => { if (request.url().includes('/maps/relief/')) requested.push(request.url()); });
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
            const defaultView = definition.id === 'china' ? 'cultural' : 'overview';
            const initial = await viewState(box, defaultView);
            check(initial.mode === defaultView && initial.shown && initial.hidden, `${name} ${definition.id}: defaults to ${defaultView}`);
            await geometryChecks(box, atlas.maps[definition.key], `${name} ${definition.id}`);
            await insetChecks(page, box, atlas.maps[definition.key], `${name} ${definition.id}`);
        }
        check(requested.every(url => /atlas-preview\.json|\-card\-/.test(url)), `${name}: entering footprints downloads no detailed geometry or full-size terrain`);
        if (!insetsOnly) {
            const chinaCard = page.locator('[data-atlas-card="china"]');
            await chinaCard.scrollIntoViewIfNeeded();
            await chinaCard.screenshot({ path: path.join(output, `${name}-china-default-cultural.png`) });
            await chinaCard.locator('.footprints-map-open').click();
            const viewer = page.locator('.footprints-map-viewer[open]');
            const largeBox = viewer.locator('.footprints-map-box');
            await waitForMap(largeBox, true);
            check(await largeBox.getAttribute('data-map-view') === 'cultural', `${name}: the large China map inherits the default cultural view`);
            await culturalChecks(largeBox, atlas.maps.china, `${name} default cultural`);
            await viewer.locator('.footprints-viewer-close').click();
            await viewer.waitFor({ state: 'detached' });
            await selectView(chinaCard.locator('[data-map-action="select-view"]'), 'overview');
            await waitForMap(page.locator('#chinaMap'));
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
                const largeBox = viewer.locator('.footprints-map-box');
                const modalToggle = viewer.locator(cultural ? '[data-map-action="select-view"]' : '[data-map-action="toggle-view"]');
                await waitForMap(largeBox, true);
                await geometryChecks(largeBox, atlas.maps[definition.key], `${prefix} large`, true);
                check(await viewer.locator('[data-atlas-title]').textContent() === title
                    && (cultural ? await modalToggle.inputValue() === 'detail' : await modalToggle.textContent() === overviewLabel
                        && await modalToggle.getAttribute('aria-pressed') === 'true'), `${prefix}: the large map inherits detailed mode`);
                await capChecks(page, largeBox, definition.cap, `${prefix} large detail`);
                if (cultural) {
                    await selectView(modalToggle, 'cultural');
                    await waitForMap(largeBox, true);
                    await culturalChecks(largeBox, metadata, `${prefix} large cultural`);
                }
                await selectView(modalToggle, 'overview');
                await waitForMap(largeBox, true);
                const overview = await viewState(largeBox, 'overview');
                check(overview.mode === 'overview' && overview.shown && overview.hidden
                    && (cultural ? await modalToggle.inputValue() === 'overview' : await modalToggle.getAttribute('aria-pressed') === 'false'), `${prefix}: the large-map switch enters overview`);
                await capChecks(page, largeBox, definition.cap, `${prefix} large overview`);
                await largeBox.locator('[data-map-action="reset"]').click();
                await insetChecks(page, largeBox, atlas.maps[definition.key], `${prefix} large`, true);
                if (language === 'zh-CN') await page.screenshot({ path: path.join(output, `${name}-${definition.id}.png`) });
                await viewer.locator('.footprints-viewer-close').click();
                await viewer.waitFor({ state: 'detached' });
                await waitForMap(box);
                check(await box.getAttribute('data-map-view') === 'overview' && await box.getAttribute('data-map-resolution') === 'preview',
                    `${prefix}: closing the large map retains the selected overview`);
            }
        }
        check(errors.length === 0, `${name}: no script or asset-loading errors (${errors.join('; ')})`);
    } finally { await context.close(); }
}

async function loadingChecks(browser, mobile = false) {
    const context = await browser.newContext({ viewport: { width: mobile ? 320 : 1440, height: mobile ? 844 : 960 },
        ...(mobile ? { isMobile: true, hasTouch: true } : {}), reducedMotion: 'no-preference' });
    const releases = {};
    const gates = Object.fromEntries(['manifest', 'cards', 'detail', 'detailRetry', 'terrain'].map(key => [key, new Promise(resolve => { releases[key] = resolve; })]));
    const screenshotPrefix = mobile ? 'mobile-' : '';
    let failTerrain = true;
    let failDetail = true;
    try {
        const page = await context.newPage();
        const requested = [];
        page.on('request', request => { if (request.url().includes('/maps/relief/')) requested.push(request.url()); });
        await page.route('**/maps/relief/atlas-preview.json*', async route => { await gates.manifest; await route.continue(); });
        await page.route('**/maps/relief/*-card-*.webp*', async route => { await gates.cards; await route.continue(); });
        await page.route('**/maps/relief/china-runtime.json*', async route => {
            if (failDetail) {
                await gates.detail;
                failDetail = false;
                await route.fulfill({ status: 503, body: 'Temporary test failure' });
            } else {
                await gates.detailRetry;
                await route.continue();
            }
        });
        await page.route('**/maps/relief/china-relief.webp*', async route => {
            await gates.terrain;
            if (failTerrain) { failTerrain = false; await route.fulfill({ status: 503, body: 'Temporary test failure' }); }
            else await route.continue();
        });
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
        await settle(page);
        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawerList [data-portal-id="footprints"]').click();
        const card = page.locator('[data-atlas-card="china"]');
        const box = card.locator('.footprints-map-box');
        await box.locator('.footprints-map-status.is-loading').waitFor();
        check(await box.getAttribute('aria-busy') === 'true' && await box.locator('.footprints-map-status').evaluate(element =>
            getComputedStyle(element, '::before').animationName === 'footprints-map-loading'),
            'slow connection: animated status appears before the preview manifest arrives');
        releases.manifest();
        await page.waitForFunction(() => document.querySelector('#chinaMap')?.classList.contains('is-map-preview'));
        await settle(page);
        await page.locator('.lang-btn[data-lang="zh-CN"]').click();
        await card.scrollIntoViewIfNeeded();
        await card.screenshot({ path: path.join(output, screenshotPrefix + 'preview-loading.png') });
        check(await box.locator('.footprints-map-status').textContent() === '正在加载地图',
            'slow connection: preview loading text follows the selected language');
        const selector = card.locator('select');
        check(await selector.inputValue() === 'cultural', 'slow connection: China defaults to cultural before the preview arrives');
        await selector.selectOption('cultural');
        await selector.selectOption('detail');
        await selector.selectOption('overview');
        releases.cards();
        await waitForMap(box);
        check((await box.locator('.footprints-map-terrain').getAttribute('src')).includes('-card-overview.webp'),
            'slow connection: rapid view changes cannot replace the selected preview with a stale response');
        await card.screenshot({ path: path.join(output, screenshotPrefix + 'static-preview.png') });
        check(requested.every(url => /atlas-preview\.json|\-card\-/.test(url)),
            'slow connection: previews need no detailed geometry or native image');
        await card.locator('.footprints-map-open').click();
        let viewer = page.locator('.footprints-map-viewer[open]');
        let largeBox = viewer.locator('.footprints-map-box');
        await largeBox.locator('.footprints-map-status.is-loading').waitFor();
        check((await largeBox.locator('.footprints-map-poster').getAttribute('src')).includes('-card-overview.webp')
            && await largeBox.locator('.footprints-map-status').textContent() === '正在加载高清地图',
            'slow connection: large viewer keeps the preview behind its loading indicator');
        await viewer.screenshot({ path: path.join(output, screenshotPrefix + 'large-map-loading.png') });
        releases.detail();
        await largeBox.locator('.footprints-map-retry').waitFor({ state: 'visible' });
        check(await largeBox.locator('.footprints-map-retry').textContent() === '重新加载',
            'failed detailed metadata offers a labelled retry button');
        await largeBox.locator('.footprints-map-retry').click();
        await largeBox.locator('.footprints-map-status.is-loading').waitFor();
        const detailFinished = page.waitForEvent('requestfinished', request => request.url().includes('china-runtime.json'));
        await viewer.locator('.footprints-viewer-close').click();
        releases.detailRetry();
        await detailFinished;
        check(await page.locator('.footprints-map-viewer').count() === 0
            && !requested.some(url => /\/china-(relief|colour)\.webp/.test(url)),
            'slow connection: closing during metadata loading prevents a late viewer or terrain request');
        await card.locator('.footprints-map-open').click();
        viewer = page.locator('.footprints-map-viewer[open]');
        largeBox = viewer.locator('.footprints-map-box');
        await largeBox.locator('.footprints-map-svg').waitFor();
        check(await largeBox.getAttribute('aria-busy') === 'true', 'slow connection: loading stays visible until native terrain arrives');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        check(await largeBox.locator('.footprints-map-status').evaluate(element => getComputedStyle(element, '::before').animationName === 'none'),
            'loading indicator respects reduced motion');
        releases.terrain();
        await largeBox.locator('.footprints-map-retry').waitFor({ state: 'visible' });
        check(await largeBox.locator('.footprints-map-retry').textContent() === '重新加载'
            && await largeBox.locator('.footprints-map-poster').isVisible(), 'failed native load keeps the preview and offers retry');
        await largeBox.locator('.footprints-map-retry').click();
        await waitForMap(largeBox, true);
        check(await largeBox.locator('.footprints-map-poster').count() === 0
            && !await largeBox.locator('.footprints-map-status').isVisible(), 'successful retry replaces the preview with full native quality');
        check(!requested.some(url => /\/(east_asia|europe_usa)-runtime\.json/.test(url)), 'large maps fetch only their own detailed geometry');
        await viewer.locator('.footprints-viewer-close').click();
        await waitForMap(box);
        check((await box.locator('.footprints-map-terrain').getAttribute('src')).includes('-card-overview.webp')
            && !await box.locator('.footprints-map-controls').count(), 'closing the viewer restores the static lightweight card');
    } finally {
        Object.values(releases).forEach(release => release());
        await context.close();
    }
}

async function main() {
    if (process.argv[2] === '--serve') await serve();
    fs.mkdirSync(output, { recursive: true });
    const response = await fetch(new URL('assets/maps/relief/atlas.json', pageUrl));
    assert(response.ok, 'The atlas must be available');
    const atlas = await response.json();
    previews = await (await fetch(new URL('assets/maps/relief/atlas-preview.json', pageUrl))).json();
    for (const definition of maps) assert(atlas.maps[definition.key].overview, `${definition.key}: missing overview data; package the atlas before running this check`);
    const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }),
        args: ['--enable-unsafe-swiftshader'] });
    try {
        await loadingChecks(browser, process.argv.includes('--mobile-loading'));
        if (process.argv.includes('--loading-only')) return;
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
