class StarMapRenderer {
    constructor(canvas, fallbackCanvas, stars) {
        this.canvas = canvas;
        this.fallbackCanvas = fallbackCanvas;
        this.fallback = fallbackCanvas.getContext('2d');
        this.localStars = stars;
        // Keep the nearby Hipparcos catalogue intact, then add a sparse finite
        // continuation of the Milky Way.  These points stay in galactic
        // coordinates and therefore retain parallax while the observer moves.
        this.environmentStars = this.buildEnvironmentStars();
        this.stars = new Float32Array(stars.length + this.environmentStars.length);
        this.stars.set(stars);
        this.stars.set(this.environmentStars, stars.length);
        this.environmentStarCount = this.environmentStars.length / 9;
        this.environmentStrength = 1;
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
                console.warn('Milky Way environment could not restore its texture:', error.message);
            });
        });
        requestAnimationFrame(() => this.loadSkyAssets());
    }

    buildEnvironmentStars() {
        const values = [];
        let seed = 0x51f15e;
        const random = () => {
            seed += 0x6d2b79f5;
            let value = Math.imul(seed ^ seed >>> 15, seed | 1);
            value ^= value + Math.imul(value ^ value >>> 7, value | 61);
            return ((value ^ value >>> 14) >>> 0) / 4294967296;
        };
        const add = (x, y, z, warmth, light, size) => values.push(x, y, z,
            lerp(0.72, 1, warmth), lerp(0.84, 0.79, warmth), lerp(1, 0.61, warmth), light, size, 3);
        // Four finite, offset arm segments.  Their uneven density and waviness
        // keep the background from reading as a concentric shell.
        const arms = [
            { z: 105, curve: 0.000075, wave: 135, frequency: 0.00125, spread: 145, weight: 1.0 },
            { z: -1130, curve: 0.000045, wave: 180, frequency: 0.00088, spread: 205, weight: 0.68 },
            { z: 1570, curve: 0.000055, wave: 215, frequency: 0.00102, spread: 230, weight: 0.55 },
            { z: 780, curve: -0.00008, wave: 170, frequency: 0.00155, spread: 190, weight: 0.42 }
        ];
        this.environmentClouds = [];
        for (const arm of arms) {
            for (let sample = 0; sample < 27; sample++) {
                const x = sample * 235 - 3055;
                const z = arm.z + arm.curve * x * x + Math.sin(x * arm.frequency) * arm.wave;
                if (Math.hypot(x, z) > 330 && Math.hypot(x, z) < 3600) {
                    this.environmentClouds.push({ position: [x, Math.sin(x * 0.0014 + z * 0.0006) * 30, z],
                        radius: arm.spread * (0.95 + random() * 0.45), weight: arm.weight * (0.55 + random() * 0.45) });
                }
            }
            for (let index = 0; index < 12500; index++) {
                const x = random() * 6500 - 3250;
                const centre = arm.z + arm.curve * x * x + Math.sin(x * arm.frequency) * arm.wave;
                const z = centre + (random() + random() + random() - 1.5) * arm.spread;
                const y = Math.sin(x * 0.0014 + z * 0.0006) * 30
                    + (random() + random() + random() - 1.5) * (78 + Math.abs(x) * 0.012);
                const radius = Math.hypot(x, z);
                if (radius < 180 || radius > 3600) continue;
                const clump = random();
                if (clump > arm.weight * 0.52) continue;
                const warmth = clamp(0.18 + random() * 0.7 + (clump < 0.055 ? 0.2 : 0), 0, 1);
                const light = (0.16 + Math.pow(random(), 2) * 0.56) * (0.6 + arm.weight * 0.4)
                    * (clump < 0.055 ? 1.6 : 1);
                add(x, y, z, warmth, light, 4.0 + random() * 3.4);
            }
        }
        this.armStarCount = values.length / 9;
        // Older disk stars also populate the spaces between spiral arms. These
        // have finite depths and a thicker vertical distribution, not a shell.
        for (let index = 0; index < 8500; index++) {
            const radius = 240 + Math.pow(random(), 0.65) * 4700;
            const angle = random() * Math.PI * 2;
            const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
            const height = index % 4 === 0 ? 1400 : 320;
            const y = (random() + random() + random() - 1.5) * height;
            const light = 0.11 + Math.pow(random(), 3) * 0.45;
            add(x, y, z, 0.35 + random() * 0.65, light, 3.8 + random() * 2.6);
        }
        this.interarmStarCount = values.length / 9 - this.armStarCount;
        // A much sparser halo carries a few foreground points above and below
        // the disk; the actual far sky still comes from the ESO photograph and
        // Hipparcos catalogue, with their observed angular distribution.
        for (let index = 0; index < 2200; index++) {
            const radius = 850 + random() * 4200;
            const latitude = random() * 2 - 1, azimuth = random() * Math.PI * 2;
            const plane = Math.sqrt(1 - latitude * latitude) * radius;
            add(Math.cos(azimuth) * plane, latitude * radius, Math.sin(azimuth) * plane,
                0.35 + random() * 0.65, 0.14 + Math.pow(random(), 3) * 0.35, 4 + random() * 2);
        }
        this.haloStarCount = values.length / 9 - this.armStarCount - this.interarmStarCount;
        return new Float32Array(values);
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
                uniform vec3 uGalacticCamera;
                uniform float uGalacticStrength;
                uniform float uSkyVisibility;
                uniform float uEnvironmentStrength;
                uniform sampler2D uGalacticDisk;
                uniform sampler2D uGalacticDust;
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
                    float localTransmission = 1.0;
                    // A finite volume surrounds the original neighbourhood.  The
                    // local spur continues outwards, with adjacent arm fragments
                    // at different depths.  Do not anchor this field to the eye.
                    if (uGalaxy < 1.0 && uEnvironmentStrength > 0.0) {
                        vec3 extent = vec3(4200.0, 560.0, 3400.0);
                        vec3 origin = uCamera / extent;
                        vec3 direction = ray / extent;
                        float quadratic = dot(direction, direction);
                        float projected = dot(origin, direction);
                        float intersection = projected * projected - quadratic * (dot(origin, origin) - 1.0);
                        if (intersection > 0.0) {
                            float entry = max(0.0, (-projected - sqrt(intersection)) / quadratic);
                            float exitDistance = max(0.0, (-projected + sqrt(intersection)) / quadratic);
                            float transmission = 1.0;
                            vec3 light = vec3(0.0);
                            // Keep quadrature continuous as the camera turns. Screen-pixel
                            // jitter and a moving/resting step switch made the same cloud jump.
                            const float steps = 48.0;
                            for (int armStep = 0; armStep < 48; armStep++) {
                                float intervalStart = pow(float(armStep) / steps, 1.65);
                                float intervalEnd = pow(float(armStep + 1) / steps, 1.65);
                                float distance = mix(entry, exitDistance, (intervalStart + intervalEnd) * 0.5);
                                float stepSize = (exitDistance - entry) * (intervalEnd - intervalStart);
                                vec3 point = uCamera + ray * distance;
                                float radius = length(point.xz);
                                float localSpur = 105.0 + point.x * point.x * 0.000075 + sin(point.x * 0.00125) * 135.0;
                                float innerArm = -1130.0 + point.x * point.x * 0.000045 + sin(point.x * 0.00088) * 180.0;
                                float outerArm = 1570.0 + point.x * point.x * 0.000055 + sin(point.x * 0.00102) * 215.0;
                                float branch = 780.0 - point.x * point.x * 0.00008 + sin(point.x * 0.00155) * 170.0;
                                vec4 offsets = (point.z - vec4(localSpur, innerArm, outerArm, branch)) / vec4(205.0, 310.0, 350.0, 250.0);
                                vec4 profiles = exp(-offsets * offsets * 1.4) * vec4(1.0, 0.67, 0.52, 0.32);
                                float warp = sin(point.x * 0.0014 + point.z * 0.0006) * (15.0 + radius * 0.009);
                                float height = point.y - warp;
                                float vertical = exp(-pow(height / (84.0 + radius * 0.018), 2.0));
                                float apron = smoothstep(165.0, 360.0, radius) * (1.0 - smoothstep(2900.0, 3950.0, radius));
                                float arms = dot(profiles, vec4(1.0)) * vertical * apron;
                                if (arms > 0.002) {
                                    vec3 samplePoint = point * vec3(0.0036, 0.009, 0.0055);
                                    float coarse = noise(samplePoint + vec3(7.4, 3.7, 11.9));
                                    float detail = noise(samplePoint * 2.07 + vec3(21.0, 4.0, 8.0));
                                    float grain = noise(samplePoint * 4.13 + vec3(5.0, 27.0, 13.0));
                                    // Average features smaller than a ray interval instead of
                                    // letting undersampled distant dust flicker during rotation.
                                    float footprint = length(ray * vec3(0.0036, 0.009, 0.0055)) * stepSize;
                                    detail = mix(detail, 0.5, smoothstep(0.55, 1.5, footprint * 2.07));
                                    grain = mix(grain, 0.5, smoothstep(0.55, 1.5, footprint * 4.13));
                                    float structure = coarse * 0.55 + detail * 0.30 + grain * 0.15;
                                    float density = arms * smoothstep(0.29, 0.75, structure);
                                    float dust = arms * smoothstep(0.38, 0.72, detail * 0.65 + grain * 0.35)
                                        * exp(-pow(height / 62.0, 2.0));
                                    float opticalDepth = (density * 0.0017 + dust * 0.0065) * stepSize;
                                    float absorption = exp(-opticalDepth);
                                    vec3 tint = mix(vec3(0.33, 0.41, 0.53), vec3(0.54, 0.43, 0.31),
                                        smoothstep(-1200.0, 900.0, point.z) * 0.7 + structure * 0.15);
                                    float starFormation = smoothstep(0.42, 0.76, structure);
                                    light += tint * density * (0.20 + starFormation * 0.95)
                                        * (1.0 - smoothstep(0.12, 0.65, dust) * 0.60) * transmission * stepSize * 0.00165;
                                    transmission *= absorption;
                                }
                            }
                            float visibility = (1.0 - uGalaxy) * uEnvironmentStrength;
                            color = color * mix(1.0, transmission, visibility) + light * visibility;
                            localTransmission *= mix(1.0, transmission, visibility);
                        }
                    }
                    if (uGalaxy < 1.0) {
                        float band = exp(-pow((ray.y + ray.z * 0.24) * 3.0, 2.0));
                        float distant = field(ray * 6.0 + 11.0);
                        color += vec3(0.025, 0.031, 0.047) * band * pow(distant, 2.0) * uSkyVisibility;
                    }
                    float along = dot(uCamera, ray);
                    float discriminant = along * along - dot(uCamera, uCamera) + 620.0 * 620.0;
                    if (discriminant > 0.0 && uGalaxy < 1.0) {
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
                            float absorption = exp(-density * lanes * stepSize * 0.008);
                            vec3 cool = vec3(0.30, 0.39, 0.55);
                            vec3 warm = vec3(0.55, 0.43, 0.32);
                            vec3 tint = mix(cool, warm, smoothstep(-190.0, 200.0, point.x + point.z));
                            float light = smoothstep(0.34, 0.80, structure) * (1.0 - lanes * 0.68);
                            cloud += tint * density * light * transmission * stepSize * 0.0055;
                            transmission *= absorption;
                        }
                        color = mix(color * transmission + cloud, color, uGalaxy);
                        localTransmission *= mix(transmission, 1.0, uGalaxy);
                    }
                    if (uGalacticStrength > 0.0) {
                        float surfaceWeight = smoothstep(0.12, 0.32, abs(ray.y));
                        if (surfaceWeight > 0.0) {
                            vec3 extent = vec3(200.0, 76.0, 240.0);
                            vec3 origin = uGalacticCamera / extent;
                            vec3 direction = ray / extent;
                            float quadratic = dot(direction, direction);
                            float projected = dot(origin, direction);
                            float intersection = projected * projected - quadratic * (dot(origin, origin) - 1.0);
                            if (intersection > 0.0) {
                                float entry = max(0.0, (-projected - sqrt(intersection)) / quadratic);
                                float exitDistance = max(0.0, (-projected + sqrt(intersection)) / quadratic);
                                float stepSize = (exitDistance - entry) / 32.0;
                                // The far half of the bulge is seen through the
                                // warped dust disk; the near half stays in front.
                                // Integrate this narrow layer analytically so it
                                // cannot fall between the coarser bulge samples.
                                float dustDistance = -uGalacticCamera.y / ray.y;
                                vec3 dustPoint = uGalacticCamera + ray * dustDistance;
                                for (int warpStep = 0; warpStep < 3; warpStep++) {
                                    dustDistance = (diskWarp(dustPoint.xz) - uGalacticCamera.y) / ray.y;
                                    dustPoint = uGalacticCamera + ray * dustDistance;
                                }
                                float dustColumn = texture2D(uGalacticDust, dustPoint.xz / 800.0 + 0.5).r;
                                float dustDepth = (dustColumn * 0.46 + exp(-length(dustPoint.xz) / 180.0) * 0.018)
                                    / max(abs(ray.y), 0.12);
                                dustDepth *= step(0.0, dustDistance) * (1.0 - smoothstep(360.0, 430.0, length(dustPoint.xz)));
                                vec3 light = vec3(0.0);
                                for (int sampleIndex = 0; sampleIndex < 32; sampleIndex++) {
                                    float sampleDistance = entry + (float(sampleIndex) + 0.5) * stepSize;
                                    vec3 samplePoint = uGalacticCamera + ray * sampleDistance;
                                    vec4 structure = texture2D(uGalacticDust, samplePoint.xz / 800.0 + 0.5);
                                    float thickness = 9.0 + 12.0 * exp(-dot(samplePoint.xz, samplePoint.xz) / 5200.0);
                                    float profile = exp(-0.5 * pow(samplePoint.y / thickness, 2.0)) / (2.5066 * thickness);
                                    float behindDust = smoothstep(-2.0, 2.0, (sampleDistance - dustDistance) * abs(ray.y));
                                    light += bulgeLight(structure.rgb) * profile * stepSize * exp(-dustDepth * behindDust);
                                }
                                color += light * surfaceWeight * uGalacticStrength * localTransmission;
                            }
                        }
                        vec3 extent = vec3(440.0, 76.0, 440.0);
                        vec3 origin = uGalacticCamera / extent;
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
                                vec3 point = uGalacticCamera + ray * (entry + (float(sampleIndex) + 0.5) * stepSize);
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
                            color = color * mix(1.0, transmission, uGalacticStrength * (1.0 - surfaceWeight))
                                + light * mix(0.30, 0.65, smoothstep(0.04, 0.32, abs(ray.y))) * uGalacticStrength * (1.0 - surfaceWeight);
                        }
                    }
                    color = 1.0 - exp(-color * 1.45);
                    color += (hash(vec3(gl_FragCoord.xy, 0.0)) - 0.5) / 255.0;
                    // Keep the local volume's transmittance for the sharp, distant sky layer.
                    gl_FragColor = vec4(color, localTransmission);
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
                uniform vec3 uGalacticCamera;
                uniform float uGalacticStrength;
                uniform float uSkyVisibility;
                vec3 stellarRadiance(vec3 disk) {
                    return -log(max(vec3(0.015), 1.0 - disk * 0.96)) / 1.45;
                }
                void main() {
                    vec4 volume = texture2D(uTexture, vUv);
                    vec3 background = volume.rgb;
                    vec2 screen = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0) * uTangent;
                    vec3 ray = normalize(uForward + screen.x * uRight + screen.y * uUp);
                    if (uSkyOpacity > 0.0 && uGalaxy < 1.0) {
                        // Galactic X/Y/Z are longitude 90 deg / north / centre. The
                        // far field rotates with the view, with no local parallax.
                        vec2 skyUv = vec2(fract(0.5 - atan(ray.x, ray.z) / 6.28318530718),
                            0.5 + asin(clamp(ray.y, -1.0, 1.0)) / 3.14159265359);
                        // Retain the photographed all-sky field at readable
                        // exposure even away from the bright Galactic plane.
                        vec3 sky = texture2D(uSky, skyUv, 0.8).rgb * 0.32;
                        // Equirectangular photos stretch individual pixels at
                        // the poles; the real catalogue supplies sharp stars
                        // there while the photographic field gently recedes.
                        sky *= 1.0 - smoothstep(0.88, 0.998, abs(ray.y)) * 0.85;
                        // Composite behind the unchanged 3D cloud, in its radiance
                        // space, so foreground dust occludes the environment.
                        float visibility = uSkyOpacity * uSkyVisibility * volume.a;
                        background = 1.0 - (1.0 - background) * pow(1.0 - sky, vec3(visibility));
                    }
                    vec3 light = vec3(0.0);
                    if (uGalacticStrength > 0.0) {
                        float surfaceWeight = smoothstep(0.12, 0.32, abs(ray.y));
                        if (surfaceWeight > 0.0) {
                            float distanceToDisk = -uGalacticCamera.y / ray.y;
                            vec3 point = uGalacticCamera + ray * distanceToDisk;
                            if (distanceToDisk > 0.0 && length(point.xz) < 440.0) {
                                for (int warpStep = 0; warpStep < 3; warpStep++) {
                                    float warp = sin(point.x * 0.008) * pow(length(point.xz) / 480.0, 2.0) * 9.0;
                                    distanceToDisk = (warp - uGalacticCamera.y) / ray.y;
                                    point = uGalacticCamera + ray * distanceToDisk;
                                }
                                if (distanceToDisk > 0.0 && length(point.xz) < 440.0) {
                                    vec2 diskUv = point.xz / 800.0 + 0.5;
                                    vec3 stars = texture2D(uGalacticDisk, diskUv, -0.35).rgb;
                                    vec3 structure = texture2D(uGalacticDust, diskUv, -0.35).rgb;
                                    vec3 bulge = structure.g * vec3(1.0, mix(0.60, 1.0, structure.b), structure.b);
                                    light = max(vec3(0.0), stellarRadiance(stars) - stellarRadiance(bulge))
                                        * surfaceWeight * uGalacticStrength * volume.a * (1.0 - smoothstep(380.0, 430.0, length(point.xz)));
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
                uniform float uGalaxy;
                uniform vec3 uGalacticCamera;
                uniform float uGalacticStrength;
                uniform float uSkyVisibility;
                uniform float uEnvironmentStrength;
                varying vec3 vColor;
                varying float vLight;
                varying float vSize;
                varying float vEnvironment;
                varying float vEnvironmentPath;
                varying float vPixelRatio;
                void main() {
                    float background = step(0.5, aBackground) * (1.0 - step(1.5, aBackground));
                    float galaxy = step(1.5, aBackground) * (1.0 - step(2.5, aBackground));
                    float environment = step(2.5, aBackground);
                    float galacticStar = step(3.5, aBackground);
                    vec3 position = aPosition;
                    vec3 relative = position - uCamera * (1.0 - background);
                    float depth = dot(relative, uForward);
                    vec2 plane = vec2(dot(relative, uRight), dot(relative, uUp));
                    gl_Position = vec4(plane / (uTangent * vec2(uAspect, 1.0)), 0.0, max(depth, 0.001));
                    if (depth <= 1.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
                    float distanceGain = mix(clamp(320.0 / max(depth, 30.0), 0.48, 2.4), 1.0, max(background, galaxy));
                    if (environment > 0.5) distanceGain = clamp(1500.0 / max(length(relative), 120.0), 0.0, 1.6);
                    if (galacticStar > 0.5) distanceGain = clamp(2000.0 / max(length(relative), 120.0), 0.0, 1.6);
                    vSize = max(3.0, aSize * uDpr * sqrt(distanceGain));
                    if (environment > 0.5) vSize = max(4.0 * uDpr, vSize);
                    gl_PointSize = min(36.0 * uDpr, vSize);
                    vColor = aColor;
                    vLight = aLight * smoothstep(5.0, 24.0, depth) * mix(sqrt(distanceGain), 1.0, max(background, galaxy));
                    vLight *= mix(1.0, uGalaxy, galaxy);
                    vLight *= 1.0 - background * uGalaxy * 0.90;
                    vLight *= mix(1.0, 2.2, background * (1.0 - uGalaxy));
                    if (background > 0.5) vLight *= uSkyVisibility;
                    if (aBackground < 0.5) vLight *= 1.0 / (1.0 + pow(max(length(relative) - 600.0, 0.0) / 450.0, 2.0));
                    if (environment > 0.5) vLight *= uEnvironmentStrength / (1.0 + pow(length(relative) / 6000.0, 2.0));
                    if (galacticStar > 0.5) vLight *= uGalacticStrength * (1.0 - exp(-length(relative) / 10.0));
                    vEnvironment = environment;
                    vEnvironmentPath = clamp(depth / 3000.0, 0.18, 1.0);
                    vPixelRatio = uDpr;
                }
            `, `
                precision mediump float;
                uniform sampler2D uVolume;
                uniform vec2 uViewport;
                varying vec3 vColor;
                varying float vLight;
                varying float vSize;
                varying float vEnvironment;
                varying float vEnvironmentPath;
                varying float vPixelRatio;
                void main() {
                    vec2 local = (gl_PointCoord - 0.5) * 2.0;
                    float radius = length(local);
                    float halo = exp(-radius * radius * 5.5) * (1.0 - smoothstep(0.75, 1.0, radius));
                    float core = exp(-radius * radius * 90.0);
                    float smallCore = max(0.0, 1.0 - abs(local.x * vSize * 0.5))
                        * max(0.0, 1.0 - abs(local.y * vSize * 0.5));
                    float profile = mix(smallCore, core + halo * 0.12, smoothstep(3.0, 7.0, vSize));
                    if (vEnvironment > 0.5) {
                        // A resolved subpixel core keeps distant stars visible
                        // on desktop as well as high-DPR displays; the original
                        // local-star profile is left intact.
                        float pixelRadius = radius * vSize * 0.5 / vPixelRatio;
                        profile = exp(-pixelRadius * pixelRadius / 0.46) + halo * 0.035;
                    }
                    vec3 color = mix(vColor, vec3(1.0, 0.98, 0.95), core * 0.65);
                    float visibility = 1.0;
                    // The volume stores whole-ray transmittance.  A finite arm
                    // star traverses only part of it; approximate that fraction
                    // by its depth instead of applying all background dust.
                    if (vEnvironment > 0.5) visibility = pow(texture2D(uVolume, gl_FragCoord.xy / uViewport).a, vEnvironmentPath);
                    gl_FragColor = vec4(color * profile * vLight * 1.08 * visibility, 1.0);
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
        this.galacticTextureSizes = [];
        for (const name of ['galacticDisk', 'galacticDust']) {
            this[name] = context.createTexture();
            context.bindTexture(context.TEXTURE_2D, this[name]);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR_MIPMAP_LINEAR);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
            context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
            if (anisotropy) context.texParameterf(context.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
                Math.min(16, context.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
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

    buildGalacticStars() {
        if (!this.galacticStars) {
            const source = document.createElement('canvas');
            source.width = source.height = 256;
            const sourceContext = source.getContext('2d', { willReadFrequently: true });
            sourceContext.drawImage(this.galacticImage, 0, 0, 256, 256);
            const pixels = sourceContext.getImageData(0, 0, 256, 256).data;
            let seed = 0x7a11c;
            const random = () => {
                seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                return seed / 4294967296;
            };
            const values = [];
            for (let attempt = 0; attempt < 900000 && values.length < 64000 * 9; attempt++) {
                const horizontal = random(), vertical = random();
                const offset = (Math.floor(vertical * 256) * 256 + Math.floor(horizontal * 256)) * 4;
                const brightness = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255;
                if (random() > brightness * 1.8) continue;
                const diskX = (horizontal - 0.5) * 800, diskZ = (0.5 - vertical) * 800;
                const radius = Math.hypot(diskX, diskZ);
                const gaussian = Math.sqrt(-2 * Math.log(Math.max(0.0001, random()))) * Math.cos(random() * Math.PI * 2);
                const older = random() < 0.52;
                const thickness = (older ? 5 + radius * 0.0075 : 1.6 + radius * 0.002) + 14 * Math.exp(-radius * radius / 5200);
                const warp = Math.sin(diskX * 0.008) * Math.pow(radius / 480, 2) * 9;
                const position = GALACTIC_SPACE.fromDisk([diskX, warp + gaussian * thickness, diskZ]);
                const localDistance = Math.hypot(...position.map((value, axis) => value - GALACTIC_SPACE.solar[axis]));
                if (random() > smoothstep(1600, 4200, localDistance)) continue;
                const warmth = older ? 0.6 + random() * 0.4 : random() * 0.45;
                values.push(...position, lerp(0.72, 1, warmth), lerp(0.84, 0.79, warmth), lerp(1, 0.61, warmth),
                    0.12 + Math.pow(random(), 3) * 0.65, 3.5 + random() * 3, 4);
            }
            this.galacticStars = new Float32Array(values);
            this.stars = new Float32Array(this.localStars.length + this.environmentStars.length + values.length);
            this.stars.set(this.localStars);
            this.stars.set(this.environmentStars, this.localStars.length);
            this.stars.set(this.galacticStars, this.localStars.length + this.environmentStars.length);
        }
        if (this.ready) {
            this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.starBuffer);
            this.gl.bufferData(this.gl.ARRAY_BUFFER, this.stars, this.gl.STATIC_DRAW);
        }
    }

    galacticOpacity() {
        return this.galacticLoadedAt == null ? 0 : REDUCED_MOTION ? 1 : smoothstep(0, 1, (performance.now() - this.galacticLoadedAt) / 900);
    }

    skyOpacity() {
        if (this.skyLoadedAt == null) return 0;
        return REDUCED_MOTION ? 1 : smoothstep(0, 1, (performance.now() - this.skyLoadedAt) / 700);
    }

    loadSkyAssets() {
        if (this.skyAssetsPromise) return this.skyAssetsPromise;
        this.skyAssetsPromise = (async () => {
            for (const name of ['milky-way-preview', 'milky-way-sky']) {
                try {
                    const response = await fetch(`assets/life/sky/${name}.webp?v=20261017-environment`, { priority: 'low' });
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
                    console.warn('Milky Way environment keeps its available detail:', error.message);
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
                const limit = Math.min(this.maxTextureSize, COARSE_POINTER ? 4096 : 8192);
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
                context.generateMipmap(context.TEXTURE_2D);
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
            const response = await fetch(`assets/life/galaxy/${name}.webp?v=20261030-galaxy-lossless`);
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
            this.buildGalacticStars();
            this.galacticLoadedAt = performance.now();
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
            const compact = COARSE_POINTER || (navigator.deviceMemory && navigator.deviceMemory <= 4);
            const limit = Math.min(this.maxTextureSize, compact ? 4096 : 8192);
            const width = Math.min(2 ** Math.ceil(Math.log2(image.width)), limit);
            const height = Math.min(2 ** Math.ceil(Math.log2(image.height)), limit);
            let upload = image;
            let bitmap = null;
            if (this.galacticBlobs?.[index] && typeof createImageBitmap === 'function') {
                const options = { imageOrientation: 'flipY', premultiplyAlpha: 'none' };
                if (image.width !== width || image.height !== height) {
                    options.resizeWidth = width;
                    options.resizeHeight = height;
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
                if (!bitmap && (image.width !== width || image.height !== height)) {
                    upload = document.createElement('canvas');
                    upload.width = width;
                    upload.height = height;
                    upload.getContext('2d').drawImage(image, 0, 0, upload.width, upload.height);
                }
                context.activeTexture(context.TEXTURE0);
                context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, !bitmap);
                context.pixelStorei(context.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                context.bindTexture(context.TEXTURE_2D, textures[index]);
                context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, upload);
                context.generateMipmap(context.TEXTURE_2D);
                context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, false);
                this.galacticTextureSizes[index] = [width, height];
            } finally {
                bitmap?.close();
            }
        }
    }

    resize() {
        this.width = Math.max(1, window.innerWidth);
        this.height = Math.max(1, window.innerHeight);
        const pixelRatioLimit = this.galaxyDetail ? Math.min(COARSE_POINTER ? 2 : 3, Math.sqrt(8294400 / (this.width * this.height)))
            : COARSE_POINTER ? 1.5 : 1.75;
        this.dpr = Math.min(window.devicePixelRatio || 1, pixelRatioLimit);
        const width = Math.round(this.width * this.dpr);
        const height = Math.round(this.height * this.dpr);
        for (const canvas of [this.canvas, this.fallbackCanvas]) {
            if (canvas.width !== width) canvas.width = width;
            if (canvas.height !== height) canvas.height = height;
        }
        if (!this.ready) return;
        this.resizeCloudTarget(this.galaxyDetail || false);
    }

    resizeCloudTarget(galaxy) {
        const context = this.gl;
        // A fixed sampling grid avoids reallocations and visible quality pops
        // between pointer events. The sharp stars and sky use the full canvas.
        const cloudScale = galaxy ? Math.min(this.dpr, COARSE_POINTER ? 0.5 : 0.75, 1200 / this.width, 900 / this.height)
            : Math.min(0.5, 1200 / this.width, 900 / this.height);
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
        context.uniform1f(this.uniform(program, 'uGalaxy'), 0);
        context.uniform3fv(this.uniform(program, 'uGalacticCamera'), GALACTIC_SPACE.toDisk(view.position));
        const solarDistance = Math.hypot(...view.position.map((value, axis) => value - GALACTIC_SPACE.solar[axis]));
        context.uniform1f(this.uniform(program, 'uGalacticStrength'), this.galacticOpacity() * smoothstep(600, 4500, solarDistance));
        context.uniform1f(this.uniform(program, 'uSkyVisibility'), GALACTIC_SPACE.photographicVisibility(view.position));
        context.uniform1f(this.uniform(program, 'uEnvironmentStrength'), this.environmentStrength);
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
        if (!this.galacticPreparation) this.prepareGalacticAssets();
        const galaxyDetail = view.galaxy > 0.02;
        const moving = Boolean(view.moving);
        this.moving = moving;
        if (this.galaxyDetail !== galaxyDetail) {
            this.galaxyDetail = galaxyDetail;
            this.resize();
        }
        const available = this.ready;
        this.canvas.hidden = !available;
        this.fallbackCanvas.hidden = available;
        if (!available) {
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
        this.drawQuad(this.cloudProgram);
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
        context.activeTexture(context.TEXTURE0);
        context.bindTexture(context.TEXTURE_2D, this.texture);
        context.uniform1i(this.uniform(this.starProgram, 'uVolume'), 0);
        context.uniform2f(this.uniform(this.starProgram, 'uViewport'), this.canvas.width, this.canvas.height);
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
        const skyVisibility = GALACTIC_SPACE.photographicVisibility(view.position);
        if (!image || !image.naturalWidth || skyVisibility <= 0) return;
        if (this.skyFallbackSource?.image !== image) {
            const sourceCanvas = document.createElement('canvas');
            sourceCanvas.width = Math.min(2048, image.naturalWidth);
            sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * sourceCanvas.width / image.naturalWidth));
            const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
            sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
            this.skyFallbackSource = {
                image, width: sourceCanvas.width, height: sourceCanvas.height,
                pixels: sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height).data
            };
            this.skyFallbackViewKey = null;
        }
        const scale = Math.min(1, (view.moving ? 480 : 960) / this.width, (view.moving ? 270 : 540) / this.height);
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
                    const polarFade = 1 - smoothstep(0.88, 0.998, Math.abs(Math.sin(latitude))) * 0.85;
                    for (let channel = 0; channel < 3; channel++) {
                        const upper = source.pixels[topLeft + channel] * (1 - fractionX) + source.pixels[topRight + channel] * fractionX;
                        const lower = source.pixels[bottomLeft + channel] * (1 - fractionX) + source.pixels[bottomRight + channel] * fractionX;
                        output.data[destination + channel] = (upper * (1 - fractionY) + lower * fractionY) * 0.32 * polarFade;
                    }
                    output.data[destination + 3] = 255;
                }
            }
            context.putImageData(output, 0, 0);
            this.skyFallbackPixels = output;
            this.skyFallbackViewKey = key;
        }
        this.fallback.save();
        this.fallback.globalAlpha = this.skyOpacity() * skyVisibility;
        this.fallback.imageSmoothingEnabled = true;
        this.fallback.drawImage(this.skyFallbackProjection, 0, 0, this.width, this.height);
        this.fallback.restore();
    }

    renderGalacticFallback(view) {
        if (!this.galacticImage) return;
        const context = this.fallback;
        const image = this.galacticImage;
        const focal = this.height * 0.5 / Math.tan(view.fov * 0.5);
        const divisions = 20;
        const vertices = [];
        for (let row = 0; row <= divisions; row++) {
            for (let column = 0; column <= divisions; column++) {
                const diskX = (column / divisions - 0.5) * 800;
                const diskZ = (0.5 - row / divisions) * 800;
                const warp = Math.sin(diskX * 0.008) * Math.pow(Math.hypot(diskX, diskZ) / 480, 2) * 9;
                const relative = GALACTIC_SPACE.fromDisk([diskX, warp, diskZ]).map((value, axis) => value - view.position[axis]);
                const depth = dot(relative, view.forward);
                vertices.push({ depth, horizontal: this.width * 0.5 + dot(relative, view.right) / depth * focal,
                    vertical: this.height * 0.5 - dot(relative, view.up) / depth * focal,
                    sourceX: column / divisions * image.width, sourceY: row / divisions * image.height });
            }
        }
        context.save();
        const solarDistance = Math.hypot(...view.position.map((value, axis) => value - GALACTIC_SPACE.solar[axis]));
        context.globalAlpha = this.galacticOpacity() * smoothstep(600, 4500, solarDistance) * 0.72;
        context.globalCompositeOperation = 'screen';
        const triangle = (first, second, third) => {
            const points = [first, second, third];
            if (points.some(point => point.depth < 4) || points.every(point => point.horizontal < 0)
                || points.every(point => point.horizontal > this.width) || points.every(point => point.vertical < 0)
                || points.every(point => point.vertical > this.height)) return;
            const sourceAX = second.sourceX - first.sourceX, sourceAY = second.sourceY - first.sourceY;
            const sourceBX = third.sourceX - first.sourceX, sourceBY = third.sourceY - first.sourceY;
            const determinant = sourceAX * sourceBY - sourceBX * sourceAY;
            const targetAX = second.horizontal - first.horizontal, targetAY = second.vertical - first.vertical;
            const targetBX = third.horizontal - first.horizontal, targetBY = third.vertical - first.vertical;
            const horizontalScale = (targetAX * sourceBY - targetBX * sourceAY) / determinant;
            const horizontalSkew = (targetBX * sourceAX - targetAX * sourceBX) / determinant;
            const verticalSkew = (targetAY * sourceBY - targetBY * sourceAY) / determinant;
            const verticalScale = (targetBY * sourceAX - targetAY * sourceBX) / determinant;
            context.save();
            context.beginPath();
            context.moveTo(first.horizontal, first.vertical);
            context.lineTo(second.horizontal, second.vertical);
            context.lineTo(third.horizontal, third.vertical);
            context.closePath();
            context.clip();
            context.transform(horizontalScale, verticalSkew, horizontalSkew, verticalScale,
                first.horizontal - horizontalScale * first.sourceX - horizontalSkew * first.sourceY,
                first.vertical - verticalSkew * first.sourceX - verticalScale * first.sourceY);
            context.drawImage(image, 0, 0);
            context.restore();
        };
        for (let row = 0; row < divisions; row++) {
            for (let column = 0; column < divisions; column++) {
                const index = row * (divisions + 1) + column;
                triangle(vertices[index], vertices[index + 1], vertices[index + divisions + 1]);
                triangle(vertices[index + 1], vertices[index + divisions + 2], vertices[index + divisions + 1]);
            }
        }
        context.restore();
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
        const galaxy = 0;
        this.renderGalacticFallback(view);
        if (this.environmentStrength > 0) {
            const clouds = this.environmentClouds.map(cloud => ({ ...cloud,
                projected: project(cloud.position.map((value, axis) => value - view.position[axis])) }))
                .filter(cloud => cloud.projected).sort((a, b) => b.projected[2] - a.projected[2]);
            context.save();
            context.globalCompositeOperation = 'screen';
            for (const cloud of clouds) {
                const [x, y, depth] = cloud.projected;
                const radius = focal * cloud.radius / depth;
                const alpha = cloud.weight * 0.065 * (1 - galaxy) * this.environmentStrength;
                const glow = context.createRadialGradient(x, y, 0, x, y, radius);
                glow.addColorStop(0, `rgba(88,99,124,${alpha})`);
                glow.addColorStop(0.45, `rgba(76,83,107,${alpha * 0.6})`);
                glow.addColorStop(1, 'rgba(50,58,76,0)');
                context.fillStyle = glow;
                context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
            }
            context.restore();
        }
        context.globalAlpha = 1 - galaxy;
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
        context.globalAlpha = 1;
        for (let offset = 0; offset < this.stars.length; offset += 18) {
            const kind = this.stars[offset + 8];
            if (kind === 2 && view.galaxy < 0.01) continue;
            const relative = [0, 1, 2].map(axis => {
                let position = this.stars[offset + axis];
                return position - view.position[axis] * (kind === 1 ? 0 : 1);
            });
            const projected = project(relative);
            if (!projected || projected[0] < 0 || projected[0] > this.width || projected[1] < 0 || projected[1] > this.height) continue;
            const range = Math.hypot(...relative);
            const visibility = kind === 1 ? GALACTIC_SPACE.photographicVisibility(view.position)
                : kind === 0 ? 1 / (1 + Math.pow(Math.max(0, range - 600) / 450, 2))
                : this.environmentStrength / (1 + Math.pow(range / 6000, 2));
            const distanceGain = kind >= 3 ? clamp(1500 / Math.max(range, 120), 0, 1.6) : 1;
            const fieldGain = kind === 1 ? lerp(2.2, 1, galaxy) : Math.sqrt(distanceGain);
            const light = Math.min(1, this.stars[offset + 6] * 0.7 * 1.08 * fieldGain) * visibility;
            const color = [3, 4, 5].map(axis => Math.round(this.stars[offset + axis] * 255));
            context.fillStyle = `rgba(${color.join(',')},${light})`;
            const radius = kind === 3 ? Math.max(0.65, this.stars[offset + 7] * 0.12 * Math.sqrt(distanceGain))
                : Math.max(0.35, this.stars[offset + 7] * 0.1);
            context.beginPath();
            context.arc(projected[0], projected[1], radius, 0, Math.PI * 2);
            context.fill();
        }
    }
}
