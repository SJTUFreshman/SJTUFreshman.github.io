(() => {
    'use strict';
    const T = window.THREE;
    if (!T) return;
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    function vector(value, length, label) {
        if (!Array.isArray(value) || value.length !== length || !value.every(finite)) throw new Error(label + ' must contain finite coordinates.');
        return value.slice();
    }
    function safeUrl(value) {
        const url = new URL(value, document.baseURI);
        if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            throw new Error('Authored scene models must use this site origin.');
        }
        return url.href;
    }
    function createBuilder(id, metadata, model) {
        if (typeof id !== 'string' || !id || !metadata?.observation || !model?.url) throw new Error('An authored scene needs an id, observation, and model URL.');
        const observation = {
            position: vector(metadata.observation.position, 3, 'observation.position'),
            yaw: metadata.observation.yaw, pitch: metadata.observation.pitch
        };
        if (![observation.yaw, observation.pitch].every(finite)) throw new Error('Observation angles must be finite radians.');
        const spawn = vector(metadata.spawn || observation.position, 3, 'spawn');
        const position = vector(model.position || [0, 0, 0], 3, 'model.position');
        const quaternion = vector(model.quaternion || [0, 0, 0, 1], 4, 'model.quaternion');
        if (Math.hypot(...quaternion) < 1e-8) throw new Error('Model quaternion must be nonzero.');
        const scale = model.scale ?? 1;
        if (!finite(scale) || scale <= 0) throw new Error('Model scale must be a positive uniform scale.');
        const url = safeUrl(model.url);
        const collisionUrl = model.collisionUrl ? safeUrl(model.collisionUrl) : null;
        const bounds = metadata.bounds ? { ...metadata.bounds } : null;
        if (bounds && (!['minX', 'maxX', 'minZ', 'maxZ'].every(key => finite(bounds[key])) ||
            bounds.minX >= bounds.maxX || bounds.minZ >= bounds.maxZ)) throw new Error('Invalid walking bounds.');
        const stepMax = metadata.stepMax ?? .35, maxSlope = metadata.maxSlope ?? 45;
        if (!finite(stepMax) || stepMax <= 0 || !finite(maxSlope) || maxSlope < 0 || maxSlope >= 90) throw new Error('Invalid walking limits.');
        const navigation = metadata.navigation || 'walk';
        const distanceUnit = metadata.distanceUnit || 'm';
        if (!['m', 'source'].includes(distanceUnit)) throw new Error('distanceUnit must be m or source.');
        if (!['walk', 'float'].includes(navigation)) throw new Error('Navigation must be walk or float.');
        const radius = metadata.radius ?? .25, eyeHeight = metadata.eyeHeight ?? 1.72, moveSpeed = metadata.moveSpeed ?? 3.1;
        if (![radius, eyeHeight, moveSpeed].every(value => finite(value) && value > 0)) throw new Error('Navigation dimensions and speed must be positive.');

        return function authoredBuilder(kit = window.NightWorldKit) {
            if (!kit?.disposeGroup) throw new Error('NightWorldKit is required.');
            const group = new T.Group(), root = new T.Group();
            root.position.fromArray(position); root.quaternion.fromArray(quaternion).normalize(); root.scale.setScalar(scale);
            group.add(root);
            let state = 'loading', error = '', surfaces = [], collisionMaterial;
            const ownedImageCandidates = new Set(), sharedImages = new Set(), closedImages = new Set();
            const normalTextures = new Set(), disposedNormalTextures = new Set(), sharedNormalTextures = new Set();
            function collectTextureImages(texture, shared = false) {
                for (const image of [texture.image, texture.source?.data]) {
                    for (const candidate of Array.isArray(image) ? image : [image]) {
                        if (!candidate || typeof candidate.close !== 'function') continue;
                        if (shared || texture.userData?.shared) sharedImages.add(candidate);
                        else ownedImageCandidates.add(candidate);
                    }
                }
            }
            function collectOwnedImages(source) {
                source?.traverse?.(node => {
                    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
                    for (const material of materials) {
                        const materialShared = Boolean(material.userData?.shared);
                        for (const value of Object.values(material)) {
                            if (!value?.isTexture) continue;
                            const textureShared = materialShared || Boolean(value.userData?.shared);
                            collectTextureImages(value, textureShared);
                        }
                    }
                });
            }
            function closeOwnedImages() {
                for (const image of ownedImageCandidates) {
                    if (sharedImages.has(image) || closedImages.has(image)) continue;
                    closedImages.add(image);
                    try { image.close(); } catch {}
                }
            }
            function disposeNormalTextures() {
                for (const texture of normalTextures) {
                    if (sharedNormalTextures.has(texture) || disposedNormalTextures.has(texture)) continue;
                    disposedNormalTextures.add(texture);
                    texture.dispose();
                }
            }
            function disposeOwnedGroup(target) {
                collectOwnedImages(target);
                if (target && !target.userData?.disposed) kit.disposeGroup(target);
                disposeNormalTextures();
                closeOwnedImages();
            }
            function disposeLoadedResult(result) {
                if (!result) return;
                collectOwnedImages(result.scene);
                collectOwnedImages(result.collisionScene);
                if (result.scene && !result.scene.userData.disposed) kit.disposeGroup(result.scene);
                if (result.collisionScene && !result.collisionScene.userData.disposed) kit.disposeGroup(result.collisionScene);
                disposeNormalTextures();
                closeOwnedImages();
            }
            function clearCollision() {
                surfaces = []; collisionMaterial?.dispose(); collisionMaterial = null;
            }
            root.addEventListener('removed', () => {
                clearCollision();
                if (disposed() || root.userData.disposed) {
                    disposeNormalTextures();
                    closeOwnedImages();
                }
            });
            const ray = new T.Raycaster(), up = new T.Vector3(0, 1, 0), down = new T.Vector3(0, -1, 0);
            const normalMatrix = new T.Matrix3(), normal = new T.Vector3(), epsilon = .002;
            const slopeCosine = Math.cos(maxSlope * Math.PI / 180);
            const disposed = () => Boolean(group.userData.disposed);
            const world = {
                id, group, spawn: spawn.slice(), previewCamera: { ...observation, position: observation.position.slice() },
                observation: { ...observation, position: observation.position.slice() },
                yaw: observation.yaw, pitch: observation.pitch, bounds, colliders: [], interactions: [],
                navigation, distanceUnit, radius, eyeHeight, moveSpeed,
                environment: metadata.environment ? { ...metadata.environment } : undefined,
                get status() { return disposed() ? 'disposed' : state; },
                get ready() { return !disposed() && state === 'ready'; },
                get error() { return error; },
                update() {},
                dispose() {
                    if (!disposed()) disposeOwnedGroup(group);
                    else closeOwnedImages();
                    clearCollision();
                },
                sampleGround(x, z, feetY, maxDrop = stepMax) {
                    if (!world.ready || ![x, z, feetY, maxDrop].every(finite) || maxDrop < 0) return null;
                    const origin = new T.Vector3(x, feetY + stepMax + epsilon, z);
                    const hit = cast(origin, down, stepMax + maxDrop + epsilon * 2)[0];
                    if (!hit || !hit.face) return null;
                    normal.copy(hit.face.normal).applyMatrix3(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).normalize();
                    if (normal.y < slopeCosine || hit.point.y - feetY > stepMax + epsilon ||
                        feetY - hit.point.y > maxDrop + epsilon) return null;
                    return { y: hit.point.y, point: hit.point.clone(), normal: normal.clone() };
                },
                walk(from, to, radius = world.radius, height = world.eyeHeight) {
                    const initial = coordinates(from), target = coordinates(to);
                    if (!world.ready) return { position: initial, blocked: true, reason: world.status };
                    if (!finite(radius) || radius <= 0 || !finite(height) || height <= stepMax) throw new Error('Invalid player dimensions.');
                    const length = Math.hypot(target.x - initial.x, target.z - initial.z);
                    if (length > 20) return { position: initial, blocked: true, reason: 'move-too-large' };
                    const count = Math.max(1, Math.ceil(length / Math.min(.1, radius / 2)));
                    let current = initial;
                    for (let index = 1; index <= count; index++) {
                        const next = { x: initial.x + (target.x - initial.x) * index / count,
                            y: current.y, z: initial.z + (target.z - initial.z) * index / count };
                        const reason = advance(current, next, radius, height);
                        if (reason) return { position: current, blocked: true, reason };
                        current = next;
                    }
                    return { position: current, blocked: false, reason: null };
                },
                fly(from, to, radius = world.radius) {
                    const initial = coordinates(from), target = coordinates(to);
                    if (!world.ready) return { position: initial, blocked: true, reason: world.status };
                    if (!finite(radius) || radius <= 0) throw new Error('Floating radius must be positive.');
                    const firstReason = sphereClearance(initial, radius);
                    if (firstReason) return { position: initial, blocked: true, reason: firstReason };
                    const delta = new T.Vector3(target.x - initial.x, target.y - initial.y, target.z - initial.z);
                    const length = delta.length();
                    if (length > 20) return { position: initial, blocked: true, reason: 'move-too-large' };
                    const count = Math.max(1, Math.ceil(length / Math.min(.1, radius / 3)));
                    let current = initial;
                    for (let index = 1; index <= count; index++) {
                        const next = { x: initial.x + delta.x * index / count,
                            y: initial.y + delta.y * index / count, z: initial.z + delta.z * index / count };
                        const midpoint = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2,
                            z: (current.z + next.z) / 2 };
                        const reason = sphereClearance(midpoint, radius + length / count / 2);
                        if (reason) return { position: current, blocked: true, reason };
                        current = next;
                    }
                    return { position: current, blocked: false, reason: null };
                }
            };
            function coordinates(value) {
                if (!value || ![value.x, value.y, value.z].every(finite)) throw new Error('Walking positions must be finite xyz objects.');
                return { x: value.x, y: value.y, z: value.z };
            }
            function cast(origin, direction, distance) {
                const end = origin.clone().addScaledVector(direction, distance);
                const segment = new T.Box3().setFromPoints([origin, end]).expandByScalar(epsilon);
                const candidates = surfaces.filter(surface => surface.bounds.intersectsBox(segment)).map(surface => surface.mesh);
                ray.set(origin, direction); ray.near = epsilon; ray.far = distance;
                return ray.intersectObjects(candidates, false);
            }
            const triangle = new T.Triangle(), nearest = new T.Vector3(), spherePoint = new T.Vector3();
            function buildBVH(mesh) {
                const geometry = mesh.geometry, position = geometry?.attributes?.position;
                if (!position) return null;
                const index = geometry.index, triangleCount = Math.floor((index ? index.count : position.count) / 3);
                if (!triangleCount) return null;
                const vertices = new Float32Array(triangleCount * 9);
                const triangleBounds = new Float32Array(triangleCount * 6);
                const centers = new Float32Array(triangleCount * 3), order = new Uint32Array(triangleCount);
                const local = mesh.matrixWorld, source = new T.Vector3();
                let minimum = new T.Vector3(Infinity, Infinity, Infinity), maximum = new T.Vector3(-Infinity, -Infinity, -Infinity);
                for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
                    order[triangleIndex] = triangleIndex;
                    const vertexOffset = triangleIndex * 9, boundsOffset = triangleIndex * 6;
                    for (let corner = 0; corner < 3; corner++) {
                        const vertexIndex = index ? index.getX(triangleIndex * 3 + corner) : triangleIndex * 3 + corner;
                        source.fromBufferAttribute(position, vertexIndex).applyMatrix4(local);
                        const offset = vertexOffset + corner * 3;
                        vertices[offset] = source.x; vertices[offset + 1] = source.y; vertices[offset + 2] = source.z;
                        if (source.x < minimum.x) minimum.x = source.x; if (source.y < minimum.y) minimum.y = source.y; if (source.z < minimum.z) minimum.z = source.z;
                        if (source.x > maximum.x) maximum.x = source.x; if (source.y > maximum.y) maximum.y = source.y; if (source.z > maximum.z) maximum.z = source.z;
                    }
                    triangleBounds[boundsOffset] = minimum.x; triangleBounds[boundsOffset + 1] = minimum.y; triangleBounds[boundsOffset + 2] = minimum.z;
                    triangleBounds[boundsOffset + 3] = maximum.x; triangleBounds[boundsOffset + 4] = maximum.y; triangleBounds[boundsOffset + 5] = maximum.z;
                    centers[triangleIndex * 3] = (minimum.x + maximum.x) * .5;
                    centers[triangleIndex * 3 + 1] = (minimum.y + maximum.y) * .5;
                    centers[triangleIndex * 3 + 2] = (minimum.z + maximum.z) * .5;
                    minimum.set(Infinity, Infinity, Infinity); maximum.set(-Infinity, -Infinity, -Infinity);
                }
                function nodeCapacity(count) {
                    if (count <= 8) return 1;
                    const half = count >> 1;
                    return 1 + nodeCapacity(half) + nodeCapacity(count - half);
                }
                const capacity = nodeCapacity(triangleCount), nodeMin = new Float32Array(capacity * 3);
                const nodeMax = new Float32Array(capacity * 3), nodeLeft = new Int32Array(capacity);
                const nodeRight = new Int32Array(capacity), nodeStart = new Int32Array(capacity), nodeCount = new Int32Array(capacity);
                let nodeTotal = 0;
                function rangeBounds(start, end) {
                    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
                    let centerMinX = Infinity, centerMinY = Infinity, centerMinZ = Infinity;
                    let centerMaxX = -Infinity, centerMaxY = -Infinity, centerMaxZ = -Infinity;
                    for (let offset = start; offset < end; offset++) {
                        const id = order[offset], boundsOffset = id * 6, centerOffset = id * 3;
                        minX = Math.min(minX, triangleBounds[boundsOffset]); minY = Math.min(minY, triangleBounds[boundsOffset + 1]); minZ = Math.min(minZ, triangleBounds[boundsOffset + 2]);
                        maxX = Math.max(maxX, triangleBounds[boundsOffset + 3]); maxY = Math.max(maxY, triangleBounds[boundsOffset + 4]); maxZ = Math.max(maxZ, triangleBounds[boundsOffset + 5]);
                        centerMinX = Math.min(centerMinX, centers[centerOffset]); centerMinY = Math.min(centerMinY, centers[centerOffset + 1]); centerMinZ = Math.min(centerMinZ, centers[centerOffset + 2]);
                        centerMaxX = Math.max(centerMaxX, centers[centerOffset]); centerMaxY = Math.max(centerMaxY, centers[centerOffset + 1]); centerMaxZ = Math.max(centerMaxZ, centers[centerOffset + 2]);
                    }
                    return { minX, minY, minZ, maxX, maxY, maxZ,
                        centerMinX, centerMinY, centerMinZ, centerMaxX, centerMaxY, centerMaxZ };
                }
                function buildRange(start, end) {
                    const node = nodeTotal++, bounds = rangeBounds(start, end), count = end - start;
                    const nodeOffset = node * 3;
                    nodeMin[nodeOffset] = bounds.minX; nodeMin[nodeOffset + 1] = bounds.minY; nodeMin[nodeOffset + 2] = bounds.minZ;
                    nodeMax[nodeOffset] = bounds.maxX; nodeMax[nodeOffset + 1] = bounds.maxY; nodeMax[nodeOffset + 2] = bounds.maxZ;
                    if (count <= 8) {
                        nodeStart[node] = start; nodeCount[node] = count; return node;
                    }
                    const spans = [bounds.centerMaxX - bounds.centerMinX, bounds.centerMaxY - bounds.centerMinY, bounds.centerMaxZ - bounds.centerMinZ];
                    const axis = spans[1] > spans[0] && spans[1] >= spans[2] ? 1 : spans[2] > spans[0] ? 2 : 0;
                    const sorted = Array.from(order.subarray(start, end)).sort((first, second) => centers[second * 3 + axis] - centers[first * 3 + axis]);
                    order.set(sorted, start);
                    const middle = start + (count >> 1);
                    nodeLeft[node] = buildRange(start, middle); nodeRight[node] = buildRange(middle, end);
                    return node;
                }
                buildRange(0, triangleCount);
                return { vertices, triangleBounds, order, nodeMin, nodeMax, nodeLeft, nodeRight, nodeStart, nodeCount, nodeTotal };
            }
            const queryStack = [];
            function bvhSphereClear(bvh, point, radius) {
                const radiusSquared = radius * radius;
                queryStack.length = 0; queryStack.push(0);
                while (queryStack.length) {
                    const node = queryStack.pop(), offset = node * 3;
                    let distanceSquared = 0;
                    for (let axis = 0; axis < 3; axis++) {
                        const coordinate = point.getComponent(axis), minimum = bvh.nodeMin[offset + axis], maximum = bvh.nodeMax[offset + axis];
                        if (coordinate < minimum) distanceSquared += (minimum - coordinate) ** 2;
                        else if (coordinate > maximum) distanceSquared += (coordinate - maximum) ** 2;
                    }
                    if (distanceSquared > radiusSquared) continue;
                    const count = bvh.nodeCount[node];
                    if (count) {
                        const start = bvh.nodeStart[node];
                        for (let index = 0; index < count; index++) {
                            const triangleIndex = bvh.order[start + index], boundsOffset = triangleIndex * 6;
                            let boundsDistance = 0;
                            for (let axis = 0; axis < 3; axis++) {
                                const coordinate = point.getComponent(axis), minimum = bvh.triangleBounds[boundsOffset + axis], maximum = bvh.triangleBounds[boundsOffset + axis + 3];
                                if (coordinate < minimum) boundsDistance += (minimum - coordinate) ** 2;
                                else if (coordinate > maximum) boundsDistance += (coordinate - maximum) ** 2;
                            }
                            if (boundsDistance > radiusSquared) continue;
                            const vertexOffset = triangleIndex * 9;
                            triangle.a.set(bvh.vertices[vertexOffset], bvh.vertices[vertexOffset + 1], bvh.vertices[vertexOffset + 2]);
                            triangle.b.set(bvh.vertices[vertexOffset + 3], bvh.vertices[vertexOffset + 4], bvh.vertices[vertexOffset + 5]);
                            triangle.c.set(bvh.vertices[vertexOffset + 6], bvh.vertices[vertexOffset + 7], bvh.vertices[vertexOffset + 8]);
                            triangle.closestPointToPoint(point, nearest);
                            if (nearest.distanceToSquared(point) <= radiusSquared) return true;
                        }
                    } else {
                        queryStack.push(bvh.nodeLeft[node], bvh.nodeRight[node]);
                    }
                }
                return false;
            }
            function sphereClearance(point, radius) {
                if (bounds && (point.x - radius < bounds.minX || point.x + radius > bounds.maxX ||
                    point.z - radius < bounds.minZ || point.z + radius > bounds.maxZ ||
                    (finite(bounds.minY) && point.y - radius < bounds.minY) ||
                    (finite(bounds.maxY) && point.y + radius > bounds.maxY))) return 'bounds';
                spherePoint.set(point.x, point.y, point.z);
                const distanceLimit = radius * radius;
                for (const surface of surfaces) if (surface.bounds.distanceToPoint(spherePoint) <= radius &&
                    bvhSphereClear(surface.bvh, spherePoint, radius)) return 'obstacle';
                return null;
            }
            function advance(current, next, radius, height) {
                if (bounds && (next.x - radius < bounds.minX || next.x + radius > bounds.maxX ||
                    next.z - radius < bounds.minZ || next.z + radius > bounds.maxZ)) return 'bounds';
                const feet = current.y - height;
                const ground = world.sampleGround(next.x, next.z, feet);
                if (!ground) return 'unsupported-ground';
                for (let index = 0; index < 8; index++) {
                    const angle = index * Math.PI / 4;
                    const support = world.sampleGround(next.x + Math.cos(angle) * radius * .9,
                        next.z + Math.sin(angle) * radius * .9, feet);
                    if (!support || Math.abs(support.y - ground.y) > stepMax + epsilon) return 'unsupported-footprint';
                }
                next.y = ground.y + height;
                const direction = new T.Vector3(next.x - current.x, 0, next.z - current.z);
                const distance = direction.length();
                if (distance > epsilon) {
                    direction.divideScalar(distance);
                    const side = new T.Vector3(-direction.z, 0, direction.x);
                    const base = Math.max(feet, ground.y);
                    for (let y = stepMax + epsilon * 2; y <= height + radius + epsilon; y += Math.min(radius, .15)) {
                        for (const offset of [-radius, -radius / 2, 0, radius / 2, radius]) {
                            const origin = new T.Vector3(current.x, base + y, current.z).addScaledVector(side, offset);
                            if (cast(origin, direction, distance + radius)[0]) return 'obstacle';
                        }
                    }
                }
                const ceilingStart = ground.y + height - stepMax;
                for (const [dx, dz] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
                    if (cast(new T.Vector3(next.x + dx, ceilingStart, next.z + dz), up, stepMax + radius)[0]) return 'ceiling';
                }
                return null;
            }
            async function indexSurfaces(collisionScene) {
                group.updateWorldMatrix(true, true);
                const inverseGroup = group.matrixWorld.clone().invert();
                collisionMaterial = new T.MeshBasicMaterial({ side: T.DoubleSide });
                const meshes = [];
                root.traverse(source => {
                    if (!source.isMesh || source.userData.ignoreWalkCollision) return;
                    for (let node = source; node; node = node.parent) if (!node.visible) return;
                    meshes.push(source);
                });
                collisionScene?.traverse(source => {
                    if (source.isMesh && !source.userData.ignoreWalkCollision) meshes.push(source);
                });
                let deadline = performance.now() + 16;
                for (const source of meshes) {
                    if (source.isSkinnedMesh || source.morphTargetInfluences?.some(value => value !== 0)) {
                        throw new Error('Authored collision requires static evaluated geometry: ' + source.name);
                    }
                    const local = new T.Matrix4().multiplyMatrices(inverseGroup, source.matrixWorld);
                    const count = source.isInstancedMesh ? source.count : 1;
                    for (let index = 0; index < count; index++) {
                        const mesh = new T.Mesh(source.geometry, collisionMaterial);
                        mesh.matrixAutoUpdate = false; mesh.matrix.copy(local);
                        if (source.isInstancedMesh) {
                            const instance = new T.Matrix4(); source.getMatrixAt(index, instance);
                            mesh.matrix.multiply(instance);
                        }
                        mesh.matrixWorld.copy(mesh.matrix);
                        const bounds = new T.Box3().setFromObject(mesh);
                        surfaces.push({ mesh, bounds, bvh: buildBVH(mesh) });
                        if (performance.now() >= deadline) {
                            await new Promise(resolve => setTimeout(resolve, 0));
                            if (disposed()) return;
                            deadline = performance.now() + 16;
                        }
                    }
                }
            }
            async function loadObjectSpaceNormals(gltf) {
                const materials = new Set(), existingTextures = new Set();
                gltf.scene.traverse(node => {
                    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) {
                        materials.add(material);
                        for (const value of Object.values(material)) if (value?.isTexture) existingTextures.add(value);
                    }
                });
                const requested = new Map();
                for (const material of materials) {
                    const index = material.userData?.lifeObjectNormalTexture;
                    if (index === undefined) continue;
                    if (!Number.isInteger(index) || index < 0 || index >= (gltf.parser?.json?.textures?.length ?? 0)) {
                        throw new Error('lifeObjectNormalTexture must reference a glTF texture index.');
                    }
                    if (typeof gltf.parser.getDependency !== 'function') throw new Error('Object-space normal textures require the glTF parser.');
                    if (material.normalMap) throw new Error('Object-space normal extras cannot also use a standard normal texture.');
                    if (!requested.has(index)) requested.set(index, []);
                    requested.get(index).push(material);
                }
                const results = await Promise.allSettled(Array.from(requested, async ([index, targets]) => {
                    const dependency = await gltf.parser.getDependency('texture', index);
                    if (!dependency?.isTexture) throw new Error('The object-space normal texture could not be loaded.');
                    let texture = dependency;
                    if (existingTextures.has(dependency) || dependency.userData?.shared) {
                        collectTextureImages(dependency);
                        texture = dependency.clone();
                        texture.userData = { ...texture.userData, shared: false };
                    }
                    normalTextures.add(texture);
                    texture.addEventListener('dispose', () => disposedNormalTextures.add(texture));
                    collectTextureImages(texture);
                    if (disposed()) {
                        disposeNormalTextures();
                        closeOwnedImages();
                        return;
                    }
                    if (targets.some(material => material.userData?.shared)) {
                        sharedNormalTextures.add(texture);
                        collectTextureImages(texture, true);
                    }
                    texture.colorSpace = T.NoColorSpace;
                    texture.needsUpdate = true;
                    for (const material of targets) {
                        material.normalMap = texture;
                        material.normalMapType = T.ObjectSpaceNormalMap;
                        material.needsUpdate = true;
                    }
                }));
                const failure = results.find(result => result.status === 'rejected');
                if (failure) throw failure.reason;
            }
            world.loadPromise = Promise.resolve().then(async () => {
                if (disposed()) return null;
                if (!window.NightGLTFLoader) throw new Error('The glTF loader is unavailable.');
                const manager = new T.LoadingManager();
                manager.setURLModifier(value => value.startsWith('data:') || value.startsWith('blob:') ? value : safeUrl(value));
                const loader = new window.NightGLTFLoader(manager);
                if (!collisionUrl) return loader.loadAsync(url);
                const results = await Promise.allSettled([loader.loadAsync(url), loader.loadAsync(collisionUrl)]);
                const failure = results.find(result => result.status === 'rejected');
                if (failure) {
                    for (const result of results) if (result.status === 'fulfilled' && result.value?.scene) disposeOwnedGroup(result.value.scene);
                    throw failure.reason;
                }
                return { ...results[0].value, collisionScene: results[1].value.scene };
            }).then(async gltf => {
                if (!gltf) return world;
                collectOwnedImages(gltf.scene);
                collectOwnedImages(gltf.collisionScene);
                if (disposed()) {
                    disposeLoadedResult(gltf);
                    return world;
                }
                if (!gltf.scene?.isObject3D) throw new Error('The glTF has no scene.');
                root.add(gltf.scene);
                if (collisionUrl) {
                    if (!gltf.collisionScene?.isObject3D) throw new Error('The collision glTF has no scene.');
                    gltf.collisionScene.visible = false;
                    gltf.collisionScene.userData.collisionOnly = true;
                    root.add(gltf.collisionScene);
                }
                await loadObjectSpaceNormals(gltf);
                if (disposed()) {
                    disposeLoadedResult(gltf);
                    return world;
                }
                await indexSurfaces(gltf.collisionScene);
                if (disposed()) {
                    disposeLoadedResult(gltf);
                    return world;
                }
                if (!surfaces.length) throw new Error('The authored scene contains no collision surfaces.');
                state = 'ready';
                return world;
            }).catch(failure => {
                error = failure.message || String(failure); state = 'error';
                if (!disposed()) disposeOwnedGroup(root);
                else {
                    disposeNormalTextures();
                    closeOwnedImages();
                }
                clearCollision();
                return world;
            });
            return world;
        };
    }
    window.AuthoredWorlds = { createBuilder, canExplore: world => Boolean(world?.ready && world?.status === 'ready') };
})();
