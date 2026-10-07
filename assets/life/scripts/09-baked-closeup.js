class BakedCelestialViewer {
    constructor() {
        const pageUrl = new URL(document.baseURI);
        const atlasMode = pageUrl.searchParams.get('celestialAtlas');
        const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(pageUrl.hostname);
        const directories = atlasMode === 'local' ? ['baked'] : localPreview && atlasMode !== 'hosted' ? ['baked', 'hosted'] : ['hosted'];
        this.manifestUrls = directories.map(directory => new URL(`assets/celestial/${directory}/manifest.json`, pageUrl).href);
        this.manifestUrl = this.manifestUrls[0];
        this.cache = new Map();
        this.imageMetadata = new WeakMap();
        this.cacheBytes = 0;
        this.cacheBudget = (COARSE_POINTER || (typeof usesCompactSkyLayout === 'function' && usesCompactSkyLayout())) ? 64 : 256;
        this.cacheBudget *= 1024 * 1024;
        this.retainedFrameKey = Symbol('retained-frame');
        this.retainedCloudKey = Symbol('retained-cloud');
        this.retainedRingKey = Symbol('retained-ring');
        this.pending = new Map();
        this.posterUrls = new Set();
        this.failures = new Map();
        this.queue = [];
        this.controllers = new Set();
        this.generation = 0;
        this.activeLoads = 0;
        this.lastTick = 0;
        this.lastDraw = 0;
        this.cameraYaw = 0;
        this.cameraPitch = 0;
        this.cloudAzimuth = 0;
        this.cloudTime = 0;
        this.paused = REDUCED_MOTION;
        this.dirty = true;
    }

    copy() {
        const copies = {
            en: {
                view: 'Pre-rendered planetary close-up', drag: 'Drag to rotate · ↑ ↓ ← → to explore',
                pause: 'Pause rotation', resume: 'Resume rotation', back: 'Back to Solar System',
                loading: 'Loading close-up…', unavailable: 'This close-up could not be loaded.',
                retry: 'Retry', partial: 'Showing the last loaded view; retry to load more angles.'
            },
            'zh-CN': {
                view: '预渲染天体近景', drag: '拖动旋转 · 方向键探索', pause: '暂停自转',
                resume: '恢复自转', back: '返回太阳系', loading: '正在载入近景…',
                unavailable: '暂时无法载入这颗天体的近景。', retry: '重新载入',
                partial: '正在显示已载入的视角；可重试载入更多角度。'
            },
            'zh-TW': {
                view: '預渲染天體近景', drag: '拖動旋轉 · 方向鍵探索', pause: '暫停自轉',
                resume: '恢復自轉', back: '返回太陽系', loading: '正在載入近景…',
                unavailable: '暫時無法載入這顆天體的近景。', retry: '重新載入',
                partial: '正在顯示已載入的視角；可重試載入更多角度。'
            }
        };
        const copy = copies[state.currentLang] || copies.en;
        const solarCopy = window.lifeStarMap?.solarSystem?.copy?.();
        if (solarCopy?.bodyClose) copy.back = solarCopy.bodyClose;
        return copy;
    }

    create() {
        if (this.element) return;
        this.element = document.createElement('section');
        this.element.id = 'bakedCelestialView';
        this.element.className = 'baked-celestial-view';
        this.element.tabIndex = 0;
        this.element.setAttribute('role', 'group');
        this.element.innerHTML = '<canvas class="baked-celestial-canvas" aria-hidden="true"></canvas><div class="baked-celestial-controls"><p class="baked-celestial-hint"></p><div class="baked-celestial-buttons"><button type="button" class="baked-celestial-pause"></button><button type="button" class="baked-celestial-return"></button></div><p class="baked-celestial-status" role="status" aria-live="polite"></p><button type="button" class="baked-celestial-retry" hidden></button></div>';
        this.element.hidden = true;
        document.body.append(this.element);
        this.canvas = this.element.querySelector('canvas');
        this.context = this.canvas.getContext('2d', { alpha: false });
        this.pauseButton = this.element.querySelector('.baked-celestial-pause');
        this.returnButton = this.element.querySelector('.baked-celestial-return');
        this.retryButton = this.element.querySelector('.baked-celestial-retry');
        this.statusElement = this.element.querySelector('.baked-celestial-status');
        this.pauseButton.addEventListener('click', () => this.togglePause());
        this.returnButton.addEventListener('click', event => window.lifeStarMap?.solarSystem?.closeBody(true, event.detail === 0 ? 'keyboard' : 'pointer'));
        this.retryButton.addEventListener('click', () => this.retry());
        this.element.addEventListener('contextmenu', event => event.preventDefault());
        this.element.addEventListener('pointerdown', event => {
            if (!this.canInteract() || event.target.closest('button') || this.drag || (event.pointerType === 'mouse' && ![0, 2].includes(event.button))) return;
            event.preventDefault();
            this.element.focus({ preventScroll: true });
            this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            this.element.setPointerCapture(event.pointerId);
            this.element.classList.add('is-dragging');
            this.resumeAt = performance.now() + 2600;
        });
        this.element.addEventListener('pointermove', event => {
            if (this.drag?.pointerId !== event.pointerId) return;
            this.rotate((event.clientX - this.drag.x) * -0.24, (event.clientY - this.drag.y) * 0.24);
            this.drag.x = event.clientX;
            this.drag.y = event.clientY;
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(type => {
            this.element.addEventListener(type, event => {
                if (this.drag?.pointerId === event.pointerId) this.releaseInput();
            });
        });
        window.addEventListener('blur', () => this.releaseInput());
        document.addEventListener('visibilitychange', () => {
            this.releaseInput();
            this.lastTick = 0;
            if (!document.hidden) this.pump();
        });
        const panel = document.querySelector('#celestialPanel');
        const refreshLayout = () => { this.measureFramingLayout(); this.dirty = true; };
        if (panel && typeof ResizeObserver === 'function') {
            this.panelResizeObserver = new ResizeObserver(refreshLayout);
            this.panelResizeObserver.observe(panel);
        }
        if (panel && typeof MutationObserver === 'function') {
            let panelState = '';
            this.panelStateObserver = new MutationObserver(() => {
                const nextState = `${document.body.classList.contains('celestial-open')}:${panel.classList.contains('is-left')}`;
                if (nextState === panelState) return;
                panelState = nextState;
                refreshLayout();
            });
            this.panelStateObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
            this.panelStateObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        }
    }

    updateCopy() {
        if (!this.element) return;
        const copy = this.copy();
        this.element.setAttribute('aria-label', `${celestialName(this.profile || {})} · ${copy.view}`);
        this.element.querySelector('.baked-celestial-hint').textContent = copy.drag;
        this.pauseButton.textContent = this.paused ? copy.resume : copy.pause;
        this.pauseButton.setAttribute('aria-pressed', String(this.paused));
        this.pauseButton.disabled = !this.body;
        this.returnButton.textContent = copy.back;
        this.retryButton.textContent = copy.retry;
        this.retryButton.hidden = !this.error;
        this.statusElement.textContent = this.loading ? copy.loading : this.error ? (this.lastImage ? copy.partial : copy.unavailable) : '';
        this.element.classList.toggle('has-error', Boolean(this.error && !this.lastImage));
        const panel = document.querySelector('.celestial-panel');
        this.element.classList.toggle('controls-on-left', !panel?.classList.contains('is-left'));
    }

    async loadManifest() {
        if (this.manifest) return this.manifest;
        for (const manifestUrl of this.manifestUrls) {
            const controller = new AbortController();
            this.controllers.add(controller);
            const timeout = window.setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetch(manifestUrl, { signal: controller.signal });
                if (!response.ok) {
                    if ([404, 410].includes(response.status) && manifestUrl !== this.manifestUrls.at(-1)) continue;
                    throw new Error(`Close-up manifest: HTTP ${response.status}`);
                }
                const manifest = await response.json();
                if (![1, 2].includes(manifest.version) || !manifest.bodies) throw new Error('Unsupported close-up manifest');
                this.manifestUrl = manifestUrl;
                this.manifest = manifest;
                return manifest;
            } finally {
                window.clearTimeout(timeout);
                this.controllers.delete(controller);
            }
        }
    }

    async prepare(profile) {
        this.clear();
        this.create();
        const generation = this.generation;
        this.profile = profile;
        this.loading = true;
        this.error = false;
        this.paused = REDUCED_MOTION;
        this.resumeAt = 0;
        this.element.hidden = false;
        this.element.inert = false;
        this.canvas.style.opacity = '0';
        this.updateCopy();
        this.resize();
        try {
            const manifest = await this.loadManifest();
            if (generation !== this.generation) return false;
            const body = manifest.bodies[profile.id];
            if (!body || !Number.isInteger(body.azimuthCount) || body.azimuthCount < 2 || !Array.isArray(body.elevations) || !body.elevations.length || !body.elevations.every((value, index, values) => Number.isFinite(value) && Math.abs(value) <= 90 && (index === 0 || value > values[index - 1])) || !Number.isInteger(body.width) || !Number.isInteger(body.height) || Math.min(body.width, body.height) < 1 || !body.framePattern || !body.poster) {
                throw new Error(`Invalid close-up sequence for ${profile.id}`);
            }
            this.body = body;
            this.azimuth = (body.defaultAzimuth || 0) * 360 / body.azimuthCount;
            this.cloudAzimuth = this.azimuth;
            this.cloudTime = Number.isFinite(body.climate?.defaultTime)
                ? body.climate.defaultTime
                : Number.isFinite(body.climate?.defaultTimeHours) ? body.climate.defaultTimeHours : 0;
            this.cameraYaw = 0;
            this.cameraPitch = 0;
            this.elevation = body.elevations[clamp(body.defaultElevation || 0, 0, body.elevations.length - 1)];
            this.posterUrl = new URL(body.poster, this.manifestUrl).href;
            this.posterUrls.add(this.posterUrl);
            const frame = this.samples()[0];
            const posterVariant = body.resolutions?.[0] || body;
            const posterSample = { ...frame, variant: posterVariant, sourceWidth: body.posterWidth || posterVariant.width,
                sourceHeight: body.posterHeight || posterVariant.height };
            const surfaceRequests = [this.request(this.posterUrl, posterSample), this.request(frame.url, frame)];
            const cloud = this.samples().find(sample => sample.layer === 'clouds');
            const ring = this.ringSample();
            for (const [sample, poster] of [[cloud, body.cloudPoster], [ring, body.ringPoster]]) {
                if (!sample || !poster) continue;
                const url = new URL(poster, this.manifestUrl).href;
                this.posterUrls.add(url);
                const prefix = sample.layer === 'clouds' ? 'cloud' : 'ring';
                this.request(url, { ...sample, variant: posterVariant, sourceWidth: body[`${prefix}PosterWidth`] || posterVariant.width,
                    sourceHeight: body[`${prefix}PosterHeight`] || posterVariant.height });
            }
            await Promise.any(surfaceRequests.map(promise => promise.then(image => {
                if (!image) throw new Error('Close-up image unavailable');
                return image;
            })));
            if (generation !== this.generation) return false;
            this.loading = false;
            this.error = false;
            this.updateCopy();
            return true;
        } catch (error) {
            if (generation !== this.generation) return false;
            this.fail(error);
            return false;
        }
    }

    fail(error) {
        this.loading = false;
        this.error = true;
        this.updateCopy();
        if (error) console.warn('Pre-rendered close-up is unavailable:', error.message || error);
    }

    resolution() {
        const resolutions = this.body?.resolutions;
        if (!this.fullSphere() || !Array.isArray(resolutions) || !resolutions.length) return this.body;
        const diameter = this.framing().radius * 2;
        return resolutions.find(variant => variant.width * (variant.sphereRect || this.body.sphereRect).width >= diameter) || resolutions.at(-1);
    }

    climateConfig() {
        const climate = this.body?.climate;
        if (!climate || typeof climate !== 'object') return null;
        const frameCount = Math.floor(Number(climate.cloudTimeCount ?? climate.frameCount ?? climate.timeCount));
        const variantPattern = this.body?.resolutions?.map(variant => variant.cloudFramePattern)
            .find(pattern => typeof pattern === 'string' && pattern.includes('{time}'));
        const pattern = climate.cloudFramePattern || climate.timeFramePattern || climate.framePattern
            || variantPattern || this.body.cloudFramePattern;
        if (!pattern || !pattern.includes('{time}') || !Number.isInteger(frameCount) || frameCount < 1) return null;
        const stepHours = Number(climate.stepHours ?? (Number(climate.timeStepSeconds) / 3600));
        const periodHours = Number(climate.periodHours ?? (Number(climate.loopSeconds) / 3600));
        const step = Number.isFinite(stepHours) && stepHours > 0 ? stepHours
            : Number.isFinite(periodHours) && periodHours > 0 ? periodHours / frameCount : 1;
        const period = Number.isFinite(periodHours) && periodHours > 0 ? periodHours : step * frameCount;
        const cycleSeconds = Number(climate.cycleSeconds);
        const hoursPerSecond = Number(climate.hoursPerSecond ?? climate.playbackHoursPerSecond ?? climate.timeScale);
        const speed = Number.isFinite(hoursPerSecond) && hoursPerSecond > 0 ? hoursPerSecond
            : period / (Number.isFinite(cycleSeconds) && cycleSeconds > 0 ? cycleSeconds : 48);
        const angularVelocity = Number(climate.cloudAngularVelocity);
        return { ...climate, frameCount, stepHours: step, periodHours: period, hoursPerSecond: speed,
            cloudAngularVelocity: Number.isFinite(angularVelocity) && angularVelocity > 0 ? angularVelocity : null,
            interpolate: climate.allowTemporalBlend === true && climate.interpolation === 'crossfade' };
    }

    climateFrameIndex(time = this.cloudTime) {
        const climate = this.climateConfig();
        if (!climate) return null;
        const period = climate.periodHours;
        const wrapped = ((time % period) + period) % period;
        const position = wrapped / climate.stepHours;
        const lower = Math.floor(position) % climate.frameCount;
        const fraction = position - Math.floor(position);
        return { lower, upper: (lower + 1) % climate.frameCount, fraction };
    }

    advanceClimate(delta) {
        const climate = this.climateConfig();
        if (!climate || !Number.isFinite(delta) || delta <= 0) return;
        this.cloudTime = (this.cloudTime + delta * climate.hoursPerSecond) % climate.periodHours;
    }

    frameUrl(elevation, azimuth, layer = 'surface', variant = this.resolution(), timeIndex = null) {
        const climate = layer === 'clouds' ? this.climateConfig() : null;
        const pattern = climate && timeIndex !== null
            ? (variant.cloudFramePattern?.includes('{time}') ? variant.cloudFramePattern : null)
                || climate.cloudFramePattern || climate.timeFramePattern || climate.framePattern || this.body.cloudFramePattern
            : layer === 'clouds' ? variant.cloudFramePattern || this.body.cloudFramePattern
            : layer === 'rings' ? variant.ringFramePattern || this.body.ringFramePattern
                : variant.framePattern || this.body.framePattern;
        if (!pattern) return '';
        const timePad = Number.isInteger(climate?.timePad) && climate.timePad >= 0 ? climate.timePad : 3;
        const time = timePad ? String(timeIndex ?? 0).padStart(timePad, '0') : String(timeIndex ?? 0);
        const path = pattern.replace('{time}', time).replace('{timeIndex}', String(timeIndex ?? 0))
            .replace('{elevation}', String(elevation)).replace('{azimuth}', String(azimuth).padStart(3, '0'));
        return new URL(path, this.manifestUrl).href;
    }

    sampleAtResolution(sample, variant) {
        const column = Math.round((sample.azimuth || 0) / 360 * this.body.azimuthCount) % this.body.azimuthCount;
        return { ...sample, variant, url: this.frameUrl(sample.elevation, column, sample.layer, variant, sample.timeIndex) };
    }

    availableSample(sample) {
        if (!sample) return null;
        if (this.cache.has(sample.url)) return sample;
        for (const variant of (this.body.resolutions || []).slice().reverse()) {
            if (variant.width >= (sample.variant?.width || this.body.width)) continue;
            const fallback = this.sampleAtResolution(sample, variant);
            if (this.cache.has(fallback.url)) return fallback;
        }
        return null;
    }

    samples() {
        if (!this.body) return [];
        const count = this.body.azimuthCount;
        const elevation = this.body.elevations.reduce((best, value, index, values) => Math.abs(value - this.elevation) < Math.abs(values[best] - this.elevation) ? index : best, 0);
        if (!this.fullSphere()) {
            const column = ((this.azimuth % 360 + 360) % 360) / 360 * count;
            const sample = (index, weight) => ({ url: this.frameUrl(elevation, index), layer: 'surface', elevation, azimuth: index * 360 / count, weight });
            if (360 / count > 2) return [sample(Math.round(column) % count, 1)];
            const left = Math.floor(column) % count;
            const fraction = column - Math.floor(column);
            return [sample(left, 1 - fraction), sample((left + 1) % count, fraction)]
                .filter(frame => frame.weight > 0.001).sort((first, second) => second.weight - first.weight);
        }
        const variant = this.resolution();
        const surface = (() => {
            const column = Math.round(((this.azimuth % 360 + 360) % 360) / 360 * count) % count;
            const capturedAzimuth = column * 360 / count;
            return { url: this.frameUrl(elevation, column, 'surface', variant), layer: 'surface', variant, elevation,
                azimuth: capturedAzimuth, delta: ((this.azimuth - capturedAzimuth + 540) % 360) - 180, weight: 1 };
        })();
        const climate = this.climateConfig();
        const cloudSamples = [];
        if (climate) {
            const azimuth = this.cloudAzimuth;
            const column = Math.round(((azimuth % 360 + 360) % 360) / 360 * count) % count;
            const capturedAzimuth = column * 360 / count;
            const times = this.climateFrameIndex();
            const entries = times?.fraction > 0.001 && climate.interpolate && climate.frameCount > 1
                ? [[times.lower, 1 - times.fraction], [times.upper, times.fraction]]
                : [[times && times.fraction >= 0.5 ? times.upper : times?.lower || 0, 1]];
            for (const [timeIndex, weight] of entries) cloudSamples.push({
                url: this.frameUrl(elevation, column, 'clouds', variant, timeIndex), layer: 'clouds', variant,
                elevation, azimuth: capturedAzimuth, timeIndex, time: timeIndex * climate.stepHours,
                delta: ((azimuth - capturedAzimuth + 540) % 360) - 180, weight
            });
        } else if (this.body.cloudFramePattern) {
            const azimuth = this.cloudAzimuth;
            const column = Math.round(((azimuth % 360 + 360) % 360) / 360 * count) % count;
            const capturedAzimuth = column * 360 / count;
            cloudSamples.push({ url: this.frameUrl(elevation, column, 'clouds', variant), layer: 'clouds', variant,
                elevation, azimuth: capturedAzimuth, delta: ((azimuth - capturedAzimuth + 540) % 360) - 180, weight: 1 });
        }
        return [surface, ...cloudSamples];
    }

    fullSphere() {
        const rectangle = this.body?.sphereRect;
        return Boolean(this.body?.transparent && rectangle && [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite)
            && rectangle.width > 0 && rectangle.height > 0);
    }

    framing() {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const compact = usesCompactSkyLayout();
        const composition = {
            sun: { radius: 1.58, centerHeight: 1.18, coverage: 0.63, top: 0.40, bottom: 0.74 },
            mercury: { radius: 1.72, centerHeight: 1.23, coverage: 0.68, top: 0.45, bottom: 0.79 },
            venus: { radius: 1.60, centerHeight: 1.19, coverage: 0.64, top: 0.41, bottom: 0.75 },
            earth: { radius: 1.68, centerHeight: 1.22, coverage: 0.67, top: 0.44, bottom: 0.78 },
            moon: { radius: 1.75, centerHeight: 1.24, coverage: 0.70, top: 0.46, bottom: 0.80 },
            mars: { radius: 1.70, centerHeight: 1.22, coverage: 0.68, top: 0.45, bottom: 0.79 },
            jupiter: { radius: 1.60, centerHeight: 1.18, coverage: 0.65, top: 0.42, bottom: 0.76 },
            saturn: { radius: 1.35, centerHeight: 1.13, coverage: 0.54, top: 0.34, bottom: 0.67 },
            uranus: { radius: 1.42, centerHeight: 1.16, coverage: 0.58, top: 0.37, bottom: 0.70 },
            neptune: { radius: 1.63, centerHeight: 1.20, coverage: 0.64, top: 0.42, bottom: 0.76 }
        }[this.profile?.id] || { radius: 1.68, centerHeight: 1.22, coverage: 0.67, top: 0.44, bottom: 0.78 };
        const panelOnLeft = this.visit?.panelOnLeft || false;
        let centerY = composition.centerHeight * height;
        let centerX;
        let radius;
        if (compact) {
            const top = composition.top * width;
            const bottom = composition.bottom * width;
            centerX = Math.min(0, (top + bottom) / 2 + (height * height - 2 * centerY * height) / (2 * (bottom - top)));
            radius = Math.hypot(top - centerX, centerY);
        } else {
            const layout = this.framingLayout || { availableFraction: 0.7 };
            const availableWidth = width * layout.availableFraction;
            radius = Math.max(composition.radius * height, availableWidth * 0.94);
            const midpointDepth = centerY - height * 0.5;
            centerX = availableWidth * composition.coverage - Math.sqrt(Math.max(0, radius * radius - midpointDepth * midpointDepth));
        }
        return { x: panelOnLeft && !compact ? width - centerX : centerX, y: centerY, radius };
    }

    measureFramingLayout() {
        const width = window.innerWidth;
        const panel = document.querySelector?.('#celestialPanel');
        const rectangle = panel?.getBoundingClientRect?.();
        const panelWidth = panel?.offsetWidth || rectangle?.width || clamp(width * 0.38, 350, 540);
        const gap = clamp(width * 0.018, 24, 48);
        const left = panel?.offsetLeft || rectangle?.left;
        const availableWidth = Number.isFinite(left) && panelWidth < width * 0.8
            ? panel.classList.contains('is-left') ? width - left - panelWidth - gap : left - gap
            : width - panelWidth - 28 - gap;
        this.framingLayout = { availableFraction: clamp(availableWidth / width, 0.3, 0.9) };
    }

    sphereRect(layer = 'surface') {
        const rectangle = layer === 'clouds' ? this.body.cloudSphereRect || this.body.sphereRect : this.body.sphereRect;
        return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height };
    }

    layerCount() {
        const climate = this.climateConfig();
        const clouds = climate?.interpolate && climate.frameCount > 1 ? 2 : Number(Boolean(climate || this.body.cloudFramePattern));
        return 1 + clouds + Number(Boolean(this.body.ringFramePattern));
    }

    decodeBudget() {
        const climate = this.climateConfig();
        const blendBytes = climate?.interpolate && climate.frameCount > 1 ? this.canvas.width * this.canvas.height * 4 : 0;
        return Math.max(4, this.cacheBudget - blendBytes);
    }

    decodeSize() {
        if (!this.body) return null;
        const { width, height } = this.body;
        const displayWidth = this.canvas?.width || window.innerWidth * (window.devicePixelRatio || 1);
        const displayHeight = this.canvas?.height || window.innerHeight * (window.devicePixelRatio || 1);
        const fullSphere = this.fullSphere();
        const workingFrames = 2 * this.layerCount() + 2;
        const memoryScale = fullSphere ? Math.sqrt(this.decodeBudget() / (workingFrames * width * height * 4)) : 1;
        const scale = Math.min(1, memoryScale, fullSphere
            ? this.framing().radius * 2 / Math.min(width * this.body.sphereRect.width, height * this.body.sphereRect.height)
            : Math.max(displayWidth / width, displayHeight / height));
        const round = fullSphere ? Math.floor : Math.ceil;
        return { resizeWidth: Math.max(1, round(width * scale)), resizeHeight: Math.max(1, round(height * scale)), resizeQuality: 'high' };
    }

    frameCapacity() {
        const size = this.fullSphere() ? this.decodePlan(this.samples()[0]) : this.decodeSize();
        if (!size) return 8;
        return Math.max(1, Math.floor(this.decodeBudget() / (size.resizeWidth * size.resizeHeight * 4)));
    }

    decodePlan(sample) {
        if (!this.fullSphere()) return this.decodeSize();
        const layer = sample?.layer || 'surface';
        const variant = sample?.variant || this.resolution();
        const prefix = layer === 'surface' ? '' : layer === 'clouds' ? 'cloud' : 'ring';
        const sourceWidth = sample?.sourceWidth || (prefix && (variant[`${prefix}Width`] || this.body[`${prefix}Width`])) || variant.width || this.body.width;
        const sourceHeight = sample?.sourceHeight || (prefix && (variant[`${prefix}Height`] || this.body[`${prefix}Height`])) || variant.height || this.body.height;
        const rectangle = (prefix && (variant[`${prefix}SphereRect`] || this.body[`${prefix}SphereRect`])) || variant.sphereRect || this.body.sphereRect;
        const framing = this.framing();
        const radius = framing.radius * (layer === 'clouds' ? rectangle.width / (variant.sphereRect || this.body.sphereRect).width : 1);
        const sourceRadius = sourceWidth * rectangle.width / 2;
        const scale = radius / sourceRadius;
        const centerX = (rectangle.x + rectangle.width / 2) * sourceWidth;
        const centerY = (rectangle.y + rectangle.height / 2) * sourceHeight;
        const displacement = layer === 'rings' ? 0 : 2 * Math.sin(Math.min(2, 360 / this.body.azimuthCount) * Math.PI / 360) * sourceRadius;
        const padding = Math.ceil(displacement) + 8;
        const left = clamp(Math.floor(centerX - framing.x / scale) - padding, 0, sourceWidth - 1);
        const top = clamp(Math.floor(centerY - framing.y / scale) - padding, 0, sourceHeight - 1);
        const right = clamp(Math.ceil(centerX + (this.canvas.width - framing.x) / scale) + padding, left + 1, sourceWidth);
        const bottom = clamp(Math.ceil(centerY + (this.canvas.height - framing.y) / scale) + padding, top + 1, sourceHeight);
        const crop = { x: left, y: top, width: right - left, height: bottom - top };
        const memoryScale = Math.sqrt(this.decodeBudget() / ((this.layerCount() * 2 + 2) * crop.width * crop.height * 4));
        const decodeScale = Math.min(1, scale, memoryScale);
        return { crop, sourceWidth, sourceHeight, rectangle, variant,
            resizeWidth: Math.max(1, Math.floor(crop.width * decodeScale)), resizeHeight: Math.max(1, Math.floor(crop.height * decodeScale)), resizeQuality: 'high' };
    }

    matchesDecode(image, plan) {
        if (!plan?.crop) return !plan || image.width >= plan.resizeWidth && image.height >= plan.resizeHeight;
        const previous = this.imageMetadata.get(image);
        return Boolean(previous?.crop && previous.sourceWidth === plan.sourceWidth && previous.sourceHeight === plan.sourceHeight
            && previous.crop.x <= plan.crop.x && previous.crop.y <= plan.crop.y
            && previous.crop.x + previous.crop.width >= plan.crop.x + plan.crop.width
            && previous.crop.y + previous.crop.height >= plan.crop.y + plan.crop.height
            && image.width / previous.crop.width >= plan.resizeWidth / plan.crop.width
            && image.height / previous.crop.height >= plan.resizeHeight / plan.crop.height);
    }

    request(url, sample = null) {
        const size = this.decodePlan(sample);
        const cached = this.cache.get(url);
        if (cached && this.matchesDecode(cached, size)) return Promise.resolve(cached);
        if (this.pending.has(url)) return this.pending.get(url);
        if ((this.failures.get(url) || 0) > performance.now()) return Promise.resolve(null);
        let resolve;
        const promise = new Promise(completion => { resolve = completion; });
        this.pending.set(url, promise);
        this.queue.push({ url, resolve, sample, generation: this.generation, decodeSize: size });
        this.pump();
        return promise;
    }

    pump() {
        if (!this.profile || document.hidden) return;
        const concurrency = Math.min(2, Math.max(1, this.frameCapacity() - 3));
        while (this.activeLoads < concurrency && this.queue.length) {
            const task = this.queue.shift();
            if (task.generation !== this.generation) { task.resolve(null); continue; }
            task.decodeSize = this.decodePlan(task.sample);
            this.activeLoads += 1;
            this.loadFrame(task);
        }
    }

    async loadFrame(task) {
        const controller = new AbortController();
        this.controllers.add(controller);
        const timeout = window.setTimeout(() => controller.abort(), (task.decodeSize?.sourceWidth || this.body?.width || 0) > 4096 ? 45000 : 12000);
        let image = null;
        try {
            const response = await fetch(task.url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Close-up frame: HTTP ${response.status}`);
            const blob = await response.blob();
            if (task.generation !== this.generation) return;
            const plan = task.decodeSize;
            const options = { resizeWidth: plan?.resizeWidth, resizeHeight: plan?.resizeHeight, resizeQuality: 'high', premultiplyAlpha: 'premultiply' };
            if (typeof createImageBitmap === 'function') image = plan?.crop
                ? await createImageBitmap(blob, plan.crop.x, plan.crop.y, plan.crop.width, plan.crop.height, options)
                : await createImageBitmap(blob, options);
            else {
                const objectUrl = URL.createObjectURL(blob);
                try {
                    image = new Image();
                    image.decoding = 'async';
                    image.src = objectUrl;
                    await image.decode();
                    if (plan && (plan.crop || image.width > plan.resizeWidth || image.height > plan.resizeHeight)) {
                        const reduced = document.createElement('canvas');
                        reduced.width = plan.resizeWidth;
                        reduced.height = plan.resizeHeight;
                        const crop = plan.crop || { x: 0, y: 0, width: image.width, height: image.height };
                        reduced.getContext('2d').drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, reduced.width, reduced.height);
                        image.src = '';
                        image = reduced;
                    }
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            }
            this.imageMetadata.set(image, { ...(plan || {}), premultiplied: true });
            if (task.generation !== this.generation) { this.releaseImage(image); image = null; return; }
            const previous = this.cache.get(task.url);
            if (previous && this.matchesDecode(previous, plan)) {
                this.releaseImage(image);
                image = previous;
                return;
            }
            if (previous) {
                if (previous === this.lastImage || previous === this.lastCloudImage || previous === this.lastRingImage) {
                    const retainedKey = previous === this.lastCloudImage ? this.retainedCloudKey : previous === this.lastRingImage ? this.retainedRingKey : this.retainedFrameKey;
                    const retained = this.cache.get(retainedKey);
                    if (retained) {
                        this.cacheBytes -= retained.width * retained.height * 4;
                        this.releaseImage(retained);
                    }
                    this.cache.set(retainedKey, previous);
                } else {
                    this.cacheBytes -= previous.width * previous.height * 4;
                    this.releaseImage(previous);
                }
            }
            this.cache.set(task.url, image);
            this.cacheBytes += image.width * image.height * 4;
            if (task.sample?.layer === 'clouds') {
                if (!this.lastCloudImage) {
                    this.lastCloudImage = image;
                    this.lastCloudSample = task.sample;
                }
            } else if (task.sample?.layer === 'rings') {
                if (!this.lastRingImage) {
                    this.lastRingImage = image;
                    this.lastRingSample = task.sample;
                }
            } else if (!this.lastImage) {
                this.lastImage = image;
                this.lastSurfaceSample = task.sample || this.samples()[0];
            }
            this.dirty = true;
            if (this.samples().some(sample => sample.url === task.url) || task.url === this.posterUrl) this.error = false;
            this.evict();
            this.updateCopy();
        } catch (error) {
            if (task.generation === this.generation) {
                this.failures.set(task.url, performance.now() + 30000);
                if ((!this.lastImage && task.url === this.posterUrl) || this.samples().some(sample => sample.url === task.url)) {
                    this.error = true;
                    this.updateCopy();
                }
            }
        } finally {
            window.clearTimeout(timeout);
            this.controllers.delete(controller);
            if (task.generation === this.generation) {
                this.pending.delete(task.url);
                this.activeLoads -= 1;
            }
            task.resolve(image);
            this.pump();
        }
    }

    evict() {
        const pinned = new Set(this.samples().map(sample => sample.url));
        const ring = this.ringSample();
        if (ring) pinned.add(ring.url);
        const cacheLimit = Math.min(8, Math.max(pinned.size, this.frameCapacity() - 2));
        for (const [url, image] of this.cache) {
            if (this.cacheBytes <= this.decodeBudget() && this.cache.size <= cacheLimit) break;
            if (pinned.has(url) || image === this.lastImage || image === this.lastCloudImage || image === this.lastRingImage) continue;
            this.cacheBytes -= image.width * image.height * 4;
            this.releaseImage(image);
            this.cache.delete(url);
        }
    }

    releaseImage(image) {
        if (typeof image.close === 'function') image.close();
        else if (image.tagName === 'CANVAS') { image.width = 1; image.height = 1; }
        else image.src = '';
    }

    prefetch(samples) {
        const desired = new Map();
        const preview = this.body.resolutions?.[0];
        for (const sample of samples) {
            if (preview && sample.variant !== preview && !this.cache.has(sample.url)) {
                const fallback = this.sampleAtResolution(sample, preview);
                desired.set(fallback.url, fallback);
            }
            desired.set(sample.url, sample);
        }
        const ring = this.ringSample();
        if (ring) {
            if (preview && ring.variant !== preview && !this.cache.has(ring.url)) {
                const fallback = this.sampleAtResolution(ring, preview);
                desired.set(fallback.url, fallback);
            }
            desired.set(ring.url, ring);
        }
        const prefetchLimit = Math.max(desired.size, Math.min(COARSE_POINTER ? 3 : 5, this.frameCapacity() - 3));
        for (const offset of [1, -1, 2]) {
            if (desired.size >= prefetchLimit) break;
            for (const sample of samples) {
                if (desired.size >= prefetchLimit) break;
                const column = Math.round(sample.azimuth / 360 * this.body.azimuthCount);
                const nextColumn = (column + offset + this.body.azimuthCount) % this.body.azimuthCount;
                const url = this.frameUrl(sample.elevation, nextColumn, sample.layer, sample.variant, sample.timeIndex);
                desired.set(url, { ...sample, url, azimuth: nextColumn * 360 / this.body.azimuthCount });
            }
        }
        this.queue = this.queue.filter(task => {
            if (desired.has(task.url) || this.posterUrls.has(task.url)) return true;
            this.pending.delete(task.url);
            task.resolve(null);
            return false;
        });
        for (const [url, sample] of desired) this.request(url, sample);
    }

    render(time, visit) {
        if (!this.profile || visit.profile.id !== this.profile.id || document.hidden) return false;
        const delta = this.lastTick ? Math.min(0.1, Math.max(0, (time - this.lastTick) / 1000)) : 0;
        this.lastTick = time;
        this.visit = visit;
        this.element.inert = visit.phase === 'returning' || state.sectionDrawerOpen;
        this.canvas.style.opacity = String(clamp(visit.visualProgress, 0, 1));
        if (visit.phase === 'observing' && this.body && !this.paused && !this.drag && time >= this.resumeAt && !state.sectionDrawerOpen && !state.modalOpen) {
            const rotationSpeed = this.fullSphere() ? (this.body.angularVelocity ?? 0.24) : 1.8;
            this.azimuth = (this.azimuth + delta * rotationSpeed + 360) % 360;
            const climate = this.climateConfig();
            const cloudSpeed = climate?.cloudAngularVelocity ?? this.body.cloudAngularVelocity ?? rotationSpeed * (climate ? 3 : 1.12);
            this.cloudAzimuth = (this.cloudAzimuth + delta * cloudSpeed + 360) % 360;
            this.advanceClimate(delta);
            this.dirty = true;
        }
        if (this.body && visit.phase !== 'returning') {
            const samples = this.samples();
            this.prefetch(samples);
            if (this.dirty && (this.fullSphere() || time - this.lastDraw >= 1000 / 24)) this.draw(samples, time);
        }
        return Boolean(this.lastImage);
    }

    draw(samples, time) {
        if (!this.context) return;
        const context = this.context;
        const surface = this.fullSphere() ? this.availableSample(samples.find(sample => sample.layer === 'surface'))
            : samples.find(sample => sample.layer === 'surface' && this.cache.has(sample.url));
        if (!surface && !this.lastImage) return;
        context.globalAlpha = 1;
        context.fillStyle = '#020208';
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        const image = surface ? this.cache.get(surface.url) : this.lastImage;
        if (this.fullSphere()) {
            if (typeof CelestialStarfield === 'function') {
                this.starfield ||= new CelestialStarfield();
                this.starfield.draw(context, this.canvas.width, this.canvas.height, { yaw: this.cameraYaw, pitch: this.cameraPitch, fov: this.body.starfieldFov || 48 });
            }
            const framing = this.framing();
            const displayedSurface = surface || this.lastSurfaceSample;
            const displayedElevation = displayedSurface?.elevation ?? this.body.defaultElevation ?? 0;
            const layers = [this.sphereLayer(image, displayedSurface, framing)];
            const cloudCandidates = samples.filter(sample => sample.layer === 'clouds' && sample.elevation === displayedElevation)
                .map(sample => this.availableSample(sample)).filter(Boolean);
            const loadedClouds = cloudCandidates.map(sample => ({ sample, image: this.cache.get(sample.url) })).filter(entry => entry.image);
            if (loadedClouds.length) {
                const totalWeight = loadedClouds.reduce((sum, entry) => sum + Math.max(0, entry.sample.weight ?? 1), 0) || 1;
                for (const entry of loadedClouds) {
                    const weight = Math.max(0, entry.sample.weight ?? 1) / totalWeight;
                    layers.push(this.sphereLayer(entry.image, entry.sample, framing, 'clouds', weight));
                    this.lastCloudImage = entry.image;
                    this.lastCloudSample = entry.sample;
                }
            } else if (this.lastCloudSample?.elevation === displayedElevation && this.lastCloudImage) {
                layers.push(this.sphereLayer(this.lastCloudImage, this.lastCloudSample, framing, 'clouds', 1));
            }
            if (!this.compositor && typeof CelestialSphereCompositor === 'function') this.compositor = new CelestialSphereCompositor();
            const composited = this.compositor?.render(layers, this.canvas.width, this.canvas.height);
            if (composited) context.drawImage(composited, 0, 0);
            else this.drawLayerFrames(layers);
            const desiredRing = this.ringSample(displayedElevation);
            const ring = this.availableSample(desiredRing) || desiredRing;
            const ringImage = ring && (this.cache.get(ring.url) || (this.lastRingSample?.elevation === displayedElevation ? this.lastRingImage : null));
            if (ringImage) {
                this.drawRing(ringImage, framing);
                this.lastRingImage = ringImage;
                this.lastRingSample = ring;
            }
        } else {
            const available = samples.filter(sample => this.cache.has(sample.url));
            const layers = available.length ? available : [{ image: this.lastImage, weight: 1 }];
            let accumulated = 0;
            for (const layer of layers) {
                const legacyImage = layer.image || this.cache.get(layer.url);
                accumulated += layer.weight;
                context.globalAlpha = layer.weight / accumulated;
                const scale = Math.max(this.canvas.width / legacyImage.width, this.canvas.height / legacyImage.height);
                const width = legacyImage.width * scale;
                const height = legacyImage.height * scale;
                const compact = usesCompactSkyLayout();
                const offsetX = compact ? (this.canvas.width - width) * 0.18 : (this.canvas.width - width) * 0.5;
                context.drawImage(legacyImage, offsetX, (this.canvas.height - height) * 0.5, width, height);
            }
        }
        this.lastImage = image;
        if (surface) this.lastSurfaceSample = surface;
        for (const sample of samples) {
            const cached = this.cache.get(sample.url);
            if (!cached) continue;
            this.cache.delete(sample.url);
            this.cache.set(sample.url, cached);
        }
        this.evict();
        context.globalAlpha = 1;
        this.lastDraw = time;
        this.dirty = false;
    }

    ringSample(elevation = this.body?.elevations.reduce((best, value, index, values) => Math.abs(value - this.elevation) < Math.abs(values[best] - this.elevation) ? index : best, 0)) {
        if (!this.body?.ringFramePattern) return null;
        const variant = this.resolution();
        return { layer: 'rings', variant, elevation, url: this.frameUrl(elevation, 0, 'rings', variant) };
    }

    drawRing(image, framing) {
        const rectangle = this.imageRectangle(image, this.body.ringSphereRect || this.body.sphereRect);
        if (!rectangle) return;
        const sourceRadius = rectangle.width * image.width / 2;
        const scale = framing.radius / sourceRadius;
        this.context.drawImage(image, framing.x - (rectangle.x + rectangle.width / 2) * image.width * scale,
            framing.y - (rectangle.y + rectangle.height / 2) * image.height * scale,
            image.width * scale, image.height * scale);
    }

    sphereLayer(image, sample, framing, layer = 'surface', opacity = 1) {
        const metadata = this.imageMetadata.get(image);
        const sourceRectangle = metadata?.rectangle || this.sphereRect(layer);
        const rectangle = this.imageRectangle(image, sourceRectangle);
        const capturedElevation = this.body.elevations[sample?.elevation ?? this.body.defaultElevation ?? 0];
        const elevationRadians = capturedElevation * Math.PI / 180;
        const axis = this.body.spinAxes?.[sample?.elevation ?? this.body.defaultElevation ?? 0] || [0, Math.cos(elevationRadians), Math.sin(elevationRadians)];
        const currentAzimuth = layer === 'clouds' ? this.cloudAzimuth : this.azimuth;
        const displacement = ((currentAzimuth - (sample?.azimuth || 0) + 540) % 360) - 180;
        const maximumWarp = Math.min(2, 360 / this.body.azimuthCount);
        const angle = -clamp(displacement, -maximumWarp, maximumWarp) * Math.PI / 180;
        const key = layer === 'clouds' && sample?.timeIndex !== undefined ? `${layer}:${sample.timeIndex}` : layer;
        const climate = layer === 'clouds' ? this.climateConfig() : null;
        const period = climate?.periodHours || 0;
        const phaseDelta = climate && Number.isFinite(sample?.time) && period > 0
            ? (((this.cloudTime - sample.time + period * 0.5) % period) + period * 0.5) % period - period * 0.5 : 0;
        const climatePhase = period > 0 ? phaseDelta / period * Math.PI * 2 : 0;
        const climateWarp = climate && climate.localWarp !== false ? Number(climate.localWarp ?? 0.8) : 0;
        return { key, image, premultiplied: metadata?.premultiplied === true, rectangle,
            framing: { ...framing, radius: framing.radius * sourceRectangle.width / this.body.sphereRect.width }, axis, angle,
            climatePhase, climateWarp,
            blendGroup: layer === 'clouds' && sample?.timeIndex !== undefined ? 'climate' : null,
            opacity: clamp(opacity, 0, 1) };
    }

    imageRectangle(image, rectangle) {
        const metadata = this.imageMetadata.get(image);
        if (!metadata?.crop) return rectangle;
        const { crop, sourceWidth, sourceHeight } = metadata;
        return { x: (rectangle.x * sourceWidth - crop.x) / crop.width, y: (rectangle.y * sourceHeight - crop.y) / crop.height,
            width: rectangle.width * sourceWidth / crop.width, height: rectangle.height * sourceHeight / crop.height };
    }

    drawLayerFrames(layers) {
        for (let index = 0; index < layers.length; index += 1) {
            const layer = layers[index];
            const next = layers[index + 1];
            if (!layer.blendGroup || next?.blendGroup !== layer.blendGroup) {
                this.drawLayerFrame(layer);
                continue;
            }
            this.climateCanvas ||= document.createElement('canvas');
            if (this.climateCanvas.width !== this.canvas.width || this.climateCanvas.height !== this.canvas.height) {
                this.climateCanvas.width = this.canvas.width;
                this.climateCanvas.height = this.canvas.height;
            }
            const context = this.climateCanvas.getContext('2d');
            context.clearRect(0, 0, this.climateCanvas.width, this.climateCanvas.height);
            context.globalCompositeOperation = 'lighter';
            context.globalAlpha = 1;
            this.drawLayerFrame(layer, context);
            this.drawLayerFrame(next, context);
            context.globalCompositeOperation = 'source-over';
            this.context.drawImage(this.climateCanvas, 0, 0);
            index += 1;
        }
    }

    drawLayerFrame({ image, rectangle, framing, opacity = 1 }, context = this.context) {
        const previousAlpha = context.globalAlpha;
        context.globalAlpha = previousAlpha * opacity;
        const scale = framing.radius * 2 / (rectangle.width * image.width);
        context.drawImage(image, framing.x - (rectangle.x + rectangle.width / 2) * image.width * scale,
            framing.y - (rectangle.y + rectangle.height / 2) * image.height * scale, image.width * scale, image.height * scale);
        context.globalAlpha = previousAlpha;
    }

    resize() {
        if (!this.canvas) return;
        const compact = usesCompactSkyLayout();
        const width = window.innerWidth;
        const height = compact ? Math.round(window.innerHeight * 0.55) : window.innerHeight;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.canvas.style.height = `${height}px`;
        this.element.classList.toggle('is-compact', compact);
        this.measureFramingLayout();
        this.updateCopy();
        this.dirty = true;
        this.lastDraw = 0;
    }

    canInteract() {
        return this.body && this.visit?.phase === 'observing' && !state.sectionDrawerOpen && !state.modalOpen;
    }

    rotate(horizontal, vertical) {
        if (!this.canInteract()) return;
        this.azimuth = ((this.azimuth + horizontal) % 360 + 360) % 360;
        this.cloudAzimuth = ((this.cloudAzimuth + horizontal) % 360 + 360) % 360;
        this.cameraYaw = ((this.cameraYaw + horizontal) % 360 + 360) % 360;
        this.cameraPitch = clamp(this.cameraPitch + vertical, -89, 89);
        this.elevation = clamp(this.elevation + vertical, this.body.elevations[0], this.body.elevations[this.body.elevations.length - 1]);
        this.resumeAt = performance.now() + 2600;
        this.dirty = true;
    }

    releaseInput() {
        const pointer = this.drag?.pointerId;
        this.drag = null;
        this.element?.classList.remove('is-dragging');
        if (pointer !== undefined && this.element?.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
        this.resumeAt = performance.now() + 2600;
    }

    togglePause() {
        this.paused = !this.paused;
        this.resumeAt = 0;
        this.updateCopy();
    }

    handleKey(event) {
        if (!this.canInteract() || !this.element.contains(event.target)) return false;
        const moves = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, 10], ArrowDown: [0, -10] };
        if (moves[event.key]) {
            event.preventDefault();
            this.rotate(...moves[event.key]);
            return true;
        }
        if (event.code === 'Space' && event.target === this.element) {
            event.preventDefault();
            this.togglePause();
            return true;
        }
        return false;
    }

    async retry() {
        if (this.loading || !this.profile) return;
        if (this.body && this.lastImage) {
            this.failures.clear();
            this.error = false;
            this.updateCopy();
            this.prefetch(this.samples());
            return;
        }
        const visit = this.visit;
        const profile = this.profile;
        await this.prepare(profile);
        if (state.celestialVisit === visit) this.visit = visit;
    }

    clear() {
        this.generation += 1;
        this.releaseInput();
        this.controllers.forEach(controller => controller.abort());
        this.controllers.clear();
        this.queue.forEach(task => task.resolve(null));
        this.queue = [];
        this.pending.clear();
        this.posterUrls.clear();
        this.cache.forEach(image => this.releaseImage(image));
        this.cache.clear();
        this.cacheBytes = 0;
        this.failures.clear();
        this.activeLoads = 0;
        this.profile = null;
        this.body = null;
        this.visit = null;
        this.lastImage = null;
        this.lastCloudImage = null;
        this.lastSurfaceSample = null;
        this.lastCloudSample = null;
        this.lastRingImage = null;
        this.lastRingSample = null;
        this.cloudTime = 0;
        this.starfield?.clear();
        this.compositor?.clear();
        if (this.climateCanvas) {
            this.climateCanvas.width = 1;
            this.climateCanvas.height = 1;
        }
        this.lastTick = 0;
        this.lastDraw = 0;
        this.loading = false;
        this.error = false;
        this.dirty = true;
        if (this.element) {
            this.element.hidden = true;
            this.element.inert = true;
            this.canvas.width = 1;
            this.canvas.height = 1;
        }
    }
}

const bakedCelestialViewer = new BakedCelestialViewer();
