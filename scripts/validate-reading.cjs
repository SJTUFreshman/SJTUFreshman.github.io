'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.join(__dirname, '..');
const output = path.join(root, '.render-work/reading');
const lifeContent = JSON.parse(fs.readFileSync(path.join(root, 'site_content.json'), 'utf8')).life;
const collections = lifeContent.reading.collections;
for (const collection of collections) {
    if (collection.articles_file) collection.articles = JSON.parse(fs.readFileSync(path.join(root, collection.articles_file), 'utf8'));
    if (collection.translations_file) {
        const translations = JSON.parse(fs.readFileSync(path.join(root, collection.translations_file), 'utf8'));
        for (const article of collection.articles) article.translations = translations[article.id];
    }
}
const articleCount = collections.reduce((count, collection) => count + collection.articles.length, 0);
const errors = [];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname).replace(/^\/+/, '');
    const filename = path.resolve(root, relative);
    if (!filename.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
    fs.createReadStream(filename).pipe(response);
});

async function closeReader(page) {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('thoughtReader').open && !state.modalOpen);
    assert.equal(await page.evaluate(() => state.activePortal.id), 'reading');
}

async function verifyReader(page, article, language, label) {
    const reader = page.locator('#thoughtReader');
    assert(await reader.isVisible());
    assert(await reader.evaluate(dialog => dialog.open && dialog.classList.contains('is-reading')));
    assert.equal(await reader.locator('#thoughtReaderTitle').textContent(), article.translations.title[language]);
    assert.equal(await reader.locator('.thought-reader-mode').textContent(), language === 'en' ? 'Reading' : '拾文');
    assert.equal(await reader.locator('.reading-credit > a').getAttribute('href'), article.source_url);
    assert.equal(await reader.locator('.reading-body').getAttribute('lang'), language);
    assert.equal(await reader.locator('.reading-body > *').count(), article.body.length);
    for (const [index, block] of article.body.entries()) {
        const translated = article.translations.body[index];
        const rendered = reader.locator('.reading-body > *').nth(index);
        if (block.type === 'image') {
            assert.equal(await rendered.locator('img').getAttribute('alt'), translated.alt[language]);
        } else {
            const actual = await rendered.locator('[data-key]').textContent();
            assert.equal(actual, translated.text[language], `${article.id}/${language}/${index}: full translated text`);
            if (block.type === 'link') assert.equal(await rendered.locator('a').getAttribute('href'), block.url);
        }
    }
    const images = article.body.filter(block => block.type === 'image');
    assert.equal(await reader.locator('.reading-image img').count(), images.length);
    for (const [index, image] of images.entries()) {
        const visibleImage = reader.locator('.reading-image img').nth(index);
        await visibleImage.evaluate(element => element.decode());
        assert.equal(await visibleImage.getAttribute('src'), image.src);
        assert.deepEqual(await visibleImage.evaluate(element => [element.naturalWidth, element.naturalHeight]), [image.width, image.height]);
    }
    const layout = await reader.evaluate(dialog => {
        const scroll = dialog.querySelector('.thought-reader-scroll');
        const bounds = dialog.getBoundingClientRect();
        return {
            mode: getComputedStyle(dialog.querySelector('.thought-reader-article')).writingMode,
            fits: bounds.left >= -1 && bounds.top >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1,
            overflows: scroll.scrollWidth > scroll.clientWidth + 1
        };
    });
    assert(layout.fits, `${label}: reader fits the viewport`);
    assert.equal(layout.mode, language === 'zh-TW' ? 'vertical-rl' : 'horizontal-tb');
    if (language !== 'zh-TW') assert(!layout.overflows, `${label}: no horizontal overflow`);
}

async function verifyFonts(page, selector, language) {
    await page.locator(selector).first().evaluate(element => {
        const probe = document.createElement('span');
        probe.id = 'font-probe';
        probe.style.cssText = 'position:fixed;inset:100px auto auto 100px;writing-mode:horizontal-tb';
        for (const [script, value] of [
            ['latin', 'Livehouse AI SJTU 2026'],
            ['han', '中文山水中國夢餘燼學顏體'],
            ['fallback', '过这为会来无着时没个爱发写长说对点开']
        ]) {
            const span = document.createElement('span');
            span.id = `font-probe-${script}`;
            span.textContent = value;
            probe.append(span);
        }
        element.append(probe);
    });
    await page.evaluate(() => document.fonts.ready);
    const session = await page.context().newCDPSession(page);
    try {
        await session.send('DOM.enable');
        await session.send('CSS.enable');
        const { root: documentNode } = await session.send('DOM.getDocument');
        for (const [script, family] of [['latin', 'Newsreader'], ['han', 'TW-MOE-Std-Kai'], ['fallback', 'Site WenKai']]) {
            const { nodeId } = await session.send('DOM.querySelector', {nodeId: documentNode.nodeId, selector: `#font-probe-${script}`});
            const { fonts } = await session.send('CSS.getPlatformFontsForNode', {nodeId});
            assert(fonts.length > 0, `${language}/${script}: rendered glyphs exist`);
            assert(fonts.every(font => font.isCustomFont && font.familyName.includes(family)), `${language}/${script}: ${JSON.stringify(fonts)}`);
        }
    } finally {
        await page.locator('#font-probe').evaluate(element => element.remove());
        await session.detach();
    }
}

async function checkPage(browser, base, route, mobile) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    await context.route('**/*', request => new URL(request.request().url()).origin === base
        ? request.continue() : request.fulfill({ status: 200, body: '' }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
        if (response.url().includes('/images/reading/') && response.status() !== 200) errors.push(`Image HTTP ${response.status()}`);
    });
    const label = `${route.replace('.html', '')}-${mobile ? 'mobile' : 'desktop'}`;
    try {
        await page.goto(`${base}/${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.lifeStarMap?.lastFrame > 0 && !window.lifeStarMap.flight);
        assert.equal(await page.locator('#thoughts .thought-item').count(), lifeContent.thoughts.length);
        await page.locator('#sectionDrawerToggle').click();
        assert.equal(await page.locator('#sectionDrawerList [data-portal-id]').count(), 9);
        await page.locator('#sectionDrawerList [data-portal-id="reading"]').click();
        await page.waitForFunction(() => state.activePortal?.id === 'reading' && state.scene === 'detail' && !window.lifeStarMap.flight);
        for (const [language, title, constellation, badge] of [
            ['en', 'Reading', 'Corona Borealis', 'Following'],
            ['zh-CN', '拾文', '北冕座', '追更'],
            ['zh-TW', '拾文', '北冕座', '追更']
        ]) {
            await page.locator(`.lang-btn[data-lang="${language}"]`).click();
            assert.equal(await page.locator('#portalPanelTitle').textContent(), title);
            assert.equal(await page.locator('#portalPanelNames').textContent(), constellation);
            assert.equal(await page.locator('#reading .reading-badge').textContent(), badge);
            assert.equal(await page.locator('#reading .reading-pending').count(), collections.filter(collection => !collection.articles.length).length);
            assert(await page.locator('#thoughts').isHidden());
            assert.equal(await page.locator('#reading .reading-article').count(), articleCount);
            const original = page.locator('#reading .reading-original').first();
            assert.equal(await original.getAttribute('href'), collections[0].source_url);
            assert.equal(await original.getAttribute('rel'), 'noopener noreferrer');
            assert((await page.locator('#reading .reading-source').first().textContent()).includes('西多梅'));
            assert(!(await page.locator('#reading').textContent()).includes('互动：阅读 0'));
            assert(!/[图圖]源[网網][络絡]|侵[删刪]/.test((await page.locator('#reading').textContent()).replace(/[\u200b-\u200f\ufeff]/g, '')));
            assert.equal(await page.locator('#reading .reading-media-link a[href*="qpic.cn"]').count(), 0);
            assert.deepEqual(await page.locator('#reading .reading-credit > a').evaluateAll(links => links.map(link => link.href)), collections.flatMap(collection => collection.articles.map(article => article.source_url)));
            assert(await page.evaluate(() => dom.panelBody.scrollWidth <= dom.panelBody.clientWidth + 1), `${label}/${language}: no horizontal overflow`);
            const trigger = page.locator('#reading [data-reading-reader]').first();
            await trigger.click();
            await verifyReader(page, collections[0].articles[0], language, label);
            await page.screenshot({ path: path.join(output, `${label}-reader-${language}.png`) });
            const image = page.locator('#thoughtReader .reading-image img').first();
            await image.scrollIntoViewIfNeeded();
            assert(await image.evaluate(element => {
                const imageBounds = element.getBoundingClientRect();
                const scrollBounds = element.closest('.thought-reader-scroll').getBoundingClientRect();
                return imageBounds.width <= scrollBounds.width + 1 && imageBounds.height <= scrollBounds.height + 1;
            }), `${label}/${language}: the complete illustration fits inside the reader`);
            await page.screenshot({ path: path.join(output, `${label}-image-${language}.png`) });
            await page.locator('#thoughtReader .thought-reader-scroll').evaluate((element, vertical) => {
                element.scrollTo({ top: vertical ? 0 : element.scrollHeight, left: vertical ? -element.scrollWidth : 0, behavior: 'instant' });
            }, language === 'zh-TW');
            await page.waitForFunction(() => Number(document.querySelector('#thoughtReader .thought-reader-progress').getAttribute('aria-valuenow')) >= 99);
            await closeReader(page);
            assert(await trigger.evaluate(button => document.activeElement === button));
        }
        await page.locator('.lang-btn[data-lang="zh-CN"]').click();
        await page.screenshot({ path: path.join(output, `${label}.png`) });
        if (route === 'life.html' && !mobile) {
            for (const [index, article] of collections[0].articles.entries()) {
                await page.locator('#reading [data-reading-reader]').nth(index).click();
                for (const language of ['zh-CN', 'zh-TW', 'en']) {
                    await page.locator('#thoughtReader .thought-reader-language').selectOption(language);
                    await verifyReader(page, article, language, label);
                }
                await closeReader(page);
            }
        }
        await page.locator('#reading [data-reading-reader]').first().click();
        await page.locator('#thoughtReader .thought-reader-language').selectOption('zh-TW');
        await verifyReader(page, collections[0].articles[0], 'zh-TW', label);
        await page.locator('#thoughtReader .thought-reader-language').selectOption('zh-CN');
        await verifyReader(page, collections[0].articles[0], 'zh-CN', label);
        await page.locator('#thoughtReader .thought-reader-language').selectOption('en');
        await verifyReader(page, collections[0].articles[0], 'en', label);
        await page.locator('#thoughtReader .thought-reader-language').selectOption('zh-CN');
        const close = page.locator('#thoughtReader .thought-reader-close');
        await close.focus();
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => document.activeElement.className), 'thought-reader-language');
        await closeReader(page);
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => state.scene === 'roam' && !window.lifeStarMap.flight);
        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawerList [data-portal-id="thoughts"]').click();
        await page.waitForFunction(() => state.activePortal?.id === 'thoughts' && !window.lifeStarMap.flight);
        assert(await page.locator('#reading').isHidden());
        assert.equal(await page.locator('#thoughts [data-thought-reader]').count(), lifeContent.thoughts.length);
        await page.locator('[data-portal-entry="thought-2026-11-05"] [data-thought-reader]').click();
        assert(await page.locator('#thoughtReader').isVisible());
        assert.equal(await page.locator('#thoughtReader .thought-reader-mode').textContent(), '随笔');
        assert.equal(await page.locator('#thoughtReader .reading-image').count(), 0);
        assert(!(await page.locator('#thoughtReader').evaluate(dialog => dialog.classList.contains('is-reading'))));
        const essay = lifeContent.thoughts.find(item => item.id === 'thought_1105');
        const moment = lifeContent.moments.find(item => item.id === 'thought-2026-11-05');
        for (const language of ['zh-CN', 'zh-TW', 'en']) {
            await page.locator('#thoughtReader .thought-reader-language').selectOption(language);
            assert.equal(await page.locator('#thoughtReaderTitle').textContent(), moment.summary[language]);
            assert.deepEqual(await page.locator('#thoughtReader .thought-reader-body > p').allTextContents(), essay.text[language].split(/\n\s*\n/));
            assert.equal(await page.locator('#thoughtReader .thought-reader-date').textContent(), essay.date[language]);
            assert.equal(await page.locator('#thoughtReader .thought-reader-article').evaluate(element => getComputedStyle(element).writingMode), language === 'zh-TW' ? 'vertical-rl' : 'horizontal-tb');
            await page.evaluate(() => document.fonts.ready);
            await verifyFonts(page, '#thoughtReader .thought-reader-body > p', language);
            await page.screenshot({path: path.join(output, `${label}-essay-${language}.png`)});
        }
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !state.modalOpen);
        console.log(`PASS ${label}: local images, shared reader, horizontal/vertical layouts, progress, focus, sources and essay regression`);
    } finally {
        await context.close();
    }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
        const base = `http://127.0.0.1:${server.address().port}`;
        const homepage = await browser.newPage();
        await homepage.route('**/*', request => new URL(request.request().url()).origin === base ? request.continue() : request.fulfill({status: 200, body: ''}));
        await homepage.goto(`${base}/index.html`, {waitUntil: 'domcontentloaded'});
        for (const language of ['zh-CN', 'zh-TW', 'en']) {
            await homepage.evaluate(language => setLang(language), language);
            await verifyFonts(homepage, 'body', language);
        }
        await homepage.close();
        console.log('PASS homepage: actual CJK fonts and Latin Newsreader glyphs in all languages');
        for (const route of ['life.html', 'observatory.html']) {
            for (const mobile of [false, true]) await checkPage(browser, base, route, mobile);
        }
        assert.deepEqual(errors, []);
        console.log('Reading browser validation passed.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); console.error(errors); process.exitCode = 1; });
