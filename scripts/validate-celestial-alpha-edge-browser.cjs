'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><meta charset="utf-8"><canvas id="display"></canvas>');
        return;
    }
    if (!url.pathname.startsWith('/assets/')) {
        response.writeHead(404);
        response.end();
        return;
    }
    const filename = path.resolve(root, `.${url.pathname}`);
    if (!filename.startsWith(path.join(root, 'assets') + path.sep) || !fs.existsSync(filename)) {
        response.writeHead(404);
        response.end();
        return;
    }
    response.setHeader('Content-Type', 'text/javascript');
    fs.createReadStream(filename).pipe(response);
});

async function main() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ headless: true,
        ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : { channel: 'chrome' }) });
    const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.stack || error.message));
    try {
        await page.addInitScript(() => {
            window.COARSE_POINTER = false;
            window.REDUCED_MOTION = false;
            window.usesCompactSkyLayout = () => false;
            window.clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
        });
        await page.goto(baseUrl);
        await page.addScriptTag({ url: `${baseUrl}/assets/life/scripts/09-celestial-compositor.js` });
        await page.addScriptTag({ url: `${baseUrl}/assets/life/scripts/09-baked-closeup.js` });
        const result = await page.evaluate(() => {
            window.COARSE_POINTER = false;
            window.REDUCED_MOTION = false;
            window.usesCompactSkyLayout = () => false;
            window.clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
            const edgePixel = (data, width, height) => {
                const index = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4;
                return Array.from(data.slice(index, index + 4));
            };
            const source = document.createElement('canvas');
            source.width = 2;
            source.height = 1;
            const sourceContext = source.getContext('2d');
            sourceContext.fillStyle = '#fff';
            sourceContext.fillRect(0, 0, 1, 1);
            sourceContext.clearRect(1, 0, 1, 1);
            const layer = { key: 'edge', image: source, premultiplied: true,
                rectangle: { x: 0, y: 0, width: 1, height: 1 },
                framing: { x: 64, y: 64, radius: 48 }, axis: [0, 1, 0], angle: 0 };
            const compositor = new CelestialSphereCompositor();
            if (!compositor.gl) throw new Error('WebGL is required for the alpha-edge validation');
            const webglResult = compositor.render([layer], 128, 128);
            if (!webglResult) throw new Error('WebGL compositor could not render the alpha-edge sample');
            const webglCanvas = document.createElement('canvas');
            webglCanvas.width = 128;
            webglCanvas.height = 128;
            const webglContext = webglCanvas.getContext('2d', { willReadFrequently: true });
            webglContext.clearRect(0, 0, 128, 128);
            webglContext.drawImage(webglResult, 0, 0);
            const webglPixel = edgePixel(webglContext.getImageData(0, 0, 128, 128).data, 128, 128);
            const viewer = new BakedCelestialViewer();
            viewer.canvas = document.createElement('canvas');
            viewer.canvas.width = 128;
            viewer.canvas.height = 128;
            viewer.context = viewer.canvas.getContext('2d', { willReadFrequently: true });
            viewer.drawLayerFrames([layer]);
            const fallbackPixel = edgePixel(viewer.context.getImageData(0, 0, 128, 128).data, 128, 128);
            return { webglPixel, fallbackPixel };
        });
        for (const [name, pixel] of Object.entries(result)) {
            assert(pixel[3] >= 80 && pixel[3] <= 180, `${name} edge alpha must remain partial: ${pixel}`);
            assert(pixel[0] >= 220 && pixel[1] >= 220 && pixel[2] >= 220,
                `${name} premultiplied edge must not darken transparent black: ${pixel}`);
        }
        assert.equal(errors.length, 0, `Browser reported errors: ${errors.join('\n')}`);
        console.log(`Celestial alpha-edge browser validation passed: WebGL ${result.webglPixel.join(',')}; Canvas2D ${result.fallbackPixel.join(',')}.`);
    } finally {
        await browser.close();
        server.close();
    }
}

main().catch(error => {
    server.close();
    console.error(error.stack || error);
    process.exitCode = 1;
});
