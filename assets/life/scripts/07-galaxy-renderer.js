class GalaxyRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = null;
        this.anisotropyExtension = null;
        this.fallbackContext = null;
        this.ready = false;
        this.starCount = 0;
        this.dpr = 1;
        this.width = 1;
        this.height = 1;
        this.initialize();
        canvas.addEventListener('webglcontextlost', event => {
            event.preventDefault();
            this.ready = false;
        });
        canvas.addEventListener('webglcontextrestored', () => this.initialize());
    }

    initialize() {
        const options = {
            alpha: false,
            antialias: false,
            depth: false,
            stencil: false,
            powerPreference: 'high-performance',
            preserveDrawingBuffer: false
        };
        // GLSL ES 1.00 keeps the same two-draw-call renderer compatible with
        // both older integrated GPUs and current browsers.
        this.gl = this.canvas.getContext('webgl', options) ||
            this.canvas.getContext('experimental-webgl', options);
        if (!this.gl) {
            this.ready = false;
            return;
        }

        try {
            this.backgroundProgram = this.createProgram(
                `
                attribute vec2 aPosition;
                varying vec2 vUv;
                void main() {
                    vUv = aPosition * 0.5 + 0.5;
                    gl_Position = vec4(aPosition, 0.0, 1.0);
                }
                `,
                `
                #ifdef GL_FRAGMENT_PRECISION_HIGH
                precision highp float;
                #else
                precision mediump float;
                #endif
                varying vec2 vUv;
                uniform vec2 uResolution;
                uniform vec3 uRight;
                uniform vec3 uUp;
                uniform vec3 uForward;
                uniform vec3 uZenith;
                uniform vec3 uSunDirection;
                uniform float uFov;
                uniform float uTime;
                uniform float uSunAltitude;

                float hash(vec2 point) {
                    vec3 mixed = fract(point.xyx * 0.1031);
                    mixed += vec3(dot(mixed, mixed.yzx + vec3(33.33)));
                    return fract((mixed.x + mixed.y) * mixed.z);
                }

                float noise(vec2 point) {
                    vec2 cell = floor(point);
                    vec2 local = fract(point);
                    local = local * local * (3.0 - 2.0 * local);
                    return mix(
                        mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
                        mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), local.x),
                        local.y
                    );
                }

                float fbm(vec2 point) {
                    float value = 0.0;
                    float amplitude = 0.58;
                    mat2 rotation = mat2(0.82, -0.57, 0.57, 0.82);
                    for (int index = 0; index < 3; index++) {
                        value += noise(point) * amplitude;
                        point = rotation * point * 2.03 + vec2(7.17);
                        amplitude *= 0.47;
                    }
                    return value;
                }

                void main() {
                    vec2 centered = vUv * 2.0 - 1.0;
                    centered.x *= uResolution.x / max(uResolution.y, 1.0);
                    float tangent = tan(uFov * 0.5);
                    vec3 cameraRay = normalize(vec3(centered * tangent, 1.0));
                    vec3 ray = normalize(
                        uRight * cameraRay.x +
                        uUp * cameraRay.y +
                        uForward * cameraRay.z
                    );
                    float sinAltitude = dot(ray, uZenith);
                    float skyAltitude = clamp(sinAltitude, 0.0, 1.0);
                    float daylight = smoothstep(-10.0, 2.0, uSunAltitude);
                    float fullDay = smoothstep(-2.0, 9.0, uSunAltitude);
                    float twilight = smoothstep(-18.0, -3.0, uSunAltitude) *
                        (1.0 - smoothstep(4.0, 12.0, uSunAltitude));
                    float twilightLift = smoothstep(-18.0, -6.0, uSunAltitude);
                    float nightStrength = 1.0 - smoothstep(-18.0, -7.0, uSunAltitude);
                    float sunAlignment = max(dot(ray, uSunDirection), 0.0);
                    float horizonBand = exp(-abs(sinAltitude) * 12.0);

                    vec3 galacticNormal = normalize(vec3(-0.198076, 0.455984, -0.867666));
                    vec3 galacticX = normalize(vec3(-0.873437, -0.483835, -0.054876));
                    galacticX = normalize(
                        galacticX - galacticNormal * dot(galacticX, galacticNormal)
                    );
                    vec3 galacticY = normalize(cross(galacticNormal, galacticX));
                    float signedLatitude = dot(ray, galacticNormal);
                    float latitude = abs(signedLatitude);
                    vec2 aroundPlane = vec2(dot(ray, galacticX), dot(ray, galacticY));
                    vec2 texturePoint = aroundPlane * 5.4 + signedLatitude * vec2(1.8, -1.1);
                    float structure = fbm(texturePoint + vec2(uTime * 0.002, 0.0));
                    float fineStructure = fbm(texturePoint * 2.35 + vec2(13.7, 18.4));
                    float grain = noise(texturePoint * 4.7 + vec2(31.2, 9.7));
                    float broadBand = exp(-pow(latitude * 6.7, 1.32));
                    float coreBand = exp(-pow(latitude * 15.5, 1.15));
                    float brokenBand = broadBand * smoothstep(0.2, 0.9, structure * 0.78 + fineStructure * 0.3);
                    float dust = exp(-latitude * latitude * 285.0) *
                        smoothstep(0.48, 0.84, grain * 0.72 + fineStructure * 0.28);
                    float cloudWarmth = noise(texturePoint * 0.92 + vec2(5.1, 21.4));

                    float altitudeTone = pow(skyAltitude, 0.42);
                    vec3 base = mix(
                        vec3(0.018, 0.023, 0.045),
                        vec3(0.032, 0.039, 0.074),
                        altitudeTone
                    );
                    vec3 cool = vec3(0.30, 0.37, 0.56);
                    vec3 warm = vec3(0.48, 0.37, 0.30);
                    vec3 galaxy = mix(cool, warm, smoothstep(0.36, 0.74, cloudWarmth));
                    vec2 planeDirection = aroundPlane / max(length(aroundPlane), 0.001);
                    float towardCore = max(dot(planeDirection, vec2(1.0, 0.0)), 0.0);
                    float softHalo = exp(-pow(latitude * 3.4, 1.25));
                    float bulge = pow(towardCore, 7.0) * exp(-pow(latitude * 4.5, 1.3));
                    galaxy *= brokenBand * (0.23 + structure * 0.50);
                    galaxy += vec3(0.38, 0.42, 0.55) * coreBand * fineStructure * 0.12;
                    galaxy += mix(
                        vec3(0.035, 0.043, 0.070),
                        vec3(0.078, 0.057, 0.043),
                        towardCore
                    ) * softHalo * (0.22 + structure * 0.18);
                    galaxy += vec3(0.24, 0.16, 0.10) * bulge * (0.12 + structure * 0.18);
                    galaxy *= 1.0 - dust * 0.62;
                    galaxy *= smoothstep(
                        0.0,
                        sin(radians(8.0)),
                        sinAltitude
                    );

                    float distantHaze = noise(aroundPlane * 3.4 + vec2(signedLatitude * 1.7));
                    base += vec3(0.025, 0.031, 0.062) * distantHaze * 0.28;
                    vec3 nightSky = base + galaxy * nightStrength;
                    vec3 twilightHorizon = mix(
                        vec3(0.025, 0.034, 0.072),
                        vec3(0.160, 0.200, 0.300),
                        twilightLift
                    );
                    vec3 twilightZenith = mix(
                        vec3(0.018, 0.025, 0.052),
                        vec3(0.042, 0.085, 0.170),
                        twilightLift
                    );
                    vec3 twilightSky = mix(
                        twilightHorizon,
                        twilightZenith,
                        pow(skyAltitude, 0.38)
                    );
                    vec3 daylightHorizon = mix(
                        vec3(0.40, 0.50, 0.62),
                        vec3(0.59, 0.69, 0.78),
                        fullDay
                    );
                    vec3 daylightZenith = mix(
                        vec3(0.10, 0.16, 0.29),
                        vec3(0.055, 0.20, 0.42),
                        fullDay
                    );
                    vec3 daylightSky = mix(
                        daylightHorizon,
                        daylightZenith,
                        pow(skyAltitude, 0.38)
                    );
                    float warmScatter = horizonBand *
                        pow(sunAlignment, 2.2) *
                        (twilight * 0.9 + fullDay * 0.16);
                    daylightSky += vec3(0.98, 0.35, 0.105) * warmScatter * 0.72;
                    daylightSky += vec3(0.42, 0.58, 0.82) *
                        horizonBand * daylight * (1.0 - warmScatter) * 0.11;
                    vec3 skyColor = mix(nightSky, twilightSky, twilightLift);
                    skyColor = mix(skyColor, daylightSky, daylight);
                    skyColor += vec3(0.30, 0.16, 0.22) *
                        horizonBand * twilight * (1.0 - sunAlignment) * 0.08;
                    vec3 groundNight = vec3(0.007, 0.010, 0.015);
                    vec3 groundDay = vec3(0.075, 0.090, 0.098);
                    vec3 ground = mix(groundNight, groundDay, daylight);
                    ground += vec3(0.15, 0.065, 0.03) *
                        warmScatter * smoothstep(-0.14, 0.0, sinAltitude);
                    float geometricHorizon = smoothstep(-0.0035, 0.006, sinAltitude);
                    vec3 color = mix(ground, skyColor, geometricHorizon);
                    float vignette = 1.0 - smoothstep(0.28, 1.35, length(centered * vec2(0.72, 0.9)));
                    color *= 0.91 + vignette * 0.09;
                    color = 1.0 - exp(-color * 1.68);
                    color = pow(color, vec3(0.86));
                    gl_FragColor = vec4(color, 1.0);
                }
                `
            );

            this.starProgram = this.createProgram(
                `
                attribute vec3 aDirection;
                attribute float aSize;
                attribute float aBrightness;
                attribute float aTemperature;
                attribute float aPhase;
                attribute float aMicro;
                attribute float aMagnitude;
                uniform vec3 uRight;
                uniform vec3 uUp;
                uniform vec3 uForward;
                uniform vec3 uZenith;
                uniform float uAspect;
                uniform float uFov;
                uniform float uDpr;
                uniform float uTime;
                uniform float uMagnitudeLimit;
                uniform vec2 uResolution;
                varying float vAlpha;
                varying float vTemperature;
                varying float vMicro;
                varying float vSubpixel;
                varying float vEdgeFade;
                varying float vPointSize;

                void main() {
                    float x = dot(aDirection, uRight);
                    float y = dot(aDirection, uUp);
                    float z = dot(aDirection, uForward);
                    float sinAltitude = dot(aDirection, uZenith);
                    float altitudeDegrees = degrees(asin(clamp(sinAltitude, -1.0, 1.0)));
                    float zenithDegrees = 90.0 - clamp(altitudeDegrees, 0.1, 90.0);
                    float airmass = 1.0 / (
                        cos(radians(zenithDegrees)) +
                        0.50572 * pow(96.07995 - zenithDegrees, -1.6364)
                    );
                    float extinction = max(0.0, (airmass - 1.0) * 0.2);
                    float apparentMagnitude = aMagnitude + extinction;
                    float magnitudeVisibility = 1.0 - smoothstep(
                        uMagnitudeLimit - 0.35,
                        uMagnitudeLimit + 0.25,
                        apparentMagnitude
                    );
                    float horizonVisibility = smoothstep(
                        0.0,
                        sin(radians(1.0)),
                        sinAltitude
                    );
                    float tangent = tan(uFov * 0.5);
                    vec2 projected = vec2(
                        (x / max(z, 0.001)) / (tangent * uAspect),
                        (y / max(z, 0.001)) / tangent
                    );
                    if (z <= 0.015) projected = vec2(4.0, 4.0);
                    gl_Position = vec4(projected, 0.0, 1.0);
                    float twinkle = 0.95 + 0.05 * sin(uTime * (0.00035 + fract(aPhase) * 0.00022) + aPhase);
                    float displayBrightness = pow(
                        max(aBrightness, 0.0001),
                        mix(0.88, 0.82, aMicro)
                    );
                    vAlpha = displayBrightness * twinkle *
                        smoothstep(0.015, 0.12, z) *
                        magnitudeVisibility *
                        horizonVisibility;
                    vTemperature = aTemperature;
                    vMicro = aMicro;
                    float requestedSize = min(
                        18.0,
                        aSize * uDpr * (0.9 + 0.16 / max(z, 0.12))
                    );
                    vSubpixel = 1.0 - smoothstep(3.0, 6.0, requestedSize);
                    float stableSize = max(requestedSize, 3.0);
                    gl_PointSize = stableSize;
                    vPointSize = stableSize;
                    vec2 edgePx = (1.0 - abs(projected)) * 0.5 * uResolution;
                    vEdgeFade = smoothstep(
                        0.0,
                        max(2.0, stableSize),
                        min(edgePx.x, edgePx.y)
                    );
                }
                `,
                `
                #ifdef GL_FRAGMENT_PRECISION_HIGH
                precision highp float;
                #else
                precision mediump float;
                #endif
                varying float vAlpha;
                varying float vTemperature;
                varying float vMicro;
                varying float vSubpixel;
                varying float vEdgeFade;
                varying float vPointSize;
                void main() {
                    vec2 local = gl_PointCoord - 0.5;
                    float radius = length(local) * 2.0;
                    float compactHalo = exp(-radius * radius * 3.4) *
                        (1.0 - smoothstep(0.78, 1.0, radius));
                    float visibleMicroHalo = exp(-radius * radius * 2.25) *
                        (1.0 - smoothstep(0.86, 1.0, radius));
                    float halo = mix(compactHalo, visibleMicroHalo, vMicro);
                    float compactCore = 1.0 - smoothstep(0.0, 0.20, radius);
                    float visibleMicroCore = 1.0 - smoothstep(0.02, 0.24, radius);
                    float core = mix(compactCore, visibleMicroCore, vMicro);
                    vec3 warm = vec3(1.0, 0.91, 0.78);
                    vec3 cool = vec3(0.80, 0.88, 1.0);
                    vec3 color = mix(warm, cool, vTemperature);
                    float stableCore = mix(core, 1.0, vSubpixel);
                    color = mix(color, vec3(1.0), stableCore * 0.72);
                    float haloWeight = mix(0.78, 0.90, vMicro);
                    float coreWeight = mix(0.48, 0.40, vMicro);
                    float resolvedAlpha = min(
                        1.0,
                        (halo * haloWeight + core * coreWeight) * vAlpha
                    );
                    vec2 deltaPx = abs(
                        (gl_PointCoord - 0.5) * vPointSize
                    );
                    float tent =
                        max(0.0, 1.0 - deltaPx.x) *
                        max(0.0, 1.0 - deltaPx.y);
                    float peakWeight = mix(1.26, 1.30, vMicro);
                    float stableSubpixelAlpha =
                        min(1.0, peakWeight * vAlpha) * tent;
                    float alpha = mix(
                        resolvedAlpha,
                        stableSubpixelAlpha,
                        vSubpixel
                    ) * vEdgeFade;
                    gl_FragColor = vec4(color, alpha);
                }
                `
            );

            this.quadBuffer = this.gl.createBuffer();
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.quadBuffer);
            this.gl.bufferData(
                this.gl.ARRAY_BUFFER,
                new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
                this.gl.STATIC_DRAW
            );

            const catalog = this.createStarCatalog();
            this.starCount = catalog.length / 9;
            this.starBuffer = this.gl.createBuffer();
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.starBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, catalog, this.gl.STATIC_DRAW);
            this.backgroundLocations = {
                position: this.gl.getAttribLocation(this.backgroundProgram, 'aPosition'),
                right: this.gl.getUniformLocation(this.backgroundProgram, 'uRight'),
                up: this.gl.getUniformLocation(this.backgroundProgram, 'uUp'),
                forward: this.gl.getUniformLocation(this.backgroundProgram, 'uForward'),
                zenith: this.gl.getUniformLocation(this.backgroundProgram, 'uZenith'),
                sunDirection: this.gl.getUniformLocation(this.backgroundProgram, 'uSunDirection'),
                fov: this.gl.getUniformLocation(this.backgroundProgram, 'uFov'),
                resolution: this.gl.getUniformLocation(this.backgroundProgram, 'uResolution'),
                time: this.gl.getUniformLocation(this.backgroundProgram, 'uTime'),
                sunAltitude: this.gl.getUniformLocation(this.backgroundProgram, 'uSunAltitude')
            };
            this.starLocations = {
                direction: this.gl.getAttribLocation(this.starProgram, 'aDirection'),
                size: this.gl.getAttribLocation(this.starProgram, 'aSize'),
                brightness: this.gl.getAttribLocation(this.starProgram, 'aBrightness'),
                temperature: this.gl.getAttribLocation(this.starProgram, 'aTemperature'),
                phase: this.gl.getAttribLocation(this.starProgram, 'aPhase'),
                micro: this.gl.getAttribLocation(this.starProgram, 'aMicro'),
                magnitude: this.gl.getAttribLocation(this.starProgram, 'aMagnitude'),
                right: this.gl.getUniformLocation(this.starProgram, 'uRight'),
                up: this.gl.getUniformLocation(this.starProgram, 'uUp'),
                forward: this.gl.getUniformLocation(this.starProgram, 'uForward'),
                zenith: this.gl.getUniformLocation(this.starProgram, 'uZenith'),
                fov: this.gl.getUniformLocation(this.starProgram, 'uFov'),
                aspect: this.gl.getUniformLocation(this.starProgram, 'uAspect'),
                dpr: this.gl.getUniformLocation(this.starProgram, 'uDpr'),
                time: this.gl.getUniformLocation(this.starProgram, 'uTime'),
                magnitudeLimit: this.gl.getUniformLocation(this.starProgram, 'uMagnitudeLimit'),
                resolution: this.gl.getUniformLocation(this.starProgram, 'uResolution')
            };
            this.ready = true;
            this.resize();
        } catch (error) {
            console.error('WebGL galaxy initialization failed:', error);
            this.ready = false;
        }
    }

    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const message = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error(message || 'Shader compilation failed');
        }
        return shader;
    }

    createProgram(vertexSource, fragmentSource) {
        const program = this.gl.createProgram();
        const vertex = this.createShader(this.gl.VERTEX_SHADER, vertexSource);
        const fragment = this.createShader(this.gl.FRAGMENT_SHADER, fragmentSource);
        this.gl.attachShader(program, vertex);
        this.gl.attachShader(program, fragment);
        this.gl.linkProgram(program);
        this.gl.deleteShader(vertex);
        this.gl.deleteShader(fragment);
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            const message = this.gl.getProgramInfoLog(program);
            this.gl.deleteProgram(program);
            throw new Error(message || 'Program linking failed');
        }
        return program;
    }

    createStarCatalog() {
        const catalog = window.HipparcosSky;
        if (!catalog?.count || catalog.directions.length !== catalog.count * 3) {
            throw new Error('Hipparcos star catalog unavailable');
        }

        const weakDevice = COARSE_POINTER || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
        const visibleCount = Math.min(catalog.count, weakDevice ? 14410 : 45934);
        const regularCount = Math.min(
            visibleCount,
            Math.round(visibleCount * (31145 / 45934))
        );
        const rareCount = Math.max(1, Math.round(visibleCount * (213 / 45934)));
        const values = new Float32Array(visibleCount * 9);
        let cursor = 0;

        for (let index = 0; index < visibleCount; index += 1) {
            const directionOffset = index * 3;
            const rareBright = index < rareCount;
            const microStar = index >= regularCount;
            let size;
            let brightness;

            if (rareBright) {
                const strength = rareCount === 1
                    ? 1
                    : 1 - index / (rareCount - 1);
                size = 2.9 + strength * 2.9;
                brightness = 0.82 + strength * 0.17;
            } else if (!microStar) {
                const span = Math.max(1, regularCount - rareCount - 1);
                const strength = 1 - (index - rareCount) / span;
                size = 0.62 + Math.pow(strength, 2.35) * 1.78;
                brightness = 0.10 + Math.pow(strength, 1.95) * 0.45;
            } else {
                const span = Math.max(1, visibleCount - regularCount - 1);
                const strength = 1 - (index - regularCount) / span;
                size = 0.30 + Math.pow(strength, 2.6) * 0.70;
                brightness = 0.055 + Math.pow(strength, 2.1) * 0.23;
            }

            const colorIndex = catalog.colorIndices[index];
            const temperature = Number.isFinite(colorIndex)
                ? clamp((1.55 - colorIndex) / 2.0, 0.10, 0.94)
                : 0.5;
            const phase = ((catalog.hips[index] * 0.61803398875) % 1) * Math.PI * 2;

            values[cursor++] = catalog.directions[directionOffset];
            values[cursor++] = catalog.directions[directionOffset + 1];
            values[cursor++] = catalog.directions[directionOffset + 2];
            values[cursor++] = size;
            values[cursor++] = brightness;
            values[cursor++] = temperature;
            values[cursor++] = phase;
            values[cursor++] = microStar ? 1 : 0;
            values[cursor++] = Number.isFinite(catalog.magnitudes[index])
                ? catalog.magnitudes[index]
                : 8;
        }
        return values;
    }

    resize() {
        if (!this.gl) return;
        const maxDpr = COARSE_POINTER ? 1 : 1.2;
        this.dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, maxDpr));
        this.width = Math.max(1, window.innerWidth);
        this.height = Math.max(1, window.innerHeight);
        const pixelWidth = Math.round(this.width * this.dpr);
        const pixelHeight = Math.round(this.height * this.dpr);
        if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
            this.canvas.width = pixelWidth;
            this.canvas.height = pixelHeight;
        }
    }

    setCameraUniforms(locations, basis) {
        const gl = this.gl;
        gl.uniform3fv(locations.right, basis.right);
        gl.uniform3fv(locations.up, basis.up);
        gl.uniform3fv(locations.forward, basis.forward);
        gl.uniform1f(locations.fov, camera.fov);
    }

    render(time, basis) {
        if (!this.ready || !this.gl) return false;
        const gl = this.gl;
        const sky = skyRenderingParameters();
        this.resize();
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);

        gl.useProgram(this.backgroundProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.backgroundLocations.position);
        gl.vertexAttribPointer(this.backgroundLocations.position, 2, gl.FLOAT, false, 0, 0);
        this.setCameraUniforms(this.backgroundLocations, basis);
        gl.uniform2f(
            this.backgroundLocations.resolution,
            this.canvas.width,
            this.canvas.height
        );
        gl.uniform1f(this.backgroundLocations.time, Math.min(time * 0.001, 60));
        gl.uniform3fv(this.backgroundLocations.zenith, sky.zenith);
        gl.uniform3fv(this.backgroundLocations.sunDirection, sky.sunDirection);
        gl.uniform1f(this.backgroundLocations.sunAltitude, sky.sunAltitude);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.useProgram(this.starProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffer);
        const stride = 9 * 4;
        const attributes = [
            [this.starLocations.direction, 3, 0],
            [this.starLocations.size, 1, 3 * 4],
            [this.starLocations.brightness, 1, 4 * 4],
            [this.starLocations.temperature, 1, 5 * 4],
            [this.starLocations.phase, 1, 6 * 4],
            [this.starLocations.micro, 1, 7 * 4],
            [this.starLocations.magnitude, 1, 8 * 4]
        ];
        attributes.forEach(([location, size, offset]) => {
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
        });
        this.setCameraUniforms(this.starLocations, basis);
        gl.uniform1f(this.starLocations.aspect, this.canvas.width / this.canvas.height);
        gl.uniform1f(this.starLocations.dpr, this.dpr);
        gl.uniform1f(this.starLocations.time, time);
        gl.uniform3fv(this.starLocations.zenith, sky.zenith);
        gl.uniform1f(this.starLocations.magnitudeLimit, sky.magnitudeLimit);
        gl.uniform2f(
            this.starLocations.resolution,
            this.canvas.width,
            this.canvas.height
        );
        gl.drawArrays(gl.POINTS, 0, this.starCount);
        gl.disable(gl.BLEND);
        return true;
    }
}
