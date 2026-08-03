function tangentBasis(direction) {
    const horizontal = Math.hypot(direction[0], direction[2]);
    const tangent = horizontal > 1e-6
        ? [direction[2] / horizontal, 0, -direction[0] / horizontal]
        : [1, 0, 0];
    const bitangent = normalize(cross(direction, tangent));
    return { tangent, bitangent };
}

function constellationFraming(portal, panelOnLeft = false) {
    const center = normalize(portal.patternPoints.reduce(
        (sum, point) => [
            sum[0] + point[0],
            sum[1] + point[1],
            sum[2] + point[2]
        ],
        [0, 0, 0]
    ));
    const { tangent, bitangent } = tangentBasis(center);
    let minHorizontalRatio = Infinity;
    let maxHorizontalRatio = -Infinity;
    let minVerticalRatio = Infinity;
    let maxVerticalRatio = -Infinity;
    portal.patternPoints.forEach(point => {
        const depth = Math.max(0.05, dot(point, center));
        const horizontalRatio = dot(point, tangent) / depth;
        const verticalRatio = dot(point, bitangent) / depth;
        minHorizontalRatio = Math.min(minHorizontalRatio, horizontalRatio);
        maxHorizontalRatio = Math.max(maxHorizontalRatio, horizontalRatio);
        minVerticalRatio = Math.min(minVerticalRatio, verticalRatio);
        maxVerticalRatio = Math.max(maxVerticalRatio, verticalRatio);
    });

    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const mobile = usesCompactSkyLayout(width, height);
    const shortLayout =
        height <= SHORT_SKY_MAX_HEIGHT &&
        width / height >= SHORT_SKY_MIN_ASPECT;
    let safeLeft;
    let safeRight;
    let safeTop;
    let safeBottom;
    if (mobile) {
        const hitRadius = width <= 760 ? 38 : 32;
        safeLeft = 42;
        safeRight = width - 42;
        safeTop = 72;
        safeBottom = height * 0.5 - 34 - hitRadius - 8;
        if (safeBottom - safeTop < 80) {
            safeTop = Math.max(16, safeBottom - 80);
        }
    } else {
        const panelWidth = portalPanelWidthForViewport(width, height);
        const panelInset = 28;
        const starMargin = shortLayout
            ? (width <= 520 ? 34 : 42)
            : 48;
        safeTop = 82;
        safeBottom = height - 58;
        if (panelOnLeft) {
            safeLeft = panelInset + panelWidth + starMargin;
            safeRight = width - starMargin;
        } else {
            safeLeft = starMargin;
            safeRight = width - panelInset - panelWidth - starMargin;
        }
    }
    if (safeRight - safeLeft < 120) {
        safeLeft = 42;
        safeRight = width - 42;
    }
    if (!mobile && safeBottom - safeTop < 100) {
        safeTop = 54;
        safeBottom = Math.max(safeTop + 100, height - 54);
    }

    const horizontalSpan = Math.max(0.001, maxHorizontalRatio - minHorizontalRatio);
    const verticalSpan = Math.max(0.001, maxVerticalRatio - minVerticalRatio);
    const safeWidth = Math.max(100, safeRight - safeLeft);
    const safeHeight = Math.max(86, safeBottom - safeTop);
    const focalLimit = Math.min(
        safeWidth / horizontalSpan,
        safeHeight / verticalSpan
    ) / 1.12;
    const maxFitFov = (
        shortLayout
            ? (width <= 520 ? 125 : 110)
            : mobile
            ? (width <= 360 ? 118 : 110)
            : 82
    ) * DEG;
    let fitFov = clamp(
        2 * Math.atan((height * 0.5) / Math.max(1, focalLimit)),
        43 * DEG,
        maxFitFov
    );
    let focal = (height * 0.5) / Math.tan(fitFov * 0.5);
    const safeCenterX = (safeLeft + safeRight) * 0.5;
    const safeCenterY = (safeTop + safeBottom) * 0.5;
    const desiredHorizontalRatio = (safeCenterX - width * 0.5) / focal;
    const desiredVerticalRatio = (height * 0.5 - safeCenterY) / focal;
    const horizontalCenter = (minHorizontalRatio + maxHorizontalRatio) * 0.5;
    const verticalCenter = (minVerticalRatio + maxVerticalRatio) * 0.5;
    let aim = addScaled(
        center,
        tangent,
        horizontalCenter - desiredHorizontalRatio,
        bitangent,
        verticalCenter - desiredVerticalRatio
    );
    let right = normalize(cross(bitangent, aim));
    let up = normalize(cross(aim, right));
    const targetWidth = safeWidth * 0.88;
    const targetHeight = safeHeight * 0.88;
    const projectBounds = () => {
        let left = Infinity;
        let rightEdge = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        portal.patternPoints.forEach(point => {
            const depth = Math.max(0.025, dot(point, aim));
            const x = width * 0.5 + dot(point, right) / depth * focal;
            const y = height * 0.5 - dot(point, up) / depth * focal;
            left = Math.min(left, x);
            rightEdge = Math.max(rightEdge, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        });
        return { left, right: rightEdge, top, bottom };
    };

    for (let iteration = 0; iteration < 8; iteration += 1) {
        let bounds = projectBounds();
        const scale = Math.max(
            (bounds.right - bounds.left) / Math.max(1, targetWidth),
            (bounds.bottom - bounds.top) / Math.max(1, targetHeight),
            1
        );
        if (scale > 1.001 && fitFov < maxFitFov) {
            focal /= scale;
            fitFov = clamp(
                2 * Math.atan((height * 0.5) / Math.max(1, focal)),
                43 * DEG,
                maxFitFov
            );
            focal = (height * 0.5) / Math.tan(fitFov * 0.5);
            bounds = projectBounds();
        }
        const deltaX = (bounds.left + bounds.right) * 0.5 - safeCenterX;
        const deltaY = (bounds.top + bounds.bottom) * 0.5 - safeCenterY;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5 && scale <= 1.001) break;
        aim = normalize([
            aim[0] + right[0] * (deltaX / focal) - up[0] * (deltaY / focal),
            aim[1] + right[1] * (deltaX / focal) - up[1] * (deltaY / focal),
            aim[2] + right[2] * (deltaX / focal) - up[2] * (deltaY / focal)
        ]);
        right = normalize(cross(up, aim));
        up = normalize(cross(aim, right));
    }
    return {
        orientation: orientationFromBasis(right, up, aim),
        fov: fitFov,
        panelOnLeft
    };
}

function routePointFraming(
    direction,
    panelOnLeft = false,
    fov = 32 * DEG,
    compactLayout = null
) {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const mobile = compactLayout ??
        usesCompactSkyLayout(width, height);
    const desiredX = mobile
        ? width * 0.5
        : width * (panelOnLeft ? 0.72 : 0.28);
    const desiredY = mobile ? height * 0.25 : height * 0.48;
    const focal = (height * 0.5) / Math.tan(fov * 0.5);
    const horizontalRatio = (desiredX - width * 0.5) / focal;
    const verticalRatio = (height * 0.5 - desiredY) / focal;
    const { tangent, bitangent } = tangentBasis(direction);
    const aim = addScaled(
        direction,
        tangent,
        -horizontalRatio,
        bitangent,
        -verticalRatio
    );
    const right = normalize(cross(bitangent, aim));
    const up = normalize(cross(aim, right));
    return constrainOrientationAboveHorizon(
        orientationFromBasis(right, up, aim),
        toYawPitch(aim).yaw
    );
}

function interstellarRouteFraming(source, destination, panelOnLeft = false) {
    const separation = Math.acos(clamp(dot(source, destination), -1, 1));
    const routeCompact = usesCompactRouteLayout();
    if (separation < 0.002) {
        const fov = 17 * DEG;
        return {
            orientation: routePointFraming(source, panelOnLeft, fov, routeCompact),
            sourceOrientation: routePointFraming(
                source,
                panelOnLeft,
                24 * DEG,
                routeCompact
            ),
            fov
        };
    }

    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const mobile = routeCompact;
    const center = normalize([
        source[0] + destination[0],
        source[1] + destination[1],
        source[2] + destination[2]
    ]);
    const routeRight = normalize([
        destination[0] - source[0],
        destination[1] - source[1],
        destination[2] - source[2]
    ]);
    const routeUp = normalize(cross(center, routeRight));

    let safeLeft;
    let safeRight;
    let safeTop;
    let safeBottom;
    if (mobile) {
        const shortCompactRoute = width <= 1024 && height <= 520;
        safeLeft = 30;
        safeRight = width - 30;
        safeTop = 66;
        safeBottom = Math.max(
            safeTop + 100,
            shortCompactRoute
                ? height * 0.64 - 50
                : height - Math.min(height * 0.44, 188) - 50
        );
    } else {
        const panelWidth = clamp(width * 0.3, 320, 370);
        const gap = 38;
        safeTop = 76;
        safeBottom = height - 48;
        if (panelOnLeft) {
            safeLeft = 28 + panelWidth + gap;
            safeRight = width - gap;
        } else {
            safeLeft = gap;
            safeRight = width - 28 - panelWidth - gap;
        }
    }
    if (safeRight - safeLeft < 150) {
        safeLeft = 30;
        safeRight = width - 30;
    }
    const framePadding = mobile ? 12 : 22;
    const frameLeft = safeLeft + framePadding;
    const frameRight = safeRight - framePadding;
    const frameTop = safeTop + framePadding;
    const frameBottom = safeBottom - framePadding;
    const opticalX = clamp(width * 0.5, frameLeft, frameRight);
    const opticalY = clamp(height * 0.5, frameTop, frameBottom);
    const segmentCandidates = [
        {
            kind: 'rising',
            source: [frameLeft, frameBottom],
            destination: [frameRight, frameTop]
        },
        {
            kind: 'falling',
            source: [frameLeft, frameTop],
            destination: [frameRight, frameBottom]
        },
        {
            kind: 'horizontal',
            source: [frameLeft, opticalY],
            destination: [frameRight, opticalY]
        },
        {
            kind: 'vertical',
            source: [opticalX, frameBottom],
            destination: [opticalX, frameTop]
        }
    ];

    function screenRay(point, focal) {
        return normalize([
            (point[0] - width * 0.5) / focal,
            (height * 0.5 - point[1]) / focal,
            1
        ]);
    }

    function raySeparation(first, second) {
        return Math.acos(clamp(dot(first, second), -1, 1));
    }

    function solveSegment(segment, fov) {
        const focal = (height * 0.5) / Math.tan(fov * 0.5);
        const midpoint = [
            (segment.source[0] + segment.destination[0]) * 0.5,
            (segment.source[1] + segment.destination[1]) * 0.5
        ];
        const rayAt = (point, amount) => [
            midpoint[0] + (point[0] - midpoint[0]) * amount,
            midpoint[1] + (point[1] - midpoint[1]) * amount
        ];
        const fullSourceRay = screenRay(segment.source, focal);
        const fullDestinationRay = screenRay(segment.destination, focal);
        if (
            raySeparation(fullSourceRay, fullDestinationRay) <
            separation - 1e-9
        ) {
            return null;
        }

        let low = 0;
        let high = 1;
        for (let iteration = 0; iteration < 54; iteration += 1) {
            const amount = (low + high) * 0.5;
            const sourceRay = screenRay(rayAt(segment.source, amount), focal);
            const destinationRay = screenRay(
                rayAt(segment.destination, amount),
                focal
            );
            if (raySeparation(sourceRay, destinationRay) < separation) {
                low = amount;
            } else {
                high = amount;
            }
        }
        const amount = (low + high) * 0.5;
        const sourcePoint = rayAt(segment.source, amount);
        const destinationPoint = rayAt(segment.destination, amount);
        const sourceRay = screenRay(sourcePoint, focal);
        const destinationRay = screenRay(destinationPoint, focal);
        return {
            fov,
            sourceRay,
            destinationRay
        };
    }

    let solution = null;
    for (const segment of segmentCandidates) {
        for (let degrees = 38; degrees <= 146; degrees += 0.5) {
            solution = solveSegment(segment, degrees * DEG);
            if (solution) break;
        }
        if (solution) break;
    }
    if (!solution) {
        const fov = 146 * DEG;
        return {
            orientation: routePointFraming(
                center,
                panelOnLeft,
                fov,
                routeCompact
            ),
            sourceOrientation: routePointFraming(
                source,
                panelOnLeft,
                24 * DEG,
                routeCompact
            ),
            fov
        };
    }

    const screenCenter = normalize([
        solution.sourceRay[0] + solution.destinationRay[0],
        solution.sourceRay[1] + solution.destinationRay[1],
        solution.sourceRay[2] + solution.destinationRay[2]
    ]);
    const screenRoute = normalize([
        solution.destinationRay[0] - solution.sourceRay[0],
        solution.destinationRay[1] - solution.sourceRay[1],
        solution.destinationRay[2] - solution.sourceRay[2]
    ]);
    const screenNormal = normalize(cross(screenCenter, screenRoute));
    const worldAxisForScreenComponent = component => normalize([
        routeRight[0] * screenRoute[component] +
            routeUp[0] * screenNormal[component] +
            center[0] * screenCenter[component],
        routeRight[1] * screenRoute[component] +
            routeUp[1] * screenNormal[component] +
            center[1] * screenCenter[component],
        routeRight[2] * screenRoute[component] +
            routeUp[2] * screenNormal[component] +
            center[2] * screenCenter[component]
    ]);
    const cameraRight = worldAxisForScreenComponent(0);
    const up = worldAxisForScreenComponent(1);
    const forward = worldAxisForScreenComponent(2);
    return {
        orientation: orientationFromBasis(cameraRight, up, forward),
        sourceOrientation: routePointFraming(
            source,
            panelOnLeft,
            24 * DEG,
            routeCompact
        ),
        fov: solution.fov
    };
}

function buildPortalGeometry() {
    dom.starNav.replaceChildren();
    portalDefinitions.forEach(portal => {
        const pattern = constellationPatterns[portal.pattern];
        portal.patternHips = pattern.hips.slice();
        portal.contentOrder = pattern.contentOrder.slice();
        const catalogPoints = pattern.hips.map(hipparcosDirection);
        const hasCatalogGeometry = catalogPoints.every(Boolean);

        if (hasCatalogGeometry) {
            portal.equatorialPatternPoints = catalogPoints;
            portal.patternPoints = catalogPoints.map(equatorialDirectionToLocal);
            portal.anchorIndex = Math.max(0, pattern.hips.indexOf(pattern.focusHip));
            portal.direction = portal.patternPoints[portal.anchorIndex];
            const orientation = toYawPitch(portal.direction);
            portal.yaw = orientation.yaw;
            portal.pitch = orientation.pitch;
            portal.patternMagnitudes = pattern.hips.map(hip => {
                const index = window.HipparcosSky.indexByHip.get(hip);
                return index === undefined
                    ? Number.NaN
                    : window.HipparcosSky.magnitudes[index];
            });
        } else {
            portal.equatorialPatternPoints = null;
            portal.yaw = portal.fallbackYaw;
            portal.pitch = portal.fallbackPitch;
            portal.direction = fromYawPitch(portal.yaw, portal.pitch);
            portal.anchorIndex = 0;
            portal.patternMagnitudes = [];
        }

        const { tangent, bitangent } = tangentBasis(portal.direction);
        portal.tangent = tangent;
        portal.bitangent = bitangent;
        portal.patternEdges = pattern.edges;
        if (!hasCatalogGeometry) {
            portal.patternPoints = pattern.fallbackPoints.map(([x, y]) =>
                addScaled(portal.direction, tangent, x, bitangent, y)
            );
        }
        portal.button = document.querySelector(`[data-portal-button="${portal.id}"]`);
        portal.screen = null;
        const content = document.querySelector(`[data-portal-content="${portal.id}"]`);
        portal.content = content;
        portal.entriesByHip = new Map(pattern.hips.map(hip => [hip, []]));
        content?.querySelectorAll('[data-portal-entry]').forEach(entry => {
            const hip = Number(entry.dataset.starHip);
            if (portal.entriesByHip.has(hip)) portal.entriesByHip.get(hip).push(entry);
        });

        portal.starButtons = new Map();
        portal.starButtonScreens = new Map();
        pattern.hips.forEach(hip => {
            const button = document.createElement('button');
            button.className = 'star-hit';
            button.type = 'button';
            button.dataset.starPortal = portal.id;
            button.dataset.starHip = String(hip);
            button.hidden = true;
            button.inert = true;
            button.innerHTML = '<span class="star-hit-copy"><strong></strong><span></span></span>';
            button.addEventListener('mouseenter', () => {
                state.hoverStarHip = hip;
            });
            button.addEventListener('mouseleave', () => {
                if (state.hoverStarHip === hip) state.hoverStarHip = null;
            });
            button.addEventListener('focus', () => {
                state.hoverStarHip = hip;
            });
            button.addEventListener('blur', () => {
                if (state.hoverStarHip === hip) state.hoverStarHip = null;
            });
            button.addEventListener('click', event => {
                event.preventDefault();
                handlePortalStarAction(portal, hip);
            });
            portal.starButtons.set(hip, button);
            portal.starButtonScreens.set(hip, {
                visible: false,
                x: Number.NaN,
                y: Number.NaN
            });
            dom.starNav.appendChild(button);
        });
    });
}

function projectDirection(direction, basis, width, height, fov = camera.fov) {
    const x = dot(direction, basis.right);
    const y = dot(direction, basis.up);
    const z = dot(direction, basis.forward);
    if (z <= 0.025) return null;
    const focal = (height * 0.5) / Math.tan(fov * 0.5);
    const screenX = width * 0.5 + (x / z) * focal;
    const screenY = height * 0.5 - (y / z) * focal;
    return {
        x: screenX,
        y: screenY,
        z,
        visible: screenX > -150 && screenX < width + 150 && screenY > -150 && screenY < height + 150
    };
}

function projectedAngularDiscGeometry(
    profile,
    basis,
    width,
    height,
    fov = camera.fov
) {
    const current = profile?.current;
    const direction = current?.direction;
    const horizontalDiameter = current?.angularDiameter;
    const verticalDiameter = Number.isFinite(current?.apparentVerticalDiameter)
        ? current.apparentVerticalDiameter
        : horizontalDiameter;
    if (
        !direction ||
        !Number.isFinite(horizontalDiameter) ||
        !Number.isFinite(verticalDiameter) ||
        horizontalDiameter <= 0 ||
        verticalDiameter <= 0
    ) return null;

    const center = projectDirection(direction, basis, width, height, fov);
    if (!center) return null;
    const { tangent: horizontalAxis, bitangent: verticalAxis } = tangentBasis(direction);
    const projectOffsetPair = (axis, halfAngle) => {
        const cosine = Math.cos(halfAngle);
        const sine = Math.sin(halfAngle);
        const positive = projectDirection(
            addScaled(direction, axis, sine, direction, cosine - 1),
            basis,
            width,
            height,
            fov
        );
        const negative = projectDirection(
            addScaled(direction, axis, -sine, direction, cosine - 1),
            basis,
            width,
            height,
            fov
        );
        if (!positive || !negative) return null;
        return {
            x: (positive.x - negative.x) * 0.5,
            y: (positive.y - negative.y) * 0.5
        };
    };
    let horizontal = projectOffsetPair(horizontalAxis, horizontalDiameter * 0.5);
    let vertical = projectOffsetPair(verticalAxis, verticalDiameter * 0.5);
    if (!horizontal || !vertical) return null;

    let determinant = horizontal.x * vertical.y - horizontal.y * vertical.x;
    let areaRadius = Math.sqrt(Math.abs(determinant));
    if (!Number.isFinite(areaRadius) || areaRadius < 1e-6) return null;

    const displayAreaRadius = clamp(areaRadius, 1.25, 56);
    const displayScale = displayAreaRadius / areaRadius;
    horizontal = {
        x: horizontal.x * displayScale,
        y: horizontal.y * displayScale
    };
    vertical = {
        x: vertical.x * displayScale,
        y: vertical.y * displayScale
    };
    determinant *= displayScale * displayScale;
    areaRadius = displayAreaRadius;
    const horizontalLengthSquared =
        horizontal.x * horizontal.x + horizontal.y * horizontal.y;
    const verticalLengthSquared =
        vertical.x * vertical.x + vertical.y * vertical.y;
    const columnProduct =
        horizontal.x * vertical.x + horizontal.y * vertical.y;
    const singularDiscriminant = Math.hypot(
        horizontalLengthSquared - verticalLengthSquared,
        2 * columnProduct
    );
    return {
        center,
        horizontal,
        vertical,
        determinant,
        areaRadius,
        maxRadius: Math.sqrt(
            (
                horizontalLengthSquared +
                verticalLengthSquared +
                singularDiscriminant
            ) * 0.5
        ),
        halfWidth: Math.hypot(horizontal.x, vertical.x),
        halfHeight: Math.hypot(horizontal.y, vertical.y)
    };
}

function hitAreaIntersectsViewport(projected, halfWidth, halfHeight = halfWidth) {
    return Boolean(
        projected?.visible &&
        projected.x + halfWidth > 0 &&
        projected.x - halfWidth < overlayWidth &&
        projected.y + halfHeight > 0 &&
        projected.y - halfHeight < overlayHeight
    );
}
