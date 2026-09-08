/* Rebuild the classic r160 loader from the matching official MIT sources. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const origin = 'https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/';
async function source(file) {
    const response = await fetch(origin + file);
    if (!response.ok) throw new Error(`${response.status}: ${file}`);
    const text = await response.text();
    console.log(file, Buffer.byteLength(text), crypto.createHash('sha256').update(text).digest('hex'));
    return text;
}

(async () => {
    const [loader, utility] = await Promise.all([
        source('loaders/GLTFLoader.js'), source('utils/BufferGeometryUtils.js')
    ]);
    const importMatch = loader.match(/^import \{([\s\S]*?)\} from 'three';/);
    if (!importMatch) throw new Error('Unexpected upstream Three.js import');
    const start = utility.indexOf('function toTrianglesDrawMode(');
    const finish = utility.indexOf('\n/**', start);
    if (start < 0 || finish < start) throw new Error('Unexpected upstream utility boundary');
    const body = loader
        .replace(importMatch[0], `const {${importMatch[1]}} = window.THREE;`)
        .replace("import { toTrianglesDrawMode } from '../utils/BufferGeometryUtils.js';", '')
        .replace(/export \{ GLTFLoader \};\s*$/, 'window.NightGLTFLoader = GLTFLoader;');
    if (/^import\s|^export\s/m.test(body)) throw new Error('Untransformed module declaration');
    const output = '/* Three.js 0.160.1 GLTFLoader + toTrianglesDrawMode. MIT; see THREE-LICENSE.txt.\n' +
        ' * Mechanical classic-script adaptation: engine symbols come from existing window.THREE.\n' +
        ' * Sources/build process: assets/life/ASSETS.md and build-night-gltf-loader.cjs. */\n' +
        '(function () {\n\'use strict\';\nif (!window.THREE) return;\n' +
        'const { TrianglesDrawMode } = window.THREE;\n' +
        utility.slice(start, finish).trim() + '\n\n' + body + '\n})();\n';
    const target = path.join(__dirname, 'night-gltf-loader-0.160.1.js');
    fs.writeFileSync(target, output);
    console.log(path.basename(target), Buffer.byteLength(output), crypto.createHash('sha256').update(output).digest('hex'));
})().catch(error => { console.error(error); process.exitCode = 1; });
