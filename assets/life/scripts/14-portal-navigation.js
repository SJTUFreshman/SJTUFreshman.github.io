function canRestorePetHomepageFromHistory() {
    if (window.history.length <= 1) return false;
    try {
        const petState = JSON.parse(sessionStorage.getItem('runde:pet-runtime:v2'));
        if (!petState || petState.v !== 2 || petState.ready !== true) return false;
        const referrer = new URL(document.referrer);
        const homepage = new URL('index.html', window.location.href);
        const homepageDirectory = new URL('./', homepage);
        const cameFromHomepage = (
            referrer.origin === window.location.origin &&
            (referrer.pathname === homepage.pathname || referrer.pathname === homepageDirectory.pathname)
        );
        return cameFromHomepage;
    } catch (error) {
        return false;
    }
}

function updateCamera(time) {
    const deltaSeconds = clamp((time - state.lastFrame) / 1000, 0, 0.05);
    state.lastFrame = time;

    if (state.routePreview && !state.routePreview.settled) {
        const preview = state.routePreview;
        const progress = clamp((time - preview.startedAt) / preview.duration, 0, 1);
        const sourceStop = preview.sourceStop ?? 0.34;
        if (preview.action.type === 'home') {
            const homeProgress = easeInOutCubic(progress);
            camera.orientation = quatSlerp(
                preview.startOrientation,
                preview.destinationOrientation,
                homeProgress
            );
            camera.fov = lerp(preview.startFov, preview.destinationFov, homeProgress);
        } else if (sourceStop > 0 && progress <= sourceStop) {
            const sourceProgress = easeInOutCubic(progress / sourceStop);
            camera.orientation = quatSlerp(
                preview.startOrientation,
                preview.sourceOrientation,
                sourceProgress
            );
            camera.fov = lerp(preview.startFov, 24 * DEG, sourceProgress);
        } else {
            const destinationProgress = easeInOutCubic(
                (progress - sourceStop) / (1 - sourceStop)
            );
            camera.orientation = quatSlerp(
                sourceStop > 0
                    ? preview.sourceOrientation
                    : preview.startOrientation,
                preview.destinationOrientation,
                destinationProgress
            );
            camera.fov = lerp(
                sourceStop > 0 ? 24 * DEG : preview.startFov,
                preview.destinationFov,
                destinationProgress
            );
        }
        camera.targetOrientation = camera.orientation.slice();
        if (progress >= 1) {
            preview.settled = true;
            state.detailFov = preview.destinationFov;
            camera.targetOrientation = preview.destinationOrientation.slice();
            renderHomeRoutePreviewCopy();
        }
        return;
    }

    if (state.flight) {
        const flight = state.flight;
        const progress = clamp((time - flight.startedAt) / flight.duration, 0, 1);
        const eased = easeInOutCubic(progress);
        const isHomeDeparture = flight.action === 'home-departure';
        const homeWarp = isHomeDeparture
            ? clamp((progress - 0.38) / 0.62, 0, 1)
            : 0;
        state.homeWarpProgress = homeWarp * homeWarp * (3 - 2 * homeWarp);
        camera.orientation = quatSlerp(
            flight.startOrientation,
            flight.endOrientation,
            eased
        );
        const focalArc = Math.sin(progress * Math.PI);
        const focalDepth = isHomeDeparture ? 7.5 : 3.5;
        camera.fov = Math.max(
            7 * DEG,
            lerp(flight.startFov, flight.endFov, eased) - focalArc * focalDepth * DEG
        );
        camera.targetOrientation = camera.orientation.slice();

        if (isHomeDeparture && progress > 0.58) {
            dom.veil.classList.add('is-active');
        }

        if (progress >= 1) {
            state.flight = null;
            if (isHomeDeparture) {
                state.scene = 'leaving-home';
                state.lockIntent = 'navigation';
                releaseRightZoom();
                const origin = flight.portal.screen?.visible
                    ? { x: flight.portal.screen.x, y: flight.portal.screen.y }
                    : { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
                if (document.pointerLockElement === dom.world) {
                    document.exitPointerLock();
                }
                if (window.StellarTransit) {
                    const restoreHomepage = canRestorePetHomepageFromHistory();
                    window.StellarTransit.navigate({
                        to: 'index',
                        href: 'index.html',
                        origin,
                        mode: 'home',
                        duration: 760,
                        historyDelta: restoreHomepage ? -1 : undefined
                    });
                } else {
                    window.setTimeout(() => {
                        if (canRestorePetHomepageFromHistory()) {
                            window.history.back();
                        } else {
                            window.location.href = 'index.html';
                        }
                    }, REDUCED_MOTION ? 0 : 360);
                }
            } else {
                state.detailFov = flight.endFov;
                openPortalPanel(
                    flight.portal,
                    flight.preferredPanelOnLeft ?? flight.panelOnLeft,
                    flight.arrivalHip
                );
            }
        }
        return;
    }

    const response = REDUCED_MOTION ? 1 : 1 - Math.exp(-deltaSeconds * 8.5);
    camera.orientation = quatSlerp(
        camera.orientation,
        camera.targetOrientation,
        response
    );
    const restingFov = state.scene === 'detail' ? state.detailFov : 62 * DEG;
    const desiredFov = state.rightDown ? restingFov - 14 * DEG : restingFov;
    const fovResponse = REDUCED_MOTION ? 1 : 1 - Math.exp(-deltaSeconds * 9.5);
    camera.fov = lerp(camera.fov, desiredFov, fovResponse);
}

function startPortalFlight(portal, source = 'gaze', action = 'open', arrivalHip = null) {
    if (window.lifeStarMap) {
        if (action === 'home-departure') window.lifeStarMap.goHome();
        else window.lifeStarMap.openPortal(portal, source, arrivalHip);
        return;
    }
    if (
        !portal ||
        state.scene === 'flying' ||
        state.scene === 'leaving-home' ||
        state.modalOpen
    ) return;
    if (state.scene === 'detail') {
        closePortalPanel(false);
    }
    const isHomeDeparture = action === 'home-departure';
    if (!isHomeDeparture && !isAboveHorizon(portal.direction)) return;
    state.activationSource = source;
    state.activePortalOpenedThroughIndex = false;
    state.portalReturnFocusTarget = source === 'drawer'
        ? dom.sectionDrawerToggle
        : null;
    state.scene = 'flying';
    state.activePortal = portal;
    state.activeStarHip = null;
    state.hoverStarHip = null;
    state.homeWarpProgress = 0;
    setFocusedPortal(portal);
    dom.status.textContent = 'FOCUSING';

    const preferredPanelOnLeft = !isHomeDeparture && Boolean(
        portal.screen?.visible && portal.screen.x > overlayWidth * 0.56
    );
    const panelOnLeft = !usesCompactSkyLayout() && preferredPanelOnLeft;
    let endOrientation = orientationFromYawPitch(
        portal.yaw,
        clamp(portal.pitch, -ROUTE_PITCH_LIMIT, ROUTE_PITCH_LIMIT)
    );
    let endFov = isHomeDeparture ? 9 * DEG : 43 * DEG;
    if (!isHomeDeparture) {
        const framing = constellationFraming(portal, panelOnLeft);
        endOrientation = framing.orientation;
        endFov = framing.fov;
    }
    if (isHomeDeparture) releaseRightZoom();
    const duration = REDUCED_MOTION ? 1 : (isHomeDeparture ? 1180 : 920);
    state.flight = {
        portal,
        action,
        activationSource: source,
        returnFocusTarget: state.portalReturnFocusTarget,
        startedAt: performance.now(),
        duration,
        startOrientation: camera.orientation.slice(),
        startFov: camera.fov,
        cancelOrientation: camera.orientation.slice(),
        cancelFov: camera.fov,
        endOrientation,
        endFov,
        panelOnLeft,
        preferredPanelOnLeft,
        arrivalHip
    };
}

function focusAfterKeyboardFlightCancel(target) {
    if (document.pointerLockElement === dom.world) {
        state.lockIntent = 'keyboard';
        document.exitPointerLock();
    } else {
        state.lockIntent = null;
    }
    settleUnlockedView('keyboard');
    const button = target?.button;
    if (button) {
        button.hidden = false;
        button.inert = false;
        target.buttonVisible = true;
    }
    requestAnimationFrame(() => {
        if (state.scene !== 'roam' || state.gateOpen) return;
        const focusTarget = button && !button.hidden && !button.inert
            ? button
            : dom.world;
        focusTarget.focus({ preventScroll: true });
    });
}

function focusAfterIndexedNavigation(target = dom.sectionDrawerToggle) {
    if (document.pointerLockElement === dom.world) {
        state.lockIntent = 'keyboard';
        document.exitPointerLock();
    } else {
        state.lockIntent = null;
    }
    state.detailUnlockPending = false;
    state.detailRelockPending = false;
    settleUnlockedView('keyboard');
    syncSectionDrawerAvailability();
    requestAnimationFrame(() => {
        if (
            state.scene !== 'roam' ||
            state.gateOpen ||
            !target ||
            target.isConnected === false ||
            target.inert
        ) return;
        target.focus({ preventScroll: true });
    });
}

function cancelFlight(source = state.activationSource) {
    if (window.lifeStarMap) {
        window.lifeStarMap.cancelFlight();
        return;
    }
    if (!state.flight) return;
    const flight = state.flight;
    state.flight = null;
    state.scene = 'roam';
    state.activePortal = null;
    state.activeStarHip = null;
    state.hoverStarHip = null;
    state.homeWarpProgress = 0;
    camera.orientation = (flight.cancelOrientation || flight.startOrientation).slice();
    camera.fov = flight.cancelFov ?? flight.startFov;
    camera.targetOrientation = camera.orientation.slice();
    camera.inspectionOrientation = null;
    dom.veil.classList.remove('is-active');
    dom.status.textContent = state.lock === 'locked' ? 'FREE LOOK' : 'VIEW PAUSED';
    if (flight.returnFocusTarget) {
        state.portalReturnFocusTarget = null;
        setFocusedPortal(null);
        focusAfterIndexedNavigation(flight.returnFocusTarget);
        return;
    }
    setFocusedPortal(flight.portal);
    if (source === 'keyboard') {
        focusAfterKeyboardFlightCancel(flight.portal);
        return;
    }
    if (
        !state.touchMode &&
        document.pointerLockElement !== dom.world &&
        !state.altHeld &&
        !state.modalOpen
    ) {
        settleUnlockedView('flight-cancel');
    }
}

function releaseViewForDetail() {
    releaseRightZoom();
    state.lockRequestToken += 1;
    window.clearTimeout(state.lockRequestTimer);
    state.lockRequestTimer = null;
    state.lockRequestSource = null;
    state.altHeld = false;
    state.altReturnMode = null;
    state.relockPending = false;
    state.detailUnlockPending = false;
    state.detailRelockPending = false;
    camera.targetOrientation = camera.orientation.slice();
    camera.targetFov = state.detailFov;
    dom.body.classList.remove('view-locked');
    dom.body.classList.add('cursor-free');
    hideEntryGate();

    if (document.pointerLockElement === dom.world) {
        state.detailUnlockPending = true;
        state.detailRelockPending = false;
        state.lockIntent = 'detail';
        document.exitPointerLock();
    } else {
        state.detailUnlockPending = false;
        state.lockIntent = null;
        if (!state.touchMode) state.lock = 'detail-free';
    }
}

function openPortalPanel(portal, panelOnLeft = false, preferredHip = null) {
    window.clearTimeout(state.panelHideTimer);
    document.querySelectorAll('[data-portal-content]').forEach(content => {
        content.hidden = content.dataset.portalContent !== portal.id;
    });
    state.activePortal = portal;
    state.activeStarHip = null;
    state.hoverStarHip = null;
    const names = orderedPortalNames(portal);
    const ui = starUiCopy[state.currentLang] || starUiCopy.en;
    dom.panelKicker.textContent = ui.sectionKicker;
    dom.panelTitle.textContent = names[0];
    dom.panelNames.textContent = LANGUAGES.map(lang => portalName(portal, lang)).join(' / ');
    updateConstellationMeaning(portal);
    dom.panelBody.scrollTop = 0;
    dom.panel.inert = false;
    dom.panel.setAttribute('aria-hidden', 'false');
    dom.panelClose.setAttribute('aria-label', i18n[state.currentLang]?.panel_close || 'Return to the galaxy');
    dom.body.classList.add('panel-open');
    state.panelSidePreference = Boolean(panelOnLeft);
    state.panelOnLeft = !usesCompactSkyLayout() && state.panelSidePreference;
    dom.panel.classList.toggle('is-left', state.panelOnLeft);
    dom.body.classList.toggle('panel-left', state.panelOnLeft);
    state.scene = 'detail';
    camera.inspectionOrientation = camera.orientation.slice();
    camera.targetFov = state.detailFov;
    dom.status.textContent = 'DETAIL';
    dom.portalNav.inert = true;
    dom.starNav.inert = false;
    showConstellationOverview(portal);
    updateThoughtReader();
    refreshPortalPanelRect();
    releaseViewForDetail();
    requestAnimationFrame(() => dom.panelClose.focus({ preventScroll: true }));
}

function closePortalPanel(
    restoreFocus = true,
    interactionSource = state.activationSource
) {
    if (!dom.body.classList.contains('panel-open')) return;
    const closingPortal = state.activePortal;
    const indexedReturnFocusTarget = restoreFocus
        ? state.portalReturnFocusTarget
        : null;
    const returnKeyboardFocus = Boolean(
        restoreFocus &&
        !indexedReturnFocusTarget &&
        interactionSource === 'keyboard' &&
        closingPortal?.button
    );
    if (dom.panel.contains(document.activeElement)) {
        dom.world.focus({ preventScroll: true });
    }
    dom.body.classList.remove('panel-open');
    dom.panel.setAttribute('aria-hidden', 'true');
    dom.panel.inert = true;
    dom.panel.classList.remove('is-left');
    dom.body.classList.remove('panel-left');
    hideAllStarButtons();
    state.routePreview = null;
    hideHomeRoutePreview();
    dom.starNav.inert = true;
    dom.portalNav.inert = false;
    state.panelRect = null;
    state.scene = 'roam';
    state.activePortal = null;
    state.activePortalOpenedThroughIndex = false;
    state.portalReturnFocusTarget = null;
    state.activeStarHip = null;
    state.hoverStarHip = null;
    state.detailFov = 43 * DEG;
    camera.inspectionOrientation = null;
    dom.status.textContent = state.lock === 'locked' ? 'FREE LOOK' : 'CURSOR FREE';
    state.panelHideTimer = window.setTimeout(() => {
        document.querySelectorAll('[data-portal-content]').forEach(content => {
            content.hidden = true;
        });
    }, REDUCED_MOTION ? 0 : 420);
    setFocusedPortal(null);
    if (window.lifeStarMap) {
        if (restoreFocus) {
            window.lifeStarMap.returnToOverview(restoreFocus, interactionSource);
            if (indexedReturnFocusTarget) {
                focusAfterIndexedNavigation(indexedReturnFocusTarget);
            }
        }
        return;
    }
    if (indexedReturnFocusTarget) {
        focusAfterIndexedNavigation(indexedReturnFocusTarget);
        return;
    }
    if (returnKeyboardFocus) {
        closingPortal.button.hidden = false;
        closingPortal.button.inert = false;
        closingPortal.buttonVisible = true;
        state.detailUnlockPending = false;
        state.detailRelockPending = false;
        state.lockIntent = document.pointerLockElement === dom.world ? 'keyboard' : null;
        settleUnlockedView('keyboard');
        requestAnimationFrame(() => {
            if (state.scene !== 'roam' || state.gateOpen) return;
            const target = !closingPortal.button.hidden && !closingPortal.button.inert
                ? closingPortal.button
                : dom.world;
            target.focus({ preventScroll: true });
        });
        return;
    }
    if (restoreFocus && !state.modalOpen && !state.altHeld) {
        if (state.touchMode) {
            dom.status.textContent = 'DRAG TO LOOK';
        } else if (state.detailUnlockPending) {
            state.detailRelockPending = true;
        } else if (document.pointerLockElement !== dom.world) {
            requestViewLock('detail-close');
        }
    } else {
        state.detailRelockPending = false;
    }
}
