(function () {
    'use strict';

    const STORAGE_KEY = 'runde:route-transition:v1';
    const TTL = 15000;
    const PAGE = document.documentElement.dataset.stellarPage || '';
    const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const COARSE_POINTER = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    let active = false;
    let layer = null;
    let canvas = null;
    let context = null;
    let frame = 0;
    let arrivalTimer = 0;
    let busySet = false;
    let busyInertStates = [];
    let destinationReady = false;
    let animationResolve = null;
    let navigationGeneration = 0;
    let pendingNavigation = null;
    let arrivalGeneration = 0;
    let pendingArrivalBegin = null;

    const style = document.createElement('style');
    style.textContent = `
        .stellar-transit-layer {
            position: fixed;
            inset: 0;
            z-index: 2147483000;
            overflow: hidden;
            background: #050814;
            pointer-events: auto;
            contain: strict;
        }
        .stellar-transit-layer.is-departing {
            background: transparent;
        }
        .stellar-transit-layer canvas {
            display: block;
            width: 100%;
            height: 100%;
        }
        html.stellar-transit-active {
            overflow: hidden !important;
        }
        .stellar-transit-layer[data-waiting="true"]::after {
            content: attr(data-status-label);
            position: absolute;
            left: 50%;
            bottom: max(2rem, env(safe-area-inset-bottom));
            transform: translateX(-50%);
            color: rgba(231, 239, 255, 0.72);
            font: 500 0.66rem/1.2 ui-monospace, SFMono-Regular, Consolas, monospace;
            letter-spacing: 0.24em;
            white-space: nowrap;
        }
    `;
    document.head.appendChild(style);

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function smoothstep(edge0, edge1, value) {
        const amount = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
        return amount * amount * (3 - 2 * amount);
    }

    function easeInCubic(value) {
        return value * value * value;
    }

    function easeOutCubic(value) {
        return 1 - Math.pow(1 - value, 3);
    }

    function seededRandom(seedText) {
        let seed = 2166136261;
        for (let index = 0; index < seedText.length; index += 1) {
            seed ^= seedText.charCodeAt(index);
            seed = Math.imul(seed, 16777619);
        }
        return function random() {
            seed += 0x6D2B79F5;
            let value = seed;
            value = Math.imul(value ^ (value >>> 15), value | 1);
            value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
            return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
        };
    }

    function readPayload() {
        let raw = null;
        try {
            raw = sessionStorage.getItem(STORAGE_KEY);
            sessionStorage.removeItem(STORAGE_KEY);
        } catch (error) {
            return null;
        }
        if (!raw) return null;
        try {
            const payload = JSON.parse(raw);
            const age = Date.now() - payload?.at;
            const expectedSource = PAGE === 'index' ? 'life' : PAGE === 'life' ? 'index' : '';
            if (
                !payload ||
                payload.v !== 1 ||
                payload.to !== PAGE ||
                payload.from !== expectedSource ||
                !['cool', 'home'].includes(payload.mode) ||
                !Number.isFinite(payload.at) ||
                age < 0 ||
                age > TTL
            ) return null;
            return payload;
        } catch (error) {
            return null;
        }
    }

    function consumePayload() {
        return readPayload();
    }

    function writePayload(to, mode) {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                v: 1,
                from: PAGE,
                to,
                mode,
                at: Date.now()
            }));
        } catch (error) {
            // The animation remains useful even without cross-page handoff.
        }
    }

    function setPageBusy(busy) {
        if (!document.body) return;
        if (busy) {
            if (busySet) return;
            busySet = true;
            busyInertStates = Array.from(document.body.children)
                .filter(element => (
                    element !== layer &&
                    element.id !== 'siteLoader' &&
                    !['SCRIPT', 'STYLE'].includes(element.tagName)
                ))
                .map(element => {
                    const state = {
                        element,
                        inert: element.inert,
                        busy: element.getAttribute('aria-busy')
                    };
                    element.inert = true;
                    element.setAttribute('aria-busy', 'true');
                    return state;
                });
            document.documentElement.classList.add('stellar-transit-active');
        } else {
            if (!busySet) return;
            busySet = false;
            busyInertStates.forEach(({ element, inert, busy: previousElementBusy }) => {
                if (!element.isConnected) return;
                element.inert = inert;
                if (previousElementBusy === null) {
                    element.removeAttribute('aria-busy');
                } else {
                    element.setAttribute('aria-busy', previousElementBusy);
                }
            });
            busyInertStates = [];
            document.documentElement.classList.remove('stellar-transit-active');
        }
    }

    function createLayer(kind) {
        const label = kind === 'depart'
            ? 'Entering stellar transit'
            : 'Aligning destination';
        if (layer?.isConnected) {
            layer.classList.toggle('is-departing', kind === 'depart');
            layer.removeAttribute('data-waiting');
            layer.setAttribute('aria-label', label);
            return layer;
        }
        layer = document.createElement('div');
        layer.className = `stellar-transit-layer${kind === 'depart' ? ' is-departing' : ''}`;
        layer.setAttribute('role', 'status');
        layer.setAttribute('aria-live', 'polite');
        layer.setAttribute('aria-atomic', 'true');
        layer.setAttribute('aria-label', label);
        canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        layer.appendChild(canvas);
        document.body.appendChild(layer);
        context = canvas.getContext('2d', { alpha: true });
        resize();
        return layer;
    }

    function resize() {
        if (!canvas || !context) return;
        const dpr = Math.min(window.devicePixelRatio || 1, COARSE_POINTER ? 1.2 : 1.5);
        const width = Math.max(1, window.innerWidth);
        const height = Math.max(1, window.innerHeight);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resolveOrigin(origin) {
        if (origin instanceof Element) {
            const rect = origin.getBoundingClientRect();
            return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
        }
        if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) {
            return { x: origin.x, y: origin.y };
        }
        return { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
    }

    function createParticles(mode) {
        const count = REDUCED_MOTION ? 0 : (COARSE_POINTER ? 220 : 420);
        const random = seededRandom(`stellar-transit-${mode}-${window.innerWidth}x${window.innerHeight}`);
        const colors = mode === 'home'
            ? ['255,244,218', '221,232,255', '255,218,177']
            : ['225,237,255', '255,248,231', '191,215,255'];
        return Array.from({ length: count }, () => ({
            angle: random() * Math.PI * 2,
            radius: Math.pow(random(), 2.35) * 0.16,
            speed: 0.56 + Math.pow(random(), 1.8) * 1.12,
            width: 0.45 + random() * 1.15,
            alpha: 0.28 + random() * 0.68,
            color: colors[Math.floor(random() * colors.length)]
        }));
    }

    function drawFrame(kind, progress, origin, particles, mode) {
        if (!context || !canvas) return;
        const width = window.innerWidth;
        const height = window.innerHeight;
        const maxRadius = Math.hypot(
            Math.max(origin.x, width - origin.x),
            Math.max(origin.y, height - origin.y)
        ) * 1.18;
        context.clearRect(0, 0, width, height);

        const departing = kind === 'depart';
        const movement = departing ? easeInCubic(progress) : easeOutCubic(progress);
        const deepAlpha = departing
            ? smoothstep(0.04, 0.78, progress)
            : 1 - smoothstep(0.18, 1, progress);
        context.fillStyle = `rgba(5,8,20,${deepAlpha})`;
        context.fillRect(0, 0, width, height);

        if (!REDUCED_MOTION) {
            context.save();
            context.globalCompositeOperation = 'lighter';
            context.lineCap = 'round';
            particles.forEach(particle => {
                const base = particle.radius * maxRadius;
                const travel = movement * maxRadius * particle.speed;
                const trailPhase = departing
                    ? easeInCubic(Math.max(0, progress - 0.045))
                    : easeOutCubic(Math.max(0, progress - 0.034));
                const previousTravel = trailPhase * maxRadius * particle.speed;
                const radius = base + travel;
                const previousRadius = base + previousTravel;
                if (previousRadius > maxRadius * 1.35) return;
                const cosine = Math.cos(particle.angle);
                const sine = Math.sin(particle.angle);
                const visibility = departing
                    ? smoothstep(0.02, 0.42, progress)
                    : 1 - smoothstep(0.52, 1, progress);
                context.strokeStyle = `rgba(${particle.color},${particle.alpha * visibility})`;
                context.lineWidth = particle.width * (0.75 + movement * 1.55);
                context.beginPath();
                context.moveTo(
                    origin.x + cosine * previousRadius,
                    origin.y + sine * previousRadius
                );
                context.lineTo(
                    origin.x + cosine * radius,
                    origin.y + sine * radius
                );
                context.stroke();
            });
            context.restore();
        }

        const flare = departing
            ? smoothstep(0.68, 1, progress)
            : 1 - smoothstep(0, 0.3, progress);
        if (flare > 0) {
            const warm = mode === 'home';
            const pale = warm ? '255,243,218' : '231,239,255';
            const glowRadius = maxRadius * (departing
                ? 0.08 + easeInCubic(progress) * 1.05
                : 1.1 - easeOutCubic(progress) * 0.86);
            const glow = context.createRadialGradient(
                origin.x,
                origin.y,
                0,
                origin.x,
                origin.y,
                Math.max(1, glowRadius)
            );
            glow.addColorStop(0, `rgba(${pale},${0.98 * flare})`);
            glow.addColorStop(0.22, `rgba(${pale},${0.62 * flare})`);
            glow.addColorStop(1, `rgba(${pale},0)`);
            context.fillStyle = glow;
            context.fillRect(0, 0, width, height);
            context.fillStyle = `rgba(${pale},${flare * (departing ? 0.72 : 0.42)})`;
            context.fillRect(0, 0, width, height);
        }
    }

    function cancelPendingNavigation() {
        if (!pendingNavigation) return;
        pendingNavigation.cancelled = true;
        window.clearTimeout(pendingNavigation.watchdog);
        pendingNavigation = null;
        navigationGeneration += 1;
    }

    function cancelPendingArrival() {
        arrivalGeneration += 1;
        window.clearTimeout(arrivalTimer);
        arrivalTimer = 0;
        if (pendingArrivalBegin) {
            window.removeEventListener('stellar:destination-ready', pendingArrivalBegin);
            pendingArrivalBegin = null;
        }
    }

    function cleanup() {
        cancelAnimationFrame(frame);
        frame = 0;
        const resolveAnimation = animationResolve;
        animationResolve = null;
        resolveAnimation?.(false);
        cancelPendingArrival();
        cancelPendingNavigation();
        layer?.remove();
        layer = null;
        canvas = null;
        context = null;
        active = false;
        setPageBusy(false);
        document.documentElement.classList.remove('stellar-arrival-pending');
    }

    function animate(kind, options = {}) {
        if (active) return Promise.resolve(false);
        active = true;
        const mode = options.mode === 'home' ? 'home' : 'cool';
        const origin = resolveOrigin(options.origin);
        const particles = createParticles(mode);
        const duration = REDUCED_MOTION
            ? 160
            : (options.duration || (kind === 'depart' ? 920 : 980));
        createLayer(kind);
        setPageBusy(true);

        return new Promise(resolve => {
            let settled = false;
            const finish = value => {
                if (settled) return;
                settled = true;
                if (animationResolve === finish) animationResolve = null;
                resolve(value);
            };
            animationResolve = finish;
            const startedAt = performance.now();
            const render = time => {
                const progress = clamp((time - startedAt) / duration, 0, 1);
                try {
                    drawFrame(kind, progress, origin, particles, mode);
                } catch (error) {
                    console.error('Stellar transition rendering failed:', error);
                    if (kind === 'arrive') cleanup();
                    finish(false);
                    return;
                }
                if (progress >= 1) {
                    finish(true);
                    if (kind === 'arrive') {
                        cleanup();
                        window.dispatchEvent(new CustomEvent('stellar:arrival-complete', {
                            detail: { page: PAGE }
                        }));
                    }
                    return;
                }
                frame = requestAnimationFrame(render);
            };
            frame = requestAnimationFrame(render);
        });
    }

    async function navigate(options = {}) {
        if (active || !options.href || !options.to) return false;
        const navigation = {
            cancelled: false,
            committed: false,
            generation: navigationGeneration + 1,
            watchdog: 0
        };
        navigationGeneration = navigation.generation;
        pendingNavigation = navigation;
        const commitNavigation = () => {
            if (
                navigation.cancelled ||
                navigation.committed ||
                navigation.generation !== navigationGeneration
            ) return false;
            navigation.committed = true;
            writePayload(options.to, options.mode === 'home' ? 'home' : 'cool');
            if (Number.isInteger(options.historyDelta) && options.historyDelta !== 0) {
                const hrefBeforeNavigation = window.location.href;
                window.history.go(options.historyDelta);
                window.setTimeout(() => {
                    if (window.location.href === hrefBeforeNavigation) {
                        window.location.assign(options.href);
                    }
                }, 700);
                return true;
            }
            window.location.assign(options.href);
            return true;
        };
        const expectedDuration = REDUCED_MOTION ? 160 : (options.duration || 920);
        navigation.watchdog = window.setTimeout(commitNavigation, expectedDuration + 650);
        try {
            await animate('depart', options);
        } finally {
            window.clearTimeout(navigation.watchdog);
            commitNavigation();
            if (pendingNavigation === navigation) pendingNavigation = null;
        }
        return !navigation.cancelled;
    }

    function markDestinationReady(page = PAGE, detail = {}) {
        if (page !== PAGE) return false;
        destinationReady = true;
        window.dispatchEvent(new CustomEvent('stellar:destination-ready', {
            detail: { ...detail, page }
        }));
        return true;
    }

    function setDestinationStatus(message, visualLabel = 'ALIGNING DESTINATION') {
        if (!layer?.isConnected) return false;
        layer.setAttribute('aria-label', message || visualLabel);
        layer.setAttribute('data-status-label', visualLabel);
        layer.setAttribute('data-waiting', 'true');
        return true;
    }

    function prepareArrival(payload) {
        if (!payload || active) return;
        cancelPendingArrival();
        const generation = arrivalGeneration;
        active = true;
        const mode = payload.mode === 'home' ? 'home' : 'cool';
        const origin = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
        const particles = createParticles(mode);
        createLayer('arrive');
        setPageBusy(true);
        try {
            drawFrame('arrive', 0, origin, particles, mode);
        } catch (error) {
            console.error('Stellar arrival rendering failed:', error);
            cleanup();
            return;
        }
        document.documentElement.classList.remove('stellar-arrival-pending');

        let started = false;
        const begin = () => {
            if (started || generation !== arrivalGeneration) return;
            started = true;
            window.clearTimeout(arrivalTimer);
            arrivalTimer = 0;
            window.removeEventListener('stellar:destination-ready', begin);
            if (pendingArrivalBegin === begin) pendingArrivalBegin = null;
            layer?.removeAttribute('data-waiting');
            layer?.removeAttribute('data-status-label');
            layer?.setAttribute('aria-label', 'Destination acquired');
            active = false;
            try {
                animate('arrive', { mode, origin }).catch(cleanup);
            } catch (error) {
                console.error('Stellar arrival could not start:', error);
                cleanup();
            }
        };
        pendingArrivalBegin = begin;
        if (destinationReady) {
            queueMicrotask(begin);
        } else {
            window.addEventListener('stellar:destination-ready', begin);
            arrivalTimer = window.setTimeout(() => {
                if (generation !== arrivalGeneration) return;
                arrivalTimer = 0;
                setDestinationStatus('Still aligning destination');
            }, 12000);
        }
    }

    window.StellarTransit = {
        navigate,
        markDestinationReady,
        setDestinationStatus,
        arrive(options) {
            return animate('arrive', options);
        },
        reset: cleanup,
        get destinationReady() {
            return destinationReady;
        },
        get active() {
            return active;
        }
    };

    window.addEventListener('resize', resize);
    window.addEventListener('pagehide', () => {
        cancelPendingNavigation();
        cancelPendingArrival();
    });
    window.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        cleanup();
        const payload = consumePayload();
        if (payload) {
            prepareArrival(payload);
        }
        window.dispatchEvent(new CustomEvent('stellar:page-restored', {
            detail: { page: PAGE, arrival: Boolean(payload) }
        }));
    });

    const arrival = consumePayload();
    if (arrival) {
        prepareArrival(arrival);
    } else {
        document.documentElement.classList.remove('stellar-arrival-pending');
    }
    window.dispatchEvent(new CustomEvent('stellar:runtime-ready'));
})();
