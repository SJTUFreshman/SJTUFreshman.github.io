(() => {
    const profile = document.getElementById('profile');
    const button = document.getElementById('handwritingToggle');
    if (!profile || !button) return;

    const originals = Array.from(document.getElementById('handwritingSources').content.querySelectorAll('[data-handwriting-id]'));
    const status = document.getElementById('handwritingStatus');
    const layer = document.createElement('div');
    layer.id = 'handwritingSky';
    layer.className = 'handwriting-sky';
    layer.setAttribute('aria-hidden', 'true');
    layer.hidden = true;
    document.body.append(layer);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const visible = new Set();
    let enabled = false;
    let running = false;
    let unavailable = false;
    let generation = 0;
    let timer = 0;
    let resizeFrame = 0;
    let deck = [];
    let previousId = '';

    function updateCopy() {
        const copy = i18n[state.currentLang] || i18n.en;
        const label = button.querySelector('[data-key]');
        label.dataset.key = enabled ? 'handwriting_hide' : 'handwriting_show';
        label.textContent = copy[label.dataset.key];
        button.setAttribute('aria-pressed', String(enabled));
        document.body.classList.toggle('handwriting-active', enabled);
        status.textContent = unavailable ? copy.handwriting_unavailable : '';
        originals.forEach(original => {
            original.alt = copy.handwriting_phrase.replace('{number}', original.dataset.handwritingNumber);
        });
    }

    function clear() {
        generation += 1;
        running = false;
        window.clearTimeout(timer);
        visible.forEach(item => item.animation?.cancel());
        visible.clear();
        layer.replaceChildren();
        layer.hidden = true;
    }

    function stop() {
        enabled = false;
        clear();
        updateCopy();
    }

    function skyBounds() {
        const panel = dom.panel.getBoundingClientRect();
        const compact = panel.width > innerWidth * 0.8;
        const left = 22;
        const top = 108;
        const right = compact ? innerWidth - 22 : panel.left - 26;
        const bottom = compact ? panel.top - 24 : innerHeight - 54;
        return { left, top, width: right - left, height: bottom - top };
    }

    function nextOriginal() {
        if (!deck.length) {
            deck = originals.slice();
            for (let index = deck.length - 1; index > 0; index -= 1) {
                const swap = Math.floor(Math.random() * (index + 1));
                [deck[index], deck[swap]] = [deck[swap], deck[index]];
            }
            if (deck.length > 1 && deck[deck.length - 1].dataset.handwritingId === previousId) {
                [deck[0], deck[deck.length - 1]] = [deck[deck.length - 1], deck[0]];
            }
        }
        const original = deck.pop();
        previousId = original.dataset.handwritingId;
        return original;
    }

    function place(image, bounds) {
        const width = Math.min(260, bounds.width * 0.62, image.naturalWidth * 0.46);
        const height = width * image.naturalHeight / image.naturalWidth;
        const scale = Math.min(1, 96 / height, (bounds.height - 12) / height);
        const sizedWidth = width * scale;
        const sizedHeight = height * scale;
        for (let attempt = 0; attempt < 16; attempt += 1) {
            const left = bounds.left + Math.random() * (bounds.width - sizedWidth);
            const top = bounds.top + 6 + Math.random() * (bounds.height - sizedHeight - 12);
            const rect = { left, top, right: left + sizedWidth, bottom: top + sizedHeight };
            const overlaps = [...visible].some(item => rect.left < item.rect.right + 28
                && rect.right > item.rect.left - 28 && rect.top < item.rect.bottom + 28 && rect.bottom > item.rect.top - 28);
            if (overlaps) continue;
            Object.assign(image.style, { left: `${left}px`, top: `${top}px`, width: `${sizedWidth}px`, height: `${sizedHeight}px` });
            return rect;
        }
        return null;
    }

    async function emit(currentGeneration) {
        if (visible.size >= 2) return;
        for (let attempt = 0; attempt < originals.length; attempt += 1) {
            const original = nextOriginal();
            const image = new Image();
            image.className = 'handwriting-phrase';
            image.alt = '';
            image.decoding = 'async';
            image.dataset.phrase = original.dataset.handwritingId;
            image.src = original.dataset.src;
            try {
                await image.decode();
            } catch {
                if (generation !== currentGeneration) return;
                continue;
            }
            if (generation !== currentGeneration || !running) return;
            const rect = place(image, skyBounds());
            if (!rect) return;
            const item = { image, rect, animation: null };
            visible.add(item);
            layer.append(image);
            if (!reducedMotion.matches) {
                item.animation = image.animate([
                    { opacity: 0, transform: 'translateY(6px)', offset: 0 },
                    { opacity: 0.94, transform: 'translateY(2px)', offset: 0.2 },
                    { opacity: 0.94, transform: 'translateY(-2px)', offset: 0.7 },
                    { opacity: 0, transform: 'translateY(-6px)', offset: 1 }
                ], { duration: 10000 + Math.random() * 2500, easing: 'ease-in-out', fill: 'both' });
                item.animation.finished.then(() => {
                    visible.delete(item);
                    image.remove();
                }).catch(() => {});
            }
            return;
        }
        if (generation === currentGeneration) {
            unavailable = true;
            stop();
        }
    }

    async function tick(currentGeneration) {
        await emit(currentGeneration);
        if (running && generation === currentGeneration && !reducedMotion.matches) {
            timer = window.setTimeout(() => tick(currentGeneration), 3800 + Math.random() * 1800);
        }
    }

    function sync() {
        if (profile.hidden || !document.body.classList.contains('panel-open')) {
            if (enabled || running) stop();
            return;
        }
        if (!enabled || document.hidden) {
            if (running) clear();
            return;
        }
        const bounds = skyBounds();
        if (running || bounds.width < 100 || bounds.height < 70) return;
        running = true;
        layer.hidden = false;
        tick(generation);
    }

    function refreshLayout() {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
            if (!enabled) return;
            clear();
            sync();
        });
    }

    button.addEventListener('click', () => {
        unavailable = false;
        if (enabled) stop();
        else {
            enabled = true;
            updateCopy();
            sync();
            window.requestAnimationFrame(() => {
                if (enabled) button.scrollIntoView({ block: 'nearest' });
            });
        }
    });
    new MutationObserver(sync).observe(profile, { attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    new MutationObserver(updateCopy).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    new ResizeObserver(refreshLayout).observe(dom.panel);
    dom.panel.addEventListener('transitionend', refreshLayout);
    window.addEventListener('resize', refreshLayout, { passive: true });
    document.addEventListener('visibilitychange', sync);
    reducedMotion.addEventListener('change', refreshLayout);
    window.addEventListener('pagehide', stop);
    updateCopy();
})();
