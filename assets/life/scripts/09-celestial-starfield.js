class CelestialStarfield {
    constructor() {
        this.catalog = null;
        this.stars = [];
        this.key = '';
    }

    prepare() {
        const catalog = window.HipparcosSky;
        if (!catalog || catalog === this.catalog) return;
        this.catalog = catalog;
        this.stars = [];
        for (let index = 0; index < catalog.count; index += 1) {
            const magnitude = catalog.magnitudes[index];
            if (!Number.isFinite(magnitude) || magnitude > 7.2) continue;
            const offset = index * 3;
            const colorIndex = catalog.colorIndices[index];
            const warmth = Number.isFinite(colorIndex) ? Math.max(0, Math.min(1, (colorIndex + 0.15) / 1.8)) : 0.4;
            this.stars.push({
                direction: Array.from(catalog.directions.subarray(offset, offset + 3)), magnitude,
                color: `${Math.round(193 + 62 * warmth)},${Math.round(215 - 22 * warmth)},${Math.round(255 - 101 * warmth)}`
            });
        }
        this.key = '';
    }

    basis(yaw, pitch) {
        const longitude = yaw * Math.PI / 180;
        const latitude = pitch * Math.PI / 180;
        const sineLongitude = Math.sin(longitude);
        const cosineLongitude = Math.cos(longitude);
        const sineLatitude = Math.sin(latitude);
        const cosineLatitude = Math.cos(latitude);
        return {
            forward: [sineLongitude * cosineLatitude, sineLatitude, cosineLongitude * cosineLatitude],
            right: [cosineLongitude, 0, -sineLongitude],
            up: [-sineLongitude * sineLatitude, cosineLatitude, -cosineLongitude * sineLatitude]
        };
    }

    project(direction, basis, width, height, focal) {
        const product = vector => direction[0] * vector[0] + direction[1] * vector[1] + direction[2] * vector[2];
        const depth = product(basis.forward);
        if (depth <= 0) return null;
        const horizontal = width * 0.5 + product(basis.right) * focal / depth;
        const vertical = height * 0.5 - product(basis.up) * focal / depth;
        return horizontal < -8 || horizontal > width + 8 || vertical < -8 || vertical > height + 8
            ? null : [horizontal, vertical];
    }

    draw(context, width, height, { yaw = 0, pitch = 0, fov = 48 } = {}) {
        this.prepare();
        if (!this.canvas) {
            this.canvas = document.createElement('canvas');
            this.context = this.canvas.getContext('2d', { alpha: false });
        }
        if (!this.context) return;
        const key = [width, height, yaw, pitch, fov].join(':');
        if (this.key !== key) {
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
            }
            const sky = this.context;
            sky.globalAlpha = 1;
            sky.fillStyle = '#010207';
            sky.fillRect(0, 0, width, height);
            const basis = this.basis(yaw, pitch);
            const focal = height * 0.5 / Math.tan(Math.max(15, Math.min(100, fov)) * Math.PI / 360);
            const pixelRatio = Math.min(2, Math.max(1, width / Math.max(1, window.innerWidth)));
            for (const star of this.stars) {
                const projected = this.project(star.direction, basis, width, height, focal);
                if (!projected) continue;
                const brightness = Math.min(0.86, 0.09 * Math.pow(10, (6 - star.magnitude) * 0.24));
                const radius = Math.max(0.4, Math.min(1.35, 0.48 + (5 - star.magnitude) * 0.11)) * pixelRatio;
                sky.fillStyle = `rgba(${star.color},${brightness})`;
                sky.beginPath();
                sky.arc(projected[0], projected[1], radius, 0, Math.PI * 2);
                sky.fill();
                if (star.magnitude < 2) {
                    const halo = sky.createRadialGradient(projected[0], projected[1], radius, projected[0], projected[1], radius * 3.5);
                    halo.addColorStop(0, `rgba(${star.color},0.11)`);
                    halo.addColorStop(1, `rgba(${star.color},0)`);
                    sky.fillStyle = halo;
                    sky.fillRect(projected[0] - radius * 3.5, projected[1] - radius * 3.5, radius * 7, radius * 7);
                }
            }
            this.key = key;
        }
        context.drawImage(this.canvas, 0, 0, width, height);
    }

    clear() {
        if (this.canvas) { this.canvas.width = 1; this.canvas.height = 1; }
        this.key = '';
    }
}
