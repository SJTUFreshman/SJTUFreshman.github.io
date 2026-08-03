function renderFrame(time) {
    if (!renderingEnabled) return;
    frameRequest = 0;
    try {
        if (skyModel.available && time >= skyModel.nextRefreshAt) {
            refreshAstronomicalSky(new Date());
        }
        updateCamera(time);
        enforceCameraSkyDome();
        syncSectionDrawerAvailability();
        const basis = cameraBasis();
        const catalogBasis = cameraBasisForCatalog(basis);
        const webglRendered = galaxyRenderer.render(REDUCED_MOTION ? 0 : time, catalogBasis);
        drawConstellations(basis, time, webglRendered, catalogBasis);
        celestialCloseupRenderer.render(time, state.celestialVisit, basis);
        renderFailureReported = false;
    } catch (error) {
        if (!renderFailureReported) {
            renderFailureReported = true;
            console.error('The live sky recovered from a render-frame error:', error);
        }
    } finally {
        if (renderingEnabled) frameRequest = requestAnimationFrame(renderFrame);
    }
}

let frameRequest = 0;
let renderingEnabled = false;
let renderFailureReported = false;
function startRendering() {
    cancelAnimationFrame(frameRequest);
    renderingEnabled = true;
    state.lastFrame = performance.now();
    frameRequest = requestAnimationFrame(renderFrame);
}

function stopRendering() {
    renderingEnabled = false;
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
}

function setGateState(open, focusTrigger = false) {
    state.gateOpen = open;
    const drawerOpen = state.sectionDrawerOpen;
    dom.entryGate.classList.toggle('is-hidden', !open);
    dom.entryGate.setAttribute('aria-hidden', String(!open));
    dom.world.inert = open || drawerOpen;
    dom.panel.inert = open || drawerOpen || !dom.body.classList.contains('panel-open');
    dom.celestialPanel.inert = open || drawerOpen ||
        !dom.body.classList.contains('celestial-open');
    dom.lightbox.inert = open || drawerOpen;
    dom.portalNav.inert = open || drawerOpen || state.scene === 'detail';
    dom.celestialNav.inert = open || drawerOpen || state.scene === 'detail';
    dom.starNav.inert = open || drawerOpen || state.scene !== 'detail';
    syncSectionDrawerAvailability();
    if (open && focusTrigger && !document.hidden) {
        requestAnimationFrame(() => {
            if (state.gateOpen) dom.entryTrigger.focus({ preventScroll: true });
        });
    }
}

function hideEntryGate() {
    setGateState(false);
}

function showResumeGate(focusTrigger = true) {
    if (state.touchMode || state.modalOpen || state.scene === 'detail') return;
    state.lock = 'suspended';
    dom.entryTrigger.disabled = false;
    dom.body.classList.remove('view-locked', 'cursor-free');
    dom.entryTitle.textContent = i18n[state.currentLang]?.resume_view || 'Click to return to free look';
    dom.entryHint.textContent = i18n[state.currentLang]?.enter_hint || 'Click once to take control of the view';
    setGateState(true, focusTrigger);
    dom.status.textContent = 'VIEW PAUSED';
}

function settleUnlockedView(reason, { focusGate = false } = {}) {
    releaseRightZoom();
    dom.body.classList.remove('view-locked');
    dom.body.classList.add('cursor-free');
    if (state.scene === 'leaving-home') {
        state.lock = 'navigation';
        hideEntryGate();
        return;
    }
    if (state.modalOpen) {
        state.lock = 'modal-free';
        hideEntryGate();
        return;
    }
    if (state.scene === 'detail') {
        state.lock = 'detail-free';
        hideEntryGate();
        dom.status.textContent = state.activeCelestial
            ? 'MAGNIFIED OBSERVATION · CURSOR FREE'
            : 'DETAIL · CURSOR FREE';
        return;
    }
    if (state.touchMode) {
        state.lock = 'unavailable';
        hideEntryGate();
        dom.status.textContent = 'DRAG TO LOOK';
        return;
    }
    if (state.altHeld) {
        state.lock = 'alt-free';
        hideEntryGate();
        dom.status.textContent = 'ALT · CURSOR FREE';
        return;
    }
    if (state.scene === 'flying') {
        state.lock = 'flight-free';
        hideEntryGate();
        return;
    }
    if (reason === 'keyboard') {
        state.lock = 'keyboard-free';
        hideEntryGate();
        dom.status.textContent = 'KEYBOARD · CURSOR FREE';
        return;
    }
    if (state.hasEntered) showResumeGate(focusGate);
}

function enterFallbackMode() {
    clearCameraRoll();
    state.lockRequestToken += 1;
    state.touchMode = true;
    state.lock = 'unavailable';
    state.lockIntent = null;
    state.lockRequestSource = null;
    state.altHeld = false;
    state.altReturnMode = null;
    state.relockPending = false;
    state.detailUnlockPending = false;
    state.detailRelockPending = false;
    window.clearTimeout(state.lockRequestTimer);
    state.lockRequestTimer = null;
    state.scene = state.scene === 'entry' ? 'roam' : state.scene;
    dom.entryTrigger.disabled = false;
    dom.entryFallback.hidden = true;
    dom.body.classList.remove('view-locked');
    dom.body.classList.add('touch-mode', 'cursor-free', 'has-entered');
    hideEntryGate();
    dom.status.textContent = 'DRAG TO LOOK';
    dom.world.focus({ preventScroll: true });
}

function handleLockFailure(error, token = state.lockRequestToken) {
    if (
        token !== state.lockRequestToken ||
        state.lock !== 'requesting' ||
        document.pointerLockElement === dom.world
    ) return;
    if (state.lockErrorHandled) return;
    window.clearTimeout(state.lockRequestTimer);
    state.lockRequestTimer = null;
    state.lockErrorHandled = true;
    const source = state.lockRequestSource;
    state.lockRequestSource = null;
    dom.entryTrigger.disabled = false;
    if (state.scene === 'detail' || state.modalOpen || state.scene === 'flying') {
        settleUnlockedView('lock-failure');
        return;
    }
    const unsupported = error?.name === 'NotSupportedError';
    if (unsupported) {
        enterFallbackMode();
        return;
    }
    if (source !== 'alt-release') state.lockFailureCount += 1;
    if (state.lockFailureCount >= 2) {
        enterFallbackMode();
        return;
    }
    dom.entryFallback.hidden = false;
    showResumeGate();
    dom.entryHint.textContent = i18n[state.currentLang]?.lock_failed_hint ||
        'Pointer lock was blocked. Retry or continue with drag controls.';
}

function requestViewLock(source = 'entry') {
    state.hasEntered = true;
    dom.body.classList.add('has-entered');
    if (state.touchMode || typeof dom.world.requestPointerLock !== 'function') {
        enterFallbackMode();
        return false;
    }
    if (
        !['entry', 'roam', 'flying'].includes(state.scene) ||
        state.altHeld ||
        state.modalOpen ||
        state.lock === 'requesting' ||
        document.pointerLockElement === dom.world
    ) return false;

    // A fresh user gesture supersedes any system/Alt/detail intent left by an
    // earlier unlock. This prevents a late pointer-lock result from turning
    // the first resume click into a no-op.
    state.lockIntent = null;
    state.lock = 'requesting';
    const token = state.lockRequestToken + 1;
    state.lockRequestToken = token;
    state.lockRequestSource = source;
    state.lockErrorHandled = false;
    window.clearTimeout(state.lockRequestTimer);
    state.lockRequestTimer = window.setTimeout(() => {
        if (token !== state.lockRequestToken || state.lock !== 'requesting') return;
        if (document.pointerLockElement === dom.world) {
            handlePointerLockChange();
            return;
        }
        handleLockFailure({ name: 'TimeoutError' }, token);
    }, 1800);
    dom.entryTrigger.disabled = true;
    dom.status.textContent = 'LOCKING VIEW';
    try {
        const result = dom.world.requestPointerLock();
        if (result && typeof result.catch === 'function') {
            result.catch(error => {
                console.warn('Pointer lock request was declined:', error);
                handleLockFailure(error, token);
            });
        }
    } catch (error) {
        console.warn('Pointer lock is unavailable:', error);
        handleLockFailure(error);
        return false;
    }
    return true;
}

function releaseRightZoom() {
    state.rightDown = false;
}

function handlePointerLockChange() {
    const locked = document.pointerLockElement === dom.world;
    releaseRightZoom();
    if (locked) {
        window.clearTimeout(state.lockRequestTimer);
        state.lockRequestTimer = null;
        state.lockRequestSource = null;
        if (state.altHeld) {
            state.lock = 'alt-free';
            state.lockIntent = 'alt';
            dom.body.classList.remove('view-locked');
            dom.body.classList.add('cursor-free');
            hideEntryGate();
            queueMicrotask(() => {
                if (document.pointerLockElement === dom.world) document.exitPointerLock();
            });
            return;
        }
        const staleRoamLock = (
            !['requesting', 'locked'].includes(state.lock) &&
            state.scene !== 'detail' &&
            state.scene !== 'leaving-home' &&
            !state.modalOpen
        );
        if (document.hidden || state.touchMode || state.lockIntent === 'system' || staleRoamLock) {
            state.lock = 'suspended';
            dom.body.classList.remove('view-locked');
            dom.body.classList.add('cursor-free');
            queueMicrotask(() => {
                if (document.pointerLockElement === dom.world) document.exitPointerLock();
            });
            return;
        }
        if (state.scene === 'detail' || state.modalOpen || state.scene === 'leaving-home') {
            dom.body.classList.remove('view-locked');
            dom.body.classList.add('cursor-free');
            if (state.scene === 'detail') {
                state.lock = 'detail-free';
                state.lockIntent = 'detail';
                state.detailUnlockPending = true;
            } else if (state.modalOpen) {
                state.lock = 'modal-free';
                state.lockIntent = 'modal';
            } else {
                state.lock = 'navigation';
                state.lockIntent = 'navigation';
            }
            hideEntryGate();
            queueMicrotask(() => {
                if (document.pointerLockElement === dom.world) document.exitPointerLock();
            });
            return;
        }
        state.lock = 'locked';
        state.lockIntent = null;
        state.lockRequestSource = null;
        window.clearTimeout(state.lockRequestTimer);
        state.lockRequestTimer = null;
        state.lockErrorHandled = false;
        state.lockFailureCount = 0;
        state.relockPending = false;
        state.altReturnMode = null;
        state.altPreviousLock = null;
        state.detailUnlockPending = false;
        state.detailRelockPending = false;
        state.scene = state.scene === 'entry' ? 'roam' : state.scene;
        dom.entryTrigger.disabled = false;
        dom.entryFallback.hidden = true;
        dom.body.classList.add('view-locked', 'has-entered');
        dom.body.classList.remove('cursor-free');
        hideEntryGate();
        dom.status.textContent = state.scene === 'detail'
            ? (state.activeCelestial ? 'MAGNIFIED OBSERVATION' : 'DETAIL')
            : 'FREE LOOK';
        dom.world.focus({ preventScroll: true });
        return;
    }

    dom.body.classList.remove('view-locked');
    if (state.lockIntent === 'navigation' || state.scene === 'leaving-home') {
        state.lock = 'navigation';
        state.lockIntent = null;
        state.altHeld = false;
        state.altReturnMode = null;
        state.relockPending = false;
        state.detailUnlockPending = false;
        state.detailRelockPending = false;
        dom.body.classList.add('cursor-free');
        hideEntryGate();
        return;
    }
    if (state.lockIntent === 'alt') {
        state.lock = 'alt-free';
        dom.body.classList.add('cursor-free');
        hideEntryGate();
        dom.status.textContent = 'ALT · CURSOR FREE';
        const shouldRelock = (
            (state.relockPending || state.altReturnMode === 'locked') &&
            !state.altHeld &&
            !state.modalOpen
        );
        state.lockIntent = null;
        state.relockPending = false;
        if (shouldRelock) {
            state.altReturnMode = null;
            state.altPreviousLock = null;
            queueMicrotask(() => {
                const requested = requestViewLock('alt-release');
                if (requested) dom.body.classList.remove('cursor-free');
            });
        }
        return;
    }

    if (state.lockIntent === 'modal' || state.modalOpen) {
        state.lock = 'modal-free';
        state.lockIntent = null;
        dom.body.classList.add('cursor-free');
        hideEntryGate();
        return;
    }

    if (state.detailUnlockPending || state.lockIntent === 'detail') {
        const shouldRelock = state.detailRelockPending &&
            (
                state.scene === 'roam' ||
                state.celestialVisit?.phase === 'returning'
            ) &&
            !state.modalOpen &&
            !state.altHeld;
        state.detailUnlockPending = false;
        state.detailRelockPending = false;
        state.lockIntent = null;
        if (shouldRelock) {
            state.lock = 'detail-relock';
            dom.body.classList.remove('view-locked');
            dom.body.classList.add('cursor-free');
            hideEntryGate();
            queueMicrotask(() => requestViewLock(
                state.celestialVisit?.phase === 'returning'
                    ? 'celestial-return'
                    : 'detail-close'
            ));
        } else {
            settleUnlockedView('detail');
        }
        return;
    }

    if (state.lockIntent === 'keyboard') {
        state.lockIntent = null;
        settleUnlockedView('keyboard');
        return;
    }

    if (state.scene === 'flying') {
        cancelFlight();
        return;
    }
    if (state.scene === 'detail') {
        state.lockIntent = null;
        state.altHeld = false;
        state.altReturnMode = null;
        state.relockPending = false;
        settleUnlockedView('detail');
        return;
    }
    state.altHeld = false;
    state.altReturnMode = null;
    state.relockPending = false;
    state.lockIntent = null;
    settleUnlockedView('unexpected', { focusGate: true });
}

function releaseCursorForAlt() {
    if (!state.hasEntered || state.altHeld || state.modalOpen || state.touchMode || state.gateOpen) return;
    const pointerLocked = document.pointerLockElement === dom.world;
    const wasRequesting = state.lock === 'requesting';
    if (!pointerLocked && !wasRequesting) return;
    if (wasRequesting && !pointerLocked) {
        state.lockRequestToken += 1;
        window.clearTimeout(state.lockRequestTimer);
        state.lockRequestTimer = null;
        state.lockRequestSource = null;
    }
    state.altHeld = true;
    state.relockPending = false;
    state.altPreviousLock = state.lock;
    state.altReturnMode = pointerLocked || wasRequesting ? 'locked' : 'free';
    dom.body.classList.add('cursor-free');
    if (pointerLocked) {
        state.lockIntent = 'alt';
        document.exitPointerLock();
    } else {
        state.lock = 'alt-free';
        hideEntryGate();
    }
}

function restoreViewAfterAlt() {
    if (!state.altHeld) return;
    state.altHeld = false;
    const shouldRelock = state.altReturnMode === 'locked';
    const canRelock = shouldRelock &&
        ['entry', 'roam', 'flying'].includes(state.scene) &&
        !state.modalOpen &&
        !state.touchMode &&
        !state.gateOpen;
    if (!canRelock) {
        state.altReturnMode = null;
        state.altPreviousLock = null;
        state.relockPending = false;
        dom.body.classList.add('cursor-free');
        if (!state.modalOpen && !state.touchMode) {
            settleUnlockedView(state.scene === 'detail' ? 'detail' : 'keyboard');
        }
        return;
    }
    state.relockPending = true;
    if (document.pointerLockElement === dom.world || state.lockIntent === 'alt') return;
    state.relockPending = false;
    state.altReturnMode = null;
    state.altPreviousLock = null;
    const requested = requestViewLock('alt-release');
    if (requested) {
        dom.body.classList.remove('cursor-free');
    } else {
        dom.body.classList.add('cursor-free');
    }
}

function recoverMissingAltKeyup() {
    restoreViewAfterAlt();
}

function suspendForModal() {
    clearCameraRoll();
    state.modalOpen = true;
    state.lockIntent = 'modal';
    dom.body.classList.add('cursor-free');
    if (document.pointerLockElement === dom.world) {
        document.exitPointerLock();
    }
}

function resumeAfterModal() {
    state.modalOpen = false;
    state.lockIntent = null;
    if (state.touchMode) return;
    showResumeGate();
}

function resetTransientInput(focusGate = false) {
    releaseRightZoom();
    clearCameraRoll();
    clearDragState();
    state.lockRequestToken += 1;
    window.clearTimeout(state.lockRequestTimer);
    state.lockRequestTimer = null;
    state.lockRequestSource = null;
    state.altHeld = false;
    state.altReturnMode = null;
    state.relockPending = false;
    state.detailUnlockPending = false;
    state.detailRelockPending = false;
    state.altPreviousLock = null;
    state.pendingDrawerPortal = null;
    state.pendingDrawerHome = false;
    state.drawerNavigationSource = null;
    if (state.sectionDrawerOpen) {
        closeSectionDrawer({ restoreControl: false, focusToggle: false });
    }
    if (state.scene === 'leaving-home') return;
    if (state.modalOpen || state.touchMode) return;
    if (state.scene === 'flying') cancelFlight();
    if (document.pointerLockElement === dom.world) {
        state.lockIntent = 'system';
        document.exitPointerLock();
        return;
    }
    state.lockIntent = null;
    if (state.scene === 'detail') {
        state.lock = 'detail-free';
        dom.body.classList.add('cursor-free');
        hideEntryGate();
        dom.status.textContent = state.activeCelestial
            ? 'MAGNIFIED OBSERVATION · CURSOR FREE'
            : 'DETAIL · CURSOR FREE';
        return;
    }
    if (state.hasEntered) showResumeGate(focusGate);
}

dom.entryTrigger.addEventListener('click', () => requestViewLock('entry'));
dom.entryFallback.addEventListener('click', enterFallbackMode);
dom.entryGate.addEventListener('click', event => {
    if (!state.gateOpen || state.touchMode) return;
    if (event.target instanceof Element && event.target.closest('#entryFallback')) return;
    requestViewLock('entry');
});
