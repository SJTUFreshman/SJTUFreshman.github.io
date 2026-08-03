function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

function smoothstep(edge0, edge1, value) {
    const amount = clamp((value - edge0) / Math.max(0.000001, edge1 - edge0), 0, 1);
    return amount * amount * (3 - 2 * amount);
}

function easeInOutCubic(value) {
    return value < 0.5
        ? 4 * value * value * value
        : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function vectorLength(vector) {
    return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector) {
    const length = vectorLength(vector) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function usesCompactSkyLayout(
    width = window.innerWidth,
    height = window.innerHeight
) {
    const aspect = width / Math.max(1, height);
    if (
        height <= SHORT_SKY_MAX_HEIGHT &&
        aspect >= SHORT_SKY_MIN_ASPECT
    ) {
        return false;
    }
    return aspect <= COMPACT_SKY_MAX_ASPECT ||
        (
            width <= COMPACT_SKY_MAX_WIDTH &&
            aspect <= COMPACT_SKY_NARROW_MAX_ASPECT
        );
}

function usesCompactRouteLayout(
    width = window.innerWidth,
    height = window.innerHeight
) {
    return width <= COMPACT_SKY_MAX_WIDTH ||
        width / Math.max(1, height) <= COMPACT_SKY_MAX_ASPECT;
}

function portalPanelWidthForViewport(
    width = window.innerWidth,
    height = window.innerHeight
) {
    const aspect = width / Math.max(1, height);
    const shortLandscape =
        height <= SHORT_SKY_MAX_HEIGHT &&
        aspect >= SHORT_SKY_MIN_ASPECT;
    if (shortLandscape) {
        return clamp(width * 0.34, 180, 280);
    }
    const narrowLandscape =
        width <= COMPACT_SKY_MAX_WIDTH &&
        aspect > COMPACT_SKY_NARROW_MAX_ASPECT;
    return narrowLandscape
        ? clamp(width * 0.42, 286, 340)
        : clamp(width * 0.42, 370, 610);
}

function cross(left, right) {
    return [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0]
    ];
}

function dot(left, right) {
    return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function quatNormalize(quaternion) {
    const length = Math.hypot(...quaternion) || 1;
    return quaternion.map(value => value / length);
}

function quatConjugate(quaternion) {
    return [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]];
}

function quatMultiply(left, right) {
    const [lx, ly, lz, lw] = left;
    const [rx, ry, rz, rw] = right;
    return [
        lw * rx + lx * rw + ly * rz - lz * ry,
        lw * ry - lx * rz + ly * rw + lz * rx,
        lw * rz + lx * ry - ly * rx + lz * rw,
        lw * rw - lx * rx - ly * ry - lz * rz
    ];
}

function quatAxisAngle(x, y, z, angle) {
    const half = angle * 0.5;
    const scale = Math.sin(half) / (Math.hypot(x, y, z) || 1);
    return [x * scale, y * scale, z * scale, Math.cos(half)];
}

function quatRotate(quaternion, vector) {
    const [qx, qy, qz, qw] = quaternion;
    const [vx, vy, vz] = vector;
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    return [
        vx + qw * tx + qy * tz - qz * ty,
        vy + qw * ty + qz * tx - qx * tz,
        vz + qw * tz + qx * ty - qy * tx
    ];
}

function quatSlerp(start, end, amount) {
    let target = end;
    let cosine = start[0] * end[0] + start[1] * end[1] +
        start[2] * end[2] + start[3] * end[3];
    if (cosine < 0) {
        cosine = -cosine;
        target = end.map(value => -value);
    }
    if (cosine > 0.9995) {
        return quatNormalize(start.map((value, index) =>
            value + (target[index] - value) * amount
        ));
    }
    const angle = Math.acos(clamp(cosine, -1, 1));
    const sine = Math.sin(angle) || 1;
    const startScale = Math.sin((1 - amount) * angle) / sine;
    const endScale = Math.sin(amount * angle) / sine;
    return start.map((value, index) =>
        value * startScale + target[index] * endScale
    );
}

function orientationFromYawPitchRoll(yaw, pitch, roll = 0) {
    return quatNormalize(quatMultiply(
        quatMultiply(
            quatAxisAngle(0, 1, 0, yaw),
            quatAxisAngle(1, 0, 0, -pitch)
        ),
        quatAxisAngle(0, 0, 1, roll)
    ));
}

function orientationFromYawPitch(yaw, pitch) {
    return orientationFromYawPitchRoll(yaw, pitch, 0);
}

function decomposeYawPitchRoll(quaternion, fallbackYaw = INITIAL_CAMERA.yaw) {
    const normalized = quatNormalize(quaternion);
    const forward = quatRotate(normalized, [0, 0, 1]);
    const horizontal = Math.hypot(forward[0], forward[2]);
    const yaw = horizontal > 1e-7
        ? Math.atan2(forward[0], forward[2])
        : fallbackYaw;
    const pitch = Math.atan2(forward[1], horizontal);
    const base = orientationFromYawPitch(yaw, pitch);
    let twist = quatNormalize(quatMultiply(quatConjugate(base), normalized));
    if (twist[3] < 0) twist = twist.map(value => -value);
    return {
        yaw,
        pitch,
        roll: 2 * Math.atan2(twist[2], twist[3])
    };
}

function constrainOrientationAboveHorizon(
    quaternion,
    fallbackYaw = INITIAL_CAMERA.yaw
) {
    const pose = decomposeYawPitchRoll(quaternion, fallbackYaw);
    const pitch = Math.max(pose.pitch, MIN_CAMERA_ALTITUDE);
    if (Math.abs(pitch - pose.pitch) < 1e-10) return quatNormalize(quaternion);
    return orientationFromYawPitchRoll(pose.yaw, pitch, pose.roll);
}

function isAboveHorizon(direction, margin = 0) {
    return Boolean(
        direction &&
        Number.isFinite(direction[1]) &&
        direction[1] > margin + GEOMETRIC_HORIZON_EPSILON
    );
}

function orientationFromBasis(right, up, forward) {
    const m00 = right[0], m01 = up[0], m02 = forward[0];
    const m10 = right[1], m11 = up[1], m12 = forward[1];
    const m20 = right[2], m21 = up[2], m22 = forward[2];
    const trace = m00 + m11 + m22;
    let x;
    let y;
    let z;
    let w;
    if (trace > 0) {
        const scale = Math.sqrt(trace + 1) * 2;
        w = 0.25 * scale;
        x = (m21 - m12) / scale;
        y = (m02 - m20) / scale;
        z = (m10 - m01) / scale;
    } else if (m00 > m11 && m00 > m22) {
        const scale = Math.sqrt(1 + m00 - m11 - m22) * 2;
        w = (m21 - m12) / scale;
        x = 0.25 * scale;
        y = (m01 + m10) / scale;
        z = (m02 + m20) / scale;
    } else if (m11 > m22) {
        const scale = Math.sqrt(1 + m11 - m00 - m22) * 2;
        w = (m02 - m20) / scale;
        x = (m01 + m10) / scale;
        y = 0.25 * scale;
        z = (m12 + m21) / scale;
    } else {
        const scale = Math.sqrt(1 + m22 - m00 - m11) * 2;
        w = (m10 - m01) / scale;
        x = (m02 + m20) / scale;
        y = (m12 + m21) / scale;
        z = 0.25 * scale;
    }
    return quatNormalize([x, y, z, w]);
}

function addScaled(base, first, firstScale, second, secondScale) {
    return normalize([
        base[0] + first[0] * firstScale + second[0] * secondScale,
        base[1] + first[1] * firstScale + second[1] * secondScale,
        base[2] + first[2] * firstScale + second[2] * secondScale
    ]);
}

function slerpDirection(start, end, amount) {
    const cosine = clamp(dot(start, end), -1, 1);
    const angle = Math.acos(cosine);
    const sine = Math.sin(angle);
    if (angle < 0.0001 || Math.abs(sine) < 0.0001) {
        return normalize(start.map((value, index) =>
            value + (end[index] - value) * amount
        ));
    }
    const startScale = Math.sin((1 - amount) * angle) / sine;
    const endScale = Math.sin(amount * angle) / sine;
    return normalize(start.map((value, index) =>
        value * startScale + end[index] * endScale
    ));
}

function fromYawPitch(yaw, pitch) {
    const cp = Math.cos(pitch);
    return [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
}

function toYawPitch(direction) {
    return {
        yaw: Math.atan2(direction[0], direction[2]),
        pitch: Math.asin(clamp(direction[1], -1, 1))
    };
}

function hipparcosDirection(hip) {
    const catalog = window.HipparcosSky;
    const index = catalog?.indexByHip?.get(hip);
    if (index === undefined) return null;
    const offset = index * 3;
    return normalize([
        catalog.directions[offset],
        catalog.directions[offset + 1],
        catalog.directions[offset + 2]
    ]);
}

function orientationBasis(orientation) {
    return {
        right: quatRotate(orientation, [1, 0, 0]),
        up: quatRotate(orientation, [0, 1, 0]),
        forward: quatRotate(orientation, [0, 0, 1])
    };
}

function cameraBasis() {
    return orientationBasis(camera.orientation);
}

function equatorialDirectionToLocal(direction) {
    if (!skyModel.available || !skyModel.eqjToHor || !skyModel.time) {
        return direction.slice();
    }
    const equatorial = new Astronomy.Vector(
        direction[2],
        direction[0],
        direction[1],
        skyModel.time
    );
    const horizontal = Astronomy.RotateVector(skyModel.eqjToHor, equatorial);
    return normalize([-horizontal.y, horizontal.z, horizontal.x]);
}

function localDirectionToCatalogEquatorial(direction) {
    if (!skyModel.available || !skyModel.horToEqj || !skyModel.time) {
        return direction.slice();
    }
    const horizontal = new Astronomy.Vector(
        direction[2],
        -direction[0],
        direction[1],
        skyModel.time
    );
    const equatorial = Astronomy.RotateVector(skyModel.horToEqj, horizontal);
    return normalize([equatorial.y, equatorial.z, equatorial.x]);
}

function cameraBasisForCatalog(localBasis) {
    if (!skyModel.available) return localBasis;
    return {
        right: localDirectionToCatalogEquatorial(localBasis.right),
        up: localDirectionToCatalogEquatorial(localBasis.up),
        forward: localDirectionToCatalogEquatorial(localBasis.forward)
    };
}

function applyPortalSkyRotation() {
    portalDefinitions.forEach(portal => {
        if (!portal.equatorialPatternPoints?.length) return;
        portal.patternPoints = portal.equatorialPatternPoints.map(equatorialDirectionToLocal);
        portal.direction = portal.patternPoints[portal.anchorIndex] || portal.patternPoints[0];
        const orientation = toYawPitch(portal.direction);
        portal.yaw = orientation.yaw;
        portal.pitch = orientation.pitch;
        const { tangent, bitangent } = tangentBasis(portal.direction);
        portal.tangent = tangent;
        portal.bitangent = bitangent;
    });
}
