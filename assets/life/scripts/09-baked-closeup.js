class BakedCelestialViewer {
    constructor() {
        const pageUrl = new URL(document.baseURI);
        const atlasMode = pageUrl.searchParams.get('celestialAtlas');
        const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(pageUrl.hostname);
        const directories = atlasMode === 'local' ? ['baked'] : localPreview && atlasMode !== 'hosted' ? ['baked', 'hosted'] : ['hosted'];
        this.manifestUrls = directories.map(directory => new URL(`assets/celestial/${directory}/manifest.json`, pageUrl).href);
        this.manifestUrl = this.manifestUrls[0];
        this.cache = new Map();
        this.cacheBytes = 0;
        this.cacheBudget = (COARSE_POINTER ? 64 : 256) * 1024 * 1024;
        this.retainedFrameKey = Symbol('retained-frame');
        this.pending = new Map();
        this.failures = new Map();
        this.queue = [];
        this.controllers = new Set();
        this.generation = 0;
        this.activeLoads = 0;
        this.lastTick = 0;
        this.lastDraw = 0;
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
                if (manifest.version !== 1 || !manifest.bodies) throw new Error('Unsupported close-up manifest');
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
            this.elevation = body.elevations[clamp(body.defaultElevation || 0, 0, body.elevations.length - 1)];
            this.posterUrl = new URL(body.poster, this.manifestUrl).href;
            const frame = this.samples()[0];
            await Promise.any([this.request(this.posterUrl), this.request(frame.url)].map(promise => promise.then(image => {
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

    frameUrl(elevation, azimuth) {
        const path = this.body.framePattern.replace('{elevation}', String(elevation)).replace('{azimuth}', String(azimuth).padStart(3, '0'));
        return new URL(path, this.manifestUrl).href;
    }

    samples() {
        if (!this.body) return [];
        const count = this.body.azimuthCount;
        const column = ((this.azimuth % 360 + 360) % 360) / 360 * count;
        const elevation = this.body.elevations.reduce((best, value, index, values) => Math.abs(value - this.elevation) < Math.abs(values[best] - this.elevation) ? index : best, 0);
        if (360 / count > 2) return [{ url: this.frameUrl(elevation, Math.round(column) % count), weight: 1 }];
        const left = Math.floor(column) % count;
        const fraction = column - Math.floor(column);
        return [{ url: this.frameUrl(elevation, left), weight: 1 - fraction },
            { url: this.frameUrl(elevation, (left + 1) % count), weight: fraction }]
            .filter(sample => sample.weight > 0.001).sort((first, second) => second.weight - first.weight);
    }

    decodeSize() {
        if (!this.body) return null;
        const { width, height } = this.body;
        const displayWidth = this.canvas?.width || window.innerWidth * (window.devicePixelRatio || 1);
        const displayHeight = this.canvas?.height || window.innerHeight * (window.devicePixelRatio || 1);
        const scale = Math.min(1, Math.max(displayWidth / width, displayHeight / height));
        return { resizeWidth: Math.max(1, Math.ceil(width * scale)), resizeHeight: Math.max(1, Math.ceil(height * scale)), resizeQuality: 'high' };
    }

    frameCapacity() {
        const size = this.decodeSize();
        if (!size) return 8;
        return Math.max(1, Math.floor(this.cacheBudget / (size.resizeWidth * size.resizeHeight * 4)));
    }

    request(url) {
        const size = this.decodeSize();
        const cached = this.cache.get(url);
        if (cached && (!size || cached.width >= size.resizeWidth && cached.height >= size.resizeHeight)) return Promise.resolve(cached);
        if (this.pending.has(url)) return this.pending.get(url);
        if ((this.failures.get(url) || 0) > performance.now()) return Promise.resolve(null);
        let resolve;
        const promise = new Promise(completion => { resolve = completion; });
        this.pending.set(url, promise);
        this.queue.push({ url, resolve, generation: this.generation, decodeSize: size });
        this.pump();
        return promise;
    }

    pump() {
        if (!this.profile || document.hidden) return;
        const concurrency = Math.min(2, Math.max(1, this.frameCapacity() - 3));
        while (this.activeLoads < concurrency && this.queue.length) {
            const task = this.queue.shift();
            if (task.generation !== this.generation) { task.resolve(null); continue; }
            task.decodeSize = this.decodeSize();
            this.activeLoads += 1;
            this.loadFrame(task);
        }
    }

    async loadFrame(task) {
        const controller = new AbortController();
        this.controllers.add(controller);
        const timeout = window.setTimeout(() => controller.abort(), 12000);
        let image = null;
        try {
            const response = await fetch(task.url, { signal: controller.signal });
            if (!response.ok) throw new Error(`Close-up frame: HTTP ${response.status}`);
            const blob = await response.blob();
            if (task.generation !== this.generation) return;
            if (typeof createImageBitmap === 'function') image = await createImageBitmap(blob, task.decodeSize || {});
            else {
                const objectUrl = URL.createObjectURL(blob);
                try {
                    image = new Image();
                    image.decoding = 'async';
                    image.src = objectUrl;
                    await image.decode();
                    if (task.decodeSize && (image.width > task.decodeSize.resizeWidth || image.height > task.decodeSize.resizeHeight)) {
                        const reduced = document.createElement('canvas');
                        reduced.width = task.decodeSize.resizeWidth;
                        reduced.height = task.decodeSize.resizeHeight;
                        reduced.getContext('2d').drawImage(image, 0, 0, reduced.width, reduced.height);
                        image.src = '';
                        image = reduced;
                    }
                } finally {
                    URL.revokeObjectURL(objectUrl);
                }
            }
            if (task.generation !== this.generation) { this.releaseImage(image); image = null; return; }
            const previous = this.cache.get(task.url);
            if (previous && previous.width >= image.width && previous.height >= image.height) {
                this.releaseImage(image);
                image = previous;
                return;
            }
            if (previous) {
                if (previous === this.lastImage) {
                    const retained = this.cache.get(this.retainedFrameKey);
                    if (retained) {
                        this.cacheBytes -= retained.width * retained.height * 4;
                        this.releaseImage(retained);
                    }
                    this.cache.set(this.retainedFrameKey, previous);
                } else {
                    this.cacheBytes -= previous.width * previous.height * 4;
                    this.releaseImage(previous);
                }
            }
            this.cache.set(task.url, image);
            this.cacheBytes += image.width * image.height * 4;
            if (!this.lastImage) this.lastImage = image;
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
        const cacheLimit = Math.min(8, Math.max(pinned.size, this.frameCapacity() - 2));
        for (const [url, image] of this.cache) {
            if (this.cacheBytes <= this.cacheBudget && this.cache.size <= cacheLimit) break;
            if (pinned.has(url) || image === this.lastImage) continue;
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
        const desired = new Set(samples.map(sample => sample.url));
        const column = Math.floor(((this.azimuth % 360 + 360) % 360) / 360 * this.body.azimuthCount);
        const elevation = this.body.elevations.reduce((best, value, index, values) => Math.abs(value - this.elevation) < Math.abs(values[best] - this.elevation) ? index : best, 0);
        const prefetchLimit = Math.max(desired.size, Math.min(COARSE_POINTER ? 3 : 5, this.frameCapacity() - 3));
        for (const offset of [1, -1, 2]) {
            if (desired.size >= prefetchLimit) break;
            desired.add(this.frameUrl(elevation, (column + offset + this.body.azimuthCount) % this.body.azimuthCount));
        }
        this.queue = this.queue.filter(task => {
            if (desired.has(task.url) || task.url === this.posterUrl) return true;
            this.pending.delete(task.url);
            task.resolve(null);
            return false;
        });
        for (const url of desired) this.request(url);
    }

    render(time, visit) {
        if (!this.profile || visit.profile.id !== this.profile.id || document.hidden) return false;
        const delta = this.lastTick ? Math.min(0.1, Math.max(0, (time - this.lastTick) / 1000)) : 0;
        this.lastTick = time;
        this.visit = visit;
        this.element.inert = visit.phase === 'returning' || state.sectionDrawerOpen;
        this.canvas.style.opacity = String(clamp(visit.visualProgress, 0, 1));
        if (visit.phase === 'observing' && this.body && !this.paused && !this.drag && time >= this.resumeAt && !state.sectionDrawerOpen && !state.modalOpen) {
            this.azimuth = (this.azimuth + delta * 0.24) % 360;
            this.dirty = true;
        }
        if (this.body && visit.phase !== 'returning') {
            const samples = this.samples();
            this.prefetch(samples);
            if (this.dirty && time - this.lastDraw >= 1000 / 60) this.draw(samples, time);
        }
        return Boolean(this.lastImage);
    }

    draw(samples, time) {
        if (!this.context) return;
        const context = this.context;
        const available = samples.filter(sample => this.cache.has(sample.url));
        if (!available.length && !this.lastImage) return;
        context.globalAlpha = 1;
        context.fillStyle = '#020208';
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        const layers = available.length ? available : [{ image: this.lastImage, weight: 1 }];
        let accumulated = 0;
        for (const layer of layers) {
            const image = layer.image || this.cache.get(layer.url);
            accumulated += layer.weight;
            context.globalAlpha = layer.weight / accumulated;
            const scale = Math.max(this.canvas.width / image.width, this.canvas.height / image.height)
                * clamp(Number(this.profile?.closeupScale) || 1, 0.62, 1.05);
            const width = image.width * scale;
            const height = image.height * scale;
            const compact = usesCompactSkyLayout();
            const offsetX = compact ? (this.canvas.width - width) * 0.18 : (this.canvas.width - width) * 0.5;
            context.drawImage(image, offsetX, (this.canvas.height - height) * 0.5, width, height);
            if (layer.url) {
                this.cache.delete(layer.url);
                this.cache.set(layer.url, image);
            }
        }
        this.lastImage = layers[0].image || this.cache.get(layers[0].url);
        this.evict();
        context.globalAlpha = 1;
        this.lastDraw = time;
        this.dirty = false;
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
        this.cache.forEach(image => this.releaseImage(image));
        this.cache.clear();
        this.cacheBytes = 0;
        this.failures.clear();
        this.activeLoads = 0;
        this.profile = null;
        this.body = null;
        this.visit = null;
        this.lastImage = null;
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
