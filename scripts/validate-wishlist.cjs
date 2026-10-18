'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8788/';
const root = path.resolve(__dirname, '..');
const content = JSON.parse(fs.readFileSync(path.join(root, 'site_content.json'), 'utf8'));
const copy = content.life.wishlist.copy;
const email = content.site.email_user + '@' + content.site.email_domain;
const output = path.join(root, '.render-work/wishlist', new URL(base).hostname);
const errors = [];
const normalise = value => value.replace(/\r\n/g, '\n');

async function settle(page) {
    await page.waitForFunction(() => window.lifeStarMap?.lastFrame > 0 && !window.lifeStarMap.flight
        && !window.lifeStarMap.currentView.moving && state.scene !== 'flying', null, { timeout: 60000 });
}

async function openFromDrawer(page) {
    await page.locator('#sectionDrawerToggle').click();
    assert.equal(await page.locator('#sectionDrawerList [data-portal-id]').count(), 8);
    await page.locator('#sectionDrawerList [data-portal-id="wishlist"]').click();
    await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'wishlist');
}

async function openFromStar(page) {
    // Keep a settled detail view as the overview, so the actual sky hit test is
    // exercised without depending on which constellations face the initial sky.
    await page.evaluate(() => { window.lifeStarMap.overview = window.lifeStarMap.snapshot(); });
    await page.keyboard.press('Escape');
    await settle(page);
    const point = await page.evaluate(() => {
        const map = window.lifeStarMap;
        return map.groups.get('wishlist').points.map(position => map.project(position)).find(point =>
            point.visible && point.x > 10 && point.x < innerWidth - 10 && point.y > 115 && point.y < innerHeight - 40
            && document.elementFromPoint(point.x, point.y)?.closest('#galaxyWorld')
            && map.portalStarAt(point.x, point.y)?.portal.id === 'wishlist');
    });
    assert(point, 'Wishlist has a clickable constellation star');
    await page.mouse.click(point.x, point.y);
    await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'wishlist');
}

async function checkLayout(page, label) {
    assert(await page.evaluate(() => {
        const panel = dom.panelBody, bounds = panel.getBoundingClientRect();
        return panel.scrollWidth <= panel.clientWidth + 1 && [...document.querySelectorAll('#wishlist button, #wishlist a, #wishlist textarea')]
            .filter(node => node.getClientRects().length).every(node => {
                const rect = node.getBoundingClientRect();
                return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1;
            });
    }), label + ': content fits the panel');
}

async function verifyMail(page, language, title) {
    const subject = (title ? copy.item_subject : copy.subject)[language].split('{activity}').join(title || '');
    const body = (title ? copy.item_body : copy.body)[language].split('{activity}').join(title || '');
    const expected = copy.recipient[language] + ': ' + email + '\n' + copy.subject_label[language] + ': ' + subject + '\n\n' + body;
    assert.equal(normalise(await page.evaluate(() => navigator.clipboard.readText())), expected);
    assert.equal(await page.locator('#wishlistDraftText').inputValue(), expected);
    const mail = new URL(await page.locator('#wishlistMailLink').getAttribute('href'));
    assert.equal(mail.protocol, 'mailto:');
    assert.equal(mail.pathname, email);
    assert.equal(mail.searchParams.get('subject'), subject);
    assert.equal(normalise(mail.searchParams.get('body')), body);
    assert.deepEqual([...mail.searchParams.keys()], ['subject', 'body']);
}

async function clipboardFallbacks(page) {
    const button = page.locator('[data-copy-wishlist=""]');
    await page.locator('.lang-btn[data-lang="zh-CN"]').click();
    // Denied async API, then a real browser copy command, including focus return.
    await page.evaluate(() => {
        window.savedClipboardWrite = navigator.clipboard.writeText.bind(navigator.clipboard);
        window.savedExecCommand = document.execCommand.bind(document);
        Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new DOMException('Blocked', 'NotAllowedError')) });
    });
    await button.click();
    await page.waitForFunction(() => wishlistMailState.status === 'copied');
    await verifyMail(page, 'zh-CN');
    assert(await button.evaluate(node => document.activeElement === node), 'Copy fallback restores focus');

    // Both copy methods unavailable: selected plain text remains usable.
    await page.evaluate(() => { document.execCommand = () => false; });
    await button.click();
    await page.waitForFunction(() => wishlistMailState.status === 'copy_failed');
    assert(await page.locator('#wishlistDraft').evaluate(node => node.open));
    assert.equal(await page.locator('#wishlistMailStatus').textContent(), copy.copy_failed['zh-CN']);
    assert(await page.locator('#wishlistDraftText').evaluate(node => document.activeElement === node
        && node.selectionStart === 0 && node.selectionEnd === node.value.length));
    await checkLayout(page, 'manual copy');
    await page.screenshot({ path: path.join(output, 'manual-copy.png') });
    await page.locator('.lang-btn[data-lang="zh-TW"]').click();
    assert.equal(await page.locator('#wishlistMailStatus').textContent(), '');
    assert((await page.locator('#wishlistDraftText').inputValue()).includes(copy.body['zh-TW']));
    assert.equal(await button.textContent(), copy.copy['zh-TW']);

    // Delayed permission responses cannot duplicate a write or label another language as copied.
    await page.evaluate(() => {
        window.wishlistWrites = 0;
        Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => {
            window.wishlistWrites++;
            return new Promise(resolve => { window.finishWishlistCopy = resolve; });
        } });
    });
    await button.click();
    await button.dispatchEvent('click');
    assert.equal(await page.evaluate(() => window.wishlistWrites), 1);
    assert.equal(await button.getAttribute('aria-disabled'), 'true');
    await page.locator('.lang-btn[data-lang="en"]').click();
    await page.evaluate(() => window.finishWishlistCopy());
    await page.waitForFunction(() => !wishlistMailState.pending);
    assert.equal(await page.locator('#wishlistMailStatus').textContent(), '');
    assert.equal(await button.getAttribute('aria-disabled'), 'false');
    await page.evaluate(() => {
        Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: window.savedClipboardWrite });
        document.execCommand = window.savedExecCommand;
    });
    console.log('PASS clipboard denial, manual selection, focus, duplicate clicks and language changes');
}

async function futureEntries(page) {
    // Render fixture entries in memory; never add fictional wishes to published data.
    const fixture = JSON.parse(execFileSync('python', ['-c', [
        'import json,site_renderer as r',
        'c=json.loads(r.CONTENT_FILE.read_text(encoding="utf-8"))',
        'c["life"]["wishlist"]["entries"]=[{"id":"test-a","title":{lang:"A & B + 雪 <夜> ? #" for lang in r.LANGS},"description":{lang:"Fixture only" for lang in r.LANGS}}, {"id":"test-b","title":{"en":"Second activity"},"description":{"en":"Another fixture"}}]',
        'r.validate_content(c)',
        'print(json.dumps({"markup":r.render_life_wishlist(c),"strings":r.wishlist_text_values(c)},ensure_ascii=True))'
    ].join('\n')], { cwd: root, encoding: 'utf8' }));
    await page.evaluate(fixture => {
        const rendered = new DOMParser().parseFromString(fixture.markup, 'text/html').querySelector('#wishlist');
        document.querySelector('#wishlist').replaceChildren(...rendered.childNodes);
        for (const [key, values] of Object.entries(fixture.strings)) for (const lang of LANGUAGES) i18n[lang][key] = values[lang] || values.en || '';
        setLang('zh-CN');
    }, fixture);
    assert.equal(await page.locator('.wishlist-item').count(), 2);
    assert.equal(await page.locator('.wishlist-empty').count(), 0);
    for (const language of ['en', 'zh-CN', 'zh-TW']) {
        await page.locator('.lang-btn[data-lang="' + language + '"]').click();
        await page.locator('[data-copy-wishlist="test-a"]').click();
        await page.waitForFunction(() => wishlistMailState.status === 'copied');
        await verifyMail(page, language, 'A & B + 雪 <夜> ? #');
        assert.equal(await page.locator('.wishlist-item h3').first().textContent(), 'A & B + 雪 <夜> ? #');
        assert(await page.evaluate(() => state.activePortal.patternHips.every(hip => {
            state.activePortal.starButtons.get(hip).click();
            return [...document.querySelectorAll('#wishlist .wishlist-item')].every(node => !node.hidden);
        })));
    }
    await page.locator('[data-copy-wishlist=""]').click();
    await page.waitForFunction(() => wishlistMailState.status === 'copied');
    await verifyMail(page, 'zh-TW');
    console.log('PASS future project cards, escaped titles, mailto encoding and complete-section star navigation');
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    try {
        for (const route of ['life.html', 'observatory.html']) for (const width of [1365, 320]) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
            const page = await context.newPage();
            const label = route + '/' + width;
            page.on('pageerror', error => errors.push(label + ': ' + error.message));
            try {
                const url = new URL(route + '?preview=20261018-wishlist', base).href;
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                await settle(page);
                await page.evaluate(() => navigator.clipboard.writeText('wishlist-test-sentinel'));
                await page.reload({ waitUntil: 'domcontentloaded' });
                await settle(page);
                assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'wishlist-test-sentinel');
                if (route === 'life.html') {
                    await page.locator('[data-portal-button="wishlist"]').waitFor({ state: 'visible' });
                    await page.screenshot({ path: path.join(output, 'overview-' + width + '.png') });
                    await page.locator('[data-portal-button="wishlist"]').click();
                    await page.waitForFunction(() => state.scene === 'detail');
                    assert.equal(await page.evaluate(() => state.activePortal.id), 'wishlist');
                    await page.keyboard.press('Escape');
                    await settle(page);
                }
                await openFromDrawer(page);
                await openFromStar(page);
                await page.evaluate(() => document.fonts.ready);
                for (const language of ['en', 'zh-CN', 'zh-TW']) {
                    await page.locator('.lang-btn[data-lang="' + language + '"]').click();
                    assert.equal(await page.locator('#portalPanelTitle').textContent(), 'Wishlist');
                    assert.equal(await page.locator('#wishlist .wishlist-item').count(), content.life.wishlist.entries.length);
                    assert(await page.evaluate(() => state.activePortal.equatorialPatternPoints?.length === 5
                        && dom.constellationMeaningText.textContent === localized(constellationStories.wishlist.reason)));
                    await page.locator('[data-copy-wishlist=""]').click();
                    await page.waitForFunction(() => wishlistMailState.status === 'copied');
                    await verifyMail(page, language);
                    assert.equal(await page.locator('#wishlistMailStatus').textContent(), copy.copied[language].replace('{email}', email));
                    assert.equal(await page.locator('#wishlistMailStatus').getAttribute('role'), 'status');
                    await checkLayout(page, label + '/' + language);
                    assert(await page.evaluate(() => state.activePortal.patternHips.every(hip => {
                        state.activePortal.starButtons.get(hip).click();
                        return state.activeStarHip === null && !document.querySelector('#wishlist').hidden;
                    })));
                    if (language === 'zh-CN') {
                        await page.evaluate(() => { dom.panelBody.scrollTop = 0; });
                        await page.screenshot({ path: path.join(output, route + '-' + width + '-panel.png') });
                        await page.locator('.wishlist-actions').scrollIntoViewIfNeeded();
                        await page.screenshot({ path: path.join(output, route + '-' + width + '-actions.png') });
                    }
                    console.log('PASS ' + label + '/' + language + ': clipboard, email fields, constellation and layout');
                }
                // Exercise the link handler without launching an external mail app or sending anything.
                await page.locator('#wishlistMailLink').evaluate(node => {
                    node.addEventListener('click', event => event.preventDefault(), { once: true });
                    node.click();
                });
                assert(await page.locator('#wishlistMailHint').isVisible());
                if (route === 'observatory.html' && width === 320) {
                    await clipboardFallbacks(page);
                    await futureEntries(page);
                }
            } finally { await context.close(); }
        }
        assert.deepEqual(errors, []);
        console.log('Wishlist verification complete. Screenshots: ' + output);
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
