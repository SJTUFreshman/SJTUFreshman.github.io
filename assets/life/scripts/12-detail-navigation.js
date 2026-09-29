function buildCelestialNavigation() {
    const fragment = document.createDocumentFragment();
    celestialBodies.forEach(profile => {
        const button = document.createElement('button');
        button.className = 'celestial-hit';
        button.type = 'button';
        button.dataset.celestialId = profile.id;
        button.hidden = true;
        button.inert = true;
        button.style.setProperty('--body-color', profile.color);
        const label = document.createElement('span');
        label.className = 'celestial-hit-label';
        button.append(label);
        button.addEventListener('mouseenter', () => {
            state.hoverCelestial = profile;
            if (state.lock !== 'locked') setFocusedCelestial(profile);
        });
        button.addEventListener('mouseleave', () => {
            if (state.hoverCelestial === profile) state.hoverCelestial = null;
        });
        button.addEventListener('focus', () => {
            state.hoverCelestial = profile;
            setFocusedCelestial(profile);
        });
        button.addEventListener('blur', () => {
            if (state.hoverCelestial === profile) state.hoverCelestial = null;
        });
        button.addEventListener('click', event => {
            event.preventDefault();
            startCelestialFlight(profile, event.detail === 0 ? 'keyboard' : 'pointer');
        });
        profile.button = button;
        fragment.append(button);
    });
    dom.celestialNav.append(fragment);
    updateCelestialNavigationCopy();
}

function updateCelestialNavigationCopy() {
    const ui = celestialUi[state.currentLang] || celestialUi.en;
    dom.celestialNav.setAttribute('aria-label', ui.nav);
    celestialBodies.forEach(profile => {
        const name = celestialName(profile);
        const kind = localized(profile.kinds);
        const mode = profile.current?.observationMode;
        const visibility = {
            'naked-eye': ui.nakedEye,
            marginal: ui.marginal,
            telescope: ui.telescope,
            daylight: ui.daylight,
            'below-horizon': ui.belowHorizon
        }[mode] || ui.unavailable;
        const label = profile.button?.querySelector('.celestial-hit-label');
        if (label) label.textContent = `${name} · ${visibility}`;
        profile.button?.setAttribute('aria-label', `${name} · ${kind} · ${visibility}`);
    });
}

function updateCelestialButton(profile, projected) {
    const button = profile.button;
    if (!button) return;
    const assisted = !profile.current?.nakedEyeVisible;
    button.classList.toggle('is-assisted', assisted);
    button.dataset.observationMode = profile.current?.observationMode || 'unavailable';
    const aboveHorizon = celestialAboveHorizon(profile);
    const onScreen = aboveHorizon &&
        state.scene === 'roam' &&
        hitAreaIntersectsViewport(projected, COARSE_POINTER ? 47 : 41);
    if (!aboveHorizon) {
        if (state.hoverCelestial === profile) state.hoverCelestial = null;
        if (state.focusedCelestial === profile && state.scene === 'roam') {
            setFocusedCelestial(null);
        }
    }
    if (profile.buttonVisible !== onScreen) {
        profile.buttonVisible = onScreen;
        button.hidden = !onScreen;
        button.inert = !onScreen;
    }
    if (!onScreen) return;
    if (
        profile.buttonX === undefined ||
        Math.abs(profile.buttonX - projected.x) > 0.35 ||
        Math.abs(profile.buttonY - projected.y) > 0.35
    ) {
        profile.buttonX = projected.x;
        profile.buttonY = projected.y;
        button.style.transform =
            `translate3d(${projected.x}px, ${projected.y}px, 0) translate(-50%, -50%)`;
    }
}

function starName(hip, lang = state.currentLang) {
    return localized(starProfiles[hip]?.names, lang) || `HIP ${hip}`;
}

function starCatalogValues(hip) {
    const index = window.HipparcosSky?.indexByHip?.get(hip);
    if (index === undefined) return { magnitude: Number.NaN, colorIndex: Number.NaN };
    return {
        magnitude: window.HipparcosSky.magnitudes[index],
        colorIndex: window.HipparcosSky.colorIndices[index]
    };
}

function starEntries(portal, hip) {
    return portal.entriesByHip?.get(hip) || [];
}

function firstContentStarHip(portal) {
    return portal.contentOrder?.find(hip => starEntries(portal, hip).length > 0) ?? null;
}

function entryPreview(entry) {
    if (!entry) return '';
    if (entry.classList.contains('portal-moment')) {
        const date = entry.querySelector('.portal-moment-meta span')?.textContent.trim() || '';
        const location = entry.querySelector('.portal-moment-location')?.textContent.trim() || '';
        const summary = entry.querySelector('h3')?.textContent.trim() || '';
        return [[date, location].filter(Boolean).join(' · '), summary].filter(Boolean).join(' — ');
    }
    if (entry.classList.contains('friend-link')) return entry.textContent.trim();
    if (entry.classList.contains('maps-list')) {
        return document.getElementById('visitedCountriesSummary')?.textContent.trim() || '';
    }
    if (entry.classList.contains('about-card')) {
        const name = entry.querySelector('h3')?.textContent.trim() || '';
        const role = entry.querySelector('.about-role')?.textContent.trim() || '';
        return [name, role].filter(Boolean).join(' · ');
    }
    if (entry.classList.contains('news-entry')) {
        const date = entry.querySelector('.news-date, .archive-meta')?.textContent.trim() || '';
        const title = entry.querySelector('.news-text, h3')?.textContent.trim() || '';
        return [date, title].filter(Boolean).join(' · ');
    }
    if (entry.classList.contains('publication-entry')) {
        const venue = entry.querySelector('.pub-venue, .archive-meta')?.textContent.trim() || '';
        const title = entry.querySelector('.pub-title-text, h3')?.textContent.trim() || '';
        return [venue, title].filter(Boolean).join(' · ');
    }
    if (entry.classList.contains('project-entry')) {
        const title = entry.querySelector('.project-name, h3')?.textContent.trim() || '';
        const description = entry.querySelector('.project-desc, .project-entry-copy p')?.textContent.trim() || '';
        return [title, description].filter(Boolean).join(' · ');
    }
    if (entry.classList.contains('note-entry')) {
        const meta = entry.querySelector('.note-meta, .archive-meta')?.textContent.trim() || '';
        const title = entry.querySelector('.note-title, strong')?.textContent.trim() || '';
        return [meta, title].filter(Boolean).join(' · ');
    }
    return entry.textContent.trim().replace(/\s+/g, ' ').slice(0, 110);
}

function homeDestinationCopy(hip) {
    const ui = starUiCopy[state.currentLang] || starUiCopy.en;
    const action = homeStarTargets[hip];
    if (!action) return ui.empty;
    if (action.type === 'home') return ui.home;
    const target = portalDefinitions.find(portal => portal.id === action.portalId);
    const route = localized(action.route);
    return ui.route(route || (target ? portalName(target, state.currentLang) : action.portalId));
}

function updateStarButtonCopy(portal, hip) {
    const button = portal.starButtons?.get(hip);
    if (!button) return;
    const entries = starEntries(portal, hip);
    const ui = starUiCopy[state.currentLang] || starUiCopy.en;
    const name = starName(hip);
    let preview = portal.home ? homeDestinationCopy(hip) : entryPreview(entries[0]);
    if (!preview) preview = ui.empty;
    if (entries.length > 1) preview = `${preview} · +${entries.length - 1}`;
    const nameNode = button.querySelector('.star-hit-copy > strong');
    const previewNode = button.querySelector('.star-hit-copy > span');
    if (nameNode) nameNode.textContent = name;
    if (previewNode) previewNode.textContent = preview;
    button.classList.toggle(
        'has-content',
        portal.home ? Boolean(homeStarTargets[hip]) : entries.length > 0
    );
    button.classList.toggle('is-selected', state.activeStarHip === hip);
    button.setAttribute('aria-label', `${name} · ${preview}`);
}

function updateStarButtonPosition(portal, hip, projected, direction = null) {
    const button = portal.starButtons?.get(hip);
    if (!button) return;
    const cache = portal.starButtonScreens?.get(hip);
    const active = state.scene === 'detail' && state.activePortal === portal;
    const onScreen = active &&
        isAboveHorizon(direction) &&
        hitAreaIntersectsViewport(
        projected,
        usesCompactSkyLayout() ? 38 : 32
    );
    if (!cache || cache.visible !== onScreen) {
        if (cache) cache.visible = onScreen;
        button.hidden = !onScreen;
        button.inert = !onScreen;
    }
    if (!onScreen) return;
    if (
        !cache ||
        !Number.isFinite(cache.x) ||
        Math.abs(cache.x - projected.x) > 0.35 ||
        Math.abs(cache.y - projected.y) > 0.35
    ) {
        if (cache) {
            cache.x = projected.x;
            cache.y = projected.y;
        }
        button.style.transform =
            `translate3d(${projected.x}px, ${projected.y}px, 0) translate(-50%, -50%)`;
    }
}

function hideAllStarButtons() {
    portalDefinitions.forEach(portal => {
        portal.starButtons?.forEach((button, hip) => {
            const cache = portal.starButtonScreens?.get(hip);
            if (!cache || cache.visible) {
                button.hidden = true;
                button.inert = true;
            }
            if (cache) cache.visible = false;
            button.classList.remove('is-selected');
        });
    });
}

function refreshPortalPanelRect() {
    state.panelRect =
        dom.body.classList.contains('panel-open') && state.activePortal
            ? dom.panel.getBoundingClientRect()
            : null;
}

function hideHomeRoutePreview() {
    dom.body.classList.remove('route-preview-active');
    dom.homeRoutePreview.hidden = true;
    dom.homeRoutePreview.removeAttribute('aria-busy');
    dom.homeRouteLaunch.disabled = false;
    state.panelRect = null;
}

function routeDestination(portal, action) {
    if (action.type === 'home') {
        return {
            portal,
            hip: null,
            direction: null,
            label: (starUiCopy[state.currentLang] || starUiCopy.en).home
        };
    }
    const targetPortal = portalDefinitions.find(candidate => candidate.id === action.portalId);
    if (!targetPortal) return null;
    const targetHip = firstContentStarHip(targetPortal) ??
        targetPortal.contentOrder?.[0] ??
        targetPortal.patternHips?.[0] ??
        null;
    const targetIndex = targetPortal.patternHips.indexOf(targetHip);
    const direction = targetIndex >= 0
        ? targetPortal.patternPoints[targetIndex]
        : targetPortal.direction;
    return {
        portal: targetPortal,
        hip: targetHip,
        direction,
        label: [
            portalName(targetPortal, state.currentLang),
            targetHip === null ? '' : starName(targetHip)
        ].filter(Boolean).join(' · ')
    };
}

function refreshHomeRouteGeometry(
    preview,
    { restart = false, track = false } = {}
) {
    if (!preview) return;
    const sourceIndex = preview.sourcePortal.patternHips.indexOf(preview.sourceHip);
    preview.sourceDirection = sourceIndex >= 0
        ? preview.sourcePortal.patternPoints[sourceIndex]
        : preview.sourcePortal.direction;
    const destination = routeDestination(preview.sourcePortal, preview.action);
    if (!destination) return;
    preview.targetPortal = destination.portal;
    preview.targetHip = destination.hip;
    preview.destinationDirection = destination.direction || preview.sourceDirection;
    const framing = interstellarRouteFraming(
        preview.sourceDirection,
        preview.destinationDirection,
        state.panelOnLeft
    );
    preview.sourceOrientation = framing.sourceOrientation;
    preview.destinationOrientation = framing.orientation;
    preview.destinationFov = framing.fov;
    if (track && preview.settled) {
        state.detailFov = framing.fov;
        camera.targetOrientation = framing.orientation.slice();
        camera.targetFov = framing.fov;
    } else if (restart) {
        const now = performance.now();
        const revealProgress = homeRouteReveal(preview, now);
        const progress = clamp(
            (now - preview.startedAt) / preview.duration,
            0,
            1
        );
        const previousSourceStop = preview.sourceStop ?? 0.34;
        const remainingRatio = Math.max(0, 1 - progress);
        preview.startOrientation = camera.orientation.slice();
        preview.startFov = camera.fov;
        preview.revealStart = revealProgress;
        preview.startedAt = now;
        preview.duration = REDUCED_MOTION
            ? 1
            : Math.max(1, preview.duration * remainingRatio);
        if (preview.action.type !== 'home') {
            preview.sourceStop = progress < previousSourceStop && remainingRatio > 0
                ? (previousSourceStop - progress) / remainingRatio
                : 0;
        }
    }
}

function renderHomeRoutePreviewCopy() {
    const preview = state.routePreview;
    if (!preview) {
        hideHomeRoutePreview();
        return;
    }
    dom.body.classList.add('route-preview-active');
    const ui = starUiCopy[state.currentLang] || starUiCopy.en;
    const destination = routeDestination(preview.sourcePortal, preview.action);
    dom.homeRouteFromLabel.textContent = ui.departure;
    dom.homeRouteToLabel.textContent = ui.destination;
    dom.homeRouteFrom.textContent = starName(preview.sourceHip);
    dom.homeRouteTo.textContent = destination?.label || preview.action.portalId || ui.home;
    dom.homeRouteSummary.textContent = ui.previewing(dom.homeRouteTo.textContent);
    dom.homeRouteLaunch.textContent = preview.settled ? ui.launch : `${ui.launch} ···`;
    dom.homeRouteCancel.textContent = ui.cancel;
    dom.homeRouteLaunch.setAttribute(
        'aria-label',
        `${ui.launch} · ${dom.homeRouteFrom.textContent} → ${dom.homeRouteTo.textContent}`
    );
    dom.starReaderKicker.textContent = ui.routePreviewMeta;
    dom.starReaderTitle.textContent = starName(preview.sourceHip);
    dom.starReaderMeta.textContent = starDescription(preview.sourcePortal, preview.sourceHip);
    dom.starReaderStatus.textContent = ui.previewing(dom.homeRouteTo.textContent);
    dom.homeRoutePreview.hidden = false;
    dom.homeRoutePreview.toggleAttribute('aria-busy', !preview.settled);
    dom.homeRouteLaunch.disabled = !preview.settled;
    refreshPortalPanelRect();
}

function previewHomeRoute(portal, hip) {
    if (state.scene !== 'detail' || state.activePortal !== portal || !portal.home) return;
    const action = homeStarTargets[hip];
    if (!action) {
        selectPortalStar(portal, hip);
        return;
    }

    selectPortalStar(portal, hip);
    const sourceIndex = portal.patternHips.indexOf(hip);
    const sourceDirection = sourceIndex >= 0
        ? portal.patternPoints[sourceIndex]
        : portal.direction;
    const destination = routeDestination(portal, action);
    if (!destination) return;
    const destinationDirection = destination.direction || sourceDirection;
    const framing = interstellarRouteFraming(
        sourceDirection,
        destinationDirection,
        state.panelOnLeft
    );
    const duration = REDUCED_MOTION ? 1 : (action.type === 'home' ? 720 : 1460);
    state.routePreview = {
        sourcePortal: portal,
        sourceHip: hip,
        action,
        targetPortal: destination.portal,
        targetHip: destination.hip,
        sourceDirection,
        destinationDirection,
        startedAt: performance.now(),
        duration,
        startOrientation: camera.orientation.slice(),
        sourceOrientation: framing.sourceOrientation,
        destinationOrientation: framing.orientation,
        destinationFov: framing.fov,
        startFov: camera.fov,
        sourceStop: action.type === 'home' ? 0 : 0.34,
        revealStart: 0,
        settled: false
    };
    state.activeStarHip = hip;
    state.hoverStarHip = hip;
    const ui = starUiCopy[state.currentLang] || starUiCopy.en;
    dom.starReader.classList.remove('is-empty');
    dom.starReader.classList.add('is-route-preview');
    dom.starReaderKicker.textContent = ui.routePreviewMeta;
    dom.starReaderStatus.textContent = ui.previewing(destination.label);
    renderHomeRoutePreviewCopy();
    portal.starButtons.forEach((_button, starHip) => updateStarButtonCopy(portal, starHip));
}

function cancelHomeRoutePreview() {
    const preview = state.routePreview;
    if (!preview) return;
    const focusWasInPreview = (
        document.activeElement === dom.homeRouteLaunch ||
        document.activeElement === dom.homeRouteCancel ||
        dom.homeRoutePreview.contains?.(document.activeElement)
    );
    state.routePreview = null;
    hideHomeRoutePreview();
    const portal = preview.sourcePortal;
    if (state.scene === 'detail' && state.activePortal === portal) {
        showConstellationOverview(portal);
        const framing = constellationFraming(portal, state.panelOnLeft);
        state.detailFov = framing.fov;
        camera.targetOrientation = framing.orientation;
    }
    if (focusWasInPreview) {
        requestAnimationFrame(() => {
            if (state.scene !== 'detail' || state.activePortal !== portal) return;
            const sourceButton = portal.starButtons?.get(preview.sourceHip);
            const target = sourceButton && !sourceButton.hidden && !sourceButton.inert
                ? sourceButton
                : dom.panelClose;
            target.focus({ preventScroll: true });
        });
    }
}

function launchHomeRoute(source = state.activationSource) {
    const preview = state.routePreview;
    if (!preview?.settled) return;
    state.routePreview = null;
    hideHomeRoutePreview();
    if (preview.action.type === 'home') {
        startPortalFlight(preview.sourcePortal, source, 'home-departure');
    } else if (!portalAvailableInSky(preview.targetPortal)) {
        openPortalThroughIndex(preview.targetPortal, preview.targetHip, source);
    } else {
        startPortalFlight(preview.targetPortal, source, 'open', preview.targetHip);
    }
}

function showConstellationOverview(portal) {
    const story = constellationStories[portal.id];
    const ui = starUiCopy[state.currentLang] || starUiCopy.en;
    state.activeStarHip = null;
    state.hoverStarHip = null;
    state.routePreview = null;
    hideHomeRoutePreview();
    dom.starReader.classList.add('is-overview');
    dom.starReader.classList.remove('is-star-footnote', 'is-empty', 'is-route-preview');
    dom.starReaderKicker.textContent = ui.constellationNote;
    dom.starReaderTitle.textContent = localized(story.name);
    dom.starReaderMeta.textContent = portal.home
        ? ui.homeMeta(portal.patternHips.length)
        : ui.chooseMeta(portal.patternHips.length);
    dom.starReaderDescription.textContent = '';
    dom.starReaderStatus.textContent = portal.home ? ui.homeChoose : ui.choose;
    portal.starButtons.forEach((_button, hip) => updateStarButtonCopy(portal, hip));
    portal.content?.querySelectorAll('[data-portal-entry]').forEach(entry => {
        entry.hidden = true;
    });
    refreshPortalPanelRect();
}

function starDescription(portal, hip) {
    const profile = starProfiles[hip] || {};
    const story = constellationStories[portal.id];
    const { magnitude, colorIndex } = starCatalogValues(hip);
    return [
        profile.designation,
        `HIP ${hip}`,
        localized(story.name),
        Number.isFinite(magnitude) ? `V ${magnitude.toFixed(2)}` : '',
        Number.isFinite(colorIndex) ? `B−V ${colorIndex.toFixed(2)}` : ''
    ].filter(Boolean).join(' · ');
}

function selectPortalStar(portal, hip) {
    if (state.scene !== 'detail' || state.activePortal !== portal) return;
    const ui = starUiCopy[state.currentLang] || starUiCopy.en;
    const entries = starEntries(portal, hip);

    state.activeStarHip = hip;
    state.hoverStarHip = hip;
    state.routePreview = null;
    hideHomeRoutePreview();
    dom.starReader.classList.remove('is-overview');
    dom.starReader.classList.add('is-star-footnote');
    dom.starReader.classList.remove('is-route-preview');
    dom.starReader.classList.toggle('is-empty', entries.length === 0);
    dom.starReaderKicker.textContent = ui.starNote;
    dom.starReaderTitle.textContent = starName(hip);
    dom.starReaderMeta.textContent = starDescription(portal, hip);
    dom.starReaderDescription.textContent = '';
    dom.starReaderStatus.textContent = entries.length ? ui.filled(entries.length) : ui.empty;
    portal.starButtons.forEach((_button, starHip) => updateStarButtonCopy(portal, starHip));
    const contentEntries = portal.content
        ? Array.from(portal.content.querySelectorAll('[data-portal-entry]'))
        : [];
    contentEntries.forEach(entry => {
        entry.hidden = Number(entry.dataset.starHip) !== hip;
        entry.classList.remove('is-first-visible');
    });
    contentEntries.find(entry =>
        !entry.hidden && entry.classList.contains('portal-moment')
    )?.classList.add('is-first-visible');
    refreshPortalPanelRect();
    requestAnimationFrame(() => {
        dom.panelBody.scrollTo({
            top: 0,
            behavior: REDUCED_MOTION ? 'auto' : 'smooth'
        });
    });
    if (portal.id === 'footprints' && entries.length) {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            initMaps();
            resizeMaps();
        }));
    }
}

function handlePortalStarAction(portal, hip) {
    if (portal.home) {
        previewHomeRoute(portal, hip);
        return;
    }
    selectPortalStar(portal, hip);
}

function updatePortalButton(portal, projected) {
    const button = portal.button;
    if (!button) return;
    const aboveHorizon = isAboveHorizon(portal.direction);
    const observable = (portal.skyVisibility ?? 1) > 0.025;
    const onScreen = aboveHorizon &&
        observable &&
        state.scene === 'roam' &&
        hitAreaIntersectsViewport(projected, COARSE_POINTER ? 44 : 36);
    if (!aboveHorizon || !observable) {
        if (state.hoverPortal === portal) state.hoverPortal = null;
        if (state.focusedPortal === portal && state.scene === 'roam') {
            setFocusedPortal(null);
        }
    }
    if (portal.buttonVisible !== onScreen) {
        portal.buttonVisible = onScreen;
        button.hidden = !onScreen;
        button.inert = !onScreen;
    }
    if (!onScreen) return;
    if (
        portal.buttonX === undefined ||
        Math.abs(portal.buttonX - projected.x) > 0.35 ||
        Math.abs(portal.buttonY - projected.y) > 0.35
    ) {
        portal.buttonX = projected.x;
        portal.buttonY = projected.y;
        button.style.transform =
            `translate3d(${projected.x}px, ${projected.y}px, 0) translate(-50%, -50%)`;
    }
}
