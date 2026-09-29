const DEEP_SKY_OBSERVATIONS = Object.freeze({
    m31: {
        image: 'assets/deep-sky/m31-galex.webp',
        catalogue: 'MESSIER 31 · NGC 224',
        source: 'https://images.nasa.gov/details/PIA04921',
        reference: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-31/',
        credit: 'NASA / JPL / California Institute of Technology',
        en: {
            title: 'Andromeda', category: 'A galaxy beyond our own',
            description: 'A vast spiral of stars, gas and dust, seen across the space between galaxies. Andromeda and the Milky Way belong to the Local Group.',
            distance: '≈ 2.5 million light-years', type: 'Spiral galaxy', location: 'Andromeda constellation',
            instrument: 'GALEX · ultraviolet',
            observation: 'A mosaic of telescope observations. Ultraviolet light reveals young, hot stars along the spiral arms; the displayed colors represent ultraviolet bands.',
            alt: 'GALEX ultraviolet mosaic of the Andromeda galaxy, with its tilted disk and bright spiral arms.'
        },
        'zh-CN': {
            title: '仙女座星系', category: '银河系之外的星系',
            description: '跨越星系之间的深空，一座由恒星、气体和尘埃组成的巨大旋涡映入眼帘。仙女座星系与银河系同属本星系群。',
            distance: '约 250 万光年', type: '旋涡星系', location: '仙女座方向',
            instrument: 'GALEX · 紫外波段',
            observation: '由望远镜观测拼接而成。紫外光显现出旋臂上年轻、炽热的恒星；图像颜色对应不同的紫外波段。',
            alt: 'GALEX 拍摄的仙女座星系紫外拼接图，呈现倾斜的星系盘与明亮旋臂。'
        },
        'zh-TW': {
            title: '仙女座星系', category: '銀河系之外的星系',
            description: '跨越星系之間的深空，一座由恆星、氣體和塵埃組成的巨大旋渦映入眼簾。仙女座星系與銀河系同屬本星系群。',
            distance: '約 250 萬光年', type: '旋渦星系', location: '仙女座方向',
            instrument: 'GALEX · 紫外波段',
            observation: '由望遠鏡觀測拼接而成。紫外光顯現出旋臂上年輕、熾熱的恆星；影像顏色對應不同的紫外波段。',
            alt: 'GALEX 拍攝的仙女座星系紫外拼接圖，呈現傾斜的星系盤與明亮旋臂。'
        }
    },
    m42: {
        image: 'assets/deep-sky/m42-hubble-spitzer.webp',
        catalogue: 'MESSIER 42 · NGC 1976',
        source: 'https://images.nasa.gov/details/PIA01322',
        reference: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/messier-42/',
        credit: 'NASA / JPL-Caltech / STScI',
        en: {
            title: 'Orion Nebula', category: 'A stellar nursery in the Milky Way',
            description: 'Inside our own galaxy, newborn stars illuminate a cloud of gas and dust beneath Orion’s belt. This is a star-forming nebula, a small part of the Milky Way.',
            distance: '≈ 1,500 light-years', type: 'Emission nebula · H II region', location: 'Orion constellation',
            instrument: 'Hubble + Spitzer · visible / infrared',
            observation: 'Telescope observations combine visible and infrared light. Assigned colors reveal glowing gas, warm dust and stars embedded within the cloud.',
            alt: 'Hubble and Spitzer composite observation of glowing gas, dust and young stars in the Orion Nebula.'
        },
        'zh-CN': {
            title: '猎户座大星云', category: '银河系内的恒星摇篮',
            description: '在我们自己的银河系里，新生恒星照亮了猎户座腰带下方的气体与尘埃。这是一片正在孕育恒星的星云，是银河系的一小部分。',
            distance: '约 1,500 光年', type: '发射星云 · H II 电离氢区', location: '猎户座方向',
            instrument: '哈勃 + 斯皮策 · 可见光 / 红外',
            observation: '由可见光与红外波段的望远镜观测合成。映射后的颜色呈现发光气体、温暖尘埃与藏在云中的恒星。',
            alt: '哈勃与斯皮策合成的猎户座大星云观测图，呈现发光气体、尘埃与年轻恒星。'
        },
        'zh-TW': {
            title: '獵戶座大星雲', category: '銀河系內的恆星搖籃',
            description: '在我們自己的銀河系裡，新生恆星照亮了獵戶座腰帶下方的氣體與塵埃。這是一片正在孕育恆星的星雲，是銀河系的一小部分。',
            distance: '約 1,500 光年', type: '發射星雲 · H II 游離氫區', location: '獵戶座方向',
            instrument: '哈勃 + 史匹哲 · 可見光 / 紅外',
            observation: '由可見光與紅外波段的望遠鏡觀測合成。映射後的顏色呈現發光氣體、溫暖塵埃與藏在雲中的恆星。',
            alt: '哈勃與史匹哲合成的獵戶座大星雲觀測圖，呈現發光氣體、塵埃與年輕恆星。'
        }
    }
});

class DeepSkyMap {
    constructor(map) {
        this.map = map;
        this.active = false;
        this.id = null;
        this.pointers = new Map();
        this.pose = { x: 0, y: 0, scale: 1 };
        this.target = { ...this.pose };
        this.frameTime = 0;
        this.language = null;
    }

    initialize() {
        if (this.element) return;
        const element = document.createElement('section');
        element.id = 'deepSkyView';
        element.className = 'deep-sky-view';
        element.hidden = true;
        element.inert = true;
        element.setAttribute('role', 'dialog');
        element.setAttribute('aria-modal', 'true');
        element.setAttribute('aria-labelledby', 'deepSkyTitle');
        element.innerHTML = '<div class="deep-sky-topbar"><span class="deep-sky-observatory"></span><div class="deep-sky-languages"><button type="button" data-deep-language="en">EN</button><button type="button" data-deep-language="zh-CN">简</button><button type="button" data-deep-language="zh-TW">繁</button></div><button class="deep-sky-close" type="button"><span aria-hidden="true">←</span><span></span><kbd>Esc</kbd></button></div><figure class="deep-sky-figure"><div class="deep-sky-image-viewport"><img class="deep-sky-image" alt="" draggable="false"><p class="deep-sky-image-status" role="status"></p></div><figcaption><span class="deep-sky-image-caption"></span><span class="deep-sky-image-hint"></span></figcaption><div class="deep-sky-image-tools"><button type="button" data-deep-zoom="out">−</button><button type="button" data-deep-zoom="reset">100%</button><button type="button" data-deep-zoom="in">+</button></div></figure><article class="deep-sky-card"><p class="deep-sky-catalogue"></p><h1 id="deepSkyTitle" tabindex="-1"></h1><p class="deep-sky-category"></p><p class="deep-sky-description"></p><dl class="deep-sky-facts"></dl><div class="deep-sky-provenance"><span class="deep-sky-source-kicker"></span><p class="deep-sky-observation"></p><p class="deep-sky-credit"></p><div class="deep-sky-source-links"><a class="deep-sky-source" target="_blank" rel="noopener noreferrer"></a><a class="deep-sky-reference" target="_blank" rel="noopener noreferrer"></a></div></div></article>';
        document.body.appendChild(element);
        this.element = element;
        this.image = element.querySelector('.deep-sky-image');
        this.viewport = element.querySelector('.deep-sky-image-viewport');
        this.status = element.querySelector('.deep-sky-image-status');
        this.image.addEventListener('load', () => {
            element.classList.add('image-ready');
            this.imageFailed = false;
            this.updateCopy();
        });
        this.image.addEventListener('error', () => {
            element.classList.remove('image-ready');
            this.imageFailed = true;
            this.updateCopy();
        });
        element.querySelector('.deep-sky-close').addEventListener('click', () => {
            if (typeof this.map.closeDeepSky === 'function') this.map.closeDeepSky();
            else this.exit();
        });
        element.querySelectorAll('[data-deep-language]').forEach(button => {
            button.addEventListener('click', () => { setLang(button.dataset.deepLanguage); this.updateCopy(); });
        });
        element.querySelectorAll('[data-deep-zoom]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.deepZoom;
                if (action === 'reset') this.target = { x: 0, y: 0, scale: 1 };
                else this.zoom(action === 'in' ? -140 : 140);
            });
        });
        this.viewport.addEventListener('contextmenu', event => event.preventDefault());
        this.viewport.addEventListener('wheel', event => {
            if (!this.active) return;
            event.preventDefault();
            this.zoom(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport.clientHeight : 1));
        }, { passive: false });
        this.viewport.addEventListener('pointerdown', event => {
            if (!this.active || event.pointerType === 'mouse' && event.button !== 2) return;
            event.preventDefault();
            this.viewport.setPointerCapture(event.pointerId);
            this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            this.pinchDistance = null;
            element.classList.add('image-dragging');
        });
        this.viewport.addEventListener('pointermove', event => {
            const pointer = this.pointers.get(event.pointerId);
            if (!pointer) return;
            const deltaX = event.clientX - pointer.x;
            const deltaY = event.clientY - pointer.y;
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            if (this.pointers.size === 2) {
                const [first, second] = [...this.pointers.values()];
                const distance = Math.hypot(first.x - second.x, first.y - second.y);
                if (this.pinchDistance) this.zoom(Math.log(this.pinchDistance / Math.max(1, distance)) / 0.0018);
                this.pinchDistance = distance;
            } else this.orbit(deltaX, deltaY);
        });
        const release = event => {
            this.pointers.delete(event.pointerId);
            this.pinchDistance = null;
            if (!this.pointers.size) element.classList.remove('image-dragging');
        };
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => this.viewport.addEventListener(name, release));
        element.addEventListener('keydown', event => {
            if (this.handleKey(event)) {
                event.stopPropagation();
                return;
            }
            if (event.key !== 'Tab' || !this.active) return;
            const controls = [...element.querySelectorAll('button, a[href]')].filter(control => !control.disabled && !control.hidden);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) {
                event.preventDefault();
                first.focus();
            }
        });
    }

    enter(identifier) {
        const aliases = { andromeda: 'm31', orion: 'm42', 'orion-nebula': 'm42', M31: 'm31', M42: 'm42' };
        const id = aliases[identifier] || identifier;
        if (!DEEP_SKY_OBSERVATIONS[id]) return false;
        this.initialize();
        if (!this.active) {
            this.returnFocus = document.activeElement;
            this.backgroundElements = [...document.body.children]
                .filter(element => element !== this.element && !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName))
                .map(element => ({ element, inert: element.inert }));
            this.backgroundElements.forEach(entry => { entry.element.inert = true; });
        }
        this.map.clearInput?.();
        this.id = id;
        this.active = true;
        this.language = null;
        this.pose = { x: 0, y: 0, scale: REDUCED_MOTION ? 1 : 1.065 };
        this.target = { x: 0, y: 0, scale: 1 };
        this.frameTime = 0;
        this.imageFailed = false;
        this.element.dataset.object = id;
        this.element.classList.remove('image-ready');
        this.element.hidden = false;
        this.element.inert = false;
        state.scene = 'deep-sky';
        document.body.classList.add('deep-sky-open');
        this.image.src = DEEP_SKY_OBSERVATIONS[id].image;
        this.updateCopy();
        this.resize();
        this.element.querySelector('#deepSkyTitle').focus({ preventScroll: true });
        return true;
    }

    exit() {
        if (!this.active) return false;
        this.active = false;
        for (const pointerId of this.pointers.keys()) {
            if (this.viewport.hasPointerCapture(pointerId)) this.viewport.releasePointerCapture(pointerId);
        }
        this.pointers.clear();
        this.element.hidden = true;
        this.element.inert = true;
        this.element.classList.remove('image-dragging');
        document.body.classList.remove('deep-sky-open');
        this.backgroundElements.forEach(entry => { entry.element.inert = entry.inert; });
        state.scene = 'roam';
        if (this.returnFocus?.isConnected && !this.returnFocus.closest('[inert]')) this.returnFocus.focus({ preventScroll: true });
        return true;
    }

    updateCopy() {
        if (!this.id || !this.element) return;
        const language = state.currentLang || 'en';
        const observation = DEEP_SKY_OBSERVATIONS[this.id];
        const copy = observation[language] || observation.en;
        const labels = ({
            en: { observatory: 'DEEP SKY / OBSERVATIONS', close: 'Return to star map', distance: 'Distance from Earth', type: 'Object type', location: 'In our sky', source: 'THE OBSERVATION', image: 'NASA image ↗', reference: 'Object reference ↗', hint: 'Right-drag to pan · scroll to zoom', touch: 'Drag to pan · pinch to zoom', loading: 'Receiving the observation…', error: 'Image unavailable. The original observation is linked alongside.', out: 'Zoom out', reset: 'Reset image', in: 'Zoom in' },
            'zh-CN': { observatory: '深空 / 观测', close: '返回星图', distance: '距地球', type: '天体类型', location: '天空方位', source: '这幅观测图', image: 'NASA 原图 ↗', reference: '天体资料 ↗', hint: '右键拖动平移 · 滚轮缩放', touch: '拖动平移 · 双指缩放', loading: '正在载入观测图…', error: '图像暂时无法加载，可通过旁侧链接查看原始观测。', out: '缩小图像', reset: '复位图像', in: '放大图像' },
            'zh-TW': { observatory: '深空 / 觀測', close: '返回星圖', distance: '距地球', type: '天體類型', location: '天空方位', source: '這幅觀測圖', image: 'NASA 原圖 ↗', reference: '天體資料 ↗', hint: '右鍵拖曳平移 · 滾輪縮放', touch: '拖曳平移 · 雙指縮放', loading: '正在載入觀測圖…', error: '影像暫時無法載入，可透過旁側連結查看原始觀測。', out: '縮小影像', reset: '復位影像', in: '放大影像' }
        })[language] || null;
        if (!labels) return;
        const set = (selector, value) => { this.element.querySelector(selector).textContent = value; };
        set('.deep-sky-observatory', labels.observatory);
        set('.deep-sky-close span:nth-child(2)', labels.close);
        this.element.querySelector('.deep-sky-close').setAttribute('aria-label', labels.close);
        set('.deep-sky-catalogue', observation.catalogue);
        set('#deepSkyTitle', copy.title);
        set('.deep-sky-category', copy.category);
        set('.deep-sky-description', copy.description);
        set('.deep-sky-source-kicker', labels.source);
        set('.deep-sky-observation', copy.observation);
        set('.deep-sky-credit', observation.credit);
        set('.deep-sky-image-caption', copy.instrument);
        set('.deep-sky-image-hint', COARSE_POINTER ? labels.touch : labels.hint);
        this.image.alt = copy.alt;
        this.status.textContent = this.imageFailed ? labels.error : this.element.classList.contains('image-ready') ? '' : labels.loading;
        const facts = this.element.querySelector('.deep-sky-facts');
        facts.replaceChildren();
        for (const field of ['distance', 'type', 'location']) {
            const term = document.createElement('dt');
            const detail = document.createElement('dd');
            term.textContent = labels[field];
            detail.textContent = copy[field];
            facts.append(term, detail);
        }
        for (const [selector, text, href] of [['.deep-sky-source', labels.image, observation.source], ['.deep-sky-reference', labels.reference, observation.reference]]) {
            const link = this.element.querySelector(selector);
            link.textContent = text;
            link.href = href;
        }
        this.element.querySelectorAll('[data-deep-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.deepLanguage === language)));
        this.element.querySelectorAll('[data-deep-zoom]').forEach(button => button.setAttribute('aria-label', labels[button.dataset.deepZoom]));
        this.language = language;
    }

    orbit(deltaX, deltaY) {
        if (!this.active) return;
        const limit = Math.max(12, (this.target.scale - 1) * this.imageSize * 0.45);
        this.target.x = clamp(this.target.x + deltaX, -limit, limit);
        this.target.y = clamp(this.target.y + deltaY, -limit, limit);
    }

    handleKey(event) {
        if (!this.active || event.defaultPrevented) return false;
        if (event.key === 'Escape') {
            event.preventDefault();
            if (typeof this.map.closeDeepSky === 'function') this.map.closeDeepSky();
            else this.exit();
            return true;
        }
        if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select')) return false;
        const arrows = { ArrowLeft: [22, 0], ArrowRight: [-22, 0], ArrowUp: [0, 22], ArrowDown: [0, -22] };
        if (arrows[event.key]) this.orbit(...arrows[event.key]);
        else if (event.key === '+' || event.key === '=') this.zoom(-110);
        else if (event.key === '-') this.zoom(110);
        else if (event.key === '0') this.target = { x: 0, y: 0, scale: 1 };
        else return false;
        event.preventDefault();
        return true;
    }

    zoom(delta) {
        if (!this.active) return;
        this.target.scale = clamp(this.target.scale * Math.exp(clamp(delta, -250, 250) * -0.0018), 1, 3);
        const limit = Math.max(12, (this.target.scale - 1) * this.imageSize * 0.45);
        this.target.x = clamp(this.target.x, -limit, limit);
        this.target.y = clamp(this.target.y, -limit, limit);
    }

    resize() {
        if (!this.active) return;
        this.imageSize = Math.min(this.viewport.clientWidth, this.viewport.clientHeight);
        this.image.style.width = `${this.imageSize}px`;
        this.image.style.height = `${this.imageSize}px`;
        this.orbit(0, 0);
    }

    render(time) {
        if (!this.active) return;
        if (this.language !== state.currentLang) this.updateCopy();
        const elapsed = this.frameTime ? Math.min(64, Math.max(0, time - this.frameTime)) : 16;
        this.frameTime = time;
        const easing = REDUCED_MOTION ? 1 : 1 - Math.exp(-elapsed / 115);
        for (const field of ['x', 'y', 'scale']) this.pose[field] += (this.target[field] - this.pose[field]) * easing;
        this.image.style.transform = `translate3d(calc(-50% + ${this.pose.x.toFixed(2)}px), calc(-50% + ${this.pose.y.toFixed(2)}px), 0) scale(${this.pose.scale.toFixed(4)})`;
        this.element.querySelector('[data-deep-zoom="reset"]').textContent = `${Math.round(this.target.scale * 100)}%`;
    }
}
