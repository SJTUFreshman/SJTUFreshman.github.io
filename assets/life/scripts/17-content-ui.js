const thoughtToggleLabels = {
    en: { more: 'Read more', less: 'Collapse' },
    'zh-CN': { more: '展开', less: '收起' },
    'zh-TW': { more: '展開', less: '收起' }
};

const lightboxLabels = {
    en: {
        viewer: 'Gallery image viewer',
        close: 'Close image viewer',
        previous: 'Previous image',
        next: 'Next image'
    },
    'zh-CN': {
        viewer: '照片查看器',
        close: '关闭照片查看器',
        previous: '上一张照片',
        next: '下一张照片'
    },
    'zh-TW': {
        viewer: '照片檢視器',
        close: '關閉照片檢視器',
        previous: '上一張照片',
        next: '下一張照片'
    }
};

function updateThoughtToggles() {
    const labels = thoughtToggleLabels[state.currentLang] || thoughtToggleLabels.en;
    document.querySelectorAll('[data-thought-toggle]').forEach(button => {
        const text = button.previousElementSibling;
        if (!text) return;
        const expanded = button.getAttribute('aria-expanded') === 'true';
        text.classList.toggle('thought-text-expanded', expanded);
        text.classList.toggle('thought-text-collapsed', !expanded);
        button.textContent = expanded ? labels.less : labels.more;
    });
}

const citationResetTimers = new WeakMap();

async function writeClipboardText(value) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard copy was unavailable');
}

function updateCitationButtons() {
    const data = i18n[state.currentLang] || i18n.en || {};
    document.querySelectorAll('[data-copy-citation]').forEach(button => {
        const label = button.querySelector('[data-key="life_action_cite"]');
        if (!label) return;
        label.textContent = button.dataset.copyState === 'copied'
            ? (data.life_action_copied || 'Copied')
            : (data.life_action_cite || 'Cite');
    });
}

document.addEventListener('click', event => {
    const citeButton = event.target.closest('[data-copy-citation]');
    if (citeButton) {
        const source = citeButton.closest('[data-portal-entry]')?.querySelector('[data-citation-source]');
        const citation = source?.textContent.trim() || '';
        if (!citation) return;
        event.preventDefault();
        writeClipboardText(citation).then(() => {
            window.clearTimeout(citationResetTimers.get(citeButton));
            citeButton.dataset.copyState = 'copied';
            updateCitationButtons();
            const timer = window.setTimeout(() => {
                delete citeButton.dataset.copyState;
                updateCitationButtons();
                citationResetTimers.delete(citeButton);
            }, 1500);
            citationResetTimers.set(citeButton, timer);
        }).catch(() => {});
        return;
    }

    const button = event.target.closest('[data-thought-toggle]');
    if (!button) return;
    const expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    updateThoughtToggles();
});

function updateActivePortalCopy() {
    const portal = state.activePortal || state.focusedPortal;
    if (!portal) return;
    if (state.focusedPortal) renderGazeCopy(state.focusedPortal);
    if (state.activePortal && state.scene === 'detail') {
        const activePortal = state.activePortal;
        dom.panelKicker.textContent =
            (starUiCopy[state.currentLang] || starUiCopy.en).sectionKicker;
        dom.panelTitle.textContent = portalName(activePortal, state.currentLang);
        dom.panelNames.textContent = LANGUAGES.map(lang => portalName(activePortal, lang)).join(' / ');
        if (activePortal.home && state.routePreview) {
            activePortal.starButtons.forEach((_button, hip) =>
                updateStarButtonCopy(activePortal, hip)
            );
            renderHomeRoutePreviewCopy();
        } else if (state.activeStarHip && !activePortal.home) {
            selectPortalStar(activePortal, state.activeStarHip);
        } else {
            showConstellationOverview(activePortal);
        }
    }
}

function updateMapAccessibility() {
    const data = i18n[state.currentLang] || i18n.en || {};
    const countries = visitedCountries.map(country =>
        country.label?.[state.currentLang] || country.label?.en || country.map_name
    );
    const summary = document.getElementById('visitedCountriesSummary');
    if (summary) summary.textContent = `${data.chart_world || 'Countries visited'}: ${countries.join(', ')}`;
    const chinaMap = document.getElementById('chinaMap');
    if (chinaMap) {
        const label = {
            en: 'Cities visited in Mainland China',
            'zh-CN': '中国大陆到访城市',
            'zh-TW': '中國大陸到訪城市'
        }[state.currentLang];
        chinaMap.setAttribute('aria-label', label);
    }
}

function setLang(lang) {
    state.currentLang = LANGUAGES.includes(lang) ? lang : 'en';
    localStorage.setItem('preferredLang', state.currentLang);
    document.documentElement.lang = state.currentLang;
    LANGUAGES.forEach(value => dom.body.classList.remove(`lang-${value}`));
    dom.body.classList.add(`lang-${state.currentLang}`);
    const data = i18n[state.currentLang] || i18n.en || {};
    dom.starNav.setAttribute(
        'aria-label',
        (starUiCopy[state.currentLang] || starUiCopy.en).choose
    );

    document.querySelectorAll('[data-key]').forEach(element => {
        const key = element.dataset.key;
        if (data[key] !== undefined) element.textContent = data[key];
    });
    document.querySelectorAll('.lang-btn').forEach(button => {
        button.classList.toggle('active', button.dataset.lang === state.currentLang);
    });
    portalDefinitions.forEach(portal => {
        portal.button?.setAttribute(
            'aria-label',
            LANGUAGES.map(value => portalName(portal, value)).join(' / ')
        );
    });
    document.querySelectorAll('.gallery-item').forEach(item => {
        const caption = item.querySelector('.gallery-caption');
        if (caption) item.setAttribute('aria-label', caption.textContent.trim());
    });

    const labels = lightboxLabels[state.currentLang] || lightboxLabels.en;
    dom.lightbox.setAttribute('aria-label', labels.viewer);
    dom.lightbox.querySelector('.lightbox-close').setAttribute('aria-label', labels.close);
    dom.lightbox.querySelector('.lightbox-prev').setAttribute('aria-label', labels.previous);
    dom.lightbox.querySelector('.lightbox-next').setAttribute('aria-label', labels.next);
    dom.panelClose.setAttribute('aria-label', data.panel_close || 'Return to the galaxy');
    updateEntryLocationCopy();

    if (!dom.entryGate.classList.contains('is-hidden')) {
        const resume = state.hasEntered && state.lock === 'suspended';
        dom.entryTitle.textContent = resume
            ? (data.resume_view || 'Click to return to free look')
            : (data.enter_galaxy || 'Enter the galaxy');
        dom.entryHint.textContent = state.lockFailureCount > 0
            ? (data.lock_failed_hint || 'Pointer lock was blocked. Retry or continue with drag controls.')
            : (data.enter_hint || 'Click once to take control of the view');
    }

    updateMapAccessibility();
    updateThoughtToggles();
    updateCitationButtons();
    updateCelestialNavigationCopy();
    updateSectionDrawerCopy();
    updateActivePortalCopy();
    if (state.focusedCelestial) renderCelestialGazeCopy(state.focusedCelestial);
    if (state.activeCelestial) renderCelestialPanel(state.activeCelestial);
    updateMapLanguage();
}

document.querySelectorAll('.lang-btn').forEach(button => {
    button.addEventListener('click', () => setLang(button.dataset.lang));
});

let mapsInitializing = false;
let mapsReady = false;
let chinaMapChart = null;
let worldMapChart = null;

function waitForECharts(timeout = 7000) {
    const started = performance.now();
    return new Promise((resolve, reject) => {
        const check = () => {
            if (window.echarts) {
                resolve(window.echarts);
                return;
            }
            if (performance.now() - started > timeout) {
                reject(new Error('ECharts did not load'));
                return;
            }
            window.setTimeout(check, 100);
        };
        check();
    });
}

function worldSeriesData() {
    return visitedCountries.map(country => {
        const displayName = country.label?.[state.currentLang] || country.label?.en || country.map_name;
        return {
            name: country.map_name,
            value: 1,
            itemStyle: { areaColor: '#30343a' },
            emphasis: { itemStyle: { areaColor: '#51575f' } },
            label: {
                show: true,
                formatter: displayName,
                color: '#fff',
                fontFamily: '"IBM Plex Sans", "PingFang SC", "Microsoft YaHei UI", sans-serif',
                fontSize: 9
            }
        };
    });
}

function currentCountrySummary() {
    return document.getElementById('visitedCountriesSummary')?.textContent ||
        'Mainland China and Taiwan';
}

function mapFailure(element, error) {
    console.error('Map failed:', error);
    element.innerHTML = '<div style="height:100%;display:grid;place-items:center;color:#999;font:12px IBM Plex Sans,sans-serif;">Map unavailable</div>';
}

function footprintsMapIsVisible() {
    const entry = document.querySelector('[data-portal-entry="footprints-map"]');
    return Boolean(
        entry &&
        !entry.hidden &&
        state.scene === 'detail' &&
        state.activePortal?.id === 'footprints'
    );
}

async function initMaps() {
    if (!footprintsMapIsVisible()) return;
    if (mapsReady || mapsInitializing) {
        resizeMaps();
        return;
    }
    mapsInitializing = true;
    const chinaElement = document.getElementById('chinaMap');
    const worldElement = document.getElementById('worldMap');
    try {
        const echarts = await waitForECharts();
        const [chinaResponse, worldResponse] = await Promise.all([
            fetch('assets/maps/china_city_full.json'),
            fetch('assets/maps/world.json')
        ]);
        if (!chinaResponse.ok || !worldResponse.ok) {
            throw new Error(`Map HTTP ${chinaResponse.status}/${worldResponse.status}`);
        }
        const [chinaGeoJson, worldGeoJson] = await Promise.all([
            chinaResponse.json(),
            worldResponse.json()
        ]);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (!footprintsMapIsVisible()) {
            mapsInitializing = false;
            return;
        }
        echarts.getInstanceByDom(chinaElement)?.dispose();
        echarts.getInstanceByDom(worldElement)?.dispose();
        chinaElement.replaceChildren();
        worldElement.replaceChildren();
        chinaMapChart = echarts.init(chinaElement, null, { renderer: 'canvas' });
        worldMapChart = echarts.init(worldElement, null, { renderer: 'canvas' });

        const cityFeatures = [];
        const districtByParent = new Map();
        for (const feature of chinaGeoJson.features) {
            const properties = feature.properties || {};
            if (properties.level === 'city') {
                cityFeatures.push(feature);
            } else if (
                properties.level === 'province' &&
                (properties.name === '台湾省' || properties.name === '臺灣省')
            ) {
                cityFeatures.push(feature);
            } else if (
                properties.level === 'district' &&
                properties.parent?.adcode
            ) {
                const key = String(properties.parent.adcode);
                if (!districtByParent.has(key)) districtByParent.set(key, []);
                districtByParent.get(key).push(feature);
            }
        }

        const municipalities = new Map([
            ['北京市', '110000'],
            ['上海市', '310000'],
            ['天津市', '120000'],
            ['重庆市', '500000']
        ]);
        const cityNames = new Set(cityFeatures.map(feature => feature.properties?.name).filter(Boolean));
        const visitedExpanded = new Set();
        visited.forEach(name => {
            if (!municipalities.has(name) || cityNames.has(name)) {
                visitedExpanded.add(name);
                return;
            }
            const districts = districtByParent.get(municipalities.get(name));
            if (districts?.length) {
                districts.forEach(feature => visitedExpanded.add(feature.properties.name));
            } else {
                visitedExpanded.add(name);
            }
        });

        const mergedFeatures = [...cityFeatures];
        municipalities.forEach(adcode => {
            if (districtByParent.has(adcode)) mergedFeatures.push(...districtByParent.get(adcode));
        });
        echarts.registerMap('china_life_cities', {
            type: 'FeatureCollection',
            features: mergedFeatures
        });
        echarts.registerMap('world_life_footprints', worldGeoJson);

        chinaMapChart.setOption({
            animation: !REDUCED_MOTION,
            backgroundColor: 'transparent',
            tooltip: { trigger: 'item' },
            aria: {
                enabled: true,
                label: { enabled: true, description: document.getElementById('chinaMap').getAttribute('aria-label') }
            },
            series: [{
                type: 'map',
                map: 'china_life_cities',
                roam: true,
                center: [104, 35],
                zoom: 0.95,
                scaleLimit: { min: 0.9, max: 2.5 },
                label: { show: false },
                itemStyle: { areaColor: '#f1efe9', borderColor: '#d3d0c8', borderWidth: 0.7 },
                emphasis: { itemStyle: { areaColor: '#dad7cf' }, label: { show: false } },
                data: Array.from(visitedExpanded).map(name => ({
                    name,
                    itemStyle: { areaColor: '#30343a' }
                }))
            }]
        });

        worldMapChart.setOption({
            animation: !REDUCED_MOTION,
            backgroundColor: 'transparent',
            tooltip: {
                trigger: 'item',
                formatter: params => {
                    const country = visitedCountries.find(item => item.map_name === params.name);
                    return country
                        ? (country.label?.[state.currentLang] || country.label?.en || params.name)
                        : params.name;
                }
            },
            aria: {
                enabled: true,
                label: { enabled: true, description: currentCountrySummary() }
            },
            series: [{
                type: 'map',
                map: 'world_life_footprints',
                roam: true,
                center: [10, 18],
                zoom: 0.98,
                scaleLimit: { min: 0.9, max: 5 },
                itemStyle: { areaColor: '#f1efe9', borderColor: '#d3d0c8', borderWidth: 0.65 },
                emphasis: { itemStyle: { areaColor: '#dad7cf' }, label: { show: false } },
                data: worldSeriesData()
            }]
        });
        mapsReady = true;
        mapsInitializing = false;
        resizeMaps();
    } catch (error) {
        mapsReady = false;
        mapsInitializing = false;
        chinaMapChart?.dispose();
        worldMapChart?.dispose();
        window.echarts?.getInstanceByDom?.(chinaElement)?.dispose();
        window.echarts?.getInstanceByDom?.(worldElement)?.dispose();
        chinaMapChart = null;
        worldMapChart = null;
        mapFailure(chinaElement, error);
        mapFailure(worldElement, error);
    }
}

function updateMapLanguage() {
    if (!mapsReady) return;
    worldMapChart?.setOption({
        aria: {
            enabled: true,
            label: { enabled: true, description: currentCountrySummary() }
        },
        series: [{ data: worldSeriesData() }]
    });
    chinaMapChart?.setOption({
        aria: {
            enabled: true,
            label: {
                enabled: true,
                description: document.getElementById('chinaMap').getAttribute('aria-label')
            }
        }
    });
}

function resizeMaps() {
    if (!mapsReady) return;
    chinaMapChart?.resize();
    worldMapChart?.resize();
}

let lightboxItems = [];
let lightboxIndex = 0;
let lightboxTrigger = null;
let lightboxTouchStartX = null;
let lightboxFocusFrame = 0;

function setLightboxBackgroundInert(active) {
    if (!active) {
        document.querySelectorAll('[data-lightbox-inert="true"]').forEach(element => {
            element.inert = false;
            delete element.dataset.lightboxInert;
        });
        return;
    }
    Array.from(document.body.children).forEach(element => {
        if (element === dom.lightbox || element.tagName === 'SCRIPT' || element.inert) return;
        element.inert = true;
        element.dataset.lightboxInert = 'true';
    });
}

function renderLightboxItem(index) {
    if (!lightboxItems.length) return;
    lightboxIndex = (index + lightboxItems.length) % lightboxItems.length;
    const item = lightboxItems[lightboxIndex];
    const image = item.querySelector('img');
    const caption = item.querySelector('.gallery-caption');
    dom.lightboxImage.src = image.currentSrc || image.src;
    dom.lightboxImage.alt = image.alt || '';
    dom.lightboxCaption.textContent = caption?.textContent || '';
}

function openLightbox(element) {
    const scope = element.closest('[data-gallery-group], .gallery-grid') || document;
    lightboxItems = Array.from(scope.querySelectorAll('.gallery-item'));
    lightboxIndex = Math.max(0, lightboxItems.indexOf(element));
    lightboxTrigger = element;
    renderLightboxItem(lightboxIndex);
    suspendForModal();
    setLightboxBackgroundInert(true);
    dom.lightbox.classList.add('active');
    dom.lightbox.setAttribute('aria-hidden', 'false');
    cancelAnimationFrame(lightboxFocusFrame);
    lightboxFocusFrame = requestAnimationFrame(() => {
        if (dom.lightbox.classList.contains('active')) {
            dom.lightbox.querySelector('.lightbox-close').focus();
        }
    });
}

function changeLightbox(delta) {
    renderLightboxItem(lightboxIndex + delta);
}

function closeLightbox() {
    if (!dom.lightbox.classList.contains('active')) return;
    cancelAnimationFrame(lightboxFocusFrame);
    lightboxFocusFrame = 0;
    dom.lightbox.classList.remove('active');
    dom.lightbox.setAttribute('aria-hidden', 'true');
    setLightboxBackgroundInert(false);
    if (lightboxTrigger?.isConnected && lightboxTrigger.getClientRects().length) {
        lightboxTrigger.focus({ preventScroll: true });
    }
    lightboxTrigger = null;
    resumeAfterModal();
}

function trapLightboxFocus(event) {
    if (event.key !== 'Tab' || !dom.lightbox.classList.contains('active')) return;
    const focusable = Array.from(dom.lightbox.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])'))
        .filter(element => element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dom.lightbox.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dom.lightbox.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
    }
}

dom.lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
dom.lightbox.querySelector('.lightbox-prev').addEventListener('click', () => changeLightbox(-1));
dom.lightbox.querySelector('.lightbox-next').addEventListener('click', () => changeLightbox(1));
dom.lightbox.addEventListener('click', event => {
    if (event.target === dom.lightbox) closeLightbox();
});
dom.lightbox.addEventListener('touchstart', event => {
    lightboxTouchStartX = event.changedTouches[0].clientX;
}, { passive: true });
dom.lightbox.addEventListener('touchend', event => {
    if (lightboxTouchStartX === null) return;
    const distance = event.changedTouches[0].clientX - lightboxTouchStartX;
    lightboxTouchStartX = null;
    if (Math.abs(distance) >= 48) changeLightbox(distance > 0 ? -1 : 1);
}, { passive: true });

document.addEventListener('keydown', event => {
    if (!dom.lightbox.classList.contains('active')) return;
    trapLightboxFocus(event);
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        changeLightbox(-1);
    } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        changeLightbox(1);
    }
});
