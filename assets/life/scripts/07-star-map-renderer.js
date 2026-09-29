class StarMapRenderer {
    constructor(canvas, fallbackCanvas, stars) {
        this.canvas = canvas;
        this.fallbackCanvas = fallbackCanvas;
        this.fallback = fallbackCanvas.getContext('2d');
        this.stars = stars;
        this.ready = false;
        this.resources = [];
        this.initialize();
        canvas.addEventListener('webglcontextlost', event => {
            event.preventDefault();
            this.ready = false;
        });
        canvas.addEventListener('webglcontextrestored', () => this.initialize());
    }

    program(vertexSource, fragmentSource) {
        const context = this.gl;
        const program = context.createProgram();
        const shaders = [[context.VERTEX_SHADER, vertexSource], [context.FRAGMENT_SHADER, fragmentSource]];
        for (const [type, source] of shaders) {
            const shader = context.createShader(type);
            context.shaderSource(shader, source);
            context.compileShader(shader);
            if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
                throw new Error(context.getShaderInfoLog(shader));
            }
            context.attachShader(program, shader);
            context.deleteShader(shader);
        }
        context.linkProgram(program);
        if (!context.getProgramParameter(program, context.LINK_STATUS)) {
            throw new Error(context.getProgramInfoLog(program));
        }
        this.resources.push(program);
        return program;
    }

    initialize() {
        this.gl = this.canvas.getContext('webgl', {
            alpha: false, antialias: false, depth: false, stencil: false,
            powerPreference: 'high-performance'
        });
        if (!this.gl) return;
        const context = this.gl;
        try {
            this.cloudProgram = this.program(`
                attribute vec2 aPosition;
                varying vec2 vUv;
                void main() {
                    vUv = aPosition * 0.5 + 0.5;
                    gl_Position = vec4(aPosition, 0.0, 1.0);
                }
            `, `
                precision highp float;
                varying vec2 vUv;
                uniform vec3 uCamera;
                uniform vec3 uRight;
                uniform vec3 uUp;
                uniform vec3 uForward;
                uniform float uAspect;
                uniform float uTangent;
                uniform float uGalaxy;
                float hash(vec3 point) {
                    point = fract(point * 0.1031);
                    point += dot(point, point.yzx + 33.33);
                    return fract((point.x + point.y) * point.z);
                }
                float noise(vec3 point) {
                    vec3 cell = floor(point);
                    vec3 local = fract(point);
                    local = local * local * (3.0 - 2.0 * local);
                    return mix(mix(mix(hash(cell), hash(cell + vec3(1,0,0)), local.x),
                        mix(hash(cell + vec3(0,1,0)), hash(cell + vec3(1,1,0)), local.x), local.y),
                        mix(mix(hash(cell + vec3(0,0,1)), hash(cell + vec3(1,0,1)), local.x),
                        mix(hash(cell + vec3(0,1,1)), hash(cell + vec3(1,1,1)), local.x), local.y), local.z);
                }
                float field(vec3 point) {
                    return noise(point) * 0.57 + noise(point * 2.03 + 17.7) * 0.28
                        + noise(point * 4.07 + 31.3) * 0.15;
                }
                void main() {
                    vec2 screen = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0) * uTangent;
                    vec3 ray = normalize(uForward + screen.x * uRight + screen.y * uUp);
                    float band = exp(-pow((ray.y + ray.z * 0.24) * 3.0, 2.0));
                    float distant = field(ray * 6.0 + 11.0);
                    vec3 color = vec3(0.007, 0.009, 0.017);
                    color += vec3(0.025, 0.031, 0.047) * band * pow(distant, 2.0);
                    float along = dot(uCamera, ray);
                    float discriminant = along * along - dot(uCamera, uCamera) + 620.0 * 620.0;
                    if (discriminant > 0.0) {
                        float nearDistance = max(0.0, -along - sqrt(discriminant));
                        float farDistance = max(0.0, -along + sqrt(discriminant));
                        float stepSize = (farDistance - nearDistance) / 48.0;
                        float transmission = 1.0;
                        vec3 cloud = vec3(0.0);
                        for (int stepIndex = 0; stepIndex < 48; stepIndex++) {
                            vec3 point = uCamera + ray * (nearDistance + (float(stepIndex) + 0.5) * stepSize);
                            float curvature = sin(point.x * 0.009) * 33.0;
                            vec3 samplePoint = vec3(point.x * 0.010, (point.y - curvature) * 0.020, point.z * 0.011);
                            float broad = exp(-pow((point.y - curvature) / 62.0, 2.0)
                                - pow(point.x / 380.0, 2.0) - pow(point.z / 230.0, 2.0));
                            float structure = field(samplePoint + vec3(4.7, 2.1, 7.4));
                            float lanes = field(samplePoint * 1.7 + vec3(14.0, 0.0, 0.0));
                            float density = broad * smoothstep(0.24, 0.77, structure);
                            float radial = length(point.xz);
                            float angle = atan(point.z, point.x);
                            float spiral = pow(0.5 + 0.5 * cos(4.0 * (angle - log(1.0 + radial / 32.0) * 1.8)), 7.0);
                            float disk = exp(-pow(point.y / 29.0, 2.0) - radial / 195.0)
                                * (0.3 + spiral * 0.7) * (1.0 - smoothstep(310.0, 440.0, radial));
                            float bulge = exp(-length(vec3(point.x, point.y * 2.0, point.z)) / 30.0);
                            density = mix(density, disk * (0.4 + structure * 0.6) + bulge, uGalaxy);
                            float absorption = exp(-density * lanes * stepSize * 0.008);
                            vec3 cool = vec3(0.30, 0.39, 0.55);
                            vec3 warm = vec3(0.55, 0.43, 0.32);
                            vec3 tint = mix(cool, warm, smoothstep(-190.0, 200.0, point.x + point.z));
                            tint = mix(tint, mix(vec3(0.42, 0.49, 0.66), vec3(0.88, 0.74, 0.54), exp(-radial / 90.0)), uGalaxy);
                            float light = smoothstep(0.34, 0.80, structure) * (1.0 - lanes * 0.68);
                            light = mix(light, 0.42 + structure * 0.28, uGalaxy);
                            cloud += tint * density * light * transmission * stepSize * mix(0.0055, 0.025, uGalaxy);
                            transmission *= absorption;
                        }
                        color = color * transmission + cloud;
                    }
                    color = 1.0 - exp(-color * 1.45);
                    color += (hash(vec3(gl_FragCoord.xy, 0.0)) - 0.5) / 255.0;
                    gl_FragColor = vec4(color, 1.0);
                }
            `);
            this.copyProgram = this.program(`
                attribute vec2 aPosition;
                varying vec2 vUv;
                void main() {
                    vUv = aPosition * 0.5 + 0.5;
                    gl_Position = vec4(aPosition, 0.0, 1.0);
                }
            `, `
                precision mediump float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                void main() { gl_FragColor = texture2D(uTexture, vUv); }
            `);
            this.starProgram = this.program(`
                precision highp float;
                attribute vec3 aPosition;
                attribute vec3 aColor;
                attribute float aLight;
                attribute float aSize;
                attribute float aBackground;
                uniform vec3 uCamera;
                uniform vec3 uRight;
                uniform vec3 uUp;
                uniform vec3 uForward;
                uniform float uAspect;
                uniform float uTangent;
                uniform float uDpr;
                uniform float uGalaxy;
                varying vec3 vColor;
                varying float vLight;
                varying float vSize;
                void main() {
                    float background = step(0.5, aBackground) * (1.0 - step(1.5, aBackground));
                    float galaxy = step(1.5, aBackground);
                    vec3 position = aPosition;
                    if (aBackground < 0.5) position = mix(position, vec3(112.0, 2.0, 74.0) + position * 0.09, uGalaxy);
                    vec3 relative = position - uCamera * (1.0 - background);
                    float depth = dot(relative, uForward);
                    vec2 plane = vec2(dot(relative, uRight), dot(relative, uUp));
                    gl_Position = vec4(plane / (uTangent * vec2(uAspect, 1.0)), 0.0, max(depth, 0.001));
                    if (depth <= 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    float distanceGain = mix(clamp(320.0 / max(depth, 30.0), 0.48, 2.4), 1.0, max(background, galaxy));
                    vSize = max(3.0, aSize * uDpr * sqrt(distanceGain));
                    gl_PointSize = min(36.0 * uDpr, vSize);
                    vColor = aColor;
                    vLight = aLight * smoothstep(5.0, 24.0, depth) * mix(sqrt(distanceGain), 1.0, max(background, galaxy));
                    vLight *= mix(1.0, uGalaxy, galaxy);
                    if (aBackground < 0.5) vLight *= 1.0 - uGalaxy;
                }
            `, `
                precision mediump float;
                varying vec3 vColor;
                varying float vLight;
                varying float vSize;
                void main() {
                    vec2 local = (gl_PointCoord - 0.5) * 2.0;
                    float radius = length(local);
                    float halo = exp(-radius * radius * 5.5) * (1.0 - smoothstep(0.75, 1.0, radius));
                    float core = exp(-radius * radius * 90.0);
                    float smallCore = max(0.0, 1.0 - abs(local.x * vSize * 0.5))
                        * max(0.0, 1.0 - abs(local.y * vSize * 0.5));
                    float profile = mix(smallCore, core + halo * 0.12, smoothstep(3.0, 7.0, vSize));
                    vec3 color = mix(vColor, vec3(1.0, 0.98, 0.95), core * 0.65);
                    gl_FragColor = vec4(color * profile * vLight, 1.0);
                }
            `);
            this.quad = context.createBuffer();
            context.bindBuffer(context.ARRAY_BUFFER, this.quad);
            context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), context.STATIC_DRAW);
            this.starBuffer = context.createBuffer();
            context.bindBuffer(context.ARRAY_BUFFER, this.starBuffer);
            context.bufferData(context.ARRAY_BUFFER, this.stars, context.STATIC_DRAW);
            this.texture = context.createTexture();
            context.bindTexture(context.TEXTURE_2D, this.texture);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
            this.framebuffer = context.createFramebuffer();
            this.uniforms = new Map();
            this.ready = true;
            this.resize();
        } catch (error) {
            this.ready = false;
            console.warn('Star map uses its canvas renderer:', error.message);
        }
    }

    uniform(program, name) {
        let locations = this.uniforms.get(program);
        if (!locations) {
            locations = new Map();
            this.uniforms.set(program, locations);
        }
        if (!locations.has(name)) locations.set(name, this.gl.getUniformLocation(program, name));
        return locations.get(name);
    }

    resize() {
        this.width = Math.max(1, window.innerWidth);
        this.height = Math.max(1, window.innerHeight);
        this.dpr = Math.min(window.devicePixelRatio || 1, COARSE_POINTER ? 1.5 : 1.75);
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        this.fallbackCanvas.width = this.canvas.width;
        this.fallbackCanvas.height = this.canvas.height;
        if (!this.ready) return;
        const context = this.gl;
        this.cloudWidth = Math.max(1, Math.round(this.width * 0.5));
        this.cloudHeight = Math.max(1, Math.round(this.height * 0.5));
        context.bindTexture(context.TEXTURE_2D, this.texture);
        context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, this.cloudWidth, this.cloudHeight, 0, context.RGBA, context.UNSIGNED_BYTE, null);
        context.bindFramebuffer(context.FRAMEBUFFER, this.framebuffer);
        context.framebufferTexture2D(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.TEXTURE_2D, this.texture, 0);
        if (context.checkFramebufferStatus(context.FRAMEBUFFER) !== context.FRAMEBUFFER_COMPLETE) this.ready = false;
        context.bindFramebuffer(context.FRAMEBUFFER, null);
    }

    viewUniforms(program, view) {
        const context = this.gl;
        context.uniform3fv(this.uniform(program, 'uCamera'), view.position);
        context.uniform3fv(this.uniform(program, 'uRight'), view.right);
        context.uniform3fv(this.uniform(program, 'uUp'), view.up);
        context.uniform3fv(this.uniform(program, 'uForward'), view.forward);
        context.uniform1f(this.uniform(program, 'uAspect'), this.width / this.height);
        context.uniform1f(this.uniform(program, 'uTangent'), Math.tan(view.fov * 0.5));
        context.uniform1f(this.uniform(program, 'uGalaxy'), view.galaxy || 0);
    }

    drawQuad(program) {
        const context = this.gl;
        context.bindBuffer(context.ARRAY_BUFFER, this.quad);
        const location = context.getAttribLocation(program, 'aPosition');
        context.enableVertexAttribArray(location);
        context.vertexAttribPointer(location, 2, context.FLOAT, false, 0, 0);
        context.drawArrays(context.TRIANGLES, 0, 6);
        context.disableVertexAttribArray(location);
    }

    render(view) {
        this.canvas.hidden = !this.ready;
        this.fallbackCanvas.hidden = this.ready;
        if (!this.ready) {
            this.renderFallback(view);
            return;
        }
        const context = this.gl;
        context.disable(context.DEPTH_TEST);
        context.disable(context.BLEND);
        context.bindFramebuffer(context.FRAMEBUFFER, this.framebuffer);
        context.viewport(0, 0, this.cloudWidth, this.cloudHeight);
        context.useProgram(this.cloudProgram);
        this.viewUniforms(this.cloudProgram, view);
        this.drawQuad(this.cloudProgram);
        context.bindFramebuffer(context.FRAMEBUFFER, null);
        context.viewport(0, 0, this.canvas.width, this.canvas.height);
        context.useProgram(this.copyProgram);
        context.activeTexture(context.TEXTURE0);
        context.bindTexture(context.TEXTURE_2D, this.texture);
        context.uniform1i(this.uniform(this.copyProgram, 'uTexture'), 0);
        this.drawQuad(this.copyProgram);
        context.enable(context.BLEND);
        context.blendFunc(context.ONE, context.ONE);
        context.useProgram(this.starProgram);
        this.viewUniforms(this.starProgram, view);
        context.uniform1f(this.uniform(this.starProgram, 'uDpr'), this.dpr);
        context.bindBuffer(context.ARRAY_BUFFER, this.starBuffer);
        const attributes = [['aPosition', 3, 0], ['aColor', 3, 3], ['aLight', 1, 6], ['aSize', 1, 7], ['aBackground', 1, 8]];
        for (const [name, size, offset] of attributes) {
            const location = context.getAttribLocation(this.starProgram, name);
            context.enableVertexAttribArray(location);
            context.vertexAttribPointer(location, size, context.FLOAT, false, 36, offset * 4);
        }
        context.drawArrays(context.POINTS, 0, this.stars.length / 9);
        for (const [name] of attributes) context.disableVertexAttribArray(context.getAttribLocation(this.starProgram, name));
        context.disable(context.BLEND);
    }

    renderFallback(view) {
        const context = this.fallback;
        if (!context) return;
        context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        context.fillStyle = '#03050c';
        context.fillRect(0, 0, this.width, this.height);
        const focal = this.height * 0.5 / Math.tan(view.fov * 0.5);
        const project = position => {
            const depth = dot(position, view.forward);
            if (depth <= 2) return null;
            return [this.width * 0.5 + dot(position, view.right) / depth * focal,
                this.height * 0.5 - dot(position, view.up) / depth * focal, depth];
        };
        for (let index = 0; index < 8; index++) {
            const position = [index * 52 - 175, Math.sin(index) * 22, index * 13 - 70];
            const projected = project(position.map((value, axis) => value - view.position[axis]));
            if (!projected) continue;
            const radius = focal * 88 / projected[2];
            const gradient = context.createRadialGradient(projected[0], projected[1], 0, projected[0], projected[1], radius);
            gradient.addColorStop(0, index > 4 ? 'rgba(123,104,81,.07)' : 'rgba(66,88,126,.08)');
            gradient.addColorStop(1, 'transparent');
            context.fillStyle = gradient;
            context.fillRect(projected[0] - radius, projected[1] - radius, radius * 2, radius * 2);
        }
        for (let offset = 0; offset < this.stars.length; offset += 18) {
            const kind = this.stars[offset + 8];
            if (kind === 2 && view.galaxy < 0.01) continue;
            const anchor = [112, 2, 74];
            const relative = [0, 1, 2].map(axis => {
                let position = this.stars[offset + axis];
                if (kind === 0) position = lerp(position, anchor[axis] + position * 0.09, view.galaxy || 0);
                return position - view.position[axis] * (kind === 1 ? 0 : 1);
            });
            const projected = project(relative);
            if (!projected || projected[0] < 0 || projected[0] > this.width || projected[1] < 0 || projected[1] > this.height) continue;
            const light = Math.min(1, this.stars[offset + 6] * 0.7) * (kind === 2 ? view.galaxy : 1);
            const color = [3, 4, 5].map(axis => Math.round(this.stars[offset + axis] * 255));
            context.fillStyle = `rgba(${color.join(',')},${light})`;
            const radius = Math.max(0.35, this.stars[offset + 7] * 0.1);
            context.beginPath();
            context.arc(projected[0], projected[1], radius, 0, Math.PI * 2);
            context.fill();
        }
    }
}
