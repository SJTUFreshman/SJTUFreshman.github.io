const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const sourceId = 'pine_sapling_small';
const outputId = 'pine_sapling_small_variant_01';
const selectedMesh = 0;
const expected = {
    gltf: '237a7672645631550ae571743aa9f55b',
    buffer: '76dd1802d8de128c812f2e124a258b35'
};
const hash = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');

async function response(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const result = await fetch(url);
            if (!result.ok) throw new Error(`HTTP ${result.status}: ${url}`);
            return result;
        } catch (error) {
            if (attempt === 2) throw error;
        }
    }
}

(async () => {
    const api = await (await response(`https://api.polyhaven.com/files/${sourceId}`)).json();
    const entry = api.gltf['1k'].gltf;
    assert.equal(entry.md5, expected.gltf, 'Upstream descriptor changed; review before repacking');
    assert.equal(entry.include[sourceId + '.bin'].md5, expected.buffer, 'Upstream geometry changed; review before repacking');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'night-pine-source-'));
    const records = [[sourceId + '_1k.gltf', entry], ...Object.entries(entry.include)];
    await Promise.all(records.map(async ([relative, record]) => {
        const bytes = Buffer.from(await (await response(record.url)).arrayBuffer());
        assert.equal(bytes.length, record.size, `Upstream size mismatch: ${relative}`);
        assert.equal(hash(bytes, 'md5'), record.md5, `Upstream checksum mismatch: ${relative}`);
        const target = path.resolve(temporary, relative);
        assert(target.startsWith(temporary + path.sep), 'Asset path must remain inside the temporary directory');
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.writeFileSync(target, bytes);
    }));

    const gltf = JSON.parse(fs.readFileSync(path.join(temporary, sourceId + '_1k.gltf'), 'utf8'));
    const sourceBuffer = fs.readFileSync(path.join(temporary, sourceId + '.bin'));
    const mesh = structuredClone(gltf.meshes[selectedMesh]);
    const node = structuredClone(gltf.nodes.find(item => item.mesh === selectedMesh));
    assert.equal(node.name, 'pine_sapling_small_b');
    delete node.translation;
    node.mesh = 0;
    const accessors = [], bufferViews = [], chunks = [];
    const accessorMap = new Map(), bufferViewMap = new Map();
    let offset = 0, triangleCount = 0;
    function remapAccessor(index) {
        if (accessorMap.has(index)) return accessorMap.get(index);
        const accessor = structuredClone(gltf.accessors[index]);
        assert(!accessor.sparse, 'Sparse accessor requires explicit preservation');
        const sourceView = accessor.bufferView;
        if (!bufferViewMap.has(sourceView)) {
            const view = structuredClone(gltf.bufferViews[sourceView]);
            assert.equal(view.buffer, 0);
            const padding = (4 - offset % 4) % 4;
            if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding; }
            const bytes = sourceBuffer.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
            chunks.push(bytes);
            view.byteOffset = offset;
            offset += bytes.length;
            bufferViewMap.set(sourceView, bufferViews.length);
            bufferViews.push(view);
        }
        accessor.bufferView = bufferViewMap.get(sourceView);
        const target = accessors.length;
        accessorMap.set(index, target);
        accessors.push(accessor);
        return target;
    }
    for (const primitive of mesh.primitives) {
        assert.equal(primitive.mode ?? 4, 4, 'Expected ordinary triangle geometry');
        assert(!primitive.targets, 'Morph targets require explicit remapping');
        triangleCount += gltf.accessors[primitive.indices].count / 3;
        primitive.indices = remapAccessor(primitive.indices);
        for (const attribute of Object.keys(primitive.attributes)) {
            primitive.attributes[attribute] = remapAccessor(primitive.attributes[attribute]);
        }
    }
    const buffer = Buffer.concat(chunks);
    const result = {
        ...gltf,
        asset: {...gltf.asset, extras: {source: entry.url, license: 'CC0-1.0', extraction: 'Only pine_sapling_small_b; presentation X translation removed; geometry/material bytes unchanged'}},
        scene: 0, scenes: [{name: outputId, nodes: [0]}], nodes: [node], meshes: [mesh],
        accessors, bufferViews, buffers: [{byteLength: buffer.length, uri: outputId + '.bin'}]
    };
    const descriptor = Buffer.from(JSON.stringify(result, null, 2) + '\n');
    const imageFiles = result.images.map(image => image.uri);
    const payload = descriptor.length + buffer.length + imageFiles.reduce((sum, relative) => sum + fs.statSync(path.join(temporary, relative)).size, 0);
    assert(triangleCount <= 150000, 'Variant exceeds the triangle budget');
    assert(payload <= 10000000, 'Variant exceeds the ten-megabyte budget');
    const output = path.join(__dirname, outputId);
    fs.mkdirSync(output, {recursive: true});
    fs.writeFileSync(path.join(output, outputId + '_1k.gltf'), descriptor);
    fs.writeFileSync(path.join(output, outputId + '.bin'), buffer);
    for (const relative of imageFiles) {
        fs.mkdirSync(path.dirname(path.join(output, relative)), {recursive: true});
        fs.copyFileSync(path.join(temporary, relative), path.join(output, relative));
    }
    console.log(JSON.stringify({outputId,sourceTemporary:temporary,triangleCount,payload,files:[
        {path:outputId+'_1k.gltf',bytes:descriptor.length,sha256:hash(descriptor)},
        {path:outputId+'.bin',bytes:buffer.length,sha256:hash(buffer)},
        ...imageFiles.map(relative => {const bytes=fs.readFileSync(path.join(output,relative));return {path:relative,bytes:bytes.length,sha256:hash(bytes),source:entry.include[relative].url};})
    ]}, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
