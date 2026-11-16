'use strict';

// Exercises the current Life entry UI, without depending on any sky renderer API.
// PLAYWRIGHT_MODULE_PATH may point to the desktop runtime's bundled playwright.
// Run: node scripts/validate-region-explorer.cjs [--maps-only] [--desktop-only]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, '.render-work/region-explorer-validation');
const mapsOnly = process.argv.includes('--maps-only');
const shellOnly = process.argv.includes('--shell-only');
const regionsOnly = process.argv.includes('--regions-only');
const assetsOnly = process.argv.includes('--assets-only');
let checks = 0;
const check = (condition, text) => { assert(condition, text); checks++; console.log('PASS ' + text); };
const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
const maps = [ { id: 'china', key: 'china', cap: 300 }, { id: 'east-asia', key: 'east_asia', cap: 200 }, { id: 'euro-usa', key: 'europe_usa', cap: 200 } ];

async function serve() {
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    const server = http.createServer(async (request, response) => {
        try {
            const file = path.resolve(ROOT, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
            const relative = path.relative(ROOT, file);
            if (relative.startsWith('..') || path.isAbsolute(relative)) return response.writeHead(403).end();
            const stat = await fs.promises.stat(file);
            if (!stat.isFile()) return response.writeHead(404).end();
            response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size });
            fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
        } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, url: `http://127.0.0.1:${server.address().port}/life.html?music=off` };
}

async function pointInside(locator) {
    await locator.scrollIntoViewIfNeeded();
    return locator.evaluate(element => {
        const bounds = element.getBBox(), transform = element.getScreenCTM();
        const candidates = [[.5, .5]];
        for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) candidates.push([x / 20, y / 20]);
        for (const [x, y] of candidates) {
            const local = new DOMPoint(bounds.x + x * bounds.width, bounds.y + y * bounds.height);
            if (!element.isPointInFill(local)) continue;
            const screen = local.matrixTransform(transform);
            const hit = document.elementFromPoint(screen.x, screen.y);
            if (hit === element || element.contains(hit)) return { x: screen.x, y: screen.y };
        }
        throw new Error(`No visible interior in ${element.dataset.regionId || element.dataset.unit}`);
    });
}

async function hoverPath(page, locator) {
    const point = await pointInside(locator);
    await page.mouse.move(point.x, point.y);
    return point;
}

async function readyMap(card) {
    await card.scrollIntoViewIfNeeded();
    await card.locator('.footprints-preview-hits').waitFor();
    await card.locator('.footprints-map-terrain').waitFor({ state: 'visible' }).catch(() => {});
}

async function switchLanguage(page, language) {
    await page.locator(`.lang-btn[data-lang="${language}"]`).click();
    await page.waitForFunction(value => document.documentElement.lang === value, language);
}

async function checkEastAsiaPaint(page, viewer, device) {
    const stage = viewer.locator('.footprints-map-stage');
    const screenshot = (await stage.screenshot()).toString('base64');
    const result = await stage.evaluate(async (element, encoded) => {
        async function pixels(src) {
            const image = new Image(); image.src = src; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
            return (x, y) => { const i = (Math.min(canvas.height - 1, Math.round(y * (canvas.height - 1))) * canvas.width +
                Math.min(canvas.width - 1, Math.round(x * (canvas.width - 1)))) * 4; return [...data.slice(i, i + 3)]; };
        }
        const svg = element.querySelector('svg'), width = svg.viewBox.baseVal.width, height = svg.viewBox.baseVal.height;
        const image = element.querySelector('[data-atlas-view="overview"] .footprints-map-visited-image');
        const [rendered, colour, white] = await Promise.all([pixels('data:image/png;base64,' + encoded),
            pixels(image.getAttribute('href')), pixels(element.querySelector('.footprints-map-terrain').src)]);
        const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
        return [...svg.querySelectorAll('[data-clip-region]')].map(path => {
            const box = path.getBBox();
            for (const fy of [.5, .35, .65, .2, .8]) for (const fx of [.5, .35, .65, .2, .8]) {
                const x = box.x + box.width * fx, y = box.y + box.height * fy;
                if (!path.isPointInFill(new DOMPoint(x, y))) continue;
                const tinted = colour(x / width, y / height), neutral = white(x / width, y / height);
                if (distance(tinted, neutral) < 70) continue;
                const actual = rendered(x / width, y / height);
                return { id: path.dataset.clipRegion, visible: distance(actual, tinted) < distance(actual, neutral), actual, tinted, neutral };
            }
            return { id: path.dataset.clipRegion, noSample: true };
        });
    }, screenshot);
    const expected = read('assets/maps/relief/atlas.json').maps.east_asia.overview.regions.filter(region => region.visited).map(region => region.id).sort();
    check(result.map(region => region.id).sort().join('|') === expected.join('|') && result.every(region => region.visible),
        `${device} all ${expected.length} visited East Asia cultures actually retain their colour: ${result.filter(region => !region.visible).map(region => region.id).join(', ')}`);
}

async function checkInsetHitExclusion(page, container, device, mode) {
    const frames = read('assets/maps/relief/atlas.json').maps.east_asia.insets.map(inset => inset.frame);
    const result = await container.evaluate((element, insets) => {
        const svg = element.querySelector('.footprints-map-svg');
        // Use source path geometry to find islands hidden underneath inset frames.
        const paths = [...svg.querySelectorAll('[data-hit-view="overview"] path, [data-atlas-view="overview"] .footprints-city-hit')];
        const blocked = [];
        for (const frame of insets) for (const path of paths) {
            let found = false;
            for (const ring of path.getAttribute('d').split('M').slice(1)) {
                const values = ring.match(/[-+]?(?:\d*\.)?\d+/g)?.map(Number) || [];
                const xs = values.filter((_, i) => i % 2 === 0), ys = values.filter((_, i) => i % 2 === 1);
                const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2;
                if (x < frame.x || x > frame.x + frame.width || y < frame.y || y > frame.y + frame.height || !path.isPointInFill(new DOMPoint(x, y))) continue;
                const screen = new DOMPoint(x, y).matrixTransform(path.getScreenCTM());
                const hit = document.elementFromPoint(screen.x, screen.y);
                blocked.push(!hit?.closest('[data-region-id], [data-city-id]'));
                found = true; break;
            }
            if (found) break;
        }
        return blocked;
    }, frames);
    check(result.length > 0 && result.every(Boolean), `${device} ${mode} inset frames do not activate underlying Japanese islands`);
}

async function testMaps(page, device, requests) {
    await page.locator('#sectionDrawerToggle').click();
    await page.locator('#sectionDrawer [data-portal-id="footprints"]').click();
    await page.locator('#footprints').waitFor({ state: 'visible' });
    const china = page.locator('[data-atlas-card="china"]');
    await readyMap(china);
    const region = china.locator('[data-hit-view="cultural"] [data-region-id="CHN:wuyue"]');
    for (const [language, expected] of [['en', 'Wuyue'], ['zh-CN', '吴越'], ['zh-TW', '吳越']]) {
        await switchLanguage(page, language);
        await hoverPath(page, region);
        const tip = china.locator('.footprints-region-tip');
        await tip.waitFor({ state: 'visible' });
        check((await tip.textContent()).includes(expected), `${device} ${language} small-map name`);
        const style = await region.evaluate(el => ({ stroke: getComputedStyle(el).stroke, fill: getComputedStyle(el).fill }));
        check(style.stroke !== 'rgba(0, 0, 0, 0)' && style.stroke !== 'transparent', `${device} ${language} visible boundary`);
        check((await region.getAttribute('aria-label')).includes(expected), `${device} ${language} keyboard label`);
    }
    const east = page.locator('[data-atlas-card="east-asia"]');
    await readyMap(east);
    await checkInsetHitExclusion(page, east, device, 'small map');
    const restricted = east.locator('[data-hit-view="overview"] [data-region-id="PRK"]');
    await hoverPath(page, restricted);
    check(await restricted.evaluate(el => getComputedStyle(el).fill.includes('url(')), `${device} North Korea red hatching`);
    check(/禁止.*入/.test(await east.locator('.footprints-region-tip').textContent()), `${device} North Korea status`);
    const blockedPoint = await pointInside(restricted);
    await page.mouse.click(blockedPoint.x, blockedPoint.y);
    check(await page.locator('.region-explorer[open]').count() === 0, `${device} restricted area cannot open`);
    await restricted.focus();
    await page.keyboard.press('Enter');
    check(await page.locator('.region-explorer[open]').count() === 0, `${device} restricted area keyboard blocked`);
    await switchLanguage(page, 'en');
    for (const map of maps) {
        const card = page.locator(`[data-atlas-card="${map.id}"]`);
        await readyMap(card);
        const start = requests.length;
        const opener = card.locator('.footprints-map-open');
        await opener.click();
        const viewer = page.locator('.footprints-map-viewer[open]');
        const box = viewer.locator('.footprints-map-shell');
        await page.waitForFunction(() => {
            const box = document.querySelector('.footprints-map-viewer[open] .footprints-map-shell');
            return box?.getAttribute('aria-busy') === 'false' && !box.querySelector('.footprints-map-poster');
        });
        check(await box.getAttribute('data-map-resolution') === 'preview', `${device} ${map.id} opens at middle resolution`);
        const images = await viewer.locator('.footprints-map-terrain').evaluateAll(nodes => nodes.map(node => node.getAttribute('src') || node.getAttribute('href')));
        check(images.some(src => src?.includes('-preview.webp')), `${device} ${map.id} displays 1600px terrain`);
        check(!requests.slice(start).some(url => new RegExp(`/relief/${map.key}-(?:relief|colour|cultural-colour|overview-colour)\\.webp(?:\\?|$)`).test(url)), `${device} ${map.id} no native image before zoom`);
        if (map.id === 'east-asia') {
            await checkEastAsiaPaint(page, viewer, device);
            await checkInsetHitExclusion(page, viewer, device, 'large map');
        }
        await viewer.locator('[data-map-action="maximum"]').click();
        await page.waitForFunction(() => document.querySelector('.footprints-map-viewer[open] .footprints-map-shell')?.dataset.mapResolution === 'full');
        check((await viewer.locator('.footprints-map-zoom').textContent()).includes(String(map.cap)), `${device} ${map.id} zoom cap`);
        check(await viewer.locator('[data-map-action="zoom-in"]').isDisabled(), `${device} ${map.id} prevents exceeding cap`);
        await viewer.locator('[data-map-action="reset"]').click();
        check((await viewer.locator('.footprints-map-zoom').textContent()).includes('100'), `${device} ${map.id} reset`);
        await viewer.screenshot({ path: path.join(OUTPUT, `${device}-${map.id}-large.png`) });
        await viewer.locator('.footprints-viewer-close').click();
        await viewer.waitFor({ state: 'detached' });
        check(await opener.evaluate(el => document.activeElement === el), `${device} ${map.id} returns focus`);
    }
    await china.scrollIntoViewIfNeeded();
    await china.screenshot({ path: path.join(OUTPUT, `${device}-small-map.png`) });
}

function checkAssets() {
    const manifest = read('assets/maps/regions/manifest.json').regions;
    const content = read('assets/maps/regions/content.json').entries;
    const source = read('assets/maps/relief/atlas.json').maps;
    const cultures = source.china.cultural.regions;
    const adminDescriptions = new Set(Object.entries(content).filter(([id]) => /^\d{6}$/.test(id))
        .flatMap(([, entry]) => Object.values(entry.description || {})));
    check(cultures.length === 47, 'all 47 cultural introductions are present');
    for (const region of cultures) {
        const entry = content[region.id];
        check(entry?.textKind === 'editorial-cultural' && ['en', 'zh-CN', 'zh-TW'].every(language =>
            entry.description?.[language]?.length > 40 && !adminDescriptions.has(entry.description[language])),
            `${region.id} independent trilingual cultural introduction`);
        check(entry?.textSources?.length && entry.photo?.src && fs.existsSync(path.join(ROOT, entry.photo.src)),
            `${region.id} cultural sources and local representative photograph`);
    }
    const resolve = (map, view, id) => manifest[`${map}:${view}:${id}`] || manifest[`${map}:${id}`] || manifest[id];
    for (const [map, metadata] of Object.entries(source)) for (const view of ['detail', 'overview', 'cultural']) {
        const layer = view === 'detail' ? metadata : metadata[view];
        if (!layer) continue;
        for (const region of layer.regions.filter(region => region.visited)) {
            const record = resolve(map, view, region.id);
            check(Boolean(record), `published entry ${map}/${view}/${region.id}`);
            const file = typeof record === 'string' ? record : record.file;
            const detail = file ? read('assets/maps/regions/' + file) : record;
            check(fs.statSync(path.join(ROOT, detail.image)).size > 1000, `terrain ${map}/${view}/${region.id}`);
            check(detail.places?.length > 0, `photo landmarks ${map}/${view}/${region.id}`);
            for (const item of detail.subregions || []) {
                const article = content[item.content_id || item.id];
                assert(article?.photo && article?.description, `Missing landscape/article: ${item.id}`);
            }
        }
    }
    for (const [id, required] of [
        ['CHN:mongolian-steppe', ['MNG', 'RUS:Tuva']],
        ['CHN:qingzang', ['NPL', 'BTN', 'IND:Ladakh', 'IND:LahaulSpiti', 'IND:Sikkim']],
        ['CHN:taiwan', ['TW-KIN', 'TW-LIE', 'TW-PEN', 'TWN:Wuqiu', 'TWN:Dongsha', 'TWN:Taiping']],
        ['CHN:min-south', ['TW-KIN']], ['CHN:min-east', ['TW-LIE']], ['CHN:puxian', ['TWN:Wuqiu']]
    ]) {
        const entry = resolve('china', 'cultural', id);
        assert(entry, id);
        const detail = read('assets/maps/regions/' + (typeof entry === 'string' ? entry : entry.file));
        check(required.every(unit => detail.subregions.some(item => item.id === unit)), `${id} special geographic extent`);
        if (['CHN:mongolian-steppe', 'CHN:qingzang'].includes(id)) check(detail.borders?.length > 0, `${id} international boundaries`);
    }
}

async function testRegion(page, device) {
    const card = page.locator('[data-atlas-card="china"]');
    const trigger = card.locator('[data-hit-view="cultural"] [data-region-id="CHN:wuyue"]');
    const point = await hoverPath(page, trigger);
    await page.mouse.click(point.x, point.y);
    const viewer = page.locator('.region-explorer[open]');
    await viewer.locator('.region-landscape-svg').waitFor();
    const imageURL = await viewer.locator('.region-terrain-image').getAttribute('href');
    check(await page.evaluate(async src => { const img = new Image(); img.src = src; await img.decode(); return img.naturalWidth >= 1000; }, imageURL), `${device} independent terrain image decodes`);
    check(await viewer.locator('.region-photo-leaders path').count() > 0, `${device} photo leader lines`);
    const photos = viewer.locator('.region-photo-card img');
    check(await photos.count() > 0, `${device} landmark photographs`);
    await photos.first().scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.querySelectorAll('.region-photo-card img')].every(img => img.complete && img.naturalWidth > 0));
    const units = viewer.locator('.region-district');
    check(await units.count() > 1, `${device} internal subregions`);
    await viewer.locator('.region-explorer-title').hover();
    await viewer.locator('.region-district-tabs button[data-unit=""]').click();
    await viewer.locator('.region-explorer-title').hover();
    const titleBefore = await viewer.locator('.region-note-title').textContent();
    const regionDescription = await viewer.locator('.region-note-description').textContent();
    const regionPhotograph = await viewer.locator('.region-note-photo img').getAttribute('src');
    check(/Cultural sources|文化资料来源|文化資料來源/.test(await viewer.locator('.region-note-source').textContent()) &&
        !(await viewer.locator('.region-note-content').textContent()).includes('Wikipedia · CC BY-SA'),
        `${device} cultural introduction cites cultural sources without an encyclopedia-excerpt label`);
    await hoverPath(page, units.first());
    const titleAfter = await viewer.locator('.region-note-title').textContent();
    check(titleAfter !== titleBefore, `${device} subregion hover changes article title`);
    check((await viewer.locator('.region-note-description').textContent()).trim().length > 20, `${device} subregion encyclopedia text`);
    const photoBefore = await viewer.locator('.region-note-photo img').getAttribute('src');
    await viewer.locator('.region-explorer-title').hover();
    check(await viewer.locator('.region-note-title').textContent() === titleBefore,
        `${device} leaving a district restores the cultural introduction`);
    check(await viewer.locator('.region-note-description').textContent() === regionDescription &&
        await viewer.locator('.region-note-photo img').getAttribute('src') === regionPhotograph,
        `${device} leaving a district restores whole-region text and photograph`);
    await viewer.locator('.region-photo-card').first().hover();
    check(await viewer.locator('.region-note-title').textContent() !== titleBefore, `${device} photograph hover shows its place`);
    await viewer.locator('.region-explorer-title').hover();
    check(await viewer.locator('.region-note-title').textContent() === titleBefore, `${device} leaving a photograph restores whole region`);
    await units.nth(1).focus();
    check((await viewer.locator('.region-note-title').textContent()) !== titleAfter, `${device} keyboard changes subregion`);
    const photoAfter = await viewer.locator('.region-note-photo img').getAttribute('src');
    check(photoAfter !== photoBefore, `${device} subregions show distinct local photographs`);
    await viewer.locator('.region-explorer-close').focus();
    check(await viewer.locator('.region-note-title').textContent() === titleBefore, `${device} leaving keyboard district focus restores whole region`);
    await units.nth(1).focus();
    if (device === 'mobile') {
        const unitId = await units.first().getAttribute('data-unit');
        const target = await pointInside(units.first());
        await page.touchscreen.tap(target.x, target.y);
        await viewer.locator('.admin-explorer-layout').waitFor();
        check(await viewer.locator('[data-admin-view="whole"]').count() === 1 &&
            await viewer.locator('[data-admin-view="urban"]').count() === 1, 'mobile district tap opens its whole and urban terrain views');
        await viewer.locator('.region-explorer-close').click();
        await viewer.locator('.region-landscape-svg').waitFor();
        check(await viewer.evaluate((el, id) => el.contains(document.activeElement) && document.activeElement.dataset.unit === id, unitId),
            'mobile return restores the originating cultural member');
        const blank = await viewer.locator('.region-landscape-canvas').boundingBox();
        await page.touchscreen.tap(blank.x + 5, blank.y + 5);
        check(await viewer.locator('.region-note-title').textContent() === titleBefore, 'mobile tap on empty landscape restores whole region');
    }
    await viewer.locator('.region-note-photo img').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => { const img = document.querySelector('.region-note-photo img'); return img?.complete && img.naturalWidth > 0; });
    check(await viewer.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${device} no horizontal overflow`);
    await viewer.locator('.region-landscape').scrollIntoViewIfNeeded();
    await viewer.screenshot({ path: path.join(OUTPUT, `${device}-region.png`) });
    await page.keyboard.press('Escape');
    await viewer.waitFor({ state: 'detached' });
    check(await trigger.evaluate(el => document.activeElement === el), `${device} region close restores focused area`);
    const mapOpener = card.locator('.footprints-map-open');
    await mapOpener.click();
    const outer = page.locator('.footprints-map-viewer[open]');
    const largeTrigger = outer.locator('[data-cultural-id="CHN:wuyue"]');
    await largeTrigger.waitFor();
    await largeTrigger.focus();
    await page.keyboard.press('Enter');
    await page.locator('.region-explorer[open] .region-landscape-svg').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.region-explorer[open]').waitFor({ state: 'detached' });
    check(await outer.isVisible() && await largeTrigger.evaluate(el => document.activeElement === el), `${device} nested region restores large map and focus`);
    await page.keyboard.press('Escape');
    await outer.waitFor({ state: 'detached' });
    check(await mapOpener.evaluate(el => document.activeElement === el), `${device} second Escape restores small-map opener`);
}

async function testRegionImageRetry(page) {
    const pattern = '**/assets/maps/regions/cultural-chn-wuyue.webp*';
    let abortImage = true, attempts = 0;
    await page.route(pattern, route => {
        attempts++;
        return abortImage ? route.abort('failed') : route.continue();
    });
    try {
        const trigger = page.locator('[data-atlas-card="china"] [data-hit-view="cultural"] [data-region-id="CHN:wuyue"]');
        const point = await hoverPath(page, trigger);
        await page.mouse.click(point.x, point.y);
        const dialog = page.locator('.region-explorer[open]');
        await dialog.locator('.region-load-retry').waitFor();
        check(attempts > 0 && await dialog.locator('.region-terrain-image').count() === 0, 'desktop failed terrain request presents retry rather than blank map');
        check(await dialog.locator('.region-explorer-content').getAttribute('aria-busy') === 'false', 'desktop terrain failure settles loading status');
        abortImage = false;
        await dialog.locator('.region-load-retry').click();
        await dialog.locator('.region-terrain-image').waitFor();
        const src = await dialog.locator('.region-terrain-image').getAttribute('href');
        check(await page.evaluate(async src => { const img = new Image(); img.src = src; await img.decode(); return img.naturalWidth > 0; }, src), 'desktop retry recovers the actual terrain image');
        check(attempts >= 2 && await dialog.locator('.region-load-retry').count() === 0, 'desktop retry performs a new successful image request');
        await dialog.locator('.region-explorer-close').click();
        await dialog.waitFor({ state: 'detached' });
        check(await trigger.evaluate(el => document.activeElement === el), 'desktop retry flow restores map focus');
    } finally { await page.unroute(pattern); }
}

async function testDisplayNames(context, url) {
    const page = await context.newPage();
    const source = 'https://en.wikipedia.org/wiki/Republic_of_China';
    await page.route('**/regions/content/cultural-chn-taiwan.json*', async route => {
        const response = await route.fetch();
        const data = await response.json();
        const entry = data.entries['CHN:taiwan'];
        entry.label = { en: 'Republic of China', 'zh-CN': '中华民国', 'zh-TW': '中華民國' };
        entry.description = { en: "Republic of China (ROC); R.O.C.; People's Republic of China; People’s Republic of China.",
            'zh-CN': '中华民国。中华人民共和国。', 'zh-TW': '中華民國。中華人民共和國。' };
        entry.source = source; entry.textSources = [source];
        entry.photo.alt = entry.label;
        await route.fulfill({ response, json: data });
    });
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => window.footprintsRegions.open({ map: 'china', view: 'cultural',
            region: { id: 'CHN:taiwan', visited: false }, language: 'en' }));
        const dialog = page.locator('.region-explorer[open]');
        await dialog.locator('.region-landscape-svg').waitFor();
        for (const [language, expected, preserved] of [
            ['en', 'Chinese Taipei', "People's Republic of China"],
            ['zh-CN', '中华台北', '中华人民共和国'], ['zh-TW', '中華臺北', '中華人民共和國']
        ]) {
            await page.evaluate(value => window.footprintsRegions.updateLanguage(value), language);
            await dialog.locator('.region-explorer-title').hover();
            check(await dialog.locator('.region-note-title').textContent() === expected, `${language} display name mapping`);
            const text = await dialog.locator('.region-note-description').textContent();
            check(text.includes(expected) && text.includes(preserved), `${language} display mapping preserves PRC name`);
            if (language === 'en') check(text.includes('People’s Republic of China') && !/\bROC\b|R\.O\.C\./.test(text), 'English mapping handles acronyms and curly apostrophes');
            check(await dialog.locator('.region-note-photo img').getAttribute('alt') === expected, `${language} accessible photo text mapping`);
            check(await dialog.locator('.region-note-source').getAttribute('href') === source, `${language} source URL is preserved`);
        }
    } finally { await page.close(); }
}

(async () => {
    fs.mkdirSync(OUTPUT, { recursive: true });
    if (!mapsOnly && !shellOnly && !regionsOnly) checkAssets();
    if (assetsOnly) { console.log(`PASS ${checks} asset checks`); return; }
    const { server, url } = await serve();
    const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }),
        args: ['--disable-gpu', '--no-sandbox'] });
    try {
        for (const device of shellOnly ? [] : process.argv.includes('--desktop-only') ? ['desktop'] : ['desktop', 'mobile']) {
            const context = await browser.newContext({ viewport: device === 'desktop' ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
                ...(device === 'mobile' ? { isMobile: true, hasTouch: true } : {}), reducedMotion: 'reduce' });
            const page = await context.newPage();
            page.setDefaultTimeout(20000);
            const requests = [], errors = [];
            page.on('request', request => requests.push(request.url()));
            page.on('pageerror', error => errors.push(error.message));
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                if (regionsOnly) {
                    await page.locator('#sectionDrawerToggle').click();
                    await page.locator('#sectionDrawer [data-portal-id="footprints"]').click();
                    await readyMap(page.locator('[data-atlas-card="china"]'));
                } else await testMaps(page, device, requests);
                if (!mapsOnly) {
                    if (device === 'desktop') await testRegionImageRetry(page);
                    await testRegion(page, device);
                    if (device === 'desktop') await testDisplayNames(context, url);
                    check(requests.some(url => url.includes('/regions/content/cultural-chn-wuyue.json')),
                        `${device} loads only the selected region's content shard`);
                    check(!requests.some(url => /\/regions\/content\.json(?:\?|$)/.test(url)),
                        `${device} avoids the complete encyclopedia inventory`);
                }
                check(errors.length === 0, `${device} no JavaScript exceptions: ${errors.join('; ')}`);
            } catch (error) {
                await page.screenshot({ path: path.join(OUTPUT, `${device}-failure.png`), fullPage: true });
                console.error('Browser errors:', errors);
                throw error;
            } finally { await context.close(); }
        }
        const shellContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
        try {
            const shellPage = await shellContext.newPage();
            await shellPage.goto(url.replace('?music=off', ''), { waitUntil: 'domcontentloaded' });
            const frame = shellPage.frameLocator('#sitePage');
            await frame.locator('#sectionDrawerToggle').click();
            await frame.locator('#sectionDrawer [data-portal-id="footprints"]').click();
            await frame.locator('[data-atlas-card="china"] .footprints-preview-hits').waitFor();
            await frame.locator('[data-atlas-card="china"] .footprints-map-open').click();
            await frame.locator('.footprints-map-viewer[open] .footprints-map-svg').waitFor();
            check(await frame.locator('.footprints-map-viewer[open]').isVisible(), 'music shell iframe preserves large-map integration');
            await frame.locator('.footprints-viewer-close').click();
        } finally { await shellContext.close(); }
        console.log(`PASS ${checks} checks; screenshots: ${OUTPUT}`);
    } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
