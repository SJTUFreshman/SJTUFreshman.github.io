'use strict';

// Full cultural-member coverage plus interaction checks for the administrative layer.
// node scripts/validate-admin-explorer.cjs [--assets-only|--ui-only] [--desktop-only] [--sample-only|--insets-only]
// PLAYWRIGHT_MODULE_PATH may point to an existing bundled Playwright installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, '.render-work/admin-explorer-validation');
const flags = new Set(process.argv.slice(2));
const LANGUAGES = ['en', 'zh-CN', 'zh-TW'];
let checks = 0;
function check(condition, message, quiet = false) {
    assert(condition, message); checks++;
    if (!quiet) console.log('PASS ' + message);
}
function read(file) { return JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8')); }
function localFile(file) {
    assert(typeof file === 'string' && file.length, 'Asset path is required');
    const absolute = path.resolve(ROOT, file);
    const relative = path.relative(ROOT, absolute);
    assert(!relative.startsWith('..') && !path.isAbsolute(relative), 'Asset escapes checkout: ' + file);
    assert(fs.statSync(absolute).isFile(), 'Missing file: ' + file);
    return absolute;
}
function cultureInventory() {
    const registry = read('assets/maps/regions/manifest.json').regions;
    const parents = new Map(), units = new Map();
    for (const [key, entry] of Object.entries(registry)) {
        if (!key.startsWith('china:cultural:')) continue;
        const detail = read('assets/maps/regions/' + entry.file);
        parents.set(detail.id, detail);
        for (const unit of detail.subregions) {
            if (!units.has(unit.id)) units.set(unit.id, { unit, parents: [] });
            units.get(unit.id).parents.push(detail.id);
        }
    }
    return { parents, units };
}
function webp(file) {
    const data = fs.readFileSync(localFile(file));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF', file);
    assert.equal(data.toString('ascii', 8, 12), 'WEBP', file);
    let width, height;
    const chunks = [];
    for (let offset = 12; offset + 8 <= data.length;) {
        const kind = data.toString('ascii', offset, offset + 4), size = data.readUInt32LE(offset + 4), start = offset + 8;
        assert(start + size <= data.length, 'Truncated WebP: ' + file);
        chunks.push(kind);
        if (kind === 'VP8X') { width = 1 + data.readUIntLE(start + 4, 3); height = 1 + data.readUIntLE(start + 7, 3); }
        if (!width && kind === 'VP8 ') { width = data.readUInt16LE(start + 6) & 0x3fff; height = data.readUInt16LE(start + 8) & 0x3fff; }
        if (!width && kind === 'VP8L') { const bits = data.readUInt32LE(start + 1); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
        offset = start + size + (size % 2);
    }
    assert(width && height, 'No image dimensions: ' + file);
    assert(!chunks.some(kind => ['EXIF', 'XMP ', 'ICCP'].includes(kind)), 'Unexpected image metadata: ' + file);
    return { width, height, bytes: data.length, hash: crypto.createHash('sha256').update(data).digest('hex') };
}
function terrainMesh(info, name) {
    assert(info && typeof info.file === 'string', name + ' real 3D mesh is required');
    const bytes = fs.readFileSync(localFile(info.file));
    assert.equal(bytes.toString('ascii', 0, 4), 'ATM1', name + ' binary mesh format');
    const vertices = bytes.readUInt32LE(4), indices = bytes.readUInt32LE(8);
    assert(vertices > 3 && vertices <= 65535 && indices > 3 && indices % 3 === 0 && bytes.length === 12 + vertices * 24 + indices * 2, name + ' valid mesh length');
    let zmin = Infinity, zmax = -Infinity;
    for (let i = 0; i < vertices * 3; i++) {
        const position = bytes.readFloatLE(12 + i * 4), normal = bytes.readFloatLE(12 + vertices * 12 + i * 4);
        assert(Number.isFinite(position) && Number.isFinite(normal), name + ' finite geometry');
        if (i % 3 === 2) { zmin = Math.min(zmin, position); zmax = Math.max(zmax, position); }
    }
    for (let i = 0; i < indices; i++) assert(bytes.readUInt16LE(12 + vertices * 24 + i * 2) < vertices, name + ' valid triangle index');
    check(zmax > zmin, name + ' retained real mesh depth', true);
    for (const [id, point] of Object.entries(info.points || {})) check(Array.isArray(point) && point.length === 3 && point.every(Number.isFinite), name + '/' + id + ' finite 3D photo anchor', true);
    return info.file;
}
function articleCheck(id, article) {
    check(article && LANGUAGES.every(lang => typeof article.label?.[lang] === 'string' && article.label[lang].trim()), id + ' localized names', true);
    check(LANGUAGES.every(lang => typeof article.description?.[lang] === 'string' && article.description[lang].trim().length > 15), id + ' substantive trilingual article', true);
    check(Boolean(article.source || article.textSources?.length), id + ' encyclopedia source', true);
    check(Boolean(article.photo?.src && article.photo?.credit && article.photo?.source && article.photo?.license), id + ' photograph and attribution', true);
    localFile(article.photo.src);
}
function checkAssets() {
    const { parents, units } = cultureInventory();
    const registry = read('assets/maps/administrative/manifest.json').units;
    const imageFiles = new Set(), meshFiles = new Set();
    let bytes = 0, anchors = 0;
    check(parents.size === 47, 'administrative inventory is derived from all 47 cultural parents');
    check([...units.keys()].every(id => registry[id]), `all ${units.size} unique cultural members have an administrative entry`);
    for (const [id] of units) {
        const reference = registry[id], document = read(reference.file || reference);
        check(document.id === id, id + ' manifest identity', true);
        check(document.views && ['whole', 'urban'].every(view => document.views[view]), id + ' both required views', true);
        const content = read(localFile(document.content_file)).entries;
        articleCheck(id, content[id]);
        const focus = content[id].urbanFocus || document.urbanFocus || document.views.urban.focus;
        check(focus && Array.isArray(focus.lngLat) && focus.lngLat.length === 2 && focus.lngLat.every(Number.isFinite), id + ' verified urban/settlement location', true);
        check(Boolean(focus.kind && focus.coordinateSource && focus.source), id + ' urban focus provenance and kind', true);
        check(LANGUAGES.every(lang => focus.definition?.[lang]?.trim()), id + ' urban scope definition in all languages', true);
        const views = [];
        for (const viewName of ['whole', 'urban']) {
            const view = document.views[viewName];
            meshFiles.add(terrainMesh(view.mesh, `${id}/${viewName}`));
            const placeIds = new Set((view.places || []).map(place => place.id));
            check(Object.keys(view.mesh.points || {}).every(placeId => placeIds.has(placeId)), `${id}/${viewName} 3D anchors belong to the current photo guide`, true);
            if (!view.insets?.length) check(Object.keys(view.mesh.points || {}).length > 0, `${id}/${viewName} real 3D surface retains a local photo anchor`, true);
            const image = webp(view.image);
            check(image.width === view.width && image.height === view.height && view.width >= 800 && view.height >= 600, `${id}/${viewName} native dimensions`, true);
            check(Boolean(view.outline && view.projection && view.source_archive && view.light && view.material), `${id}/${viewName} independent terrain inputs`, true);
            localFile(view.source_archive);
            check(Array.isArray(view.extent_m) && view.extent_m.length === 4 && view.extent_m.every(Number.isFinite) &&
                view.extent_m[2] > view.extent_m[0] && view.extent_m[3] > view.extent_m[1], `${id}/${viewName} geographic extent`, true);
            check(Array.isArray(view.places) && view.places.length > 0, `${id}/${viewName} local geographic photo anchors`, true);
            for (const place of view.places) {
                check(Array.isArray(place.lngLat) && place.lngLat.length === 2 && place.lngLat.every(Number.isFinite), `${id}/${viewName}/${place.id} geographic anchor`, true);
                check(Array.isArray(place.point) && place.point.length === 2 && place.point.every(Number.isFinite) &&
                    place.point[0] >= 0 && place.point[0] <= view.width && place.point[1] >= 0 && place.point[1] <= view.height,
                    `${id}/${viewName}/${place.id} visible photo anchor`, true);
                articleCheck(place.id, content[place.content_id || place.id]);
                anchors++;
            }
            for (const inset of view.insets || []) {
                meshFiles.add(terrainMesh(inset.mesh, `${id}/${viewName}/${inset.id}`));
                const insetIds = new Set((inset.places || []).map(place => place.id));
                check(Object.keys(inset.mesh.points || {}).every(placeId => insetIds.has(placeId)), `${id}/${inset.id} 3D anchors belong to this island's current photo guide`, true);
                check(view.mesh.parts?.some(part => part.file === inset.mesh.file), `${id}/${inset.id} can be selected as an independent 3D part`, true);
            }
            if (!imageFiles.has(view.image)) { bytes += image.bytes; imageFiles.add(view.image); }
            views.push({ view, image });
        }
        check(views[0].view.image !== views[1].view.image && views[0].image.hash !== views[1].image.hash, id + ' two distinct rendered landscapes', true);
        check(views[0].view.source_archive !== views[1].view.source_archive, id + ' independently retained terrain inputs', true);
        check(JSON.stringify(views[0].view.extent_m) !== JSON.stringify(views[1].view.extent_m) ||
            views[0].view.projection !== views[1].view.projection, id + ' urban view has its own geographic framing', true);
    }
    for (const [id, expected] of [['TW-KIN', ['CHN:min-south', 'CHN:taiwan']], ['TW-LIE', ['CHN:min-east', 'CHN:taiwan']], ['TWN:Wuqiu', ['CHN:puxian', 'CHN:taiwan']]]) {
        check(expected.every(parent => units.get(id)?.parents.includes(parent)), id + ' shared cultural memberships remain intact');
    }
    // Cultural display members split out these islands, but a county/city's
    // administrative whole must still include its actual island dependencies.
    for (const [id, dependencies] of [['TW-KIN', ['TWN:Wuqiu']], ['TW-KHH', ['TWN:Dongsha', 'TWN:Taiping']]]) {
        const document = read(registry[id].file || registry[id]), whole = document.views.whole;
        check(dependencies.every(child => whole.included_units?.includes(child)), id + ' whole territory includes its offshore dependencies');
        for (const child of dependencies) {
            const inset = whole.insets?.find(item => item.id === child), frame = whole.inset_frames?.find(item => item.id === child);
            check(inset && frame && LANGUAGES.every(lang => frame.title?.[lang]), `${id}/${child} has a named whole-territory inset`);
            check(inset.projection && inset.extent_m?.length === 4 && inset.outline && inset.light && inset.material, `${id}/${child} independent inset terrain inputs`, true);
            localFile(inset.source_archive);
            check(inset.source_archive !== whole.source_archive && whole.inset_sources?.includes(inset.source_archive), `${id}/${child} retained independent terrain archive`, true);
            const image = webp(inset.image);
            check(image.width === inset.width && image.height === inset.height && inset.image !== whole.image, `${id}/${child} independent inset render`, true);
            check([frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) && frame.x >= 0 && frame.y >= 0 &&
                frame.width > 0 && frame.height > 0 && frame.x + frame.width <= whole.width && frame.y + frame.height <= whole.height,
                `${id}/${child} visible inset frame`, true);
        }
    }
    check(imageFiles.size === units.size * 2, 'every administrative unit has two independently addressed images');
    check(meshFiles.size === units.size * 2 + 11, 'every administrative view and offshore inset has its own real 3D mesh');
    console.log(`Asset coverage: ${parents.size} cultural regions, ${units.size} administrative units, ${imageFiles.size} terrain images, ${meshFiles.size} real meshes, ${bytes.toLocaleString()} image bytes, ${anchors} anchors.`);
}
async function serve() {
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
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
        const bounds = element.getBBox(), matrix = element.getScreenCTM();
        for (const step of [2, 8, 20]) for (let iy = 1; iy < step; iy++) for (let ix = 1; ix < step; ix++) {
            const local = new DOMPoint(bounds.x + bounds.width * ix / step, bounds.y + bounds.height * iy / step);
            if (!element.isPointInFill(local)) continue;
            const point = local.matrixTransform(matrix), hit = document.elementFromPoint(point.x, point.y);
            if (hit === element || element.contains(hit)) return { x: point.x, y: point.y };
        }
        throw new Error('No visible interior: ' + element.dataset.unit);
    });
}
async function culture(page, id) {
    const trigger = page.locator(`#chinaMap [data-hit-view="cultural"] [data-region-id="${id}"]`);
    await trigger.focus(); await trigger.press('Enter');
    const dialog = page.locator('.region-explorer[open]');
    await dialog.locator('.region-landscape-svg').waitFor();
    await dialog.locator('.region-explorer-close').focus();
    return dialog;
}
async function verifyAdmin(page, dialog, id, device) {
    await dialog.locator('.admin-explorer-layout').waitFor();
    check(await page.locator('.region-explorer[open]').count() === 1, `${device} ${id} uses one region dialog`);
    check(await dialog.evaluate(el => el.contains(document.activeElement)), `${device} ${id} keyboard focus remains in the current dialog`);
    check(await dialog.locator('[data-admin-view="whole"]').count() === 1 && await dialog.locator('[data-admin-view="urban"]').count() === 1, `${device} ${id} whole and urban panels both exist`);
    const images = await dialog.locator('.admin-model-svg .region-terrain-image').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
    check(images.length === 2 && images[0] !== images[1], `${device} ${id} displays two distinct model images`);
    check(await page.evaluate(async sources => (await Promise.all(sources.map(async src => { const image = new Image(); image.src = src; await image.decode(); return image.naturalWidth >= 800; }))).every(Boolean), images), `${device} ${id} both terrain images actually decode`);
    for (const view of ['whole', 'urban']) {
        const panel = dialog.locator(`[data-admin-view="${view}"]`);
        await panel.scrollIntoViewIfNeeded();
        check(await panel.isVisible() && await panel.locator('.admin-photo-leader').count() > 0, `${device} ${id}/${view} visible with photo leaders`);
        const photo = panel.locator('.admin-map-photo img').first();
        await photo.scrollIntoViewIfNeeded();
        await photo.evaluate(async element => { await element.decode(); });
    }
    const notes = dialog.locator('.admin-note-content');
    const title = await notes.locator('.region-note-title').textContent();
    check((await notes.locator('.region-note-description').textContent()).trim().length > 20, `${device} ${id} encyclopedia introduction is present`);
    check(await notes.locator('.region-note-source').count() === 1, `${device} ${id} encyclopedia citation`);
    const cards = dialog.locator('.admin-sight-card');
    check(await cards.count() > 0, `${device} ${id} landscape gallery`);
    await cards.first().click();
    check(await notes.locator('.region-note-description').textContent() && await notes.locator('.region-note-photo img').count() === 1,
        `${device} ${id} selecting a photograph opens its article and photo`);
    check(await cards.first().getAttribute('aria-pressed') === 'true', `${device} ${id} selected photograph has accessible state`);
    await dialog.locator('.admin-overview-button').click();
    check(await notes.locator('.region-note-title').textContent() === title, `${device} ${id} returns to the administrative introduction`);
    check(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${device} ${id} no horizontal overflow`);
}
async function returnParent(page, dialog, parentTitle, unitId, device, method = 'escape') {
    if (method === 'button') await dialog.locator('.region-explorer-close').click(); else await page.keyboard.press('Escape');
    await dialog.locator('.region-landscape-svg').waitFor();
    check(await page.locator('.region-explorer[open]').count() === 1 && !await dialog.evaluate(el => el.classList.contains('is-administrative')), `${device} returns without stacking or closing the cultural dialog`);
    check(await dialog.locator('.region-explorer-title').textContent() === parentTitle, `${device} returns to the actual source culture`);
    check(await dialog.evaluate((el, id) => el.contains(document.activeElement) && document.activeElement.dataset.unit === id, unitId), `${device} restores the originating unit's focus`);
    await dialog.locator('.region-explorer-close').focus();
    const wholeTitle = await dialog.locator('.region-note-title').textContent();
    const unit = dialog.locator(`.region-district[data-unit="${unitId}"]`);
    const point = await pointInside(unit);
    await page.mouse.move(point.x, point.y);
    check(await dialog.locator('.region-note-title').textContent() !== wholeTitle, `${device} culture hover still works after returning`);
    await dialog.locator('.region-explorer-title').hover();
    check(await dialog.locator('.region-note-title').textContent() === wholeTitle, `${device} leaving hover still restores cultural information`);
}
async function testInsets(page, device) {
    for (const [parent, id, count] of [['CHN:qiong', '460300', 8], ['CHN:taiwan', 'TW-KHH', 2]]) {
        const dialog = await culture(page, parent);
        await dialog.locator(`.region-district-tabs button[data-unit="${id}"]`).click();
        await dialog.locator('.admin-explorer-layout').waitFor();
        const panel = dialog.locator('[data-admin-view="whole"]');
        check(await panel.locator('.region-inset-frame').count() === count, `${device} ${id} all independent island insets appear`);
        const legend = panel.locator('.admin-inset-key');
        check(await legend.locator('li').count() === count, `${device} ${id} every island inset has a readable HTML name`);
        check(await legend.locator('li').evaluateAll(items => items.every(item => item.textContent.trim() && parseFloat(getComputedStyle(item).fontSize) >= 10)), `${device} ${id} inset names retain legible text sizing`);
        check(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1) && await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${device} ${id} island models and legends have no horizontal overflow`);
        const images = await dialog.locator('.admin-model-svg .region-terrain-image').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
        await page.evaluate(async sources => { await Promise.all(sources.map(async src => { const image = new Image(); image.src = src; await image.decode(); })); }, images);
        await panel.scrollIntoViewIfNeeded();
        await panel.screenshot({ path: path.join(OUTPUT, `${device}-${id}-insets.png`) });
        if (id === '460300') check(await panel.locator('.admin-model-svg circle').count() >= 8, `${device} Sansha preserves true geographic positions beside enlarged island views`);
        await page.keyboard.press('Escape'); await dialog.locator('.region-landscape-svg').waitFor();
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    }
}
async function testDevice(browser, url, device) {
    const mobile = device === 'mobile';
    const sampleOnly = flags.has('--sample-only'), firstUnit = sampleOnly ? '320500' : '320200';
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.locator('.lang-btn[data-lang="zh-TW"]').click();
        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawer [data-portal-id="footprints"]').click();
        await page.locator('#chinaMap .footprints-preview-hits').waitFor();
        if (flags.has('--insets-only')) {
            await testInsets(page, device);
            check(errors.length === 0, `${device} island models have no JavaScript exceptions: ${errors.join('; ')}`);
            return;
        }
        const dialog = await culture(page, 'CHN:wuyue');
        const parentTitle = await dialog.locator('.region-explorer-title').textContent();
        check(!requests.some(value => value.includes('/maps/administrative/')), `${device} administrative assets are deferred until a unit is opened`);
        const unit = dialog.locator(`.region-district[data-unit="${firstUnit}"]`);
        if (mobile) { const point = await pointInside(unit); await page.touchscreen.tap(point.x, point.y); }
        else { const point = await pointInside(unit); await page.mouse.click(point.x, point.y); }
        await verifyAdmin(page, dialog, firstUnit, device);
        await dialog.locator('.admin-landscapes').scrollIntoViewIfNeeded();
        await dialog.screenshot({ path: path.join(OUTPUT, `${device}-${firstUnit}.png`) });
        await returnParent(page, dialog, parentTitle, firstUnit, device);
        if (sampleOnly) {
            await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
            check(errors.length === 0, `${device} sample no JavaScript exceptions: ${errors.join('; ')}`);
            return;
        }
        // A not-yet-visited member must work too; the new scope is every cultural member.
        const unvisited = dialog.locator('.region-district-tabs button[data-unit="320400"]');
        await unvisited.focus(); await unvisited.press('Enter');
        await verifyAdmin(page, dialog, '320400', device);
        await returnParent(page, dialog, parentTitle, '320400', device, 'button');
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
        check(await page.locator('#chinaMap [data-region-id="CHN:wuyue"]').evaluateAll(elements => elements.includes(document.activeElement)), `${device} closing culture returns to the original map control`);
        if (!mobile) {
            // Shared islands must return to the parent through which they were entered.
            for (const parent of ['CHN:min-south', 'CHN:taiwan']) {
                const region = await culture(page, parent), heading = await region.locator('.region-explorer-title').textContent();
                await region.locator('.region-district-tabs button[data-unit="TW-KIN"]').click();
                await verifyAdmin(page, region, 'TW-KIN', device);
                await returnParent(page, region, heading, 'TW-KIN', device, 'button');
                await page.keyboard.press('Escape'); await region.waitFor({ state: 'detached' });
            }
            const region = await culture(page, 'CHN:mongolian-steppe');
            await region.locator('.region-district-tabs button[data-unit="MNG"]').focus(); await page.keyboard.press('Space');
            await verifyAdmin(page, region, 'MNG', device);
            await page.keyboard.press('Escape'); await region.locator('.region-landscape-svg').waitFor();
            await page.keyboard.press('Escape'); await region.waitFor({ state: 'detached' });
            const islands = await culture(page, 'CHN:taiwan');
            await islands.locator('.region-district-tabs button[data-unit="TWN:Dongsha"]').click();
            await verifyAdmin(page, islands, 'TWN:Dongsha', device);
            const islandTitle = await islands.locator('[data-admin-view="urban"] h3').textContent();
            check(!/主城[区區]|Urban core/i.test(islandTitle), 'uninhabited/offshore island close-up does not invent an urban core');
            await islands.screenshot({ path: path.join(OUTPUT, 'desktop-island.png') });
            await page.keyboard.press('Escape'); await islands.locator('.region-landscape-svg').waitFor();
            await page.keyboard.press('Escape'); await islands.waitFor({ state: 'detached' });
        }
        await testInsets(page, device);
        check(!requests.some(value => /\/maps\/regions\/content\.json(?:\?|$)/.test(value)), `${device} retains on-demand regional content loading`);
        check(errors.length === 0, `${device} no JavaScript exceptions: ${errors.join('; ')}`);
    } catch (error) {
        await page.screenshot({ path: path.join(OUTPUT, `${device}-failure.png`), fullPage: true });
        throw error;
    } finally { await context.close(); }
}
async function main() {
    if (!flags.has('--ui-only')) checkAssets();
    if (!flags.has('--assets-only')) {
        fs.mkdirSync(OUTPUT, { recursive: true });
        const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
        const { server, url } = await serve();
        const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }), args: ['--enable-unsafe-swiftshader'] });
        try { for (const device of flags.has('--desktop-only') ? ['desktop'] : ['desktop', 'mobile']) await testDevice(browser, url, device); }
        finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
    }
    console.log(`PASS ${checks} administrative atlas checks; screenshots: ${OUTPUT}`);
}
module.exports = { serve, culture };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
