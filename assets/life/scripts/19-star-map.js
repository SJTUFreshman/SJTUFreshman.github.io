const STAR_MAP_LIMITS = Object.freeze({ minDistance: 72, localMaxDistance: 610, maxDistance: 1250, panRadius: 155, pitch: Math.PI * 0.475 });

class LifeStarMap {
    constructor() {
        this.initialized = false;
        this.yaw = 0;
        this.pitch = 0.48;
        this.distance = 430;
        this.center = [0, 0, 0];
        this.target = { yaw: this.yaw, pitch: this.pitch, distance: this.distance, center: this.center.slice() };
        this.fov = 52 * DEG;
        this.pointers = new Map();
        this.groups = new Map();
        this.flight = null;
        this.lastFrame = 0;
        this.hover = null;
        this.overview = null;
        this.selected = null;
        this.galaxyMix = 0;
        this.mapLevel = 'local';
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
        this.solarSystem = new SolarSystemMap(this);
        this.deepSky = new DeepSkyMap(this);
        this.buildEntities();
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

    buildGroups() {
        const placements = {
            gallery: [-122, 48, 5], footprints: [-123, -64, 28], shelf: [102, 63, -8],
            thoughts: [54, -57, 24], friends: [-176, -4, -42], news: [160, -15, -40],
            publications: [-20, 101, -20], projects: [140, -94, 15], notes: [-24, -116, 16], home: [5, 8, -15]
        };
        portalDefinitions.forEach((portal, index) => {
            const directions = portal.equatorialPatternPoints || portal.patternPoints;
            const normal = normalize(directions.reduce((sum, point) => sum.map((value, axis) => value + point[axis]), [0, 0, 0]));
            const local = tangentBasis(normal);
            const flat = directions.map(direction => [dot(direction, local.tangent), dot(direction, local.bitangent)]);
            const bounds = [0, 1].map(axis => [Math.min(...flat.map(point => point[axis])), Math.max(...flat.map(point => point[axis]))]);
            const span = Math.max(bounds[0][1] - bounds[0][0], bounds[1][1] - bounds[1][0], 0.01);
            const placement = placements[portal.id];
            const center = [placement[0], placement[1] * 0.887 + placement[2] * 0.462, -placement[1] * 0.462 + placement[2] * 0.887];
            const size = portal.home ? 27 : 35;
            const points = flat.map((point, pointIndex) => {
                const horizontal = (point[0] - (bounds[0][0] + bounds[0][1]) * 0.5) / span * size;
                const vertical = (point[1] - (bounds[1][0] + bounds[1][1]) * 0.5) / span * size;
                const measurement = window.HipparcosDistances?.byHip.get(portal.patternHips[pointIndex]);
                const depth = measurement ? clamp(Math.log1p(measurement.parsecs / 35) * 2.0 - 2.4, -3, 4) : 0;
                return [center[0] + horizontal, center[1] + vertical * 0.887 + depth * 0.462,
                    center[2] - vertical * 0.462 + depth * 0.887];
            });
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
        const galacticUp = catalog.galacticNorth;
        const galacticForward = catalog.galacticCenter;
        const galacticRight = normalize(cross(galacticUp, galacticForward));
        let localCount = 0;
        for (let index = 0; index < catalog.count; index++) {
            const hip = catalog.hips[index];
            if (groupHips.has(hip)) continue;
            const direction = Array.from(catalog.directions.subarray(index * 3, index * 3 + 3));
            const magnitude = catalog.magnitudes[index];
            const color = this.color(catalog.colorIndices[index]);
            const measurement = window.HipparcosDistances?.byHip.get(hip);
            const keepLocal = measurement && localCount < 10500;
            if (!keepLocal && index % 3 !== 0) continue;
            const radius = keepLocal
                ? 24 + 164 * Math.log1p(measurement.parsecs / 18) / Math.log1p(550 / 18)
                : 2200;
            const position = [dot(direction, galacticRight) * radius, dot(direction, galacticUp) * radius, dot(direction, galacticForward) * radius];
            const light = keepLocal ? clamp(Math.pow(10, -0.15 * (magnitude - 4.8)), 0.10, 1.15) : clamp(Math.pow(10, -0.17 * (magnitude - 3.6)), 0.055, 0.5);
            const size = keepLocal ? clamp(7.8 - magnitude * 0.64, 2.3, 10) : clamp(5.5 - magnitude * 0.35, 2, 6);
            values.push(...position, ...color, light, size, keepLocal ? 0 : 1);
            if (keepLocal) localCount++;
        }
        this.localCount = localCount;
        for (const group of this.groups.values()) {
            group.points.forEach((point, index) => {
                const valuesAtStar = starCatalogValues(group.portal.patternHips[index]);
                values.push(...point, ...this.color(valuesAtStar.colorIndex), 1.7, clamp(19 - (valuesAtStar.magnitude || 3) * 1.4, 10, 23), 0);
            });
        }
        let seed = 81927;
        const random = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return seed / 4294967296;
        };
        for (let index = 0; index < 27000; index++) {
            const bulge = index < 4500;
            const radius = bulge ? Math.sqrt(-2 * Math.log(Math.max(0.0001, random()))) * 22
                : Math.min(430, 12 - Math.log(Math.max(0.00001, random() * random())) * 67);
            const arm = Math.floor(random() * 4) * Math.PI * 0.5;
            const angle = bulge || random() < 0.28 ? random() * Math.PI * 2
                : arm + Math.log1p(radius / 32) * 1.8 + (random() + random() + random() - 1.5) * (0.35 + radius * 0.0012);
            const height = (random() + random() + random() - 1.5) * (bulge ? 22 : 10);
            const color = bulge ? [1, 0.85 + random() * 0.09, 0.66] : this.color(random() * 1.3 - 0.15);
            values.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius, ...color,
                0.08 + Math.pow(random(), 4) * 0.48, 2.5 + random() * 3.5, 2);
        }
        return new Float32Array(values);
    }

    buildEntities() {
        this.entities = [
            { id: 'solar', position: [-47, 10, 6], level: 'local', names: ['Solar System', '太阳系', '太陽系'] },
            { id: 'm42', position: [-167, 25, 37], level: 'local', names: ['Orion Nebula', '猎户座大星云', '獵戶座大星雲'], subtitles: ['M42 · Stellar nursery', 'M42 · 恒星诞生地', 'M42 · 恆星誕生地'] },
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
                } else if (entity.id === 'solar') {
                    this.systemReturn = this.snapshot();
                    this.pendingEntity = entity.id;
                    state.scene = 'flying';
                    this.animateTo({ ...this.snapshot(), center: entity.position.slice(), distance: 150 }, () => {
                        this.pendingEntity = null;
                        this.solarSystem.enter();
                    });
                } else this.openDeepSky(entity);
            });
            entity.button = button;
            navigation.append(button);
        });
    }

    drawEntities() {
        const languageIndex = Math.max(0, LANGUAGES.indexOf(state.currentLang));
        const occupied = [...(this.portalRects || [])];
        for (const entity of this.entities) {
            const projected = this.project(entity.position, this.currentView, entity.level === 'galaxy');
            const levelVisible = entity.level === 'galaxy' ? this.galaxyMix > 0.72 : this.galaxyMix < 0.23;
            const visible = levelVisible && projected.visible && state.scene === 'roam' && !this.flight;
            entity.button.hidden = !visible;
            entity.button.inert = !visible;
            if (!visible) continue;
            const labelWidth = window.innerWidth < 760 ? 132 : 168;
            const labelX = clamp(projected.x, labelWidth * 0.5 + 14, window.innerWidth - labelWidth * 0.5 - 14);
            let labelY = projected.y;
            for (const offset of [0, -65, 65, -108, 108]) {
                const candidate = { left: labelX - labelWidth * 0.5, right: labelX + labelWidth * 0.5,
                    top: projected.y + offset - 22, bottom: projected.y + offset + 48 };
                if (candidate.top < 106 || candidate.bottom > window.innerHeight - 105) continue;
                if (occupied.some(rect => candidate.left < rect.right + 8 && candidate.right > rect.left - 8
                    && candidate.top < rect.bottom + 6 && candidate.bottom > rect.top - 6)) continue;
                labelY = projected.y + offset;
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
            } else if (entity.id === 'solar') {
                drawStarGlow(context, projected.x, projected.y - 12, 2.6, 0.9, true);
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
        this.animateTo({ ...this.snapshot(), center: entity.position.slice(), distance: Math.max(150, this.distance * 0.65) }, () => {
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

    view() {
        const outward = [Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)];
        const forward = outward.map(value => -value);
        const right = normalize(cross(forward, [0, 1, 0]));
        const up = normalize(cross(right, forward));
        return { position: this.center.map((value, axis) => value + outward[axis] * this.distance),
            right, up, forward, fov: this.fov, galaxy: this.galaxyMix };
    }

    project(position, view = this.currentView || this.view(), absolute = false) {
        if (!absolute) position = position.map((value, axis) => lerp(value, [112, 2, 74][axis] + value * 0.09, this.galaxyMix));
        const relative = position.map((value, axis) => value - view.position[axis]);
        const depth = dot(relative, view.forward);
        const focal = window.innerHeight * 0.5 / Math.tan(this.fov * 0.5);
        const horizontal = window.innerWidth * 0.5 + dot(relative, view.right) / depth * focal;
        const vertical = window.innerHeight * 0.5 - dot(relative, view.up) / depth * focal;
        return { x: horizontal, y: vertical, depth,
            visible: depth > 8 && horizontal > -45 && horizontal < window.innerWidth + 45 && vertical > -45 && vertical < window.innerHeight + 45 };
    }

    orbit(deltaX, deltaY) {
        if (this.solarSystem?.active) return this.solarSystem.orbit(deltaX, deltaY);
        if (this.deepSky?.active) return this.deepSky.orbit(deltaX, deltaY);
        if (!this.canMove()) return;
        this.lastInputTime = performance.now();
        this.target.yaw -= deltaX * 0.0042;
        this.target.pitch = clamp(this.target.pitch + deltaY * 0.0042, -STAR_MAP_LIMITS.pitch, STAR_MAP_LIMITS.pitch);
    }

    zoom(delta) {
        if (this.solarSystem?.active) return this.solarSystem.zoom(delta);
        if (this.deepSky?.active) return this.deepSky.zoom(delta);
        if (!this.canMove()) return;
        this.lastInputTime = performance.now();
        if (this.mapLevel === 'galaxy') {
            if (delta < -0.5) this.showLocal();
            return;
        }
        const desired = this.target.distance * Math.exp(clamp(delta, -180, 180) * 0.0026);
        if (desired > STAR_MAP_LIMITS.localMaxDistance && delta > 0) {
            this.showGalaxy();
            return;
        }
        this.target.distance = clamp(desired, STAR_MAP_LIMITS.minDistance, STAR_MAP_LIMITS.localMaxDistance);
    }

    showGalaxy() {
        if (!this.canMove() || this.mapLevel === 'galaxy') return;
        this.localReturnPose = this.snapshot();
        this.localReturnPose.distance = Math.min(this.localReturnPose.distance, this.homePose().distance);
        state.scene = 'flying';
        this.levelTransition = true;
        this.animateTo({ yaw: this.yaw, pitch: 0.6, distance: STAR_MAP_LIMITS.maxDistance, center: [0, 0, 0] }, () => {
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
        if (this.solarSystem?.active) return this.solarSystem.orbit(deltaX, deltaY);
        if (!this.canMove()) return;
        this.lastInputTime = performance.now();
        const view = this.currentView || this.view();
        const scale = this.distance * 2 * Math.tan(this.fov * 0.5) / window.innerHeight;
        const next = this.target.center.map((value, axis) => value - view.right[axis] * deltaX * scale + view.up[axis] * deltaY * scale);
        const length = vectorLength(next);
        this.target.center = length > STAR_MAP_LIMITS.panRadius ? next.map(value => value / length * STAR_MAP_LIMITS.panRadius) : next;
    }

    canMove() {
        if (this.solarSystem?.active) return this.solarSystem.canMove();
        if (this.deepSky?.active) return false;
        return state.hasEntered && !state.modalOpen && !state.gateOpen && !this.flight && state.scene === 'roam';
    }

    isMapSurface(target) {
        return target instanceof Element && Boolean(target.closest(
            '#galaxyWorld, #portalNav, #starNav, #mapEntities, .solar-map-points, .solar-map-picker, .solar-map-header, .solar-map-footer, .baked-celestial-view, .deep-sky-image-viewport'
        ));
    }

    isMapKeyboardContext(event) {
        return this.isMapSurface(event.target) || this.isMapSurface(document.activeElement)
            || this.canMove() && state.scene === 'roam' && !state.modalOpen && !state.gateOpen;
    }

    snapshot() {
        return { yaw: this.yaw, pitch: this.pitch, distance: this.distance, center: this.center.slice() };
    }

    animateTo(destination, completion = null) {
        this.clearInput();
        this.flight = { from: this.snapshot(), to: destination, started: performance.now(), duration: REDUCED_MOTION ? 0 : 850, completion };
        this.target = { ...destination, center: destination.center.slice() };
    }

    detailDestination(group) {
        const compact = usesCompactSkyLayout();
        const distance = compact ? 119 : 130;
        const aspect = window.innerWidth / window.innerHeight;
        const up = [0, Math.cos(0.48), -Math.sin(0.48)];
        const offsetX = compact ? 0 : distance * Math.tan(this.fov * 0.5) * aspect * 0.48;
        const offsetY = compact ? -distance * Math.tan(this.fov * 0.5) * 0.51 : 0;
        return { yaw: 0, pitch: 0.48, distance,
            center: group.center.map((value, axis) => value + (axis === 0 ? offsetX : 0) + up[axis] * offsetY) };
    }

    openPortal(portal, source = 'pointer', arrivalHip = null) {
        if (this.solarSystem?.active) this.solarSystem.exit(false);
        if (this.deepSky?.active) this.deepSky.exit();
        if (!portal || state.modalOpen || state.scene === 'leaving-home') return;
        if (!this.overview) this.overview = this.snapshot();
        this.portalReturnLevel = this.mapLevel;
        this.mapLevel = 'local';
        if (state.scene === 'detail') closePortalPanel(false, source);
        state.activationSource = source;
        state.scene = 'flying';
        state.portalReturnFocusTarget = source === 'drawer' ? dom.sectionDrawerToggle : portal.button;
        this.selected = portal;
        this.hover = null;
        const group = this.groups.get(portal.id);
        this.animateTo(this.detailDestination(group), () => {
            state.detailFov = this.fov;
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
        if (this.pendingEntity) {
            const destination = this.pendingEntity === 'solar' ? this.systemReturn : this.deepReturn;
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
                ? { yaw: this.yaw, pitch: 0.6, distance: STAR_MAP_LIMITS.maxDistance, center: [0, 0, 0] }
                : this.localReturnPose || this.homePose();
            this.animateTo(destination);
            this.updateCopy();
            return true;
        }
        this.flight = null;
        this.selected = null;
        state.scene = 'roam';
        this.animateTo(this.overview || this.homePose());
        this.overview = null;
        this.updateCopy();
        return true;
    }

    homePose() {
        return { yaw: 0, pitch: 0.48, distance: window.innerWidth < 760 ? 600 : 430, center: [0, 0, 0] };
    }

    reset() {
        if (this.solarSystem?.active) return this.solarSystem.reset?.() || this.solarSystem.exit();
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
        if (this.solarSystem?.active) this.solarSystem.exit(false);
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
        if (this.solarSystem?.active) { this.solarSystem.render(time); return; }
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
        this.galaxyMix = this.frozenGalaxyMix ?? smoothstep(560, 1050, this.distance);
        if (!REDUCED_MOTION && this.galaxyMix > 0.96 && !this.flight && !this.pointers.size
            && !state.modalOpen && time - (this.lastInputTime || 0) > 4500) {
            this.target.yaw += delta * 0.014;
        }
        this.currentView = this.view();
        const viewKey = [...this.currentView.position, this.yaw, this.pitch, this.galaxyMix].map(value => value.toFixed(4)).join(',') + this.renderer.ready;
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
        const ordered = Array.from(this.groups.values()).sort((left, right) => Number(right.portal === this.hover) - Number(left.portal === this.hover));
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
                if (!point.visible) return;
                const hip = portal.patternHips[index];
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
            const labelX = center.x;
            const labelY = visiblePoints.length ? Math.max(...visiblePoints.map(point => point.y)) + 16 : center.y + 20;
            const labelWidth = window.innerWidth < 760 ? 112 : 154;
            const labelRect = { left: labelX - labelWidth * 0.5, right: labelX + labelWidth * 0.5, top: labelY, bottom: labelY + 43 };
            const collides = labelRects.some(rect => labelRect.left < rect.right + 8 && labelRect.right > rect.left - 8 && labelRect.top < rect.bottom + 8 && labelRect.bottom > rect.top - 8);
            const visible = this.galaxyMix < 0.28 && state.scene === 'roam' && !this.flight && center.visible && !collides
                && labelRect.left > 12 && labelRect.right < overlayWidth - 12 && labelY > 98 && labelRect.bottom < overlayHeight - 95;
            portal.button.hidden = !visible;
            portal.button.inert = !visible;
            portal.buttonVisible = visible;
            if (visible) {
                labelRects.push(labelRect);
                portal.button.style.transform = `translate3d(${labelX}px,${labelY}px,0) translateX(-50%)`;
                portal.button.classList.toggle('is-highlighted', emphasized);
            }
        }
        this.portalRects = labelRects;
    }

    clearInput() {
        this.solarSystem?.clearInput();
        for (const pointerId of this.pointers.keys()) {
            if (dom.world.hasPointerCapture?.(pointerId)) dom.world.releasePointerCapture(pointerId);
        }
        this.pointers.clear();
        this.gesture = null;
        dom.body.classList.remove('map-dragging');
        state.rightDown = false;
    }

    resize() {
        this.rendererViewKey = null;
        this.fov = (window.innerWidth / window.innerHeight < 0.85 ? 78 : 52) * DEG;
        if (this.solarSystem?.active) this.solarSystem.resize();
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
                moved: 0, tapTarget: event.target.closest?.('[data-portal-button], [data-map-entity]'), multiple: false });
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
            if (!pointer) return;
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
            const tapTarget = event.type === 'pointerup' && pointer?.type !== 'mouse' && !pointer?.multiple
                && pointer?.moved < 8 ? pointer.tapTarget : null;
            if (this.dragDistance > 5) this.suppressClickUntil = performance.now() + 250;
            this.pointers.delete(event.pointerId);
            this.gesture = null;
            if (!this.pointers.size) dom.body.classList.remove('map-dragging');
            if (tapTarget) {
                this.suppressClickUntil = 0;
                tapTarget.click();
                this.suppressClickUntil = performance.now() + 300;
            }
        };
        dom.world.addEventListener('pointerup', release);
        dom.world.addEventListener('pointercancel', release);
        dom.world.addEventListener('lostpointercapture', release);
        const wheel = event => {
            if (!this.canMove()) return;
            event.preventDefault();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
            this.zoom(delta);
        };
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
            if (this.solarSystem?.active && this.solarSystem.handleKey(event)) return;
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
        if (this.solarSystem?.active) { this.solarSystem.updateCopy(); return; }
        if (this.deepSky?.active) { this.deepSky.updateCopy(); return; }
        const copies = {
            en: { orbit: 'Right drag · orbit', pan: 'Left drag · pan', zoom: 'Scroll · approach', touch: 'Drag · orbit / Pinch · approach', select: 'Choose a constellation', reset: 'Reset view', home: 'Return home', closer: 'Move closer', farther: 'Move farther', overview: 'LOCAL STAR MAP', detail: 'CONSTELLATION', flight: 'APPROACHING', note: 'An interpreted star map. Constellation shapes and stellar colours follow Hipparcos; distances are composed for exploration.', scale: 'NEAR / FAR' },
            'zh-CN': { orbit: '右键拖动 · 旋转', pan: '左键拖动 · 平移', zoom: '滚轮 · 拉近与远离', touch: '单指旋转 / 双指缩放与平移', select: '选择一个星座', reset: '回到全景', home: '返回主页', closer: '拉近星图', farther: '拉远星图', overview: '局部星图', detail: '星座', flight: '正在靠近', note: '这是一幅经过编排的星图。星座形状与恒星颜色参考 Hipparcos 星表，展示距离经过压缩，方便探索。', scale: '近 / 远' },
            'zh-TW': { orbit: '右鍵拖動 · 旋轉', pan: '左鍵拖動 · 平移', zoom: '滾輪 · 拉近與遠離', touch: '單指旋轉 / 雙指縮放與平移', select: '選擇一個星座', reset: '回到全景', home: '返回主頁', closer: '拉近星圖', farther: '拉遠星圖', overview: '局部星圖', detail: '星座', flight: '正在靠近', note: '這是一幅經過編排的星圖。星座形狀與恆星顏色參考 Hipparcos 星表，展示距離經過壓縮，方便探索。', scale: '近 / 遠' }
        };
        const copy = copies[state.currentLang] || copies.en;
        document.querySelectorAll('[data-map-copy]').forEach(element => { element.textContent = copy[element.dataset.mapCopy] || ''; });
        document.getElementById('mapInputHint').textContent = COARSE_POINTER ? copy.touch : `${copy.orbit}     ${copy.pan}     ${copy.zoom}`;
        dom.status.textContent = state.scene === 'detail' ? `${copy.detail} / ${portalName(this.selected, state.currentLang)}` : state.scene === 'flying' ? copy.flight : copy.overview;
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
