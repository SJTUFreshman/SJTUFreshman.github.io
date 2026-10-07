'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeGl() {
    const calls = [];
    let identifier = 0;
    const gl = {
        calls,
        VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
        ARRAY_BUFFER: 5, STATIC_DRAW: 6, TEXTURE_2D: 7, TEXTURE_MIN_FILTER: 8,
        TEXTURE_MAG_FILTER: 9, LINEAR: 10, TEXTURE_WRAP_S: 11, TEXTURE_WRAP_T: 12,
        CLAMP_TO_EDGE: 13, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 14, UNPACK_FLIP_Y_WEBGL: 15,
        RGBA: 16, UNSIGNED_BYTE: 17, COLOR_BUFFER_BIT: 18, TRIANGLES: 19,
        BLEND: 20, ONE: 21, ONE_MINUS_SRC_ALPHA: 22, TEXTURE0: 23, TEXTURE1: 24, FLOAT: 25,
        createShader(type) { return { type, id: ++identifier }; },
        shaderSource(shader, source) { calls.push(['shaderSource', shader, source]); },
        compileShader(shader) { calls.push(['compileShader', shader]); },
        getShaderParameter() { return true; },
        getShaderInfoLog() { return ''; },
        createProgram() { return { id: ++identifier }; },
        attachShader() {},
        linkProgram() {},
        getProgramParameter() { return true; },
        getProgramInfoLog() { return ''; },
        getUniformLocation(program, name) { return { program, name }; },
        getAttribLocation(program, name) { return { program, name }; },
        createBuffer() { return { id: ++identifier }; },
        bindBuffer(...args) { calls.push(['bindBuffer', ...args]); },
        bufferData(...args) { calls.push(['bufferData', ...args]); },
        deleteShader(shader) { calls.push(['deleteShader', shader]); },
        deleteProgram(program) { calls.push(['deleteProgram', program]); },
        deleteBuffer(buffer) { calls.push(['deleteBuffer', buffer]); },
        createTexture() { return { id: ++identifier }; },
        bindTexture(...args) { calls.push(['bindTexture', ...args]); },
        pixelStorei(...args) { calls.push(['pixelStorei', ...args]); },
        texParameteri(...args) { calls.push(['texParameteri', ...args]); },
        texImage2D(...args) { calls.push(['texImage2D', ...args]); },
        deleteTexture(texture) { calls.push(['deleteTexture', texture]); },
        viewport(...args) { calls.push(['viewport', ...args]); },
        clearColor(...args) { calls.push(['clearColor', ...args]); },
        clear(...args) { calls.push(['clear', ...args]); },
        useProgram(...args) { calls.push(['useProgram', ...args]); },
        enableVertexAttribArray(...args) { calls.push(['enableVertexAttribArray', ...args]); },
        vertexAttribPointer(...args) { calls.push(['vertexAttribPointer', ...args]); },
        enable(...args) { calls.push(['enable', ...args]); },
        blendFunc(...args) { calls.push(['blendFunc', ...args]); },
        activeTexture(...args) { calls.push(['activeTexture', ...args]); },
        uniform1i(...args) { calls.push(['uniform1i', ...args]); },
        uniform1f(...args) { calls.push(['uniform1f', ...args]); },
        uniform2f(...args) { calls.push(['uniform2f', ...args]); },
        uniform3f(...args) { calls.push(['uniform3f', ...args]); },
        uniform4f(...args) { calls.push(['uniform4f', ...args]); },
        drawArrays(...args) { calls.push(['drawArrays', ...args]); },
        isContextLost() { return false; }
    };
    return gl;
}

function makeCanvas(gl) {
    const listeners = new Map();
    return {
        width: 0, height: 0,
        addEventListener(type, listener) { listeners.set(type, listener); },
        getContext(type) { return type === 'webgl' ? gl : null; },
        dispatchEvent(event) { listeners.get(event.type)?.(event); }
    };
}

function load(gl) {
    let canvas;
    const context = {
        document: { createElement(type) { assert.equal(type, 'canvas'); canvas = makeCanvas(gl); return canvas; } },
        console
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/life/scripts/09-celestial-compositor.js'), 'utf8')
        + '\nglobalThis.Compositor = CelestialSphereCompositor;', context);
    return { compositor: new context.Compositor(), canvas };
}

function layer(image, key = 'surface') {
    return { key, image, rectangle: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
        framing: { x: 240, y: 180, radius: 120 }, axis: [0, 1, 0], angle: Math.PI / 6 };
}

function main() {
    const gl = makeGl();
    const { compositor, canvas } = load(gl);
    const first = { width: 1024, height: 512 };
    assert.equal(compositor.render([layer(first)], 480, 360), canvas, 'WebGL compositor returns its offscreen canvas');
    assert.equal(canvas.width, 480);
    assert.equal(canvas.height, 360);
    assert.equal(gl.calls.filter(call => call[0] === 'texImage2D').length, 1);
    assert.equal(gl.calls.filter(call => call[0] === 'drawArrays').length, 1);
    assert.equal(gl.calls.filter(call => call[0] === 'pixelStorei' && call[1] === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL).at(-1).slice(2)[0], false,
        'Legacy fixtures retain straight-alpha texture unpacking');
    assert.deepEqual(gl.calls.filter(call => call[0] === 'uniform3f').at(-1).slice(2), [0, 1, 0],
        'Each layer uploads its declared spin axis');
    assert.deepEqual(gl.calls.filter(call => call[0] === 'uniform2f').at(-1).slice(2),
        [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)], 'Each layer uploads its rotation angle');
    const shaders = gl.calls.filter(call => call[0] === 'shaderSource');
    assert(shaders.some(call => call[2].includes('vec2 pixel = position * viewport;')),
        'The output quad covers the viewport even when source texture is a cropped fragment');
    assert(shaders.some(call => call[2].includes('sampleFrame(nextFrame')),
        'Climate layers use a second texture in one premultiplied draw');
    assert(shaders.some(call => call[2].includes('sourcePremultiplied')),
        'The compositor distinguishes premultiplied and legacy straight-alpha sources');
    assert(shaders.some(call => call[2].includes('sourceClimatePhase') && call[2].includes('jet')),
        'Cloud layers support latitude-dependent continuous wind warp without temporal double exposure');
    const climateFirst = layer({ width: 512, height: 256 }, 'clouds:1');
    climateFirst.blendGroup = 'climate';
    climateFirst.opacity = 0.75;
    climateFirst.climatePhase = 0.12;
    climateFirst.climateWarp = 0.8;
    const climateSecond = layer({ width: 512, height: 256 }, 'clouds:2');
    climateSecond.blendGroup = 'climate';
    climateSecond.opacity = 0.25;
    const drawsBeforeClimate = gl.calls.filter(call => call[0] === 'drawArrays').length;
    compositor.render([climateFirst, climateSecond], 480, 360);
    assert.equal(gl.calls.filter(call => call[0] === 'drawArrays').length, drawsBeforeClimate + 1,
        'A climate pair renders in one additional draw instead of darkening with two source-over passes');
    assert.deepEqual(gl.calls.filter(call => call[0] === 'activeTexture').slice(-2).map(call => call[1]), [23, 24],
        'Climate interpolation binds the two source frames to separate texture units');
    assert.equal(gl.calls.filter(call => call[0] === 'uniform1f' && call[1].name === 'nextOpacity').at(-1).slice(2)[0], 0.25,
        'Climate interpolation preserves the second frame weight in premultiplied composition');
    assert.equal(gl.calls.filter(call => call[0] === 'uniform1f' && call[1].name === 'nextPremultiplied').at(-1).slice(2)[0], 0,
        'Climate interpolation uploads the second frame alpha convention');
    assert.equal(gl.calls.filter(call => call[0] === 'uniform1f' && call[1].name === 'climateWarp').at(-1).slice(2)[0], 0.8,
        'A configured climate layer uploads its continuous wind-warp strength');
    assert.equal(gl.calls.filter(call => call[0] === 'uniform1f' && call[1].name === 'climatePhase').at(-1).slice(2)[0], 0.12,
        'A configured climate layer uploads its continuous phase');
    assert.equal(gl.calls.filter(call => call[0] === 'uniform1f' && call[1].name === 'nextClimateWarp').at(-1).slice(2)[0], 0,
        'A legacy climate pair keeps the unconfigured next-layer wind warp disabled');
    const premultiplied = layer({ width: 128, height: 64 }, 'premultiplied');
    premultiplied.premultiplied = true;
    compositor.render([premultiplied], 480, 360);
    assert.equal(gl.calls.filter(call => call[0] === 'pixelStorei' && call[1] === gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL).at(-1).slice(2)[0], true,
        'Production premultiplied frames request premultiplied texture unpacking');
    assert.equal(gl.calls.filter(call => call[0] === 'uniform1f' && call[1].name === 'premultiplied').at(-1).slice(2)[0], 1,
        'Production premultiplied frames bypass shader-side alpha multiplication');
    premultiplied.premultiplied = false;
    compositor.render([premultiplied], 480, 360);
    assert.equal(gl.calls.filter(call => call[0] === 'texImage2D').at(-1).slice(-1)[0], premultiplied.image,
        'Changing alpha convention reuploads an otherwise identical image');
    const cropped = layer({ width: 800, height: 600 });
    cropped.rectangle = { x: -0.4, y: -0.7, width: 2.4, height: 3.2 };
    compositor.render([cropped], 480, 360);
    assert.deepEqual(gl.calls.filter(call => call[0] === 'uniform4f' && call[1].name === 'rectangle').at(-1).slice(2),
        [-0.4, -0.7, 2.4, 3.2], 'Cropped textures retain unclamped sphere coordinates outside their own UV rectangle');
    compositor.render([layer(first)], 480, 360);
    const initialUploads = gl.calls.filter(call => call[0] === 'texImage2D').length;

    compositor.render([layer(first)], 480, 360);
    assert.equal(gl.calls.filter(call => call[0] === 'texImage2D').length, initialUploads,
        'The same ImageBitmap is retained by the GPU texture');
    const replacement = { width: 1024, height: 512 };
    compositor.render([layer(replacement)], 480, 360);
    assert.equal(gl.calls.filter(call => call[0] === 'texImage2D').length, initialUploads + 1,
        'Replacing a decoded frame updates the retained GPU texture');

    canvas.dispatchEvent({ type: 'webglcontextlost', preventDefault() {} });
    assert.equal(compositor.render([layer(replacement)], 480, 360), null,
        'Context loss disables the compositor until restoration');
    canvas.dispatchEvent({ type: 'webglcontextrestored' });
    assert.equal(compositor.render([layer(replacement)], 480, 360), canvas,
        'A restored context can initialize a fresh compositor program');
    compositor.clear();
    assert.equal(canvas.width, 1);
    assert.equal(canvas.height, 1);
    assert.equal(compositor.textures.size, 0);
    assert(gl.calls.some(call => call[0] === 'deleteTexture'), 'clear releases GPU textures');

    const unavailable = load(null).compositor;
    assert.equal(unavailable.render([layer(first)], 480, 360), null,
        'Missing WebGL returns null so the Canvas2D viewer can draw its fallback');
    console.log('Celestial compositor validation passed: WebGL layer uniforms, texture reuse and replacement, context recovery, teardown, and Canvas2D fallback.');
}

main();
