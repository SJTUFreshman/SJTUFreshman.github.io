buildFallbackStars();
resizeOverlay();
setLang(state.currentLang);
dom.status.textContent = 'AWAITING INPUT';
setGateState(true, true);
startRendering();

async function signalStellarDestinationReady() {
    try {
        if (!document.fonts || typeof document.fonts.load !== 'function') {
            throw new Error('Font Loading API unavailable');
        }
        const faces = await document.fonts.load('400 1em "EduKai"', '中国大陆標楷字體');
        const loaded = faces.length > 0
            && faces.every(face => face.status === 'loaded')
            && document.fonts.check('400 1em "EduKai"', '中国大陆標楷字體');
        if (!loaded) throw new Error('EduKai did not finish loading');
    } catch (error) {
        console.warn('Life transition font readiness check failed:', error);
        window.StellarTransit?.setDestinationStatus(
            'BiauKai typeface unavailable. Refresh to retry',
            'TYPEFACE UNAVAILABLE · REFRESH TO RETRY'
        );
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
        if (window.StellarTransit?.markDestinationReady) {
            window.StellarTransit.markDestinationReady('life');
        } else {
            window.dispatchEvent(new CustomEvent('stellar:destination-ready', {
                detail: { page: 'life' }
            }));
        }
    }));
}

if (window.StellarTransit) {
    signalStellarDestinationReady();
} else {
    window.addEventListener('stellar:runtime-ready', signalStellarDestinationReady, { once: true });
}
window.addEventListener('stellar:arrival-complete', () => {
    if (state.gateOpen) dom.entryTrigger.focus({ preventScroll: true });
});

function restoreLifeAfterNavigation(focusGate = true) {
    if (state.scene !== 'leaving-home' && !dom.veil.classList.contains('is-active')) return;
    if (state.sectionDrawerOpen) {
        closeSectionDrawer({ restoreControl: false, focusToggle: false });
    }
    state.flight = null;
    state.celestialFlight = null;
    state.celestialVisit = null;
    state.routePreview = null;
    state.pendingDrawerPortal = null;
    state.pendingDrawerHome = false;
    state.drawerNavigationSource = null;
    state.scene = state.hasEntered ? 'roam' : 'entry';
    state.activePortal = null;
    state.activePortalOpenedThroughIndex = false;
    state.portalReturnFocusTarget = null;
    state.activeCelestial = null;
    state.activeStarHip = null;
    state.hoverStarHip = null;
    state.homeWarpProgress = 0;
    state.lockIntent = null;
    state.altHeld = false;
    state.altReturnMode = null;
    state.altPreviousLock = null;
    state.relockPending = false;
    state.detailUnlockPending = false;
    state.detailRelockPending = false;
    state.lockRequestToken += 1;
    window.clearTimeout(state.lockRequestTimer);
    state.lockRequestTimer = null;
    state.lockRequestSource = null;
    releaseRightZoom();
    clearDragState();
    const initialOrientation = orientationFromYawPitch(INITIAL_CAMERA.yaw, INITIAL_CAMERA.pitch);
    camera.orientation = initialOrientation.slice();
    camera.targetOrientation = initialOrientation.slice();
    camera.lastStableYaw = INITIAL_CAMERA.yaw;
    camera.inspectionOrientation = null;
    state.detailFov = 43 * DEG;
    camera.fov = 62 * DEG;
    dom.veil.classList.remove('is-active');
    dom.body.classList.remove(
        'panel-open',
        'celestial-open',
        'panel-left',
        'view-locked',
        'section-drawer-open',
        'celestial-transition',
        'celestial-closeup',
        'celestial-returning'
    );
    celestialCloseupRenderer.clear();
    dom.celestialPanel.classList.remove('is-left');
    dom.celestialPanel.setAttribute('aria-hidden', 'true');
    hideHomeRoutePreview();
    hideAllStarButtons();
    state.focusedCelestial = null;
    setFocusedPortal(null);
    if (state.hasEntered) {
        if (state.touchMode) {
            dom.body.classList.add('cursor-free');
            hideEntryGate();
        } else {
            showResumeGate(focusGate);
        }
    } else {
        setGateState(true, focusGate);
    }
    startRendering();
}

window.addEventListener('stellar:page-restored', event => {
    restoreLifeAfterNavigation(!event.detail?.arrival);
});
window.addEventListener('pageshow', event => {
    if (!event.persisted || window.StellarTransit) return;
    requestAnimationFrame(() => restoreLifeAfterNavigation(true));
});
