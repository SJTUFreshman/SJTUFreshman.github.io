'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.render-work/home-loading');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
    '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
    fs.createReadStream(filename).pipe(response);
});

function latch() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    return { promise, release };
}

async function createContext(browser, base, options = {}) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', ...options });
    await context.addInitScript(() => {
        localStorage.setItem('preferredLang', 'zh-CN');
        window.__homeReadyAt = 0;
        window.addEventListener('stellar:destination-ready', () => { window.__homeReadyAt = performance.now(); });
    });
    await context.route('**/*', route => new URL(route.request().url()).origin === base
        ? route.continue() : route.fulfill({ status: 200, body: '' }));
    return context;
}

async function verifyFontIndependence(browser, base, arrival, failedFonts) {
    const context = await createContext(browser, base);
    const fonts = latch();
    const runtime = latch();
    const journal = latch();
    const requests = [];
    const heldFonts = [];
    const errors = [];
    if (arrival) {
        await context.addInitScript(() => sessionStorage.setItem('runde:route-transition:v1',
            JSON.stringify({ v: 1, from: 'life', to: 'index', mode: 'home', at: Date.now() })));
        await context.route('**/assets/stellar-transit.js*', async route => {
            await runtime.promise;
            await route.continue();
        });
    }
    await context.route('**/assets/news-journal.js*', async route => {
        await journal.promise;
        await route.continue();
    });
    await context.route(/\/fonts\/.*-home-subset\.woff2/, async route => {
        heldFonts.push(route.request().url());
        if (failedFonts) await route.abort('failed');
        else {
            await fonts.promise;
            await route.continue();
        }
    });
    const page = await context.newPage();
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    try {
        const firstFontRequest = page.waitForRequest(/\/fonts\/.*-home-subset\.woff2/);
        await page.goto(`${base}/index.html?music=off`, { waitUntil: 'commit' });
        await page.waitForFunction(() => typeof setLang === 'function');
        if (arrival) {
            assert.equal(await page.evaluate(() => Boolean(window.StellarTransit)), false, 'Inline initialization precedes the delayed runtime');
            runtime.release();
        }
        await page.waitForFunction(() => window.StellarTransit?.destinationReady
            && !document.querySelector('.stellar-transit-layer')
            && !document.documentElement.classList.contains('stellar-arrival-pending'), null, { timeout: 5000 });
        await firstFontRequest;
        const state = await page.evaluate(() => ({ readyAt: window.__homeReadyAt, fonts: document.fonts.status,
            document: document.readyState, busy: document.documentElement.classList.contains('stellar-transit-active'),
            visible: document.querySelector('.hero').checkVisibility(), inert: document.querySelector('.container').inert }));
        assert(heldFonts.length > 0, 'CJK font requests were actually intercepted');
        if (!failedFonts) assert.equal(state.fonts, 'loading', 'The page is available while fonts remain pending');
        assert.equal(state.document, 'interactive', 'Arrival does not wait for unrelated deferred scripts or DOMContentLoaded');
        assert.equal(state.busy, false);
        assert.equal(state.inert, false);
        assert(state.visible && state.readyAt > 0);
        assert(!requests.some(url => /\/(?:AppCopilot|TeachMaster)\.png|\/card-thumbs\/|\/pet-summon\.js|clustrmaps\.com/.test(url)), 'Noncritical resources stay deferred at the top');
        assert(!requests.some(url => /\/fonts\/.*-site-subset\.woff2/.test(url)), 'Homepage never requests the whole-site CJK fonts');
        await page.getByRole('button', { name: '繁', exact: true }).click();
        assert.equal(await page.locator('html').getAttribute('lang'), 'zh-TW', 'Language controls work before fonts finish');
        fonts.release();
        journal.release();
        await page.waitForLoadState('domcontentloaded');
        await page.evaluate(() => document.fonts.ready);
        assert.deepEqual(errors, []);
        console.log(`PASS arrival=${arrival}, failedFonts=${failedFonts}: usable at ${Math.round(state.readyAt)} ms while other resources remain pending`);
        return { arrival, failedFonts, ...state };
    } finally {
        fonts.release();
        runtime.release();
        journal.release();
        await context.close();
    }
}

async function verifyDeferredResources(browser, base, width) {
    const context = await createContext(browser, base, { viewport: { width, height: 844 } });
    const page = await context.newPage();
    const requests = [];
    const errors = [];
    page.on('request', request => requests.push(request.url()));
    page.on('pageerror', error => errors.push(error.message));
    try {
        await page.goto(`${base}/index.html?music=off`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(output, `first-screen-${width}.png`) });
        assert(!requests.some(url => /\/(?:AppCopilot|TeachMaster)\.png|\/card-thumbs\/|\/pet-summon\.js|clustrmaps\.com/.test(url)));
        const button = page.locator('#summonBtn');
        await button.focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('summonMenu').classList.contains('show'));
        assert(await page.locator('#summonMenu').evaluate(element => element.contains(document.activeElement)), 'First keyboard activation preserves menu focus');
        await page.keyboard.press('Escape');
        assert.equal(await button.getAttribute('aria-expanded'), 'false');
        await button.click();
        assert.equal(await button.getAttribute('aria-expanded'), 'true');
        assert.equal(requests.filter(url => /\/pet-summon\.js/.test(url)).length, 1, 'Pet controls load once on first use');
        await page.keyboard.press('Escape');
        await page.locator('#projects').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('.project-img-wrap img')].every(image => image.complete && image.naturalWidth > 0));
        await page.locator('#lifePortalLink').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('.life-card img')].every(image => image.complete && image.naturalWidth > 0));
        await page.locator('.footer').scrollIntoViewIfNeeded();
        await page.waitForFunction(() => Boolean(document.getElementById('clstr_globe')));
        assert(requests.some(url => url.includes('clustrmaps.com')));
        const fontBytes = await page.evaluate(() => performance.getEntriesByType('resource')
            .filter(entry => /-home-subset\.woff2/.test(entry.name)).reduce((total, entry) => total + entry.encodedBodySize, 0));
        assert(fontBytes > 0 && fontBytes < 600000, `Homepage CJK font budget: ${fontBytes} bytes`);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: path.join(output, `deferred-${width}.png`) });
        console.log(`PASS ${width}px: lazy images, footer globe, first-click companion controls; ${fontBytes} CJK bytes`);
    } finally {
        await context.close();
    }
}

async function verifyPetRetry(browser, base) {
    const context = await createContext(browser, base);
    let attempts = 0;
    await context.route('**/assets/pet-summon.js', route => ++attempts === 1 ? route.abort('failed') : route.continue());
    const page = await context.newPage();
    try {
        await page.goto(`${base}/index.html?music=off`, { waitUntil: 'domcontentloaded' });
        await page.locator('#summonBtn').click();
        await page.waitForFunction(() => !document.getElementById('summonBtn').hasAttribute('aria-busy'));
        assert.equal(attempts, 1);
        await page.locator('#summonBtn').click();
        await page.waitForFunction(() => document.getElementById('summonMenu').classList.contains('show'));
        assert.equal(attempts, 2);
        console.log('PASS failed companion script can retry on the next click');
    } finally {
        await context.close();
    }
}

async function verifyWithoutScript(browser, base) {
    const context = await createContext(browser, base, { javaScriptEnabled: false });
    const page = await context.newPage();
    try {
        await page.goto(`${base}/index.html?music=off`, { waitUntil: 'load' });
        await page.locator('#projects').scrollIntoViewIfNeeded();
        const images = page.locator('.project-img-wrap img:not([data-deferred-src])');
        assert.equal(await images.count(), 2);
        await page.waitForFunction(() => [...document.querySelectorAll('.project-img-wrap img:not([data-deferred-src])')]
            .every(image => image.complete && image.naturalWidth > 0));
        assert(await images.first().isVisible(), 'Images remain available without JavaScript');
        console.log('PASS images and page content remain available without JavaScript');
    } finally {
        await context.close();
    }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const remoteBase = process.argv[2] ? new URL(process.argv[2]).origin : null;
    if (!remoteBase) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = remoteBase || `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch({ channel: 'chrome', headless: true });
        const report = [];
        for (const arrival of [false, true]) {
            for (const failedFonts of [false, true]) report.push(await verifyFontIndependence(browser, base, arrival, failedFonts));
        }
        for (const width of [1440, 390]) await verifyDeferredResources(browser, base, width);
        await verifyPetRetry(browser, base);
        await verifyWithoutScript(browser, base);
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    } finally {
        if (browser) await browser.close();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
