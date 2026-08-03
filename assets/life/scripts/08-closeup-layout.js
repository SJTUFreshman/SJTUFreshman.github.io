function celestialStageLayout(
    profile,
    panelOnLeft,
    width = window.innerWidth,
    height = window.innerHeight
) {
    const compact = usesCompactSkyLayout(width, height);
    const aspect = width / Math.max(1, height);
    const shortLandscape = height <= SHORT_SKY_MAX_HEIGHT &&
        aspect >= SHORT_SKY_MIN_ASPECT;
    if (compact) {
        const radius = Math.min(width * 0.335, height * 0.245);
        return {
            centerX: width * 0.5,
            centerY: height * 0.265,
            radius: profile?.id === 'saturn'
                ? Math.min(radius * 0.73, width * 0.18)
                : radius
        };
    }

    if (shortLandscape) {
        const panelWidth = clamp(width * 0.33, 176, 270);
        const edge = 18;
        const visualGutter = 24;
        const openWidth = Math.max(
            160,
            width - panelWidth - edge * 2 - visualGutter
        );
        const openStart = panelOnLeft
            ? edge + panelWidth + visualGutter
            : edge;
        const radius = Math.min(height * 0.29, openWidth * 0.335);
        return {
            centerX: openStart + openWidth * 0.5,
            centerY: height * 0.5,
            radius: profile?.id === 'saturn'
                ? Math.min(radius * 0.7, openWidth * 0.19)
                : radius
        };
    }

    const panelWidth = clamp(width * 0.38, 350, 540);
    const panelGutter = Math.max(72, width * 0.055);
    const openWidth = Math.max(240, width - panelWidth - panelGutter);
    const openStart = panelOnLeft ? panelWidth + panelGutter : 0;
    const radius = Math.min(height * 0.39, openWidth * 0.385);
    return {
        centerX: openStart + openWidth * 0.5,
        centerY: height * 0.505,
        radius: profile?.id === 'saturn'
            ? Math.min(radius * 0.7, openWidth * 0.19, height * 0.22)
            : radius
    };
}

function rotateVectorAroundAxis(vector, axis, angle) {
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const axisProjection = dot(axis, vector) * (1 - cosine);
    const axisCross = cross(axis, vector);
    return normalize([
        vector[0] * cosine + axisCross[0] * sine + axis[0] * axisProjection,
        vector[1] * cosine + axisCross[1] * sine + axis[1] * axisProjection,
        vector[2] * cosine + axisCross[2] * sine + axis[2] * axisProjection
    ]);
}

const CELESTIAL_RENDER_PROFILES = Object.freeze({
    sun: { style: 0, atmosphere: 0, atmosphereColor: [1, 0.78, 0.42] },
    moon: { style: 9, atmosphere: 0, atmosphereColor: [0.72, 0.74, 0.78] },
    mercury: { style: 1, atmosphere: 0, atmosphereColor: [0.7, 0.7, 0.72] },
    venus: { style: 2, atmosphere: 1, atmosphereColor: [1, 0.83, 0.55] },
    mars: { style: 3, atmosphere: 0.16, atmosphereColor: [1, 0.46, 0.22] },
    jupiter: { style: 4, atmosphere: 0.15, atmosphereColor: [0.56, 0.69, 0.9] },
    saturn: { style: 5, atmosphere: 0.19, atmosphereColor: [0.69, 0.75, 0.88] },
    uranus: { style: 6, atmosphere: 0.34, atmosphereColor: [0.46, 0.87, 0.95] },
    neptune: { style: 7, atmosphere: 0.31, atmosphereColor: [0.29, 0.51, 1] },
    pluto: { style: 8, atmosphere: 0.065, atmosphereColor: [0.39, 0.62, 1] }
});
