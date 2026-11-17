/* A local, progressively enhanced cabinet. Steam credentials never enter this page. */
(() => {
    'use strict';
    const games = document.getElementById('games');
    const shelf = document.getElementById('gamesShelf');
    if (!games || !shelf) return;

    const search = document.getElementById('gamesSearch');
    const sort = document.getElementById('gamesSort');
    const count = document.getElementById('gamesResultCount');
    const empty = document.getElementById('gamesEmpty');
    const panel = games.closest('.portal-panel');
    const dialog = document.getElementById('gameDetailDialog');
    const detailBody = document.getElementById('gameDetailBody');
    const closeButton = document.getElementById('gameDetailClose');
    const video = games.querySelector('video[data-games-background]');
    const motionButton = games.querySelector('[data-games-motion]');
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const cases = Array.from(shelf.querySelectorAll('.game-case'));
    const originalOrder = new Map(cases.map((item, index) => [item, index]));
    let pausedByUser = motionQuery.matches;
    let hasMotionChoice = false;
    let videoFailed = false;
    let returnFocus = null;
    let activeGame = null;

    function language() {
        return typeof state !== 'undefined' ? state.currentLang : document.documentElement.lang || 'en';
    }

    function translate(key, fallback) {
        const strings = typeof i18n !== 'undefined' ? i18n[language()] || i18n.en || {} : {};
        return strings[key] || fallback;
    }

    function applyTranslations(scope) {
        scope.querySelectorAll('[data-key]').forEach(element => {
            const translated = translate(element.dataset.key, '');
            if (translated) element.textContent = translated;
        });
    }

    function applyGameNames(scope) {
        const lang = language();
        scope.querySelectorAll('[data-game-name]').forEach(element => {
            const name = lang === 'zh-CN' ? element.dataset.zhCn : lang === 'zh-TW' ? element.dataset.zhTw || element.dataset.zhCn : element.dataset.en;
            element.textContent = name || element.dataset.en || element.textContent;
        });
        scope.querySelectorAll('.game-case').forEach(item => {
            const title = item.querySelector('[data-game-name]');
            const button = item.querySelector('[data-game-open]');
            if (title && button) button.setAttribute('aria-label', title.textContent.trim());
        });
    }

    function displayedName(item) {
        return item.querySelector('[data-game-name]')?.textContent || item.dataset.name || '';
    }

    function numeric(value, fallback = -1) {
        if (value == null || value === '') return fallback;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function recent(item) {
        const value = item.dataset.recent;
        if (!value) return -1;
        return numeric(value, Date.parse(value) || -1);
    }

    function completion(item) {
        const total = numeric(item.dataset.total);
        const completed = numeric(item.dataset.completed);
        return total > 0 && completed >= 0 ? completed / total : -1;
    }

    function updateShelf() {
        const query = (search?.value || '').trim().normalize('NFKC').toLocaleLowerCase(language());
        const mode = sort?.value || 'playtime';
        const sorted = cases.slice().sort((left, right) => {
            let difference = 0;
            if (mode === 'name') {
                difference = displayedName(left).localeCompare(displayedName(right), language(), { numeric: true, sensitivity: 'base' });
            } else if (mode === 'recent') {
                difference = recent(right) - recent(left);
            } else if (mode === 'completion') {
                difference = completion(right) - completion(left);
            } else {
                difference = numeric(right.dataset.minutes) - numeric(left.dataset.minutes);
            }
            return difference || originalOrder.get(left) - originalOrder.get(right);
        });
        let visible = 0;
        const fragment = document.createDocumentFragment();
        sorted.forEach(item => {
            const name = (item.dataset.name || '').normalize('NFKC').toLocaleLowerCase(language());
            item.hidden = Boolean(query && !name.includes(query));
            if (!item.hidden) visible++;
            fragment.append(item);
        });
        shelf.append(fragment);
        if (count) count.textContent = `${visible} / ${cases.length}`;
        if (empty) empty.hidden = visible !== 0;
    }

    function handleCover(image) {
        if (image.dataset.cabinetBound) return;
        image.dataset.cabinetBound = 'true';
        const box = image.closest('.game-box');
        const loaded = () => {
            if (!image.naturalWidth) return;
            image.hidden = false;
            box?.classList.add('has-cover');
            image.classList.toggle('is-landscape', image.naturalWidth > image.naturalHeight);
        };
        const failed = () => {
            box?.classList.remove('has-cover');
            const fallback = image.dataset.fallback;
            if (!image.dataset.fallbackTried && fallback && fallback !== image.getAttribute('src')) {
                image.dataset.fallbackTried = 'true';
                image.src = fallback;
                return;
            }
            image.hidden = true;
        };
        image.addEventListener('load', loaded);
        image.addEventListener('error', failed);
        if (image.complete) image.naturalWidth ? loaded() : failed();
    }

    function closeDetail() {
        if (!dialog?.open) return;
        dialog.close();
    }

    function showDetail(button) {
        if (!dialog || !detailBody) return;
        const appId = button.dataset.gameOpen;
        if (!/^\d+$/.test(appId || '')) return;
        const template = document.getElementById(`gameDetail-${appId}`);
        if (!(template instanceof HTMLTemplateElement)) return;
        returnFocus = button;
        activeGame = appId;
        detailBody.replaceChildren(template.content.cloneNode(true));
        applyTranslations(detailBody);
        applyGameNames(detailBody);
        detailBody.querySelectorAll('img[data-game-cover]').forEach(handleCover);
        if (!dialog.open) dialog.showModal();
        closeButton?.focus({ preventScroll: true });
        dialog.scrollTop = 0;
        updateMotion();
    }

    function active() {
        return !games.hidden && !document.hidden && (!panel || panel.getAttribute('aria-hidden') !== 'true') && Boolean(games.getClientRects().length);
    }

    function updateMotion() {
        const playing = active() && !pausedByUser && !dialog?.open;
        games.classList.toggle('games-motion-paused', !playing);
        if (motionButton) {
            const key = pausedByUser ? 'games_motion_play' : 'games_motion_pause';
            const fallback = pausedByUser ? 'Play background' : 'Pause background';
            motionButton.dataset.key = key;
            motionButton.textContent = translate(key, fallback);
            // The toggle is pressed when the background animation is paused.
            motionButton.setAttribute('aria-pressed', String(pausedByUser));
        }
        if (video) {
            if (playing && !videoFailed) {
                video.muted = true;
                video.play().catch(() => {
                    // Autoplay can be denied; the poster remains a complete fallback.
                    games.classList.add('games-video-still');
                });
            } else {
                video.pause();
            }
        }
    }

    function updateLanguage() {
        if (search) {
            search.placeholder = translate('games_search_placeholder', 'Find a game…');
            search.setAttribute('aria-label', translate('games_search', 'Search games'));
        }
        if (sort) sort.setAttribute('aria-label', translate('games_sort', 'Sort games'));
        if (closeButton) closeButton.setAttribute('aria-label', translate('games_close', 'Close game details'));
        applyGameNames(games);
        if (dialog?.open) {
            applyTranslations(detailBody);
            applyGameNames(detailBody);
        }
        updateShelf();
        updateMotion();
    }

    search?.addEventListener('input', updateShelf);
    sort?.addEventListener('change', updateShelf);
    shelf.addEventListener('click', event => {
        const button = event.target.closest('[data-game-open]');
        if (button && shelf.contains(button)) showDetail(button);
    });
    closeButton?.addEventListener('click', closeDetail);
    dialog?.addEventListener('cancel', event => {
        event.preventDefault();
        event.stopPropagation();
        closeDetail();
    });
    dialog?.addEventListener('keydown', event => {
        // Stop map shortcuts at the modal, while preserving native Tab navigation.
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            closeDetail();
        }
    });
    dialog?.addEventListener('click', event => {
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDetail();
    });
    dialog?.addEventListener('close', () => {
        activeGame = null;
        if (returnFocus?.isConnected && !games.hidden && !returnFocus.closest('[hidden]')) returnFocus.focus({ preventScroll: true });
        returnFocus = null;
        updateMotion();
    });
    motionButton?.addEventListener('click', () => {
        hasMotionChoice = true;
        pausedByUser = !pausedByUser;
        updateMotion();
    });
    motionQuery.addEventListener('change', event => {
        if (!hasMotionChoice || event.matches) pausedByUser = event.matches;
        updateMotion();
    });
    video?.addEventListener('error', () => {
        videoFailed = true;
        games.classList.add('games-video-still');
    });
    video?.addEventListener('playing', () => games.classList.remove('games-video-still'));
    document.addEventListener('visibilitychange', updateMotion);
    new MutationObserver(() => {
        if (games.hidden && activeGame) closeDetail();
        updateMotion();
    }).observe(games, { attributes: true, attributeFilter: ['hidden'] });
    if (panel) new MutationObserver(() => {
        if (panel.getAttribute('aria-hidden') === 'true' && activeGame) closeDetail();
        updateMotion();
    }).observe(panel, { attributes: true, attributeFilter: ['aria-hidden'] });
    new MutationObserver(updateLanguage).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    cases.forEach(item => {
        const appId = numeric(item.dataset.appId, originalOrder.get(item));
        item.style.setProperty('--game-hue', String((appId * 137.508) % 360));
    });
    games.querySelectorAll('img[data-game-cover]').forEach(handleCover);
    window.GamesCabinet = { updateLanguage };
    updateLanguage();
})();
