'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.render-work/home-news');
const content = JSON.parse(fs.readFileSync(path.join(root, 'site_content.json'), 'utf8'));
const errors = [];
const mimeTypes = {
    '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
    '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.json': 'application/json'
};
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filename)] || 'application/octet-stream' });
    fs.createReadStream(filename).pipe(response);
});

async function verifyClosed(page, trigger) {
    await page.waitForFunction(() => !document.getElementById('newsJournal').open);
    await page.waitForFunction(() => !document.documentElement.classList.contains('news-journal-open'));
    assert(await trigger.evaluate(element => document.activeElement === element), 'Closing restores the news trigger focus');
    assert.equal(await page.locator('#newsJournalContent > *').count(), 0);
}

async function run() {
    fs.mkdirSync(output, { recursive: true });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = 'http://127.0.0.1:' + server.address().port;
    const browser = await chromium.launch({
        headless: true,
        ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' })
    });
    try {
        for (const [label, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844], ['narrow', 320, 720]]) {
            const context = await browser.newContext({
                viewport: { width, height },
                isMobile: label !== 'desktop',
                hasTouch: label !== 'desktop',
                reducedMotion: label === 'narrow' ? 'reduce' : 'no-preference',
                permissions: ['clipboard-read', 'clipboard-write']
            });
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(label + ': ' + error.message));
            page.on('response', response => {
                if (response.url().startsWith(baseUrl) && response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
                    errors.push(response.status() + ' ' + response.url());
                }
            });
            await page.route('https://api.open-meteo.com/**', route => route.fulfill({
                json: { current: { temperature_2m: 21, weather_code: 0 } }
            }));
            await page.route('https://clustrmaps.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
            await page.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
            await page.goto(baseUrl + '/index.html', { waitUntil: 'networkidle' });
            await page.evaluate(() => document.fonts.ready);
            assert.equal(await page.locator('#publications .pub-item').count(), 6);
            assert.deepEqual(await page.locator('#publications .pub-title-text').allTextContents(), content.home.publications.map(paper => paper.title));
            const devices = page.locator('.pub-item').filter({ hasText: 'DevicesWorld:' });
            assert.equal(await devices.locator('a').first().getAttribute('href'), 'https://arxiv.org/abs/2607.13465');
            assert.equal(await devices.locator('a').nth(1).getAttribute('href'), 'https://github.com/AgenticOrgLab/DevicesWorld');
            assert.equal(await devices.locator('.pub-authors b').textContent(), 'Runde Yang');
            if (label === 'desktop') {
                for (const title of ['DevicesWorld:', 'AppCopilot:']) {
                    await page.locator('.pub-item').filter({ hasText: title }).getByRole('button', { name: 'Cite' }).click();
                    assert((await page.evaluate(() => navigator.clipboard.readText())).includes(title));
                    assert(await page.locator('.pub-item').filter({ hasText: title }).getByRole('button', { name: 'Copied' }).isDisabled());
                }
            }
            for (const language of ['en', 'zh-CN', 'zh-TW']) {
                await page.evaluate(language => setLang(language), language);
                assert.equal(await page.locator('[data-key="title_pubs"]').textContent(), content.home.labels[language].title_pubs);
                assert.equal(await page.locator('[data-key="nav_pubs"]').textContent(), content.home.labels[language].nav_pubs);
                assert.equal(await page.locator('#newsList button').count(), content.home.news.length);
                for (const entry of content.home.news) {
                    const trigger = page.locator('[data-news-entry="' + entry.id + '"]');
                    assert.equal(await trigger.locator('.news-text').textContent(), entry.text[language]);
                    await trigger.click();
                    const dialog = page.getByRole('dialog');
                    await page.waitForFunction(() => document.getElementById('newsJournal').open);
                    assert.equal(await dialog.locator('h2').textContent(), entry.text[language]);
                    assert.equal(await dialog.locator('time').textContent(), entry.date);
                    assert.equal(await dialog.locator('.journal-body').textContent(), content.home.labels[language].journal_body);
                    assert.equal(await dialog.locator('img').getAttribute('alt'), content.home.labels[language].journal_image_alt);
                    await page.waitForFunction(() => {
                        const picture = document.querySelector('#newsJournal img');
                        return picture.complete && picture.naturalWidth > 0;
                    });
                    assert(await dialog.locator('.journal-demo').isVisible());
                    assert(await dialog.locator('.journal-doodle').isVisible());
                    assert(await page.evaluate(() => document.documentElement.classList.contains('news-journal-open')));
                    await page.keyboard.press('Tab');
                    await page.keyboard.press('Tab');
                    assert(await page.evaluate(() => document.getElementById('newsJournal').contains(document.activeElement)), 'Tab stays inside the journal');
                    const dimensions = await dialog.evaluate(element => {
                        const bounds = element.getBoundingClientRect();
                        return { width: element.clientWidth, scrollWidth: element.scrollWidth, left: bounds.left, right: bounds.right };
                    });
                    assert(dimensions.scrollWidth <= dimensions.width + 1, label + ': no horizontal journal overflow');
                    assert(dimensions.left >= 0 && dimensions.right <= width + 1, label + ': journal stays inside the viewport');
                    if (language === 'zh-CN') {
                        await dialog.evaluate(element => element.scrollTop = 0);
                        await page.screenshot({ path: path.join(output, label + '-' + entry.id + '.png'), animations: 'disabled' });
                    }
                    await page.keyboard.press('Escape');
                    await verifyClosed(page, trigger);
                }
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
            }
            const first = page.locator('[data-news-entry]').first();
            await first.focus();
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => document.getElementById('newsJournal').open);
            await page.evaluate(() => setLang('zh-CN'));
            assert.equal(await page.locator('#newsJournal .journal-title').textContent(), '万圣节party！👻');
            await page.locator('.journal-close').click();
            await verifyClosed(page, first);
            await first.focus();
            await page.keyboard.press('Space');
            await page.waitForFunction(() => document.getElementById('newsJournal').open);
            await page.locator('.journal-body').click();
            assert(await page.locator('#newsJournal').evaluate(element => element.open), 'Clicking the journal text keeps it open');
            await page.mouse.click(2, 2);
            await verifyClosed(page, first);
            if (label !== 'desktop') {
                await first.click();
                await page.locator('.journal-footer').scrollIntoViewIfNeeded();
                assert(await page.locator('.journal-footer').isVisible(), 'Mobile readers can reach the end');
                assert(await page.locator('.journal-close').evaluate(element => {
                    const bounds = element.getBoundingClientRect();
                    return bounds.top >= 0 && bounds.bottom <= window.innerHeight;
                }), 'The mobile close button remains in view while scrolling');
                if (label === 'narrow') {
                    assert.equal(await page.locator('#newsJournal').evaluate(element => getComputedStyle(element).animationName), 'none');
                }
                await page.locator('.journal-close').click();
                await verifyClosed(page, first);
            }
            await page.locator('#news').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(output, label + '-homepage.png'), fullPage: true });
            await context.close();
            console.log('PASS ' + label + ': six papers, three languages, journal content, focus, dismissal, layout');
        }
        assert.deepEqual(errors, [], 'No page errors or failed local assets');
    } finally {
        await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

run().catch(error => {
    console.error(error);
    server.close();
    process.exitCode = 1;
});
