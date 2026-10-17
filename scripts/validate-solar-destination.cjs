'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const base = process.argv[2] || 'http://127.0.0.1:8787/';
const output = path.resolve(__dirname, '../.render-work/solar-destination');
const errors = [], checks = [];
const check = (condition, message) => { assert(condition, message); checks.push(message); console.log(`PASS ${message}`); };
const launchOptions = { headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] };

async function ready(page) {
    await page.waitForFunction(() => window.lifeStarMap?.initialized && window.lifeStarMap.lastFrame > 0);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('link[rel="stylesheet"][href^="assets/"]')).every(link => link.sheet));
}

async function assertLayout(page, label) {
    const geometry = await page.evaluate(() => {
        const dialog = document.getElementById('solarDestination');
        const choices = Array.from(dialog.querySelectorAll('.solar-destination-choice'), button => {
            const rect = button.getBoundingClientRect();
            const text = button.querySelector('span').getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
                textFits: text.width <= rect.width - 16 && text.height < 48,
                font: getComputedStyle(button).fontFamily };
        });
        return { width: innerWidth, height: innerHeight, choices,
            blur: getComputedStyle(dialog, '::backdrop').backdropFilter,
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
            focused: dialog.contains(document.activeElement),
            reduced: getComputedStyle(dialog.querySelector('span')).animationName === 'none' };
    });
    check(geometry.choices.length === 2 && geometry.choices.every(choice => choice.textFits
        && Math.abs(choice.width - geometry.width / 2) < 1 && Math.abs(choice.height - geometry.height) < 1)
        && geometry.choices[0].x === 0 && Math.abs(geometry.choices[1].x - geometry.width / 2) < 1
        && !geometry.horizontalOverflow, `${label}: two full-height halves keep each choice on one line`);
    check(geometry.blur.includes('blur(') && geometry.focused, `${label}: the backdrop blurs the map and focus enters the dialog`);
    return geometry;
}

async function scenario(browser, { name, viewport, mobile = false, reduced = false }) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile,
        deviceScaleFactor: mobile ? 2 : 1, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    try {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
        const requests = [];
        page.on('request', request => requests.push(request.url()));
        await page.route('https://api.open-meteo.com/**', route => route.fulfill({ json: { current: { temperature_2m: 21, weather_code: 0 } } }));
        await page.route('https://clustrmaps.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
        const activate = locator => mobile ? locator.tap() : locator.click();
        await page.goto(new URL('life.html', base).href, { waitUntil: 'domcontentloaded' });
        await ready(page);
        const marker = page.locator('[data-map-entity="solar"]');
        check(!requests.some(url => url.includes('/observatory/')), `${name}: the 3D page does not load the observer runtime`);
        for (const language of ['en', 'zh-CN', 'zh-TW']) {
            await activate(page.locator(`.lang-btn[data-lang="${language}"]`));
            await activate(marker);
            await page.locator('#solarDestination').waitFor({ state: 'visible' });
            const geometry = await assertLayout(page, `${name}/${language}`);
            if (reduced) check(geometry.reduced, `${name}/${language}: reduced motion skips the entrance animation`);
            const pose = await page.evaluate(() => window.lifeStarMap.snapshot());
            await page.mouse.move(viewport.width * .25, viewport.height * .35);
            await page.mouse.wheel(0, 120);
            await page.keyboard.press('ArrowLeft');
            check(await page.evaluate(pose => state.modalOpen && !window.lifeStarMap.canMove()
                && JSON.stringify(window.lifeStarMap.snapshot()) === JSON.stringify(pose), pose),
            `${name}/${language}: wheel and keyboard cannot move the map behind the choice`);
            await page.keyboard.press('Escape');
            check(await page.evaluate(() => !state.modalOpen && !document.getElementById('solarDestination').open
                && window.lifeStarMap.canMove() && document.activeElement?.dataset.mapEntity === 'solar'),
            `${name}/${language}: Escape closes the choice and restores the solar marker focus`);
        }
        await activate(page.locator('.lang-btn[data-lang="zh-CN"]'));
        await activate(marker);
        await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
        await page.screenshot({ path: path.join(output, `${name}-choice.png`) });
        if (!mobile) {
            for (let step = 0; step < 7; step++) {
                await page.keyboard.press(step < 4 ? 'Tab' : 'Shift+Tab');
                check(await page.evaluate(() => document.getElementById('solarDestination').contains(document.activeElement)),
                    `${name}: tab step ${step} stays in the modal`);
            }
        }
        await activate(page.locator('#solarDestinationClose'));
        check(await marker.evaluate(button => document.activeElement === button), `${name}: close restores the marker focus`);
        await activate(marker);
        await activate(page.locator('#solarObserve'));
        await page.waitForURL(/\/observatory(?:\.html)?(?:\?|$)/);
        await ready(page);
        await page.waitForFunction(() => {
            const renderer = window.lifeStarMap.renderer;
            return renderer.skyImage?.naturalWidth >= 4096 && renderer.skyOpacity() === 1
                && (!renderer.ready || renderer.skyUploaded);
        });
        check(await page.evaluate(() => window.lifeStarMap.currentView.observer
            && window.lifeStarMap.currentView.position.every(value => Math.abs(value) < 1e-8)
            && state.currentLang === 'zh-CN'), `${name}: the left half opens the restored observer sky and keeps the language`);
        check(await page.locator('#skyCredit').isVisible() && await page.locator('#observatoryReturn').isVisible(),
            `${name}: the observer page exposes the photograph credit and return link`);
        await page.screenshot({ path: path.join(output, `${name}-observatory.png`) });
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await ready(page);
        check(await page.evaluate(() => !state.modalOpen && !document.getElementById('solarDestination').open && window.lifeStarMap.canMove()),
            `${name}: browser Back restores an interactive 3D map without a stale modal`);
        await page.goForward({ waitUntil: 'domcontentloaded' });
        await ready(page);
        check(await page.evaluate(() => window.lifeStarMap.currentView.observer && window.lifeStarMap.canMove()),
            `${name}: browser Forward restores the observer sky`);
        await activate(page.locator('#observatoryReturn'));
        await page.waitForURL(/\/life(?:\.html)?(?:\?|$)/);
        await ready(page);
        check(await page.evaluate(() => !window.lifeStarMap.currentView.observer && window.lifeStarMap.canMove()),
            `${name}: the visible return link opens the 3D map`);
        await activate(marker);
        await activate(page.locator('#solarHome'));
        await page.waitForURL(url => /^\/(?:index(?:\.html)?)?$/.test(url.pathname));
        await page.locator('.hero-title').waitFor({ state: 'visible' });
        check(true, `${name}: the right half returns home`);
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await ready(page);
        check(await page.evaluate(() => !state.modalOpen && state.scene === 'roam' && window.lifeStarMap.canMove()),
            `${name}: Back from home restores the map after its departure transition`);
        check(!requests.some(url => /assets\/celestial\/|solar-system-map|closeup|celestial-(?:starfield|compositor|visits)/.test(url)),
            `${name}: neither choice requests retired planetary resources`);
    } finally { await context.close(); }
}

async function main() {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch(launchOptions);
    try {
        await scenario(browser, { name: 'desktop', viewport: { width: 1440, height: 960 } });
        await scenario(browser, { name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true });
        await scenario(browser, { name: 'narrow-reduced', viewport: { width: 320, height: 720 }, mobile: true, reduced: true });
    } finally { await browser.close(); }
    check(errors.length === 0, `No browser exceptions: ${errors.join('; ')}`);
    console.log(`Solar destination validation: ${checks.length} checks passed.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
