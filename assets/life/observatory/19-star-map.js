const STAR_MAP_LIMITS = Object.freeze({ minDistance: 72, localMaxDistance: 610, maxDistance: 800, panRadius: 155, pitch: Math.PI * 0.475 });

class LifeStarMap {
    constructor() {
        this.initialized = false;
        this.yaw = Math.PI;
        this.pitch = -0.08;
        this.distance = 430;
        this.center = [0, 0, 0];
        this.target = { yaw: this.yaw, pitch: this.pitch, distance: this.distance, center: this.center.slice() };
        this.fov = 52 * DEG;
        this.pointers = new Map();
        this.wheelOrbitUntil = 0;
        this.groups = new Map();
        this.flight = null;
        this.lastFrame = 0;
        this.hover = null;
        this.overview = null;
        this.selected = null;
        this.galaxyMix = 0;
        this.mapLevel = 'local';
        this.pendingGalaxy = null;
    }

    initialize() {
        if (this.initialized) return;
        this.initialized = true;
        dom.body.classList.add('star-map', 'cursor-free');
        if (COARSE_POINTER) dom.body.classList.add('touch-mode');
        refreshAstronomicalSky(new Date());
        buildPortalGeometry();
        buildSectionDrawer();
        this.buildGroups();
        this.deepSky = new DeepSkyMap(this);
        this.buildEntities();
        this.skyCredit = document.getElementById('skyCredit');
        this.renderer = new StarMapRenderer(
            document.getElementById('starMapCanvas'),
            document.getElementById('starMapFallbackCanvas'),
            this.buildStars()
        );
        this.resize();
        this.bindInputs();
        setGateState(false);
        this.enter();
        this.updateCopy();
    }

    color(colorIndex) {
        const warmth = clamp(((Number.isFinite(colorIndex) ? colorIndex : 0.45) + 0.15) / 1.8, 0, 1);
        return [lerp(0.70, 1, warmth), lerp(0.83, 0.79, warmth), lerp(1, 0.56, warmth)];
    }

    galacticDirection(direction) {
        const catalog = window.HipparcosSky;
        const up = catalog?.galacticNorth || [0, 1, 0];
        const forward = catalog?.galacticCenter || [0, 0, 1];
        const right = normalize(cross(up, forward));
        return normalize([dot(direction, right), dot(direction, up), dot(direction, forward)]);
    }

    buildGroups() {
        portalDefinitions.forEach((portal, index) => {
            const directions = portal.equatorialPatternPoints || portal.patternPoints;
            const points = directions.map(direction => this.galacticDirection(direction).map(value => value * 1000));
            const center = normalize(points.reduce((sum, point) => sum.map((value, axis) => value + point[axis]), [0, 0, 0]))
                .map(value => value * 1000);
            this.groups.set(portal.id, { portal, center, points, index, emphasis: 0 });
            portal.button.classList.add('map-portal');
            portal.button.innerHTML = '<span class="map-portal-number"></span><span class="map-portal-copy"><strong></strong><span></span></span>';
            portal.button.addEventListener('mouseenter', () => { this.hover = portal; });
            portal.button.addEventListener('mouseleave', () => { if (this.hover === portal) this.hover = null; });
            portal.button.addEventListener('focus', () => { this.hover = portal; });
            portal.button.addEventListener('blur', () => { if (this.hover === portal) this.hover = null; });
            portal.button.addEventListener('click', event => {
                if (this.suppressClickUntil > performance.now()) return;
                this.openPortal(portal, event.detail === 0 ? 'keyboard' : 'pointer');
            });
        });
    }

    buildStars() {
        const values = [];
        const catalog = window.HipparcosSky || { count: 0, galacticNorth: [0, 1, 0], galacticCenter: [0, 0, 1] };
        const groupHips = new Set(portalDefinitions.flatMap(portal => portal.patternHips));
        let localCount = 0;
        this.starHips = [];
        for (let index = 0; index < catalog.count; index++) {
            const hip = catalog.hips[index];
            const portalStar = groupHips.has(hip);
            const direction = Array.from(catalog.directions.subarray(index * 3, index * 3 + 3));
            const magnitude = catalog.magnitudes[index];
            const color = this.color(catalog.colorIndices[index]);
            const measurement = window.HipparcosDistances?.byHip.get(hip);
            const keepLocal = portalStar || measurement && localCount < 10500;
            if (!keepLocal && index % 3 !== 0) continue;
            const position = this.galacticDirection(direction).map(value => value * (keepLocal ? 1000 : 2200));
            const light = portalStar ? 1.7 : keepLocal ? clamp(Math.pow(10, -0.15 * (magnitude - 4.8)), 0.10, 1.15)
                : clamp(Math.pow(10, -0.17 * (magnitude - 3.6)), 0.055, 0.5);
            const size = portalStar ? clamp(19 - (magnitude || 3) * 1.4, 10, 23)
                : keepLocal ? clamp(7.8 - magnitude * 0.64, 2.3, 10) : clamp(5.5 - magnitude * 0.35, 2, 6);
            values.push(...position, ...color, light, size, keepLocal ? 0 : 1);
            this.starHips.push(hip);
            if (keepLocal) localCount++;
        }
        this.localCount = localCount;
        return new Float32Array(values);
    }

    buildEntities() {
        const m42Ra = (5 + 35 / 60 + 17.3 / 3600) * 15 * DEG;
        const m42Dec = -(5 + 23 / 60 + 28 / 3600) * DEG;
        const m42Position = this.galacticDirection([Math.sin(m42Ra) * Math.cos(m42Dec), Math.sin(m42Dec), Math.cos(m42Ra) * Math.cos(m42Dec)])
            .map(value => value * 1000);
        this.entities = [
            { id: 'm42', position: m42Position, level: 'local', names: ['Orion Nebula', '猎户座大星云', '獵戶座大星雲'], subtitles: ['M42 · Stellar nursery', 'M42 · 恒星诞生地', 'M42 · 恆星誕生地'] },
            { id: 'region', position: [112, 2, 74], level: 'galaxy', names: ['Our neighbourhood', '我们的星域', '我們的星域'], subtitles: ['Explore the constellations', '进入生活星座', '進入生活星座'] },
            { id: 'm31', position: [-420, 50, -180], level: 'galaxy', names: ['Andromeda Galaxy', '仙女座星系', '仙女座星系'], subtitles: ['M31 · Beyond the Milky Way', 'M31 · 银河之外', 'M31 · 銀河之外'] }
        ];
        const navigation = document.getElementById('mapEntities');
        this.entities.forEach(entity => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'map-entity';
            button.dataset.mapEntity = entity.id;
            button.innerHTML = entity.subtitles ? '<span></span><small></small>' : '<span></span>';
            button.addEventListener('click', () => {
                if (this.suppressClickUntil > performance.now()) return;
                if (entity.id === 'region') {
                    this.showLocal();
                } else this.openDeepSky(entity);
            });
            entity.button = button;
            navigation.append(button);
        });
    }

    drawEntities() {
        if (this.skyCredit) this.skyCredit.hidden = this.galaxyMix > 0.99;
        const languageIndex = Math.max(0, LANGUAGES.indexOf(state.currentLang));
        const occupied = [...(this.portalRects || []), ...(this.galaxyMix < 0.28 ? this.projectedPortalStars || [] : []).map(point =>
            ({ left: point.x - 12, right: point.x + 12, top: point.y - 12, bottom: point.y + 12 }))];
        for (const entity of this.entities) {
            const projected = this.project(entity.position, this.currentView, entity.level === 'galaxy');
            const levelVisible = entity.level === 'galaxy' ? this.galaxyMix > 0.72 : this.galaxyMix < 0.23;
            const visible = levelVisible && projected.visible && state.scene === 'roam' && !this.flight;
            entity.button.hidden = !visible;
            entity.button.inert = !visible;
            if (!visible) continue;
            const labelWidth = window.innerWidth < 760 ? 132 : 168;
            let labelX = clamp(projected.x, labelWidth * 0.5 + 14, window.innerWidth - labelWidth * 0.5 - 14);
            let labelY = projected.y;
            const verticalOffsets = [0, -65, 65, -108, 108, -156, 156, -220, 220, -280, 280];
            const positions = verticalOffsets.map(offset => [labelX, projected.y + offset]);
            for (const offset of [-labelWidth, labelWidth]) {
                const x = clamp(labelX + offset, labelWidth * 0.5 + 14, window.innerWidth - labelWidth * 0.5 - 14);
                positions.push(...verticalOffsets.map(offsetY => [x, projected.y + offsetY]));
            }
            for (const [x, y] of positions) {
                const candidate = { left: x - labelWidth * 0.5, right: x + labelWidth * 0.5,
                    top: y - 28, bottom: y + 52 };
                if (candidate.top < 106 || candidate.bottom > window.innerHeight - 105) continue;
                if (occupied.some(rect => candidate.left < rect.right + 8 && candidate.right > rect.left - 8
                    && candidate.top < rect.bottom + 6 && candidate.bottom > rect.top - 6)) continue;
                labelX = x;
                labelY = y;
                occupied.push(candidate);
                break;
            }
            entity.button.style.width = `${labelWidth}px`;
            entity.button.style.transform = `translate3d(${labelX}px,${labelY}px,0) translate(-50%,-35%)`;
            entity.button.querySelector('span').textContent = entity.names[languageIndex];
            const subtitle = entity.subtitles?.[languageIndex];
            if (subtitle) entity.button.querySelector('small').textContent = subtitle;
            entity.button.setAttribute('aria-label', subtitle ? `${entity.names[languageIndex]} · ${subtitle}` : entity.names[languageIndex]);
            const context = overlayContext;
            if (Math.abs(labelX - projected.x) > 2 || Math.abs(labelY - projected.y) > 2) {
                context.beginPath();
                context.moveTo(projected.x, projected.y - 12);
                context.lineTo(labelX, labelY - 12);
                context.strokeStyle = 'rgba(162,180,203,.22)';
                context.lineWidth = 0.7;
                context.stroke();
            }
            if (entity.id === 'm31') {
                context.save();
                context.translate(projected.x, projected.y - 28);
                context.rotate(-0.45);
                context.scale(1, 0.32);
                const glow = context.createRadialGradient(0, 0, 1, 0, 0, 48);
                glow.addColorStop(0, 'rgba(249,225,178,.82)');
                glow.addColorStop(0.13, 'rgba(214,200,177,.36)');
                glow.addColorStop(0.45, 'rgba(160,175,202,.13)');
                glow.addColorStop(1, 'rgba(91,108,139,0)');
                context.fillStyle = glow;
                context.fillRect(-50, -50, 100, 100);
                context.restore();
            }
        }
        const galactic = this.galaxyMix > 0.65;
        if (this.atGalaxyOverview !== galactic && state.scene === 'roam') {
            this.atGalaxyOverview = galactic;
            this.updateCopy();
        }
    }

    openDeepSky(entity) {
        this.deepReturn = this.snapshot();
        this.pendingEntity = entity.id;
        this.frozenGalaxyMix = this.galaxyMix;
        state.scene = 'flying';
        const destination = this.galaxyMix < 0.5
            ? this.skyDestination(entity.position, 32 * DEG)
            : { ...this.snapshot(), center: entity.position.slice(), distance: Math.max(150, this.distance * 0.65) };
        this.animateTo(destination, () => {
            this.pendingEntity = null;
            this.deepSky.enter(entity.id);
        });
    }

    closeDeepSky() {
        this.deepSky.exit();
        this.frozenGalaxyMix = null;
        this.animateTo(this.deepReturn || this.homePose());
        this.deepReturn = null;
        this.updateCopy();
    }

    enter() {
        state.hasEntered = true;
        if (state.scene === 'entry') state.scene = 'roam';
        state.lock = 'map-free';
        dom.body.classList.add('has-entered', 'cursor-free');
        hideEntryGate();
        syncSectionDrawerAvailability();
        return true;
    }

    localFov(distance = this.distance) {
        return clamp(2 * Math.atan(Math.tan(this.fov * 0.5) * distance / 430), 6 * DEG, 130 * DEG);
    }

    view() {
        const outward = [Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)];
        const forward = outward.map(value => -value);
        const right = normalize(cross(forward, [0, 1, 0]));
        const up = normalize(cross(right, forward));
        const galaxyFov = 2 * Math.atan(Math.tan(26 * DEG) * Math.max(1, 1.35 * window.innerHeight / window.innerWidth));
        return { position: this.center.map((value, axis) => (value + outward[axis] * this.distance) * this.galaxyMix),
            right, up, forward, fov: lerp(this.localFov(), galaxyFov, this.galaxyMix), galaxy: this.galaxyMix, observer: true };
    }

    project(position, view = this.currentView || this.view(), absolute = false) {
        if (!absolute && !view.observer) position = position.map((value, axis) => lerp(value, [112, 2, 74][axis] + value * 0.09, this.galaxyMix));
        const relative = position.map((value, axis) => value - (view.observer && !absolute ? 0 : view.position[axis]));
        const depth = dot(relative, view.forward);
        const focal = window.innerHeight * 0.5 / Math.tan(view.fov * 0.5);
        const horizontal = window.innerWidth * 0.5 + dot(relative, view.right) / depth * focal;
        const vertical = window.innerHeight * 0.5 - dot(relative, view.up) / depth * focal;
        return { x: horizontal, y: vertical, depth,
            visible: depth > 8 && horizontal > -45 && horizontal < window.innerWidth + 45 && vertical > -45 && vertical < window.innerHeight + 45 };
    }

    orbit(deltaX, deltaY) {
        if (this.deepSky?.active) return this.deepSky.orbit(deltaX, deltaY);
        if (!this.canMove()) return;
        this.lastInputTime = performance.now();
        this.target.yaw -= deltaX * 0.0042;
        this.target.pitch = clamp(this.target.pitch + deltaY * 0.0042, -STAR_MAP_LIMITS.pitch, STAR_MAP_LIMITS.pitch);
        this.yaw = this.target.yaw;
        this.pitch = this.target.pitch;
    }

    zoom(delta) {
        if (this.deepSky?.active) return this.deepSky.zoom(delta);
        if (delta < 0) this.cancelPendingGalaxy();
        if (!this.canMove()) return;
        this.lastInputTime = performance.now();
        if (this.mapLevel === 'galaxy') {
            if (delta < -0.5) this.showLocal();
            return;
        }
        const desired = this.target.distance * Math.exp(clamp(delta, -180, 180) * 0.0026);
        if (delta > 0 && desired > STAR_MAP_LIMITS.localMaxDistance * 0.85) this.renderer.loadGalacticAssets();
        if (desired > STAR_MAP_LIMITS.localMaxDistance && delta > 0) {
            this.showGalaxy();
            return;
        }
        this.target.distance = clamp(desired, STAR_MAP_LIMITS.minDistance, STAR_MAP_LIMITS.localMaxDistance);
    }

    cancelPendingGalaxy() {
        if (!this.pendingGalaxy) return false;
        this.pendingGalaxy = null;
        this.updateCopy();
        return true;
    }

    async showGalaxy() {
        if (!this.canMove() || this.mapLevel === 'galaxy' || this.pendingGalaxy) return;
        const request = {};
        this.pendingGalaxy = request;
        this.updateCopy();
        try {
            await this.renderer.loadGalacticAssets();
            if (this.pendingGalaxy !== request) return;
            if (!this.canMove() || this.mapLevel !== 'local') {
                this.cancelPendingGalaxy();
                return;
            }
            await this.renderer.prepareGalacticAssets();
            if (this.pendingGalaxy !== request) return;
            if (!this.canMove() || this.mapLevel !== 'local') {
                this.cancelPendingGalaxy();
                return;
            }
        } catch (error) {
            if (this.pendingGalaxy === request) this.cancelPendingGalaxy();
            console.warn('Galaxy preparation failed:', error);
            return;
        }
        this.pendingGalaxy = null;
        this.localReturnPose = this.snapshot();
        this.localReturnPose.distance = Math.min(this.localReturnPose.distance, this.homePose().distance);
        state.scene = 'flying';
        this.levelTransition = true;
        this.animateTo({ yaw: this.yaw, pitch: 0.7, distance: STAR_MAP_LIMITS.maxDistance, center: [0, 0, 0], galaxy: 1 }, () => {
            this.mapLevel = 'galaxy';
            this.levelTransition = false;
            state.scene = 'roam';
            this.lastInputTime = performance.now();
            this.updateCopy();
        });
        this.flight.duration = REDUCED_MOTION ? 0 : 1250;
        this.updateCopy();
    }

    showLocal() {
        if (this.cancelPendingGalaxy()) return;
        if (this.flight || state.modalOpen) return;
        state.scene = 'flying';
        this.levelTransition = true;
        this.animateTo(this.localReturnPose || this.homePose(), () => {
            this.mapLevel = 'local';
            this.levelTransition = false;
            state.scene = 'roam';
            this.updateCopy();
        });
        this.flight.duration = REDUCED_MOTION ? 0 : 1150;
        this.updateCopy();
    }

    pan(deltaX, deltaY) {
        if (this.mapLevel === 'local') return this.orbit(deltaX, deltaY);
        if (!this.canMove()) return;
        this.lastInputTime = performance.now();
        const view = this.currentView || this.view();
        const scale = this.distance * 2 * Math.tan(view.fov * 0.5) / window.innerHeight;
        const next = this.target.center.map((value, axis) => value - view.right[axis] * deltaX * scale + view.up[axis] * deltaY * scale);
        const length = vectorLength(next);
        this.target.center = length > STAR_MAP_LIMITS.panRadius ? next.map(value => value / length * STAR_MAP_LIMITS.panRadius) : next;
        this.center = this.target.center.slice();
    }

    canMove() {
        if (this.deepSky?.active) return false;
        return state.hasEntered && !state.modalOpen && !state.gateOpen && !this.flight && state.scene === 'roam';
    }

    isMapSurface(target) {
        return target instanceof Element && Boolean(target.closest(
            '#galaxyWorld, #portalNav, #starNav, #mapEntities, .deep-sky-image-viewport'
        ));
    }

    isMapKeyboardContext(event) {
        return this.isMapSurface(event.target) || this.isMapSurface(document.activeElement)
            || this.canMove() && state.scene === 'roam' && !state.modalOpen && !state.gateOpen;
    }

    snapshot() {
        return { yaw: this.yaw, pitch: this.pitch, distance: this.distance, center: this.center.slice(), galaxy: this.galaxyMix };
    }

    animateTo(destination, completion = null) {
        this.clearInput();
        destination = { ...destination, yaw: this.yaw + Math.atan2(Math.sin(destination.yaw - this.yaw), Math.cos(destination.yaw - this.yaw)) };
        this.flight = { from: this.snapshot(), to: destination, fromGalaxy: this.galaxyMix, toGalaxy: destination.galaxy ?? 0,
            started: performance.now(), duration: REDUCED_MOTION ? 0 : 850, completion };
        this.target = { ...destination, center: destination.center.slice() };
    }

    skyDestination(direction, fov) {
        const aim = normalize(direction);
        return { yaw: Math.atan2(-aim[0], -aim[2]), pitch: Math.asin(clamp(-aim[1], -1, 1)),
            distance: 430 * Math.tan(fov * 0.5) / Math.tan(this.fov * 0.5), center: [0, 0, 0], galaxy: 0 };
    }

    detailDestination(group) {
        const width = window.innerWidth, height = window.innerHeight;
        const compact = usesCompactSkyLayout();
        const safe = compact
            ? { left: 40, right: width - 40, top: 105, bottom: Math.max(185, height * 0.5 - 80) }
            : { left: 48, right: width - 28 - portalPanelWidthForViewport() - 48, top: 105, bottom: height - 65 };
        const centerX = (safe.left + safe.right) * 0.5, centerY = (safe.top + safe.bottom) * 0.5;
        let aim = normalize(group.center), fov = 43 * DEG;
        for (let iteration = 0; iteration < 18; iteration++) {
            const right = normalize(cross(aim, [0, 1, 0]));
            const up = normalize(cross(right, aim));
            const focal = height * 0.5 / Math.tan(fov * 0.5);
            const points = group.points.map(point => {
                const depth = Math.max(0.025, dot(normalize(point), aim));
                return [width * 0.5 + dot(normalize(point), right) / depth * focal,
                    height * 0.5 - dot(normalize(point), up) / depth * focal];
            });
            const bounds = [0, 1].map(axis => [Math.min(...points.map(point => point[axis])), Math.max(...points.map(point => point[axis]))]);
            const scale = Math.max((bounds[0][1] - bounds[0][0]) / Math.max(80, (safe.right - safe.left) * 0.85),
                (bounds[1][1] - bounds[1][0]) / Math.max(70, (safe.bottom - safe.top) * 0.85), 1);
            const deltaX = (bounds[0][0] + bounds[0][1]) * 0.5 - centerX;
            const deltaY = (bounds[1][0] + bounds[1][1]) * 0.5 - centerY;
            aim = normalize(aim.map((value, axis) => value + right[axis] * deltaX / focal - up[axis] * deltaY / focal));
            fov = clamp(2 * Math.atan(Math.tan(fov * 0.5) * Math.min(scale, 1.4)), 24 * DEG, 130 * DEG);
        }
        return this.skyDestination(aim, fov);
    }

    openPortal(portal, source = 'pointer', arrivalHip = null) {
        if (this.deepSky?.active) this.deepSky.exit();
        if (!portal || state.modalOpen || state.scene === 'leaving-home') return;
        this.pendingEntity = null;
        this.frozenGalaxyMix = null;
        if (!this.overview) {
            this.overview = this.snapshot();
            this.portalReturnLevel = this.mapLevel;
        }
        this.mapLevel = 'local';
        if (state.scene === 'detail') closePortalPanel(false, source);
        state.activationSource = source;
        state.scene = 'flying';
        state.portalReturnFocusTarget = source === 'drawer' ? dom.sectionDrawerToggle : portal.button;
        this.selected = portal;
        this.hover = null;
        const group = this.groups.get(portal.id);
        this.animateTo(this.detailDestination(group), () => {
            state.detailFov = this.localFov();
            openPortalPanel(portal, false, arrivalHip);
            this.updateCopy();
        });
        this.updateCopy();
    }

    returnToOverview(restoreFocus = true, source = 'pointer') {
        const portal = this.selected;
        this.selected = null;
        state.scene = 'roam';
        const destination = this.overview || this.homePose();
        this.overview = null;
        this.animateTo(destination, () => {
            this.mapLevel = this.portalReturnLevel || 'local';
            this.updateCopy();
            if (restoreFocus && source === 'keyboard') (portal?.button || dom.sectionDrawerToggle).focus({ preventScroll: true });
        });
        this.updateCopy();
    }

    cancelFlight() {
        if (this.cancelPendingGalaxy()) return true;
        if (this.pendingEntity) {
            const destination = this.deepReturn;
            this.pendingEntity = null;
            this.frozenGalaxyMix = null;
            state.scene = 'roam';
            this.animateTo(destination || this.homePose());
            this.updateCopy();
            return true;
        }
        if (this.levelTransition) {
            this.flight = null;
            this.levelTransition = false;
            state.scene = 'roam';
            const destination = this.mapLevel === 'galaxy'
                ? { yaw: this.yaw, pitch: 0.7, distance: STAR_MAP_LIMITS.maxDistance, center: [0, 0, 0], galaxy: 1 }
                : this.localReturnPose || this.homePose();
            this.animateTo(destination);
            this.updateCopy();
            return true;
        }
        this.flight = null;
        this.selected = null;
        state.scene = 'roam';
        this.mapLevel = this.overview ? this.portalReturnLevel || this.mapLevel : 'local';
        this.animateTo(this.overview || this.homePose());
        this.overview = null;
        this.updateCopy();
        return true;
    }

    homePose() {
        return { yaw: Math.PI, pitch: -0.08, distance: window.innerWidth < 760 ? 600 : 430, center: [0, 0, 0] };
    }

    reset() {
        this.cancelPendingGalaxy();
        if (this.deepSky?.active) return this.closeDeepSky();
        if (state.modalOpen || state.scene === 'leaving-home') return;
        if (state.scene === 'detail') closePortalPanel(false);
        state.scene = 'roam';
        this.selected = null;
        this.overview = null;
        this.mapLevel = 'local';
        this.levelTransition = false;
        this.pendingEntity = null;
        this.frozenGalaxyMix = null;
        this.animateTo(this.homePose());
        this.updateCopy();
    }

    handleStarAction(portal, hip) {
        if (portal.home) {
            const action = homeStarTargets[hip];
            if (action?.type === 'home') this.goHome();
            else if (action?.portalId) this.openPortal(portalDefinitions.find(item => item.id === action.portalId));
        } else {
            selectPortalStar(portal, hip);
            const measurement = window.HipparcosDistances?.byHip.get(hip);
            if (measurement) {
                const unit = state.currentLang === 'en' ? 'ly from Earth' : state.currentLang === 'zh-TW' ? '光年 · 距地球' : '光年 · 距地球';
                dom.starReaderMeta.textContent += ` · ${(measurement.parsecs * 3.26156).toFixed(0)} ${unit}`;
            }
        }
        return true;
    }

    goHome() {
        if (state.scene === 'leaving-home') return;
        this.clearInput();
        if (this.deepSky?.active) this.deepSky.exit();
        state.scene = 'leaving-home';
        if (window.StellarTransit) {
            window.StellarTransit.navigate({ to: 'index', href: 'index.html', mode: 'home', duration: REDUCED_MOTION ? 0 : 760,
                origin: { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 },
                historyDelta: canRestorePetHomepageFromHistory() ? -1 : undefined });
        } else window.location.href = 'index.html';
    }

    render(time) {
        if (!this.initialized) return;
        if (this.deepSky?.active) { this.deepSky.render(time); return; }
        const delta = Math.min(0.05, Math.max(0, (time - (this.lastFrame || time)) / 1000));
        this.lastFrame = time;
        if (this.flight) {
            const flight = this.flight;
            const progress = flight.duration ? clamp((time - flight.started) / flight.duration, 0, 1) : 1;
            const amount = easeInOutCubic(progress);
            this.yaw = lerp(flight.from.yaw, flight.to.yaw, amount);
            this.pitch = lerp(flight.from.pitch, flight.to.pitch, amount);
            this.distance = lerp(flight.from.distance, flight.to.distance, amount);
            this.center = flight.from.center.map((value, axis) => lerp(value, flight.to.center[axis], amount));
            this.galaxyMix = lerp(flight.fromGalaxy, flight.toGalaxy, smoothstep(0, 1, progress));
            if (progress >= 1) {
                this.flight = null;
                flight.completion?.();
            }
        } else {
            const response = REDUCED_MOTION ? 1 : 1 - Math.exp(-delta * 16);
            this.yaw = lerp(this.yaw, this.target.yaw, response);
            this.pitch = lerp(this.pitch, this.target.pitch, response);
            this.distance = lerp(this.distance, this.target.distance, response);
            this.center = this.center.map((value, axis) => lerp(value, this.target.center[axis], response));
        }
        if (this.frozenGalaxyMix != null) this.galaxyMix = this.frozenGalaxyMix;
        const automaticOrbit = !REDUCED_MOTION && this.galaxyMix > 0.96 && !this.flight && !this.pointers.size
            && !state.modalOpen && time - (this.lastInputTime || 0) > 4500;
        if (automaticOrbit) {
            this.target.yaw += delta * 0.014;
        }
        this.currentView = this.view();
        const poseUnsettled = (!automaticOrbit && Math.abs(this.yaw - this.target.yaw) > 0.0001)
            || Math.abs(this.pitch - this.target.pitch) > 0.0001
            || Math.abs(this.distance - this.target.distance) > 0.01
            || this.center.some((value, axis) => Math.abs(value - this.target.center[axis]) > 0.01);
        this.currentView.moving = Boolean(this.flight || this.pointers.size || poseUnsettled
            || time - (this.lastInputTime ?? -Infinity) < 150);
        const viewKey = [...this.currentView.position, this.yaw, this.pitch, this.galaxyMix, this.currentView.fov,
            this.galaxyMix < 1 ? this.renderer.skyOpacity() : 1].map(value => value.toFixed(4)).join(',')
            + this.renderer.ready + ':' + this.renderer.assetVersion + ':' + this.renderer.skyVersion + ':' + this.currentView.moving;
        if (viewKey !== this.rendererViewKey) {
            this.renderer.render(this.currentView);
            this.rendererViewKey = viewKey;
        }
        this.drawGroups(delta);
        this.drawEntities();
    }

    drawGroups(delta) {
        const context = overlayContext;
        context.setTransform(overlayDpr, 0, 0, overlayDpr, 0, 0);
        context.clearRect(0, 0, overlayWidth, overlayHeight);
        const labelRects = [];
        this.projectedPortalStars = Array.from(this.groups.values()).flatMap(group => group.points.map(point => this.project(point))).filter(point => point.visible);
        const ordered = Array.from(this.groups.values()).sort((left, right) =>
            Number(right.portal === this.hover) - Number(left.portal === this.hover)
            || this.project(right.center).y - this.project(left.center).y);
        for (const group of ordered) {
            const portal = group.portal;
            const selected = this.selected === portal;
            const emphasized = selected || this.hover === portal;
            group.emphasis = lerp(group.emphasis, emphasized ? 1 : 0, REDUCED_MOTION ? 1 : Math.min(1, delta * 10));
            const points = group.points.map(point => this.project(point));
            const dimmed = this.selected && !selected;
            const opacity = (dimmed ? 0.09 : 0.34 + group.emphasis * 0.48) * (1 - this.galaxyMix);
            context.lineWidth = 0.7 + group.emphasis * 0.4;
            context.strokeStyle = `rgba(178,197,219,${opacity})`;
            context.beginPath();
            for (const [from, to] of portal.patternEdges) {
                if (points[from].depth <= 8 || points[to].depth <= 8) continue;
                context.moveTo(points[from].x, points[from].y);
                context.lineTo(points[to].x, points[to].y);
            }
            context.stroke();
            points.forEach((point, index) => {
                const hip = portal.patternHips[index];
                if (!point.visible) {
                    const button = portal.starButtons.get(hip);
                    button.hidden = true;
                    button.inert = true;
                    return;
                }
                const active = selected && (hip === state.activeStarHip || hip === state.hoverStarHip);
                const glow = (dimmed ? 0.15 : 0.65 + group.emphasis * 0.25) * (1 - this.galaxyMix);
                drawStarGlow(context, point.x, point.y, active ? 2.1 : 1.35, glow, false);
                if (active) {
                    context.strokeStyle = 'rgba(226,219,197,.65)';
                    context.lineWidth = 0.7;
                    context.beginPath();
                    context.arc(point.x, point.y, 12, 0, Math.PI * 2);
                    context.stroke();
                }
                const button = portal.starButtons.get(hip);
                const visible = selected && state.scene === 'detail' && !state.sectionDrawerOpen;
                button.hidden = !visible;
                button.inert = !visible;
                if (visible) {
                    button.style.transform = `translate3d(${point.x}px,${point.y}px,0) translate(-50%,-50%)`;
                    portal.starButtonScreens.set(hip, point);
                }
            });
            if (!selected) portal.starButtons.forEach(button => { button.hidden = true; button.inert = true; });
            const center = this.project(group.center);
            portal.screen = center;
            const visiblePoints = points.filter(point => point.visible);
            const labelRect = this.placePortalLabel(center, visiblePoints, labelRects);
            const visible = this.galaxyMix < 0.28 && state.scene === 'roam' && !this.flight && Boolean(labelRect);
            portal.button.hidden = !visible;
            portal.button.inert = !visible;
            portal.buttonVisible = visible;
            if (visible) {
                labelRects.push(labelRect);
                portal.button.style.transform = `translate3d(${(labelRect.left + labelRect.right) * 0.5}px,${labelRect.top}px,0) translateX(-50%)`;
                portal.button.classList.toggle('is-highlighted', emphasized);
            }
        }
        this.portalRects = labelRects;
    }

    placePortalLabel(center, points, occupied) {
        if (!points.length || center.depth <= 8) return null;
        const width = window.innerWidth < 760 ? 112 : 154, height = 44;
        const top = Math.min(...points.map(point => point.y));
        const bottom = Math.max(...points.map(point => point.y));
        const left = Math.min(...points.map(point => point.x));
        const right = Math.max(...points.map(point => point.x));
        const x = clamp(center.x, width * 0.5 + 14, overlayWidth - width * 0.5 - 14);
        // Try the familiar below-star position, then above and beside the figure.
        // A constellation near the footer must not lose its name altogether.
        const candidates = [[x, bottom + 16], [x, top - height - 16],
            [right + width * 0.5 + 16, center.y - height * 0.5],
            [left - width * 0.5 - 16, center.y - height * 0.5],
            [x, bottom + 16 + height + 10], [x, top - height * 2 - 26]];
        for (const [labelX, labelY] of candidates) {
            const rect = { left: labelX - width * 0.5, right: labelX + width * 0.5, top: labelY, bottom: labelY + height };
            if (rect.left < 12 || rect.right > overlayWidth - 12 || rect.top < 110 || rect.bottom > overlayHeight - (window.innerWidth < 760 ? 110 : 60)) continue;
            if (occupied.some(other => rect.left < other.right + 8 && rect.right > other.left - 8
                && rect.top < other.bottom + 8 && rect.bottom > other.top - 8)) continue;
            if (this.projectedPortalStars.some(point => point.x > rect.left - 10 && point.x < rect.right + 10
                && point.y > rect.top - 10 && point.y < rect.bottom + 10)) continue;
            return rect;
        }
        return null;
    }

    portalStarAt(x, y, touch = false) {
        if (!this.canMove() || this.galaxyMix >= 0.28 || state.sectionDrawerOpen) return null;
        let nearest = null, distance = touch ? 26 : 16;
        for (const group of this.groups.values()) {
            group.points.forEach((position, index) => {
                const point = this.project(position);
                if (!point.visible) return;
                const separation = Math.hypot(point.x - x, point.y - y);
                if (separation >= distance) return;
                distance = separation;
                nearest = { portal: group.portal, hip: group.portal.patternHips[index] };
            });
        }
        return nearest;
    }

    clearInput() {
        this.cancelPendingGalaxy();
        for (const pointerId of this.pointers.keys()) {
            if (dom.world.hasPointerCapture?.(pointerId)) dom.world.releasePointerCapture(pointerId);
        }
        this.pointers.clear();
        this.gesture = null;
        this.wheelOrbitUntil = 0;
        dom.body.classList.remove('map-dragging');
        dom.world.classList.remove('map-star-hover');
        state.rightDown = false;
    }

    resize() {
        this.rendererViewKey = null;
        this.fov = (window.innerWidth / window.innerHeight < 0.85 ? 78 : 52) * DEG;
        if (this.deepSky?.active) this.deepSky.resize();
        resizeOverlay();
        this.renderer?.resize();
        if (this.selected && state.scene === 'detail') {
            const destination = this.detailDestination(this.groups.get(this.selected.id));
            this.target = destination;
            this.center = destination.center.slice();
            this.distance = destination.distance;
            this.yaw = destination.yaw;
            this.pitch = destination.pitch;
        } else if (!this.lastFrame) {
            this.target = this.homePose();
            this.distance = this.target.distance;
        }
        resizeMaps();
    }

    handleWheel(event) {
        if (!this.canMove()) return;
        event.preventDefault();
        if (!event.deltaX && !event.deltaY) return;
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1;
        if (event.ctrlKey || event.metaKey) {
            this.wheelOrbitUntil = 0;
            this.zoom(event.deltaY * unit);
            return;
        }
        const now = performance.now();
        const continuous = event.deltaMode === 0 && (now < this.wheelOrbitUntil || event.deltaX !== 0
            || Math.abs(event.deltaY) < 50 || !Number.isInteger(event.deltaY));
        if (continuous) {
            this.wheelOrbitUntil = now + 200;
            this.orbit(event.deltaX, event.deltaY);
        } else {
            this.wheelOrbitUntil = 0;
            this.zoom(event.deltaY * unit);
        }
    }

    bindInputs() {
        dom.world.addEventListener('contextmenu', event => event.preventDefault());
        dom.portalNav.addEventListener('contextmenu', event => event.preventDefault());
        dom.starNav.addEventListener('contextmenu', event => event.preventDefault());
        document.addEventListener('wheel', event => {
            if (!this.isMapSurface(event.target)) return;
            if (event.ctrlKey || event.metaKey) event.preventDefault();
        }, { capture: true, passive: false });
        const pointerDown = event => {
            if (!this.canMove() || (event.pointerType === 'mouse' && ![0, 1, 2].includes(event.button))) return;
            if (event.pointerType === 'mouse' && event.currentTarget !== dom.world && event.button !== 2 && event.button !== 1) return;
            event.preventDefault();
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType, button: event.button,
                moved: 0, tapTarget: event.target.closest?.('[data-portal-button], [data-map-entity]'),
                starTarget: event.currentTarget === dom.world ? this.portalStarAt(event.clientX, event.clientY, event.pointerType !== 'mouse') : null,
                multiple: false });
            if (this.pointers.size > 1) this.pointers.forEach(pointer => { pointer.multiple = true; });
            this.gesture = null;
            this.dragDistance = 0;
            dom.world.setPointerCapture(event.pointerId);
            dom.body.classList.add('map-dragging');
        };
        dom.world.addEventListener('pointerdown', pointerDown);
        dom.portalNav.addEventListener('pointerdown', pointerDown);
        document.getElementById('mapEntities').addEventListener('pointerdown', pointerDown);
        dom.world.addEventListener('pointermove', event => {
            const pointer = this.pointers.get(event.pointerId);
            if (!pointer) {
                if (event.pointerType === 'mouse') {
                    this.hover = this.portalStarAt(event.clientX, event.clientY)?.portal || null;
                    dom.world.classList.toggle('map-star-hover', Boolean(this.hover));
                }
                return;
            }
            const deltaX = event.clientX - pointer.x;
            const deltaY = event.clientY - pointer.y;
            this.dragDistance += Math.hypot(deltaX, deltaY);
            pointer.moved += Math.hypot(deltaX, deltaY);
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            const pointers = Array.from(this.pointers.values());
            if (pointers.length >= 2) {
                const [first, second] = pointers;
                const gesture = { distance: Math.hypot(first.x - second.x, first.y - second.y), x: (first.x + second.x) * 0.5, y: (first.y + second.y) * 0.5 };
                if (this.gesture) {
                    this.zoom(Math.log(Math.max(1, this.gesture.distance) / Math.max(1, gesture.distance)) / 0.0026);
                    this.pan(gesture.x - this.gesture.x, gesture.y - this.gesture.y);
                }
                this.gesture = gesture;
            } else if (pointer.type !== 'mouse' || pointer.button === 2 && !event.shiftKey) this.orbit(deltaX, deltaY);
            else this.pan(deltaX, deltaY);
        });
        const release = event => {
            const pointer = this.pointers.get(event.pointerId);
            const tap = event.type === 'pointerup' && pointer && !pointer.multiple && pointer.moved < 8
                && (pointer.type !== 'mouse' || pointer.button === 0);
            const tapTarget = tap && pointer.type !== 'mouse' ? pointer.tapTarget : null;
            const starTarget = tap && !pointer.tapTarget ? pointer.starTarget : null;
            if (this.dragDistance > 5) this.suppressClickUntil = performance.now() + 250;
            this.pointers.delete(event.pointerId);
            this.gesture = null;
            if (!this.pointers.size) dom.body.classList.remove('map-dragging');
            if (tapTarget) {
                this.suppressClickUntil = 0;
                tapTarget.click();
                this.suppressClickUntil = performance.now() + 300;
            } else if (starTarget && this.canMove()) {
                this.openPortal(starTarget.portal, 'pointer', starTarget.hip);
                this.suppressClickUntil = performance.now() + 300;
            }
        };
        dom.world.addEventListener('pointerleave', () => {
            if (!this.pointers.size) { this.hover = null; dom.world.classList.remove('map-star-hover'); }
        });
        dom.world.addEventListener('pointerup', release);
        dom.world.addEventListener('pointercancel', release);
        dom.world.addEventListener('lostpointercapture', release);
        const wheel = event => this.handleWheel(event);
        dom.world.addEventListener('wheel', wheel, { passive: false });
        dom.portalNav.addEventListener('wheel', wheel, { passive: false });
        document.getElementById('mapEntities').addEventListener('wheel', wheel, { passive: false });
        dom.sectionDrawerToggle.addEventListener('click', event => {
            this.clearInput();
            const source = event.detail === 0 ? 'keyboard' : 'pointer';
            if (state.sectionDrawerOpen) closeSectionDrawer({ interactionSource: source });
            else openSectionDrawer(source);
        });
        dom.sectionDrawerClose.addEventListener('click', () => closeSectionDrawer({ interactionSource: 'keyboard' }));
        dom.sectionDrawerScrim.addEventListener('click', () => closeSectionDrawer());
        dom.sectionDrawerHome.addEventListener('click', event => navigateHomeFromSectionDrawer(event.detail === 0 ? 'keyboard' : 'pointer'));
        dom.panelClose.addEventListener('click', event => closePortalPanel(true, event.detail === 0 ? 'keyboard' : 'pointer'));
        dom.homeRouteLaunch.addEventListener('click', () => this.goHome());
        dom.homeRouteCancel.addEventListener('click', () => closePortalPanel(true));
        document.addEventListener('keydown', event => {
            if (dom.lightbox.classList.contains('active')) {
                if (event.key === 'Escape') { event.preventDefault(); closeLightbox(); }
                return;
            }
            if (this.deepSky?.active && event.key === 'Escape') { event.preventDefault(); this.closeDeepSky(); return; }
            if (state.sectionDrawerOpen) {
                if (event.key === 'Escape') { event.preventDefault(); closeSectionDrawer({ interactionSource: 'keyboard' }); }
                else trapSectionDrawerFocus(event);
                return;
            }
            const browserZoomKey = event.key === '+' || event.key === '=' || event.key === '-';
            if ((event.ctrlKey || event.metaKey) && browserZoomKey && this.isMapSurface(event.target)) {
                event.preventDefault();
                if (!this.canMove()) return;
            }
            if (event.key === 'Escape') {
                this.clearInput();
                if (this.flight) this.cancelFlight();
                else if (state.scene === 'detail') closePortalPanel(true, 'keyboard');
                return;
            }
            if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
            if ((event.ctrlKey || event.metaKey) && !this.isMapKeyboardContext(event)) return;
            if (!this.canMove()) return;
            const movements = { ArrowLeft: [-14, 0], ArrowRight: [14, 0], ArrowUp: [0, -14], ArrowDown: [0, 14] };
            if (movements[event.key]) {
                event.preventDefault();
                if (event.shiftKey) this.pan(...movements[event.key]);
                else this.orbit(...movements[event.key]);
            } else if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoom(-65); }
            else if (event.key === '-') { event.preventDefault(); this.zoom(65); }
            else if (event.key.toLowerCase() === 'r' || event.key === 'Home') { event.preventDefault(); this.reset(); }
        });
        window.addEventListener('blur', () => this.clearInput());
        document.addEventListener('visibilitychange', () => {
            this.clearInput();
            if (document.hidden) stopRendering();
            else { this.lastFrame = 0; startRendering(); }
        });
        window.addEventListener('resize', () => this.resize());
    }

    updateCopy() {
        if (!this.initialized) return;
        const observatoryCopy = {
            en: ['SKY FROM THE SOLAR SYSTEM', '← Return to the star map'],
            'zh-CN': ['太阳系位置观景', '← 返回三维星图'],
            'zh-TW': ['太陽系位置觀景', '← 返回三維星圖']
        }[state.currentLang] || ['SKY FROM THE SOLAR SYSTEM', '← Return to the star map'];
        document.getElementById('observatoryReturn').textContent = observatoryCopy[1];
        if (this.deepSky?.active) { this.deepSky.updateCopy(); return; }
        const copies = {
            en: { orbit: 'Right drag / Two-finger slide · orbit', pan: 'Left drag · pan', zoom: 'Mouse wheel / Pinch · zoom', touch: 'Drag · orbit / Pinch · approach', select: 'Choose a constellation', reset: 'Reset view', home: 'Return home', closer: 'Move closer', farther: 'Move farther', overview: 'LOCAL STAR MAP', detail: 'CONSTELLATION', flight: 'APPROACHING', note: 'The local sky follows Hipparcos directions and stellar colours, surrounded by ESO/S. Brunier’s photographic Milky Way panorama, reprojected and exposure-adjusted. The external galaxy adapts ESA’s 2025 Gaia-based artist impression, with an illustrative volumetric bulge and dust.', scale: 'NEAR / FAR' },
            'zh-CN': { orbit: '右键拖动 / 触控板双指滑动 · 旋转', pan: '左键拖动 · 平移', zoom: '滚轮 / 双指捏合 · 缩放', touch: '单指旋转 / 双指缩放与平移', select: '选择一个星座', reset: '回到全景', home: '返回主页', closer: '拉近星图', farther: '拉远星图', overview: '局部星图', detail: '星座', flight: '正在靠近', note: '局部星空按 Hipparcos 星表方向与恒星颜色绘制，背景采用 ESO/S. Brunier 的真实银河全天摄影，经过重投影与曝光调整。银河外观改编自 ESA 2025 年基于 Gaia 观测的艺术重建，核球和尘埃厚度为示意。', scale: '近 / 远' },
            'zh-TW': { orbit: '右鍵拖動 / 觸控板雙指滑動 · 旋轉', pan: '左鍵拖動 · 平移', zoom: '滾輪 / 雙指捏合 · 縮放', touch: '單指旋轉 / 雙指縮放與平移', select: '選擇一個星座', reset: '回到全景', home: '返回主頁', closer: '拉近星圖', farther: '拉遠星圖', overview: '局部星圖', detail: '星座', flight: '正在靠近', note: '局部星空按 Hipparcos 星表方向與恆星顏色繪製，背景採用 ESO/S. Brunier 的真實銀河全天攝影，經過重投影與曝光調整。銀河外觀改編自 ESA 2025 年基於 Gaia 觀測的藝術重建，核球和塵埃厚度為示意。', scale: '近 / 遠' }
        };
        const copy = copies[state.currentLang] || copies.en;
        copy.overview = observatoryCopy[0];
        if (this.mapLevel === 'local') {
            copy.orbit = { en: 'Drag / Two-finger slide · look around', 'zh-CN': '拖动 / 触控板双指滑动 · 环顾', 'zh-TW': '拖動 / 觸控板雙指滑動 · 環顧' }[state.currentLang] || 'Drag · look around';
            copy.pan = '';
            copy.touch = { en: 'Drag · look around / Pinch · zoom', 'zh-CN': '单指环顾 / 双指缩放', 'zh-TW': '單指環顧 / 雙指縮放' }[state.currentLang] || 'Drag / Pinch · zoom';
        }
        document.querySelectorAll('[data-map-copy]').forEach(element => { element.textContent = copy[element.dataset.mapCopy] || ''; });
        document.getElementById('mapInputHint').textContent = COARSE_POINTER ? copy.touch : [copy.orbit, copy.pan, copy.zoom].filter(Boolean).join('     ');
        const preparing = { en: 'Preparing galaxy', 'zh-CN': '正在准备银河', 'zh-TW': '正在準備銀河' };
        dom.status.textContent = this.pendingGalaxy ? preparing[state.currentLang] || preparing.en
            : state.scene === 'detail' ? `${copy.detail} / ${portalName(this.selected, state.currentLang)}` : state.scene === 'flying' ? copy.flight : copy.overview;
        for (const group of this.groups.values()) {
            const button = group.portal.button;
            button.querySelector('.map-portal-number').textContent = String(group.index + 1).padStart(2, '0');
            button.querySelector('strong').textContent = portalName(group.portal, state.currentLang);
            button.querySelector('.map-portal-copy > span').textContent = localized(constellationStories[group.portal.id]?.name);
        }
        dom.world.setAttribute('aria-label', `${copy.overview}. ${copy.orbit}. ${copy.zoom}.`);
        if (this.atGalaxyOverview && state.scene === 'roam' && !this.flight) {
            const languageIndex = Math.max(0, LANGUAGES.indexOf(state.currentLang));
            dom.status.textContent = ['GALACTIC OVERVIEW', '银河全景', '銀河全景'][languageIndex];
        }
    }
}

window.lifeStarMap = new LifeStarMap();
