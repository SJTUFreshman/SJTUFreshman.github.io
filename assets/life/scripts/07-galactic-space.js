const GALACTIC_SPACE = Object.freeze({
    solar: Object.freeze([-47, 10, 6]),
    center: Object.freeze([-47, -10.8, 8184]),
    parsecsPerDiskUnit: 40,
    radius: 16000,
    travelLimit: 2000000,
    localVisibility(position) {
        return 1 - smoothstep(900, 8000, Math.hypot(...position.map((value, axis) => value - this.solar[axis])));
    },
    photographicVisibility(position) {
        return 1 - smoothstep(650, 4500, Math.hypot(...position.map((value, axis) => value - this.solar[axis])));
    },
    toDisk(position) {
        return position.map((value, axis) => (value - this.center[axis]) / this.parsecsPerDiskUnit);
    },
    fromDisk(position) {
        return position.map((value, axis) => this.center[axis] + value * this.parsecsPerDiskUnit);
    }
});

class GalacticNavigation {
    constructor(map) {
        this.map = map;
        this.keys = new Set();
        this.velocity = [0, 0, 0];
        this.freeFlight = false;
        this.element = document.createElement('nav');
        this.element.className = 'galactic-navigation';
        this.element.innerHTML = '<output class="galactic-distance"></output><div class="galactic-tools"><button type="button" data-flight-action="out">−</button><button type="button" data-flight-action="in">+</button><button type="button" data-flight-action="mode" aria-pressed="false"></button><button type="button" data-flight-action="reset"></button></div><div class="galactic-pad" hidden><button type="button" data-flight-key="KeyQ">↓</button><button type="button" data-flight-key="KeyW">↑</button><button type="button" data-flight-key="KeyE">↑</button><button type="button" data-flight-key="KeyA">←</button><button type="button" data-flight-key="KeyS">↓</button><button type="button" data-flight-key="KeyD">→</button></div>';
        document.body.append(this.element);
        this.element.addEventListener('click', event => {
            const action = event.target.closest('[data-flight-action]')?.dataset.flightAction;
            if (!action || !this.map.canMove()) return;
            this.clear();
            if (action === 'reset') this.map.reset();
            else if (action === 'mode') this.setMode(!this.freeFlight);
            else this.map.zoom(action === 'in' ? -120 : 120);
            dom.world.focus({ preventScroll: true });
        });
        const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
        document.addEventListener('keydown', event => {
            if (event.code === 'Escape') { this.clear(); return; }
            if (!movementCodes.has(event.code) && !['ShiftLeft', 'ShiftRight'].includes(event.code)) return;
            if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing || !this.allowed()) return;
            if (event.target instanceof Element && event.target.closest('input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
            if (movementCodes.has(event.code)) {
                event.preventDefault();
                this.setMode(true);
            }
            this.keys.add(event.code);
        });
        document.addEventListener('keyup', event => this.keys.delete(event.code));
        document.addEventListener('focusin', event => {
            if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], dialog')) this.clear();
        });
        window.addEventListener('blur', () => this.clear());
        window.addEventListener('pagehide', () => this.clear());
        this.element.querySelectorAll('[data-flight-key]').forEach(button => {
            button.addEventListener('pointerdown', event => {
                if (!this.allowed()) return;
                event.preventDefault();
                this.setMode(true);
                button.setPointerCapture(event.pointerId);
                this.keys.add(button.dataset.flightKey);
            });
            const release = () => this.keys.delete(button.dataset.flightKey);
            for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, release);
        });
        this.updateCopy();
    }

    allowed() {
        return this.map.canMove() && !state.sectionDrawerOpen && !document.hidden
            && !document.querySelector('.map-about[open]');
    }

    clear() {
        this.keys.clear();
        this.velocity.fill(0);
    }

    setMode(freeFlight) {
        if (this.freeFlight === freeFlight) return;
        this.freeFlight = freeFlight;
        this.map.labelLayout.clear();
        this.map.updateCopy();
    }

    tick(delta, time) {
        const available = this.allowed();
        this.element.hidden = state.scene !== 'roam' || state.modalOpen || state.sectionDrawerOpen;
        if (!available) this.clear();
        const view = this.map.view();
        const solarDistance = Math.hypot(...view.position.map((value, axis) => value - GALACTIC_SPACE.solar[axis]));
        const horizontal = Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA'));
        const forward = Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS'));
        const vertical = Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'));
        const length = Math.hypot(horizontal, forward, vertical);
        const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3 : 1;
        const speed = Math.min(80000, Math.max(160, solarDistance) * 0.55) * boost;
        const response = REDUCED_MOTION ? 1 : 1 - Math.exp(-delta * 10);
        for (let axis = 0; axis < 3; axis++) {
            const desired = length ? (view.right[axis] * horizontal + view.forward[axis] * forward + view.up[axis] * vertical) / length * speed : 0;
            this.velocity[axis] = lerp(this.velocity[axis], desired, response);
        }
        if (available && Math.hypot(...this.velocity) > 0.02) {
            const nextCenter = this.map.center.map((value, axis) => value + this.velocity[axis] * delta);
            const nextTarget = this.map.target.center.map((value, axis) => value + this.velocity[axis] * delta);
            if (Math.hypot(...nextCenter) < GALACTIC_SPACE.travelLimit && Math.hypot(...nextTarget) < GALACTIC_SPACE.travelLimit) {
                this.map.center = nextCenter;
                this.map.target.center = nextTarget;
            } else this.clear();
            this.map.lastInputTime = time;
        }
        if (time - (this.lastReadout || 0) > 120) {
            const language = state.currentLang;
            const lightYears = solarDistance * 3.26156;
            const distance = lightYears >= 10000 ? `${(lightYears / 1000).toFixed(1)} ${language === 'en' ? 'kly' : '千光年'}`
                : `${Math.round(lightYears).toLocaleString(language)} ${language === 'en' ? 'ly' : '光年'}`;
            const text = `${language === 'en' ? 'From the Sun' : language === 'zh-TW' ? '距太陽' : '距太阳'} · ≈ ${distance}`;
            this.element.querySelector('output').textContent = text;
            this.lastReadout = time;
        }
    }

    updateCopy() {
        const language = state.currentLang;
        const copy = {
            en: ['Camera controls', 'Free flight', 'Orbit', 'Initial view', 'Move closer', 'Move farther', 'Descend', 'Forward', 'Ascend', 'Left', 'Backward', 'Right'],
            'zh-CN': ['摄像机控制', '自由飞行', '环绕观察', '初始视角', '拉近', '拉远', '下降', '前进', '上升', '向左', '后退', '向右'],
            'zh-TW': ['攝影機控制', '自由飛行', '環繞觀察', '初始視角', '拉近', '拉遠', '下降', '前進', '上升', '向左', '後退', '向右']
        }[language] || [];
        this.element.setAttribute('aria-label', copy[0]);
        const mode = this.element.querySelector('[data-flight-action="mode"]');
        mode.textContent = this.freeFlight ? copy[2] : copy[1];
        mode.setAttribute('aria-label', this.freeFlight ? copy[2] : copy[1]);
        mode.setAttribute('aria-pressed', String(this.freeFlight));
        this.element.querySelector('[data-flight-action="reset"]').textContent = copy[3];
        this.element.querySelector('[data-flight-action="in"]').setAttribute('aria-label', copy[4]);
        this.element.querySelector('[data-flight-action="out"]').setAttribute('aria-label', copy[5]);
        this.element.querySelectorAll('[data-flight-key]').forEach((button, index) => {
            button.setAttribute('aria-label', copy[index + 6]);
            button.textContent = copy[index + 6];
        });
        this.element.querySelector('.galactic-pad').hidden = !COARSE_POINTER || !this.freeFlight;
    }
}
