'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.render-work/ui-fonts');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
    '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
    const filename = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname));
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream' });
    fs.createReadStream(filename).pipe(response);
});

async function verifyGlyphs(page, selector, label, latinFamily = 'IBM Plex Sans') {
    await page.locator(selector).first().evaluate((element, homepage) => {
        const container = document.createElement('div');
        container.id = 'ui-font-probe';
        container.style.cssText = 'position:fixed;top:80px;left:20px;z-index:99999;background:white;color:black;font-size:24px';
        container.style.fontFamily = getComputedStyle(element).fontFamily;
        for (const [script, text] of [['han', homepage ? '关于动态项目简繁' : '文化区文化區地图地圖'], ['fallback', homepage ? '裡' : '線裡'], ['latin', 'Cultural regions 2026']]) {
            const span = document.createElement('span');
            span.id = `ui-font-${script}`;
            span.textContent = text;
            container.append(span);
        }
        document.body.append(container);
    }, label.startsWith('index-'));
    await page.evaluate(() => document.fonts.ready);
    const session = await page.context().newCDPSession(page);
    try {
        await session.send('DOM.enable');
        await session.send('CSS.enable');
        const { root: documentNode } = await session.send('DOM.getDocument');
        for (const [script, expected] of [['han', 'LANMI_yujian2_jianfan'], ['fallback', 'Site WenKai'], ['latin', latinFamily]]) {
            const { nodeId } = await session.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: `#ui-font-${script}` });
            const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
            assert(fonts.length > 0, `${label}/${script}: glyphs render`);
            assert(fonts.every(font => (script === 'latin' && latinFamily === 'Arial' || font.isCustomFont)
                && (font.postScriptName.includes(expected) || font.familyName.includes(expected))), `${label}/${script}: ${JSON.stringify(fonts)}`);
        }
    } finally {
        await page.locator('#ui-font-probe').evaluate(element => element.remove());
        await session.detach();
    }
}

async function verifyLayout(page, label, selector) {
    const failures = await page.locator(selector).evaluateAll(elements => elements.flatMap(element => {
        if (!element.checkVisibility()) return [];
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        const description = `${element.className}: ${element.textContent.trim().slice(0, 40)}`;
        const problems = [];
        if (bounds.left < -1 || bounds.right > innerWidth + 1) problems.push(`${description}: outside viewport`);
        if (element.clientWidth && element.scrollWidth > element.clientWidth + 1) problems.push(`${description}: clipped content`);
        if (style.fontFamily.includes('Lanmi Kai') && /[\u3400-\u9fff]/.test(element.textContent) && parseFloat(style.fontSize) < 13) {
            problems.push(`${description}: Chinese UI is too small`);
        }
        return problems;
    }));
    assert.deepEqual(failures, [], label);
}

async function verifyRenderedFonts(page, selector, expected, allowed, label) {
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const session = await page.context().newCDPSession(page);
    try {
        await session.send('DOM.enable');
        await session.send('CSS.enable');
        const { root: documentNode } = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector });
        const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
        const matches = (font, family) => font.postScriptName.includes(family) || font.familyName.includes(family);
        assert(fonts.some(font => matches(font, expected))
            && fonts.every(font => allowed.some(family => matches(font, family)
                && (font.isCustomFont || ['DFKai', '標楷體', 'KaiTi', '楷体'].includes(family)))),
        `${label}: ${JSON.stringify(fonts)}`);
    } finally {
        await session.detach();
    }
}

async function verifyStarLabels(page, label, language) {
    await page.waitForFunction(() => {
        const map = window.lifeStarMap;
        return (map.currentView.observer || map.portalRects.length > 0) && !map.currentView.moving
            && overlayWidth === innerWidth && overlayHeight === innerHeight
            && [...map.groups.values()].filter(group => !group.portal.button.hidden)
                .every(group => {
                    const button = group.portal.button;
                    const measured = map.labelLayout.sizes.get(button);
                    return measured?.text === button.textContent && measured.width === button.offsetWidth
                        && measured.height === button.offsetHeight;
                })
            && [...map.labelLayout.entries.values()].every(entry => entry.opacity === 0 || entry.opacity === 1);
    });
    const layout = await page.evaluate(() => {
        const map = window.lifeStarMap;
        const failures = [];
        const visible = [...map.groups.values()].map(group => group.portal.button)
            .filter(button => !button.hidden && Number(button.style.opacity) >= 0.9);
        const rectangles = visible.map(button => button.getBoundingClientRect());
        const bounds = map.labelLayout.viewportBounds();
        for (const [index, button] of visible.entries()) {
            const rect = rectangles[index];
            const name = button.textContent.trim();
            const measured = map.labelLayout.sizes.get(button);
            if (!measured || Math.abs(measured.width - rect.width) > 1 || Math.abs(measured.height - rect.height) > 1) {
                failures.push(`${name}: layout uses stale text dimensions`);
            }
            if (!map.portalRects.some(reserved => Math.abs(reserved.left - rect.left) < 1
                && Math.abs(reserved.top - rect.top) < 1 && Math.abs(reserved.right - rect.right) < 1
                && Math.abs(reserved.bottom - rect.bottom) < 1)) failures.push(`${name}: reserved rectangle differs from rendered label`);
            if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1
                || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) failures.push(`${name}: overlaps page controls`);
            for (const other of rectangles.slice(index + 1)) {
                if (rect.left < other.right - 1 && rect.right > other.left + 1
                    && rect.top < other.bottom - 1 && rect.bottom > other.top + 1) failures.push(`${name}: overlaps another label`);
            }
        }
        return { failures, count: visible.length, observer: map.currentView.observer,
            chinese: visible.find(button => /[\u3400-\u9fff]/.test(button.querySelector('strong').textContent))?.dataset.portalButton };
    });
    assert(layout.observer || layout.count > 0, `${label}: readable star labels remain available`);
    assert.deepEqual(layout.failures, [], `${label}: labels use their actual dimensions`);
    await verifyLayout(page, `${label}: visible star text`, '.map-portal:not([hidden]), .map-footer, .galactic-navigation');
    if (language !== 'en' && layout.chinese) {
        await verifyRenderedFonts(page, `[data-portal-button="${layout.chinese}"] strong`, 'LANMI_yujian2_jianfan',
            ['LANMI_yujian2_jianfan', 'Site WenKai'], `${label}: Chinese star heading`);
    }
}

async function verifySceneStatus(page, label) {
    const session = await page.context().newCDPSession(page);
    try {
        await session.send('DOM.enable');
        await session.send('CSS.enable');
        const { root: documentNode } = await session.send('DOM.getDocument');
        const { nodeId } = await session.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '.scene-status' });
        for (const language of ['zh-CN', 'zh-TW', 'en']) {
            await page.evaluate(language => setLang(language), language);
            await page.evaluate(() => document.fonts.ready);
            const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
            const expected = language === 'en' ? 'IBMPlexMono-Regular' : 'LANMI_yujian2_jianfan';
            assert(fonts.length > 0 && fonts.every(font => font.isCustomFont && font.postScriptName === expected),
                `${label}/${language}: actual scene status glyphs ${JSON.stringify(fonts)}`);
            await verifyLayout(page, `${label}/${language}: scene status`, '.scene-status');
            await verifyStarLabels(page, `${label}/${language}`, language);
        }
        const viewport = page.viewportSize();
        await page.setViewportSize({ width: viewport.width === 1440 ? 390 : 1440, height: viewport.height });
        await verifyStarLabels(page, `${label}/resize`, 'en');
        await page.setViewportSize(viewport);
        await verifyStarLabels(page, `${label}/restore`, 'en');
        await verifyGlyphs(page, '.scene-status', `${label}/monospace`, 'IBM Plex Mono');
        console.log(`PASS ${label}: scene status uses Lanmi Chinese and IBM Plex Mono Latin glyphs`);
    } finally {
        await session.detach();
    }
}

async function verifyPage(browser, base, route, width) {
    const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, reducedMotion: 'reduce' });
    await context.route('**/*', request => new URL(request.request().url()).origin === base
        ? request.continue() : request.fulfill({ status: 200, body: '' }));
    const page = await context.newPage();
    if (process.argv[2]) page.setDefaultTimeout(60000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
        if (response.url().includes('/fonts/') && response.status() !== 200) errors.push(`Font HTTP ${response.status()}: ${response.url()}`);
    });
    const label = `${route.replace('.html', '')}-${width}`;
    try {
        await page.goto(`${base}/${route}?music=off`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => typeof setLang === 'function');
        const isLife = route !== 'index.html';
        if (isLife) {
            await page.waitForFunction(() => window.lifeStarMap?.lastFrame > 0 && !window.lifeStarMap.flight);
            await verifySceneStatus(page, label);
            await page.locator('#sectionDrawerToggle').click();
            await page.locator('#sectionDrawerList [data-portal-id="footprints"]').click();
            await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'footprints');
            await page.waitForSelector('[data-atlas-card="china"] [data-map-action="select-view"]');
        }
        for (const language of ['zh-CN', 'zh-TW', 'en']) {
            await page.evaluate(language => setLang(language), language);
            await page.evaluate(() => Promise.allSettled(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished)));
            const selector = isLife ? '[data-atlas-card="china"] [data-map-action="select-view"]' : '.lang-btn';
            await verifyGlyphs(page, selector, `${label}/${language}`);
            await verifyLayout(page, `${label}/${language}: language controls`, '.lang-btn');
            if (isLife) {
                if (language !== 'en') {
                    await verifyRenderedFonts(page, '.portal-panel-title', 'LANMI_yujian2_jianfan',
                        ['LANMI_yujian2_jianfan', 'Site WenKai'], `${label}/${language}: panel title`);
                }
                const control = page.locator(selector);
                await control.scrollIntoViewIfNeeded();
                const layout = await control.evaluate(element => {
                    const bounds = element.getBoundingClientRect();
                    return { value: element.value, text: element.selectedOptions[0].textContent,
                        fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.width >= element.scrollWidth };
                });
                assert.equal(layout.value, 'cultural');
                assert.equal(layout.text, { 'zh-CN': '文化区', 'zh-TW': '文化區', en: 'Cultural regions' }[language]);
                assert(layout.fits, `${label}/${language}: cultural selector fits`);
                if (language !== 'en') await verifyLayout(page, `${label}/${language}: map controls`, '[data-atlas-card="china"] :is(.footprints-map-view-select, .footprints-map-open)');
                if (language === 'zh-CN') await page.locator('[data-atlas-card="china"]').screenshot({ path: path.join(output, `${label}-cultural.png`) });
            } else if (language !== 'en') {
                await verifyLayout(page, `${label}/${language}: homepage`, '.nav-link, .section-title, .footer, .life-card-cta');
                await verifyRenderedFonts(page, '.section-title', 'LANMI_yujian2_jianfan',
                    ['LANMI_yujian2_jianfan', 'Site WenKai'], `${label}/${language}: homepage heading`);
                await verifyRenderedFonts(page, '.hero-bio', 'TW-MOE-Std-Kai',
                    ['TW-MOE-Std-Kai', 'DFKai', '標楷體', 'KaiTi', '楷体', 'Site WenKai', 'Newsreader'], `${label}/${language}: homepage prose`);
            }
        }
        if (isLife) {
            await verifyGlyphs(page, '.wiki-userbox', `${label}/userbox`, 'Arial');
        }
        if (route === 'observatory.html') {
            await page.evaluate(() => {
                closePortalPanel(false);
                setLang('zh-CN');
                window.lifeStarMap.deepSky.enter('m42');
            });
            await page.evaluate(() => document.fonts.ready);
            await verifyRenderedFonts(page, '.deep-sky-card h1', 'LANMI_yujian2_jianfan',
                ['LANMI_yujian2_jianfan', 'Site WenKai'], `${label}: deep sky heading`);
            await verifyRenderedFonts(page, '.deep-sky-description', 'TW-MOE-Std-Kai',
                ['TW-MOE-Std-Kai', 'DFKai', '標楷體', 'KaiTi', '楷体', 'Site WenKai', 'Newsreader'], `${label}: deep sky prose`);
            await verifyLayout(page, `${label}: deep sky text`, '.deep-sky-card h1, .deep-sky-description, .deep-sky-observation');
            await page.screenshot({ path: path.join(output, `${label}-deep-sky.png`) });
        }
        assert.deepEqual(errors, [], `${label}: runtime and font requests`);
        console.log(`PASS ${label}: Lanmi Chinese, WenKai fallback, Latin fonts and UI layout`);
    } finally {
        await context.close();
    }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const remoteBase = process.argv[2] ? new URL(process.argv[2]).origin : null;
    if (!remoteBase) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
        const base = remoteBase || `http://127.0.0.1:${server.address().port}`;
        for (const route of process.argv.includes('--home') ? ['index.html'] : ['index.html', 'life.html', 'observatory.html']) {
            for (const width of [1440, 390, 320]) await verifyPage(browser, base, route, width);
        }
    } finally {
        if (browser) await browser.close();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
