function updateGazeTarget(time) {
    if (state.scene === 'flying' || state.scene === 'leaving-home') return;
    if (state.scene === 'detail' && state.activePortal) {
        if (state.focusedPortal !== state.activePortal) setFocusedPortal(state.activePortal);
        return;
    }
    if (state.scene === 'detail' && state.activeCelestial) {
        if (state.focusedCelestial !== state.activeCelestial) {
            setFocusedCelestial(state.activeCelestial);
        }
        return;
    }

    if (
        state.hoverCelestial &&
        celestialAboveHorizon(state.hoverCelestial) &&
        state.lock !== 'locked'
    ) {
        if (state.focusedCelestial !== state.hoverCelestial) {
            setFocusedCelestial(state.hoverCelestial);
        }
        return;
    }
    if (
        state.hoverPortal &&
        isAboveHorizon(state.hoverPortal.direction) &&
        (state.hoverPortal.skyVisibility ?? 1) > 0.025 &&
        state.lock !== 'locked'
    ) {
        if (state.focusedPortal !== state.hoverPortal) setFocusedPortal(state.hoverPortal);
        return;
    }

    let best = null;
    let bestDistance = Infinity;
    portalDefinitions.forEach(portal => {
        if (
            !isAboveHorizon(portal.direction) ||
            (portal.skyVisibility ?? 1) <= 0.025 ||
            !portal.screen?.visible
        ) return;
        const distance = Math.hypot(
            portal.screen.x - overlayWidth * 0.5,
            portal.screen.y - overlayHeight * 0.5
        );
        if (distance < bestDistance) {
            best = { kind: 'portal', item: portal };
            bestDistance = distance;
        }
    });
    celestialBodies.forEach(profile => {
        if (
            !celestialAboveHorizon(profile) ||
            !profile.screen?.visible
        ) return;
        const distance = Math.hypot(
            profile.screen.x - overlayWidth * 0.5,
            profile.screen.y - overlayHeight * 0.5
        );
        if (distance < bestDistance) {
            best = { kind: 'celestial', item: profile };
            bestDistance = distance;
        }
    });

    const enterRadius = clamp(Math.min(overlayWidth, overlayHeight) * 0.085, 48, 74);
    const exitRadius = enterRadius + 28;
    const focusedItem = state.focusedCelestial || state.focusedPortal;
    const focusedDirection = state.focusedCelestial
        ? state.focusedCelestial.current?.direction
        : state.focusedPortal?.direction;
    const focusedAboveHorizon = state.focusedCelestial
        ? celestialAboveHorizon(state.focusedCelestial)
        : isAboveHorizon(focusedDirection);
    if (
        focusedItem?.screen?.visible &&
        focusedAboveHorizon
    ) {
        const currentDistance = Math.hypot(
            focusedItem.screen.x - overlayWidth * 0.5,
            focusedItem.screen.y - overlayHeight * 0.5
        );
        if (currentDistance <= exitRadius) return;
    }

    if (!best || bestDistance > enterRadius) {
        state.pendingTarget = null;
        if (state.focusedCelestial) {
            setFocusedCelestial(null);
        } else if (state.focusedPortal) {
            setFocusedPortal(null);
        }
        return;
    }

    if (
        state.pendingTarget?.kind !== best.kind ||
        state.pendingTarget?.item !== best.item
    ) {
        state.pendingTarget = best;
        state.pendingSince = time;
        return;
    }

    if (time - state.pendingSince >= (REDUCED_MOTION ? 0 : 145)) {
        if (best.kind === 'celestial') {
            setFocusedCelestial(best.item);
        } else {
            setFocusedPortal(best.item);
        }
        state.pendingTarget = null;
    }
}

function renderGazeCopy(portal) {
    if (!portal) {
        dom.gazePrimary.textContent = '';
        dom.gazeSecondary.textContent = '';
        dom.gazeConstellation.textContent = '';
        dom.gazeDescription.textContent = '';
        return;
    }

    const names = orderedPortalNames(portal);
    const story = constellationStories[portal.id];
    dom.gazePrimary.textContent = names[0];
    dom.gazeSecondary.textContent = names.slice(1).join(' / ');
    dom.gazeConstellation.textContent = localized(story?.name);
    dom.gazeDescription.textContent = localized(story?.reason);
}

function renderCelestialGazeCopy(profile) {
    if (!profile) {
        renderGazeCopy(null);
        return;
    }
    const others = LANGUAGES.filter(lang => lang !== state.currentLang);
    const ui = celestialUi[state.currentLang] || celestialUi.en;
    dom.gazePrimary.textContent = celestialName(profile);
    dom.gazeSecondary.textContent = others
        .map(lang => celestialName(profile, lang))
        .join(' / ');
    dom.gazeConstellation.textContent = localized(profile.kinds);
    const visibility = {
        'naked-eye': ui.nakedEye,
        marginal: ui.marginal,
        telescope: ui.telescope,
        daylight: ui.daylight,
        'below-horizon': ui.belowHorizon
    }[profile.current?.observationMode] || ui.unavailable;
    dom.gazeDescription.textContent = profile.current
        ? `${visibility} · ${ui.altitude} ${
            celestialDisplayAltitude(profile).toFixed(1)
        }° · ${ui.inspect}`
        : ui.unavailable;
}

function scheduleGazeCopyClear() {
    state.gazeClearTimer = window.setTimeout(() => {
        if (!state.focusedPortal && !state.focusedCelestial) renderGazeCopy(null);
        state.gazeClearTimer = null;
    }, REDUCED_MOTION ? 0 : 580);
}

function setFocusedPortal(portal) {
    if (portal) state.focusedCelestial = null;
    state.focusedPortal = portal;
    const hasTarget = Boolean(portal || state.focusedCelestial);
    dom.body.classList.toggle('has-target', hasTarget);
    window.clearTimeout(state.announcementTimer);
    window.clearTimeout(state.gazeClearTimer);
    state.announcementTimer = null;
    state.gazeClearTimer = null;
    dom.gazeAnnouncement.textContent = '';
    if (!portal) {
        if (!state.focusedCelestial) scheduleGazeCopyClear();
        return;
    }
    renderGazeCopy(portal);

    const story = constellationStories[portal.id];
    state.announcementTimer = window.setTimeout(() => {
        if (state.focusedPortal === portal) {
            dom.gazeAnnouncement.textContent = [
                LANGUAGES.map(lang => portalName(portal, lang)).join(' / '),
                localized(story?.name),
                localized(story?.reason)
            ].filter(Boolean).join(' · ');
        }
    }, REDUCED_MOTION ? 0 : 420);
}

function setFocusedCelestial(profile) {
    if (profile) state.focusedPortal = null;
    state.focusedCelestial = profile;
    const hasTarget = Boolean(profile || state.focusedPortal);
    dom.body.classList.toggle('has-target', hasTarget);
    window.clearTimeout(state.announcementTimer);
    window.clearTimeout(state.gazeClearTimer);
    state.announcementTimer = null;
    state.gazeClearTimer = null;
    dom.gazeAnnouncement.textContent = '';
    if (!profile) {
        if (!state.focusedPortal) scheduleGazeCopyClear();
        return;
    }
    renderCelestialGazeCopy(profile);
    state.announcementTimer = window.setTimeout(() => {
        if (state.focusedCelestial === profile) {
            dom.gazeAnnouncement.textContent = [
                LANGUAGES.map(lang => celestialName(profile, lang)).join(' / '),
                localized(profile.kinds),
                (celestialUi[state.currentLang] || celestialUi.en).inspect
            ].filter(Boolean).join(' · ');
        }
    }, REDUCED_MOTION ? 0 : 420);
}

function homeRouteReveal(preview, time) {
    if (!preview || preview.settled || REDUCED_MOTION) return 1;
    const progress = clamp((time - preview.startedAt) / preview.duration, 0, 1);
    return lerp(preview.revealStart || 0, 1, progress);
}

function drawHomeRoutePreview(basis, time) {
    const preview = state.routePreview;
    if (!preview) return;
    const context = overlayContext;
    const reveal = homeRouteReveal(preview, time);
    const source = projectDirection(
        preview.sourceDirection,
        basis,
        overlayWidth,
        overlayHeight
    );
    const destination = projectDirection(
        preview.destinationDirection,
        basis,
        overlayWidth,
        overlayHeight
    );

    context.save();
    context.globalCompositeOperation = 'screen';
    context.lineCap = 'round';
    if (preview.action.type === 'home') {
        if (source?.visible) {
            const pulse = REDUCED_MOTION ? 0 : Math.sin(time * 0.004) * 2;
            context.strokeStyle = 'rgba(255,218,158,0.62)';
            context.lineWidth = 1;
            context.beginPath();
            context.arc(source.x, source.y, 21 + pulse, 0, Math.PI * 2);
            context.stroke();
            context.strokeStyle = 'rgba(224,235,255,0.28)';
            context.beginPath();
            context.arc(source.x, source.y, 32 + pulse * 0.6, 0, Math.PI * 2);
            context.stroke();
        }
        context.restore();
        return;
    }

    const sampleCount = 84;
    const visibleSamples = Math.max(2, Math.ceil(sampleCount * reveal));
    const samples = [];
    for (let index = 0; index < visibleSamples; index += 1) {
        const amount = index / (sampleCount - 1);
        samples.push(projectDirection(
            slerpDirection(preview.sourceDirection, preview.destinationDirection, amount),
            basis,
            overlayWidth,
            overlayHeight
        ));
    }

    const strokeSegments = () => {
        let drawing = false;
        context.beginPath();
        samples.forEach(point => {
            if (!point?.visible) {
                drawing = false;
                return;
            }
            if (!drawing) {
                context.moveTo(point.x, point.y);
                drawing = true;
            } else {
                context.lineTo(point.x, point.y);
            }
        });
        context.stroke();
    };

    context.strokeStyle = 'rgba(122,166,231,0.16)';
    context.lineWidth = 6;
    strokeSegments();
    context.strokeStyle = 'rgba(209,227,255,0.7)';
    context.lineWidth = 1.25;
    context.setLineDash([9, 8]);
    context.lineDashOffset = REDUCED_MOTION ? 0 : -time * 0.026;
    strokeSegments();
    context.setLineDash([]);

    if (source?.visible) {
        context.fillStyle = 'rgba(255,226,177,0.95)';
        context.beginPath();
        context.arc(source.x, source.y, 3.2, 0, Math.PI * 2);
        context.fill();
    }
    if (destination?.visible && reveal > 0.94) {
        const pulse = REDUCED_MOTION ? 0 : Math.sin(time * 0.0042) * 1.4;
        context.strokeStyle = 'rgba(219,232,255,0.76)';
        context.lineWidth = 1;
        context.beginPath();
        context.arc(destination.x, destination.y, 12 + pulse, 0, Math.PI * 2);
        context.stroke();
        context.fillStyle = 'rgba(238,244,255,0.92)';
        context.beginPath();
        context.arc(destination.x, destination.y, 3.1, 0, Math.PI * 2);
        context.fill();
    }
    context.restore();
}

function drawConstellations(basis, time, webglRendered, catalogBasis = basis) {
    resizeOverlay();
    overlayContext.clearRect(0, 0, overlayWidth, overlayHeight);
    if (!webglRendered) drawFallbackSpace(catalogBasis, time);
    drawMeteorShower(basis, time);

    const context = overlayContext;
    const active = state.activePortal;
    portalDefinitions.forEach((portal, portalIndex) => {
        const center = projectDirection(portal.direction, basis, overlayWidth, overlayHeight);
        const points = portal.patternPoints.map(point =>
            projectDirection(point, basis, overlayWidth, overlayHeight)
        );
        const pointVisibility = portal.patternPoints.map((direction, index) =>
            starVisibilityAtDirection(
                direction,
                Number.isFinite(portal.patternMagnitudes?.[index])
                    ? portal.patternMagnitudes[index]
                    : 0
            )
        );
        portal.skyVisibility = Math.max(0, ...pointVisibility);
        portal.rawScreen = center;
        portal.screen = isAboveHorizon(portal.direction) ? center : null;
        updatePortalButton(portal, portal.screen);
        portal.screenPoints = points;
        portal.patternHips.forEach((hip, index) => {
            updateStarButtonPosition(
                portal,
                hip,
                points[index],
                portal.patternPoints[index]
            );
        });
        const anyVisiblePoint = points.some((point, index) =>
            point?.visible &&
            isAboveHorizon(portal.patternPoints[index]) &&
            pointVisibility[index] > 0.001
        );
        if (!anyVisiblePoint && !portal.screen?.visible) return;

        const routeTarget = state.routePreview?.action.type === 'portal' &&
            state.routePreview.targetPortal === portal;
        const focused = state.focusedPortal === portal || routeTarget;
        const selected = active === portal;
        const edgeAlpha = selected ? 0.52 : routeTarget ? 0.56 : focused ? 0.4 : 0.15;
        const starAlpha = selected ? 1 : focused ? 0.96 : 0.73;
        const warm = Boolean(portal.home);

        context.save();
        context.globalCompositeOperation = 'screen';
        context.lineWidth = focused || selected ? 0.9 : 0.55;
        context.strokeStyle = warm
            ? `rgba(255,218,158,${edgeAlpha})`
            : `rgba(202,220,255,${edgeAlpha})`;
        portal.patternEdges.forEach(([startIndex, endIndex]) => {
            const start = points[startIndex];
            const end = points[endIndex];
            const edgeVisibility = Math.min(
                pointVisibility[startIndex] || 0,
                pointVisibility[endIndex] || 0
            );
            if (!start?.visible || !end?.visible || edgeVisibility <= 0.001) return;
            context.globalAlpha = edgeVisibility;
            context.beginPath();
            context.moveTo(start.x, start.y);
            context.lineTo(end.x, end.y);
            context.stroke();
        });
        context.globalAlpha = 1;

        points.forEach((point, index) => {
            const astronomicalVisibility = pointVisibility[index] || 0;
            if (!point?.visible || astronomicalVisibility <= 0.001) return;
            const hip = portal.patternHips[index];
            const routeDestination = routeTarget && state.routePreview.targetHip === hip;
            const starSelected = (selected && state.activeStarHip === hip) || routeDestination;
            const starHovered = selected && state.hoverStarHip === hip;
            const pulse = REDUCED_MOTION
                ? 1
                : 0.92 + 0.08 * Math.sin(time * 0.0012 + portalIndex * 2.1 + index * 1.7);
            const isAnchor = index === portal.anchorIndex;
            const homeExpansion = portal.home &&
                state.flight?.action === 'home-departure' &&
                selected &&
                isAnchor
                ? state.homeWarpProgress * state.homeWarpProgress * 15
                : 0;
            const baseRadius = portal.home && isAnchor
                ? 2.9 + homeExpansion
                : (isAnchor ? 2.25 : 1.35 + (index % 3) * 0.22);
            const interactionScale = starSelected ? 1.72 : starHovered ? 1.46 : 1;
            drawStarGlow(
                context,
                point.x,
                point.y,
                baseRadius * pulse * (focused || selected ? 1.22 : 1) *
                    interactionScale * (routeDestination ? 1.34 : 1),
                Math.min(
                    1,
                    starAlpha *
                        astronomicalVisibility *
                        (isAnchor ? 1 : 0.78) *
                        (starSelected || starHovered ? 1.18 : 1)
                ),
                warm
            );
        });
        context.restore();
    });

    drawCelestialBodies(basis, time);
    drawHomeRoutePreview(basis, time);

    if (
        state.scene === 'detail' &&
        active?.screen?.visible &&
        !state.routePreview
    ) {
        const rect = state.panelRect;
        if (rect?.width > 0) {
            const activeStarIndex = active.patternHips.indexOf(state.activeStarHip);
            const source = activeStarIndex >= 0 && active.screenPoints?.[activeStarIndex]?.visible
                ? active.screenPoints[activeStarIndex]
                : active.screen;
            const endX = state.panelOnLeft ? rect.right : rect.left;
            const endY = clamp(source.y, rect.top + 72, rect.bottom - 54);
            const gradient = context.createLinearGradient(source.x, source.y, endX, endY);
            gradient.addColorStop(0, 'rgba(224,234,255,0.34)');
            gradient.addColorStop(1, 'rgba(224,234,255,0.03)');
            context.strokeStyle = gradient;
            context.lineWidth = 0.7;
            context.beginPath();
            context.moveTo(source.x, source.y);
            context.lineTo(endX, endY);
            context.stroke();
        }
    }

    drawLocalHorizon(basis);
    updateGazeTarget(time);
}

function applyLook(deltaX, deltaY, multiplier = 1) {
    if (state.scene === 'flying' || state.scene === 'leaving-home' || state.scene === 'detail') return;
    const sensitivity = (COARSE_POINTER ? 0.0032 : 0.00175) * multiplier;
    const horizontalRotation = quatAxisAngle(
        0,
        1,
        0,
        deltaX * sensitivity
    );
    const verticalRotation = quatAxisAngle(
        1,
        0,
        0,
        deltaY * sensitivity
    );
    const proposed = quatNormalize(quatMultiply(
        quatMultiply(camera.targetOrientation, horizontalRotation),
        verticalRotation
    ));
    camera.targetOrientation = constrainOrientationAboveHorizon(
        proposed,
        camera.lastStableYaw
    );
    const forward = quatRotate(camera.targetOrientation, [0, 0, 1]);
    if (Math.hypot(forward[0], forward[2]) > 1e-5) {
        camera.lastStableYaw = Math.atan2(forward[0], forward[2]);
    }
}

function enforceCameraSkyDome() {
    camera.orientation = constrainOrientationAboveHorizon(
        camera.orientation,
        camera.lastStableYaw
    );
    camera.targetOrientation = constrainOrientationAboveHorizon(
        camera.targetOrientation,
        camera.lastStableYaw
    );
    const pose = decomposeYawPitchRoll(
        camera.orientation,
        camera.lastStableYaw
    );
    if (Math.cos(pose.pitch) > 1e-5) camera.lastStableYaw = pose.yaw;
}
