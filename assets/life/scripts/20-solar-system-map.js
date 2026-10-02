const SOLAR_MAP_BODIES = Object.freeze([
    { id: 'sun', au: 0, years: 0, radius: 17, inclination: 0 },
    { id: 'mercury', au: 0.387, years: 0.241, radius: 2.5, inclination: 7 },
    { id: 'venus', au: 0.723, years: 0.615, radius: 4.5, inclination: 3.39 },
    { id: 'earth', au: 1, years: 1, radius: 4.7, inclination: 0 },
    { id: 'moon', au: 0.00257, years: 0.0748, radius: 1.9, inclination: 5.15, parent: 'earth' },
    { id: 'mars', au: 1.524, years: 1.881, radius: 3.5, inclination: 1.85 },
    { id: 'jupiter', au: 5.203, years: 11.862, radius: 10.5, inclination: 1.30 },
    { id: 'saturn', au: 9.537, years: 29.457, radius: 9, inclination: 2.49 },
    { id: 'uranus', au: 19.191, years: 84.017, radius: 6.5, inclination: 0.77 },
    { id: 'neptune', au: 30.069, years: 164.79, radius: 6.3, inclination: 1.77 }
]);

class SolarSystemMap {
    constructor(parent) {
        this.parent = parent;
        this.active = false;
        this.ready = false;
        this.yaw = -0.28;
        this.pitch = 0.66;
        this.distance = 625;
        this.target = { yaw: this.yaw, pitch: this.pitch, distance: this.distance };
        this.bodies = [];
        this.visit = null;
        this.lastFrame = 0;
        this.fov = 48 * DEG;
        this.specks = Array.from({ length: 720 }, (_, index) => {
            const longitude = index * 2.39996323;
            const vertical = 1 - (index + 0.5) / 360;
            const radial = Math.sqrt(Math.max(0, 1 - vertical * vertical));
            return [Math.cos(longitude) * radial, vertical, Math.sin(longitude) * radial, 0.2 + (index * 17 % 29) / 42];
        });
    }

    copy() {
        const copies = {
            en: {
                name: 'Solar System', region: 'OUR STELLAR NEIGHBOURHOOD', back: 'Back to the local stars',
                title: 'One star. Eight worlds.', subtitle: 'And the Moon, travelling with Earth.',
                note: 'Positions follow an astronomical snapshot. Orbits and body sizes are compressed independently for exploration.',
                instructions: 'Right drag to orbit · Scroll to approach · Choose a world',
                choose: 'Explore the Solar System', bodyClose: 'Return to the Solar System',
                closeup: 'PLANETARY ATLAS', badge: 'SURFACE PORTRAIT', loading: 'APPROACHING',
                radius: 'Mean radius', orbit: 'Mean orbital distance', period: 'Orbital period',
                parent: 'Orbits', type: 'Classification', scale: 'Display scale', scaled: 'Enlarged for exploration',
                days: 'Earth days', years: 'Earth years', source: 'Pre-rendered views with fixed studio lighting; not a live spacecraft image or the current lunar phase.',
                snapshot: 'Position snapshot', home: 'Earth', star: 'Star', planet: 'Planet', satellite: 'Natural satellite',
                sunDescription: 'Our nearest star holds eight planets, their moons, and countless smaller worlds in its gravitational reach. Its light takes about eight minutes to reach Earth.',
                moonDescription: 'Earth’s only natural satellite. Its cratered surface preserves the history of impacts, while its gravity helps shape Earth’s tides.',
                earthDescription: 'Our ocean-covered home, wrapped in a thin atmosphere. Earth is the only world currently known to support life.'
            },
            'zh-CN': {
                name: '太阳系', region: '我们所在的恒星系统', back: '返回局部星域',
                title: '一颗恒星，八个世界。', subtitle: '还有与地球同行的月亮。',
                note: '位置参考当前天文快照。轨道距离与天体大小分别压缩，方便探索。',
                instructions: '右键拖动旋转 · 滚轮拉近 · 选择一颗星球',
                choose: '探索太阳系', bodyClose: '返回太阳系', closeup: '行星图鉴', badge: '天体近景', loading: '正在靠近',
                radius: '平均半径', orbit: '平均轨道距离', period: '公转周期', parent: '围绕', type: '天体类型',
                scale: '展示比例', scaled: '为探索而放大', days: '地球日', years: '地球年',
                source: '离线预渲染视角，采用固定艺术光照；不是实时航天器影像，也不代表当前月相。', snapshot: '位置快照',
                home: '地球', star: '恒星', planet: '行星', satellite: '天然卫星',
                sunDescription: '离我们最近的恒星，以引力维系八颗行星、它们的卫星和无数小天体。阳光抵达地球约需八分钟。',
                moonDescription: '地球唯一的天然卫星。布满撞击坑的表面保存着漫长的撞击历史，它的引力也参与塑造地球的潮汐。',
                earthDescription: '被海洋覆盖、被薄薄大气包裹的家园。地球是目前唯一已知孕育生命的世界。'
            },
            'zh-TW': {
                name: '太陽系', region: '我們所在的恆星系統', back: '返回局部星域',
                title: '一顆恆星，八個世界。', subtitle: '還有與地球同行的月亮。',
                note: '位置參考目前天文快照。軌道距離與天體大小分別壓縮，方便探索。',
                instructions: '右鍵拖動旋轉 · 滾輪拉近 · 選擇一顆星球',
                choose: '探索太陽系', bodyClose: '返回太陽系', closeup: '行星圖鑑', badge: '天體近景', loading: '正在靠近',
                radius: '平均半徑', orbit: '平均軌道距離', period: '公轉週期', parent: '圍繞', type: '天體類型',
                scale: '展示比例', scaled: '為探索而放大', days: '地球日', years: '地球年',
                source: '離線預渲染視角，採用固定藝術光照；不是即時太空船影像，也不代表目前月相。', snapshot: '位置快照',
                home: '地球', star: '恆星', planet: '行星', satellite: '天然衛星',
                sunDescription: '離我們最近的恆星，以引力維繫八顆行星、它們的衛星和無數小天體。陽光抵達地球約需八分鐘。',
                moonDescription: '地球唯一的天然衛星。佈滿撞擊坑的表面保存著漫長的撞擊歷史，它的引力也參與塑造地球的潮汐。',
                earthDescription: '被海洋覆蓋、被薄薄大氣包裹的家園。地球是目前唯一已知孕育生命的世界。'
            }
        };
        return copies[state.currentLang] || copies.en;
    }

    create() {
        if (this.ready) return;
        this.ready = true;
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'solarSystemCanvas';
        this.canvas.setAttribute('aria-hidden', 'true');
        dom.world.append(this.canvas);
        this.context = this.canvas.getContext('2d');
        this.header = document.createElement('section');
        this.header.className = 'solar-map-header';
        this.header.innerHTML = '<button class="solar-map-back" type="button"><span aria-hidden="true">←</span><span></span></button><p class="solar-map-kicker"></p><h1></h1><p class="solar-map-subtitle"></p>';
        this.header.querySelector('button').addEventListener('click', () => this.exit());
        this.nav = document.createElement('nav');
        this.nav.className = 'solar-map-points';
        this.picker = document.createElement('nav');
        this.picker.className = 'solar-map-picker';
        this.footer = document.createElement('div');
        this.footer.className = 'solar-map-footer';
        this.footer.innerHTML = '<p class="solar-map-instructions"></p><p class="solar-map-note"></p>';
        document.body.append(this.header, this.nav, this.picker, this.footer);
        const earth = {
            id: 'earth', body: 'Earth', color: '#8dbbe4', radiusKm: 6371, flattening: 0.00335,
            material: 'rock', texture: 'assets/celestial/earth.webp', longitudeOffset: 0,
            names: { en: 'Earth', 'zh-CN': '地球', 'zh-TW': '地球' },
            kinds: { en: 'Our home world', 'zh-CN': '我们的家园', 'zh-TW': '我們的家園' },
            descriptions: {}, facts: [
                { en: 'Liquid water covers about 71% of Earth’s surface.', 'zh-CN': '液态水覆盖约 71% 的地球表面。', 'zh-TW': '液態水覆蓋約 71% 的地球表面。' },
                { en: 'Its atmosphere is mostly nitrogen and oxygen.', 'zh-CN': '地球大气主要由氮气和氧气组成。', 'zh-TW': '地球大氣主要由氮氣和氧氣組成。' }
            ]
        };
        this.bodies = SOLAR_MAP_BODIES.map(definition => {
            const source = definition.id === 'earth' ? earth : celestialBodies.find(body => body.id === definition.id);
            const profile = { ...source, angularDisc: true, refracted: false, current: { ...source.current } };
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'solar-body-hit';
            button.dataset.body = definition.id;
            button.innerHTML = '<span class="solar-body-reticle"></span><span class="solar-body-name"></span>';
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'solar-body-item';
            item.dataset.body = definition.id;
            item.innerHTML = '<span class="solar-body-dot"></span><span class="solar-body-item-name"></span>';
            item.style.setProperty('--solar-color', profile.color);
            if (definition.parent) item.classList.add('is-moon');
            const body = { ...definition, profile, button, item, position: [0, 0, 0], orbitRadius: 0, screen: null, textureReady: false };
            [button, item].forEach(control => {
                control.addEventListener('click', event => {
                    if (performance.now() < (this.parent.suppressClickUntil || 0)) return;
                    this.openBody(body, event.detail === 0 ? 'keyboard' : 'pointer');
                });
                control.addEventListener('mouseenter', () => { this.hover = body; });
                control.addEventListener('mouseleave', () => { if (this.hover === body) this.hover = null; });
                control.addEventListener('focus', () => { this.hover = body; });
                control.addEventListener('blur', () => { if (this.hover === body) this.hover = null; });
            });
            this.nav.append(button);
            this.picker.append(item);
            return body;
        });
        this.nav.addEventListener('contextmenu', event => event.preventDefault());
        this.nav.addEventListener('pointerdown', event => {
            if (!this.canMove() || event.button !== 2) return;
            event.preventDefault();
            this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: 0 };
            this.nav.setPointerCapture(event.pointerId);
        });
        this.nav.addEventListener('pointermove', event => {
            if (!this.drag || this.drag.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - this.drag.x;
            const deltaY = event.clientY - this.drag.y;
            this.drag.x = event.clientX;
            this.drag.y = event.clientY;
            this.drag.moved += Math.hypot(deltaX, deltaY);
            this.orbit(deltaX, deltaY);
        });
        const release = () => {
            if (this.drag?.moved > 5) this.parent.suppressClickUntil = performance.now() + 250;
            this.clearInput();
        };
        this.nav.addEventListener('pointerup', release);
        this.nav.addEventListener('pointercancel', release);
        this.nav.addEventListener('lostpointercapture', release);
        window.addEventListener('blur', release);
        this.nav.addEventListener('wheel', event => {
            if (!this.canMove()) return;
            event.preventDefault();
            this.zoom(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1));
        }, { passive: false });
        dom.celestialClose.addEventListener('click', event => {
            if (this.active) this.closeBody(true, event.detail === 0 ? 'keyboard' : 'pointer');
        });
        this.resize();
    }

    enter() {
        this.create();
        if (this.active || state.modalOpen || state.scene === 'leaving-home') return;
        this.returnFocus = document.activeElement;
        this.parent.clearInput();
        this.parent.flight = null;
        if (dom.body.classList.contains('panel-open')) closePortalPanel(false);
        this.active = true;
        this.enteredAt = performance.now();
        this.lastFrame = 0;
        this.target.distance = window.innerWidth < 760 ? 1040 : 625;
        this.distance = this.target.distance * (REDUCED_MOTION ? 1 : 1.15);
        this.snapshotDate = new Date();
        this.calculatePositions();
        state.scene = 'roam';
        state.activePortal = null;
        state.activeCelestial = null;
        state.focusedPortal = null;
        state.focusedCelestial = null;
        dom.body.classList.add('solar-system-active');
        dom.portalNav.inert = true;
        dom.starNav.inert = true;
        dom.celestialNav.inert = true;
        this.updateCopy();
        this.bodies.forEach(body => {
            if (body.textureReady) return;
            celestialCloseupRenderer.loadImage(body.profile.texture).then(() => {
                body.textureReady = true;
                body.sphere = celestialCloseupRenderer.fallbackSphereFor(body.profile);
            }).catch(() => {
                celestialCloseupRenderer.installFallbackSurface(body.profile);
                body.textureReady = true;
                body.sphere = celestialCloseupRenderer.fallbackSphereFor(body.profile);
            });
        });
        requestAnimationFrame(() => {
            if (this.active && !this.visit) this.header.querySelector('button').focus({ preventScroll: true });
        });
    }

    exit(restoreFocus = true) {
        if (!this.active) return;
        this.parent.clearInput();
        this.clearInput();
        this.clearVisit();
        this.active = false;
        this.hover = null;
        this.lastFrame = 0;
        dom.body.classList.remove('solar-system-active', 'solar-body-active');
        state.scene = 'roam';
        dom.portalNav.inert = false;
        dom.starNav.inert = true;
        this.parent.lastFrame = 0;
        const destination = this.parent.systemReturn;
        this.parent.systemReturn = null;
        const restore = () => {
            if (restoreFocus && this.returnFocus?.isConnected && !this.returnFocus.inert) {
                this.returnFocus.focus({ preventScroll: true });
            }
        };
        if (restoreFocus && destination) this.parent.animateTo(destination, restore);
        else restore();
        this.parent.updateCopy();
    }

    calculatePositions() {
        const obliquity = 23.43928 * DEG;
        const toScene = vector => [vector[0], vector[2] * Math.cos(obliquity) - vector[1] * Math.sin(obliquity), vector[1] * Math.cos(obliquity) + vector[2] * Math.sin(obliquity)];
        this.bodies.forEach((body, index) => {
            let position;
            try {
                position = body.id === 'sun' ? [0, 0, 0] : vectorToArray(body.parent ? Astronomy.GeoMoon(this.snapshotDate) : Astronomy.HelioVector(body.profile.body, this.snapshotDate));
                const rotation = Astronomy.RotationAxis(body.profile.body, this.snapshotDate);
                body.profile.current.northEqj = vectorToArray(rotation.north);
                body.profile.current.north = equatorialVectorToLocal(rotation.north);
                body.profile.current.spin = rotation.spin;
            } catch (error) {
                const angle = index * 2.08;
                position = [Math.cos(angle) * body.au, 0, Math.sin(angle) * body.au];
            }
            body.heliocentric = position;
            const vector = toScene(position);
            body.orbitRadius = body.parent ? 10 : body.au ? 21 + 56 * Math.log1p(body.au * 0.72) : 0;
            body.position = normalize(vector).map(value => value * body.orbitRadius);
            if (body.parent) {
                const earth = this.bodies.find(item => item.id === body.parent);
                body.position = body.position.map((value, axis) => value + earth.position[axis]);
                body.heliocentric = position.map((value, axis) => value + earth.heliocentric[axis]);
            }
            body.profile.current.hc = body.heliocentric;
            body.profile.current.phase = 0.85;
            body.profile.current.phaseAngle = 45;
            body.profile.current.ringTilt = 23;
            body.profile.current.angularDiameter = 0.01;
        });
    }

    canMove() {
        return this.active && !this.visit && !state.modalOpen && state.scene !== 'leaving-home';
    }

    clearInput() {
        const pointerId = this.drag?.pointerId;
        this.drag = null;
        if (pointerId !== undefined && this.nav?.hasPointerCapture?.(pointerId)) {
            this.nav.releasePointerCapture(pointerId);
        }
    }

    orbit(deltaX, deltaY) {
        if (!this.canMove()) return;
        this.target.yaw -= deltaX * 0.0042;
        this.target.pitch = clamp(this.target.pitch + deltaY * 0.0042, -1.43, 1.43);
    }

    zoom(delta) {
        if (!this.canMove()) return;
        const maximum = window.innerWidth < 760 ? 1500 : 1100;
        const desired = this.target.distance * Math.exp(clamp(delta, -180, 180) * 0.0026);
        if (this.target.distance >= maximum && delta > 0) {
            this.exit();
            return;
        }
        this.target.distance = clamp(desired, 180, maximum);
    }

    view() {
        const outward = [Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch)];
        const forward = outward.map(value => -value);
        const right = normalize(cross(forward, [0, 1, 0]));
        return { position: outward.map(value => value * this.distance), forward, right, up: normalize(cross(right, forward)) };
    }

    project(position, view = this.currentView) {
        const relative = position.map((value, axis) => value - view.position[axis]);
        const depth = dot(relative, view.forward);
        const focal = this.height * 0.5 / Math.tan(this.fov * 0.5);
        const screen = { x: this.width * 0.5 + dot(relative, view.right) * focal / Math.max(1, depth), y: this.height * 0.52 - dot(relative, view.up) * focal / Math.max(1, depth), depth, scale: focal / Math.max(1, depth) };
        screen.visible = depth > 1 && screen.x > -50 && screen.x < this.width + 50 && screen.y > -50 && screen.y < this.height + 50;
        return screen;
    }

    closeupBasis() {
        const obliquity = 23.43928 * DEG;
        const toLocal = vector => equatorialVectorToLocal([
            vector[0], vector[2] * Math.cos(obliquity) - vector[1] * Math.sin(obliquity),
            vector[2] * Math.sin(obliquity) + vector[1] * Math.cos(obliquity)
        ]);
        const view = this.currentView || this.view();
        return { right: toLocal(view.right), up: toLocal(view.up), forward: toLocal(view.forward) };
    }

    openBody(body, source = 'pointer') {
        if (!this.canMove()) return;
        this.parent.clearInput();
        this.clearInput();
        state.activationSource = source;
        state.activeCelestial = body.profile;
        state.activePortal = null;
        state.scene = 'flying';
        const point = body.screen || this.project(body.position);
        const basis = this.closeupBasis();
        body.profile.current.direction = basis.forward.slice();
        body.profile.current.geometricDirection = basis.forward.slice();
        const profile = body.profile;
        const light = celestialCloseupRenderer.lightInView(profile, basis);
        profile.current.phase = (1 - light[2]) * 0.5;
        profile.current.phaseAngle = Math.acos(clamp(-light[2], -1, 1)) / DEG;
        profile.current.ringTilt = Math.asin(clamp(-dot(profile.current.north || basis.up, basis.forward), -1, 1)) / DEG;
        const anchor = { x: point.x, y: point.y };
        const disc = { areaRadius: Math.max(1.5, body.radius * point.scale) };
        this.visit = {
            solarSystem: true, body, profile, phase: 'approach', activationSource: source,
            originScreen: anchor, approachScreen: anchor, originDiscGeometry: disc, approachDiscGeometry: disc,
            origin: { fov: this.fov, orientation: camera.orientation.slice(), targetOrientation: camera.targetOrientation.slice(), targetFov: camera.targetFov },
            panelOnLeft: false, preferredPanelOnLeft: false, focusFov: this.fov,
            visualProgress: 0, visualDuration: REDUCED_MOTION ? 1 : 1050,
            textureReady: false, textureError: false, textureReadyAt: null, visualStartedAt: null,
            transition: { startedAt: performance.now() }, basis
        };
        state.celestialVisit = this.visit;
        state.celestialFlight = this.visit;
        dom.body.classList.add('solar-body-active');
        setCelestialVisitClasses('approach');
        prepareCelestialVisitTexture(this.visit);
        this.updateCopy();
    }

    closeBody(restoreFocus = true, source = state.activationSource) {
        if (!this.visit || this.visit.phase === 'returning') return;
        const visit = this.visit;
        clearCelestialTextureWatchdog(visit);
        hideCelestialPanelForReturn();
        visit.phase = 'returning';
        visit.restoreFocus = restoreFocus;
        visit.returnSource = source;
        visit.transition = { startedAt: performance.now(), fromVisual: visit.visualProgress };
        state.scene = 'flying';
        state.celestialFlight = visit;
        setCelestialVisitClasses('returning');
        this.updateCopy();
    }

    clearVisit() {
        if (this.visit) clearCelestialTextureWatchdog(this.visit);
        this.visit = null;
        state.celestialVisit = null;
        state.celestialFlight = null;
        state.activeCelestial = null;
        state.focusedCelestial = null;
        camera.inspectionOrientation = null;
        hideCelestialPanelForReturn();
        setCelestialVisitClasses(null);
        celestialCloseupRenderer.clear();
        bakedCelestialViewer.clear();
        dom.body.classList.remove('solar-body-active');
        state.scene = 'roam';
    }

    renderVisit(time) {
        const visit = this.visit;
        if (!visit) return;
        if (visit.phase === 'approach' && visit.textureReady && visit.visualStartedAt !== null) {
            const progress = clamp((time - visit.visualStartedAt) / visit.visualDuration, 0, 1);
            visit.visualProgress = REDUCED_MOTION ? 1 : easeInOutCubic(progress);
            if (progress >= 1) {
                clearCelestialTextureWatchdog(visit);
                state.celestialFlight = null;
                state.detailFov = this.fov;
                openCelestialPanel(visit.profile, false);
                this.updateCopy();
            }
        } else if (visit.phase === 'returning') {
            const progress = REDUCED_MOTION ? 1 : clamp((time - visit.transition.startedAt) / 720, 0, 1);
            visit.visualProgress = lerp(visit.transition.fromVisual, 0, easeInOutCubic(progress));
            if (progress >= 1) {
                const returnButton = visit.body.item;
                const restoreFocus = visit.restoreFocus;
                this.clearVisit();
                this.updateCopy();
                if (flushPendingDrawerNavigation()) return;
                if (restoreFocus) returnButton.focus({ preventScroll: true });
                return;
            }
        }
        bakedCelestialViewer.render(time, visit);
    }

    render(time) {
        if (!this.active || !this.context) return;
        if (this.visit?.phase === 'observing') {
            this.renderVisit(time);
            return;
        }
        const delta = clamp((time - (this.lastFrame || time)) / 1000, 0, 0.05);
        this.lastFrame = time;
        const response = REDUCED_MOTION ? 1 : 1 - Math.exp(-delta * 13);
        this.yaw = lerp(this.yaw, this.target.yaw, response);
        this.pitch = lerp(this.pitch, this.target.pitch, response);
        this.distance = lerp(this.distance, this.target.distance, response);
        this.currentView = this.view();
        const context = this.context;
        context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        context.fillStyle = '#02040a';
        context.fillRect(0, 0, this.width, this.height);
        this.drawBackground(context);
        context.save();
        context.globalAlpha = 1 - (this.visit?.visualProgress || 0) * 0.9;
        this.drawOrbits(context);
        const ordered = this.bodies.map(body => {
            body.screen = this.project(body.position);
            return body;
        }).sort((left, right) => right.screen.depth - left.screen.depth);
        for (const body of ordered) {
            const point = body.screen;
            const visible = point.visible && !this.visit && !state.modalOpen;
            body.button.hidden = !visible;
            body.button.inert = !visible;
            body.item.disabled = Boolean(this.visit);
            body.button.classList.toggle('is-hovered', this.hover === body);
            if (visible) body.button.style.transform = `translate3d(${point.x}px,${point.y}px,0) translate(-50%,-50%)`;
            if (point.visible && this.visit?.body !== body) this.drawBody(context, body);
        }
        if (!this.visit && !state.modalOpen) this.positionLabels(context);
        context.restore();
        if (this.visit) this.renderVisit(time);
    }

    drawBackground(context) {
        for (const star of this.specks) {
            const point = this.project(star.slice(0, 3).map(value => value * 7000));
            if (!point.visible) continue;
            context.fillStyle = `rgba(191,208,235,${star[3] * 0.65})`;
            context.beginPath();
            context.arc(point.x, point.y, star[3] > 0.75 ? 0.8 : 0.5, 0, Math.PI * 2);
            context.fill();
        }
        const center = this.project([0, 0, 0]);
        const glow = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.min(this.width, this.height) * 0.53);
        glow.addColorStop(0, 'rgba(126,97,57,0.10)');
        glow.addColorStop(0.38, 'rgba(49,50,59,0.06)');
        glow.addColorStop(1, 'rgba(6,12,23,0)');
        context.fillStyle = glow;
        context.fillRect(0, 0, this.width, this.height);
    }

    drawOrbits(context) {
        for (const body of this.bodies) {
            if (!body.orbitRadius) continue;
            const origin = body.parent ? this.bodies.find(item => item.id === body.parent).position : [0, 0, 0];
            const highlighted = this.hover === body;
            context.strokeStyle = highlighted ? 'rgba(225,209,175,0.56)' : body.parent ? 'rgba(172,195,224,0.30)' : 'rgba(148,163,186,0.22)';
            context.lineWidth = highlighted ? 0.9 : 0.6;
            context.beginPath();
            let previousVisible = false;
            for (let index = 0; index <= 192; index++) {
                const angle = index / 192 * Math.PI * 2;
                const point = this.project([
                    origin[0] + Math.cos(angle) * body.orbitRadius,
                    origin[1] + Math.sin(angle) * body.orbitRadius * Math.sin(body.inclination * DEG),
                    origin[2] + Math.sin(angle) * body.orbitRadius * Math.cos(body.inclination * DEG)
                ]);
                if (point.depth > 1) {
                    if (previousVisible) context.lineTo(point.x, point.y);
                    else context.moveTo(point.x, point.y);
                }
                previousVisible = point.depth > 1;
            }
            context.stroke();
        }
    }

    drawBody(context, body) {
        const point = body.screen;
        const radius = clamp(body.radius * point.scale, body.id === 'sun' ? 9 : 1.7, 100);
        context.save();
        context.translate(point.x, point.y);
        if (body.id === 'sun') {
            const glow = context.createRadialGradient(0, 0, radius * 0.45, 0, 0, radius * 4.8);
            glow.addColorStop(0, 'rgba(255,228,171,0.6)');
            glow.addColorStop(0.24, 'rgba(252,191,105,0.16)');
            glow.addColorStop(1, 'rgba(245,171,80,0)');
            context.fillStyle = glow;
            context.fillRect(-radius * 5, -radius * 5, radius * 10, radius * 10);
        }
        const ring = front => {
            if (body.id !== 'saturn') return;
            context.save();
            context.rotate(-0.38);
            context.strokeStyle = 'rgba(197,181,142,0.66)';
            context.lineWidth = Math.max(1, radius * 0.35);
            context.beginPath();
            context.ellipse(0, 0, radius * 1.72, radius * 0.59, 0, front ? 0 : Math.PI, front ? Math.PI : Math.PI * 2);
            context.stroke();
            context.restore();
        };
        ring(false);
        context.save();
        context.beginPath();
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.clip();
        if (body.sphere) context.drawImage(body.sphere, -radius, -radius, radius * 2, radius * 2);
        else {
            const gradient = context.createRadialGradient(-radius * 0.28, -radius * 0.26, 0, 0, 0, radius * 1.2);
            gradient.addColorStop(0, body.profile.color);
            gradient.addColorStop(0.74, body.profile.color);
            gradient.addColorStop(1, '#11151d');
            context.fillStyle = gradient;
            context.fillRect(-radius, -radius, radius * 2, radius * 2);
        }
        if (body.id !== 'sun') {
            const sun = this.project([0, 0, 0]);
            const angle = Math.atan2(sun.y - point.y, sun.x - point.x);
            context.rotate(angle);
            const shade = context.createLinearGradient(radius, 0, -radius, 0);
            shade.addColorStop(0, 'rgba(0,2,8,0)');
            shade.addColorStop(0.5, 'rgba(0,2,8,0.14)');
            shade.addColorStop(1, 'rgba(0,2,8,0.92)');
            context.fillStyle = shade;
            context.fillRect(-radius, -radius, radius * 2, radius * 2);
        }
        context.restore();
        ring(true);
        if (this.hover === body) {
            context.strokeStyle = 'rgba(225,228,230,0.72)';
            context.lineWidth = 0.7;
            context.beginPath();
            context.arc(0, 0, radius + 7, 0, Math.PI * 2);
            context.stroke();
        }
        context.restore();
    }

    positionLabels(context) {
        const rectangles = [];
        const ordered = this.bodies.slice().sort((left, right) => Number(right === this.hover) - Number(left === this.hover));
        const candidates = [[0, 32], [0, -32], [42, 0], [-42, 0], [30, 47], [-30, -47], [58, 30], [-58, 30], [0, 65], [0, -65]];
        for (const body of ordered) {
            if (body.button.hidden) continue;
            const label = body.button.querySelector('.solar-body-name');
            const labelWidth = Math.max(30, celestialName(body.profile).length * (state.currentLang === 'en' ? 5.8 : 11));
            let placement = null;
            for (const [offsetX, offsetY] of candidates) {
                const centerX = body.screen.x + offsetX;
                const centerY = body.screen.y + offsetY;
                const rectangle = { left: centerX - labelWidth * 0.5 - 5, right: centerX + labelWidth * 0.5 + 5, top: centerY - 9, bottom: centerY + 9 };
                if (rectangle.left < 12 || rectangle.right > this.width - 12 || rectangle.top < 78 || rectangle.bottom > this.height - 165) continue;
                if (rectangles.some(other => rectangle.left < other.right && rectangle.right > other.left && rectangle.top < other.bottom && rectangle.bottom > other.top)) continue;
                const coversBody = this.bodies.some(other => {
                    if (!other.screen?.visible) return false;
                    const radius = Math.max(4, other.radius * other.screen.scale) + 4;
                    return rectangle.left < other.screen.x + radius && rectangle.right > other.screen.x - radius && rectangle.top < other.screen.y + radius && rectangle.bottom > other.screen.y - radius;
                });
                if (coversBody) continue;
                placement = { offsetX, offsetY, rectangle };
                break;
            }
            label.style.opacity = placement ? '1' : '0';
            if (!placement) continue;
            rectangles.push(placement.rectangle);
            label.style.left = `${22 + placement.offsetX}px`;
            label.style.top = `${22 + placement.offsetY}px`;
            label.style.transform = 'translate(-50%,-50%)';
            if (Math.hypot(placement.offsetX, placement.offsetY) > 38) {
                context.strokeStyle = 'rgba(165,183,207,0.18)';
                context.lineWidth = 0.55;
                context.beginPath();
                context.moveTo(body.screen.x + placement.offsetX * 0.30, body.screen.y + placement.offsetY * 0.30);
                context.lineTo(body.screen.x + placement.offsetX * 0.78, body.screen.y + placement.offsetY * 0.78);
                context.stroke();
            }
        }
    }

    renderBodyPanel(profile) {
        if (!this.active || !this.visit || this.visit.profile !== profile) return false;
        const copy = this.copy();
        const body = this.visit.body;
        dom.celestialPanel.style.setProperty('--body-color', profile.color);
        dom.celestialPanelKicker.textContent = copy.closeup;
        dom.celestialObservationBadge.textContent = copy.badge;
        dom.celestialPanelTitle.textContent = celestialName(profile);
        dom.celestialPanelSubtitle.textContent = localized(profile.kinds);
        dom.celestialClose.setAttribute('aria-label', copy.bodyClose);
        dom.celestialDescription.textContent = copy[`${profile.id}Description`] || localized(profile.descriptions);
        const number = value => value.toLocaleString(state.currentLang, { maximumFractionDigits: 1 });
        dom.celestialAltitudeLabel.textContent = copy.radius;
        dom.celestialAltitude.textContent = `${number(profile.radiusKm)} km`;
        dom.celestialAzimuthLabel.textContent = copy.orbit;
        dom.celestialAzimuth.textContent = body.id === 'sun' ? '—' : body.parent ? '384,400 km' : `${body.au} AU`;
        dom.celestialDistanceLabel.textContent = copy.period;
        dom.celestialDistance.textContent = body.id === 'sun' ? '—' : body.years < 1 ? `${number(body.years * 365.25)} ${copy.days}` : `${number(body.years)} ${copy.years}`;
        dom.celestialMagnitudeLabel.textContent = copy.parent;
        dom.celestialMagnitude.textContent = body.id === 'sun' ? '—' : body.parent ? copy.home : celestialName(this.bodies[0].profile);
        dom.celestialPhaseLabel.textContent = copy.type;
        dom.celestialPhase.textContent = body.id === 'sun' ? copy.star : body.parent ? copy.satellite : copy.planet;
        dom.celestialVisibilityLabel.textContent = copy.scale;
        dom.celestialVisibility.textContent = copy.scaled;
        const fragment = document.createDocumentFragment();
        profile.facts.forEach(fact => {
            const item = document.createElement('li');
            item.textContent = localized(fact);
            fragment.append(item);
        });
        dom.celestialFacts.replaceChildren(fragment);
        dom.celestialObserverNote.textContent = `${copy.source} ${copy.snapshot}: ${this.snapshotDate.toLocaleDateString(state.currentLang)}.`;
        return true;
    }

    updateCopy() {
        if (!this.ready || !this.active) return;
        const copy = this.copy();
        this.header.querySelector('.solar-map-back span:last-child').textContent = copy.back;
        this.header.querySelector('.solar-map-kicker').textContent = copy.region;
        this.header.querySelector('h1').textContent = copy.title;
        this.header.querySelector('.solar-map-subtitle').textContent = copy.subtitle;
        this.footer.querySelector('.solar-map-instructions').textContent = copy.instructions;
        this.footer.querySelector('.solar-map-note').textContent = copy.note;
        this.nav.setAttribute('aria-label', copy.choose);
        this.picker.setAttribute('aria-label', copy.choose);
        this.bodies.forEach(body => {
            const name = celestialName(body.profile);
            body.button.querySelector('.solar-body-name').textContent = name;
            body.button.setAttribute('aria-label', `${name} · ${localized(body.profile.kinds)}`);
            body.item.querySelector('.solar-body-item-name').textContent = name;
            body.item.setAttribute('aria-label', `${name}${body.parent ? ` · ${copy.home}` : ''}`);
        });
        this.header.querySelector('button').tabIndex = this.visit ? -1 : 0;
        dom.status.textContent = this.visit ? `${this.visit.phase === 'approach' ? copy.loading : copy.closeup} / ${celestialName(this.visit.profile)}` : copy.name.toUpperCase();
        dom.world.setAttribute('aria-label', `${copy.name}. ${copy.instructions}`);
        if (this.visit?.phase === 'observing') this.renderBodyPanel(this.visit.profile);
        bakedCelestialViewer.updateCopy();
    }

    resize() {
        if (!this.ready) return;
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        celestialCloseupRenderer.resize();
        bakedCelestialViewer.resize();
        if (this.visit) {
            this.visit.panelOnLeft = false;
            const point = this.project(this.visit.body.position, this.view());
            this.visit.originScreen = { x: point.x, y: point.y };
            this.visit.approachScreen = { x: point.x, y: point.y };
        }
    }

    handleKey(event) {
        if (!this.active || state.sectionDrawerOpen || state.modalOpen) return false;
        if (event.key === 'Escape') {
            event.preventDefault();
            if (this.visit) this.closeBody(true, 'keyboard');
            else this.exit();
            return true;
        }
        if (this.visit && bakedCelestialViewer.handleKey(event)) return true;
        if (event.key === 'Tab' && this.visit?.phase === 'observing') {
            const controls = [bakedCelestialViewer.element, ...Array.from(bakedCelestialViewer.element?.querySelectorAll('button:not([disabled])') || []), ...Array.from(dom.celestialPanel.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]'))].filter(element => element && !element.hidden && !element.inert && element.getClientRects().length);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (controls.length && (event.shiftKey ? document.activeElement === first || !controls.includes(document.activeElement) : document.activeElement === last || !controls.includes(document.activeElement))) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus({ preventScroll: true });
            }
            return true;
        }
        return false;
    }
}
