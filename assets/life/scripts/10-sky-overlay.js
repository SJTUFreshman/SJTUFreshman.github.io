const overlayContext = dom.constellationCanvas.getContext('2d');
let overlayWidth = 1;
let overlayHeight = 1;
let overlayDpr = 1;
let fallbackStars = [];

function buildFallbackStars() {
    fallbackStars = [];
    const catalog = window.HipparcosSky;
    if (!catalog?.count) return;

    const visibleCount = Math.min(catalog.count, COARSE_POINTER ? 2600 : 4800);
    const regularCount = Math.round(visibleCount * (31145 / 45934));
    const rareCount = Math.max(1, Math.round(visibleCount * (213 / 45934)));

    for (let index = 0; index < visibleCount; index += 1) {
        const rareBright = index < rareCount;
        const micro = index >= regularCount;
        let size;
        let rawAlpha;

        if (rareBright) {
            const strength = rareCount === 1
                ? 1
                : 1 - index / (rareCount - 1);
            size = 1.8 + strength * 1.4;
            rawAlpha = 0.72 + strength * 0.24;
        } else if (!micro) {
            const span = Math.max(1, regularCount - rareCount - 1);
            const strength = 1 - (index - rareCount) / span;
            size = 0.38 + strength * 1.32;
            rawAlpha = 0.12 + strength * 0.52;
        } else {
            const span = Math.max(1, visibleCount - regularCount - 1);
            const strength = 1 - (index - regularCount) / span;
            size = 0.40 + Math.pow(strength, 2.2) * 0.65;
            rawAlpha = 0.065 + Math.pow(strength, 2.0) * 0.22;
        }

        const directionOffset = index * 3;
        fallbackStars.push({
            direction: [
                catalog.directions[directionOffset],
                catalog.directions[directionOffset + 1],
                catalog.directions[directionOffset + 2]
            ],
            size,
            alpha: Math.pow(Math.max(rawAlpha, 0.0001), micro ? 0.82 : 0.88),
            magnitude: Number.isFinite(catalog.magnitudes[index])
                ? catalog.magnitudes[index]
                : 8
        });
    }
}

function resizeOverlay() {
    overlayDpr = Math.min(window.devicePixelRatio || 1, COARSE_POINTER ? 1.25 : 1.6);
    overlayWidth = Math.max(1, window.innerWidth);
    overlayHeight = Math.max(1, window.innerHeight);
    const pixelWidth = Math.round(overlayWidth * overlayDpr);
    const pixelHeight = Math.round(overlayHeight * overlayDpr);
    if (dom.constellationCanvas.width !== pixelWidth || dom.constellationCanvas.height !== pixelHeight) {
        dom.constellationCanvas.width = pixelWidth;
        dom.constellationCanvas.height = pixelHeight;
        dom.constellationCanvas.style.width = `${overlayWidth}px`;
        dom.constellationCanvas.style.height = `${overlayHeight}px`;
    }
    overlayContext.setTransform(overlayDpr, 0, 0, overlayDpr, 0, 0);
}

function drawFallbackSpace(basis, time) {
    const context = overlayContext;
    const sky = skyRenderingParameters();
    const focal = (overlayHeight * 0.5) / Math.tan(camera.fov * 0.5);
    const altitudeGradient = [
        dot(basis.right, sky.zenith) / focal,
        -dot(basis.up, sky.zenith) / focal
    ];
    const altitudeGradientLength = Math.hypot(...altitudeGradient);
    const skyNormal = altitudeGradientLength > 1e-9
        ? [
            altitudeGradient[0] / altitudeGradientLength,
            altitudeGradient[1] / altitudeGradientLength
        ]
        : [0, -1];
    const gradientExtent =
        Math.abs(skyNormal[0]) * overlayWidth * 0.5 +
        Math.abs(skyNormal[1]) * overlayHeight * 0.5;
    const gradientCenter = [overlayWidth * 0.5, overlayHeight * 0.5];
    const createAltitudeGradient = () => context.createLinearGradient(
        gradientCenter[0] - skyNormal[0] * gradientExtent,
        gradientCenter[1] - skyNormal[1] * gradientExtent,
        gradientCenter[0] + skyNormal[0] * gradientExtent,
        gradientCenter[1] + skyNormal[1] * gradientExtent
    );
    const background = context.createRadialGradient(
        overlayWidth * 0.56,
        overlayHeight * 0.46,
        0,
        overlayWidth * 0.5,
        overlayHeight * 0.5,
        Math.max(overlayWidth, overlayHeight) * 0.76
    );
    background.addColorStop(0, '#212746');
    background.addColorStop(0.42, '#11162a');
    background.addColorStop(1, '#070918');
    context.fillStyle = background;
    context.fillRect(0, 0, overlayWidth, overlayHeight);

    if (sky.twilightLift > 0.001) {
        const twilightSky = createAltitudeGradient();
        twilightSky.addColorStop(
            0,
            `rgba(73,87,121,${0.48 * sky.twilightLift})`
        );
        twilightSky.addColorStop(
            0.48,
            `rgba(35,55,94,${0.56 * sky.twilightLift})`
        );
        twilightSky.addColorStop(
            1,
            `rgba(14,35,78,${0.64 * sky.twilightLift})`
        );
        context.fillStyle = twilightSky;
        context.fillRect(0, 0, overlayWidth, overlayHeight);
    }

    if (sky.daylight > 0.001) {
        const daylight = createAltitudeGradient();
        daylight.addColorStop(0, `rgba(136,158,178,${0.82 * sky.daylight})`);
        daylight.addColorStop(0.52, `rgba(64,102,145,${0.9 * sky.daylight})`);
        daylight.addColorStop(1, `rgba(18,54,105,${0.94 * sky.daylight})`);
        context.fillStyle = daylight;
        context.fillRect(0, 0, overlayWidth, overlayHeight);
    }

    const sunPoint = sky.sunHorizonDirection
        ? projectDirection(
            sky.sunHorizonDirection,
            basis,
            overlayWidth,
            overlayHeight
        )
        : null;
    if (sunPoint && (sky.twilight > 0.001 || sky.daylight > 0.001)) {
        const radius = Math.max(overlayWidth, overlayHeight) * 0.58;
        const solarHaze = context.createRadialGradient(
            sunPoint.x,
            sunPoint.y,
            0,
            sunPoint.x,
            sunPoint.y,
            radius
        );
        const intensity = clamp(sky.twilight * 0.48 + sky.daylight * 0.16, 0, 0.54);
        solarHaze.addColorStop(0, `rgba(255,174,93,${intensity})`);
        solarHaze.addColorStop(0.36, `rgba(236,137,91,${intensity * 0.34})`);
        solarHaze.addColorStop(1, 'rgba(236,137,91,0)');
        context.fillStyle = solarHaze;
        context.fillRect(0, 0, overlayWidth, overlayHeight);
    }

    context.fillStyle = '#f6f2e9';
    fallbackStars.forEach((star, index) => {
        if (star.magnitude > sky.magnitudeLimit + 0.25) return;
        const localDirection = [
            dot(star.direction, sky.east),
            dot(star.direction, sky.zenith),
            dot(star.direction, sky.north)
        ];
        if (!isAboveHorizon(localDirection)) return;
        const altitude = Math.asin(clamp(localDirection[1], -1, 1)) / DEG;
        const extinction = atmosphericExtinction(altitude);
        const apparentMagnitude = star.magnitude + (
            Number.isFinite(extinction) ? extinction : 0
        );
        const magnitudeVisibility = 1 - smoothstep(
            sky.magnitudeLimit - 0.35,
            sky.magnitudeLimit + 0.25,
            apparentMagnitude
        );
        const horizonVisibility = smoothstep(
            0,
            Math.sin(1 * DEG),
            localDirection[1]
        );
        const skyVisibility = magnitudeVisibility * horizonVisibility;
        if (skyVisibility <= 0.001) return;
        const point = projectDirection(star.direction, basis, overlayWidth, overlayHeight);
        if (!point?.visible) return;
        const twinkle = REDUCED_MOTION ? 1 : 0.95 + 0.05 * Math.sin(time * 0.0005 + index);
        context.globalAlpha = star.alpha * twinkle * skyVisibility;
        const size = star.size * (0.9 + 0.12 / Math.max(point.z, 0.15));
        context.fillRect(point.x, point.y, size, size);
    });
    context.globalAlpha = 1;
}

function createStarGlowSprite(warm) {
    const sprite = document.createElement('canvas');
    sprite.width = 96;
    sprite.height = 96;
    const context = sprite.getContext('2d');
    const glow = context.createRadialGradient(48, 48, 0, 48, 48, 44);
    glow.addColorStop(0, warm ? 'rgba(255,230,182,1)' : 'rgba(236,244,255,1)');
    glow.addColorStop(0.16, warm ? 'rgba(255,215,160,0.5)' : 'rgba(196,216,255,0.5)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = glow;
    context.fillRect(4, 4, 88, 88);
    context.fillStyle = warm ? '#fff0c9' : '#fffaf0';
    context.beginPath();
    context.arc(48, 48, 8, 0, Math.PI * 2);
    context.fill();
    return sprite;
}

const starGlowSprites = {
    cool: createStarGlowSprite(false),
    warm: createStarGlowSprite(true)
};

function drawStarGlow(context, x, y, radius, alpha, warm = false) {
    const size = radius * 11;
    context.globalAlpha = Math.min(1, alpha * 1.18);
    context.drawImage(
        warm ? starGlowSprites.warm : starGlowSprites.cool,
        x - size * 0.5,
        y - size * 0.5,
        size,
        size
    );
    context.globalAlpha = 1;
}

function horizonScreenValue(
    x,
    y,
    basis,
    width = overlayWidth,
    height = overlayHeight,
    fov = camera.fov
) {
    const focal = (height * 0.5) / Math.tan(fov * 0.5);
    return basis.forward[1] +
        ((x - width * 0.5) / focal) * basis.right[1] +
        ((height * 0.5 - y) / focal) * basis.up[1];
}

function clipViewportToHorizonHalfPlane(
    basis,
    keepGround,
    width = overlayWidth,
    height = overlayHeight,
    fov = camera.fov
) {
    const epsilon = 1e-9;
    const source = [[0, 0], [width, 0], [width, height], [0, height]];
    const output = [];
    const isInside = value => keepGround ? value <= epsilon : value >= -epsilon;
    for (let index = 0; index < source.length; index += 1) {
        const current = source[index];
        const next = source[(index + 1) % source.length];
        const currentValue = horizonScreenValue(
            current[0],
            current[1],
            basis,
            width,
            height,
            fov
        );
        const nextValue = horizonScreenValue(
            next[0],
            next[1],
            basis,
            width,
            height,
            fov
        );
        const currentInside = isInside(currentValue);
        const nextInside = isInside(nextValue);
        if (currentInside) output.push(current);
        if (currentInside === nextInside) continue;
        const denominator = currentValue - nextValue;
        const amount = Math.abs(denominator) < 1e-12
            ? 0
            : clamp(currentValue / denominator, 0, 1);
        output.push([
            lerp(current[0], next[0], amount),
            lerp(current[1], next[1], amount)
        ]);
    }
    return output;
}

function clipViewportToGround(
    basis,
    width = overlayWidth,
    height = overlayHeight,
    fov = camera.fov
) {
    return clipViewportToHorizonHalfPlane(
        basis,
        true,
        width,
        height,
        fov
    );
}

function horizonViewportIntersections(
    basis,
    width = overlayWidth,
    height = overlayHeight,
    fov = camera.fov
) {
    const corners = [[0, 0], [width, 0], [width, height], [0, height]];
    const intersections = [];
    const pushUnique = point => {
        if (!intersections.some(candidate =>
            Math.hypot(candidate[0] - point[0], candidate[1] - point[1]) < 0.25
        )) {
            intersections.push(point);
        }
    };
    corners.forEach((current, index) => {
        const next = corners[(index + 1) % corners.length];
        const currentValue = horizonScreenValue(
            current[0],
            current[1],
            basis,
            width,
            height,
            fov
        );
        const nextValue = horizonScreenValue(
            next[0],
            next[1],
            basis,
            width,
            height,
            fov
        );
        if (Math.abs(currentValue) <= 1e-9) pushUnique(current);
        if (currentValue * nextValue >= 0) return;
        const amount = currentValue / (currentValue - nextValue);
        pushUnique([
            lerp(current[0], next[0], amount),
            lerp(current[1], next[1], amount)
        ]);
    });
    if (intersections.length <= 2) return intersections;
    const focal = (height * 0.5) / Math.tan(fov * 0.5);
    const lineDirection = normalize([
        basis.up[1] / focal,
        basis.right[1] / focal,
        0
    ]);
    intersections.sort((left, right) =>
        left[0] * lineDirection[0] + left[1] * lineDirection[1] -
        (right[0] * lineDirection[0] + right[1] * lineDirection[1])
    );
    return [intersections[0], intersections[intersections.length - 1]];
}

function traceScreenPolygon(context, polygon) {
    if (!polygon.length) return false;
    context.beginPath();
    context.moveTo(polygon[0][0], polygon[0][1]);
    for (let index = 1; index < polygon.length; index += 1) {
        context.lineTo(polygon[index][0], polygon[index][1]);
    }
    context.closePath();
    return true;
}

function drawLocalHorizon(basis) {
    const context = overlayContext;
    const width = overlayWidth;
    const height = overlayHeight;
    const fov = camera.fov;
    const groundPolygon = clipViewportToGround(basis, width, height, fov);
    const skyPolygon = clipViewportToHorizonHalfPlane(
        basis,
        false,
        width,
        height,
        fov
    );
    const horizon = horizonViewportIntersections(basis, width, height, fov);
    const sky = skyRenderingParameters();
    const focal = (height * 0.5) / Math.tan(fov * 0.5);
    const gradientVector = [
        basis.right[1] / focal,
        -basis.up[1] / focal
    ];
    const gradientLength = Math.hypot(...gradientVector);
    const skyNormal = gradientLength > 1e-9
        ? [gradientVector[0] / gradientLength, gradientVector[1] / gradientLength]
        : [0, -1];

    context.save();
    if (horizon.length === 2 && skyPolygon.length) {
        context.save();
        traceScreenPolygon(context, skyPolygon);
        context.clip();
        const [start, end] = horizon;
        const atmosphericGlow = context.createLinearGradient(
            start[0],
            start[1],
            end[0],
            end[1]
        );
        const cool = `rgba(132,170,220,${0.055 + sky.daylight * 0.08})`;
        const warm = `rgba(255,156,90,${0.08 + sky.twilight * 0.22})`;
        const sunPoint = sky.sunHorizonLocal
            ? projectDirection(
                sky.sunHorizonLocal,
                basis,
                width,
                height,
                fov
            )
            : null;
        const lineX = end[0] - start[0];
        const lineY = end[1] - start[1];
        const lineLengthSquared = lineX * lineX + lineY * lineY || 1;
        const sunAmount = sunPoint?.visible
            ? clamp(
                ((sunPoint.x - start[0]) * lineX + (sunPoint.y - start[1]) * lineY) /
                    lineLengthSquared,
                0,
                1
            )
            : null;
        const warmSpan = 0.16;
        atmosphericGlow.addColorStop(0, cool);
        if (sunAmount !== null) {
            atmosphericGlow.addColorStop(
                Math.max(0, sunAmount - warmSpan),
                cool
            );
            atmosphericGlow.addColorStop(sunAmount, warm);
            atmosphericGlow.addColorStop(
                Math.min(1, sunAmount + warmSpan),
                cool
            );
        }
        atmosphericGlow.addColorStop(1, cool);
        context.strokeStyle = atmosphericGlow;
        context.lineWidth = 34 + sky.daylight * 18;
        context.beginPath();
        context.moveTo(start[0], start[1]);
        context.lineTo(end[0], end[1]);
        context.stroke();
        context.restore();
    }

    if (groundPolygon.length) {
        const center = [width * 0.5, height * 0.5];
        const lineAnchor = gradientLength > 1e-9
            ? [
                center[0] - skyNormal[0] * basis.forward[1] / gradientLength,
                center[1] - skyNormal[1] * basis.forward[1] / gradientLength
            ]
            : center;
        const extent = Math.hypot(width, height);
        const groundGradient = context.createLinearGradient(
            lineAnchor[0],
            lineAnchor[1],
            lineAnchor[0] - skyNormal[0] * extent,
            lineAnchor[1] - skyNormal[1] * extent
        );
        const horizonColor = [
            Math.round(lerp(10, 64, sky.daylight)),
            Math.round(lerp(15, 76, sky.daylight)),
            Math.round(lerp(23, 82, sky.daylight))
        ];
        const deepColor = [
            Math.round(lerp(2, 18, sky.daylight)),
            Math.round(lerp(4, 25, sky.daylight)),
            Math.round(lerp(8, 29, sky.daylight))
        ];
        groundGradient.addColorStop(
            0,
            `rgb(${horizonColor[0]}, ${horizonColor[1]}, ${horizonColor[2]})`
        );
        groundGradient.addColorStop(
            1,
            `rgb(${deepColor[0]}, ${deepColor[1]}, ${deepColor[2]})`
        );
        traceScreenPolygon(context, groundPolygon);
        context.fillStyle = groundGradient;
        context.fill();
    }

    if (horizon.length === 2) {
        const [start, end] = horizon;
        context.strokeStyle = `rgba(213,226,247,${0.16 + sky.daylight * 0.08})`;
        context.lineWidth = 0.85;
        context.beginPath();
        context.moveTo(start[0], start[1]);
        context.lineTo(end[0], end[1]);
        context.stroke();

        for (let degrees = 0; degrees < 360; degrees += 15) {
            const azimuth = degrees * DEG;
            const base = projectDirection(
                [Math.sin(azimuth), 0, Math.cos(azimuth)],
                basis,
                width,
                height,
                fov
            );
            if (
                !base?.visible ||
                base.x < -2 ||
                base.x > width + 2 ||
                base.y < -2 ||
                base.y > height + 2
            ) continue;
            const cardinal = degrees % 90 === 0;
            const major = degrees % 45 === 0;
            const length = cardinal ? 7 : major ? 5 : 3;
            context.strokeStyle = cardinal
                ? 'rgba(222,233,250,0.42)'
                : major
                    ? 'rgba(205,220,244,0.22)'
                    : 'rgba(196,214,241,0.12)';
            context.lineWidth = cardinal ? 0.8 : 0.55;
            context.beginPath();
            context.moveTo(base.x, base.y);
            context.lineTo(
                base.x + skyNormal[0] * length,
                base.y + skyNormal[1] * length
            );
            context.stroke();
        }

        const ui = skyIndexUi[state.currentLang] || skyIndexUi.en;
        [
            { direction: [0, 0, 1], label: ui.compass[0] },
            { direction: [1, 0, 0], label: ui.compass[1] },
            { direction: [0, 0, -1], label: ui.compass[2] },
            { direction: [-1, 0, 0], label: ui.compass[3] }
        ].forEach(item => {
            const point = projectDirection(item.direction, basis, width, height, fov);
            if (
                !point?.visible ||
                point.x < 12 ||
                point.x > width - 12 ||
                point.y < 12 ||
                point.y > height - 12
            ) return;
            context.fillStyle = 'rgba(220,231,249,0.54)';
            context.font = '9px "IBM Plex Mono", monospace';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(
                item.label,
                point.x + skyNormal[0] * 17,
                point.y + skyNormal[1] * 17
            );
        });

    }
    context.restore();
}

function randomUnit() {
    if (window.crypto?.getRandomValues) {
        const value = new Uint32Array(1);
        window.crypto.getRandomValues(value);
        return value[0] / 4294967296;
    }
    return Math.random();
}

function projectEquatorialFromRaDec(rightAscensionDegrees, declinationDegrees) {
    const rightAscension = rightAscensionDegrees * DEG;
    const declination = declinationDegrees * DEG;
    const cosine = Math.cos(declination);
    return normalize([
        Math.sin(rightAscension) * cosine,
        Math.sin(declination),
        Math.cos(rightAscension) * cosine
    ]);
}

function seasonalMeteorRadiant(date = new Date()) {
    const month = date.getUTCMonth() + 1;
    if (month === 1) {
        return { id: 'quadrantids', ra: 230, dec: 49 };
    }
    if (month >= 3 && month <= 4) {
        return { id: 'lyrids', ra: 272, dec: 34 };
    }
    if (month >= 5 && month <= 6) {
        return { id: 'eta-aquariids', ra: 338, dec: -1 };
    }
    if (month >= 7 && month <= 8) {
        return { id: 'perseids', ra: 48, dec: 58 };
    }
    if (month === 9 || month === 10) {
        return { id: 'orionids', ra: 95, dec: 16 };
    }
    if (month === 11) {
        return { id: 'leonids', ra: 153, dec: 22 };
    }
    return { id: 'geminids', ra: 112, dec: 33 };
}

function createMeteorShowerSelection() {
    if (REDUCED_MOTION || randomUnit() >= 0.24) {
        return { selected: false };
    }
    const radiant = seasonalMeteorRadiant(new Date());
    return {
        selected: true,
        id: radiant.id,
        radiantEquatorial: projectEquatorialFromRaDec(radiant.ra, radiant.dec),
        armed: false,
        startAt: 0,
        duration: 13500,
        meteors: []
    };
}

function meteorShowerSkyVisibility() {
    const sunAltitude = celestialBodies.find(profile => profile.id === 'sun')
        ?.current?.altitude;
    if (!Number.isFinite(sunAltitude)) {
        return skyModel.available ? 0 : 1;
    }
    return 1 - smoothstep(-18, -12, sunAltitude);
}

function armMeteorShower(shower, time) {
    if (
        !shower?.selected ||
        shower.armed ||
        !state.hasEntered ||
        meteorShowerSkyVisibility() <= 0
    ) return;
    shower.armed = true;
    shower.startAt = time + 2800 + randomUnit() * 4200;
    const forward = localDirectionToCatalogEquatorial(cameraBasis().forward);
    const forwardBasis = tangentBasis(forward);
    for (let index = 0; index < 42; index += 1) {
        const jitterX = (randomUnit() - 0.5) * 0.9;
        const jitterY = (randomUnit() - 0.5) * 0.68;
        const target = addScaled(
            forward,
            forwardBasis.tangent,
            jitterX,
            forwardBasis.bitangent,
            jitterY
        );
        const planeNormal = normalize(cross(shower.radiantEquatorial, target));
        const pathTangent = normalize(cross(planeNormal, shower.radiantEquatorial));
        const targetAngle = Math.acos(clamp(
            dot(shower.radiantEquatorial, target),
            -1,
            1
        ));
        const travel = (6 + randomUnit() * 10) * DEG;
        shower.meteors.push({
            offset: index / 42 * 10800 + randomUnit() * 760,
            lifetime: 460 + randomUnit() * 520,
            startAngle: clamp(
                targetAngle - travel * (0.35 + randomUnit() * 0.35),
                0.08,
                Math.PI - 0.08
            ),
            travel,
            length: (1.8 + randomUnit() * 3.5) * DEG,
            tangent: pathTangent,
            width: 0.7 + randomUnit() * 1.25,
            warmth: randomUnit()
        });
    }
}

function meteorDirection(shower, meteor, angle) {
    return normalize([
        shower.radiantEquatorial[0] * Math.cos(angle) +
            meteor.tangent[0] * Math.sin(angle),
        shower.radiantEquatorial[1] * Math.cos(angle) +
            meteor.tangent[1] * Math.sin(angle),
        shower.radiantEquatorial[2] * Math.cos(angle) +
            meteor.tangent[2] * Math.sin(angle)
    ]);
}

function drawMeteorShower(basis, time) {
    const shower = state.meteorShower;
    const skyVisibility = meteorShowerSkyVisibility();
    armMeteorShower(shower, time);
    if (
        !shower?.selected ||
        !shower.armed ||
        skyVisibility <= 0 ||
        time < shower.startAt ||
        time > shower.startAt + shower.duration
    ) return;

    const context = overlayContext;
    context.save();
    context.globalCompositeOperation = 'screen';
    shower.meteors.forEach(meteor => {
        const elapsed = time - shower.startAt - meteor.offset;
        if (elapsed < 0 || elapsed > meteor.lifetime) return;
        const progress = elapsed / meteor.lifetime;
        const headAngle = meteor.startAngle + meteor.travel * progress;
        const tailAngle = Math.max(0, headAngle - meteor.length);
        const headLocal = equatorialDirectionToLocal(
            meteorDirection(shower, meteor, headAngle)
        );
        const tailLocal = equatorialDirectionToLocal(
            meteorDirection(shower, meteor, tailAngle)
        );
        if (!isAboveHorizon(headLocal) && !isAboveHorizon(tailLocal)) return;
        const head = projectDirection(headLocal, basis, overlayWidth, overlayHeight);
        const tail = projectDirection(tailLocal, basis, overlayWidth, overlayHeight);
        if (!head?.visible || !tail?.visible) return;
        const opacity = Math.sin(progress * Math.PI) * 0.82 * skyVisibility;
        const gradient = context.createLinearGradient(tail.x, tail.y, head.x, head.y);
        gradient.addColorStop(0, 'rgba(164,194,236,0)');
        gradient.addColorStop(
            0.72,
            meteor.warmth > 0.68
                ? `rgba(255,218,170,${opacity * 0.45})`
                : `rgba(174,207,255,${opacity * 0.5})`
        );
        gradient.addColorStop(1, `rgba(250,252,255,${opacity})`);
        context.strokeStyle = gradient;
        context.lineWidth = meteor.width;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(tail.x, tail.y);
        context.lineTo(head.x, head.y);
        context.stroke();
        context.fillStyle = `rgba(255,255,255,${opacity})`;
        context.beginPath();
        context.arc(head.x, head.y, Math.max(0.8, meteor.width * 0.78), 0, Math.PI * 2);
        context.fill();
    });
    context.restore();
}

function drawObservationReticle(context, x, y, color, assisted = false) {
    const extent = assisted ? 13 : 11;
    const corner = 4.5;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 0.75;
    context.globalAlpha = assisted ? 0.72 : 0.52;
    context.beginPath();
    context.moveTo(x - extent, y - extent + corner);
    context.lineTo(x - extent, y - extent);
    context.lineTo(x - extent + corner, y - extent);
    context.moveTo(x + extent - corner, y - extent);
    context.lineTo(x + extent, y - extent);
    context.lineTo(x + extent, y - extent + corner);
    context.moveTo(x - extent, y + extent - corner);
    context.lineTo(x - extent, y + extent);
    context.lineTo(x - extent + corner, y + extent);
    context.moveTo(x + extent - corner, y + extent);
    context.lineTo(x + extent, y + extent);
    context.lineTo(x + extent, y + extent - corner);
    context.stroke();
    if (assisted) {
        context.fillStyle = color;
        context.globalAlpha = 0.78;
        context.fillRect(x - 0.75, y - 0.75, 1.5, 1.5);
    }
    context.restore();
}

function drawNakedEyePoint(context, profile, point, alpha) {
    const magnitude = profile.current.apparentMagnitude;
    const radius = clamp(
        0.72 + 0.78 * Math.pow(10, -0.1 * magnitude),
        0.72,
        3.6
    );
    const coreAlpha = clamp(
        0.34 + 0.64 * Math.pow(10, -0.115 * (magnitude + 1)),
        0.3,
        1
    ) * alpha;
    const glowRadius = radius * 4.8 + 1.2;
    const glow = context.createRadialGradient(
        point.x,
        point.y,
        0,
        point.x,
        point.y,
        glowRadius
    );
    glow.addColorStop(0, `rgba(255,255,255,${coreAlpha})`);
    glow.addColorStop(0.12, `${profile.color}${Math.round(coreAlpha * 210).toString(16).padStart(2, '0')}`);
    glow.addColorStop(0.42, `${profile.color}${Math.round(coreAlpha * 58).toString(16).padStart(2, '0')}`);
    glow.addColorStop(1, `${profile.color}00`);
    context.fillStyle = glow;
    context.beginPath();
    context.arc(point.x, point.y, glowRadius, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = `rgba(255,255,255,${Math.min(1, coreAlpha * 1.08)})`;
    context.beginPath();
    context.arc(point.x, point.y, Math.max(0.55, radius * 0.42), 0, Math.PI * 2);
    context.fill();
}

function screenTangentAngle(direction, targetDirection, basis) {
    const projection = dot(targetDirection, direction);
    const tangent = [
        targetDirection[0] - direction[0] * projection,
        targetDirection[1] - direction[1] * projection,
        targetDirection[2] - direction[2] * projection
    ];
    if (vectorLength(tangent) < 1e-8) return 0;
    const forward = dot(direction, basis.forward);
    const tangentForward = dot(tangent, basis.forward);
    const screenX = dot(tangent, basis.right) * forward -
        dot(direction, basis.right) * tangentForward;
    const screenY = -(
        dot(tangent, basis.up) * forward -
        dot(direction, basis.up) * tangentForward
    );
    return Math.atan2(screenY, screenX);
}

function angularDiscLocalDirection(geometry, screenAngle) {
    const horizontal = geometry.horizontal;
    const vertical = geometry.vertical;
    const screenX = Math.cos(screenAngle);
    const screenY = Math.sin(screenAngle);
    let x = (
        vertical.y * screenX -
        vertical.x * screenY
    ) / geometry.determinant;
    let y = (
        -horizontal.y * screenX +
        horizontal.x * screenY
    ) / geometry.determinant;
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length < 1e-8) {
        return { x: 1, y: 0, angle: 0 };
    }
    x /= length;
    y /= length;
    return { x, y, angle: Math.atan2(y, x) };
}

function applyAngularDiscTransform(context, geometry) {
    context.transform(
        geometry.horizontal.x,
        geometry.horizontal.y,
        geometry.vertical.x,
        geometry.vertical.y,
        geometry.center.x,
        geometry.center.y
    );
}

function fillAngularDisc(context, geometry, createFillStyle) {
    context.save();
    applyAngularDiscTransform(context, geometry);
    context.fillStyle = createFillStyle(context);
    context.beginPath();
    context.arc(0, 0, 1, 0, Math.PI * 2);
    context.fill();
    context.restore();
}

function traceIlluminatedDisc(
    context,
    geometry,
    lightAngle,
    phaseAngle,
    createFillStyle
) {
    const cosine = Math.cos(clamp(phaseAngle, 0, 180) * DEG);
    const segments = geometry.maxRadius < 5 ? 20 : 48;
    const localLight = angularDiscLocalDirection(geometry, lightAngle);
    context.save();
    applyAngularDiscTransform(context, geometry);
    context.rotate(localLight.angle);
    context.fillStyle = createFillStyle(context);
    context.beginPath();
    context.moveTo(0, -1);
    for (let index = 0; index <= segments; index += 1) {
        const angle = -Math.PI * 0.5 + Math.PI * index / segments;
        context.lineTo(
            Math.cos(angle),
            Math.sin(angle)
        );
    }
    for (let index = segments; index >= 0; index -= 1) {
        const angle = -Math.PI * 0.5 + Math.PI * index / segments;
        context.lineTo(
            -cosine * Math.cos(angle),
            Math.sin(angle)
        );
    }
    context.closePath();
    context.fill();
    context.restore();
}

function drawAngularSun(context, profile, point, basis, alpha) {
    const geometry = projectedAngularDiscGeometry(
        profile,
        basis,
        overlayWidth,
        overlayHeight
    );
    if (!geometry) return;
    const altitude = celestialDisplayAltitude(profile);
    const horizonWarmth = 1 - smoothstep(0, 12, altitude);
    const transmission = lerp(0.58, 1, smoothstep(-0.3, 14, altitude));
    const visibleAlpha = alpha * transmission;
    const haloRadius = geometry.maxRadius * lerp(5.8, 4.2, horizonWarmth) +
        lerp(12, 7, horizonWarmth);
    const halo = context.createRadialGradient(
        point.x,
        point.y,
        geometry.areaRadius * 0.55,
        point.x,
        point.y,
        haloRadius
    );
    halo.addColorStop(
        0,
        `rgba(255,${Math.round(lerp(247, 207, horizonWarmth))},` +
            `${Math.round(lerp(213, 123, horizonWarmth))},${0.88 * visibleAlpha})`
    );
    halo.addColorStop(
        0.18,
        `rgba(255,${Math.round(lerp(230, 178, horizonWarmth))},` +
            `${Math.round(lerp(151, 82, horizonWarmth))},${0.32 * visibleAlpha})`
    );
    halo.addColorStop(
        0.52,
        `rgba(255,${Math.round(lerp(211, 151, horizonWarmth))},` +
            `${Math.round(lerp(111, 61, horizonWarmth))},${0.07 * visibleAlpha})`
    );
    halo.addColorStop(1, 'rgba(255,145,55,0)');
    context.fillStyle = halo;
    context.beginPath();
    context.arc(point.x, point.y, haloRadius, 0, Math.PI * 2);
    context.fill();

    fillAngularDisc(context, geometry, transformedContext => {
        const disc = transformedContext.createRadialGradient(
            -0.12,
            -0.1,
            0,
            0,
            0,
            1
        );
        disc.addColorStop(
            0,
            `rgba(255,${Math.round(lerp(255, 220, horizonWarmth))},` +
                `${Math.round(lerp(241, 154, horizonWarmth))},${visibleAlpha})`
        );
        disc.addColorStop(
            0.72,
            `rgba(255,${Math.round(lerp(244, 198, horizonWarmth))},` +
                `${Math.round(lerp(202, 105, horizonWarmth))},${visibleAlpha})`
        );
        disc.addColorStop(
            1,
            `rgba(${Math.round(lerp(255, 225, horizonWarmth))},` +
                `${Math.round(lerp(229, 133, horizonWarmth))},` +
                `${Math.round(lerp(170, 54, horizonWarmth))},${visibleAlpha})`
        );
        return disc;
    });
}

function drawAngularMoon(context, profile, point, basis, alpha) {
    const geometry = projectedAngularDiscGeometry(
        profile,
        basis,
        overlayWidth,
        overlayHeight
    );
    if (!geometry) return;
    const current = profile.current;
    const sun = celestialBodies.find(candidate => candidate.id === 'sun')?.current;
    const sky = skyRenderingParameters();
    const daylight = smoothstep(-6, 2, sky.sunAltitude);
    const altitude = celestialDisplayAltitude(profile);
    const horizonWarmth = 1 - smoothstep(0, 10, altitude);
    const lightAngle = sun?.direction
        ? screenTangentAngle(current.direction, sun.direction, basis)
        : 0;
    const earthshine = (1 - daylight) *
        (1 - smoothstep(0.18, 0.72, current.phase)) *
        smoothstep(0.01, 0.12, current.phase);

    if (earthshine > 0.001) {
        fillAngularDisc(context, geometry, transformedContext => {
            const darkDisc = transformedContext.createRadialGradient(
                -0.16,
                -0.12,
                0,
                0,
                0,
                1
            );
            darkDisc.addColorStop(
                0,
                `rgba(126,143,164,${0.19 * earthshine * alpha})`
            );
            darkDisc.addColorStop(
                0.78,
                `rgba(90,108,133,${0.13 * earthshine * alpha})`
            );
            darkDisc.addColorStop(1, 'rgba(58,72,94,0)');
            return darkDisc;
        });
    }

    traceIlluminatedDisc(
        context,
        geometry,
        lightAngle,
        current.phaseAngle,
        transformedContext => {
            const litDisc = transformedContext.createRadialGradient(
                0.18,
                0,
                0,
                0,
                0,
                1.08
            );
            litDisc.addColorStop(
                0,
                `rgba(255,${Math.round(lerp(253, 226, horizonWarmth))},` +
                    `${Math.round(lerp(239, 184, horizonWarmth))},${0.94 * alpha})`
            );
            litDisc.addColorStop(
                0.72,
                `rgba(${Math.round(lerp(238, 245, daylight))},` +
                    `${Math.round(lerp(237, 244, daylight))},` +
                    `${Math.round(lerp(225, 238, daylight))},${0.88 * alpha})`
            );
            litDisc.addColorStop(
                1,
                `rgba(${Math.round(lerp(185, 211, daylight))},` +
                    `${Math.round(lerp(185, 213, daylight))},` +
                    `${Math.round(lerp(178, 211, daylight))},${0.72 * alpha})`
            );
            return litDisc;
        }
    );
}

function drawCelestialBodies(basis, time) {
    const context = overlayContext;
    celestialBodies.forEach(profile => {
        const direction = profile.current?.direction;
        if (!direction) {
            profile.screen = null;
            updateCelestialButton(profile, null);
            return;
        }
        const point = projectDirection(direction, basis, overlayWidth, overlayHeight);
        const aboveHorizon = celestialAboveHorizon(profile);
        profile.rawScreen = point;
        profile.screen = aboveHorizon ? point : null;
        updateCelestialButton(profile, aboveHorizon ? point : null);
        if (!point?.visible) return;

        const focused = state.focusedCelestial === profile;
        const activeVisit = state.celestialVisit?.profile === profile
            ? state.celestialVisit
            : null;
        const distantAlpha = activeVisit
            ? 1 - smoothstep(0.02, 0.32, activeVisit.visualProgress)
            : 1;
        const natural = profile.current.nakedEyeVisible;
        const nakedEyeAlpha = profile.current.nakedEyeAlpha ?? 1;
        const assisted = !natural;

        context.save();
        context.globalCompositeOperation = 'screen';
        if (natural && distantAlpha > 0.001) {
            if (profile.id === 'sun') {
                drawAngularSun(
                    context,
                    profile,
                    point,
                    basis,
                    distantAlpha * nakedEyeAlpha
                );
            } else if (profile.id === 'moon') {
                drawAngularMoon(
                    context,
                    profile,
                    point,
                    basis,
                    distantAlpha * nakedEyeAlpha
                );
            } else {
                drawNakedEyePoint(
                    context,
                    profile,
                    point,
                    distantAlpha * nakedEyeAlpha
                );
            }
        }
        if (
            !activeVisit &&
            (focused || (assisted && (state.hoverCelestial === profile || state.touchMode)))
        ) {
            drawObservationReticle(
                context,
                point.x,
                point.y,
                `${profile.color}dd`,
                assisted
            );
        }
        context.restore();
    });
}
