'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH
    || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const root = path.resolve(__dirname, '..');
const output = path.join(root, '.render-work', '3d-sky-environment');
const baseline = { window: {}, DEG: Math.PI / 180 };
vm.runInNewContext(execFileSync('git', ['show', '2dcb662:assets/life/scripts/19-star-map.js'], { cwd: root, encoding: 'utf8' }), baseline);
const baselinePrototype = Object.getPrototypeOf(baseline.window.lifeStarMap);
const originalMethods = Object.fromEntries(['view', 'project', 'orbit', 'pan', 'zoom', 'detailDestination']
    // Portal membership and placements may change; projection and controls stay stable.
    .map(name => [name, baselinePrototype[name].toString()]));
const checks = [], errors = [], measurements = [];
let pageUrl = process.argv.find(value => /^https?:\/\//.test(value)) || 'http://127.0.0.1:8787/life.html';
let server;
function check(condition, message, details) {
    assert(condition, details ? `${message}\n${JSON.stringify(details, null, 2)}` : message);
    checks.push(message);
    console.log(`PASS ${message}`);
}
function monitor(page, label, allowSkyErrors = false) {
    page.on('pageerror', error => errors.push(`${label}: ${error.stack || error.message}`));
    page.on('console', message => {
        if (allowSkyErrors && message.location().url?.includes('/assets/life/sky/')) return;
        if (message.type() === 'error' && !message.location().url?.endsWith('/favicon.ico')) errors.push(`${label}: ${message.text()}`);
    });
}
async function settle(page) {
    await page.waitForFunction(() => {
        const map = window.lifeStarMap;
        return map && !map.flight && !map.pendingGalaxy && !map.currentView?.moving
            && Math.abs(map.distance - map.target.distance) < 0.15
            && Math.abs(map.yaw - map.target.yaw) < 0.003
            && Math.abs(map.pitch - map.target.pitch) < 0.003
            && map.center.every((value, axis) => Math.abs(value - map.target.center[axis]) < 0.15);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function load(page, waitForSky = true) {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.lifeStarMap?.initialized && window.lifeStarMap.lastFrame > 0);
    await page.waitForFunction(() => Array.from(document.querySelectorAll('link[href*="assets/life/styles/"]')).every(link => Boolean(link.sheet)));
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    if (waitForSky) await page.evaluate(() => window.lifeStarMap.renderer.skyAssetsPromise);
    await settle(page);
}
async function screenshot(page, name) {
    await page.screenshot({ path: path.join(output, `${name}.png`) });
}

async function geometryChecks(page) {
    const parity = await page.evaluate(({ methods, buildStars }) => {
        const map = window.lifeStarMap;
        const changed = Object.keys(methods).filter(name => LifeStarMap.prototype[name].toString().replace(/\s+/g, ' ') !== methods[name].replace(/\s+/g, ' '));
        const original = eval(`(function ${buildStars})`).call(map);
        const current = map.renderer.stars;
        const preserved = original.every((value, index) => current[index] === value);
        const environment = [];
        for (let offset = 0; offset < current.length; offset += 9) {
            if (current[offset + 8] === 3) environment.push(Math.hypot(...current.slice(offset, offset + 3)));
        }
        return { changed, preserved, originalCount: original.length / 9, environmentCount: environment.length,
            beyondLocal: environment.filter(radius => radius > 220).length,
            beyondVolume: environment.filter(radius => radius > 620).length,
            near: Math.min(...environment), far: Math.max(...environment),
            radialBins: new Set(environment.map(radius => Math.floor(radius / 100))).size };
    }, { methods: originalMethods, buildStars: baselinePrototype.buildStars.toString() });
    check(parity.changed.length === 0, 'Original projection and camera controls are unchanged', parity.changed);
    check(parity.preserved && parity.originalCount > 5000, 'All original catalog and constellation star records are preserved exactly', parity);
    check(parity.environmentCount > 1000 && parity.beyondLocal > 1000 && parity.beyondVolume > 500,
        'Thousands of finite-distance arm stars continue beyond the original local sphere', parity);
    check(Number.isFinite(parity.far) && parity.radialBins > 10 && parity.far > parity.near * 3,
        'Environment stars span depth rather than occupying a spherical shell', parity);
    measurements.push({ name: 'geometry', ...parity });

    const initial = await page.evaluate(() => ({ fov: window.lifeStarMap.currentView.fov, position: [...window.lifeStarMap.currentView.position] }));
    await page.evaluate(() => { window.lifeStarMap.target.distance = 160; });
    await settle(page);
    const close = await page.evaluate(() => ({ fov: window.lifeStarMap.currentView.fov, position: [...window.lifeStarMap.currentView.position] }));
    check(Math.abs(close.fov - initial.fov) < 0.001 && Math.hypot(...close.position) > 50
        && Math.hypot(...close.position.map((value, axis) => value - initial.position[axis])) > 200,
    'Local zoom moves the 3-D camera while preserving its field of view');
    await page.evaluate(() => window.lifeStarMap.reset());
    await settle(page);
    const pan = await page.evaluate(() => {
        const map = window.lifeStarMap, beforeView = map.view();
        const near = [0, 0, 0];
        const far = beforeView.position.map((value, axis) => value + beforeView.forward[axis] * 2200);
        const nearBefore = map.project(near, beforeView), farBefore = map.project(far, beforeView);
        map.pan(80, 0);
        const afterView = map.view();
        return { camera: Math.hypot(...afterView.position.map((value, axis) => value - beforeView.position[axis])),
            nearShift: map.project(near, afterView).x - nearBefore.x, farShift: map.project(far, afterView).x - farBefore.x };
    });
    check(pan.camera > 10 && Math.abs(pan.farShift) > 2 && Math.abs(pan.nearShift) > Math.abs(pan.farShift) * 3,
        'Pan translates the camera with stronger parallax for nearby objects', pan);
    await page.evaluate(() => window.lifeStarMap.reset());
    await settle(page);
}

async function cloudChecks(page) {
    const result = await page.evaluate(() => {
        const map = window.lifeStarMap, renderer = map.renderer, graphics = renderer.gl;
        const saved = { stars: renderer.stars, sky: renderer.skyUploaded, strength: renderer.environmentStrength };
        const view = { position: [0, 180, 610], right: [-1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], fov: map.fov, galaxy: 0 };
        const capture = (strength, camera = view.position) => {
            renderer.environmentStrength = strength;
            renderer.render({ ...view, position: camera });
            const pixels = new Uint8Array(renderer.canvas.width * renderer.canvas.height * 4);
            graphics.readPixels(0, 0, renderer.canvas.width, renderer.canvas.height, graphics.RGBA, graphics.UNSIGNED_BYTE, pixels);
            return pixels;
        };
        const difference = (a, b) => {
            let changed = 0, sum = 0, peak = 0;
            for (let offset = 0; offset < a.length; offset += 4) {
                const delta = Math.abs(a[offset] - b[offset]) + Math.abs(a[offset + 1] - b[offset + 1]) + Math.abs(a[offset + 2] - b[offset + 2]);
                if (delta > 3) changed++;
                sum += delta; peak = Math.max(peak, delta);
            }
            return { changed, mean: sum / (a.length / 4), peak };
        };
        try {
            renderer.stars = new Float32Array(); renderer.skyUploaded = false;
            graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
            graphics.bufferData(graphics.ARRAY_BUFFER, renderer.stars, graphics.STATIC_DRAW);
            const empty = capture(0), emptyImage = renderer.canvas.toDataURL();
            const full = capture(1), fullImage = renderer.canvas.toDataURL();
            const translated = capture(1, [130, 180, 610]);
            return { volume: difference(full, empty), translation: difference(full, translated), error: graphics.getError(), pixels: full.length / 4,
                images: { 'off-sphere-without-environment': emptyImage, 'off-sphere-clouds': fullImage } };
        } finally {
            renderer.stars = saved.stars; renderer.skyUploaded = saved.sky; renderer.environmentStrength = saved.strength;
            graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
            graphics.bufferData(graphics.ARRAY_BUFFER, saved.stars, graphics.STATIC_DRAW);
            renderer.render(map.currentView);
        }
    });
    check(result.error === 0, 'Extended cloud rendering completes without WebGL errors');
    check(result.volume.changed > result.pixels * 0.02 && result.volume.peak > 8,
        'Volumetric clouds remain visible on rays pointing away from the old 620-unit volume', result.volume);
    check(result.translation.changed > result.pixels * 0.005 && result.translation.peak > 3,
        'Extended clouds respond to camera translation, preserving spatial depth', result.translation);
    for (const [name, dataUrl] of Object.entries(result.images)) fs.writeFileSync(path.join(output, `${name}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    delete result.images;
    measurements.push({ name: 'clouds', ...result });
}

async function outerFieldChecks(page, device) {
    const result = await page.evaluate(() => {
        const map = window.lifeStarMap, renderer = map.renderer, graphics = renderer.gl;
        const saved = { stars: renderer.stars, sky: renderer.skyUploaded };
        const view = { ...map.currentView, position: map.currentView.position.map(value => value * 610 / map.distance), moving: false };
        const capture = () => {
            renderer.render(view);
            const pixels = new Uint8Array(renderer.canvas.width * renderer.canvas.height * 4);
            graphics.readPixels(0, 0, renderer.canvas.width, renderer.canvas.height, graphics.RGBA, graphics.UNSIGNED_BYTE, pixels);
            return pixels;
        };
        try {
            const bright = capture();
            const dim = saved.stars.map((value, index) => index % 9 === 6 && saved.stars[index + 2] === 3 ? 0 : value);
            graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
            graphics.bufferData(graphics.ARRAY_BUFFER, dim, graphics.STATIC_DRAW);
            const dark = capture();
            const width = renderer.canvas.width, height = renderer.canvas.height;
            let area = 0, visible = 0, clear = 0;
            const sectors = new Set(), availableSectors = new Set();
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
                // The local catalogue's projected sphere fits within this mask.
                // Measure actual contrast outside it against all other layers.
                const dx = x - width * 0.5, dy = y - height * 0.5;
                if (Math.hypot(dx, dy) < height * 0.38) continue;
                area++;
                const sector = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4)) % 8;
                availableSectors.add(sector);
                const offset = (y * width + x) * 4;
                const difference = Math.max(...[0, 1, 2].map(channel => bright[offset + channel] - dark[offset + channel]));
                if (difference > 12) visible++;
                if (difference > 30) {
                    clear++;
                    sectors.add(sector);
                }
            }
            return { area, visible, clear, sectors: sectors.size, availableSectors: availableSectors.size, error: graphics.getError() };
        } finally {
            renderer.skyUploaded = saved.sky;
            graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
            graphics.bufferData(graphics.ARRAY_BUFFER, saved.stars, graphics.STATIC_DRAW);
            renderer.render(map.currentView);
        }
    });
    check(result.error === 0 && result.visible > result.area * 0.002 && result.clear > result.area * 0.0005,
        `${device}: finite arm stars are visibly brighter than the surrounding clouds outside the local sphere`, result);
    check(result.sectors >= Math.min(6, result.availableSectors),
        `${device}: visible outer stars extend around the visible perimeter rather than one arm only`, result);
    measurements.push({ name: `${device}-outer-star-contrast`, ...result });
}

async function farSkyChecks(page) {
    const result = await page.evaluate(() => {
        const map = window.lifeStarMap, renderer = map.renderer, graphics = renderer.gl;
        const saved = { stars: renderer.stars, sky: renderer.skyUploaded };
        const results = [];
        try {
            renderer.stars = new Float32Array();
            graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
            graphics.bufferData(graphics.ARRAY_BUFFER, renderer.stars, graphics.STATIC_DRAW);
            for (const longitude of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
                const latitude = Math.PI / 6;
                const forward = [Math.sin(longitude) * Math.cos(latitude), Math.sin(latitude), Math.cos(longitude) * Math.cos(latitude)];
                const right = [Math.cos(longitude), 0, -Math.sin(longitude)];
                const up = cross(forward, right);
                const view = { position: [0, 180, 430], forward, right, up, fov: Math.PI / 12, galaxy: 0, moving: false };
                const capture = sky => {
                    renderer.skyUploaded = sky; renderer.render(view);
                    const pixels = new Uint8Array(renderer.canvas.width * renderer.canvas.height * 4);
                    graphics.readPixels(0, 0, renderer.canvas.width, renderer.canvas.height, graphics.RGBA, graphics.UNSIGNED_BYTE, pixels);
                    return pixels;
                };
                const full = capture(true), blank = capture(false);
                let changed = 0, peak = 0;
                for (let offset = 0; offset < full.length; offset += 4) {
                    const delta = Math.max(full[offset] - blank[offset], full[offset + 1] - blank[offset + 1], full[offset + 2] - blank[offset + 2]);
                    if (delta > 3) changed++;
                    peak = Math.max(peak, delta);
                }
                results.push({ longitude, fraction: changed / (full.length / 4), peak });
            }
            return { directions: results, error: graphics.getError() };
        } finally {
            renderer.stars = saved.stars; renderer.skyUploaded = saved.sky;
            graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
            graphics.bufferData(graphics.ARRAY_BUFFER, saved.stars, graphics.STATIC_DRAW);
            renderer.render(map.currentView);
        }
    });
    check(result.error === 0 && result.directions.every(direction => direction.fraction > 0.05 && direction.peak > 8),
        'The real all-sky panorama remains visible away from the Galactic plane in all four directions', result);
    measurements.push({ name: 'all-sky-coverage', ...result });
}

async function renderedParallaxChecks(page) {
    const result = await page.evaluate(() => {
        const map = window.lifeStarMap, renderer = map.renderer, graphics = renderer.gl;
        const saved = { stars: renderer.stars, drawQuad: renderer.drawQuad, strength: renderer.environmentStrength };
        const view = { position: [0, 0, 430], right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1], fov: map.fov, galaxy: 0 };
        const centroid = position => {
            renderer.render({ ...view, position });
            const width = renderer.canvas.width, height = renderer.canvas.height;
            const pixels = new Uint8Array(width * height * 4);
            graphics.readPixels(0, 0, width, height, graphics.RGBA, graphics.UNSIGNED_BYTE, pixels);
            let light = 0, weighted = 0;
            for (let offset = 0; offset < pixels.length; offset += 4) {
                const value = pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
                light += value; weighted += (offset / 4 % width) * value;
            }
            return { x: weighted / light, light };
        };
        try {
            renderer.stars = new Float32Array([0, 0, -1470, 0.9, 0.92, 1, 3, 15, 3]);
            graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
            graphics.bufferData(graphics.ARRAY_BUFFER, renderer.stars, graphics.STATIC_DRAW);
            renderer.environmentStrength = 1;
            renderer.drawQuad = () => { graphics.clearColor(0, 0, 0, 1); graphics.clear(graphics.COLOR_BUFFER_BIT); };
            const before = centroid([0, 0, 430]), after = centroid([80, 0, 430]);
            return { before, after, shift: after.x - before.x,
                expected: -renderer.canvas.height * 0.5 / Math.tan(view.fov * 0.5) * 80 / 1900, error: graphics.getError() };
        } finally {
            renderer.stars = saved.stars; renderer.drawQuad = saved.drawQuad; renderer.environmentStrength = saved.strength;
            graphics.bindBuffer(graphics.ARRAY_BUFFER, renderer.starBuffer);
            graphics.bufferData(graphics.ARRAY_BUFFER, saved.stars, graphics.STATIC_DRAW);
            renderer.render(map.currentView);
        }
    });
    check(result.error === 0 && result.before.light > 20 && result.after.light > 20,
        'The finite environment star type renders on the GPU', result);
    check(Math.abs(result.shift - result.expected) < 2 && Math.abs(result.shift) > 10,
        'Rendered environment stars show the expected finite-distance parallax', result);
    measurements.push({ name: 'rendered-parallax', ...result });
}

async function overviewChecks(page) {
    await page.evaluate(() => window.lifeStarMap.showGalaxy());
    await page.waitForFunction(() => window.lifeStarMap.mapLevel === 'galaxy');
    await settle(page);
    const result = await page.evaluate(() => {
        const map = window.lifeStarMap, renderer = map.renderer, graphics = renderer.gl;
        const saved = renderer.environmentStrength;
        const capture = strength => {
            renderer.environmentStrength = strength; renderer.render(map.currentView);
            const pixels = new Uint8Array(renderer.canvas.width * renderer.canvas.height * 4);
            graphics.readPixels(0, 0, renderer.canvas.width, renderer.canvas.height, graphics.RGBA, graphics.UNSIGNED_BYTE, pixels);
            return pixels;
        };
        try {
            const withEnvironment = capture(1), withoutEnvironment = capture(0);
            let delta = 0;
            for (let index = 0; index < withEnvironment.length; index++) delta += Math.abs(withEnvironment[index] - withoutEnvironment[index]);
            return { delta, mix: map.galaxyMix, error: graphics.getError() };
        } finally { renderer.environmentStrength = saved; renderer.render(map.currentView); }
    });
    check(result.mix === 1 && result.error === 0 && result.delta === 0,
        'Finite arm stars and clouds fade completely at the external galaxy overview', result);
    await screenshot(page, 'galaxy-overview');
    await page.evaluate(() => window.lifeStarMap.showLocal());
    await settle(page);
    const skyBeforeRecovery = await page.evaluate(() => {
        const renderer = window.lifeStarMap.renderer;
        return { uploaded: renderer.skyUploaded, width: renderer.skyTextureWidth, version: renderer.skyVersion };
    });
    const recoverable = await page.evaluate(() => {
        const renderer = window.lifeStarMap.renderer;
        const extension = renderer.gl.getExtension('WEBGL_lose_context');
        if (!extension) return false;
        window.environmentRecovery = extension; extension.loseContext(); return true;
    });
    check(recoverable, 'WebGL context loss can be tested');
    await page.waitForFunction(() => !window.lifeStarMap.renderer.ready);
    await page.evaluate(() => window.environmentRecovery.restoreContext());
    await page.waitForFunction(() => window.lifeStarMap.renderer.ready);
    if (skyBeforeRecovery.uploaded) {
        await page.waitForFunction(before => {
            const renderer = window.lifeStarMap.renderer;
            return renderer.skyUploaded && renderer.skyTextureWidth === before.width && renderer.skyVersion > before.version;
        }, skyBeforeRecovery);
        check(true, 'Context recovery restores the photographic far field at its original resolution');
    }
    await settle(page);
    check(await page.evaluate(() => { const renderer = window.lifeStarMap.renderer; renderer.render(window.lifeStarMap.currentView); return renderer.gl.getError() === 0 && renderer.stars.some((value, index) => index % 9 === 8 && value === 3); }),
        'Context recovery preserves the finite environment and valid rendering');
}

async function visualCaptures(page, name) {
    await screenshot(page, `${name}-default`);
    await page.evaluate(() => { window.lifeStarMap.target.distance = 610; });
    await settle(page); await screenshot(page, `${name}-local-boundary`);
    if (name === 'desktop') {
        for (const [label, pitch, yaw] of [['edge', 0, 0], ['side', 0.35, Math.PI / 2], ['above', 1.15, 0.8]]) {
            await page.evaluate(({ pitch, yaw }) => { window.lifeStarMap.target.pitch = pitch; window.lifeStarMap.target.yaw = yaw; }, { pitch, yaw });
            await settle(page); await screenshot(page, `${name}-${label}`);
        }
        await page.evaluate(() => window.lifeStarMap.reset()); await settle(page);
        await page.evaluate(() => window.lifeStarMap.pan(-350, 0)); await settle(page);
        await screenshot(page, `${name}-pan-boundary`);
    }
    await page.evaluate(() => window.lifeStarMap.reset()); await settle(page);
}

async function fallbackChecks() {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl'] });
    try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
        monitor(page, 'fallback'); await load(page);
        check(await page.evaluate(() => !window.lifeStarMap.renderer.ready && !window.lifeStarMap.renderer.fallbackCanvas.hidden),
            'Without WebGL the local 3-D map remains visible through Canvas');
        const before = await page.evaluate(() => window.lifeStarMap.snapshot());
        await page.evaluate(() => { window.lifeStarMap.orbit(80, 0); window.lifeStarMap.pan(40, 0); }); await settle(page);
        const after = await page.evaluate(() => window.lifeStarMap.snapshot());
        check(Math.abs(after.yaw - before.yaw) > 0.1 && after.center.some((value, axis) => Math.abs(value - before.center[axis]) > 1),
            'Canvas fallback retains orbit and translation controls');
        const environment = await page.evaluate(() => {
            const map = window.lifeStarMap, renderer = map.renderer;
            const saved = { stars: renderer.stars, sky: renderer.skyImage, strength: renderer.environmentStrength };
            const view = { position: [0, 180, 610], right: [-1, 0, 0], up: [0, 1, 0], forward: [0, 0, 1], fov: map.fov, galaxy: 0 };
            const capture = strength => {
                renderer.environmentStrength = strength; renderer.renderFallback(view);
                return renderer.fallback.getImageData(0, 0, renderer.fallbackCanvas.width, renderer.fallbackCanvas.height).data;
            };
            try {
                renderer.stars = new Float32Array(); renderer.skyImage = null;
                const without = capture(0), withClouds = capture(1);
                let changed = 0;
                for (let offset = 0; offset < without.length; offset += 4) {
                    if (Math.abs(without[offset] - withClouds[offset]) + Math.abs(without[offset + 1] - withClouds[offset + 1])
                        + Math.abs(without[offset + 2] - withClouds[offset + 2]) > 3) changed++;
                }
                return { changed, pixels: without.length / 4 };
            } finally {
                renderer.stars = saved.stars; renderer.skyImage = saved.sky; renderer.environmentStrength = saved.strength;
                renderer.renderFallback(map.currentView);
            }
        });
        check(environment.changed > environment.pixels * 0.01, 'Canvas fallback also renders clouds beyond the original local volume', environment);
        await screenshot(page, 'canvas-fallback');
    } finally { await browser.close(); }
}

async function skyLoadingChecks(browser) {
    const failureContext = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
    try {
        const page = await failureContext.newPage(); monitor(page, 'sky-http-failure', true);
        await page.route('**/assets/life/sky/*.webp?*', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Intentional missing sky asset' }));
        await load(page);
        check(await page.evaluate(() => {
            const map = window.lifeStarMap, renderer = map.renderer;
            return renderer.ready && !renderer.skyUploaded && map.localCount > 5000 && renderer.environmentStarCount > 1000;
        }), 'Failed photographic sky requests preserve the original 3-D map and finite arm environment');
        const before = await page.evaluate(() => window.lifeStarMap.snapshot());
        await page.evaluate(() => { window.lifeStarMap.orbit(40, 0); window.lifeStarMap.pan(40, 0); window.lifeStarMap.zoom(-40); });
        await settle(page);
        const after = await page.evaluate(() => window.lifeStarMap.snapshot());
        check(Math.abs(after.yaw - before.yaw) > 0.1 && after.distance < before.distance
            && after.center.some((value, axis) => Math.abs(value - before.center[axis]) > 1),
        'Orbit, pan and zoom remain usable when photographic assets fail');
        await page.evaluate(() => window.lifeStarMap.showGalaxy()); await settle(page);
        check(await page.evaluate(() => window.lifeStarMap.mapLevel === 'galaxy'
            && window.lifeStarMap.renderer.galacticUploadVersion === window.lifeStarMap.renderer.assetVersion),
        'Photographic asset failure does not block the external galaxy transition');
    } finally { await failureContext.close(); }

    const delayedContext = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce' });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    try {
        const page = await delayedContext.newPage(); monitor(page, 'delayed-sky');
        await page.route('**/assets/life/sky/*.webp?*', async route => { await gate; await route.continue(); });
        await load(page, false);
        check(await page.evaluate(() => window.lifeStarMap.renderer.ready && !window.lifeStarMap.renderer.skyUploaded),
            'Slow photographic requests leave the local 3-D map immediately usable');
        const before = await page.evaluate(() => {
            const map = window.lifeStarMap, renderer = map.renderer, render = renderer.render;
            renderer.render = function(view) {
                this.testRenderedSkyVersion = this.skyVersion;
                this.testRenderedSkyUploaded = this.skyUploaded;
                return render.call(this, view);
            };
            return map.snapshot();
        });
        release();
        await page.evaluate(() => window.lifeStarMap.renderer.skyAssetsPromise);
        await page.waitForFunction(() => {
            const renderer = window.lifeStarMap.renderer;
            return renderer.skyUploaded && renderer.testRenderedSkyUploaded
                && renderer.testRenderedSkyVersion === renderer.skyVersion && renderer.skyVersion > 0;
        });
        const after = await page.evaluate(() => window.lifeStarMap.snapshot());
        check(JSON.stringify(after) === JSON.stringify(before),
            'A newly decoded sky redraws a stationary camera without requiring user input');
    } finally { release(); await delayedContext.close(); }
}

async function serveRepository() {
    server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        const filename = path.resolve(root, `.${pathname}`), relative = path.relative(root, filename);
        if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403).end(); return; }
        fs.stat(filename, (error, stats) => {
            if (error || !stats.isFile()) { response.writeHead(404).end(); return; }
            response.writeHead(200, { 'Content-Type': { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            fs.createReadStream(filename).pipe(response);
        });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    pageUrl = `http://127.0.0.1:${server.address().port}/life.html`;
}

(async () => {
    fs.mkdirSync(output, { recursive: true });
    if (process.argv.includes('--serve')) await serveRepository();
    const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }),
        args: ['--enable-unsafe-swiftshader'] });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
        const page = await context.newPage(); monitor(page, 'desktop'); await load(page);
        check(await page.evaluate(() => window.lifeStarMap.renderer.ready), 'Desktop initializes the WebGL renderer');
        await geometryChecks(page); await cloudChecks(page); await renderedParallaxChecks(page);
        await outerFieldChecks(page, 'Desktop'); await farSkyChecks(page);
        await visualCaptures(page, 'desktop'); await overviewChecks(page); await context.close();
        const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
        const mobile = await mobileContext.newPage(); monitor(mobile, 'mobile'); await load(mobile);
        check(await mobile.evaluate(() => window.lifeStarMap.renderer.ready), 'Mobile viewport initializes the WebGL environment');
        await outerFieldChecks(mobile, 'Mobile');
        await visualCaptures(mobile, 'mobile'); await mobileContext.close();
        await skyLoadingChecks(browser);
    } finally { await browser.close(); }
    await fallbackChecks();
    assert.deepEqual(errors, [], '3-D environment workflows must complete without browser errors');
    fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2) + '\n');
    console.log(`3-D sky environment validation passed (${checks.length} checks; screenshots in ${output}).`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { server?.closeAllConnections(); server?.close(); });
