// Demand-loaded real DEM mesh viewer. No framework, texture, or animation loop.
export async function mountTerrain(canvas, meshURL, { onProject = () => {}, onError = () => {} } = {}) {
    const response = await fetch(meshURL);
    if (!response.ok) throw new Error(`Terrain mesh HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const header = new DataView(bytes);
    if (header.getUint32(0, true) !== 0x314d5441) throw new Error('Invalid terrain mesh'); // ATM1
    const vertices = header.getUint32(4, true), indices = header.getUint32(8, true);
    if (!vertices || vertices > 65535 || !indices || 12 + vertices * 24 + indices * 2 !== bytes.byteLength) throw new Error('Invalid terrain mesh size');
    const positions = new Float32Array(bytes, 12, vertices * 3);
    const normals = new Float32Array(bytes, 12 + vertices * 12, vertices * 3);
    const triangles = new Uint16Array(bytes, 12 + vertices * 24, indices);
    canvas.dataset.vertices = String(vertices); canvas.dataset.triangles = String(indices / 3);
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL unavailable');
    const buffers = [], shaders = [];
    let disposed = false, lost = false;
    function compile(type, source) {
        const shader = gl.createShader(type); shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader); shaders.forEach(item => gl.deleteShader(item)); gl.deleteProgram(program);
            gl.getExtension('WEBGL_lose_context')?.loseContext(); throw new Error(message);
        }
        return shader;
    }
    const program = gl.createProgram();
    const vertex = compile(gl.VERTEX_SHADER, `
        attribute vec3 position; attribute vec3 normal;
        uniform mat3 rotation; uniform vec2 scale; uniform vec3 center; uniform float depthScale;
        varying vec3 litNormal;
        void main() {
            vec3 p = rotation * position - center;
            gl_Position = vec4(p.xy * scale, -p.z * depthScale, 1.0);
            litNormal = rotation * normal;
        }`);
    const fragment = compile(gl.FRAGMENT_SHADER, `
        precision mediump float; varying vec3 litNormal;
        void main() {
            vec3 n = normalize(litNormal);
            float light = 0.64 + 0.36 * max(dot(n, normalize(vec3(-0.45, 0.65, 1.0))), 0.0);
            gl_FragColor = vec4(vec3(0.9333, 0.9176, 0.8784) * light, 1.0);
        }`);
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program); shaders.forEach(item => gl.deleteShader(item)); gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext(); throw new Error(message);
    }
    gl.useProgram(program);
    function attribute(name, values) {
        const buffer = gl.createBuffer(); buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, values, gl.STATIC_DRAW);
        const location = gl.getAttribLocation(program, name);
        gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 3, gl.FLOAT, false, 0, 0);
    }
    attribute('position', positions); attribute('normal', normals);
    const elements = gl.createBuffer(); buffers.push(elements); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triangles, gl.STATIC_DRAW);
    const rotationLocation = gl.getUniformLocation(program, 'rotation');
    const scaleLocation = gl.getUniformLocation(program, 'scale');
    const centerLocation = gl.getUniformLocation(program, 'center');
    const depthLocation = gl.getUniformLocation(program, 'depthScale');
    gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
    let yaw = -0.12, pitch = -0.58, zoom = 1, dragging = null;
    let rotation = [], sx = .86, sy = 1;
    let center = [0, 0, 0];
    function draw() {
        if (disposed || lost || !canvas.isConnected) return;
        const rect = canvas.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
        if (!rect.width || !rect.height) return;
        const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const c = Math.cos(yaw), s = Math.sin(yaw), a = Math.cos(pitch), b = Math.sin(pitch);
        rotation = [c, a * s, b * s, -s, a * c, b * c, 0, -b, a];
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < positions.length; i += 3) {
            for (let axis = 0; axis < 3; axis++) {
                const value = rotation[axis] * positions[i] + rotation[axis + 3] * positions[i + 1] + rotation[axis + 6] * positions[i + 2];
                min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
            }
        }
        center = min.map((value, axis) => (value + max[axis]) / 2);
        // Fit the actual rotated surface, including mountain height, with a 10% margin.
        // User zoom may deliberately crop; reset always restores the complete model.
        sx = .9 * zoom / Math.max((max[0] - min[0]) / 2, (max[1] - min[1]) / 2 * width / height, .01);
        sy = sx * width / height;
        gl.viewport(0, 0, width, height); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.uniformMatrix3fv(rotationLocation, false, rotation); gl.uniform2f(scaleLocation, sx, sy);
        gl.uniform3fv(centerLocation, center); gl.uniform1f(depthLocation, 1 / Math.max(1, max[2] - min[2]));
        gl.drawElements(gl.TRIANGLES, indices, gl.UNSIGNED_SHORT, 0);
        canvas.dataset.rendered = 'true';
        canvas.dataset.rotation = `${yaw.toFixed(4)},${pitch.toFixed(4)},${zoom.toFixed(3)}`;
        onProject(project);
    }
    function project(point) {
        const [x, y, z = 0] = point;
        return [(1 + sx * (rotation[0] * x + rotation[3] * y + rotation[6] * z - center[0])) / 2,
            (1 - sy * (rotation[1] * x + rotation[4] * y + rotation[7] * z - center[1])) / 2];
    }
    function down(event) {
        if (event.button !== 0 || dragging) return;
        dragging = { id: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
        canvas.classList.add('is-dragging');
    }
    function move(event) {
        if (!dragging || event.pointerId !== dragging.id) return;
        yaw += (event.clientX - dragging.x) * .008;
        pitch = Math.max(-1.25, Math.min(.1, pitch + (event.clientY - dragging.y) * .008));
        dragging.x = event.clientX; dragging.y = event.clientY; draw();
    }
    function up(event) {
        if (dragging?.id !== event.pointerId) return;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        dragging = null; canvas.classList.remove('is-dragging');
    }
    function key(event) {
        const actions = { ArrowLeft: () => { yaw -= .12; }, ArrowRight: () => { yaw += .12; },
            ArrowUp: () => { pitch = Math.max(-1.25, pitch - .1); }, ArrowDown: () => { pitch = Math.min(.1, pitch + .1); },
            '+': () => { zoom = Math.min(1.7, zoom + .1); }, '=': () => { zoom = Math.min(1.7, zoom + .1); },
            '-': () => { zoom = Math.max(.6, zoom - .1); }, '0': reset, Home: reset };
        if (actions[event.key]) { event.preventDefault(); actions[event.key](); draw(); }
    }
    function reset() { yaw = -.12; pitch = -.58; zoom = 1; draw(); }
    function contextLost(event) { event.preventDefault(); lost = true; onError(new Error('WebGL context lost')); }
    canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up); canvas.addEventListener('keydown', key);
    canvas.addEventListener('webglcontextlost', contextLost);
    const observer = new ResizeObserver(draw); observer.observe(canvas);
    draw();
    return { reset, project, zoomBy(delta) { zoom = Math.max(.6, Math.min(1.7, zoom + delta)); draw(); }, dispose() {
        if (disposed) return; disposed = true; observer.disconnect();
        canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up); canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('lostpointercapture', up); canvas.removeEventListener('keydown', key);
        canvas.removeEventListener('webglcontextlost', contextLost);
        buffers.forEach(buffer => gl.deleteBuffer(buffer)); shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    } };
}
