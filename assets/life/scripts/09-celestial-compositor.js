class CelestialSphereCompositor {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.textures = new Map();
        this.lost = false;
        this.canvas.addEventListener?.('webglcontextlost', event => {
            event.preventDefault();
            this.lost = true;
            this.program = null;
            this.buffer = null;
            this.textures.clear();
        });
        this.canvas.addEventListener?.('webglcontextrestored', () => { this.lost = false; });
        try {
            this.gl = this.canvas.getContext?.('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false }) || null;
        } catch (error) {
            this.gl = null;
        }
    }

    initialize() {
        const gl = this.gl;
        if (!gl || this.lost) return false;
        if (this.program) return true;
        const shaders = [];
        let program = null;
        try {
            const compile = (type, source) => {
                const shader = gl.createShader(type);
                shaders.push(shader);
                gl.shaderSource(shader, source);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
                return shader;
            };
            program = gl.createProgram();
            gl.attachShader(program, compile(gl.VERTEX_SHADER, `
                attribute vec2 position;
                uniform vec2 viewport;
                uniform vec4 bounds;
                void main() {
                    vec2 pixel = position * viewport;
                    gl_Position = vec4(pixel.x / viewport.x * 2.0 - 1.0, 1.0 - pixel.y / viewport.y * 2.0, 0.0, 1.0);
                }
            `));
            gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
                precision highp float;
                uniform sampler2D frame;
                uniform vec2 viewport;
                uniform vec4 bounds;
                uniform vec4 rectangle;
                uniform vec3 sphere;
                uniform vec3 axis;
                uniform vec2 rotation;
                uniform float opacity;
                uniform float premultiplied;
                uniform float climatePhase;
                uniform float climateWarp;
                uniform sampler2D nextFrame;
                uniform vec4 nextBounds;
                uniform vec4 nextRectangle;
                uniform vec3 nextSphere;
                uniform vec3 nextAxis;
                uniform vec2 nextRotation;
                uniform float nextOpacity;
                uniform float nextPremultiplied;
                uniform float nextClimatePhase;
                uniform float nextClimateWarp;
                vec4 sampleFrame(sampler2D image, vec4 sourceBounds, vec4 sourceRectangle, vec3 sourceSphere,
                    vec3 sourceAxis, vec2 sourceRotation, float sourcePremultiplied,
                    float sourceClimatePhase, float sourceClimateWarp) {
                    vec2 pixel = vec2(gl_FragCoord.x, viewport.y - gl_FragCoord.y);
                    vec2 uv = (pixel - sourceBounds.xy) / sourceBounds.zw;
                    vec2 projected = vec2(pixel.x - sourceSphere.x, sourceSphere.y - pixel.y) / sourceSphere.z;
                    float radial = dot(projected, projected);
                    if (radial < 1.0) {
                        vec3 point = vec3(projected, sqrt(max(0.0, 1.0 - radial)));
                        vec3 source = point * sourceRotation.x + cross(sourceAxis, point) * sourceRotation.y
                            + sourceAxis * dot(sourceAxis, point) * (1.0 - sourceRotation.x);
                        if (source.z < 0.0) source.xy = normalize(source.xy);
                        if (sourceClimateWarp > 0.0) {
                            float latitude = dot(normalize(sourceAxis), source);
                            float jet = exp(-pow((abs(latitude) - 0.66) / 0.23, 2.0));
                            float equatorial = 1.0 - abs(latitude);
                            float wind = 0.18 + 0.72 * jet - 0.16 * equatorial * equatorial;
                            float localAngle = sourceClimatePhase * sourceClimateWarp * wind;
                            float localCos = cos(localAngle);
                            float localSin = sin(localAngle);
                            source = source * localCos + cross(sourceAxis, source) * localSin
                                + sourceAxis * dot(sourceAxis, source) * (1.0 - localCos);
                        }
                        uv = sourceRectangle.xy + sourceRectangle.zw * vec2(0.5 + source.x * 0.5, 0.5 - source.y * 0.5);
                    }
                    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
                    vec4 color = texture2D(image, uv);
                    return vec4(mix(color.rgb * color.a, color.rgb, sourcePremultiplied), color.a);
                }
                void main() {
                    vec4 color = sampleFrame(frame, bounds, rectangle, sphere, axis, rotation, premultiplied,
                        climatePhase, climateWarp) * opacity;
                    if (nextOpacity > 0.0) {
                        color += sampleFrame(nextFrame, nextBounds, nextRectangle, nextSphere, nextAxis, nextRotation, nextPremultiplied,
                            nextClimatePhase, nextClimateWarp) * nextOpacity;
                    }
                    gl_FragColor = color;
                }
            `));
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
            this.program = program;
            this.uniforms = Object.fromEntries(['viewport', 'bounds', 'rectangle', 'sphere', 'axis', 'rotation', 'opacity', 'premultiplied',
                'climatePhase', 'climateWarp', 'frame', 'nextBounds', 'nextRectangle', 'nextSphere', 'nextAxis', 'nextRotation',
                'nextOpacity', 'nextPremultiplied', 'nextClimatePhase', 'nextClimateWarp', 'nextFrame']
                .map(name => [name, gl.getUniformLocation(program, name)]));
            this.position = gl.getAttribLocation(program, 'position');
            this.buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
            return true;
        } catch (error) {
            if (program) gl.deleteProgram(program);
            this.program = null;
            return false;
        } finally {
            for (const shader of shaders) gl.deleteShader(shader);
        }
    }

    upload(layer) {
        const gl = this.gl;
        let entry = this.textures.get(layer.key);
        if (!entry) {
            entry = { texture: gl.createTexture(), image: null };
            this.textures.set(layer.key, entry);
        }
        gl.bindTexture(gl.TEXTURE_2D, entry.texture);
        const premultiplied = Boolean(layer.premultiplied);
        if (entry.image === layer.image && entry.premultiplied === premultiplied) return;
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplied);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.image);
        entry.image = layer.image;
        entry.premultiplied = premultiplied;
    }

    configureLayer(layer, next = false) {
        const gl = this.gl;
        const { rectangle, framing, axis, angle, image, opacity = 1 } = layer;
        const uniform = name => this.uniforms[next ? `next${name[0].toUpperCase()}${name.slice(1)}` : name];
        gl.activeTexture(next ? gl.TEXTURE1 : gl.TEXTURE0);
        this.upload(layer);
        const scale = framing.radius * 2 / (rectangle.width * image.width);
        const imageWidth = image.width * scale;
        const imageHeight = image.height * scale;
        gl.uniform4f(uniform('bounds'), framing.x - (rectangle.x + rectangle.width / 2) * imageWidth,
            framing.y - (rectangle.y + rectangle.height / 2) * imageHeight, imageWidth, imageHeight);
        gl.uniform4f(uniform('rectangle'), rectangle.x, rectangle.y, rectangle.width, rectangle.height);
        gl.uniform3f(uniform('sphere'), framing.x, framing.y, framing.radius);
        gl.uniform3f(uniform('axis'), ...axis);
        gl.uniform2f(uniform('rotation'), Math.cos(angle), Math.sin(angle));
        gl.uniform1f(uniform('opacity'), opacity);
        gl.uniform1f(uniform('premultiplied'), layer.premultiplied ? 1 : 0);
        gl.uniform1f(uniform('climatePhase'), Number.isFinite(layer.climatePhase) ? layer.climatePhase : 0);
        gl.uniform1f(uniform('climateWarp'), Number.isFinite(layer.climateWarp) ? layer.climateWarp : 0);
    }

    render(layers, width, height) {
        if (!layers.length || !this.initialize()) return null;
        const gl = this.gl;
        try {
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
            }
            gl.viewport(0, 0, width, height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(this.program);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.enableVertexAttribArray(this.position);
            gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.uniform1i(this.uniforms.frame, 0);
            gl.uniform1i(this.uniforms.nextFrame, 1);
            gl.uniform2f(this.uniforms.viewport, width, height);
            const activeKeys = new Set(layers.map(layer => layer.key));
            for (const [key, entry] of this.textures) {
                if (activeKeys.has(key)) continue;
                gl.deleteTexture(entry.texture);
                this.textures.delete(key);
            }
            for (let index = 0; index < layers.length; index += 1) {
                const layer = layers[index];
                const next = layers[index + 1];
                this.configureLayer(layer);
                if (layer.blendGroup && next?.blendGroup === layer.blendGroup) {
                    this.configureLayer(next, true);
                    index += 1;
                } else {
                    gl.activeTexture(gl.TEXTURE1);
                    gl.bindTexture(gl.TEXTURE_2D, this.textures.get(layer.key).texture);
                    gl.uniform1f(this.uniforms.nextOpacity, 0);
                }
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
            if (gl.isContextLost()) return null;
            return this.canvas;
        } catch (error) {
            return null;
        }
    }

    clear() {
        const gl = this.gl;
        if (gl) {
            for (const entry of this.textures.values()) gl.deleteTexture(entry.texture);
            if (this.program) gl.deleteProgram(this.program);
            if (this.buffer) gl.deleteBuffer(this.buffer);
        }
        this.textures.clear();
        this.program = null;
        this.buffer = null;
        this.canvas.width = 1;
        this.canvas.height = 1;
    }
}
