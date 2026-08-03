const CAMERA_ROLL_SPEED = 50 * DEG;

function clearCameraRoll() {
    state.rollLeftHeld = false;
    state.rollRightHeld = false;
    state.rollVelocity = 0;
}

function updateCameraRoll(deltaSeconds) {
    const allowed = (
        state.scene === 'roam' &&
        state.hasEntered &&
        !state.altHeld &&
        !state.modalOpen &&
        !state.gateOpen
    );
    if (!allowed) {
        clearCameraRoll();
        return;
    }
    const intent = (state.rollLeftHeld ? 1 : 0) - (state.rollRightHeld ? 1 : 0);
    const targetVelocity = intent * CAMERA_ROLL_SPEED;
    const responseRate = intent === 0 ? 16 : 11;
    const response = REDUCED_MOTION
        ? 1
        : 1 - Math.exp(-deltaSeconds * responseRate);
    state.rollVelocity = lerp(state.rollVelocity, targetVelocity, response);
    if (intent === 0 && Math.abs(state.rollVelocity) < 0.00015) {
        state.rollVelocity = 0;
    }
    if (state.rollVelocity === 0 || deltaSeconds <= 0) return;
    camera.targetOrientation = quatNormalize(quatMultiply(
        camera.targetOrientation,
        quatAxisAngle(0, 0, 1, state.rollVelocity * deltaSeconds)
    ));
}

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

function setCelestialVisitClasses(phase = null) {
    dom.body.classList.toggle('celestial-transition', phase === 'approach');
    dom.body.classList.toggle('celestial-closeup', phase === 'observing');
    dom.body.classList.toggle('celestial-returning', phase === 'returning');
}

function celestialVisitProjectionAnchor(profile, orientation, fov) {
    const basis = orientationBasis(orientation);
    const discGeometry = profile.angularDisc
        ? projectedAngularDiscGeometry(
            profile,
            basis,
            overlayWidth,
            overlayHeight,
            fov
        )
        : null;
    const point = discGeometry?.center || projectDirection(
        profile.current.direction,
        basis,
        overlayWidth,
        overlayHeight,
        fov
    );
    return {
        screen: point?.visible
            ? { x: point.x, y: point.y }
            : {
                x: window.innerWidth * 0.5,
                y: window.innerHeight * 0.5
            },
        discGeometry
    };
}

function refreshCelestialOriginAnchor(visit) {
    const anchor = celestialVisitProjectionAnchor(
        visit.profile,
        visit.origin.orientation,
        visit.origin.fov
    );
    visit.originScreen = anchor.screen;
    visit.originDiscGeometry = anchor.discGeometry;
}

function refreshCelestialApproachAnchor(visit) {
    const anchor = celestialVisitProjectionAnchor(
        visit.profile,
        camera.orientation,
        camera.fov
    );
    visit.approachScreen = anchor.screen;
    visit.approachDiscGeometry = anchor.discGeometry;
}

function clearCelestialTextureWatchdog(visit) {
    if (!visit?.textureWatchdog) return;
    window.clearTimeout(visit.textureWatchdog);
    visit.textureWatchdog = null;
}

function markCelestialTextureReady(visit, { error = false } = {}) {
    if (
        state.celestialVisit !== visit ||
        visit.phase !== 'approach' ||
        visit.textureReady
    ) return false;
    clearCelestialTextureWatchdog(visit);
    visit.textureError = error;
    visit.textureReady = true;
    visit.textureReadyAt = performance.now();
    visit.visualStartedAt = Math.max(
        visit.textureReadyAt,
        visit.transition.startedAt + (REDUCED_MOTION ? 0 : 150)
    );
    if (error) dom.status.textContent = 'USING RESILIENT SURFACE';
    return true;
}

function resolveCelestialTextureFallback(visit, error) {
    if (
        state.celestialVisit !== visit ||
        visit.phase !== 'approach' ||
        visit.textureReady
    ) return false;
    try {
        celestialCloseupRenderer.installFallbackSurface(visit.profile);
    } catch (fallbackError) {
        console.warn('Celestial resilient surface generation failed:', fallbackError);
    }
    if (error) console.warn('Celestial close-up texture unavailable:', error);
    return markCelestialTextureReady(visit, { error: true });
}

function prepareCelestialVisitTexture(visit) {
    clearCelestialTextureWatchdog(visit);
    visit.textureWatchdog = window.setTimeout(() => {
        resolveCelestialTextureFallback(
            visit,
            new Error(`Celestial surface acquisition timed out for ${visit.profile.id}`)
        );
    }, 4800);
    celestialCloseupRenderer.prepare(visit.profile)
        .then(() => {
            markCelestialTextureReady(visit);
        })
        .catch(error => {
            resolveCelestialTextureFallback(visit, error);
        });
}

function settleCelestialVisit(visit) {
    if (state.celestialVisit !== visit || visit.phase !== 'approach') return;
    clearCelestialTextureWatchdog(visit);
    visit.phase = 'observing';
    visit.visualProgress = 1;
    state.celestialFlight = null;
    camera.orientation = visit.focusOrientation.slice();
    camera.targetOrientation = visit.focusOrientation.slice();
    camera.fov = visit.focusFov;
    camera.targetFov = visit.focusFov;
    state.detailFov = visit.focusFov;
    openCelestialPanel(visit.profile, visit.preferredPanelOnLeft);
}

function hideCelestialPanelForReturn() {
    if (dom.celestialPanel.contains(document.activeElement)) {
        dom.world.focus({ preventScroll: true });
    }
    dom.body.classList.remove('celestial-open', 'panel-left');
    dom.celestialPanel.classList.remove('is-left');
    dom.celestialPanel.setAttribute('aria-hidden', 'true');
    dom.celestialPanel.inert = true;
}

function beginCelestialReturn(
    restoreFocus = true,
    interactionSource = state.activationSource
) {
    const visit = state.celestialVisit;
    if (!visit || visit.phase === 'returning') return;
    clearCelestialTextureWatchdog(visit);
    hideCelestialPanelForReturn();
    refreshCelestialOriginAnchor(visit);
    visit.phase = 'returning';
    visit.returnSource = interactionSource;
    visit.restoreFocus = restoreFocus;
    visit.returnFocusToButton = Boolean(
        restoreFocus &&
        interactionSource === 'keyboard' &&
        visit.profile?.button
    );
    visit.transition = {
        startedAt: performance.now(),
        duration: REDUCED_MOTION ? 1 : 820,
        fromOrientation: camera.orientation.slice(),
        toOrientation: visit.origin.orientation.slice(),
        fromFov: camera.fov,
        toFov: visit.origin.fov,
        fromVisual: visit.visualProgress
    };
    state.celestialFlight = visit;
    state.scene = 'flying';
    state.detailFov = visit.origin.fov;
    camera.inspectionOrientation = null;
    dom.status.textContent = 'RETURNING TO LIVE SKY';
    setCelestialVisitClasses('returning');
    dom.portalNav.inert = true;
    dom.celestialNav.inert = true;
    dom.starNav.inert = true;

    const shouldRelock = (
        restoreFocus &&
        interactionSource !== 'keyboard' &&
        visit.origin.wasPointerLocked &&
        !state.touchMode &&
        !state.altHeld &&
        !state.modalOpen
    );
    if (interactionSource === 'keyboard' && document.pointerLockElement === dom.world) {
        state.lockIntent = 'keyboard';
        document.exitPointerLock();
    } else if (shouldRelock) {
        if (state.detailUnlockPending) {
            state.detailRelockPending = true;
        } else if (document.pointerLockElement !== dom.world) {
            requestViewLock('celestial-return');
        }
    }
}

function completeCelestialReturn(visit) {
    if (state.celestialVisit !== visit) return;
    clearCelestialTextureWatchdog(visit);
    const profile = visit.profile;
    camera.orientation = visit.origin.orientation.slice();
    camera.targetOrientation = visit.origin.targetOrientation.slice();
    camera.fov = visit.origin.fov;
    camera.targetFov = visit.origin.targetFov;
    camera.inspectionOrientation = null;
    state.celestialVisit = null;
    state.celestialFlight = null;
    state.scene = 'roam';
    state.activeCelestial = null;
    state.detailFov = 43 * DEG;
    state.panelOnLeft = false;
    state.panelSidePreference = false;
    dom.portalNav.inert = false;
    dom.celestialNav.inert = false;
    dom.starNav.inert = true;
    setCelestialVisitClasses(null);
    celestialCloseupRenderer.clear();

    if (flushPendingDrawerNavigation()) {
        state.detailUnlockPending = false;
        state.detailRelockPending = false;
        setFocusedCelestial(null);
        return;
    }

    if (visit.returnFocusToButton) {
        setFocusedCelestial(profile);
        profile.button.hidden = false;
        profile.button.inert = false;
        profile.buttonVisible = true;
        state.detailUnlockPending = false;
        state.detailRelockPending = false;
        settleUnlockedView('keyboard');
        requestAnimationFrame(() => {
            if (state.scene !== 'roam' || state.gateOpen) return;
            const target = !profile.button.hidden && !profile.button.inert
                ? profile.button
                : dom.world;
            target.focus({ preventScroll: true });
        });
        return;
    }

    setFocusedCelestial(null);
    if (state.touchMode) {
        dom.status.textContent = 'DRAG TO LOOK';
        return;
    }
    if (document.pointerLockElement === dom.world || state.lock === 'requesting') {
        dom.status.textContent = 'FREE LOOK';
        return;
    }
    if (visit.origin.wasPointerLocked && visit.restoreFocus) {
        settleUnlockedView('celestial-return', { focusGate: true });
    } else {
        settleUnlockedView('keyboard');
        dom.status.textContent = 'CURSOR FREE';
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

    if (state.celestialVisit?.phase === 'approach') {
        const visit = state.celestialVisit;
        const transition = visit.transition;
        const progress = clamp(
            (time - transition.startedAt) / transition.duration,
            0,
            1
        );
        const eased = easeInOutCubic(progress);
        camera.orientation = quatSlerp(
            transition.fromOrientation,
            transition.toOrientation,
            eased
        );
        camera.fov = Math.max(
            visit.focusFov,
            lerp(transition.fromFov, transition.toFov, eased) -
                Math.sin(progress * Math.PI) * 1.8 * DEG
        );
        camera.targetOrientation = camera.orientation.slice();
        camera.targetFov = camera.fov;

        if (visit.textureReady && visit.visualStartedAt !== null) {
            if (!visit.visualAnchorSet && time >= visit.visualStartedAt) {
                refreshCelestialApproachAnchor(visit);
                visit.visualAnchorSet = true;
            }
            const reveal = clamp(
                (time - visit.visualStartedAt) / visit.visualDuration,
                0,
                1
            );
            visit.visualProgress = REDUCED_MOTION ? 1 : easeInOutCubic(reveal);
        }
        if (progress >= 1 && !visit.textureReady) {
            dom.status.textContent = 'ACQUIRING SURFACE DATA';
        }
        if (
            progress >= 1 &&
            visit.textureReady &&
            visit.visualProgress >= 1
        ) {
            settleCelestialVisit(visit);
        }
        return;
    }

    if (state.celestialVisit?.phase === 'returning') {
        const visit = state.celestialVisit;
        const transition = visit.transition;
        const progress = clamp(
            (time - transition.startedAt) / transition.duration,
            0,
            1
        );
        const eased = easeInOutCubic(progress);
        camera.orientation = quatSlerp(
            transition.fromOrientation,
            transition.toOrientation,
            eased
        );
        camera.fov = lerp(transition.fromFov, transition.toFov, eased);
        camera.targetOrientation = camera.orientation.slice();
        camera.targetFov = camera.fov;
        visit.visualProgress = lerp(transition.fromVisual, 0, eased);
        if (progress >= 1) completeCelestialReturn(visit);
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

    updateCameraRoll(deltaSeconds);
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

function startCelestialFlight(profile, source = 'gaze') {
    if (
        !profile?.current?.direction ||
        !celestialAboveHorizon(profile) ||
        state.scene === 'flying' ||
        state.scene === 'leaving-home' ||
        state.modalOpen ||
        state.celestialVisit
    ) return;
    const originAnchor = celestialVisitProjectionAnchor(
        profile,
        camera.orientation,
        camera.fov
    );
    clearCameraRoll();
    if (state.scene === 'detail') {
        if (state.activePortal) closePortalPanel(false);
    }
    state.activationSource = source;
    state.scene = 'flying';
    state.activePortal = null;
    state.activeCelestial = profile;
    state.activeStarHip = null;
    state.hoverStarHip = null;
    setFocusedCelestial(profile);
    dom.status.textContent = 'TRACKING';
    const preferredPanelOnLeft = Boolean(
        profile.screen?.visible && profile.screen.x > overlayWidth * 0.56
    );
    const panelOnLeft = !usesCompactSkyLayout() && preferredPanelOnLeft;
    const focusFov = profile.id === 'sun' ? 14 * DEG : 12 * DEG;
    const origin = {
        orientation: camera.orientation.slice(),
        targetOrientation: camera.targetOrientation.slice(),
        fov: camera.fov,
        targetFov: camera.targetFov,
        wasPointerLocked: document.pointerLockElement === dom.world,
        lock: state.lock
    };
    const visit = {
        profile,
        phase: 'approach',
        origin,
        activationSource: source,
        originScreen: originAnchor.screen,
        originDiscGeometry: originAnchor.discGeometry,
        approachScreen: { ...originAnchor.screen },
        approachDiscGeometry: originAnchor.discGeometry,
        focusOrientation: routePointFraming(
            profile.current.direction,
            panelOnLeft,
            focusFov
        ),
        focusFov,
        panelOnLeft,
        preferredPanelOnLeft,
        textureReady: false,
        textureError: false,
        textureReadyAt: null,
        visualStartedAt: null,
        visualAnchorSet: false,
        visualDuration: REDUCED_MOTION ? 1 : 760,
        visualProgress: 0,
        transition: {
            startedAt: performance.now(),
            duration: REDUCED_MOTION ? 1 : 1060,
            fromOrientation: camera.orientation.slice(),
            toOrientation: routePointFraming(
                profile.current.direction,
                panelOnLeft,
                focusFov
            ),
            fromFov: camera.fov,
            toFov: focusFov
        }
    };
    state.celestialVisit = visit;
    state.celestialFlight = visit;
    dom.portalNav.inert = true;
    dom.celestialNav.inert = true;
    dom.starNav.inert = true;
    setCelestialVisitClasses('approach');
    prepareCelestialVisitTexture(visit);
}

function startPortalFlight(portal, source = 'gaze', action = 'open', arrivalHip = null) {
    if (
        !portal ||
        state.scene === 'flying' ||
        state.scene === 'leaving-home' ||
        state.modalOpen ||
        state.celestialFlight ||
        state.celestialVisit
    ) return;
    clearCameraRoll();
    if (state.scene === 'detail') {
        if (state.activeCelestial) closeCelestialPanel(false);
        else closePortalPanel(false);
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
    state.activeCelestial = null;
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
    if (state.celestialVisit) {
        beginCelestialReturn(true, source);
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
    clearCameraRoll();
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
    state.activeCelestial = null;
    state.activeStarHip = null;
    state.hoverStarHip = null;
    const names = orderedPortalNames(portal);
    const ui = starUiCopy[state.currentLang] || starUiCopy.en;
    dom.panelKicker.textContent = ui.sectionKicker;
    dom.panelTitle.textContent = names[0];
    dom.panelNames.textContent = LANGUAGES.map(lang => portalName(portal, lang)).join(' / ');
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
    dom.celestialNav.inert = true;
    dom.starNav.inert = false;
    const firstStarHip = portal.home
        ? null
        : (portal.patternHips.includes(preferredHip)
            ? preferredHip
            : firstContentStarHip(portal));
    if (firstStarHip === null) {
        showConstellationOverview(portal);
    } else {
        selectPortalStar(portal, firstStarHip);
    }
    updateThoughtToggles();
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
    dom.celestialNav.inert = false;
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

function formatSignedAngle(value) {
    if (!Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : value < 0 ? '−' : '';
    return `${sign}${Math.abs(value).toFixed(1)}°`;
}

function formatAzimuth(value) {
    if (!Number.isFinite(value)) return '—';
    const normalized = ((value % 360) + 360) % 360;
    return `${normalized.toFixed(1)}°`;
}

function formatDistanceAu(value) {
    if (!Number.isFinite(value)) return '—';
    const digits = value < 1 ? 3 : value < 10 ? 2 : 1;
    return (celestialUi[state.currentLang] || celestialUi.en).au(value.toFixed(digits));
}

function formatAngularDiameter(value) {
    if (!Number.isFinite(value)) return '—';
    const arcseconds = value / DEG * 3600;
    if (arcseconds >= 60) return `${(arcseconds / 60).toFixed(1)}′`;
    if (arcseconds >= 1) return `${arcseconds.toFixed(1)}″`;
    return `${arcseconds.toFixed(2)}″`;
}

function renderCelestialPanel(profile) {
    if (!profile) return;
    const ui = celestialUi[state.currentLang] || celestialUi.en;
    const current = profile.current;
    dom.celestialPanel.style.setProperty('--body-color', profile.color);
    dom.celestialPanelKicker.textContent = ui.kicker;
    dom.celestialObservationBadge.textContent = ui.badge;
    dom.celestialPanelTitle.textContent = celestialName(profile);
    dom.celestialPanelSubtitle.textContent = [
        localized(profile.kinds),
        LANGUAGES
            .filter(lang => lang !== state.currentLang)
            .map(lang => celestialName(profile, lang))
            .join(' / ')
    ].filter(Boolean).join(' · ');
    dom.celestialClose.setAttribute('aria-label', ui.close);
    dom.celestialDescription.textContent = localized(profile.descriptions);
    dom.celestialAltitudeLabel.textContent = ui.altitude;
    dom.celestialAzimuthLabel.textContent = ui.azimuth;
    dom.celestialDistanceLabel.textContent = ui.distance;
    dom.celestialMagnitudeLabel.textContent = ui.magnitude;
    dom.celestialPhaseLabel.textContent = ui.phase;
    dom.celestialVisibilityLabel.textContent = ui.horizon;
    dom.celestialAltitude.textContent = current
        ? formatSignedAngle(celestialDisplayAltitude(profile))
        : '—';
    dom.celestialAzimuth.textContent = current
        ? formatAzimuth(current.azimuth)
        : '—';
    dom.celestialDistance.textContent = current
        ? (profile.id === 'moon'
            ? `${Math.round(current.distanceKm).toLocaleString(state.currentLang)} km`
            : formatDistanceAu(current.distanceAu))
        : '—';
    dom.celestialMagnitude.textContent = current
        ? current.magnitude.toFixed(2).replace('-', '−')
        : '—';
    dom.celestialPhase.textContent = current
        ? `${Math.round(current.phase * 100)}%`
        : '—';
    dom.celestialVisibility.textContent = current
        ? ({
            'naked-eye': ui.nakedEye,
            marginal: ui.marginal,
            telescope: ui.telescope,
            daylight: ui.daylight,
            'below-horizon': ui.belowHorizon
        }[current.observationMode] || ui.unavailable)
        : ui.unavailable;
    const fragment = document.createDocumentFragment();
    profile.facts.forEach(fact => {
        const item = document.createElement('li');
        item.textContent = localized(fact);
        fragment.append(item);
    });
    dom.celestialFacts.replaceChildren(fragment);
    dom.celestialObserverNote.textContent = [
        ui.observer(
            observerLocationLabel(),
            skyModel.location.latitude.toFixed(3),
            skyModel.location.longitude.toFixed(3),
            observerTimeLabel()
        ),
        current
            ? ui.geometry(
                formatAngularDiameter(current.angularDiameter),
                `${current.phaseAngle.toFixed(1)}°`
            )
            : '',
        ui.scaleNote
    ].filter(Boolean).join(' · ');
}

function openCelestialPanel(profile, panelOnLeft = false) {
    const visit = state.celestialVisit;
    if (!visit || visit.profile !== profile) return;
    state.activePortal = null;
    state.activeCelestial = profile;
    state.activeStarHip = null;
    state.hoverStarHip = null;
    state.panelSidePreference = Boolean(panelOnLeft);
    state.panelOnLeft = !usesCompactSkyLayout() && state.panelSidePreference;
    state.scene = 'detail';
    visit.phase = 'observing';
    visit.panelOnLeft = state.panelOnLeft;
    visit.visualProgress = 1;
    camera.inspectionOrientation = camera.orientation.slice();
    camera.targetFov = state.detailFov;
    dom.celestialPanel.classList.toggle('is-left', state.panelOnLeft);
    dom.celestialPanel.inert = false;
    dom.celestialPanel.setAttribute('aria-hidden', 'false');
    dom.body.classList.add('celestial-open');
    dom.body.classList.toggle('panel-left', state.panelOnLeft);
    setCelestialVisitClasses('observing');
    dom.status.textContent = 'MAGNIFIED OBSERVATION';
    dom.portalNav.inert = true;
    dom.celestialNav.inert = true;
    dom.starNav.inert = true;
    renderCelestialPanel(profile);
    dom.celestialPanelBody.scrollTop = 0;
    releaseViewForDetail();
    requestAnimationFrame(() => dom.celestialClose.focus({ preventScroll: true }));
}

function closeCelestialPanel(
    restoreFocus = true,
    interactionSource = state.activationSource
) {
    if (!state.celestialVisit) return;
    beginCelestialReturn(restoreFocus, interactionSource);
}
