'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.resolve(__dirname, '..');
const content = JSON.parse(fs.readFileSync(path.join(root, 'site_content.json'), 'utf8'));
const group = content.life.friend_groups.find(portrait => portrait.id === 'elevator-group');
const base = process.argv[2] || 'http://127.0.0.1:8797/';
const output = path.join(root, '.render-work', 'friend-group');
const scenarios = [
    { name: 'desktop', route: 'life.html', viewport: { width: 1440, height: 1000 } },
    { name: 'mobile', route: 'life.html', viewport: { width: 390, height: 844 }, touch: true },
    { name: 'landscape', route: 'life.html', viewport: { width: 844, height: 390 }, touch: true },
    { name: 'observatory', route: 'observatory.html', viewport: { width: 1280, height: 900 } }
].filter(scenario => !process.argv[3] || scenario.name === process.argv[3]);

async function photoPoint(page, selector, point, dimensions) {
    await page.evaluate(({ selector, point, dimensions }) => {
        const portrait = document.querySelector(selector).getBoundingClientRect();
        const panel = dom.panelBody.getBoundingClientRect();
        const vertical = portrait.top + point[1] / dimensions[1] * portrait.height;
        dom.panelBody.scrollTop += vertical - (panel.top + panel.height * 0.5);
    }, { selector, point, dimensions });
    return page.evaluate(({ selector, point, dimensions }) => {
        const portrait = document.querySelector(selector).getBoundingClientRect();
        const horizontal = portrait.left + point[0] / dimensions[0] * portrait.width;
        const vertical = portrait.top + point[1] / dimensions[1] * portrait.height;
        return { horizontal, vertical, person: document.elementFromPoint(horizontal, vertical)?.closest('[data-friend-trigger]')?.dataset.friendTrigger };
    }, { selector, point, dimensions });
}

async function closeMemories(page) {
    await page.locator('.friend-memory-close').click();
    await page.locator('#friendMemoryLayer').waitFor({ state: 'hidden' });
    assert(await page.evaluate(() => !dom.panel.inert && !document.body.classList.contains('friend-memories-open')));
}

async function checkRepeatedClicks(page, friendId) {
    const events = await page.evaluate(friendId => {
        const cards = document.querySelector('.friend-memory-field').firstElementChild;
        return Array.from(document.querySelectorAll(`[data-friend-trigger="${friendId}"]`), trigger => {
            const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 });
            trigger.dispatchEvent(event);
            return { prevented: event.defaultPrevented, href: trigger.getAttribute('href'),
                samePhotos: cards === document.querySelector('.friend-memory-field').firstElementChild };
        });
    }, friendId);
    assert.deepEqual(events, Array(2).fill({ prevented: true, href: null, samePhotos: true }));
    assert.equal(page.context().pages().length, 1, 'Repeated clicks never open a homepage');
}

async function checkHomepage(page, href) {
    const homepage = page.locator('#friendMemoryHomepage');
    assert.equal(await homepage.getAttribute('href'), href || null);
    const arrow = await homepage.locator('[aria-hidden]').evaluate(element => getComputedStyle(element).display);
    if (!href) {
        assert.equal(arrow, 'none');
        return;
    }
    assert.notEqual(arrow, 'none');
    await page.context().route(href, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Friend homepage</title>' }));
    const popupPromise = page.context().waitForEvent('page');
    await homepage.click();
    const popup = await popupPromise;
    await popup.waitForURL(href);
    await popup.close();
    await page.context().unroute(href);
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    const errors = [];
    try {
        for (const scenario of scenarios) {
            const context = await browser.newContext({ viewport: scenario.viewport, isMobile: Boolean(scenario.touch),
                hasTouch: Boolean(scenario.touch), reducedMotion: 'reduce' });
            try {
                const page = await context.newPage();
                page.on('pageerror', error => errors.push(`${scenario.name}: ${error.message}`));
                page.on('response', response => {
                    if (response.url().startsWith(base) && response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
                        errors.push(`${scenario.name}: ${response.status()} ${response.url()}`);
                    }
                });
                await page.goto(new URL(scenario.route, base).href, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => window.lifeStarMap?.initialized && lifeStarMap.lastFrame > 0);
                await page.locator('#sectionDrawerToggle').click();
                await page.locator('#sectionDrawerList [data-portal-id="friends"]').click();
                await page.waitForFunction(() => state.activePortal?.id === 'friends' && state.scene === 'detail' && !lifeStarMap.flight);
                await page.locator('.friends-portrait > img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
                assert.equal(await page.locator('[data-friend-trigger][href]').count(), 0);
                assert.equal(await page.locator('#friends .friends-feature').count(), 2);
                assert.equal(await page.locator('.friends-feature').first().locator('.friend-person').count(), 2);
                assert.equal(await page.locator('.friends-feature').first().locator('.friends-portrait > img').getAttribute('src'),
                    'images/friends/yuheng-qiran.webp');
                const originalPoint = await photoPoint(page, '.friends-feature:not(.friends-feature--group) .friends-portrait', [650, 420], [1000, 970]);
                assert.equal(originalPoint.person, 'friend-qiran-zhang');
                await page.mouse.click(originalPoint.horizontal, originalPoint.vertical);
                assert(await page.locator('#friendMemoryLayer').isVisible());
                await checkRepeatedClicks(page, 'friend-qiran-zhang');
                await checkHomepage(page, 'https://positionprivacy.github.io/');
                assert.equal(await page.locator('#friendMemoryLayer .gallery-item img').getAttribute('src'), 'images/friends/qiran-01.webp');
                await closeMemories(page);
                await page.locator('.friend-name--left').click();
                await checkRepeatedClicks(page, 'friend-yuheng-wang');
                await checkHomepage(page, 'https://hendrick-wang.github.io/');
                assert.equal(await page.locator('#friendMemoryLayer .is-placeholder').count(), 3);
                await closeMemories(page);
                const feature = page.locator('[data-friend-portrait="elevator-group"]');
                assert.equal(await feature.locator('.friend-person').count(), 8);
                assert.equal(await feature.locator('.friend-name').count(), 8);
                for (const person of group.people) {
                    const point = await photoPoint(page, '[data-friend-portrait="elevator-group"] .friends-portrait',
                        person.anchor, [group.width, group.height]);
                    assert.equal(point.person, person.id, `${scenario.name}: ${person.number} has an independent clickable outline`);
                    if (scenario.touch) await page.touchscreen.tap(point.horizontal, point.vertical);
                    else await page.mouse.click(point.horizontal, point.vertical);
                    assert.equal(await page.evaluate(() => friendMemoryState.activeId), person.id);
                    const cutout = page.locator('#friendMemoryLayer .is-cutout img');
                    await cutout.evaluate(image => image.decode());
                    assert.equal(await cutout.getAttribute('src'), person.cutout);
                    await checkRepeatedClicks(page, person.id);
                    await checkHomepage(page, person.href);
                    assert.equal(await page.locator('#friendMemoryLayer .is-placeholder').count(), 2);
                    assert(await page.evaluate(() => dom.panel.inert));
                    await closeMemories(page);
                    assert(await feature.locator(`.friend-name[data-friend-trigger="${person.id}"]`)
                        .evaluate(button => button === document.activeElement));
                }
                const first = feature.locator('.friend-name').first();
                await first.focus();
                assert(await feature.locator('.friend-person').first().evaluate(person => person.classList.contains('is-highlighted')));
                await page.keyboard.press('Enter');
                for (const language of ['zh-CN', 'zh-TW', 'en']) {
                    await page.locator(`.lang-btn[data-lang="${language}"]`).click();
                    assert.equal(await page.locator('#friendMemoryTitle').textContent(),
                        await page.evaluate(({ language, name }) => i18n[language].friends_photos.replace('{name}', name),
                            { language, name: group.people[0].label[language] }));
                    assert.equal(await page.locator('#friendMemoryLayer .is-cutout img').getAttribute('alt'), group.people[0].label[language]);
                }
                const layout = await page.evaluate(() => ({
                    overflow: document.documentElement.scrollWidth > innerWidth,
                    cards: Array.from(document.querySelectorAll('#friendMemoryLayer .friend-memory'), card => {
                        const bounds = card.getBoundingClientRect();
                        return bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
                    })
                }));
                assert(!layout.overflow && layout.cards.every(Boolean), `${scenario.name}: floating cutouts fit the screen`);
                await page.screenshot({ path: path.join(output, `${scenario.name}-memories.png`) });
                await page.locator('#friendMemoryLayer .is-cutout').click();
                await page.locator('#lightbox.active').waitFor();
                await page.keyboard.press('Escape');
                assert(await page.locator('#friendMemoryLayer').isVisible());
                await page.keyboard.press('Escape');
                assert(await page.locator('#friendMemoryLayer').isHidden());
                await first.focus();
                await page.keyboard.press('Space');
                assert(await page.locator('#friendMemoryLayer').isVisible());
                await closeMemories(page);
                await photoPoint(page, '[data-friend-portrait="elevator-group"] .friends-portrait', [700, 620], [group.width, group.height]);
                await page.screenshot({ path: path.join(output, `${scenario.name}-photo.png`) });
                console.log(`PASS ${scenario.name}: original friends, eight silhouettes, cutouts, explicit homepage links, repeated clicks, keyboard, languages, lightbox and layout`);
            } finally { await context.close(); }
        }
        assert.deepEqual(errors, []);
        console.log('Friend group validation passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
