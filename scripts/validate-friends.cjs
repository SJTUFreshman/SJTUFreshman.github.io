'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const content = JSON.parse(fs.readFileSync(path.join(root, 'site_content.json'), 'utf8'));
const copy = content.life.friend_portrait.copy;
const output = path.join(root, '.render-work', 'friends-qa');
const base = process.argv[2] || 'http://127.0.0.1:8793/';
const scenarios = [
    { name: 'desktop', route: 'life.html', width: 1440, height: 1000 },
    { name: 'mobile', route: 'life.html', width: 390, height: 844, touch: true },
    { name: 'small-mobile', route: 'life.html', width: 320, height: 640, touch: true },
    { name: 'landscape', route: 'life.html', width: 844, height: 390, touch: true },
    { name: 'tablet', route: 'life.html', width: 768, height: 1024, touch: true },
    { name: 'observatory', route: 'observatory.html', width: 1440, height: 900 },
    { name: 'observatory-mobile', route: 'observatory.html', width: 390, height: 844, touch: true },
    { name: 'reduced-motion', route: 'life.html', width: 1440, height: 900, reduced: true }
].filter(scenario => !process.argv[3] || scenario.name === process.argv[3]);

async function openFriends(page) {
    await page.locator('#sectionDrawerToggle').click();
    await page.locator('#sectionDrawerList [data-portal-id="friends"]').click();
    await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'friends'
        && !window.lifeStarMap.flight);
    await page.locator('.friends-portrait img').evaluate(image => image.decode());
    await page.evaluate(() => document.fonts.ready);
}

async function clickPerson(page, side) {
    await page.evaluate(() => {
        const portrait = document.querySelector('.friends-portrait').getBoundingClientRect();
        const panel = dom.panelBody.getBoundingClientRect();
        const target = portrait.top + portrait.height * .42;
        if (target < panel.top + 24 || target > panel.bottom - 24) {
            dom.panelBody.scrollTop += target - (panel.top + panel.height * .5);
        }
    });
    const portrait = await page.locator('.friends-portrait').boundingBox();
    const point = { horizontal: portrait.x + portrait.width * (side === 'left' ? .34 : .65), vertical: portrait.y + portrait.height * .42 };
    assert.equal(await page.evaluate(({ horizontal, vertical }) => document.elementFromPoint(horizontal, vertical)
        ?.closest('[data-friend-trigger]')?.dataset.friendTrigger, point),
    side === 'left' ? 'friend-yuheng-wang' : 'friend-qiran-zhang', 'The person in the photograph must receive the click');
    await page.mouse.click(point.horizontal, point.vertical);
}

async function checkLayout(page, label) {
    const layout = await page.evaluate(() => {
        const portrait = document.querySelector('.friends-portrait').getBoundingClientRect();
        const close = document.querySelector('#portalClose').getBoundingClientRect();
        const overlaps = (first, second) => first.left < second.right && first.right > second.left
            && first.top < second.bottom && first.bottom > second.top;
        return {
            overflow: document.documentElement.scrollWidth > innerWidth,
            cards: Array.from(document.querySelectorAll('#friendMemoryLayer .friend-memory'), card => {
                const bounds = card.getBoundingClientRect();
                return { inside: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight,
                    coversPortrait: overlaps(bounds, portrait), coversClose: overlaps(bounds, close) };
            })
        };
    });
    assert.equal(layout.overflow, false, label + ': no horizontal page overflow');
    for (const card of layout.cards) {
        assert(card.inside, label + ': every floating card stays in the viewport');
        assert(!card.coversPortrait && !card.coversClose, label + ': cards leave people and the close control clickable');
    }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }),
        args: ['--enable-unsafe-swiftshader'] });
    const errors = [];
    try {
        for (const scenario of scenarios) {
            const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height },
                isMobile: Boolean(scenario.touch), hasTouch: Boolean(scenario.touch), reducedMotion: scenario.reduced ? 'reduce' : 'no-preference' });
            try {
                const page = await context.newPage();
                page.on('pageerror', error => errors.push(scenario.name + ': ' + error.message));
                await page.goto(new URL(scenario.route, base).href, { waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => window.lifeStarMap?.initialized && window.lifeStarMap.lastFrame > 0);
                await page.evaluate(() => {
                    window.friendLinkEvents = [];
                    document.addEventListener('click', event => {
                        const link = event.target.closest('[data-friend-trigger]');
                        if (!link) return;
                        window.friendLinkEvents.push({ id: link.dataset.friendTrigger,
                            prevented: event.defaultPrevented, href: link.getAttribute('href') });
                        event.preventDefault();
                    });
                });
                await openFriends(page);
                assert.equal(await page.locator('.friends-eyebrow').count(), 0);
                await page.locator('.lang-btn[data-lang="zh-CN"]').click();
                await page.screenshot({ path: path.join(output, scenario.name + '-portrait.png') });
                await clickPerson(page, 'left');
                assert.equal(await page.locator('#friendMemoryLayer .is-placeholder').count(), 3);
                assert.equal(await page.locator('#friendMemoryLayer .gallery-caption, #friendMemoryLayer figcaption').count(), 0);
                assert.equal((await page.evaluate(() => window.friendLinkEvents.at(-1))).prevented, true);
                await clickPerson(page, 'left');
                assert.deepEqual(await page.evaluate(() => window.friendLinkEvents.at(-1)), {
                    id: 'friend-yuheng-wang', prevented: false, href: 'https://hendrick-wang.github.io/'
                });
                await clickPerson(page, 'right');
                assert.equal((await page.evaluate(() => window.friendLinkEvents.at(-1))).prevented, true);
                assert.equal(await page.locator('#friendMemoryLayer .is-placeholder').count(), 2);
                assert.equal(await page.locator('#friendMemoryLayer .gallery-caption, #friendMemoryLayer figcaption').count(), 0);
                assert.equal(await page.locator('#friendMemoryLayer .gallery-item').count(), 1);
                await page.locator('#friendMemoryLayer img').evaluate(image => image.decode());
                for (const language of ['en', 'zh-TW', 'zh-CN']) {
                    await page.locator('.lang-btn[data-lang="' + language + '"]').click();
                    assert.equal(await page.locator('#friendInteractionHint').textContent(), copy.active[language].replace('{name}', 'Qiran Zhang'));
                    assert.equal(await page.locator('.friend-memory-close').getAttribute('aria-label'), copy.close[language]);
                    assert.equal(await page.locator('#friendMemoryLayer .is-placeholder [data-key]').first().textContent(), copy.placeholder[language]);
                }
                await page.waitForFunction(() => document.querySelector('.friend-memory-field').getAnimations()
                    .every(animation => animation.playState === 'finished'));
                await checkLayout(page, scenario.name);
                if (scenario.reduced) {
                    assert(await page.locator('.friend-memory').first().evaluate(card => getComputedStyle(card).animationName === 'none'));
                }
                await page.screenshot({ path: path.join(output, scenario.name + '-photos.png') });
                await page.locator('#friendMemoryLayer .gallery-item').click({ force: true });
                await page.locator('#lightbox.active').waitFor();
                assert.equal(await page.locator('#lightboxCaption').textContent(), '');
                await page.keyboard.press('Escape');
                assert(await page.locator('#friendMemoryLayer').isVisible());
                await clickPerson(page, 'right');
                assert.deepEqual(await page.evaluate(() => window.friendLinkEvents.at(-1)), {
                    id: 'friend-qiran-zhang', prevented: false, href: 'https://positionprivacy.github.io/'
                });
                await page.keyboard.press('Escape');
                assert(await page.locator('#friendMemoryLayer').isHidden());
                assert(await page.locator('#friends').isVisible());
                assert(await page.evaluate(() => state.scene === 'detail' && state.activePortal?.id === 'friends'));
                assert(await page.locator('.friend-name--right').evaluate(link => document.activeElement === link));
                await page.locator('.friend-name--left').focus();
                await page.keyboard.press('Enter');
                assert(await page.locator('#friendMemoryLayer').isVisible());
                await page.locator('.friend-memory-close').click();
                assert(await page.locator('#friendMemoryLayer').isHidden());
                await page.locator('.friend-name--right').focus();
                await page.keyboard.press('Space');
                assert(await page.locator('#friendMemoryLayer').isVisible());
                await page.locator('#portalClose').click();
                assert(await page.locator('#friendMemoryLayer').isHidden());
                console.log('PASS ' + scenario.name + ': two-step links, portraits, placeholders, languages, lightbox, keyboard, cleanup and layout');
            } finally {
                await context.close();
            }
        }
        assert.deepEqual(errors, []);
        console.log('Friends validation passed. Screenshots: ' + output);
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
