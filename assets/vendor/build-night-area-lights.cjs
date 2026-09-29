const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

(async () => {
    const url = 'https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/lights/RectAreaLightUniformsLib.js';
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Area light dependency: HTTP ${response.status}`);
    const source = await response.text();
    const imports = source.match(/^import \{([\s\S]*?)\} from 'three';/);
    if (!imports) throw new Error('Unexpected upstream Three.js import');
    const body = source.replace(imports[0], `const {${imports[1]}} = window.THREE;`)
        .replace(/export \{ RectAreaLightUniformsLib \};\s*$/, 'window.NightAreaLightUniforms = RectAreaLightUniformsLib;');
    if (/^import\s|^export\s/m.test(body)) throw new Error('Untransformed module declaration');
    const output = `(function () {\n'use strict';\n${body}\n})();\n`;
    fs.writeFileSync(path.join(__dirname, 'night-area-lights-0.160.1.js'), output);
    console.log(JSON.stringify({ url, sourceSha256: crypto.createHash('sha256').update(source).digest('hex'),
        outputSha256: crypto.createHash('sha256').update(output).digest('hex'), bytes: Buffer.byteLength(output) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
