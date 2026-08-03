class CelestialCloseupRenderer {
    constructor(canvas, fallbackCanvas) {
        this.canvas = canvas;
        this.fallbackCanvas = fallbackCanvas;
        this.fallbackContext = fallbackCanvas.getContext('2d');
        this.gl = null;
        this.webglFailed = false;
        this.failureReported = false;
        this.ready = false;
        this.hasVisibleFrame = false;
        this.fallbackVisible = false;
        this.lastRenderedAt = -Infinity;
        this.dpr = 1;
        this.images = new Map();
        this.imagePromises = new Map();
        this.textures = new Map();
        this.fallbackSpheres = new Map();
        this.activeProfile = null;
        this.canvas.addEventListener('webglcontextlost', event => {
            event.preventDefault();
            this.ready = false;
            this.webglFailed = true;
            this.textures.clear();
            this.hasVisibleFrame = false;
            this.fallbackVisible = false;
            this.lastRenderedAt = -Infinity;
        });
        this.canvas.addEventListener('webglcontextrestored', () => {
            this.gl = null;
            this.anisotropyExtension = null;
            this.webglFailed = false;
            this.failureReported = false;
            this.initialize();
        });
    }

    activateFallback(error = null) {
        if (this.gl && this.hasVisibleFrame) {
            try {
                this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
                this.gl.clearColor(0, 0, 0, 0);
                this.gl.clear(this.gl.COLOR_BUFFER_BIT);
            } catch (clearError) {
                // A lost or rejected context is already being abandoned below.
            }
        }
        this.ready = false;
        this.webglFailed = true;
        this.textures.clear();
        if (error && !this.failureReported) {
            this.failureReported = true;
            console.warn('Celestial close-up switched to its resilient canvas renderer:', error);
        }
        return false;
    }

    initialize() {
        if (this.ready && this.gl) return true;
        if (this.webglFailed) return false;
        const options = {
            alpha: true,
            antialias: false,
            depth: false,
            stencil: false,
            premultipliedAlpha: true,
            preserveDrawingBuffer: false,
            powerPreference: 'high-performance'
        };
        this.gl = this.canvas.getContext('webgl', options) ||
            this.canvas.getContext('experimental-webgl', options);
        if (!this.gl) return this.activateFallback();
        try {
            this.anisotropyExtension = typeof this.gl.getExtension === 'function'
                ? (
                    this.gl.getExtension('EXT_texture_filter_anisotropic') ||
                    this.gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
                    this.gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
                )
                : null;
            this.program = this.createProgram(
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
                uniform vec2 uCenter;
                uniform float uRadius;
                uniform float uFlattening;
                uniform float uAlpha;
                uniform float uTime;
                uniform float uMaterial;
                uniform float uBodyStyle;
                uniform float uAtmosphereStrength;
                uniform float uHasRing;
                uniform float uRingOpening;
                uniform float uLongitudeOffset;
                uniform vec3 uLightView;
                uniform vec3 uAtmosphereColor;
                uniform mat3 uViewToBody;
                uniform mat3 uBodyToView;
                uniform sampler2D uSurface;
                uniform sampler2D uRing;

                const float PI = 3.141592653589793;

                float hash(vec2 point) {
                    vec3 mixed = fract(point.xyx * 0.1031);
                    mixed += vec3(dot(mixed, mixed.yzx + vec3(33.33)));
                    return fract((mixed.x + mixed.y) * mixed.z);
                }

                float valueNoise(vec2 point) {
                    vec2 cell = floor(point);
                    vec2 local = fract(point);
                    local = local * local * (3.0 - 2.0 * local);
                    return mix(
                        mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
                        mix(
                            hash(cell + vec2(0.0, 1.0)),
                            hash(cell + vec2(1.0, 1.0)),
                            local.x
                        ),
                        local.y
                    );
                }

                float fbm(vec2 point) {
                    float total = 0.0;
                    total += valueNoise(point) * 0.55;
                    point = point * 2.07 + vec2(17.1, 9.2);
                    total += valueNoise(point) * 0.28;
                    point = point * 2.11 + vec2(8.3, 21.7);
                    total += valueNoise(point) * 0.17;
                    return total;
                }

                vec3 linearize(vec3 color) {
                    return pow(max(color, vec3(0.0)), vec3(2.2));
                }

                vec3 displayColor(vec3 color) {
                    color = max(color, vec3(0.0));
                    color = (
                        color * (2.51 * color + vec3(0.03))
                    ) / (
                        color * (2.43 * color + vec3(0.59)) + vec3(0.14)
                    );
                    return pow(
                        clamp(color, vec3(0.0), vec3(1.0)),
                        vec3(1.0 / 2.2)
                    );
                }

                float ellipsoidShadow(vec3 origin, vec3 direction, float polarRadius) {
                    vec3 ellipsoidScale = vec3(1.0, 1.0 / polarRadius, 1.0);
                    vec3 scaledOrigin = origin * ellipsoidScale;
                    vec3 scaledDirection = direction * ellipsoidScale;
                    float a = dot(scaledDirection, scaledDirection);
                    float b = 2.0 * dot(scaledOrigin, scaledDirection);
                    float c = dot(scaledOrigin, scaledOrigin) - 1.0;
                    float discriminant = b * b - 4.0 * a * c;
                    if (discriminant <= 0.0) return 1.0;
                    float nearDistance = (-b - sqrt(discriminant)) / (2.0 * a);
                    return nearDistance > 0.001 ? 0.0 : 1.0;
                }

                void main() {
                    vec2 pixel = vec2(
                        vUv.x * uResolution.x,
                        (1.0 - vUv.y) * uResolution.y
                    );
                    vec2 plane = (pixel - uCenter) / max(uRadius, 1.0);
                    plane.y *= -1.0;
                    float planeDistanceSquared = dot(plane, plane);
                    if (uMaterial < 0.5 && planeDistanceSquared > 3.3856) discard;

                    vec3 originView = vec3(plane, -2.6);
                    vec3 rayView = vec3(0.0, 0.0, 1.0);
                    vec3 originBody = uViewToBody * originView;
                    vec3 rayBody = normalize(uViewToBody * rayView);
                    vec3 lightView = normalize(uLightView);
                    vec3 lightBody = normalize(uViewToBody * lightView);
                    float polarRadius = max(0.72, 1.0 - uFlattening);
                    vec3 scale = vec3(1.0, 1.0 / polarRadius, 1.0);
                    vec3 scaledOrigin = originBody * scale;
                    vec3 scaledRay = rayBody * scale;
                    float qa = dot(scaledRay, scaledRay);
                    float qb = 2.0 * dot(scaledOrigin, scaledRay);
                    float qc = dot(scaledOrigin, scaledOrigin) - 1.0;
                    float discriminant = qb * qb - 4.0 * qa * qc;
                    bool sphereHit = discriminant >= 0.0;
                    float sphereNear = 1.0e6;
                    float sphereFar = -1.0e6;
                    vec3 surfaceColor = vec3(0.0);
                    float surfaceAlpha = 0.0;

                    if (sphereHit) {
                        float root = sqrt(max(discriminant, 0.0));
                        sphereNear = (-qb - root) / (2.0 * qa);
                        sphereFar = (-qb + root) / (2.0 * qa);
                        sphereHit = sphereFar > 0.0;
                    }

                    if (sphereHit) {
                        float hitDistance = max(0.0, sphereNear);
                        vec3 hitBody = originBody + rayBody * hitDistance;
                        vec3 normalBody = normalize(vec3(
                            hitBody.x,
                            hitBody.y / (polarRadius * polarRadius),
                            hitBody.z
                        ));
                        vec3 normalView = normalize(uBodyToView * normalBody);
                        float longitude = atan(hitBody.z, hitBody.x + 1.0e-8) /
                            (2.0 * PI) +
                            0.5 + uLongitudeOffset;
                        float latitude = asin(clamp(hitBody.y / polarRadius, -1.0, 1.0)) /
                            PI + 0.5;
                        vec2 surfaceUv = vec2(fract(longitude), latitude);
                        vec3 textureColor = texture2D(
                            uSurface,
                            surfaceUv
                        ).rgb;
                        float viewFacing = clamp(
                            dot(normalView, vec3(0.0, 0.0, -1.0)),
                            0.0,
                            1.0
                        );

                        if (uMaterial < 0.5) {
                            float granulation = fbm(
                                vec2(longitude * 132.0, latitude * 74.0) +
                                vec2(uTime * 0.018, -uTime * 0.011)
                            );
                            float fineGranulation = valueNoise(
                                vec2(longitude * 390.0, latitude * 220.0) -
                                vec2(uTime * 0.031, uTime * 0.019)
                            );
                            float limbDarkening = clamp(
                                0.30 + 0.93 * viewFacing -
                                0.23 * viewFacing * viewFacing,
                                0.18,
                                1.0
                            );
                            float textureLuminance = dot(
                                linearize(textureColor),
                                vec3(0.2126, 0.7152, 0.0722)
                            );
                            float photosphere = mix(0.82, 1.16, textureLuminance) *
                                mix(0.91, 1.09, granulation) *
                                mix(0.97, 1.035, fineGranulation);
                            vec3 solar = vec3(1.00, 0.87, 0.60) *
                                photosphere * limbDarkening * 3.2;
                            surfaceColor = displayColor(solar);
                        } else {
                            vec3 base = linearize(textureColor);
                            if (uMaterial > 1.5 && uMaterial < 2.5) {
                                float cloudWarp = (
                                    valueNoise(
                                        vec2(latitude * 16.0, uTime * 0.00012)
                                    ) - 0.5
                                ) * 0.006;
                                vec3 upperCloud = linearize(texture2D(
                                    uSurface,
                                    vec2(
                                        fract(
                                            longitude +
                                            uTime * 0.0000029 +
                                            cloudWarp
                                        ),
                                        clamp(latitude + cloudWarp * 0.35, 0.0, 1.0)
                                    )
                                ).rgb);
                                base = mix(base, upperCloud, 0.31);
                            }
                            if (uBodyStyle > 5.5 && uBodyStyle < 6.5) {
                                float grey = dot(base, vec3(0.2126, 0.7152, 0.0722));
                                base = mix(vec3(grey), base, 0.58);
                            } else if (uBodyStyle > 6.5 && uBodyStyle < 7.5) {
                                float grey = dot(base, vec3(0.2126, 0.7152, 0.0722));
                                base = mix(vec3(grey), base, 0.72) * vec3(1.04, 1.03, 0.94);
                            }
                            float incidence = dot(normalView, lightView);
                            float diffuse = max(incidence, 0.0);
                            float directTransmittance = 1.0;
                            if (uHasRing > 0.5 && abs(lightBody.y) > 0.0005) {
                                float ringShadowDistance = -hitBody.y / lightBody.y;
                                vec3 ringShadowPoint =
                                    hitBody + lightBody * ringShadowDistance;
                                float ringShadowRadius = length(ringShadowPoint.xz);
                                if (
                                    ringShadowDistance > 0.001 &&
                                    ringShadowRadius > 1.18 &&
                                    ringShadowRadius < 2.34
                                ) {
                                    float ringShadowU =
                                        (ringShadowRadius - 1.18) / (2.34 - 1.18);
                                    float ringOpacity = texture2D(
                                        uRing,
                                        vec2(ringShadowU, 0.5)
                                    ).a;
                                    float opticalDepth = -log(max(1.0 - ringOpacity, 0.025));
                                    directTransmittance = exp(
                                        -opticalDepth / max(abs(lightBody.y), 0.07)
                                    );
                                }
                            }
                            float terminator;
                            float illumination;
                            if (uMaterial < 1.5 || uMaterial > 4.5) {
                                terminator = smoothstep(-0.012, 0.022, incidence);
                                float lommelSeeliger = diffuse /
                                    max(diffuse + viewFacing, 0.035);
                                float roughScatter = mix(
                                    diffuse,
                                    min(1.0, lommelSeeliger * 1.85),
                                    0.68
                                );
                                float microRelief = mix(
                                    0.945,
                                    1.055,
                                    valueNoise(vec2(longitude * 520.0, latitude * 280.0))
                                );
                                illumination = 0.0015 +
                                    terminator * roughScatter *
                                    directTransmittance * microRelief;
                            } else if (uMaterial < 2.5) {
                                terminator = smoothstep(-0.16, 0.08, incidence);
                                float multipleScatter = pow(
                                    max(diffuse * max(viewFacing, 0.05), 0.0),
                                    0.44
                                );
                                illumination = 0.002 +
                                    terminator * (0.26 + 0.92 * multipleScatter) *
                                    directTransmittance;
                            } else if (uMaterial < 3.5) {
                                terminator = smoothstep(-0.055, 0.055, incidence);
                                float cloudScatter = pow(
                                    max(diffuse, 0.0),
                                    0.72
                                ) * pow(max(viewFacing, 0.03), 0.12);
                                float bandMicrocontrast = mix(
                                    0.965,
                                    1.035,
                                    valueNoise(vec2(longitude * 210.0, latitude * 470.0))
                                );
                                illumination = 0.0018 +
                                    terminator * (0.16 + cloudScatter) *
                                    directTransmittance * bandMicrocontrast;
                            } else {
                                terminator = smoothstep(-0.07, 0.065, incidence);
                                float hazeScatter = pow(max(diffuse, 0.0), 0.64) *
                                    pow(max(viewFacing, 0.03), 0.08);
                                illumination = 0.002 +
                                    terminator * (0.22 + 0.88 * hazeScatter) *
                                    directTransmittance;
                            }
                            vec3 lit = base * illumination * 1.72;
                            float atmosphereRim = pow(1.0 - viewFacing, 2.2) *
                                smoothstep(-0.22, 0.18, incidence) *
                                uAtmosphereStrength;
                            lit += linearize(uAtmosphereColor) *
                                atmosphereRim * (uMaterial < 2.5 ? 0.82 : 0.48);
                            surfaceColor = displayColor(lit);
                        }
                        float coverageWidth = sqrt(
                            2.0 / max(uRadius * max(uAlpha, 0.35), 1.0)
                        );
                        surfaceAlpha = smoothstep(0.0, coverageWidth, viewFacing);
                    }

                    vec4 ringColor = vec4(0.0);
                    float ringDistance = 1.0e6;
                    if (uHasRing > 0.5 && abs(rayBody.y) > 0.0005) {
                        ringDistance = -originBody.y / rayBody.y;
                        vec3 ringPoint = originBody + rayBody * ringDistance;
                        float ringRadius = length(ringPoint.xz);
                        if (ringDistance > 0.0 && ringRadius > 1.18 && ringRadius < 2.34) {
                            float ringU = (ringRadius - 1.18) / (2.34 - 1.18);
                            vec4 sampledRing = texture2D(uRing, vec2(ringU, 0.5));
                            float muSun = max(abs(lightBody.y), 0.035);
                            float muView = max(abs(rayBody.y), 0.035);
                            float opticalDepth = -log(max(1.0 - sampledRing.a, 0.025));
                            float sameSide = step(0.0, lightBody.y * -rayBody.y);
                            float reflected = (
                                1.0 - exp(
                                    -opticalDepth *
                                    (1.0 / muSun + 1.0 / muView)
                                )
                            ) * muSun / max(muSun + muView, 0.001);
                            float transmitted = exp(-opticalDepth / muSun) *
                                (1.0 - exp(-opticalDepth / muView));
                            float scattering = mix(transmitted * 0.54, reflected * 1.42, sameSide);
                            float planetShadow = ellipsoidShadow(
                                ringPoint + lightBody * 0.003,
                                lightBody,
                                polarRadius
                            );
                            float ringLight = clamp(
                                0.035 + scattering * planetShadow,
                                0.035,
                                1.08
                            );
                            ringColor = vec4(
                                displayColor(linearize(sampledRing.rgb) * ringLight * 2.0),
                                sampledRing.a * mix(0.62, 0.96, muView)
                            );
                        }
                    }

                    bool ringInFront = ringColor.a > 0.001 &&
                        (!sphereHit || ringDistance < sphereNear);
                    bool ringOutsideBody = ringColor.a > 0.001 && !sphereHit;
                    vec4 result = vec4(surfaceColor, surfaceAlpha);
                    if (ringOutsideBody) {
                        result = ringColor;
                    } else if (ringInFront) {
                        result.rgb = mix(result.rgb, ringColor.rgb, ringColor.a);
                        result.a = max(result.a, ringColor.a);
                    }

                    if (uMaterial < 0.5 && !sphereHit) {
                        float coronaDistance = max(
                            sqrt(planeDistanceSquared),
                            0.0001
                        );
                        float coronaAngle = atan(plane.y, plane.x + 1.0e-8);
                        vec2 angleVector = vec2(cos(coronaAngle), sin(coronaAngle));
                        float angularNoise = fbm(
                            angleVector * 4.6 +
                            vec2(uTime * 0.0024, -uTime * 0.0017)
                        );
                        float streamer = pow(
                            0.5 + 0.5 * cos(
                                coronaAngle * 4.0 +
                                angularNoise * 5.4
                            ),
                            7.0
                        );
                        float innerCorona = exp(
                            -max(0.0, coronaDistance - 0.985) * 11.0
                        );
                        float outerCorona = exp(
                            -max(0.0, coronaDistance - 1.0) *
                            mix(3.0, 5.8, angularNoise)
                        ) * (1.0 - smoothstep(1.2, 1.82, coronaDistance));
                        float chromosphere = exp(
                            -abs(coronaDistance - 1.012) * 118.0
                        ) * 0.34;
                        float prominenceMask = smoothstep(
                            0.72,
                            0.91,
                            valueNoise(vec2(coronaAngle * 3.4, 4.7))
                        );
                        float prominence = prominenceMask *
                            smoothstep(1.0, 1.035, coronaDistance) *
                            (1.0 - smoothstep(1.07, 1.19, coronaDistance)) * 0.28;
                        float corona = innerCorona * 0.095 +
                            outerCorona * (0.032 + streamer * 0.12) +
                            chromosphere + prominence;
                        float exposureVeil = (
                            1.0 - smoothstep(1.0, 1.52, coronaDistance)
                        ) * 0.12;
                        vec3 coronaColor = mix(
                            vec3(1.0, 0.34, 0.08),
                            vec3(1.0, 0.88, 0.62),
                            clamp(innerCorona + streamer * 0.3, 0.0, 1.0)
                        );
                        result = vec4(
                            displayColor(coronaColor * (corona * 2.8)),
                            max(corona, exposureVeil)
                        );
                    } else if (
                        uMaterial > 0.5 &&
                        !sphereHit &&
                        ringColor.a <= 0.001 &&
                        uAtmosphereStrength > 0.001
                    ) {
                        float atmosphereDistance = sqrt(planeDistanceSquared);
                        float shell = (
                            1.0 - smoothstep(0.995, 1.09, atmosphereDistance)
                        ) *
                            smoothstep(0.975, 1.008, atmosphereDistance);
                        vec2 limbDirection = normalize(plane + vec2(0.0001));
                        vec2 sunDirection = normalize(lightView.xy + vec2(0.0001));
                        float sunward = 0.26 + 0.74 *
                            pow(max(dot(limbDirection, sunDirection), 0.0), 0.55);
                        float forwardAureole = uMaterial > 1.5 && uMaterial < 2.5
                            ? pow(max(dot(limbDirection, sunDirection), 0.0), 6.0) * 0.8
                            : 0.0;
                        float shellAlpha = shell * uAtmosphereStrength *
                            (0.21 + sunward * 0.36 + forwardAureole);
                        result = vec4(
                            displayColor(
                                linearize(uAtmosphereColor) *
                                (0.28 + sunward * 0.82 + forwardAureole)
                            ),
                            shellAlpha
                        );
                    }

                    result.a *= uAlpha;
                    if (result.a < 0.002) discard;
                    result.rgb += (
                        hash(floor(pixel)) - 0.5
                    ) / 255.0;
                    gl_FragColor = vec4(
                        clamp(result.rgb, vec3(0.0), vec3(1.0)),
                        result.a
                    );
                }
                `
            );
            const gl = this.gl;
            this.quadBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
                gl.STATIC_DRAW
            );
            this.locations = {
                position: gl.getAttribLocation(this.program, 'aPosition'),
                resolution: gl.getUniformLocation(this.program, 'uResolution'),
                center: gl.getUniformLocation(this.program, 'uCenter'),
                radius: gl.getUniformLocation(this.program, 'uRadius'),
                flattening: gl.getUniformLocation(this.program, 'uFlattening'),
                alpha: gl.getUniformLocation(this.program, 'uAlpha'),
                time: gl.getUniformLocation(this.program, 'uTime'),
                material: gl.getUniformLocation(this.program, 'uMaterial'),
                bodyStyle: gl.getUniformLocation(this.program, 'uBodyStyle'),
                atmosphereStrength: gl.getUniformLocation(
                    this.program,
                    'uAtmosphereStrength'
                ),
                hasRing: gl.getUniformLocation(this.program, 'uHasRing'),
                ringOpening: gl.getUniformLocation(this.program, 'uRingOpening'),
                longitudeOffset: gl.getUniformLocation(this.program, 'uLongitudeOffset'),
                lightView: gl.getUniformLocation(this.program, 'uLightView'),
                atmosphereColor: gl.getUniformLocation(
                    this.program,
                    'uAtmosphereColor'
                ),
                viewToBody: gl.getUniformLocation(this.program, 'uViewToBody'),
                bodyToView: gl.getUniformLocation(this.program, 'uBodyToView'),
                surface: gl.getUniformLocation(this.program, 'uSurface'),
                ring: gl.getUniformLocation(this.program, 'uRing')
            };
            this.ready = true;
            this.textures.clear();
            this.resize();
            return true;
        } catch (error) {
            return this.activateFallback(error);
        }
    }

    createShader(type, source) {
        const shader = this.gl.createShader(type);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const message = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error(message || 'Celestial close-up shader compilation failed');
        }
        return shader;
    }

    createProgram(vertexSource, fragmentSource) {
        const gl = this.gl;
        const program = gl.createProgram();
        const vertex = this.createShader(gl.VERTEX_SHADER, vertexSource);
        const fragment = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const message = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(message || 'Celestial close-up program linking failed');
        }
        return program;
    }

    loadImage(path) {
        if (this.images.has(path)) return Promise.resolve(this.images.get(path));
        if (this.imagePromises.has(path)) return this.imagePromises.get(path);
        const promise = new Promise((resolve, reject) => {
            if (typeof Image !== 'function') {
                reject(new Error(`Image decoding unavailable for ${path}`));
                return;
            }
            const image = new Image();
            let settled = false;
            let timeout = 0;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                image.onload = null;
                image.onerror = null;
                callback(value);
            };
            timeout = window.setTimeout(() => {
                finish(reject, new Error(`Timed out while loading ${path}`));
            }, 4000);
            image.decoding = 'async';
            image.onload = () => {
                const decoded = typeof image.decode === 'function'
                    ? image.decode().catch(() => undefined)
                    : Promise.resolve();
                decoded.then(() => {
                    if (settled) return;
                    this.images.set(path, image);
                    const staleTexture = this.textures.get(path);
                    if (staleTexture && this.gl) this.gl.deleteTexture(staleTexture);
                    this.textures.delete(path);
                    this.fallbackSpheres.delete(path);
                    finish(resolve, image);
                });
            };
            image.onerror = () => {
                finish(reject, new Error(`Unable to load ${path}`));
            };
            image.src = path;
        }).finally(() => this.imagePromises.delete(path));
        this.imagePromises.set(path, promise);
        return promise;
    }

    installFallbackSurface(profile) {
        if (!profile?.texture || this.images.has(profile.texture)) return;
        const surface = document.createElement('canvas');
        surface.width = 512;
        surface.height = 256;
        const context = surface.getContext('2d');
        const base = context.createLinearGradient(0, 0, 0, surface.height);
        base.addColorStop(0, '#f0eee6');
        base.addColorStop(0.5, profile.color || '#9aa6bb');
        base.addColorStop(1, '#3c4250');
        context.fillStyle = base;
        context.fillRect(0, 0, surface.width, surface.height);
        context.globalCompositeOperation = 'soft-light';
        for (let index = 0; index < 42; index += 1) {
            const seed = (index * 0.61803398875) % 1;
            const y = seed * surface.height;
            const height = 2 + ((index * 17) % 13);
            context.fillStyle = index % 3 === 0
                ? 'rgba(255,255,255,0.16)'
                : 'rgba(13,19,31,0.13)';
            context.fillRect(0, y, surface.width, height);
        }
        context.globalCompositeOperation = 'source-over';
        this.images.set(profile.texture, surface);
        this.fallbackSpheres.delete(profile.texture);

        if (profile.ringTexture && !this.images.has(profile.ringTexture)) {
            const ring = document.createElement('canvas');
            ring.width = 1024;
            ring.height = 8;
            const ringContext = ring.getContext('2d');
            const radial = ringContext.createLinearGradient(0, 0, ring.width, 0);
            radial.addColorStop(0, 'rgba(0,0,0,0)');
            radial.addColorStop(0.08, 'rgba(186,164,120,0.44)');
            radial.addColorStop(0.35, 'rgba(238,222,181,0.88)');
            radial.addColorStop(0.52, 'rgba(34,30,25,0.16)');
            radial.addColorStop(0.58, 'rgba(226,207,166,0.84)');
            radial.addColorStop(0.9, 'rgba(181,165,132,0.34)');
            radial.addColorStop(1, 'rgba(0,0,0,0)');
            ringContext.fillStyle = radial;
            ringContext.fillRect(0, 0, ring.width, ring.height);
            this.images.set(profile.ringTexture, ring);
        }
    }

    fallbackMoonOrientation(profile) {
        const current = profile.current;
        if (!current?.direction) return null;
        const { bodyX, bodyNorth, bodyZ } = this.bodyAxes(profile);
        const viewForward = normalize(current.direction);
        const northProjection = dot(bodyNorth, viewForward);
        let viewUp = [
            bodyNorth[0] - viewForward[0] * northProjection,
            bodyNorth[1] - viewForward[1] * northProjection,
            bodyNorth[2] - viewForward[2] * northProjection
        ];
        viewUp = vectorLength(viewUp) < 0.001
            ? tangentBasis(viewForward).bitangent
            : normalize(viewUp);
        const viewRight = normalize(cross(viewUp, viewForward));
        viewUp = normalize(cross(viewForward, viewRight));
        const viewToBody = [
            dot(viewRight, bodyX),
            dot(viewUp, bodyX),
            dot(viewForward, bodyX),
            dot(viewRight, bodyNorth),
            dot(viewUp, bodyNorth),
            dot(viewForward, bodyNorth),
            dot(viewRight, bodyZ),
            dot(viewUp, bodyZ),
            dot(viewForward, bodyZ)
        ];
        return {
            key: viewToBody.map(value => value.toFixed(4)).join(','),
            viewToBody
        };
    }

    fallbackSphereFor(profile) {
        const path = profile?.texture;
        const image = this.images.get(path);
        if (!image) return null;
        const orientation = profile.id === 'moon'
            ? this.fallbackMoonOrientation(profile)
            : null;
        const cacheKey = orientation?.key || 'static';
        const cached = this.fallbackSpheres.get(path);
        if (cached?.key === cacheKey) return cached.image;
        const size = COARSE_POINTER ? 384 : 512;
        const mapWidth = size;
        const mapHeight = Math.max(1, size >> 1);
        const source = document.createElement('canvas');
        source.width = mapWidth;
        source.height = mapHeight;
        const sourceContext = source.getContext('2d', { willReadFrequently: true });
        const sphere = document.createElement('canvas');
        sphere.width = size;
        sphere.height = size;
        const sphereContext = sphere.getContext('2d');
        if (
            !sourceContext?.getImageData ||
            !sphereContext?.createImageData ||
            !sphereContext?.putImageData
        ) {
            this.fallbackSpheres.set(path, { key: cacheKey, image });
            return image;
        }
        try {
            sourceContext.drawImage(image, 0, 0, mapWidth, mapHeight);
            const map = sourceContext.getImageData(0, 0, mapWidth, mapHeight).data;
            const projected = sphereContext.createImageData(size, size);
            const output = projected.data;
            const longitudeOffset = (profile.longitudeOffset || 0) / (Math.PI * 2);
            const viewToBody = orientation?.viewToBody;
            for (let y = 0; y < size; y += 1) {
                const normalY = 1 - ((y + 0.5) / size) * 2;
                for (let x = 0; x < size; x += 1) {
                    const normalX = ((x + 0.5) / size) * 2 - 1;
                    const radialSquared = normalX * normalX + normalY * normalY;
                    if (radialSquared > 1) continue;
                    const normalZ = Math.sqrt(Math.max(0, 1 - radialSquared));
                    const bodyX = viewToBody
                        ? viewToBody[0] * normalX +
                            viewToBody[1] * normalY -
                            viewToBody[2] * normalZ
                        : normalX;
                    const bodyY = viewToBody
                        ? viewToBody[3] * normalX +
                            viewToBody[4] * normalY -
                            viewToBody[5] * normalZ
                        : normalY;
                    const bodyZ = viewToBody
                        ? viewToBody[6] * normalX +
                            viewToBody[7] * normalY -
                            viewToBody[8] * normalZ
                        : -normalZ;
                    const longitude = (
                        Math.atan2(bodyZ, bodyX) / (Math.PI * 2) +
                        0.5 + longitudeOffset + 1
                    ) % 1;
                    const latitude = Math.asin(clamp(bodyY, -1, 1)) /
                        Math.PI + 0.5;
                    const sourceX = Math.min(
                        mapWidth - 1,
                        Math.max(0, Math.floor(longitude * mapWidth))
                    );
                    const sourceY = Math.min(
                        mapHeight - 1,
                        Math.max(0, Math.floor((1 - latitude) * mapHeight))
                    );
                    const sourceIndex = (sourceY * mapWidth + sourceX) * 4;
                    const outputIndex = (y * size + x) * 4;
                    const limb = 0.62 + 0.38 * Math.pow(normalZ, 0.34);
                    const coverage = clamp((1 - radialSquared) * size * 0.7, 0, 1);
                    output[outputIndex] = map[sourceIndex] * limb;
                    output[outputIndex + 1] = map[sourceIndex + 1] * limb;
                    output[outputIndex + 2] = map[sourceIndex + 2] * limb;
                    output[outputIndex + 3] = map[sourceIndex + 3] * coverage;
                }
            }
            sphereContext.putImageData(projected, 0, 0);
            this.fallbackSpheres.set(path, { key: cacheKey, image: sphere });
            return sphere;
        } catch (error) {
            this.fallbackSpheres.set(path, { key: cacheKey, image });
            return image;
        }
    }

    async prepare(profile) {
        if (!profile?.texture) throw new Error('Celestial surface texture is missing');
        const webglReady = this.initialize();
        const paths = [profile.texture];
        if (profile.ringTexture) paths.push(profile.ringTexture);
        await Promise.all(paths.map(path => this.loadImage(path)));
        if (webglReady) {
            try {
                paths.forEach(path => {
                    if (!this.textureFor(path)) {
                        throw new Error(`Unable to upload celestial texture ${path}`);
                    }
                });
            } catch (error) {
                this.activateFallback(error);
            }
        }
        this.activeProfile = profile;
        return profile;
    }

    textureFor(path) {
        if (!this.ready || !path || !this.images.has(path)) return null;
        if (this.textures.has(path)) return this.textures.get(path);
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (this.anisotropyExtension) {
            const extension = this.anisotropyExtension;
            const maximum = typeof gl.getParameter === 'function'
                ? gl.getParameter(extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
                : 1;
            gl.texParameterf(
                gl.TEXTURE_2D,
                extension.TEXTURE_MAX_ANISOTROPY_EXT,
                Math.min(8, maximum || 1)
            );
        }
        gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            this.images.get(path)
        );
        gl.generateMipmap(gl.TEXTURE_2D);
        this.textures.set(path, texture);
        return texture;
    }

    resize() {
        const viewportPixels = Math.max(1, window.innerWidth * window.innerHeight);
        const pixelBudget = COARSE_POINTER ? 2200000 : 3200000;
        const budgetScale = Math.sqrt(pixelBudget / viewportPixels);
        this.dpr = Math.min(
            window.devicePixelRatio || 1,
            COARSE_POINTER ? 1.1 : 1.25,
            budgetScale
        );
        const pixelWidth = Math.max(1, Math.round(window.innerWidth * this.dpr));
        const pixelHeight = Math.max(1, Math.round(window.innerHeight * this.dpr));
        let resized = false;
        [this.canvas, this.fallbackCanvas].forEach(canvas => {
            if (canvas.width === pixelWidth && canvas.height === pixelHeight) return;
            canvas.width = pixelWidth;
            canvas.height = pixelHeight;
            canvas.style.width = `${window.innerWidth}px`;
            canvas.style.height = `${window.innerHeight}px`;
            resized = true;
        });
        if (resized) {
            this.hasVisibleFrame = false;
            this.fallbackVisible = false;
            this.lastRenderedAt = -Infinity;
        }
        return resized;
    }

    viewAxes(profile, basis) {
        const viewForward = normalize(
            profile.current?.direction || basis.forward
        );
        let viewRight = [
            basis.right[0] - viewForward[0] * dot(basis.right, viewForward),
            basis.right[1] - viewForward[1] * dot(basis.right, viewForward),
            basis.right[2] - viewForward[2] * dot(basis.right, viewForward)
        ];
        if (vectorLength(viewRight) < 0.001) {
            viewRight = tangentBasis(viewForward).tangent;
        } else {
            viewRight = normalize(viewRight);
        }
        let viewUp = normalize(cross(viewForward, viewRight));
        if (dot(viewUp, basis.up) < 0) {
            viewRight = viewRight.map(value => -value);
            viewUp = viewUp.map(value => -value);
        }
        return { viewRight, viewUp, viewForward };
    }

    bodyAxes(profile) {
        const current = profile.current;
        const northEqj = normalize(current?.northEqj || [0, 0, 1]);
        let equatorReference = cross([0, 0, 1], northEqj);
        if (vectorLength(equatorReference) < 0.001) {
            equatorReference = cross([1, 0, 0], northEqj);
        }
        equatorReference = normalize(equatorReference);
        const spinRadians = (((current?.spin || 0) % 360) + 360) % 360 * DEG;
        const bodyXEqj = rotateVectorAroundAxis(
            equatorReference,
            northEqj,
            spinRadians
        );
        const bodyZEqj = normalize(cross(bodyXEqj, northEqj));
        const bodyX = equatorialVectorToLocal(bodyXEqj);
        const bodyNorth = equatorialVectorToLocal(northEqj);
        const bodyZ = equatorialVectorToLocal(bodyZEqj);
        return { bodyX, bodyNorth, bodyZ };
    }

    bodyMatrices(profile, basis) {
        const { bodyX, bodyNorth, bodyZ } = this.bodyAxes(profile);
        const { viewRight, viewUp, viewForward } = this.viewAxes(profile, basis);
        const viewToBodyRows = [
            [dot(viewRight, bodyX), dot(viewUp, bodyX), dot(viewForward, bodyX)],
            [dot(viewRight, bodyNorth), dot(viewUp, bodyNorth), dot(viewForward, bodyNorth)],
            [dot(viewRight, bodyZ), dot(viewUp, bodyZ), dot(viewForward, bodyZ)]
        ];
        const bodyToViewRows = [
            [dot(bodyX, viewRight), dot(bodyNorth, viewRight), dot(bodyZ, viewRight)],
            [dot(bodyX, viewUp), dot(bodyNorth, viewUp), dot(bodyZ, viewUp)],
            [dot(bodyX, viewForward), dot(bodyNorth, viewForward), dot(bodyZ, viewForward)]
        ];
        const pack = rows => new Float32Array([
            rows[0][0], rows[1][0], rows[2][0],
            rows[0][1], rows[1][1], rows[2][1],
            rows[0][2], rows[1][2], rows[2][2]
        ]);
        return {
            viewToBody: pack(viewToBodyRows),
            bodyToView: pack(bodyToViewRows)
        };
    }

    lightInView(profile, basis) {
        if (profile.id === 'sun') return [0, 0, -1];
        const toSunEqj = normalize((profile.current?.hc || [0, 0, 1]).map(value => -value));
        const toSun = equatorialVectorToLocal(toSunEqj);
        const { viewRight, viewUp, viewForward } = this.viewAxes(profile, basis);
        return normalize([
            dot(toSun, viewRight),
            dot(toSun, viewUp),
            dot(toSun, viewForward)
        ]);
    }

    traceIlluminatedPhase(
        context,
        centerX,
        centerY,
        radiusX,
        radiusY,
        lightAngle,
        phaseAngle
    ) {
        const cosine = Math.cos(clamp(phaseAngle, 0, 180) * DEG);
        const segments = 48;
        context.save();
        context.translate(centerX, centerY);
        context.rotate(lightAngle);
        context.beginPath();
        context.moveTo(0, -radiusY);
        for (let index = 0; index <= segments; index += 1) {
            const angle = -Math.PI * 0.5 + Math.PI * index / segments;
            context.lineTo(
                radiusX * Math.cos(angle),
                radiusY * Math.sin(angle)
            );
        }
        for (let index = segments; index >= 0; index -= 1) {
            const angle = -Math.PI * 0.5 + Math.PI * index / segments;
            context.lineTo(
                -cosine * radiusX * Math.cos(angle),
                radiusY * Math.sin(angle)
            );
        }
        context.closePath();
        context.restore();
    }

    startAnchorForVisit(visit) {
        const returning = visit.phase === 'returning';
        return {
            screen: returning ? visit.originScreen : visit.approachScreen,
            discGeometry: returning
                ? visit.originDiscGeometry
                : visit.approachDiscGeometry
        };
    }

    startRadiusForVisit(visit) {
        const profile = visit.profile;
        if (!profile.angularDisc) return 1.25;
        const projectedRadius = this.startAnchorForVisit(
            visit
        ).discGeometry?.areaRadius;
        if (Number.isFinite(projectedRadius)) {
            return clamp(projectedRadius, 1.2, 56);
        }
        return clamp(
            profile.current.angularDiameter *
                window.innerHeight / (4 * Math.tan(visit.origin.fov * 0.5)),
            1.2,
            22
        );
    }

    renderFallback(time, visit, basis) {
        const context = this.fallbackContext;
        const profile = visit.profile;
        const image = this.fallbackSphereFor(profile);
        if (!context || !image) return false;
        this.resize();
        context.clearRect(
            0,
            0,
            this.fallbackCanvas.width,
            this.fallbackCanvas.height
        );
        const progress = clamp(visit.visualProgress, 0, 1);
        const stage = celestialStageLayout(
            profile,
            visit.panelOnLeft,
            window.innerWidth,
            window.innerHeight
        );
        const start = this.startAnchorForVisit(visit).screen || {
            x: window.innerWidth * 0.5,
            y: window.innerHeight * 0.5
        };
        const startRadius = this.startRadiusForVisit(visit);
        const radius = lerp(startRadius, stage.radius, Math.pow(progress, 1.18)) * this.dpr;
        const centerX = lerp(start.x, stage.centerX, progress) * this.dpr;
        const centerY = lerp(start.y, stage.centerY, progress) * this.dpr;
        const polarRadius = radius * Math.max(0.72, 1 - (profile.flattening || 0));
        const alpha = smoothstep(0.04, 0.26, progress);
        const light = this.lightInView(profile, basis);
        const lightAngle = Math.atan2(-light[1], light[0]);
        const surfaceRotation = profile.id === 'moon'
            ? (() => {
                const { viewRight, viewUp } = this.viewAxes(profile, basis);
                const north = profile.current?.north || [0, 1, 0];
                return Math.atan2(
                    -dot(north, viewUp),
                    dot(north, viewRight)
                ) + Math.PI * 0.5;
            })()
            : 0;
        const drawSurface = () => {
            context.save();
            context.translate(centerX, centerY);
            context.rotate(surfaceRotation);
            context.drawImage(
                image,
                -radius,
                -polarRadius,
                radius * 2,
                polarRadius * 2
            );
            context.restore();
        };

        context.save();
        context.globalAlpha = alpha;
        context.globalCompositeOperation = 'source-over';
        if (profile.id === 'sun') {
            const corona = context.createRadialGradient(
                centerX,
                centerY,
                radius * 0.84,
                centerX,
                centerY,
                radius * 1.72
            );
            corona.addColorStop(0, 'rgba(255,233,164,0.34)');
            corona.addColorStop(0.44, 'rgba(255,194,82,0.13)');
            corona.addColorStop(1, 'rgba(255,176,64,0)');
            context.fillStyle = corona;
            context.beginPath();
            context.arc(centerX, centerY, radius * 1.72, 0, Math.PI * 2);
            context.fill();
        }

        const ringOpening = Math.abs(Math.sin((profile.current?.ringTilt || 0) * DEG));
        const ringMinor = Math.max(radius * 0.055, radius * 2.12 * ringOpening);
        const ringRotation = Math.atan2(
            dot(profile.current?.north || [0, 1, 0], basis.up),
            dot(profile.current?.north || [0, 1, 0], basis.right)
        ) + Math.PI * 0.5;
        if (profile.id === 'saturn') {
            context.strokeStyle = 'rgba(211,196,155,0.52)';
            context.lineWidth = radius * 0.34;
            context.beginPath();
            context.ellipse(
                centerX,
                centerY,
                radius * 2.12,
                ringMinor,
                ringRotation,
                0,
                Math.PI * 2
            );
            context.stroke();
        }

        context.save();
        context.beginPath();
        context.ellipse(centerX, centerY, radius, polarRadius, 0, 0, Math.PI * 2);
        context.clip();
        drawSurface();

        if (profile.id === 'moon') {
            context.fillStyle = 'rgba(0,2,8,0.94)';
            context.fillRect(
                centerX - radius,
                centerY - polarRadius,
                radius * 2,
                polarRadius * 2
            );
            context.save();
            this.traceIlluminatedPhase(
                context,
                centerX,
                centerY,
                radius,
                polarRadius,
                lightAngle,
                profile.current?.phaseAngle || 0
            );
            context.clip();
            drawSurface();
            context.restore();
        } else if (profile.id !== 'sun') {
            const directionX = Math.cos(lightAngle);
            const directionY = Math.sin(lightAngle);
            const shadow = context.createLinearGradient(
                centerX - directionX * radius,
                centerY - directionY * radius,
                centerX + directionX * radius,
                centerY + directionY * radius
            );
            const boundary = clamp(1 - (profile.current?.phase || 0.5), 0, 1);
            shadow.addColorStop(0, 'rgba(0,2,8,0.96)');
            shadow.addColorStop(
                clamp(boundary - 0.055, 0, 1),
                'rgba(0,2,8,0.94)'
            );
            shadow.addColorStop(
                clamp(boundary + 0.055, 0, 1),
                'rgba(0,2,8,0.02)'
            );
            shadow.addColorStop(1, 'rgba(0,2,8,0)');
            context.fillStyle = shadow;
            context.fillRect(
                centerX - radius,
                centerY - polarRadius,
                radius * 2,
                polarRadius * 2
            );
        } else {
            const limb = context.createRadialGradient(
                centerX - radius * 0.18,
                centerY - radius * 0.16,
                radius * 0.08,
                centerX,
                centerY,
                radius
            );
            limb.addColorStop(0, 'rgba(255,252,222,0.06)');
            limb.addColorStop(0.72, 'rgba(255,225,126,0.02)');
            limb.addColorStop(1, 'rgba(120,35,0,0.36)');
            context.fillStyle = limb;
            context.fillRect(
                centerX - radius,
                centerY - polarRadius,
                radius * 2,
                polarRadius * 2
            );
        }
        context.restore();

        if (profile.id === 'saturn') {
            context.strokeStyle = 'rgba(235,220,181,0.7)';
            context.lineWidth = radius * 0.3;
            context.beginPath();
            context.ellipse(
                centerX,
                centerY,
                radius * 2.12,
                ringMinor,
                ringRotation,
                0,
                Math.PI
            );
            context.stroke();
        }
        context.restore();
        return true;
    }

    render(time, visit, basis) {
        if (!visit || visit.visualProgress <= 0.001 || !visit.textureReady) {
            if (this.hasVisibleFrame) this.clear();
            return false;
        }
        if (visit.phase === 'observing' && this.hasVisibleFrame) {
            const interval = visit.profile.id === 'sun'
                ? 1000 / 24
                : visit.profile.id === 'venus'
                    ? 1000 / 30
                    : 500;
            if (time - this.lastRenderedAt < interval) return true;
        }
        try {
            if (!this.initialize()) {
                const fallbackRendered = this.renderFallback(time, visit, basis);
                this.hasVisibleFrame = fallbackRendered;
                this.fallbackVisible = fallbackRendered;
                if (fallbackRendered) this.lastRenderedAt = time;
                return fallbackRendered;
            }
            const rendered = this.renderWebgl(time, visit, basis);
            if (!rendered) {
                const fallbackRendered = this.renderFallback(time, visit, basis);
                this.hasVisibleFrame = fallbackRendered;
                this.fallbackVisible = fallbackRendered;
                if (fallbackRendered) this.lastRenderedAt = time;
                return fallbackRendered;
            }
            if (this.fallbackVisible && this.fallbackContext) {
                this.fallbackContext.clearRect(
                    0,
                    0,
                    this.fallbackCanvas.width,
                    this.fallbackCanvas.height
                );
            }
            this.hasVisibleFrame = true;
            this.fallbackVisible = false;
            this.lastRenderedAt = time;
            return rendered;
        } catch (error) {
            this.activateFallback(error);
            try {
                const fallbackRendered = this.renderFallback(time, visit, basis);
                this.hasVisibleFrame = fallbackRendered;
                this.fallbackVisible = fallbackRendered;
                if (fallbackRendered) this.lastRenderedAt = time;
                return fallbackRendered;
            } catch (fallbackError) {
                if (!this.failureReported) {
                    this.failureReported = true;
                    console.warn('Celestial close-up fallback could not draw:', fallbackError);
                }
                this.hasVisibleFrame = false;
                this.fallbackVisible = false;
                return false;
            }
        }
    }

    renderWebgl(time, visit, basis) {
        const profile = visit.profile;
        const surfaceTexture = this.textureFor(profile.texture);
        const ringTexture = profile.ringTexture
            ? this.textureFor(profile.ringTexture)
            : null;
        if (!surfaceTexture || (profile.ringTexture && !ringTexture)) return false;

        this.resize();
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(
            gl.SRC_ALPHA,
            gl.ONE_MINUS_SRC_ALPHA,
            gl.ONE,
            gl.ONE_MINUS_SRC_ALPHA
        );
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.program);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
        gl.enableVertexAttribArray(this.locations.position);
        gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);

        const progress = clamp(visit.visualProgress, 0, 1);
        const stage = celestialStageLayout(
            profile,
            visit.panelOnLeft,
            window.innerWidth,
            window.innerHeight
        );
        const start = this.startAnchorForVisit(visit).screen || {
            x: window.innerWidth * 0.5,
            y: window.innerHeight * 0.5
        };
        const startRadius = this.startRadiusForVisit(visit);
        const radius = lerp(startRadius, stage.radius, Math.pow(progress, 1.18));
        const centerX = lerp(start.x, stage.centerX, progress);
        const centerY = lerp(start.y, stage.centerY, progress);
        const matrices = this.bodyMatrices(profile, basis);
        const light = this.lightInView(profile, basis);
        const material = {
            sun: 0,
            rock: 1,
            cloud: 2,
            gas: 3,
            ice: 4,
            'ice-rock': 5
        }[profile.material] ?? 1;
        const renderProfile = CELESTIAL_RENDER_PROFILES[profile.id] ||
            CELESTIAL_RENDER_PROFILES.mercury;

        gl.uniform2f(
            this.locations.resolution,
            this.canvas.width,
            this.canvas.height
        );
        gl.uniform2f(
            this.locations.center,
            centerX * this.dpr,
            centerY * this.dpr
        );
        gl.uniform1f(this.locations.radius, radius * this.dpr);
        gl.uniform1f(this.locations.flattening, profile.flattening || 0);
        gl.uniform1f(this.locations.alpha, smoothstep(0.04, 0.26, progress));
        gl.uniform1f(this.locations.time, REDUCED_MOTION ? 0 : time * 0.001);
        gl.uniform1f(this.locations.material, material);
        gl.uniform1f(this.locations.bodyStyle, renderProfile.style);
        gl.uniform1f(
            this.locations.atmosphereStrength,
            renderProfile.atmosphere
        );
        gl.uniform1f(this.locations.hasRing, ringTexture ? 1 : 0);
        gl.uniform1f(
            this.locations.ringOpening,
            (profile.current?.ringTilt || 0) * DEG
        );
        gl.uniform1f(
            this.locations.longitudeOffset,
            (profile.longitudeOffset || 0) / (Math.PI * 2)
        );
        gl.uniform3fv(this.locations.lightView, light);
        gl.uniform3fv(
            this.locations.atmosphereColor,
            renderProfile.atmosphereColor
        );
        gl.uniformMatrix3fv(this.locations.viewToBody, false, matrices.viewToBody);
        gl.uniformMatrix3fv(this.locations.bodyToView, false, matrices.bodyToView);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, surfaceTexture);
        gl.uniform1i(this.locations.surface, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, ringTexture || surfaceTexture);
        gl.uniform1i(this.locations.ring, 1);
        const visualExtent = radius * (
            profile.id === 'saturn'
                ? 2.42
                : profile.id === 'sun'
                    ? 1.84
                    : renderProfile.atmosphere > 0
                        ? 1.1
                        : 1.06
        );
        const scissorLeft = clamp(
            Math.floor((centerX - visualExtent) * this.dpr),
            0,
            this.canvas.width
        );
        const scissorRight = clamp(
            Math.ceil((centerX + visualExtent) * this.dpr),
            0,
            this.canvas.width
        );
        const scissorBottom = clamp(
            Math.floor(this.canvas.height - (centerY + visualExtent) * this.dpr),
            0,
            this.canvas.height
        );
        const scissorTop = clamp(
            Math.ceil(this.canvas.height - (centerY - visualExtent) * this.dpr),
            0,
            this.canvas.height
        );
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(
            scissorLeft,
            scissorBottom,
            Math.max(1, scissorRight - scissorLeft),
            Math.max(1, scissorTop - scissorBottom)
        );
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disable(gl.SCISSOR_TEST);
        gl.disable(gl.BLEND);
        return true;
    }

    clear() {
        if (!this.hasVisibleFrame) return;
        if (this.gl && !this.webglFailed) {
            this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
            this.gl.clearColor(0, 0, 0, 0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        }
        if (this.fallbackContext) {
            this.fallbackContext.clearRect(
                0,
                0,
                this.fallbackCanvas.width,
                this.fallbackCanvas.height
            );
        }
        this.hasVisibleFrame = false;
        this.fallbackVisible = false;
        this.lastRenderedAt = -Infinity;
    }
}

const galaxyRenderer = new GalaxyRenderer(dom.spaceCanvas);
const celestialCloseupRenderer = new CelestialCloseupRenderer(
    dom.celestialCloseupCanvas,
    dom.celestialCloseupFallbackCanvas
);
