'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8795/';
const output = path.resolve(__dirname, '../.render-work/life-card-updates');
const errors = [];
const names = {
    gallery: ['Cassiopeia', '仙后座', '仙后座'],
    footprints: ['Ursa Major', '大熊座', '大熊座'],
    shelf: ['Lyra', '天琴座', '天琴座'],
    thoughts: ['Cygnus', '天鹅座', '天鵝座'],
    friends: ['Gemini', '双子座', '雙子座'],
    profile: ['Orion', '猎户座', '獵戶座'],
    wine: ['Crater', '巨爵座', '巨爵座'],
    wishlist: ['Delphinus', '海豚座', '海豚座']
};

async function ready(page) {
    await page.waitForFunction(() => window.lifeStarMap?.lastFrame > 0 && !window.lifeStarMap.flight);
    await page.evaluate(() => document.fonts.ready);
}

async function solarMotion(page, label) {
    await page.evaluate(() => {
        window.solarDrawSamples = [];
        window.originalStarGlow = drawStarGlow;
        window.originalSolarPosition = window.lifeStarMap.entities.find(entity => entity.id === 'solar').position.slice();
        drawStarGlow = function(context, horizontal, vertical, size, opacity, home) {
            if (home) {
                const map = window.lifeStarMap;
                const solar = map.entities.find(entity => entity.id === 'solar');
                const projected = map.project(solar.position, map.currentView);
                window.solarDrawSamples.push({ moving: map.currentView.moving, hidden: solar.button.querySelector('span').hidden,
                    error: Math.hypot(projected.x - horizontal, projected.y - vertical) });
            }
            return window.originalStarGlow(context, horizontal, vertical, size, opacity, home);
        };
    });
    await page.mouse.move(300, 350);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(335, 365, { steps: 18 });
    await page.waitForFunction(() => window.solarDrawSamples.some(sample => sample.moving && sample.hidden));
    await page.screenshot({ path: path.join(output, `${label}-rotating.png`) });
    await page.mouse.up({ button: 'right' });
    const samples = await page.evaluate(() => {
        drawStarGlow = window.originalStarGlow;
        return { samples: window.solarDrawSamples, original: window.originalSolarPosition,
            current: window.lifeStarMap.entities.find(entity => entity.id === 'solar').position };
    });
    assert.deepEqual(samples.current, samples.original, `${label}: the Solar System keeps its world position`);
    assert(samples.samples.some(sample => sample.moving && sample.hidden), `${label}: rotation hides the label while drawing the star`);
    assert(samples.samples.every(sample => sample.error < 0.001), `${label}: the solar glow stays on its projected position`);
    await page.waitForFunction(() => !window.lifeStarMap.currentView.moving);
    console.log(`PASS ${label}: the solar star remains visible during rotation`);
}

async function cards(browser, route, mobile) {
    const label = `${route.replace('.html', '')}-${mobile ? 'mobile' : 'desktop'}`;
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
    page.on('response', response => {
        if (new URL(response.url()).origin === new URL(base).origin && response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
            errors.push(`${label}: HTTP ${response.status()} ${response.url()}`);
        }
    });
    try {
        await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
        await ready(page);
        assert.equal(await page.locator('#portalPanelKicker, .portal-panel-hint, .handwriting-browse').count(), 0);
        if (route === 'life.html' && !mobile) await solarMotion(page, label);
        for (const [section, translations] of Object.entries(names)) {
            await page.evaluate(section => window.lifeStarMap.openPortal(portalDefinitions.find(portal => portal.id === section), 'keyboard'), section);
            await page.waitForFunction(section => state.scene === 'detail' && state.activePortal?.id === section && !window.lifeStarMap.flight, section);
            for (const [index, language] of ['en', 'zh-CN', 'zh-TW'].entries()) {
                await page.locator(`.lang-btn[data-lang="${language}"]`).click();
                assert.equal(await page.locator('#portalPanelNames').textContent(), translations[index], `${label}/${section}/${language}: constellation subtitle`);
                assert(await page.locator('#portalPanelNames').isVisible(), `${label}/${section}: the subtitle is visible`);
                const layout = await page.evaluate(() => {
                    const body = document.getElementById('portalPanelBody');
                    const content = body.querySelector('.portal-content:not([hidden])');
                    const meaning = document.getElementById('constellationMeaning');
                    const previews = Array.from(state.activePortal.starButtons.values(), button => button.querySelector('.star-hit-copy > span').textContent);
                    return { last: body.lastElementChild.id,
                        afterContent: meaning.getBoundingClientRect().top >= content.getBoundingClientRect().bottom - 1,
                        previews, overflow: body.scrollWidth > body.clientWidth + 1 };
                });
                assert.equal(layout.last, 'constellationMeaning');
                assert(layout.afterContent, `${label}/${section}: the meaning follows all content`);
                assert(!layout.overflow, `${label}/${section}: the card has no horizontal overflow`);
                assert(layout.previews.every(preview => /HIP \d+/.test(preview) && /B−V/.test(preview)
                    && !/Open |打开|開啟/.test(preview)), `${label}/${section}/${language}: star tooltips contain catalogue data`);
            }
            if (!mobile) {
                const target = await page.evaluate(() => {
                    for (const button of state.activePortal.starButtons.values()) {
                        if (button.hidden) continue;
                        const rect = button.getBoundingClientRect();
                        const horizontal = rect.left + rect.width / 2;
                        const vertical = rect.top + rect.height / 2;
                        if (document.elementFromPoint(horizontal, vertical)?.closest('.star-hit') === button) {
                            return { horizontal, vertical, hip: button.dataset.starHip };
                        }
                    }
                    return null;
                });
                if (!target) {
                    await page.screenshot({ path: path.join(output, `${label}-${section}-hover.png`) });
                    console.log(await page.evaluate(() => Array.from(state.activePortal.starButtons.values(), button => {
                        const rect = button.getBoundingClientRect();
                        return { hip: button.dataset.starHip, hidden: button.hidden, x: rect.x, y: rect.y,
                            covering: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.className };
                    })));
                }
                assert(target, `${label}/${section}: at least one star is hoverable`);
                await page.mouse.move(target.horizontal, target.vertical);
                await page.waitForFunction(hip => Number(getComputedStyle(document.querySelector(`.star-hit[data-star-hip="${hip}"] .star-hit-copy`)).opacity) > 0.9, target.hip);
            }
            await page.locator('#constellationMeaning').scrollIntoViewIfNeeded();
            if (section === 'wine' || section === 'profile') await page.screenshot({ path: path.join(output, `${label}-${section}.png`) });
            if (section === 'profile') {
                assert.equal(await page.evaluate(() => document.getElementById('handwritingSources').content.querySelectorAll('img').length), 19);
                await page.locator('#handwritingToggle').click();
                await page.waitForFunction(() => document.querySelector('#handwritingSky img')?.naturalWidth > 0, null, { timeout: 15000 });
                await page.locator('#handwritingToggle').click();
                assert.equal(await page.locator('#handwritingToggle').getAttribute('aria-pressed'), 'false');
            }
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => state.scene === 'roam' && !window.lifeStarMap.flight);
            console.log(`PASS ${label}/${section}: three languages, footer, astronomy hints and Escape`);
        }
    } finally {
        await context.close();
    }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    try {
        for (const route of ['life.html', 'observatory.html']) {
            for (const mobile of [false, true]) await cards(browser, route, mobile);
        }
    } finally {
        await browser.close();
    }
    assert.deepEqual(errors, [], 'The updated pages have no script errors or missing local resources');
    console.log('Life card updates validation passed.');
})().catch(error => { console.error(error); console.error(errors); process.exitCode = 1; });
