'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const repository = path.resolve(__dirname, '..');
const root = process.env.SITE_PUBLIC_ROOT ? path.resolve(process.env.SITE_PUBLIC_ROOT) : repository;
const output = path.join(repository, '.render-work/music');
const library = JSON.parse(fs.readFileSync(path.join(root, 'assets/music/library.json'), 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const errors = [];
const server = http.createServer((request, response) => {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/preview\//, '/');
    if (pathname === '/') pathname = '/index.html';
    if (/^\/(?:index|life|observatory)$/.test(pathname)) pathname += '.html';
    const filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
        response.writeHead(404).end();
        return;
    }
    const size = fs.statSync(filename).size;
    const headers = { 'Content-Type': types[path.extname(filename)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
    const range = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
        const start = Number(range[1]);
        const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
        if (start > end) { response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end(); return; }
        response.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` });
        fs.createReadStream(filename, { start, end }).pipe(response);
    } else {
        response.writeHead(200, { ...headers, 'Content-Length': size });
        fs.createReadStream(filename).pipe(response);
    }
});

function contentFrame(page) {
    return page.frames().find(frame => frame !== page.mainFrame() && /\/(?:index(?:\.html)?|life(?:\.html)?|observatory(?:\.html)?)?(?:[?#]|$)/.test(frame.url()));
}

async function settled(page, route) {
    await page.waitForFunction(expected => {
        const frame = document.getElementById('sitePage');
        const source = frame?.contentWindow;
        return source && source.document.readyState === 'complete' &&
            source.location.pathname.endsWith(expected) &&
            source.StellarTransit?.destinationReady && !source.StellarTransit?.active;
    }, route, { timeout: 60000 });
}

async function startPlayback(page) {
    await page.locator('#musicQuickPlay').click();
    await page.waitForFunction(() => {
        const audio = document.getElementById('siteAudio');
        return !audio.paused && audio.currentTime > 0.2 && audio.readyState >= 3;
    });
}

async function dragPlayer(page, selector, deltaX, deltaY, touch = false) {
    const bounds = await page.locator(selector).boundingBox();
    const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    if (touch) {
        const session = await page.context().newCDPSession(page);
        try {
            await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
            for (let step = 1; step <= 8; step++) {
                await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + deltaX * step / 8, y: start.y + deltaY * step / 8, id: 1 }] });
            }
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally {
            await session.detach();
        }
    } else {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x + deltaX, start.y + deltaY, { steps: 8 });
        await page.mouse.up();
    }
}

async function assertPlayerFits(page, label, expanded = false) {
    const viewport = page.viewportSize();
    for (const selector of expanded ? ['.music-dock', '#musicPanel'] : ['.music-dock']) {
        const bounds = await page.locator(selector).boundingBox();
        assert(bounds.x >= 11 && bounds.y >= 11 && bounds.x + bounds.width <= viewport.width - 11 && bounds.y + bounds.height <= viewport.height - 11, `${label}: ${selector} remains accessible: ${JSON.stringify(bounds)}`);
    }
}

async function checkDragging(page, label) {
    const touch = label !== 'desktop';
    const viewport = page.viewportSize();
    await dragPlayer(page, '#musicToggle', -50, 90, touch);
    assert.equal(await page.locator('#musicToggle').getAttribute('aria-expanded'), 'false', 'Dragging the title does not open the panel');
    assert(await page.locator('#siteAudio').evaluate(audio => !audio.paused), 'Dragging does not pause playback');
    let bounds = await page.locator('.music-dock').boundingBox();
    assert(bounds.y > 150, `${label}: pointer movement moves the player`);
    if (!touch) {
        const handle = await page.locator('#musicDrag').boundingBox();
        await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
        await page.mouse.down({ clickCount: 2 });
        await page.mouse.move(handle.x + handle.width / 2 - 10, handle.y + handle.height / 2 + 20, { steps: 4 });
        await page.mouse.up({ clickCount: 2 });
        const next = await page.locator('.music-dock').boundingBox();
        assert(Math.abs(next.y - bounds.y - 20) < 1, 'A double-click generated by a quick second drag does not reset the player');
        bounds = next;
    }
    await dragPlayer(page, '#musicDrag', -bounds.x - 80, viewport.height - bounds.y + 60, touch);
    await assertPlayerFits(page, label);
    bounds = await page.locator('.music-dock').boundingBox();
    assert(Math.abs(bounds.x - 12) < 1 && Math.abs(bounds.y + bounds.height - viewport.height + 12) < 1, 'Dragging across the iframe clamps the player to the bottom-left edge');
    await page.locator('#musicToggle').click();
    assert.equal(await page.locator('#siteMusic').getAttribute('data-panel-placement'), 'up');
    await assertPlayerFits(page, label, true);
    await page.screenshot({ path: path.join(output, `${label}-dragged.png`), animations: 'disabled' });
    const before = await page.locator('.music-dock').boundingBox();
    await dragPlayer(page, '.music-heading > div', 35, -70, touch);
    const after = await page.locator('.music-dock').boundingBox();
    assert(after.x > before.x + 25 && after.y < before.y - 60, 'The open panel heading also moves the player');
    assert.equal(await page.locator('#musicToggle').getAttribute('aria-expanded'), 'true', 'Dragging an open panel leaves it open');
    await assertPlayerFits(page, label, true);
    await page.locator('#musicSearch').fill('克卜勒');
    assert.equal(await page.locator('#musicTracks button').count(), 1, 'Search remains usable after dragging');
    await page.locator('#musicSearch').fill('');
    await page.locator('#musicVolume').fill('0.61');
    assert(Math.abs(await page.locator('#siteAudio').evaluate(audio => audio.volume) - 0.61) < 0.001);
    await page.locator('#musicClose').click();
    await page.locator('#musicQuickPlay').click();
    assert(await page.locator('#siteAudio').evaluate(audio => audio.paused), 'The quick-play button still receives a normal click');
    await startPlayback(page);
    if (label === 'desktop') {
        await page.locator('#musicDrag').focus();
        await page.keyboard.press('ArrowRight');
        const moved = await page.locator('.music-dock').boundingBox();
        assert(Math.abs(moved.x - after.x - 10) < 1, 'Keyboard arrows move the player');
        await page.locator('#musicToggle').click();
        await page.setViewportSize({ width: 320, height: 400 });
        await assertPlayerFits(page, 'resized', true);
        await page.setViewportSize(viewport);
        await page.locator('#musicClose').click();
    }
}

async function continuity(page, action, destination) {
    await page.evaluate(() => {
        window.musicBefore = {
            node: document.getElementById('siteAudio'),
            dock: document.querySelector('.music-dock').getBoundingClientRect().toJSON(),
            time: document.getElementById('siteAudio').currentTime,
            clock: performance.now(), events: []
        };
        window.musicListener = event => window.musicBefore.events.push(event.type);
        for (const name of ['pause', 'emptied', 'loadstart', 'waiting']) window.musicBefore.node.addEventListener(name, window.musicListener);
    });
    await action();
    await settled(page, destination);
    const result = await page.evaluate(() => {
        const audio = document.getElementById('siteAudio');
        const previous = window.musicBefore;
        for (const name of ['pause', 'emptied', 'loadstart', 'waiting']) audio.removeEventListener(name, window.musicListener);
        const dock = document.querySelector('.music-dock').getBoundingClientRect();
        return { same: audio === previous.node, samePosition: Math.abs(dock.left - previous.dock.left) < 1 && Math.abs(dock.top - previous.dock.top) < 1, elapsed: (performance.now() - previous.clock) / 1000, advanced: audio.currentTime - previous.time, paused: audio.paused, events: previous.events };
    });
    assert(result.same && !result.paused, `${destination}: audio node stays alive and playing`);
    assert(result.samePosition, `${destination}: player stays where it was dragged`);
    assert.deepEqual(result.events, [], `${destination}: no interruption or media reload`);
    assert(result.advanced >= result.elapsed - 0.6, `${destination}: playback clock progresses throughout navigation: ${JSON.stringify(result)}`);
}

async function run() {
    fs.mkdirSync(output, { recursive: true });
    assert.equal(new Set(library.tracks.map(track => track.id)).size, library.tracks.length);
    for (const track of library.tracks) {
        assert(library.artists.some(artist => artist.id === track.artistId));
        assert(track.duration > 0 && fs.statSync(path.join(root, track.src)).size < 25 * 1024 * 1024);
    }
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    await new Promise((resolve, reject) => {
        const validation = spawn(process.execPath, ['scripts/validate-life-http.cjs', `${base}/life.html`], { cwd: repository, stdio: 'inherit', windowsHide: true });
        validation.once('error', reject);
        validation.once('exit', code => code === 0 ? resolve() : reject(new Error('Life HTTP validation failed')));
    });
    const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'], ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }) });
    try {
        for (const [label, width, height, route, prefix] of [
            ['desktop', 1440, 1000, 'index.html', ''],
            ['mobile', 390, 844, 'life.html', '/preview'],
            ['narrow', 320, 740, 'index.html', '']
        ]) {
            const context = await browser.newContext({ viewport: { width, height }, isMobile: label !== 'desktop', hasTouch: label !== 'desktop', reducedMotion: label === 'desktop' ? 'no-preference' : 'reduce' });
            await context.route('**/*', request => request.request().url().startsWith(base) ? request.continue() : request.fulfill({ status: 200, body: '', contentType: 'text/plain' }));
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
            const mediaRequests = [];
            page.on('request', request => { if (request.url().endsWith('.m4a')) mediaRequests.push(request.url()); });
            await page.goto(`${base}${prefix}/${route}`, { waitUntil: 'domcontentloaded' });
            await page.locator('#musicQuickPlay').waitFor();
            await settled(page, route);
            const dock = await page.locator('.music-dock').boundingBox();
            const navigation = await contentFrame(page).locator(route === 'life.html' ? '.language-switch' : '.nav').boundingBox();
            assert(dock.y >= navigation.y + navigation.height && dock.y < 125, `${label}: player sits at the top right below page navigation`);
            assert(dock.x + dock.width >= width - 26 && dock.x + dock.width <= width, `${label}: player aligns to the right edge`);
            await page.screenshot({ path: path.join(output, `${label}-collapsed.png`), animations: 'disabled' });
            assert.equal(mediaRequests.length, 0, 'Audio is not downloaded before the first play');
            assert(await page.locator('#siteAudio').evaluate(audio => audio.paused), 'First visit never autoplays');
            await page.locator('#musicToggle').click();
            await page.locator('#musicTracks button').first().waitFor();
            assert.equal(await page.locator('#musicTracks button').count(), library.tracks.length);
            await page.evaluate(() => document.fonts.ready);
            await page.screenshot({ path: path.join(output, `${label}-player.png`), animations: 'disabled' });
            const bounds = await page.locator('#musicPanel').boundingBox();
            assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height, `${label}: panel fits viewport`);
            assert(bounds.y >= dock.y + dock.height, `${label}: player opens downward`);
            assert(await page.locator('#musicPlay svg path').count() > 0, 'Transport icon renders without an external SVG reference');
            if (route === 'life.html') {
                const controls = await contentFrame(page).locator('.galactic-tools').boundingBox();
                assert(dock.y + dock.height < controls.y, 'Music dock does not cover star-map controls');
            }
            await page.locator('#musicSearch').fill('克卜勒');
            assert.equal(await page.locator('#musicTracks button').count(), 1);
            await page.locator('#musicSearch').fill('没有这首歌xyz');
            assert(await page.locator('#musicEmpty').isVisible());
            await page.locator('#musicSearch').fill('');
            await page.locator('#musicClose').click();
            await startPlayback(page);
            await checkDragging(page, label);
            await page.evaluate(() => { document.getElementById('siteAudio').currentTime = 12; });
            await page.waitForFunction(() => document.getElementById('siteAudio').currentTime >= 12.2);

            if (route === 'index.html') {
                await continuity(page, () => contentFrame(page).locator('#lifePortalLink').click(), 'life.html');
                assert(new URL(page.url()).pathname.endsWith('/life.html'));
                await continuity(page, () => contentFrame(page).locator('.life-mark').click(), 'index.html');
                await continuity(page, () => page.goBack(), 'life.html');
                await continuity(page, () => page.goForward(), 'index.html');
            } else {
                await continuity(page, () => contentFrame(page).locator('.life-mark').click(), 'index.html');
                await continuity(page, () => contentFrame(page).locator('#lifePortalLink').click(), 'life.html');
                assert(new URL(page.url()).pathname.startsWith('/preview/'), 'Navigation keeps the project subdirectory');
            }

            await page.locator('#musicQuickPlay').click();
            const pausedTime = await page.locator('#siteAudio').evaluate(audio => audio.currentTime);
            await contentFrame(page).evaluate(() => window.SiteMusicNavigation(new URL('index.html', location.href).href));
            await settled(page, 'index.html');
            assert(await page.locator('#siteAudio').evaluate(audio => audio.paused));
            assert(Math.abs(await page.locator('#siteAudio').evaluate(audio => audio.currentTime) - pausedTime) < 0.1);
            await page.locator('#musicToggle').click();
            await page.locator('#musicVolume').fill('0.32');
            assert(Math.abs(await page.locator('#siteAudio').evaluate(audio => audio.volume) - 0.32) < 0.001);
            await page.locator('#musicMute').click();
            assert(await page.locator('#siteAudio').evaluate(audio => audio.muted));
            await page.locator('#musicMute').click();
            await page.locator('#musicSeek').fill('35');
            await page.waitForFunction(() => Math.abs(document.getElementById('siteAudio').currentTime - 35) < 0.3);
            await page.locator('#musicMode').click();
            assert.equal(await page.locator('#musicMode').getAttribute('data-mode'), 'one');
            await page.locator('#musicMode').click();
            assert.equal(await page.locator('#musicMode').getAttribute('data-mode'), 'shuffle');
            const previousTitle = await page.locator('#musicTitle').textContent();
            await page.locator('#musicNext').click();
            assert.notEqual(await page.locator('#musicTitle').textContent(), previousTitle);
            assert(await page.locator('#siteAudio').evaluate(audio => audio.paused), 'Skipping while paused stays paused');
            await page.locator('#musicMode').click();
            await page.locator('#musicTracks button').nth(2).click();
            await page.waitForFunction(() => !document.getElementById('siteAudio').paused && document.getElementById('siteAudio').currentTime > 0.1);
            await page.locator('#musicPlay').click();
            await page.locator('#musicSeek').fill('22');
            const title = await page.locator('#musicTitle').textContent();
            const savedDock = await page.locator('.music-dock').boundingBox();
            await page.reload({ waitUntil: 'domcontentloaded' });
            await settled(page, 'index.html');
            const restoredDock = await page.locator('.music-dock').boundingBox();
            assert(Math.abs(savedDock.x - restoredDock.x) < 1 && Math.abs(savedDock.y - restoredDock.y) < 1, 'Reload restores the dragged position');
            await page.waitForFunction(expected => document.getElementById('musicTitle')?.textContent === expected, title);
            assert(await page.locator('#siteAudio').evaluate(audio => audio.paused), 'Reload preserves paused state');
            await startPlayback(page);
            assert(await page.locator('#siteAudio').evaluate(audio => audio.currentTime >= 22), 'Reload restores playback position');
            await page.locator('#musicToggle').click();
            await page.screenshot({ path: path.join(output, `${label}-playing.png`), animations: 'disabled' });
            if (label === 'desktop') {
                await page.locator('#musicMode').click();
                await page.evaluate(() => { const audio = document.getElementById('siteAudio'); audio.currentTime = audio.duration - 0.25; });
                await page.waitForFunction(() => document.getElementById('siteAudio').currentTime < 2 && !document.getElementById('siteAudio').paused);
                assert.equal(await page.locator('#musicTitle').textContent(), title, 'Single-track loop repeats the current song');
                await page.locator('#musicMode').click();
                await page.evaluate(() => { const audio = document.getElementById('siteAudio'); audio.currentTime = audio.duration - 0.25; });
                await page.waitForFunction(previous => document.getElementById('musicTitle').textContent !== previous && !document.getElementById('siteAudio').paused, title);
                await page.locator('#musicMode').click();
                await page.locator('#musicTracks button').last().click();
                await page.waitForFunction(() => document.getElementById('siteAudio').readyState >= 3);
                await page.evaluate(() => { const audio = document.getElementById('siteAudio'); audio.currentTime = audio.duration - 0.25; });
                await page.waitForFunction(expected => document.getElementById('musicTitle').textContent === expected && !document.getElementById('siteAudio').paused, library.tracks[0].title);
            }
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#musicToggle').getAttribute('aria-expanded'), 'false');
            assert(await page.locator('#musicToggle').evaluate(button => document.activeElement === button), 'Escape restores focus');
            if (label === 'desktop') {
                await continuity(page, () => contentFrame(page).locator('a.nav-link[href="#publications"]').click(), 'index.html');
                assert.equal(new URL(page.url()).hash, '#publications', 'Page anchors stay visible in the address bar');
                await continuity(page, () => page.goBack(), 'index.html');
                await contentFrame(page).evaluate(() => setLang('zh-CN'));
                await page.waitForFunction(() => document.documentElement.lang === 'zh-CN' && document.title.includes('杨润德'));
                await continuity(page, () => contentFrame(page).evaluate(() => window.SiteMusicNavigation(new URL('observatory.html', location.href).href)), 'observatory.html');
                await continuity(page, () => contentFrame(page).locator('.life-mark').click(), 'index.html');
                const beforeReload = await page.locator('#siteAudio').evaluate(audio => audio.currentTime);
                await page.reload({ waitUntil: 'domcontentloaded' });
                await settled(page, 'index.html');
                await page.waitForFunction(() => {
                    const audio = document.getElementById('siteAudio');
                    return !audio.paused || document.getElementById('musicStatus').textContent.includes('继续');
                });
                if (await page.locator('#siteAudio').evaluate(audio => audio.paused)) await startPlayback(page);
                assert(await page.locator('#siteAudio').evaluate(audio => audio.currentTime) >= beforeReload - 0.5, 'Reload during playback resumes at the saved position');
            }
            await page.locator('#musicDrag').dblclick();
            const resetDock = await page.locator('.music-dock').boundingBox();
            assert(Math.abs(resetDock.x - dock.x) < 1 && Math.abs(resetDock.y - dock.y) < 1, 'Double-clicking the handle restores the default position');
            await context.close();
            console.log(`${label}: dragging, position persistence, playback, continuous navigation, history, pause, seeking, playlist, volume, modes, reload and layout passed`);
        }
        const context = await browser.newContext();
        await context.route('**/*.m4a', request => request.abort());
        const page = await context.newPage();
        await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
        await page.locator('#musicQuickPlay').click();
        await page.locator('#musicToggle').click();
        await page.waitForFunction(() => document.getElementById('musicStatus').textContent.includes('无法'));
        await context.unroute('**/*.m4a');
        await page.locator('#musicPlay').click();
        await page.waitForFunction(() => document.getElementById('siteAudio').currentTime > 0.2 && !document.getElementById('siteAudio').paused);
        assert(await page.locator('#musicStatus').isHidden(), 'Playback can recover after a failed audio request');
        await context.close();
        assert.deepEqual(errors, [], 'No browser JavaScript errors');
        console.log(`Music player validation passed (${library.tracks.length} tracks; screenshots in ${output}).`);
    } finally {
        await browser.close();
        server.close();
        server.closeAllConnections();
    }
}

run().catch(error => {
    console.error(error);
    server.close();
    server.closeAllConnections();
    process.exitCode = 1;
});
