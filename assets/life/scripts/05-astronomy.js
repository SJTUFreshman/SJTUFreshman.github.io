const ASTRONOMICAL_UNIT_KM = 149597870.7;

function vectorToArray(vector) {
    return vector
        ? [Number(vector.x) || 0, Number(vector.y) || 0, Number(vector.z) || 0]
        : [0, 0, 0];
}

function equatorialVectorToLocal(vector) {
    const values = Array.isArray(vector) ? vector : vectorToArray(vector);
    return equatorialDirectionToLocal([values[1], values[2], values[0]]);
}

function atmosphericExtinction(altitudeDegrees) {
    if (!Number.isFinite(altitudeDegrees) || altitudeDegrees <= 0) return Infinity;
    const zenithDegrees = 90 - clamp(altitudeDegrees, 0.1, 90);
    const airmass = 1 / (
        Math.cos(zenithDegrees * DEG) +
        0.50572 * Math.pow(96.07995 - zenithDegrees, -1.6364)
    );
    return Math.max(0, (airmass - 1) * 0.2);
}

function atmosphericRefraction(altitudeDegrees) {
    if (
        !Number.isFinite(altitudeDegrees) ||
        altitudeDegrees < -2 ||
        altitudeDegrees > 90 ||
        typeof Astronomy?.Refraction !== 'function'
    ) return 0;
    const correction = Astronomy.Refraction('normal', altitudeDegrees);
    return Number.isFinite(correction) ? clamp(correction, 0, 1) : 0;
}

function horizontalDirection(azimuthDegrees, altitudeDegrees) {
    const azimuth = azimuthDegrees * DEG;
    const altitude = altitudeDegrees * DEG;
    const altitudeCosine = Math.cos(altitude);
    return normalize([
        Math.sin(azimuth) * altitudeCosine,
        Math.sin(altitude),
        Math.cos(azimuth) * altitudeCosine
    ]);
}

function angularSeparationDegrees(firstDirection, secondDirection) {
    if (!firstDirection || !secondDirection) return Number.NaN;
    return Math.acos(clamp(
        dot(firstDirection, secondDirection),
        -1,
        1
    )) / DEG;
}

function celestialApparentRadiusDegrees(profile) {
    const diameter = profile?.current?.angularDiameter;
    return Number.isFinite(diameter) ? diameter / (2 * DEG) : 0;
}

function celestialUpperLimbAltitude(profile) {
    const current = profile?.current;
    if (!current) return Number.NEGATIVE_INFINITY;
    if (
        profile.angularDisc &&
        Number.isFinite(current.apparentUpperAltitude)
    ) {
        return current.apparentUpperAltitude;
    }
    const centerAltitude = Number.isFinite(current.apparentAltitude)
        ? current.apparentAltitude
        : current.altitude;
    return centerAltitude + (
        profile.angularDisc ? celestialApparentRadiusDegrees(profile) : 0
    );
}

function celestialAboveHorizon(profile) {
    if (!profile?.current) return false;
    if (profile.angularDisc) {
        return celestialUpperLimbAltitude(profile) >= 0;
    }
    return isAboveHorizon(profile.current.direction);
}

function twilightMagnitudeLimit(sunAltitude) {
    if (!Number.isFinite(sunAltitude)) return 6.5;
    if (sunAltitude >= 0) return -4;
    if (sunAltitude >= -6) return lerp(-4, 1.2, -sunAltitude / 6);
    if (sunAltitude >= -12) return lerp(1.2, 4.4, (-sunAltitude - 6) / 6);
    if (sunAltitude >= -18) return lerp(4.4, 6.5, (-sunAltitude - 12) / 6);
    return 6.5;
}

function skyRenderingParameters() {
    const sun = celestialBodies.find(profile => profile.id === 'sun')?.current;
    const sunAltitude = Number.isFinite(sun?.altitude) ? sun.altitude : -90;
    const localSunDirection = sun?.direction || [0, -1, 0];
    const horizontalSunLength = Math.hypot(
        localSunDirection[0],
        localSunDirection[2]
    );
    const sunHorizonLocal = horizontalSunLength > 1e-8
        ? [
            localSunDirection[0] / horizontalSunLength,
            0,
            localSunDirection[2] / horizontalSunLength
        ]
        : null;
    return {
        zenith: localDirectionToCatalogEquatorial([0, 1, 0]),
        east: localDirectionToCatalogEquatorial([1, 0, 0]),
        north: localDirectionToCatalogEquatorial([0, 0, 1]),
        sunDirection: localDirectionToCatalogEquatorial(localSunDirection),
        sunHorizonDirection: sunHorizonLocal
            ? localDirectionToCatalogEquatorial(sunHorizonLocal)
            : null,
        sunHorizonLocal,
        sunAltitude,
        magnitudeLimit: twilightMagnitudeLimit(sunAltitude),
        daylight: smoothstep(-10, 2, sunAltitude),
        twilightLift: smoothstep(-18, -6, sunAltitude),
        twilight: smoothstep(-18, -3, sunAltitude) *
            (1 - smoothstep(4, 12, sunAltitude))
    };
}

function naturalStarVisibilityAtDirection(direction, magnitude = 0) {
    if (!isAboveHorizon(direction)) return 0;
    const altitude = Math.asin(clamp(direction[1], -1, 1)) / DEG;
    const extinction = atmosphericExtinction(altitude);
    const apparentMagnitude = magnitude + (
        Number.isFinite(extinction) ? extinction : 0
    );
    const limit = twilightMagnitudeLimit(
        celestialBodies.find(profile => profile.id === 'sun')?.current?.altitude
    );
    const magnitudeVisibility = 1 - smoothstep(
        limit - 0.35,
        limit + 0.25,
        apparentMagnitude
    );
    const horizonVisibility = smoothstep(0, Math.sin(1 * DEG), direction[1]);
    return clamp(magnitudeVisibility * horizonVisibility, 0, 1);
}

function daylightConstellationGuideAtDirection(direction, magnitude = 0) {
    if (!isAboveHorizon(direction)) return 0;
    const sun = celestialBodies.find(profile => profile.id === 'sun')?.current;
    const sunAltitude = sun?.altitude;
    if (!Number.isFinite(sunAltitude) || sunAltitude <= -6) return 0;
    const daylight = smoothstep(-6, 2, sunAltitude);
    const horizonVisibility = smoothstep(
        0,
        Math.sin(4 * DEG),
        direction[1]
    );
    const separation = angularSeparationDegrees(direction, sun.direction);
    const glareVisibility = Number.isFinite(separation)
        ? lerp(0.5, 1, smoothstep(10, 55, separation))
        : 0.75;
    const brightnessWeight = clamp(1.02 - 0.055 * (magnitude + 1), 0.68, 1);
    return clamp(
        daylight *
        horizonVisibility *
        glareVisibility *
        brightnessWeight *
        0.34,
        0,
        0.34
    );
}

function starVisibilityAtDirection(direction, magnitude = 0) {
    return Math.max(
        naturalStarVisibilityAtDirection(direction, magnitude),
        daylightConstellationGuideAtDirection(direction, magnitude)
    );
}

function celestialDisplayAltitude(profile) {
    const current = profile?.current;
    if (!current) return Number.NaN;
    return profile.refracted && Number.isFinite(current.apparentAltitude)
        ? current.apparentAltitude
        : current.altitude;
}

function moonDaylightContrast(profile, sunAltitude) {
    const current = profile?.current;
    if (!current || !Number.isFinite(sunAltitude)) return 0;
    const daylightBlend = smoothstep(-6, 2, sunAltitude);
    if (daylightBlend <= 0) return 1;
    const separation = Number.isFinite(current.solarElongation)
        ? current.solarElongation
        : 0;
    const altitude = Math.max(0, celestialDisplayAltitude(profile));
    const highSunPenalty = 2.2 * smoothstep(-6, 35, sunAltitude);
    const glarePenalty = 5.8 * (
        1 - smoothstep(8, 55, separation)
    );
    const horizonPenalty = 2 * (
        1 - smoothstep(0, 18, altitude)
    );
    const daylightLimit = -3.4 -
        highSunPenalty -
        glarePenalty -
        horizonPenalty;
    const limitingMagnitude = lerp(
        twilightMagnitudeLimit(sunAltitude),
        daylightLimit,
        daylightBlend
    );
    const brightnessMargin = limitingMagnitude - current.apparentMagnitude;
    const photometricContrast = smoothstep(-0.35, 1.25, brightnessMargin);
    const elongationGate = smoothstep(5, 18, separation);
    const phaseGate = smoothstep(0.002, 0.035, current.phase);
    const altitudeGate = smoothstep(0, 4, celestialUpperLimbAltitude(profile));
    return clamp(
        photometricContrast *
        elongationGate *
        phaseGate *
        altitudeGate,
        0,
        1
    );
}

function classifyCelestialVisibility(profile, sunAltitude) {
    const current = profile.current;
    if (!current) return;
    const extinctionAltitude = profile.angularDisc
        ? Math.max(0.1, celestialDisplayAltitude(profile))
        : current.altitude;
    current.extinction = atmosphericExtinction(extinctionAltitude);
    current.apparentMagnitude = current.magnitude + (
        Number.isFinite(current.extinction) ? current.extinction : 0
    );
    current.skyMagnitudeLimit = twilightMagnitudeLimit(sunAltitude);
    current.aboveHorizon = celestialAboveHorizon(profile);
    current.nakedEyeAlpha = 0;

    if (profile.visibilityModel === 'solar') {
        current.observationMode = current.aboveHorizon
            ? 'naked-eye'
            : 'below-horizon';
        current.nakedEyeVisible = current.aboveHorizon;
        current.nakedEyeAlpha = current.aboveHorizon ? 1 : 0;
        return;
    }
    if (!current.aboveHorizon) {
        current.observationMode = 'below-horizon';
        current.nakedEyeVisible = false;
        return;
    }
    if (profile.visibilityModel === 'moon' && sunAltitude > -6) {
        current.daylightContrast = moonDaylightContrast(profile, sunAltitude);
        current.nakedEyeAlpha = smoothstep(
            0.08,
            0.30,
            current.daylightContrast
        );
        current.nakedEyeVisible = current.daylightContrast >= 0.08;
        current.observationMode = current.nakedEyeVisible
            ? 'naked-eye'
            : 'daylight';
        return;
    }
    if (current.magnitude > 6.5) {
        current.observationMode = 'telescope';
        current.nakedEyeVisible = false;
        return;
    }
    if (current.apparentMagnitude > current.skyMagnitudeLimit) {
        current.observationMode = 'daylight';
        current.nakedEyeVisible = false;
        return;
    }
    current.observationMode = profile.id === 'uranus' ? 'marginal' : 'naked-eye';
    current.nakedEyeVisible = true;
    current.nakedEyeAlpha = 1;
}

function calculateCelestialPositions() {
    if (!skyModel.available || !skyModel.observer || !skyModel.time) return;
    celestialBodies.forEach(profile => {
        try {
            const equatorial = Astronomy.Equator(
                profile.body,
                skyModel.time,
                skyModel.observer,
                false,
                true
            );
            const horizontalVector = Astronomy.RotateVector(
                skyModel.eqjToHor,
                equatorial.vec
            );
            const horizontal = Astronomy.HorizonFromVector(horizontalVector, null);
            const illumination = Astronomy.Illumination(profile.body, skyModel.time);
            const rotation = Astronomy.RotationAxis(profile.body, skyModel.time);
            const distanceKm = equatorial.dist * ASTRONOMICAL_UNIT_KM;
            const heliocentric = vectorToArray(illumination.hc);
            const observerToBody = vectorToArray(equatorial.vec);
            const topocentricPhaseCosine = profile.id === 'moon'
                ? clamp(
                    dot(
                        normalize(heliocentric.map(value => -value)),
                        normalize(observerToBody.map(value => -value))
                    ),
                    -1,
                    1
                )
                : null;
            const phaseAngle = topocentricPhaseCosine === null
                ? illumination.phase_angle
                : Math.acos(topocentricPhaseCosine) / DEG;
            const phase = topocentricPhaseCosine === null
                ? illumination.phase_fraction
                : (1 + topocentricPhaseCosine) * 0.5;
            const geometricDirection = normalize([
                -horizontalVector.y,
                horizontalVector.z,
                horizontalVector.x
            ]);
            const refraction = profile.refracted
                ? atmosphericRefraction(horizontal.lat)
                : 0;
            const apparentAltitude = horizontal.lat + (
                Number.isFinite(refraction) ? refraction : 0
            );
            const angularRadius = Math.asin(
                clamp(
                    profile.radiusKm / Math.max(distanceKm, profile.radiusKm),
                    0,
                    1
                )
            );
            const angularDiameter = angularRadius * 2;
            const angularRadiusDegrees = angularRadius / DEG;
            const geometricUpperAltitude = horizontal.lat + angularRadiusDegrees;
            const geometricLowerAltitude = horizontal.lat - angularRadiusDegrees;
            const upperRefraction = profile.refracted && profile.angularDisc
                ? atmosphericRefraction(geometricUpperAltitude)
                : refraction;
            const lowerRefraction = profile.refracted && profile.angularDisc
                ? atmosphericRefraction(geometricLowerAltitude)
                : refraction;
            const apparentUpperAltitude = geometricUpperAltitude + (
                Number.isFinite(upperRefraction) ? upperRefraction : 0
            );
            const apparentLowerAltitude = geometricLowerAltitude + (
                Number.isFinite(lowerRefraction) ? lowerRefraction : 0
            );
            const apparentDiscCenterAltitude = (
                apparentUpperAltitude + apparentLowerAltitude
            ) * 0.5;
            const apparentCenterDirection = profile.refracted
                ? horizontalDirection(horizontal.lon, apparentAltitude)
                : geometricDirection;
            const apparentDirection = profile.refracted && profile.angularDisc
                ? horizontalDirection(
                    horizontal.lon,
                    apparentDiscCenterAltitude
                )
                : apparentCenterDirection;
            profile.current = {
                direction: apparentDirection,
                geometricDirection,
                azimuth: horizontal.lon,
                altitude: horizontal.lat,
                apparentAltitude,
                apparentDiscCenterAltitude,
                apparentUpperAltitude,
                apparentLowerAltitude,
                distanceAu: equatorial.dist,
                distanceKm,
                magnitude: illumination.mag,
                phase,
                phaseAngle,
                angularDiameter,
                apparentVerticalDiameter: Math.max(
                    0,
                    (apparentUpperAltitude - apparentLowerAltitude) * DEG
                ),
                gc: vectorToArray(illumination.gc),
                hc: heliocentric,
                north: equatorialVectorToLocal(rotation.north),
                northEqj: vectorToArray(rotation.north),
                spin: rotation.spin,
                ringTilt: Number.isFinite(illumination.ring_tilt)
                    ? illumination.ring_tilt
                    : 0
            };
        } catch (error) {
            profile.current = null;
        }
    });
    const sunCurrent = celestialBodies.find(profile => profile.id === 'sun')
        ?.current;
    celestialBodies.forEach(profile => {
        if (!profile.current || !sunCurrent?.direction) return;
        profile.current.solarElongation = angularSeparationDegrees(
            profile.current.direction,
            sunCurrent.direction
        );
    });
    const sunAltitude = sunCurrent?.altitude;
    celestialBodies.forEach(profile => classifyCelestialVisibility(profile, sunAltitude));
    updateCelestialNavigationCopy();
}

function refreshAstronomicalSky(date = new Date()) {
    if (!skyModel.available) return;
    try {
        skyModel.date = date;
        skyModel.time = Astronomy.MakeTime(date);
        skyModel.observer ||= new Astronomy.Observer(
            skyModel.location.latitude,
            skyModel.location.longitude,
            skyModel.location.height
        );
        skyModel.eqjToHor = Astronomy.Rotation_EQJ_HOR(
            skyModel.time,
            skyModel.observer
        );
        skyModel.horToEqj = Astronomy.Rotation_HOR_EQJ(
            skyModel.time,
            skyModel.observer
        );
        applyPortalSkyRotation();
        calculateCelestialPositions();
        if (state.routePreview) {
            refreshHomeRouteGeometry(state.routePreview, { track: true });
        }
        if (state.activeCelestial) {
            renderCelestialPanel(state.activeCelestial);
            if (
                state.scene === 'detail' &&
                state.celestialVisit?.phase === 'observing' &&
                state.activeCelestial.current?.direction &&
                celestialAboveHorizon(state.activeCelestial)
            ) {
                state.celestialVisit.focusOrientation = routePointFraming(
                    state.activeCelestial.current.direction,
                    state.panelOnLeft,
                    state.celestialVisit.focusFov
                );
                camera.targetOrientation = state.celestialVisit.focusOrientation.slice();
            }
        }
        updateSectionDrawerCopy();
        skyModel.nextRefreshAt = performance.now() + skyModel.refreshInterval;
    } catch (error) {
        console.warn('Live sky calculation failed; retaining the last valid frame.', error);
        skyModel.nextRefreshAt = performance.now() + skyModel.refreshInterval;
    }
}
