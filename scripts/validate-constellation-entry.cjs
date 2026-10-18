'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:8787/';
const output = path.resolve(__dirname, '../.render-work/constellation-entry');
const checks = [], errors = [];
const check = (condition, message) => { assert(condition, message); checks.push(message); console.log(`PASS ${message}`); };

async function settle(page) {
    await page.waitForFunction(() => window.lifeStarMap?.lastFrame > 0 && !window.lifeStarMap.flight
        && !window.lifeStarMap.currentView.moving && state.scene !== 'flying');
}

async function pointFor(page, id) {
    return page.evaluate(id => {
        const map = window.lifeStarMap, group = map.groups.get(id);
        const stars = group.points.map((position, index) => ({ ...map.project(position), hip: group.portal.patternHips[index] }));
        return stars.find(point => point.visible && point.x > 30 && point.y > 120 && point.x < innerWidth - 30 && point.y < innerHeight - 120
            && document.elementFromPoint(point.x, point.y)?.closest('#galaxyWorld')
            && map.portalStarAt(point.x, point.y)?.portal.id === id);
    }, id);
}

async function load(page, route) {
    await page.goto(new URL(route, base).href, { waitUntil: 'domcontentloaded' });
    await settle(page);
    await page.evaluate(() => document.fonts.ready);
}

async function labels(browser) {
    for (const viewport of [{ width: 1365, height: 768 }, { width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
        const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
        page.on('pageerror', error => errors.push(error.message));
        try {
            await load(page, 'life.html');
            for (const language of ['en', 'zh-CN', 'zh-TW']) {
                await page.locator(`.lang-btn[data-lang="${language}"]`).click();
                const profile = page.locator('[data-portal-button="profile"]');
                const label = await profile.boundingBox();
                check(await profile.isVisible() && label.y > 100 && label.y + label.height < viewport.height - 55,
                    `${viewport.width} × ${viewport.height}/${language}: the Meet Me Again label is visible above the footer at the default angle`);
                const wineLabel = page.locator('[data-portal-button="wine"]');
                check(await wineLabel.isVisible(), `${viewport.width}/${language}: Wine Diary has a visible default label`);
                await profile.click();
                await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'profile');
                check(await page.locator('#profile').isVisible(), `${viewport.width}/${language}: Profile text opens the personal introduction`);
                const profileState = await page.evaluate(() => {
                    const profile = document.querySelector('#profile'), body = document.querySelector('.portal-panel-body');
                    return { title: document.querySelector('#portalPanelTitle').textContent, noNotes: !document.querySelector('#notes, [data-portal-button="notes"]'),
                        fits: body.scrollWidth <= body.clientWidth + 1,
                        userboxCount: profile.querySelectorAll('.wiki-userboxes > .wiki-userbox').length,
                        noUserboxHeading: !profile.querySelector('#profile-box-heading, .profile-box-intro, .wiki-userbox-pending'),
                        shared: state.activePortal.patternHips.every(hip => starEntries(state.activePortal, hip).length === 1) };
                });
                const expectedTitle = { en: 'Meet Me Again', 'zh-CN': '重新认识我', 'zh-TW': '重新認識我' }[language];
                check(profileState.title === expectedTitle && profileState.noNotes && profileState.fits
                    && profileState.userboxCount === 29 && profileState.noUserboxHeading && profileState.shared,
                    `${viewport.width}/${language}: the personal introduction shows the selected userboxes without extra copy`, profileState);
                check(await page.evaluate(() => state.activePortal.pattern === 'orion'
                    && dom.constellationMeaningText.textContent === localized(constellationStories.profile.reason)),
                    `${viewport.width}/${language}: Profile uses Orion and shows its localized meaning`);
                if (language === 'zh-CN') await page.screenshot({ path: path.join(output, `profile-meaning-${viewport.width}.png`) });
                await page.locator('.profile-portrait img').evaluate(image => image.decode());
                await page.locator('.wiki-userboxes').scrollIntoViewIfNeeded();
                check(await page.locator('.wiki-userboxes > .wiki-userbox').count() === 29,
                    `${viewport.width}/${language}: all selected userboxes remain accessible in the scrolling panel`);
                if (language === 'zh-CN') await page.screenshot({ path: path.join(output, `profile-${viewport.width}.png`) });
                await page.locator('#portalClose').click();
                await settle(page);
            }
            await page.locator('.lang-btn[data-lang="zh-CN"]').click();
            await page.screenshot({ path: path.join(output, `labels-${viewport.width}.png`) });
        } finally { await page.close(); }
    }
}

async function entry(browser, route, mobile) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1365, height: 768 },
        isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const label = `${route}/${mobile ? 'touch' : 'mouse'}`;
    page.on('pageerror', error => errors.push(error.message));
    try {
        await load(page, route);
        // Reorient the actual observer sky to bring each real constellation into view.
        for (const id of ['profile', 'wine', 'gallery', 'friends', 'thoughts']) {
            if (route === 'observatory.html') {
                await page.evaluate(id => {
                    const map = window.lifeStarMap, vector = normalize(map.groups.get(id).center);
                    map.yaw = map.target.yaw = Math.atan2(-vector[0], -vector[2]);
                    map.pitch = map.target.pitch = Math.asin(-vector[1]);
                    map.distance = map.target.distance = 430;
                }, id);
                await page.waitForFunction(() => window.lifeStarMap.currentView.forward.every((value, axis) => Math.abs(value - window.lifeStarMap.view().forward[axis]) < 1e-6));
            }
            const point = await pointFor(page, id);
            check(Boolean(point), `${label}: ${id} has a reachable visible star outside its text label`);
            if (mobile) await page.touchscreen.tap(point.x, point.y);
            else await page.mouse.click(point.x, point.y);
            await page.waitForFunction(({ id, hip }) => state.scene === 'detail' && state.activePortal?.id === id && state.activeStarHip === hip, { id, hip: point.hip });
            check(true, `${label}: clicking a ${id} star enters that constellation and selects the clicked star`);
            await page.locator('#portalClose').click();
            await settle(page);
        }
        const point = await pointFor(page, route === 'life.html' ? 'profile' : 'thoughts');
        assert(point, `${label}: gesture target must be visible`);
        if (mobile) {
            const session = await context.newCDPSession(page);
            const touch = (x, y, id) => ({ x, y, id, radiusX: 1, radiusY: 1 });
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(point.x, point.y, 1)] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(point.x + 40, point.y + 10, 1)] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await settle(page);
            check(await page.evaluate(() => state.scene === 'roam' && !window.lifeStarMap.selected), `${label}: dragging from a star rotates without opening its content`);
            const next = await pointFor(page, route === 'life.html' ? 'profile' : 'thoughts');
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch(next.x, next.y, 1), touch(next.x + 45, next.y, 2)] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touch(next.x - 10, next.y, 1), touch(next.x + 55, next.y, 2)] });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await settle(page);
            check(await page.evaluate(() => state.scene === 'roam' && !window.lifeStarMap.selected), `${label}: pinching from a star zooms without opening content`);
        } else {
            for (const button of ['left', 'right']) {
                const star = await pointFor(page, route === 'life.html' ? 'profile' : 'thoughts');
                await page.mouse.move(star.x, star.y);
                await page.mouse.down({ button });
                await page.mouse.move(star.x + 45, star.y + 10, { steps: 5 });
                await page.mouse.up({ button });
                await settle(page);
                check(await page.evaluate(() => state.scene === 'roam' && !window.lifeStarMap.selected), `${label}: ${button} drag from a star moves the map without opening content`);
            }
        }
        await page.locator('#sectionDrawerToggle').click();
        await page.locator('#sectionDrawerList [data-portal-id="friends"]').click();
        await page.waitForFunction(() => state.scene === 'detail' && state.activePortal?.id === 'friends');
        const links = await page.locator('#friends a').evaluateAll(elements => elements.map(element => ({ text: element.textContent, href: element.href })));
        check(JSON.stringify(links) === JSON.stringify([
            { text: 'Agentic AI Lab (AAIL)', href: 'https://www.aail.cn/' },
            { text: 'Yuheng Wang', href: 'https://hendrick-wang.github.io/' },
            { text: 'Qiran Zhang', href: 'https://positionprivacy.github.io/' }
        ]), `${label}: Friends contains exactly the three requested websites and no old placeholders`);
    } finally { await context.close(); }
}

async function meanings(browser, route, mobile) {
    const page = await browser.newPage({ viewport: mobile ? { width: 320, height: 844 } : { width: 1365, height: 768 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    const label = `${route}/${mobile ? '320px' : 'desktop'}`;
    try {
        await load(page, route);
        const membership = await page.evaluate(() => ({
            ids: portalDefinitions.filter(portal => !portal.home).map(portal => portal.id),
            removed: Boolean(document.querySelector('#news, #publications, #projects, #notes, [data-portal-button="news"], [data-portal-button="publications"], [data-portal-button="projects"]')),
            targets: Object.values(homeStarTargets).filter(target => target.type === 'portal').map(target => target.portalId),
            patterns: portalDefinitions.every(portal => constellationPatterns[portal.pattern].hips.every(hip => window.HipparcosSky.indexByHip.has(hip)))
        }));
        const expected = ['gallery', 'footprints', 'shelf', 'thoughts', 'friends', 'profile', 'wine'];
        check(!membership.removed && membership.patterns && JSON.stringify(membership.ids) === JSON.stringify(expected)
            && JSON.stringify(membership.targets.sort()) === JSON.stringify(expected.slice().sort()),
            `${label}: seven content sections use catalogue stars and Home routes reach exactly these sections`);
        for (const id of [...expected, 'home']) {
            // The Home constellation has its own shared panel, while the solar marker opens the destination chooser.
            await page.evaluate(id => window.lifeStarMap.openPortal(portalDefinitions.find(portal => portal.id === id)), id);
            await page.waitForFunction(id => state.scene === 'detail' && state.activePortal?.id === id, id);
            await settle(page);
            for (const language of ['en', 'zh-CN', 'zh-TW']) {
                await page.locator(`.lang-btn[data-lang="${language}"]`).click();
                const meaning = await page.evaluate(() => {
                    const portal = state.activePortal, story = constellationStories[portal.id], rect = dom.constellationMeaningText.getBoundingClientRect(), body = dom.panelBody.getBoundingClientRect();
                    return {
                        title: dom.constellationMeaningTitle.textContent,
                        expectedTitle: `${localized(story.name)} · ${localized(story.epithet)}`,
                        text: dom.constellationMeaningText.textContent, expected: localized(story.reason),
                        aboveContent: document.getElementById('constellationMeaning').nextElementSibling?.matches('[data-portal-content]'),
                        fits: dom.panelBody.scrollWidth <= dom.panelBody.clientWidth + 1,
                        visible: rect.width > 0 && rect.top >= body.top - 1 && rect.top < body.bottom,
                        emptyWine: portal.id !== 'wine' || (!portal.content.querySelector('[data-portal-entry]')
                            && portal.content.querySelector('.wine-empty').textContent === i18n[state.currentLang].wine_empty)
                    };
                });
                check(meaning.title === meaning.expectedTitle && meaning.text === meaning.expected && meaning.text.length > 25
                    && meaning.aboveContent && meaning.fits && meaning.visible && meaning.emptyWine,
                    `${label}/${id}/${language}: localized meaning is visible above content and fits the panel`);
                await page.evaluate(() => selectPortalStar(state.activePortal, state.activePortal.patternHips.at(-1)));
                check(await page.locator('#constellationMeaningText').textContent() === meaning.expected,
                    `${label}/${id}/${language}: selecting another star retains the constellation meaning`);
                if (id === 'wine' && language === 'zh-CN') await page.screenshot({ path: path.join(output, `wine-${route}-${mobile ? 'mobile' : 'desktop'}.png`) });
            }
            await page.locator('#portalClose').click();
            await settle(page);
        }
    } finally { await page.close(); }
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--enable-unsafe-swiftshader'] });
    try {
        await labels(browser);
        for (const route of ['life.html', 'observatory.html']) for (const mobile of [false, true]) {
            await entry(browser, route, mobile);
            await meanings(browser, route, mobile);
        }
    } finally { await browser.close(); }
    check(errors.length === 0, `No page exceptions: ${errors.join('; ')}`);
    console.log(`Constellation entry validation: ${checks.length} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
