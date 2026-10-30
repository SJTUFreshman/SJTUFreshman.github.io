const GALACTIC_SPACE = Object.freeze({
    solar: Object.freeze([-47, 10, 6]),
    center: Object.freeze([-47, -10.8, 8184]),
    parsecsPerDiskUnit: 40,
    radius: 16000,
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
        this.element = document.createElement('nav');
        this.element.className = 'galactic-navigation';
        this.element.innerHTML = '<output class="galactic-distance"></output><div class="galactic-tools"><button type="button" data-map-action="out">−</button><button type="button" data-map-action="in">+</button><button type="button" data-map-action="reset"></button></div>';
        document.body.append(this.element);
        this.element.addEventListener('click', event => {
            const action = event.target.closest('[data-map-action]')?.dataset.mapAction;
            if (!action || !this.map.canMove()) return;
            if (action === 'reset') this.map.reset();
            else this.map.zoom(action === 'in' ? -120 : 120);
            dom.world.focus({ preventScroll: true });
        });
        this.updateCopy();
    }

    update(time) {
        this.element.hidden = state.scene !== 'roam' || state.modalOpen || state.sectionDrawerOpen;
        const view = this.map.view();
        const solarDistance = Math.hypot(...view.position.map((value, axis) => value - GALACTIC_SPACE.solar[axis]));
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
            en: ['View controls', 'Initial view', 'Zoom in', 'Zoom out'],
            'zh-CN': ['视角控制', '初始视角', '拉近', '拉远'],
            'zh-TW': ['視角控制', '初始視角', '拉近', '拉遠']
        }[language] || [];
        this.element.setAttribute('aria-label', copy[0]);
        this.element.querySelector('[data-map-action="reset"]').textContent = copy[1];
        this.element.querySelector('[data-map-action="in"]').setAttribute('aria-label', copy[2]);
        this.element.querySelector('[data-map-action="out"]').setAttribute('aria-label', copy[3]);
    }
}
