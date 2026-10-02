'use strict';

const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const pageUrl = process.argv[2] || 'http://127.0.0.1:8765/life.html';
const launchOptions = {
    headless: true,
    ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }),
    args: ['--enable-unsafe-swiftshader']
};

function centre(box) {
    return { x: Math.max(2, Math.min(898, box.x + box.width * 0.5)), y: Math.max(2, Math.min(798, box.y + box.height * 0.5)) };
}

async function main() {
    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext({ viewport: { width: 900, height: 800 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.lifeStarMap?.initialized && !window.lifeStarMap.flight);
    if (await page.locator('#entryTrigger').isVisible().catch(() => false)) await page.locator('#entryTrigger').click();
    await page.waitForFunction(() => window.lifeStarMap?.canMove());
    const client = await context.newCDPSession(page);
    const read = () => page.evaluate(() => ({ scale: visualViewport.scale, distance: lifeStarMap.target.distance }));
    const pinch = async (selector, source = 'mouse') => {
        const box = await page.locator(selector).boundingBox();
        assert(box, `${selector} must be visible for pinch validation`);
        await client.send('Input.synthesizePinchGesture', { ...centre(box), scaleFactor: 1.45, relativeSpeed: 600, gestureSourceType: source });
        await page.waitForTimeout(450);
        return read();
    };
    const worldBefore = await read();
    const worldTouch = await pinch('#galaxyWorld', 'touch');
    assert(Math.abs(worldTouch.scale - 1) < 0.01, 'Touch pinch over star map must not change browser page scale');
    assert.notEqual(worldTouch.distance, worldBefore.distance, 'Touch pinch over star map must change map distance');
    await page.evaluate(() => lifeStarMap.reset());
    await page.waitForFunction(() => !window.lifeStarMap.flight);
    const worldMouse = await pinch('#galaxyWorld', 'mouse');
    assert(Math.abs(worldMouse.scale - 1) < 0.01, 'Trackpad pinch over star map must not change browser page scale');
    assert.notEqual(worldMouse.distance, worldBefore.distance, 'Trackpad pinch over star map must change map distance');
    await page.evaluate(() => lifeStarMap.solarSystem.enter());
    await page.waitForFunction(() => document.body.classList.contains('solar-system-active'));
    for (const selector of ['.solar-map-picker', '.solar-map-header']) {
        const result = await pinch(selector, 'mouse');
        assert(Math.abs(result.scale - 1) < 0.01, `${selector} must consume trackpad pinch without browser page zoom`);
    }
    const prevented = await page.evaluate(() => {
        const target = document.querySelector('.solar-map-picker');
        let observed = false;
        target.addEventListener('wheel', event => { observed = event.defaultPrevented; }, { once: true });
        target.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 1 }));
        return observed;
    });
    assert.equal(prevented, true, 'Ctrl-wheel over solar map must be preventDefaulted before browser zoom');
    console.log('Map zoom validation passed: touch pinch, trackpad pinch, solar overlays, and ctrl-wheel.');
    await browser.close();
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
