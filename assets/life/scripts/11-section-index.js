function orderedPortalNames(portal) {
    const others = LANGUAGES.filter(lang => lang !== state.currentLang);
    return [state.currentLang, ...others].map(lang => portalName(portal, lang));
}

function portalName(portal, lang) {
    return i18n[lang]?.[portal.titleKey] || portal.id;
}

function localized(mapping, lang = state.currentLang) {
    return mapping?.[lang] || mapping?.en || '';
}

function celestialName(profile, lang = state.currentLang) {
    return localized(profile?.names, lang) || profile?.body || '';
}

function observerLocationLabel(lang = state.currentLang) {
    const label = skyModel.location.label;
    if (typeof label === 'string') return label;
    return label?.[lang] || label?.en || 'Shanghai';
}

function updateEntryLocationCopy() {
    const data = i18n[state.currentLang] || i18n.en || {};
    const fallback = skyModel.location.source === 'life-fallback';
    const key = fallback ? 'enter_location_fallback' : 'enter_location_synced';
    const defaultTemplate = fallback
        ? 'Current observing location: {location} · default location'
        : 'Current observing location: {location} · synced from homepage weather';
    const template = data[key] || defaultTemplate;
    dom.entryLocation.textContent = String(template)
        .split('{location}')
        .join(observerLocationLabel());
}

function observerTimeLabel(date = skyModel.date || new Date()) {
    const locale = {
        en: 'en-GB',
        'zh-CN': 'zh-CN',
        'zh-TW': 'zh-TW'
    }[state.currentLang] || 'en-GB';
    try {
        return new Intl.DateTimeFormat(locale, {
            timeZone: skyModel.location.timezone || 'Asia/Shanghai',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }).format(date);
    } catch (error) {
        return date.toLocaleString(locale);
    }
}

function portalSkyVisibility(portal) {
    if (!portal?.patternPoints?.length) return 0;
    return Math.max(
        0,
        ...portal.patternPoints.map((direction, index) =>
            starVisibilityAtDirection(
                direction,
                Number.isFinite(portal.patternMagnitudes?.[index])
                    ? portal.patternMagnitudes[index]
                    : 0
            )
        )
    );
}

function portalSkyState(portal) {
    const direction = portal?.direction;
    if (!direction || !isAboveHorizon(direction)) return 'below';
    if (portalSkyVisibility(portal) <= 0.025) return 'veiled';
    const altitude = Math.asin(clamp(direction[1], -1, 1));
    if (altitude <= HORIZON_NEAR_ALTITUDE) return 'near';
    return 'above';
}

function portalAvailableInSky(portal) {
    const skyState = portalSkyState(portal);
    return (skyState === 'above' || skyState === 'near') &&
        portalSkyVisibility(portal) > 0.025;
}

function updateSectionDrawerCopy() {
    const ui = skyIndexUi[state.currentLang] || skyIndexUi.en;
    dom.sectionDrawerKicker.textContent = ui.kicker;
    dom.sectionDrawerTitle.textContent = ui.title;
    dom.sectionDrawerObserver.textContent = ui.observer(
        observerLocationLabel(),
        observerTimeLabel()
    );
    dom.sectionDrawerList.setAttribute('aria-label', ui.listLabel);
    dom.sectionDrawerToggle.setAttribute(
        'aria-label',
        state.sectionDrawerOpen ? ui.close : ui.open
    );
    dom.sectionDrawerClose.setAttribute('aria-label', ui.close);
    dom.sectionDrawerHomeTitle.textContent = ui.homeTitle;
    dom.sectionDrawerHomeMeta.textContent = ui.homeMeta;
    dom.sectionDrawerHome.setAttribute(
        'aria-label',
        `${ui.homeTitle} · ${ui.homeMeta}`
    );
    if (
        state.scene === 'detail' &&
        state.activePortal?.home
    ) {
        dom.sectionDrawerHome.setAttribute('aria-current', 'page');
    } else {
        dom.sectionDrawerHome.removeAttribute('aria-current');
    }
    dom.sectionDrawerNote.textContent = ui.note;

    portalDefinitions.filter(portal => !portal.home).forEach((portal, index) => {
        const button = portal.drawerButton;
        if (!button) return;
        const story = constellationStories[portal.id];
        const skyState = portalSkyState(portal);
        const sectionName = portalName(portal, state.currentLang);
        const constellationName = localized(story?.name);
        const status = ui[skyState] || ui.above;
        button.dataset.horizonState = skyState;
        if (state.scene === 'detail' && state.activePortal === portal) {
            button.setAttribute('aria-current', 'page');
        } else {
            button.removeAttribute('aria-current');
        }
        button.setAttribute(
            'aria-label',
            `${String(index + 1).padStart(2, '0')} · ${sectionName} · ${constellationName} · ${status}`
        );
        const number = button.querySelector('.section-index-number');
        const title = button.querySelector('.section-index-copy strong');
        const constellation = button.querySelector('.section-index-copy span');
        const visibility = button.querySelector('.section-index-visibility');
        if (number) number.textContent = String(index + 1).padStart(2, '0');
        if (title) title.textContent = sectionName;
        if (constellation) constellation.textContent = constellationName;
        if (visibility) visibility.textContent = status;
    });
}

function buildSectionDrawer() {
    const fragment = document.createDocumentFragment();
    portalDefinitions.filter(portal => !portal.home).forEach(portal => {
        const button = document.createElement('button');
        button.className = 'section-index-item';
        button.type = 'button';
        button.dataset.portalId = portal.id;

        const number = document.createElement('span');
        number.className = 'section-index-number';
        const copy = document.createElement('span');
        copy.className = 'section-index-copy';
        const title = document.createElement('strong');
        const constellation = document.createElement('span');
        copy.append(title, constellation);
        const visibility = document.createElement('span');
        visibility.className = 'section-index-visibility';
        button.append(number, copy, visibility);
        button.addEventListener('click', event => {
            navigateFromSectionDrawer(
                portal,
                event.detail === 0 ? 'keyboard' : 'pointer'
            );
        });
        portal.drawerButton = button;
        fragment.append(button);
    });
    dom.sectionDrawerList.replaceChildren(fragment);
    dom.sectionDrawerHome.dataset.portalId = 'home';
    updateSectionDrawerCopy();
}

function setSectionDrawerBackgroundInert(active) {
    if (!active) {
        document.querySelectorAll('[data-section-drawer-inert="true"]').forEach(element => {
            element.inert = false;
            delete element.dataset.sectionDrawerInert;
        });
        setGateState(state.gateOpen, false);
        return;
    }
    Array.from(document.body.children).forEach(element => {
        if (
            element === dom.sectionDrawer ||
            element === dom.sectionDrawerToggle ||
            element === dom.sectionDrawerScrim ||
            element.tagName === 'SCRIPT' ||
            element.inert
        ) return;
        element.inert = true;
        element.dataset.sectionDrawerInert = 'true';
    });
}

function sectionDrawerBlocked() {
    return (
        !state.hasEntered ||
        state.gateOpen ||
        state.scene === 'flying' ||
        state.scene === 'leaving-home' ||
        dom.lightbox.classList.contains('active') ||
        (state.modalOpen && !state.sectionDrawerOpen)
    );
}

function syncSectionDrawerAvailability() {
    const blocked = sectionDrawerBlocked();
    const unavailable = blocked && !state.sectionDrawerOpen;
    if (
        state.sectionDrawerUnavailable === unavailable &&
        dom.sectionDrawerToggle.inert === unavailable
    ) return;
    state.sectionDrawerUnavailable = unavailable;
    dom.sectionDrawerToggle.inert = unavailable;
    dom.sectionDrawerToggle.toggleAttribute(
        'aria-disabled',
        unavailable
    );
}

function openSectionDrawer(source = 'pointer') {
    if (state.sectionDrawerOpen || sectionDrawerBlocked()) return false;
    releaseRightZoom();
    clearCameraRoll();
    const pointerLocked = document.pointerLockElement === dom.world;
    const lockRequestPending = state.lock === 'requesting';
    state.drawerReturn = {
        wasLocked: pointerLocked ||
            lockRequestPending ||
            state.altReturnMode === 'locked',
        scene: state.scene,
        focus: document.activeElement,
        source
    };
    if (lockRequestPending && !pointerLocked) {
        state.lockRequestToken += 1;
        window.clearTimeout(state.lockRequestTimer);
        state.lockRequestTimer = null;
        state.lockRequestSource = null;
        state.lock = 'modal-free';
    }
    state.sectionDrawerOpen = true;
    state.modalOpen = true;
    state.lockIntent = 'modal';
    dom.body.classList.add('section-drawer-open', 'cursor-free');
    dom.body.classList.remove('view-locked');
    dom.sectionDrawerToggle.inert = false;
    dom.sectionDrawerToggle.setAttribute('aria-expanded', 'true');
    dom.sectionDrawer.setAttribute('aria-hidden', 'false');
    dom.sectionDrawer.inert = false;
    hideEntryGate();
    setSectionDrawerBackgroundInert(true);
    updateSectionDrawerCopy();
    dom.status.textContent = (skyIndexUi[state.currentLang] || skyIndexUi.en).kicker;
    if (pointerLocked) document.exitPointerLock();
    requestAnimationFrame(() => {
        if (!state.sectionDrawerOpen) return;
        const firstItem = dom.sectionDrawerList.querySelector('button');
        (firstItem || dom.sectionDrawerClose).focus({ preventScroll: true });
    });
    return true;
}

function closeSectionDrawer({
    restoreControl = true,
    interactionSource = 'pointer',
    focusToggle = interactionSource === 'keyboard'
} = {}) {
    if (!state.sectionDrawerOpen) return false;
    const drawerReturn = state.drawerReturn;
    state.sectionDrawerOpen = false;
    state.modalOpen = false;
    state.lockIntent = null;
    dom.body.classList.remove('section-drawer-open');
    dom.sectionDrawerToggle.setAttribute('aria-expanded', 'false');
    dom.sectionDrawer.setAttribute('aria-hidden', 'true');
    dom.sectionDrawer.inert = true;
    setSectionDrawerBackgroundInert(false);
    state.drawerReturn = null;
    updateSectionDrawerCopy();
    syncSectionDrawerAvailability();

    if (!restoreControl) {
        state.altReturnMode = null;
        state.altPreviousLock = null;
        state.relockPending = false;
        dom.body.classList.add('cursor-free');
        if (!state.touchMode) {
            state.lock = state.scene === 'detail' ? 'detail-free' : 'keyboard-free';
        }
        return true;
    }

    const focusTarget = drawerReturn?.focus;
    if (focusToggle) {
        requestAnimationFrame(() => {
            if (!dom.sectionDrawerToggle.inert) {
                dom.sectionDrawerToggle.focus({ preventScroll: true });
            } else if (focusTarget?.isConnected) {
                focusTarget.focus({ preventScroll: true });
            }
        });
    }

    if (state.scene === 'detail') {
        settleUnlockedView('detail');
        return true;
    }
    if (state.touchMode) {
        settleUnlockedView('drawer');
        return true;
    }
    if (state.altHeld) {
        state.lock = 'alt-free';
        dom.body.classList.add('cursor-free');
        hideEntryGate();
        return true;
    }
    if (drawerReturn?.wasLocked && state.scene === 'roam') {
        if (interactionSource === 'keyboard') {
            settleUnlockedView('keyboard');
            return true;
        }
        const requested = requestViewLock('drawer-close');
        if (requested) dom.body.classList.remove('cursor-free');
        else settleUnlockedView('keyboard');
        return true;
    }
    settleUnlockedView('keyboard');
    return true;
}

function openPortalThroughIndex(
    portal,
    arrivalHip = firstContentStarHip(portal),
    source = 'drawer'
) {
    if (!portal || portal.home) return false;
    if (dom.body.classList.contains('panel-open')) {
        closePortalPanel(false, 'drawer');
    }
    state.activationSource = source;
    state.activePortalOpenedThroughIndex = true;
    state.portalReturnFocusTarget = source === 'drawer'
        ? dom.sectionDrawerToggle
        : dom.world;
    state.detailFov = camera.fov;
    openPortalPanel(portal, false, arrivalHip);
    const ui = skyIndexUi[state.currentLang] || skyIndexUi.en;
    const skyState = portalSkyState(portal);
    const skyStatus = ui[skyState] || ui.above;
    dom.status.textContent = `${skyStatus} · ${ui.indexAccess}`;
    dom.gazeAnnouncement.textContent = ui.directAnnouncement(
        portalName(portal, state.currentLang),
        skyStatus
    );
    return true;
}

function openHomepageRouteFromIndex() {
    const homePortal = portalDefinitions.find(portal => portal.home);
    if (!homePortal) return false;
    if (dom.body.classList.contains('panel-open')) {
        closePortalPanel(false, 'drawer');
    }
    state.activationSource = 'drawer';
    state.activePortalOpenedThroughIndex = true;
    state.portalReturnFocusTarget = dom.sectionDrawerToggle;
    state.detailFov = camera.fov;
    openPortalPanel(homePortal, false, null);
    previewHomeRoute(homePortal, 11767);
    return true;
}

function performDrawerPortalNavigation(portal, source = 'pointer') {
    if (!portal) return false;
    state.drawerNavigationSource = source;
    if (portalAvailableInSky(portal)) {
        startPortalFlight(
            portal,
            'drawer',
            'open',
            firstContentStarHip(portal)
        );
        return true;
    }
    return openPortalThroughIndex(portal);
}

function navigateFromSectionDrawer(portal, source = 'pointer') {
    if (!portal || portal.home || !state.sectionDrawerOpen) return false;
    if (state.scene === 'detail' && state.activePortal === portal) {
        closeSectionDrawer({
            restoreControl: true,
            interactionSource: source,
            focusToggle: source === 'keyboard'
        });
        return true;
    }
    closeSectionDrawer({ restoreControl: false, focusToggle: false });
    if (state.celestialVisit) {
        state.pendingDrawerPortal = portal;
        state.pendingDrawerHome = false;
        state.drawerNavigationSource = source;
        beginCelestialReturn(false, 'drawer');
        return true;
    }
    return performDrawerPortalNavigation(portal, source);
}

function navigateHomeFromSectionDrawer(source = 'pointer') {
    if (!state.sectionDrawerOpen) return false;
    closeSectionDrawer({ restoreControl: false, focusToggle: false });
    if (state.celestialVisit) {
        state.pendingDrawerPortal = null;
        state.pendingDrawerHome = true;
        state.drawerNavigationSource = source;
        beginCelestialReturn(false, 'drawer');
        return true;
    }
    return openHomepageRouteFromIndex();
}

function flushPendingDrawerNavigation() {
    const portal = state.pendingDrawerPortal;
    const home = state.pendingDrawerHome;
    const source = state.drawerNavigationSource || 'pointer';
    state.pendingDrawerPortal = null;
    state.pendingDrawerHome = false;
    state.drawerNavigationSource = null;
    if (home) return openHomepageRouteFromIndex();
    if (portal) return performDrawerPortalNavigation(portal, source);
    return false;
}

function trapSectionDrawerFocus(event) {
    if (event.key !== 'Tab' || !state.sectionDrawerOpen) return;
    const focusable = Array.from(dom.sectionDrawer.querySelectorAll(
        'button:not([disabled]):not([inert]), [href], [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.inert && element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dom.sectionDrawer.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
    }
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}
