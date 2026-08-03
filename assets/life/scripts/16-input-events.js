document.addEventListener('pointerlockchange', handlePointerLockChange);
document.addEventListener('pointerlockerror', () => {
    if (state.lock !== 'requesting' || document.pointerLockElement === dom.world) return;
    handleLockFailure(undefined, state.lockRequestToken);
});

document.addEventListener('mousemove', event => {
    if (
        state.altHeld &&
        !event.altKey &&
        document.pointerLockElement !== dom.world
    ) {
        recoverMissingAltKeyup();
    }
    if (document.pointerLockElement !== dom.world || state.altHeld || state.modalOpen) return;
    applyLook(event.movementX, event.movementY);
});

document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !state.altHeld || event.altKey) return;
    restoreViewAfterAlt();
}, true);

dom.world.addEventListener('mousedown', event => {
    if (
        event.button === 0 &&
        document.pointerLockElement !== dom.world &&
        state.scene === 'roam' &&
        state.hasEntered &&
        !state.touchMode &&
        !state.altHeld &&
        !state.modalOpen &&
        !state.gateOpen
    ) {
        requestViewLock('world-click');
        return;
    }
    if (document.pointerLockElement !== dom.world) return;
    if (event.button === 2) {
        event.preventDefault();
        state.rightDown = true;
        return;
    }
    if (event.button === 0 && state.scene === 'roam') {
        if (state.focusedCelestial) {
            startCelestialFlight(state.focusedCelestial, 'gaze');
        } else if (state.focusedPortal) {
            startPortalFlight(state.focusedPortal, 'gaze');
        }
    }
});

dom.world.addEventListener('contextmenu', event => {
    if (document.pointerLockElement === dom.world) event.preventDefault();
});

document.addEventListener('mouseup', event => {
    if (event.button === 2) releaseRightZoom();
});
document.addEventListener('pointercancel', () => {
    releaseRightZoom();
    clearDragState();
});
window.addEventListener('blur', () => {
    releaseRightZoom();
    clearCameraRoll();
    clearDragState();
    if (state.sectionDrawerOpen) {
        resetTransientInput(false);
        return;
    }
    if (state.altHeld) {
        state.relockPending = state.altReturnMode === 'locked';
        return;
    }
    resetTransientInput(false);
});
document.addEventListener('visibilitychange', () => {
    releaseRightZoom();
    clearCameraRoll();
    if (document.hidden) {
        if (state.sectionDrawerOpen) {
            resetTransientInput(false);
        } else if (state.altHeld) {
            state.relockPending = state.altReturnMode === 'locked';
        } else {
            resetTransientInput(false);
        }
        stopRendering();
    } else {
        startRendering();
    }
});

dom.world.addEventListener('pointerdown', event => {
    if (
        !state.hasEntered ||
        state.scene !== 'roam' ||
        document.pointerLockElement === dom.world ||
        state.modalOpen
    ) return;
    if (event.pointerType === 'mouse' && !state.touchMode) return;
    if (dragState) {
        if (dragState.longPressTimer) window.clearTimeout(dragState.longPressTimer);
        dragState.moved = Infinity;
        return;
    }
    dragState = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: 0,
        longPressed: false,
        longPressTimer: 0
    };
    dragState.longPressTimer = window.setTimeout(() => {
        if (!dragState || dragState.pointerId !== event.pointerId || dragState.moved >= 9) return;
        dragState.longPressed = true;
        state.rightDown = true;
    }, 360);
    dom.world.setPointerCapture?.(event.pointerId);
});

dom.world.addEventListener('pointermove', event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.x;
    const deltaY = event.clientY - dragState.y;
    dragState.moved += Math.hypot(deltaX, deltaY);
    if (dragState.moved >= 9 && dragState.longPressTimer) {
        window.clearTimeout(dragState.longPressTimer);
        dragState.longPressTimer = 0;
    }
    dragState.x = event.clientX;
    dragState.y = event.clientY;
    applyLook(deltaX, deltaY, 1.25);
});

dom.world.addEventListener('pointerup', event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const wasTap = dragState.moved < 9 && !dragState.longPressed;
    clearDragState();
    if (wasTap && state.scene === 'roam') {
        if (state.focusedCelestial) {
            startCelestialFlight(state.focusedCelestial, 'touch');
        } else if (state.focusedPortal) {
            startPortalFlight(state.focusedPortal, 'touch');
        }
    }
});
dom.world.addEventListener('lostpointercapture', () => {
    clearDragState();
});

buildCelestialNavigation();
state.meteorShower = createMeteorShowerSelection();
refreshAstronomicalSky(new Date());
buildPortalGeometry();
buildSectionDrawer();
dom.sectionDrawerToggle.addEventListener('click', event => {
    const interactionSource = event.detail === 0 ? 'keyboard' : 'pointer';
    if (state.sectionDrawerOpen) {
        closeSectionDrawer({ interactionSource });
    } else {
        openSectionDrawer(interactionSource);
    }
});
dom.sectionDrawerClose.addEventListener('click', event => {
    closeSectionDrawer({
        interactionSource: event.detail === 0 ? 'keyboard' : 'pointer'
    });
});
dom.sectionDrawerScrim.addEventListener('click', () => {
    closeSectionDrawer({ interactionSource: 'pointer' });
});
dom.sectionDrawerHome.addEventListener('click', event => {
    navigateHomeFromSectionDrawer(event.detail === 0 ? 'keyboard' : 'pointer');
});
portalDefinitions.forEach(portal => {
    portal.button?.addEventListener('mouseenter', () => {
        state.hoverPortal = portal;
        setFocusedPortal(portal);
    });
    portal.button?.addEventListener('mouseleave', () => {
        if (state.hoverPortal === portal) state.hoverPortal = null;
    });
    portal.button?.addEventListener('focus', () => {
        state.hoverPortal = portal;
        setFocusedPortal(portal);
    });
    portal.button?.addEventListener('blur', () => {
        if (state.hoverPortal === portal) state.hoverPortal = null;
    });
    portal.button?.addEventListener('click', event => {
        event.preventDefault();
        startPortalFlight(portal, event.detail === 0 ? 'keyboard' : 'pointer');
    });
});

function isInteractiveKeyTarget(target) {
    return target instanceof Element && Boolean(target.closest(
        'button, a, input, textarea, select, summary, [role="button"], [contenteditable="true"], .portal-panel-body, .celestial-panel-body'
    ));
}

document.addEventListener('keydown', event => {
    if (state.altHeld && event.key !== 'Alt' && !event.altKey) {
        recoverMissingAltKeyup();
    }
    if (event.key === 'Alt') {
        clearCameraRoll();
        if (!state.modalOpen && !state.gateOpen) {
            event.preventDefault();
            releaseCursorForAlt();
        }
        return;
    }
    if (event.key === 'Escape') {
        releaseRightZoom();
        if (dom.lightbox.classList.contains('active')) {
            event.preventDefault();
            closeLightbox();
            return;
        }
        if (state.sectionDrawerOpen) {
            event.preventDefault();
            closeSectionDrawer({ interactionSource: 'keyboard' });
            return;
        }
        if (state.scene === 'flying') {
            event.preventDefault();
            cancelFlight('keyboard');
            return;
        }
        if (state.scene === 'detail') {
            event.preventDefault();
            if (state.activeCelestial) {
                closeCelestialPanel(true, 'keyboard');
                return;
            }
            if (state.routePreview) {
                cancelHomeRoutePreview();
                return;
            }
            closePortalPanel(true, 'keyboard');
            return;
        }
    }
    if (state.sectionDrawerOpen) {
        trapSectionDrawerFocus(event);
        return;
    }
    if (state.modalOpen || state.gateOpen) return;
    if (
        event.key === 'Tab' &&
        (document.pointerLockElement === dom.world || state.lock === 'requesting')
    ) {
        if (document.pointerLockElement === dom.world) {
            state.lockIntent = 'keyboard';
            document.exitPointerLock();
        } else {
            state.lockRequestToken += 1;
            window.clearTimeout(state.lockRequestTimer);
            state.lockRequestTimer = null;
            state.lockRequestSource = null;
            state.lockIntent = null;
            settleUnlockedView('keyboard');
        }
        return;
    }
    if (isInteractiveKeyTarget(event.target)) return;
    if ((event.key === 'Enter' || event.key === ' ') && state.scene === 'roam') {
        if (state.focusedCelestial) {
            event.preventDefault();
            startCelestialFlight(state.focusedCelestial, 'keyboard');
            return;
        }
        if (state.focusedPortal) {
            event.preventDefault();
            startPortalFlight(state.focusedPortal, 'keyboard');
            return;
        }
    }
    if ((event.key === 'z' || event.key === 'Z') && state.scene === 'roam') {
        state.rightDown = true;
        return;
    }
    if (state.scene !== 'roam') return;
    if (event.code === 'KeyA' || event.code === 'KeyD') {
        if (event.altKey) {
            clearCameraRoll();
            return;
        }
        event.preventDefault();
        if (event.code === 'KeyA') state.rollLeftHeld = true;
        if (event.code === 'KeyD') state.rollRightHeld = true;
        return;
    }
    const keyboardStep = 0.055;
    if (event.key === 'ArrowLeft') {
        event.preventDefault();
        applyLook(-keyboardStep / 0.00175, 0);
    } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        applyLook(keyboardStep / 0.00175, 0);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        applyLook(0, -keyboardStep / 0.00175);
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        applyLook(0, keyboardStep / 0.00175);
    }
});

window.addEventListener('keyup', event => {
    if (event.code === 'KeyA') state.rollLeftHeld = false;
    if (event.code === 'KeyD') state.rollRightHeld = false;
    if (
        event.key === 'Alt' ||
        event.code === 'AltLeft' ||
        event.code === 'AltRight'
    ) {
        event.preventDefault();
        restoreViewAfterAlt();
    }
    if (event.key === 'z' || event.key === 'Z') releaseRightZoom();
}, true);

dom.panelClose.addEventListener('click', event => {
    closePortalPanel(true, event.detail === 0 ? 'keyboard' : 'pointer');
});
dom.celestialClose.addEventListener('click', event => {
    closeCelestialPanel(true, event.detail === 0 ? 'keyboard' : 'pointer');
});
dom.homeRouteLaunch.addEventListener('click', event => {
    launchHomeRoute(
        state.portalReturnFocusTarget === dom.sectionDrawerToggle
            ? 'drawer'
            : (event.detail === 0 ? 'keyboard' : 'pointer')
    );
});
dom.homeRouteCancel.addEventListener('click', cancelHomeRoutePreview);
window.addEventListener('storage', event => {
    if (event.key !== WEATHER_LOCATION_STORAGE_KEY) return;
    skyModel.location = readWeatherObserverLocation();
    skyModel.observer = null;
    refreshAstronomicalSky(new Date());
    updateEntryLocationCopy();
});
function handleViewportResize() {
    galaxyRenderer.resize();
    celestialCloseupRenderer.resize();
    resizeOverlay();
    const now = performance.now();
    if (state.celestialVisit) {
        refreshCelestialOriginAnchor(state.celestialVisit);
        if (
            state.celestialVisit.phase === 'approach' &&
            state.celestialVisit.visualAnchorSet
        ) {
            refreshCelestialApproachAnchor(state.celestialVisit);
        }
    }
    if (
        state.celestialVisit?.phase === 'approach' &&
        state.celestialVisit.profile.current?.direction
    ) {
        const visit = state.celestialVisit;
        const transition = visit.transition;
        const progress = clamp(
            (now - transition.startedAt) / transition.duration,
            0,
            1
        );
        visit.panelOnLeft = !usesCompactSkyLayout() &&
            Boolean(visit.preferredPanelOnLeft);
        visit.focusOrientation = routePointFraming(
            visit.profile.current.direction,
            visit.panelOnLeft,
            visit.focusFov
        );
        visit.transition = {
            startedAt: now,
            duration: Math.max(1, transition.duration * (1 - progress)),
            fromOrientation: camera.orientation.slice(),
            toOrientation: visit.focusOrientation.slice(),
            fromFov: camera.fov,
            toFov: visit.focusFov
        };
    } else if (state.flight && state.flight.action !== 'home-departure') {
        const flight = state.flight;
        const progress = clamp((now - flight.startedAt) / flight.duration, 0, 1);
        flight.startOrientation = camera.orientation.slice();
        flight.startFov = camera.fov;
        flight.startedAt = now;
        flight.duration = Math.max(1, flight.duration * (1 - progress));
        flight.panelOnLeft = !usesCompactSkyLayout() &&
            Boolean(flight.preferredPanelOnLeft);
        const framing = constellationFraming(flight.portal, flight.panelOnLeft);
        flight.endOrientation = framing.orientation;
        flight.endFov = framing.fov;
    }
    if (state.scene === 'detail' && state.activePortal) {
        state.panelOnLeft = !usesCompactSkyLayout() &&
            state.panelSidePreference;
        dom.panel.classList.toggle('is-left', state.panelOnLeft);
        dom.body.classList.toggle('panel-left', state.panelOnLeft);
        if (state.routePreview) {
            refreshHomeRouteGeometry(state.routePreview, {
                restart: !state.routePreview.settled,
                track: state.routePreview.settled
            });
        } else if (!state.activePortalOpenedThroughIndex) {
            const framing = constellationFraming(state.activePortal, state.panelOnLeft);
            state.detailFov = framing.fov;
            camera.orientation = framing.orientation.slice();
            camera.targetOrientation = framing.orientation.slice();
            camera.inspectionOrientation = framing.orientation.slice();
            camera.fov = framing.fov;
            camera.targetFov = framing.fov;
        }
        state.panelRect = dom.panel.getBoundingClientRect();
    } else if (
        state.scene === 'detail' &&
        state.activeCelestial?.current?.direction &&
        state.celestialVisit?.phase === 'observing'
    ) {
        state.panelOnLeft = !usesCompactSkyLayout() &&
            state.panelSidePreference;
        state.celestialVisit.panelOnLeft = state.panelOnLeft;
        dom.celestialPanel.classList.toggle('is-left', state.panelOnLeft);
        dom.body.classList.toggle('panel-left', state.panelOnLeft);
        state.celestialVisit.focusOrientation = routePointFraming(
            state.activeCelestial.current.direction,
            state.panelOnLeft,
            state.detailFov
        );
        camera.targetOrientation = state.celestialVisit.focusOrientation.slice();
        camera.inspectionOrientation = state.celestialVisit.focusOrientation.slice();
        camera.targetFov = state.detailFov;
    }
    resizeMaps();
}
window.addEventListener('resize', handleViewportResize);
