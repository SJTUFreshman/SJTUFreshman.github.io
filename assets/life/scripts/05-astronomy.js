let skySun = null;

window.SceneSky = (() => {
    const presets = Object.freeze({
        live: Object.freeze({ cloudCoverage: 0, haze: 1 }),
        night: Object.freeze({ cloudCoverage: 0, haze: 1 }),
        clear: Object.freeze({ cloudCoverage: 0.24, haze: 0.82 }),
        dusk: Object.freeze({ cloudCoverage: 0.31, haze: 1.15 })
    });
    const observationCache = new Map();
    let mode = 'live', alignment = null;
    return Object.freeze({
        get mode() { return mode; },
        get calibratedSunAltitude() { return alignment ? Math.asin(Math.max(-1, Math.min(1, alignment.sunDirection[1]))) * 180 / Math.PI : null; },
        get calibratedSunDirection() { return alignment ? [...alignment.sunDirection] : null; },
        setAlignment(value) {
            if (value !== null && (value?.kind !== 'art-direction-calibration' || value.coordinateSystem !== 'sky-y-up-plus-z' || !Array.isArray(value.sunDirection) || value.sunDirection.length !== 3 || !value.sunDirection.every(Number.isFinite) || !Number.isFinite(Math.hypot(...value.sunDirection)) || Math.hypot(...value.sunDirection) < .00001)) return false;
            const next = value === null ? null : { kind: value.kind, coordinateSystem: value.coordinateSystem, sunDirection: value.sunDirection.map(component => component / Math.hypot(...value.sunDirection)) };
            if (JSON.stringify(next) === JSON.stringify(alignment)) return true;
            alignment = next; skyModel.nextRefreshAt = 0; return true;
        },
        setMode(value) {
            const requested = value === 'day' ? 'clear' : value;
            if (!Object.prototype.hasOwnProperty.call(presets, requested)) return false;
            if (mode === requested) return true;
            mode = requested;
            skyModel.nextRefreshAt = 0;
            if (window.document?.body?.dataset) window.document.body.dataset.skyMode = mode;
            return true;
        },
        snapshot() {
            const sun = skySun;
            return {
                mode,
                ...presets[mode],
                observationDate: skyModel.date?.toISOString() || null,
                sunAltitude: alignment ? Math.asin(Math.max(-1, Math.min(1, alignment.sunDirection[1]))) * 180 / Math.PI : sun?.altitude ?? -90,
                sunDirection: alignment ? [...alignment.sunDirection] : sun?.direction ? [...sun.direction] : [0, -1, 0],
                alignment: alignment ? { ...alignment, sunDirection: [...alignment.sunDirection] } : null
            };
        },
        observationDate(referenceDate = new Date()) {
            const reference = new Date(referenceDate);
            if (!Number.isFinite(+reference)) throw new TypeError('A valid sky observation date is required');
            if (mode === 'live' || mode === 'night') return reference;
            const location = skyModel.location;
            const year = reference.getUTCFullYear();
            const longitude = Number.isFinite(location?.longitude) ? location.longitude : 0;
            const latitude = Number.isFinite(location?.latitude) ? location.latitude : 0;
            const height = Number.isFinite(location?.height) ? location.height : 0;
            const key = `${mode}:${reference.toISOString().slice(0, 10)}:${latitude}:${longitude}:${height}`;
            if (observationCache.has(key)) return new Date(observationCache.get(key));
            const localHour = (date, hour) => Date.UTC(year, date.getUTCMonth(), date.getUTCDate(), hour) - longitude * 240000;
            let timestamp = localHour(reference, mode === 'clear' ? 12 : 18);
            const astronomy = window.Astronomy;
            if (astronomy?.Equator && astronomy?.Horizon && astronomy?.Observer) {
                const observer = new astronomy.Observer(latitude, longitude, height);
                const sunAltitude = date => {
                    const equatorial = astronomy.Equator('Sun', date, observer, true, true);
                    return astronomy.Horizon(date, observer, equatorial.ra, equatorial.dec, 'normal').altitude;
                };
                if (mode === 'clear' && sunAltitude(new Date(timestamp)) < 18 && astronomy.Seasons) {
                    const seasons = astronomy.Seasons(year);
                    timestamp = localHour((latitude < 0 ? seasons.dec_solstice : seasons.jun_solstice).date, 12);
                }
                if (mode === 'dusk' && astronomy.SearchAltitude) {
                    const search = date => astronomy.SearchAltitude('Sun', observer, -1, new Date(localHour(date, 0)), 1.1, 1);
                    let sunset = search(reference);
                    if (!sunset && astronomy.Seasons) {
                        const equinox = astronomy.Seasons(year).mar_equinox.date;
                        for (let offset = -7; offset <= 7 && !sunset; offset += 1) {
                            sunset = search(new Date(+equinox + offset * 86400000));
                        }
                    }
                    if (sunset?.date) timestamp = +sunset.date;
                }
            }
            if (observationCache.size >= 64) observationCache.delete(observationCache.keys().next().value);
            observationCache.set(key, timestamp);
            return new Date(timestamp);
        }
    });
})();

function atmosphericExtinction(altitudeDegrees) {
    if (!Number.isFinite(altitudeDegrees) || altitudeDegrees <= 0) return Infinity;
    const zenithDegrees = 90 - clamp(altitudeDegrees, 0.1, 90);
    const airmass = 1 / (
        Math.cos(zenithDegrees * DEG) +
        0.50572 * Math.pow(96.07995 - zenithDegrees, -1.6364)
    );
    return Math.max(0, (airmass - 1) * 0.2);
}

function angularSeparationDegrees(firstDirection, secondDirection) {
    if (!firstDirection || !secondDirection) return Number.NaN;
    return Math.acos(clamp(
        dot(firstDirection, secondDirection),
        -1,
        1
    )) / DEG;
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
    const sun = skySun;
    const presentation = window.SceneSky?.snapshot();
    const sourceAltitude = presentation?.alignment ? presentation.sunAltitude : sun?.altitude;
    const sunAltitude = skyHasHorizon() && Number.isFinite(sourceAltitude) ? sourceAltitude : -90;
    const localSunDirection = presentation?.alignment ? presentation.sunDirection : sun?.direction || [0, -1, 0];
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
        mode: presentation?.mode || 'live',
        cloudCoverage: presentation?.cloudCoverage || 0,
        haze: presentation?.haze || 1,
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

function sceneSunDirection() {
    return window.SceneSky?.calibratedSunDirection || skySun?.direction;
}

function sceneSunAltitude() {
    return window.SceneSky?.calibratedSunAltitude ?? skySun?.altitude;
}

function naturalStarVisibilityAtDirection(direction, magnitude = 0) {
    if (!isAboveHorizon(direction)) return 0;
    const terrestrial = skyHasHorizon();
    const altitude = Math.asin(clamp(direction[1], -1, 1)) / DEG;
    const extinction = terrestrial ? atmosphericExtinction(altitude) : 0;
    const apparentMagnitude = magnitude + (
        Number.isFinite(extinction) ? extinction : 0
    );
    const limit = terrestrial ? twilightMagnitudeLimit(sceneSunAltitude()) : 6.5;
    const magnitudeVisibility = 1 - smoothstep(
        limit - 0.35,
        limit + 0.25,
        apparentMagnitude
    );
    const horizonVisibility = terrestrial ? smoothstep(0, Math.sin(1 * DEG), direction[1]) : 1;
    return clamp(magnitudeVisibility * horizonVisibility, 0, 1);
}

function daylightConstellationGuideAtDirection(direction, magnitude = 0) {
    if (!skyHasHorizon()) return 0;
    if (!isAboveHorizon(direction)) return 0;
    const sunAltitude = sceneSunAltitude();
    if (!Number.isFinite(sunAltitude) || sunAltitude <= -6) return 0;
    const daylight = smoothstep(-6, 2, sunAltitude);
    const horizonVisibility = smoothstep(
        0,
        Math.sin(4 * DEG),
        direction[1]
    );
    const separation = angularSeparationDegrees(direction, sceneSunDirection());
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

function calculateSunPosition() {
    if (!skyModel.available || !skyModel.observer || !skyModel.time) return;
    const equatorial = Astronomy.Equator('Sun', skyModel.time, skyModel.observer, false, true);
    const horizontal = Astronomy.RotateVector(skyModel.eqjToHor, equatorial.vec);
    skySun = {
        direction: normalize([-horizontal.y, horizontal.z, horizontal.x]),
        altitude: Astronomy.HorizonFromVector(horizontal, null).lat
    };
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
        calculateSunPosition();
        if (state.routePreview) {
            refreshHomeRouteGeometry(state.routePreview, { track: true });
        }
        updateSectionDrawerCopy();
        skyModel.nextRefreshAt = performance.now() + skyModel.refreshInterval;
    } catch (error) {
        console.warn('Live sky calculation failed; retaining the last valid frame.', error);
        skyModel.nextRefreshAt = performance.now() + skyModel.refreshInterval;
    }
}
