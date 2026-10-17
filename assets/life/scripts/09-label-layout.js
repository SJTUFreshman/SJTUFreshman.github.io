// Shared by the authored 3-D map and the observed sky. Camera motion is applied
// directly; only changes to a label's offset are eased, so names track their stars.
class StarMapLabelLayout {
    constructor() {
        this.entries = new Map();
        this.delta = 0;
    }

    beginFrame(delta) {
        this.delta = Math.min(0.05, Math.max(0, delta));
    }

    clear() {
        this.entries.clear();
    }

    hide(key) {
        this.entries.delete(key);
    }

    place(key, anchor, candidates, occupied, stars, bounds) {
        if (!candidates.length || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
            this.hide(key);
            return null;
        }
        const intersects = (rect, other, padding) => rect.left < other.right + padding
            && rect.right > other.left - padding && rect.top < other.bottom + padding
            && rect.bottom > other.top - padding;
        const clear = (rect, retain = false) => rect && rect.left >= bounds.left && rect.right <= bounds.right
            && rect.top >= bounds.top && rect.bottom <= bounds.bottom
            && !occupied.some(other => intersects(rect, other, retain ? 2 : 10))
            && !stars.some(point => point.x > rect.left - (retain ? 3 : 12) && point.x < rect.right + (retain ? 3 : 12)
                && point.y > rect.top - (retain ? 3 : 12) && point.y < rect.bottom + (retain ? 3 : 12));
        const firstClear = () => candidates.findIndex(rect => clear(rect));
        let entry = this.entries.get(key);
        if (!entry) {
            const slot = firstClear();
            entry = { slot, x: 0, y: 0, anchorX: anchor.x, anchorY: anchor.y, blocked: 0,
                cooldown: 0, opacity: slot < 0 ? 0 : 1, visible: slot >= 0,
                hiddenFor: 0, unreadableFor: 0, revealFor: 0, ready: slot >= 0 };
            if (slot >= 0) {
                entry.x = candidates[slot].left;
                entry.y = candidates[slot].top;
            }
            this.entries.set(key, entry);
        }
        const delta = this.delta;
        // Keep the previous side of the constellation until an obstruction persists.
        // Different entry/exit margins prevent oscillation at a collision boundary.
        entry.cooldown = Math.max(0, entry.cooldown - delta);
        const retained = clear(candidates[entry.slot], true);
        entry.blocked = retained ? 0 : entry.blocked + delta;
        if (!entry.ready || entry.blocked >= 0.22 && entry.cooldown === 0) {
            const available = candidates.map((rect, slot) => ({ rect, slot })).filter(({ rect }) => clear(rect));
            if (entry.ready) available.sort((a, b) =>
                Math.hypot(a.rect.left - entry.x, a.rect.top - entry.y) - Math.hypot(b.rect.left - entry.x, b.rect.top - entry.y));
            const next = available[0]?.slot ?? -1;
            if (next >= 0) {
                entry.slot = next;
                entry.blocked = 0;
                entry.cooldown = 0.65;
                if (!entry.ready) {
                    entry.x = candidates[next].left;
                    entry.y = candidates[next].top;
                    entry.anchorX = anchor.x;
                    entry.anchorY = anchor.y;
                    entry.ready = true;
                }
            }
        }
        const target = candidates[entry.slot];
        if (!entry.ready || !target) {
            entry.anchorX = anchor.x;
            entry.anchorY = anchor.y;
            return null;
        }
        entry.x += anchor.x - entry.anchorX;
        entry.y += anchor.y - entry.anchorY;
        entry.anchorX = anchor.x;
        entry.anchorY = anchor.y;
        const dx = target.left - entry.x, dy = target.top - entry.y;
        const distance = Math.hypot(dx, dy);
        const step = Math.min(distance * (1 - Math.exp(-delta * 12)), delta * 240);
        if (distance > 0) {
            entry.x += dx * step / distance;
            entry.y += dy * step / distance;
        }
        const rect = { left: entry.x, top: entry.y,
            right: entry.x + target.right - target.left, bottom: entry.y + target.bottom - target.top };
        const inside = rect.left >= bounds.left && rect.right <= bounds.right
            && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
        const readable = inside && (clear(target, true) || entry.blocked < 0.3);
        entry.unreadableFor = readable ? 0 : entry.unreadableFor + delta;
        entry.revealFor = readable ? entry.revealFor + delta : 0;
        if (entry.visible && entry.unreadableFor >= 0.15) entry.visible = false;
        entry.hiddenFor = entry.visible ? 0 : entry.hiddenFor + delta;
        // Finish fading before revealing again. A one-frame gap near an edge
        // must not reverse opacity and turn into a flashing name.
        if (!entry.visible && entry.opacity === 0 && entry.hiddenFor >= 0.28 && entry.revealFor >= 0.18) {
            entry.visible = true;
        }
        entry.opacity = clamp(entry.opacity + (entry.visible ? 1 : -1) * delta * 6, 0, 1);
        if (entry.opacity <= 0) return null;
        return { ...rect, opacity: entry.opacity };
    }
}
