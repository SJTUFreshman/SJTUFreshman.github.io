const thoughtReaderLabels = {
    en: { read: 'Read essay', mode: 'Reading room', close: 'Back to stars', language: 'Essay language' },
    'zh-CN': { read: '阅读全文', mode: '随笔阅读', close: '返回星图', language: '随笔语言' },
    'zh-TW': { read: '閱讀全文', mode: '隨筆閱讀', close: '返回星圖', language: '隨筆語言' }
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

const thoughtReader = document.getElementById('thoughtReader');
let thoughtReaderTrigger = null;

function updateThoughtReader() {
    if (!thoughtReader) return;
    const labels = thoughtReaderLabels[state.currentLang] || thoughtReaderLabels.en;
    document.querySelectorAll('[data-thought-reader]').forEach(button => {
        button.textContent = labels.read;
    });
    if (!thoughtReaderTrigger) return;
    const item = thoughtReaderTrigger.closest('.thought-item');
    const moment = thoughtReaderTrigger.closest('.portal-moment');
    thoughtReader.querySelector('.thought-reader-mode').textContent = labels.mode;
    thoughtReader.querySelector('.thought-reader-close').textContent = labels.close;
    const language = thoughtReader.querySelector('.thought-reader-language');
    language.setAttribute('aria-label', labels.language);
    language.value = state.currentLang;
    thoughtReader.querySelector('#thoughtReaderTitle').textContent = moment.querySelector('h3').textContent;
    thoughtReader.querySelector('.thought-reader-date').textContent = item.querySelector('.thought-date').textContent;
    const paragraphs = item.querySelector('.thought-text').textContent.trim().split(/\n\s*\n/).map(text => {
        const paragraph = document.createElement('p');
        paragraph.textContent = text;
        return paragraph;
    });
    thoughtReader.querySelector('.thought-reader-body').replaceChildren(...paragraphs);
}

function openThoughtReader(button) {
    if (!thoughtReader || state.modalOpen) return;
    thoughtReaderTrigger = button;
    updateThoughtReader();
    suspendForModal();
    thoughtReader.showModal();
    const scrollArea = thoughtReader.querySelector('.thought-reader-scroll');
    scrollArea.scrollTop = 0;
    scrollArea.focus({ preventScroll: true });
}

if (thoughtReader) {
    thoughtReader.querySelector('.thought-reader-close').addEventListener('click', () => thoughtReader.close());
    thoughtReader.querySelector('.thought-reader-language').addEventListener('change', event => {
        setLang(event.target.value);
        thoughtReader.querySelector('.thought-reader-scroll').scrollTop = 0;
    });
    thoughtReader.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key === 'Tab') {
            const focusable = Array.from(thoughtReader.querySelectorAll('button, select, [tabindex="0"]'));
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        } else if (event.key === 'Escape') {
            event.preventDefault();
            thoughtReader.close();
        }
    });
    thoughtReader.addEventListener('close', () => {
        resumeAfterModal();
        if (thoughtReaderTrigger?.isConnected && thoughtReaderTrigger.getClientRects().length) {
            thoughtReaderTrigger.focus({ preventScroll: true });
        }
        thoughtReaderTrigger = null;
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

    const button = event.target.closest('[data-thought-reader]');
    if (!button) return;
    openThoughtReader(button);
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
    updateThoughtReader();
    updateCitationButtons();
    updateSectionDrawerCopy();
    updateActivePortalCopy();
    updateMapLanguage();
    window.lifeStarMap?.updateCopy();
}

document.querySelectorAll('.lang-btn').forEach(button => {
    button.addEventListener('click', () => setLang(button.dataset.lang));
});

let mapsInitializing = false;
let mapsReady = false;

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
    if (!window.footprintsAtlas) {
        console.warn('Footprints atlas module is not loaded');
        return;
    }
    if (mapsReady || mapsInitializing) {
        resizeMaps();
        return;
    }
    mapsInitializing = true;
    try {
        await window.footprintsAtlas.init({
            root: document.querySelector('[data-portal-entry="footprints-map"]'),
            language: state.currentLang
        });
        if (!footprintsMapIsVisible()) {
            mapsInitializing = false;
            return;
        }
        mapsReady = true;
        mapsInitializing = false;
        resizeMaps();
    } catch (error) {
        mapsReady = false;
        mapsInitializing = false;
        console.error('Footprints atlas failed:', error);
        window.footprintsAtlas.fail?.(error);
    }
}

function updateMapLanguage() {
    window.footprintsAtlas?.updateLanguage?.(state.currentLang);
}

function resizeMaps() {
    window.footprintsAtlas?.resize?.();
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
