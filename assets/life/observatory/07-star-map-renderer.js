class StarMapRenderer {
    constructor(canvas, fallbackCanvas, stars) {
        this.canvas = canvas;
        this.fallbackCanvas = fallbackCanvas;
        this.fallback = fallbackCanvas.getContext('2d');
        this.stars = stars;
        this.ready = false;
        this.assetVersion = 0;
        this.contextVersion = 0;
        this.skyVersion = 0;
        this.resources = [];
        this.initialize();
        canvas.addEventListener('webglcontextlost', event => {
            event.preventDefault();
            this.ready = false;
            this.contextVersion++;
            this.galacticPreparation = null;
            this.assetVersion++;
        });
        canvas.addEventListener('webglcontextrestored', () => {
            this.initialize();
            this.assetVersion++;
            if (this.galacticPreparationRequested) this.prepareGalacticAssets();
            if (this.skySource) this.prepareSkyAsset(this.skySource).catch(error => {
                console.warn('Milky Way background could not restore its texture:', error.message);
            });
        });
        requestAnimationFrame(() => this.loadSkyAssets());
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
        this.contextVersion++;
        this.galacticPreparation = null;
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
                uniform sampler2D uGalacticDisk;
                uniform sampler2D uGalacticDust;
                float hash(vec3 point) {
                    point = fract(point * 0.1031);
                    point += dot(point, point.yzx + 33.33);
                    return fract((point.x + point.y) * point.z);
                }
                vec3 stellarRadiance(vec3 disk) {
                    return -log(max(vec3(0.015), 1.0 - disk * 0.96)) / 1.45;
                }
                float diskWarp(vec2 point) {
                    return sin(point.x * 0.008) * pow(length(point) / 480.0, 2.0) * 9.0;
                }
                vec3 bulgeLight(vec3 structure) {
                    return stellarRadiance(structure.g * vec3(1.0, mix(0.60, 1.0, structure.b), structure.b));
                }
                vec3 diskEmission(vec3 stars, vec3 structure) {
                    return max(vec3(0.0), stellarRadiance(stars) - bulgeLight(structure));
                }
                void main() {
                    vec2 screen = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0) * uTangent;
                    vec3 ray = normalize(uForward + screen.x * uRight + screen.y * uUp);
                    vec3 color = vec3(0.007, 0.009, 0.017);
                    if (uGalaxy > 0.0) {
                        float surfaceWeight = smoothstep(0.12, 0.32, abs(ray.y));
                        if (surfaceWeight > 0.0) {
                            vec3 extent = vec3(200.0, 76.0, 240.0);
                            vec3 origin = uCamera / extent;
                            vec3 direction = ray / extent;
                            float quadratic = dot(direction, direction);
                            float projected = dot(origin, direction);
                            float intersection = projected * projected - quadratic * (dot(origin, origin) - 1.0);
                            if (intersection > 0.0) {
                                float entry = max(0.0, (-projected - sqrt(intersection)) / quadratic);
                                float exitDistance = max(0.0, (-projected + sqrt(intersection)) / quadratic);
                                float stepSize = (exitDistance - entry) / 32.0;
                                vec3 light = vec3(0.0);
                                for (int sampleIndex = 0; sampleIndex < 32; sampleIndex++) {
                                    vec3 samplePoint = uCamera + ray * (entry + (float(sampleIndex) + 0.5) * stepSize);
                                    vec4 structure = texture2D(uGalacticDust, samplePoint.xz / 800.0 + 0.5);
                                    float thickness = 9.0 + 12.0 * exp(-dot(samplePoint.xz, samplePoint.xz) / 5200.0);
                                    float profile = exp(-0.5 * pow(samplePoint.y / thickness, 2.0)) / (2.5066 * thickness);
                                    light += bulgeLight(structure.rgb) * profile * stepSize;
                                }
                                color += light * surfaceWeight * uGalaxy;
                            }
                        }
                        vec3 extent = vec3(440.0, 76.0, 440.0);
                        vec3 origin = uCamera / extent;
                        vec3 direction = ray / extent;
                        float quadratic = dot(direction, direction);
                        float projected = dot(origin, direction);
                        float intersection = projected * projected - quadratic * (dot(origin, origin) - 1.0);
                        if (intersection > 0.0 && surfaceWeight < 1.0) {
                            float entry = max(0.0, (-projected - sqrt(intersection)) / quadratic);
                            float exitDistance = max(0.0, (-projected + sqrt(intersection)) / quadratic);
                            float stepSize = (exitDistance - entry) / 128.0;
                            float transmission = 1.0;
                            vec3 light = vec3(0.0);
                            for (int sampleIndex = 0; sampleIndex < 128; sampleIndex++) {
                                vec3 point = uCamera + ray * (entry + (float(sampleIndex) + 0.5) * stepSize);
                                float radial = length(point.xz);
                                vec2 diskUv = point.xz / 800.0 + 0.5;
                                vec3 disk = texture2D(uGalacticDisk, diskUv).rgb;
                                vec4 structure = texture2D(uGalacticDust, diskUv);
                                float height = point.y - diskWarp(point.xz);
                                float thickness = 1.6 + radial * 0.002;
                                float oldThickness = 5.0 + radial * 0.0075;
                                float bulgeThickness = 9.0 + 12.0 * exp(-radial * radial / 5200.0);
                                float diskProfile = exp(-0.5 * pow(height / thickness, 2.0));
                                float oldProfile = exp(-0.5 * pow(height / oldThickness, 2.0));
                                float bulgeProfile = exp(-0.5 * pow(point.y / bulgeThickness, 2.0));
                                float dustProfile = exp(-0.5 * pow(height / 0.85, 2.0));
                                vec3 oldFraction = vec3(0.62, 0.56, 0.46);
                                vec3 stellarProfile = (1.0 - oldFraction) * diskProfile / (2.5066 * thickness)
                                    + oldFraction * oldProfile / (2.5066 * oldThickness);
                                vec3 emission = (diskEmission(disk, structure.rgb) * stellarProfile
                                    + bulgeLight(structure.rgb) * bulgeProfile / (2.5066 * bulgeThickness))
                                    * (1.0 - smoothstep(380.0, 430.0, radial));
                                float diffuseDust = exp(-radial / 180.0);
                                float extinction = (0.012 * diffuseDust + structure.r * 0.72) * dustProfile
                                    + diskProfile * 0.003 * diffuseDust;
                                float opticalDepth = extinction * stepSize;
                                float absorption = exp(-opticalDepth);
                                float integration = opticalDepth < 0.01 ? stepSize * (1.0 - opticalDepth * 0.5)
                                    : (1.0 - absorption) / extinction;
                                light += emission * transmission * integration;
                                transmission *= absorption;
                            }
                            color = color * mix(1.0, transmission, uGalaxy * (1.0 - surfaceWeight))
                                + light * mix(0.30, 0.65, smoothstep(0.04, 0.32, abs(ray.y))) * uGalaxy * (1.0 - surfaceWeight);
                        }
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
                precision highp float;
                varying vec2 vUv;
                uniform sampler2D uTexture;
                uniform sampler2D uSky;
                uniform float uSkyOpacity;
                uniform sampler2D uGalacticDisk;
                uniform sampler2D uGalacticDust;
                uniform vec3 uCamera;
                uniform vec3 uRight;
                uniform vec3 uUp;
                uniform vec3 uForward;
                uniform float uAspect;
                uniform float uTangent;
                uniform float uGalaxy;
                vec3 stellarRadiance(vec3 disk) {
                    return -log(max(vec3(0.015), 1.0 - disk * 0.96)) / 1.45;
                }
                void main() {
                    vec2 screen = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0) * uTangent;
                    vec3 ray = normalize(uForward + screen.x * uRight + screen.y * uUp);
                    vec2 skyUv = vec2(fract(0.5 - atan(ray.x, ray.z) / 6.28318530718),
                        0.5 + asin(clamp(ray.y, -1.0, 1.0)) / 3.14159265359);
                    vec3 sky = texture2D(uSky, skyUv).rgb;
                    vec3 base = vec3(0.010, 0.013, 0.024);
                    vec3 background = mix(base, sky * 0.72, uSkyOpacity) * (1.0 - uGalaxy);
                    if (uGalaxy > 0.0) background += max(vec3(0.0), texture2D(uTexture, vUv).rgb - base * (1.0 - uGalaxy));
                    vec3 light = vec3(0.0);
                    if (uGalaxy > 0.0) {
                        float surfaceWeight = smoothstep(0.12, 0.32, abs(ray.y));
                        if (surfaceWeight > 0.0) {
                            float distanceToDisk = -uCamera.y / ray.y;
                            vec3 point = uCamera + ray * distanceToDisk;
                            if (distanceToDisk > 0.0 && length(point.xz) < 440.0) {
                                for (int warpStep = 0; warpStep < 3; warpStep++) {
                                    float warp = sin(point.x * 0.008) * pow(length(point.xz) / 480.0, 2.0) * 9.0;
                                    distanceToDisk = (warp - uCamera.y) / ray.y;
                                    point = uCamera + ray * distanceToDisk;
                                }
                                if (distanceToDisk > 0.0 && length(point.xz) < 440.0) {
                                    vec2 diskUv = point.xz / 800.0 + 0.5;
                                    vec3 stars = texture2D(uGalacticDisk, diskUv).rgb;
                                    vec3 structure = texture2D(uGalacticDust, diskUv).rgb;
                                    vec3 bulge = structure.g * vec3(1.0, mix(0.60, 1.0, structure.b), structure.b);
                                    light = max(vec3(0.0), stellarRadiance(stars) - stellarRadiance(bulge))
                                        * surfaceWeight * uGalaxy * (1.0 - smoothstep(380.0, 430.0, length(point.xz)));
                                }
                            }
                        }
                    }
                    gl_FragColor = vec4(1.0 - (1.0 - background) * exp(-light * 1.45), 1.0);
                }
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
                uniform float uObserver;
                uniform float uGalaxy;
                varying vec3 vColor;
                varying float vLight;
                varying float vSize;
                void main() {
                    float background = step(0.5, aBackground) * (1.0 - step(1.5, aBackground));
                    float galaxy = step(1.5, aBackground);
                    vec3 position = aPosition;
                    if (aBackground < 0.5 && uObserver < 0.5) position = mix(position, vec3(112.0, 2.0, 74.0) + position * 0.09, uGalaxy);
                    float directional = max(background, uObserver * (1.0 - galaxy));
                    vec3 relative = position - uCamera * (1.0 - directional);
                    float depth = dot(relative, uForward);
                    vec2 plane = vec2(dot(relative, uRight), dot(relative, uUp));
                    gl_Position = vec4(plane / (uTangent * vec2(uAspect, 1.0)), 0.0, max(depth, 0.001));
                    if (depth <= 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    float distanceGain = mix(clamp(320.0 / max(depth, 30.0), 0.48, 2.4), 1.0, max(directional, galaxy));
                    vSize = max(3.0, aSize * uDpr * sqrt(distanceGain));
                    gl_PointSize = min(36.0 * uDpr, vSize);
                    vColor = aColor;
                    vLight = aLight * smoothstep(5.0, 24.0, depth) * mix(sqrt(distanceGain), 1.0, max(background, galaxy));
                    vLight *= mix(1.0, uGalaxy, galaxy);
                    vLight *= 1.0 - background * uGalaxy * 0.90;
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
                    gl_FragColor = vec4(color * profile * vLight * 1.08, 1.0);
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
            this.attributes = new Map();
            this.cloudWidth = 0;
            this.cloudHeight = 0;
            this.maxTextureSize = context.getParameter(context.MAX_TEXTURE_SIZE);
            for (const program of [this.cloudProgram, this.copyProgram]) this.attribute(program, 'aPosition');
            this.starAttributes = [['aPosition', 3, 0], ['aColor', 3, 3], ['aLight', 1, 6], ['aSize', 1, 7], ['aBackground', 1, 8]]
                .map(([name, size, offset]) => [this.attribute(this.starProgram, name), size, offset]);
            this.createGalacticDisk();
            this.skyTexture = this.createSkyTexture();
            this.skyUploaded = false;
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

    attribute(program, name) {
        let locations = this.attributes.get(program);
        if (!locations) {
            locations = new Map();
            this.attributes.set(program, locations);
        }
        if (!locations.has(name)) locations.set(name, this.gl.getAttribLocation(program, name));
        return locations.get(name);
    }

    createGalacticDisk() {
        const context = this.gl;
        const anisotropy = context.getExtension('EXT_texture_filter_anisotropic');
        for (const name of ['galacticDisk', 'galacticDust']) {
            this[name] = context.createTexture();
            context.bindTexture(context.TEXTURE_2D, this[name]);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR_MIPMAP_LINEAR);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
            if (anisotropy) context.texParameterf(context.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
                Math.min(8, context.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
            context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 1, 1, 0, context.RGBA, context.UNSIGNED_BYTE,
                new Uint8Array([0, 0, 0, 0]));
            context.generateMipmap(context.TEXTURE_2D);
        }
        this.galacticUploadVersion = -1;
    }

    createSkyTexture() {
        const context = this.gl;
        const texture = context.createTexture();
        context.bindTexture(context.TEXTURE_2D, texture);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR_MIPMAP_LINEAR);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.REPEAT);
        context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
        context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, 1, 1, 0, context.RGBA, context.UNSIGNED_BYTE,
            new Uint8Array([0, 0, 0, 255]));
        context.generateMipmap(context.TEXTURE_2D);
        return texture;
    }

    skyOpacity() {
        if (this.skyLoadedAt == null) return 0;
        return REDUCED_MOTION ? 1 : smoothstep(0, 1, (performance.now() - this.skyLoadedAt) / 700);
    }

    loadSkyAssets() {
        if (this.skyAssetsPromise) return this.skyAssetsPromise;
        this.skyAssetsPromise = (async () => {
            for (const name of ['milky-way-preview', 'milky-way-sky-native']) {
                try {
                    const response = await fetch(`assets/life/sky/${name}.webp?v=20261018-native-sky`, { priority: 'low' });
                    if (!response.ok) throw new Error(`Cannot load ${name}: ${response.status}`);
                    const blob = await response.blob();
                    const url = URL.createObjectURL(blob);
                    const image = new Image();
                    image.decoding = 'async';
                    try {
                        image.src = url;
                        await image.decode();
                    } finally {
                        URL.revokeObjectURL(url);
                    }
                    const source = { image, blob };
                    this.skySource = source;
                    await this.prepareSkyAsset(source);
                } catch (error) {
                    console.warn('Milky Way background keeps its available detail:', error.message);
                }
            }
        })();
        return this.skyAssetsPromise;
    }

    async prepareSkyAsset(source) {
        const version = this.contextVersion;
        const context = this.gl;
        let bitmap = null;
        try {
            if (this.ready) {
                const limit = Math.min(this.maxTextureSize, 8192);
                const width = Math.min(source.image.width, limit);
                const height = Math.round(source.image.height * width / source.image.width);
                if (typeof createImageBitmap === 'function') {
                    bitmap = await createImageBitmap(source.blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none',
                        resizeWidth: width, resizeHeight: height, resizeQuality: 'high' }).catch(() => null);
                }
                // Keep the larger upload out of a drag or a galaxy camera flight.
                while (this.lastView?.moving && version === this.contextVersion) {
                    await new Promise(resolve => setTimeout(resolve, 120));
                }
                await new Promise(resolve => requestAnimationFrame(resolve));
                if (version !== this.contextVersion || this.skySource !== source || !this.ready) return;
                let upload = bitmap || source.image;
                if (!bitmap && source.image.width > width) {
                    upload = document.createElement('canvas');
                    upload.width = width;
                    upload.height = height;
                    upload.getContext('2d').drawImage(source.image, 0, 0, width, height);
                }
                context.activeTexture(context.TEXTURE3);
                context.bindTexture(context.TEXTURE_2D, this.skyTexture);
                context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, !bitmap);
                context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, upload);
                // The native panorama is 6000 x 3000. WebGL 1 requires clamp
                // and non-mipmapped filtering for non-power-of-two textures.
                const powerOfTwo = value => (value & (value - 1)) === 0;
                const mipmapped = powerOfTwo(width) && powerOfTwo(height);
                context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, mipmapped ? context.LINEAR_MIPMAP_LINEAR : context.LINEAR);
                context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, mipmapped ? context.REPEAT : context.CLAMP_TO_EDGE);
                if (mipmapped) context.generateMipmap(context.TEXTURE_2D);
                context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
                this.skyUploaded = true;
                this.skyTextureWidth = width;
            }
            if (version !== this.contextVersion || this.skySource !== source) return;
            this.skyImage = source.image;
            this.skyLoadedAt ??= performance.now();
            this.skyVersion++;
        } finally {
            bitmap?.close();
        }
    }

    loadGalacticAssets() {
        if (this.galacticAssetsPromise) return this.galacticAssetsPromise;
        const load = async name => {
            const response = await fetch(`assets/life/galaxy/${name}.webp?v=20261017-natural-galaxy`);
            if (!response.ok) throw new Error(`Cannot load ${name}: ${response.status}`);
            const blob = await response.blob();
            const source = URL.createObjectURL(blob);
            try {
                const image = await new Promise((resolve, reject) => {
                    const picture = new Image();
                    picture.decoding = 'async';
                    picture.onload = () => resolve(picture);
                    picture.onerror = () => reject(new Error(`Cannot decode ${name}`));
                    picture.src = source;
                });
                if (image.decode) await image.decode();
                return { image, blob };
            } finally {
                URL.revokeObjectURL(source);
            }
        };
        this.galacticAssetsPromise = Promise.all([load('milky-way-starlight'), load('milky-way-dust')]).then(([starlight, dust]) => {
            this.galacticImage = starlight.image;
            this.galacticDustImage = dust.image;
            this.galacticBlobs = [starlight.blob, dust.blob];
            this.galacticAssetsReady = true;
            this.fallbackDiskImage = null;
            this.assetVersion++;
        }).catch(error => {
            this.galacticAssetsFailed = true;
            this.assetVersion++;
            console.warn('Galaxy uses its procedural fallback:', error.message);
        });
        return this.galacticAssetsPromise;
    }

    prepareGalacticAssets() {
        if (this.galacticPreparation) return this.galacticPreparation;
        this.galacticPreparationRequested = true;
        const version = this.contextVersion;
        this.galacticPreparation = (async () => {
            await this.loadGalacticAssets();
            if (version !== this.contextVersion) return this.prepareGalacticAssets();
            if (!this.galacticImage) this.galacticImage = this.fallbackDisk();
            if (this.ready) {
                try {
                    await this.uploadGalacticAssets(version);
                } catch (error) {
                    if (version !== this.contextVersion) return this.prepareGalacticAssets();
                    this.ready = false;
                    console.warn('Galaxy uses its canvas renderer:', error.message);
                }
            }
            if (version !== this.contextVersion) return this.prepareGalacticAssets();
            this.assetVersion++;
            if (this.ready) this.galacticUploadVersion = this.assetVersion;
        })();
        return this.galacticPreparation;
    }

    async uploadGalacticAssets(version = this.contextVersion) {
        const context = this.gl;
        const textures = [this.galacticDisk, this.galacticDust];
        const sources = [this.galacticImage, this.galacticDustImage];
        for (const [index, image] of sources.entries()) {
            if (!image || version !== this.contextVersion || !this.ready) continue;
            const limit = this.maxTextureSize;
            let upload = image;
            let bitmap = null;
            if (this.galacticBlobs?.[index] && typeof createImageBitmap === 'function') {
                const options = { imageOrientation: 'flipY', premultiplyAlpha: 'none' };
                if (image.width > limit || image.height > limit) {
                    options.resizeWidth = options.resizeHeight = Math.min(2048, limit);
                    options.resizeQuality = 'high';
                }
                try {
                    bitmap = await createImageBitmap(this.galacticBlobs[index], options);
                    upload = bitmap;
                } catch {
                    bitmap = null;
                }
            }
            try {
                await new Promise(resolve => requestAnimationFrame(resolve));
                if (version !== this.contextVersion || !this.ready) return;
                if (!bitmap && (image.width > limit || image.height > limit)) {
                    upload = document.createElement('canvas');
                    upload.width = upload.height = Math.min(2048, limit);
                    upload.getContext('2d').drawImage(image, 0, 0, upload.width, upload.height);
                }
                context.activeTexture(context.TEXTURE0);
                context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, !bitmap);
                context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                context.bindTexture(context.TEXTURE_2D, textures[index]);
                context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, upload);
                context.generateMipmap(context.TEXTURE_2D);
                context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
            } finally {
                bitmap?.close();
            }
        }
    }

    resize() {
        this.width = Math.max(1, window.innerWidth);
        this.height = Math.max(1, window.innerHeight);
        const pixelRatioLimit = Math.min(this.galaxyDetail ? 3 : 2, Math.sqrt(8294400 / (this.width * this.height)));
        this.dpr = Math.min(window.devicePixelRatio || 1, pixelRatioLimit);
        const width = Math.round(this.width * this.dpr);
        const height = Math.round(this.height * this.dpr);
        for (const canvas of [this.canvas, this.fallbackCanvas]) {
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
        }
        if (!this.ready) return;
        this.resizeCloudTarget(this.galaxyDetail || false, this.moving || false);
    }

    resizeCloudTarget(galaxy, moving) {
        const context = this.gl;
        const cloudScale = moving ? Math.min(0.5, 1200 / this.width, 900 / this.height)
            : galaxy ? Math.min(this.dpr, 1.5, 2160 / this.width, 2160 / this.height)
            : Math.min(0.75, 1200 / this.width, 900 / this.height);
        const width = Math.max(1, Math.round(this.width * cloudScale));
        const height = Math.max(1, Math.round(this.height * cloudScale));
        if (this.cloudWidth === width && this.cloudHeight === height) return;
        this.cloudWidth = width;
        this.cloudHeight = height;
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
        context.uniform1f(this.uniform(program, 'uObserver'), view.observer ? 1 : 0);
    }

    drawQuad(program) {
        const context = this.gl;
        context.bindBuffer(context.ARRAY_BUFFER, this.quad);
        const location = this.attribute(program, 'aPosition');
        context.enableVertexAttribArray(location);
        context.vertexAttribPointer(location, 2, context.FLOAT, false, 0, 0);
        context.drawArrays(context.TRIANGLES, 0, 6);
        context.disableVertexAttribArray(location);
    }

    render(view) {
        this.lastView = view;
        const galaxy = view.galaxy > 0;
        if (galaxy && (!this.galacticImage || this.ready && this.galacticUploadVersion !== this.assetVersion)) {
            this.prepareGalacticAssets();
        }
        const galaxyDetail = view.galaxy > 0.02;
        const moving = Boolean(view.moving);
        if (this.galaxyDetail !== galaxyDetail || this.moving !== moving) {
            this.galaxyDetail = galaxyDetail;
            this.moving = moving;
            this.resize();
        }
        const available = this.ready && (!galaxy || this.galacticUploadVersion === this.assetVersion);
        this.canvas.hidden = !available;
        this.fallbackCanvas.hidden = available;
        if (!available) {
            if (galaxy && !this.galacticImage) return;
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
        context.activeTexture(context.TEXTURE0);
        context.bindTexture(context.TEXTURE_2D, this.galacticDisk);
        context.uniform1i(this.uniform(this.cloudProgram, 'uGalacticDisk'), 0);
        context.activeTexture(context.TEXTURE1);
        context.bindTexture(context.TEXTURE_2D, this.galacticDust);
        context.uniform1i(this.uniform(this.cloudProgram, 'uGalacticDust'), 1);
        if (galaxy) this.drawQuad(this.cloudProgram);
        context.bindFramebuffer(context.FRAMEBUFFER, null);
        context.viewport(0, 0, this.canvas.width, this.canvas.height);
        context.useProgram(this.copyProgram);
        this.viewUniforms(this.copyProgram, view);
        context.activeTexture(context.TEXTURE0);
        context.bindTexture(context.TEXTURE_2D, this.texture);
        context.uniform1i(this.uniform(this.copyProgram, 'uTexture'), 0);
        context.activeTexture(context.TEXTURE1);
        context.bindTexture(context.TEXTURE_2D, this.galacticDisk);
        context.uniform1i(this.uniform(this.copyProgram, 'uGalacticDisk'), 1);
        context.activeTexture(context.TEXTURE2);
        context.bindTexture(context.TEXTURE_2D, this.galacticDust);
        context.uniform1i(this.uniform(this.copyProgram, 'uGalacticDust'), 2);
        context.activeTexture(context.TEXTURE3);
        context.bindTexture(context.TEXTURE_2D, this.skyTexture);
        context.uniform1i(this.uniform(this.copyProgram, 'uSky'), 3);
        context.uniform1f(this.uniform(this.copyProgram, 'uSkyOpacity'), this.skyUploaded ? this.skyOpacity() : 0);
        this.drawQuad(this.copyProgram);
        context.enable(context.BLEND);
        context.blendFunc(context.ONE, context.ONE);
        context.useProgram(this.starProgram);
        this.viewUniforms(this.starProgram, view);
        context.uniform1f(this.uniform(this.starProgram, 'uDpr'), this.dpr);
        context.bindBuffer(context.ARRAY_BUFFER, this.starBuffer);
        for (const [location, size, offset] of this.starAttributes) {
            context.enableVertexAttribArray(location);
            context.vertexAttribPointer(location, size, context.FLOAT, false, 36, offset * 4);
        }
        context.drawArrays(context.POINTS, 0, this.stars.length / 9);
        for (const [location] of this.starAttributes) context.disableVertexAttribArray(location);
        context.disable(context.BLEND);
    }

    fallbackDisk() {
        if (this.galacticAssetsReady) return this.galacticImage;
        if (this.fallbackDiskImage) return this.fallbackDiskImage;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        const context = canvas.getContext('2d');
        const pixels = context.createImageData(512, 512);
        const hash = (horizontal, vertical) => {
            let value = Math.imul(horizontal, 374761393) + Math.imul(vertical, 668265263);
            value = Math.imul(value ^ value >>> 13, 1274126177);
            return ((value ^ value >>> 16) >>> 0) / 4294967296;
        };
        const noise = (horizontal, vertical) => {
            const column = Math.floor(horizontal), row = Math.floor(vertical);
            const localX = horizontal - column, localY = vertical - row;
            const blendX = localX * localX * (3 - 2 * localX), blendY = localY * localY * (3 - 2 * localY);
            return lerp(lerp(hash(column, row), hash(column + 1, row), blendX),
                lerp(hash(column, row + 1), hash(column + 1, row + 1), blendX), blendY);
        };
        const field = (horizontal, vertical) => noise(horizontal, vertical) * 0.55
            + noise(horizontal * 2.03 + 17, vertical * 2.03) * 0.3
            + noise(horizontal * 4.07, vertical * 4.07 + 23) * 0.15;
        for (let row = 0; row < 512; row++) {
            for (let column = 0; column < 512; column++) {
                const diskX = (column / 511 - 0.5) * 960, diskZ = (row / 511 - 0.5) * 960;
                const radial = Math.hypot(diskX, diskZ);
                if (radial > 475) continue;
                const structure = field(diskX * 0.026, diskZ * 0.026);
                const phase = Math.atan2(diskZ, diskX) - Math.log1p(radial / 32) * 1.8 + (structure - 0.5) * 0.65;
                const arms = (Math.exp((Math.cos(phase * 2) - 1) * 3)
                    + Math.exp((Math.cos(phase * 4 + 0.4) - 1) * 6) * 0.38) * smoothstep(24, 90, radial);
                const falloff = Math.exp(-radial / 175) * (1 - smoothstep(340, 475, radial));
                const dust = Math.exp((Math.cos((phase + 0.16) * 2) - 1) * 9)
                    * field(diskX * 0.09 + 5, diskZ * 0.09) * smoothstep(38, 100, radial);
                const light = falloff * (0.38 + arms * (0.35 + structure * 1.85)) * Math.exp(-dust * 1.8);
                const warmth = Math.exp(-radial / 95);
                const offset = (row * 512 + column) * 4;
                const tint = [lerp(0.68, 0.94, warmth), lerp(0.74, 0.83, warmth), lerp(0.82, 0.66, warmth)];
                tint.forEach((value, channel) => { pixels.data[offset + channel] = (1 - Math.exp(-value * light * 0.65)) * 255; });
                pixels.data[offset + 3] = 255;
            }
        }
        context.putImageData(pixels, 0, 0);
        this.fallbackDiskImage = canvas;
        return canvas;
    }

    renderSkyFallback(view) {
        const image = this.skyImage;
        const galaxy = view.galaxy || 0;
        if (!image || !image.naturalWidth || galaxy >= 1) return;
        if (this.skyFallbackSource?.image !== image) {
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = Math.min(4096, image.naturalWidth);
            sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * sourceCanvas.width / image.naturalWidth));
            const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
            sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
            this.skyFallbackSource = {
                image, width: sourceCanvas.width, height: sourceCanvas.height,
                pixels: sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data
            };
            this.skyFallbackViewKey = null;
        }
        const scale = Math.min(this.dpr, (view.moving ? 640 : 1440) / this.width, (view.moving ? 360 : 900) / this.height);
        const width = Math.max(1, Math.round(this.width * scale));
        const height = Math.max(1, Math.round(this.height * scale));
        const key = [width, height, this.width / this.height, view.fov, ...view.right, ...view.up, ...view.forward].join(',');
        if (this.skyFallbackViewKey !== key) {
            const canvas = this.skyFallbackProjection ||= document.createElement('canvas');
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
            const context = canvas.getContext('2d');
            const output = this.skyFallbackPixels?.width === width && this.skyFallbackPixels.height === height
                ? this.skyFallbackPixels : context.createImageData(width, height);
            const source = this.skyFallbackSource;
            const tangent = Math.tan(view.fov * 0.5), aspect = this.width / this.height;
            for (let row = 0; row < height; row++) {
                const vertical = (1 - (row + 0.5) * 2 / height) * tangent;
                const rowX = view.forward[0] + vertical * view.up[0];
                const rowY = view.forward[1] + vertical * view.up[1];
                const rowZ = view.forward[2] + vertical * view.up[2];
                for (let column = 0; column < width; column++) {
                    const horizontal = ((column + 0.5) * 2 / width - 1) * aspect * tangent;
                    const x = rowX + horizontal * view.right[0];
                    const y = rowY + horizontal * view.right[1];
                    const z = rowZ + horizontal * view.right[2];
                    const longitude = Math.atan2(x, z);
                    const latitude = Math.asin(Math.max(-1, Math.min(1, y / Math.sqrt(x * x + y * y + z * z))));
                    const u = 0.5 - longitude / (Math.PI * 2);
                    const v = 0.5 - latitude / Math.PI;
                    const sourceX = ((u * source.width - 0.5) % source.width + source.width) % source.width;
                    const sourceY = Math.max(0, Math.min(source.height - 1, v * source.height - 0.5));
                    const left = Math.floor(sourceX), top = Math.floor(sourceY);
                    const right = (left + 1) % source.width, bottom = Math.min(source.height - 1, top + 1);
                    const fractionX = sourceX - left, fractionY = sourceY - top;
                    const topLeft = (top * source.width + left) * 4, topRight = (top * source.width + right) * 4;
                    const bottomLeft = (bottom * source.width + left) * 4, bottomRight = (bottom * source.width + right) * 4;
                    const destination = (row * width + column) * 4;
                    for (let channel = 0; channel < 3; channel++) {
                        const upper = source.pixels[topLeft + channel] * (1 - fractionX) + source.pixels[topRight + channel] * fractionX;
                        const lower = source.pixels[bottomLeft + channel] * (1 - fractionX) + source.pixels[bottomRight + channel] * fractionX;
                        output.data[destination + channel] = (upper * (1 - fractionY) + lower * fractionY) * 0.72;
                    }
                    output.data[destination + 3] = 255;
                }
            }
            context.putImageData(output, 0, 0);
            this.skyFallbackPixels = output;
            this.skyFallbackViewKey = key;
        }
        this.fallback.save();
        this.fallback.globalAlpha = this.skyOpacity() * (1 - galaxy);
        this.fallback.imageSmoothingEnabled = true;
        this.fallback.drawImage(this.skyFallbackProjection, 0, 0, this.width, this.height);
        this.fallback.restore();
    }

    renderFallback(view) {
        const context = this.fallback;
        if (!context) return;
        context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        context.fillStyle = '#03050c';
        context.fillRect(0, 0, this.width, this.height);
        this.renderSkyFallback(view);
        const focal = this.height * 0.5 / Math.tan(view.fov * 0.5);
        const project = position => {
            const depth = dot(position, view.forward);
            if (depth <= 2) return null;
            return [this.width * 0.5 + dot(position, view.right) / depth * focal,
                this.height * 0.5 - dot(position, view.up) / depth * focal, depth];
        };
        const galaxy = view.galaxy || 0;
        if (galaxy > 0) {
            const center = project(view.position.map(value => -value));
            if (center) {
                const disk = this.fallbackDisk();
                const scale = focal / center[2] * (800 / disk.width);
                context.save();
                context.globalAlpha = galaxy;
                context.globalCompositeOperation = 'screen';
                context.transform(view.right[0] * scale, -view.up[0] * scale,
                    -view.right[2] * scale, view.up[2] * scale, center[0], center[1]);
                context.drawImage(disk, -disk.width * 0.5, -disk.height * 0.5);
                context.restore();
                const radius = focal * 65 / center[2];
                const core = context.createRadialGradient(center[0], center[1], 0, center[0], center[1], radius);
                const coreAlpha = galaxy * (this.galacticAssetsReady ? 0.22 : 0.85);
                core.addColorStop(0, `rgba(255,234,192,${coreAlpha})`);
                core.addColorStop(0.3, `rgba(200,176,137,${coreAlpha * 0.53})`);
                core.addColorStop(1, 'rgba(120,104,86,0)');
                context.fillStyle = core;
                context.fillRect(center[0] - radius, center[1] - radius, radius * 2, radius * 2);
            }
        }
        context.globalAlpha = 1;
        for (let offset = 0; offset < this.stars.length; offset += 18) {
            const kind = this.stars[offset + 8];
            if (kind === 2 && view.galaxy < 0.01) continue;
            const anchor = [112, 2, 74];
            const relative = [0, 1, 2].map(axis => {
                let position = this.stars[offset + axis];
                if (kind === 0 && !view.observer) position = lerp(position, anchor[axis] + position * 0.09, view.galaxy || 0);
                return position - view.position[axis] * (kind === 1 || view.observer && kind === 0 ? 0 : 1);
            });
            const projected = project(relative);
            if (!projected || projected[0] < 0 || projected[0] > this.width || projected[1] < 0 || projected[1] > this.height) continue;
            const visibility = kind === 0 ? 1 - galaxy : kind === 2 ? galaxy : 1 - galaxy * 0.90;
            const light = Math.min(1, this.stars[offset + 6] * 0.7 * 1.08) * visibility;
            const color = [3, 4, 5].map(axis => Math.round(this.stars[offset + axis] * 255));
            context.fillStyle = `rgba(${color.join(',')},${light})`;
            const radius = Math.max(0.35, this.stars[offset + 7] * 0.1);
            context.beginPath();
            context.arc(projected[0], projected[1], radius, 0, Math.PI * 2);
            context.fill();
        }
    }
}
