'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, '.render-work/friends-interactions');
const groupOnly = process.argv.includes('--group-only');
const inputBase = process.argv.find(value => /^https?:/.test(value));
const scenarios = [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844, touch: true },
    { name: 'small-mobile', width: 320, height: 640, touch: true },
    { name: 'landscape', width: 844, height: 390, touch: true },
    { name: 'observatory', width: 1280, height: 900, route: 'observatory.html' }
];
const only = scenarios.find(item => process.argv.includes(item.name))?.name;
let checks = 0;
const check = (value, text) => { assert(value, text); checks++; console.log('PASS ' + text); };
async function serve() {
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    const server = http.createServer(async (request, response) => {
        try {
            const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
            const relative = path.relative(root, file);
            if (relative.startsWith('..') || path.isAbsolute(relative)) return response.writeHead(403).end();
            if (!(await fs.promises.stat(file)).isFile()) return response.writeHead(404).end();
            response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
            fs.createReadStream(file).on('error', () => response.destroy()).pipe(response);
        } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { server, base: `http://127.0.0.1:${server.address().port}/` };
}
async function clickOutline(page, id, touch) {
    const locator = page.locator(`.friend-person[data-friend-trigger="${id}"] path`);
    await locator.scrollIntoViewIfNeeded();
    await locator.evaluate(element => element.closest('.friends-portrait').querySelector('img').decode());
    const point = await locator.evaluate(element => {
        const box = element.getBBox(), matrix = element.getScreenCTM();
        for (let y = 2; y < 18; y++) for (let x = 2; x < 18; x++) {
            const p = new DOMPoint(box.x + x / 20 * box.width, box.y + y / 20 * box.height);
            if (!element.isPointInFill(p)) continue;
            const screen = p.matrixTransform(matrix);
            if (document.elementFromPoint(screen.x, screen.y)?.closest('[data-friend-trigger]')?.dataset.friendTrigger === element.parentElement.dataset.friendTrigger) return { x: screen.x, y: screen.y };
        }
        throw new Error('Person outline has no visible clickable interior');
    });
    if (touch) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
}
async function expectHomepage(context, href, activate, label) {
    const popupPromise = context.waitForEvent('page');
    await activate(); const popup = await popupPromise;
    await popup.waitForURL(href); await popup.waitForLoadState('domcontentloaded');
    check(await popup.title() === 'Friend homepage test', label);
    check(await popup.evaluate(() => window.opener === null), label + ' isolates opener');
    await popup.close();
}
async function layout(page, scenario) {
    const result = await page.evaluate(() => {
        const layer = document.getElementById('friendMemoryLayer'), panel = document.getElementById('portalPanel');
        const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const close = layer.querySelector('.friend-memory-close').getBoundingClientRect();
        return { inline: layer.classList.contains('is-inline'), available: !panel.inert && getComputedStyle(panel).visibility === 'visible',
            overlap: overlaps(layer.getBoundingClientRect(), panel.getBoundingClientRect()), overflow: document.documentElement.scrollWidth > innerWidth + 1,
            cards: [...layer.querySelectorAll('.friend-memory')].every(card => { const r = card.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && !overlaps(r, close); }) };
    });
    check(result.available && !result.overflow && result.cards && (result.inline || !result.overlap), scenario.name + ' portrait remains usable and photos fit');
    check(result.inline === Boolean(scenario.touch), scenario.name + ' responsive photo placement');
}
async function scenarioChecks(browser, scenario, base) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, isMobile: Boolean(scenario.touch), hasTouch: Boolean(scenario.touch), reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(new URL((scenario.route || 'life.html') + '?music=off', base).href, { waitUntil: 'domcontentloaded' });
        await page.locator('#sectionDrawerToggle').click(); await page.locator('#sectionDrawer [data-portal-id="friends"]').click();
        await page.locator('#friends').waitFor({ state: 'visible' });
        const people = await page.locator(groupOnly ? '.friends-feature--group .friend-name' : '#friends .friend-name').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.friendTrigger, href: n.dataset.friendHomepage || null })));
        // Real navigation is intercepted locally: never contact a friend's site.
        for (const href of new Set(people.map(p => p.href).filter(Boolean))) await context.route(href, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Friend homepage test</title>' }));
        check(people.length === (groupOnly ? 8 : 10), scenario.name + ' all portrait targets present');
        const layer = page.locator('#friendMemoryLayer');
        for (const person of people) {
            const name = page.locator(`.friend-name[data-friend-trigger="${person.id}"]`);
            await clickOutline(page, person.id, scenario.touch); await layer.waitFor({ state: 'visible' });
            check(context.pages().length === 1 && await name.getAttribute('aria-expanded') === 'true', `${scenario.name} ${person.id} first activation previews only`);
            await layer.locator('img').evaluateAll(nodes => Promise.all(nodes.map(node => node.decode())));
            check(await layer.locator('.friend-memory').count() === 3, `${scenario.name} ${person.id} photo slots`);
            await layout(page, scenario);
            if (['friend-qiran-zhang', 'friend-elevator-04'].includes(person.id)) await page.screenshot({ path: path.join(output, `${scenario.name}-${person.id}.png`) });
            if (person.href) await expectHomepage(context, person.href, () => clickOutline(page, person.id, scenario.touch), `${scenario.name} ${person.id} second portrait activation navigates`);
            else {
                const before = await layer.locator('img').getAttribute('src'); await clickOutline(page, person.id, scenario.touch);
                check(context.pages().length === 1 && await layer.locator('img').getAttribute('src') === before, `${scenario.name} ${person.id} missing homepage keeps photos`);
            }
            await layer.locator('.friend-memory-close').click();
            check(await layer.isHidden() && await name.evaluate(el => document.activeElement === el), `${scenario.name} ${person.id} close returns focus`);
        }
        const linked = people.filter(p => p.href), first = page.locator(`.friend-name[data-friend-trigger="${linked[0].id}"]`), second = page.locator(`.friend-name[data-friend-trigger="${linked[1].id}"]`);
        await first.click(); await second.click();
        check(context.pages().length === 1 && await second.getAttribute('aria-expanded') === 'true' && await first.getAttribute('aria-expanded') === 'false', scenario.name + ' switching people previews first');
        await page.keyboard.press('Escape');
        for (const key of ['Enter', 'Space']) {
            await first.focus(); await page.keyboard.press(key);
            check(await layer.isVisible() && context.pages().length === 1 && await first.evaluate(el => document.activeElement === el), `${scenario.name} ${key} first activation preserves focus`);
            await expectHomepage(context, linked[0].href, () => page.keyboard.press(key), `${scenario.name} second ${key} navigates`);
            await page.keyboard.press('Escape');
        }
        await second.click();
        for (const language of ['en', 'zh-CN', 'zh-TW']) {
            await page.locator(`.lang-btn[data-lang="${language}"]`).click();
            const hint = await page.locator('#friendInteractionHint').textContent();
            check(language === 'en' ? hint.includes('again') : /再[點点]/.test(hint), scenario.name + ' two-step hint ' + language);
        }
        const photo = layer.locator('.gallery-item').first();
        if (await photo.count()) {
            await photo.click(); await page.locator('#lightbox.active').waitFor(); await page.keyboard.press('Escape');
            check(await layer.isVisible() && await photo.evaluate(el => document.activeElement === el), scenario.name + ' lightbox restores photo');
        }
        await page.keyboard.press('Escape');
        check(await layer.isHidden() && await page.locator('#friends').isVisible(), scenario.name + ' Escape closes photos first');
        await first.click(); await page.locator('#portalClose').click();
        check(await layer.isHidden(), scenario.name + ' leaving Friends cleans up');
        check(errors.length === 0, scenario.name + ' no JS exceptions: ' + errors.join('; '));
    } catch (error) { await page.screenshot({ path: path.join(output, scenario.name + '-failure.png'), fullPage: true }); throw error; }
    finally { await context.close(); }
}
(async () => {
    fs.mkdirSync(output, { recursive: true }); const local = inputBase ? { base: inputBase } : await serve();
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }), args: ['--enable-unsafe-swiftshader'] });
    try { for (const item of scenarios.filter(item => !only || only === item.name)) await scenarioChecks(browser, item, local.base); }
    finally { await browser.close(); local.server?.close(); }
    console.log(`PASS ${checks} Friends checks. Screenshots: ${output}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
