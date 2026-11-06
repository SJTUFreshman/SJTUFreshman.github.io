'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.join(__dirname, '..');
const output = path.join(root, '.render-work/reading');
const collections = JSON.parse(fs.readFileSync(path.join(root, 'site_content.json'), 'utf8')).life.reading.collections;
for (const collection of collections) {
    if (collection.articles_file) collection.articles = JSON.parse(fs.readFileSync(path.join(root, collection.articles_file), 'utf8'));
}
const articleCount = collections.reduce((count, collection) => count + collection.articles.length, 0);
const errors = [];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
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

async function checkPage(browser, base, route, mobile) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    await context.route('**/*', request => new URL(request.request().url()).origin === base
        ? request.continue() : request.fulfill({ status: 200, body: '' }));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const label = `${route.replace('.html', '')}-${mobile ? 'mobile' : 'desktop'}`;
    try {
        await page.goto(`${base}/${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.lifeStarMap?.lastFrame > 0 && !window.lifeStarMap.flight);
        assert.equal(await page.locator('#thoughts .thought-item').count(), 2);
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
            assert.deepEqual(await page.locator('#reading .reading-credit > a').evaluateAll(links => links.map(link => link.href)), collections.flatMap(collection => collection.articles.map(article => article.source_url)));
            assert(await page.evaluate(() => dom.panelBody.scrollWidth <= dom.panelBody.clientWidth + 1), `${label}/${language}: no horizontal overflow`);
        }
        await page.locator('.lang-btn[data-lang="zh-CN"]').click();
        await page.screenshot({ path: path.join(output, `${label}.png`) });
        await page.locator('#reading .reading-article summary').first().click();
        const firstBody = page.locator('#reading .reading-body').first();
        assert(await firstBody.isVisible());
        assert((await firstBody.textContent()).includes(collections[0].articles[0].body.find(block => block.type === 'text').text));
        assert(await page.evaluate(() => dom.panelBody.scrollWidth <= dom.panelBody.clientWidth + 1));
        await page.screenshot({ path: path.join(output, `${label}-article.png`) });
        await page.locator('#reading .reading-article summary').first().click();
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => state.scene === 'roam' && !window.lifeStarMap.flight);
        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawerList [data-portal-id="thoughts"]').click();
        await page.waitForFunction(() => state.activePortal?.id === 'thoughts' && !window.lifeStarMap.flight);
        assert(await page.locator('#reading').isHidden());
        assert.equal(await page.locator('#thoughts [data-thought-reader]').count(), 2);
        console.log(`PASS ${label}: independent section, three languages, article sources, body text, layout and return navigation`);
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
