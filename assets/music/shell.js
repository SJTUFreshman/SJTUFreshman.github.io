(() => {
    'use strict';

    const root = new URL('../../', document.currentScript.src);
    const frame = document.getElementById('sitePage');
    const recovery = document.getElementById('pageRecovery');
    const retry = document.getElementById('pageRetry');
    const routeNames = new Set(['', 'index', 'index.html', 'life', 'life.html', 'observatory', 'observatory.html']);
    let recoveryTimer = 0;
    let restoringScroll = null;

    function route(href) {
        let url;
        try {
            url = new URL(href, root);
        } catch (error) {
            return null;
        }
        if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return null;
        const name = url.pathname.slice(root.pathname.length);
        return routeNames.has(name) ? url : null;
    }

    function pageName(url) {
        return /\/(life|observatory)(\.html)?$/.test(url.pathname) ? 'life' : 'index';
    }

    function rememberScroll() {
        history.replaceState({ ...history.state, scroll: [frame.contentWindow.scrollX, frame.contentWindow.scrollY] }, '', location.href);
    }

    function showPage(destination) {
        document.body.dataset.page = pageName(destination);
        recovery.hidden = true;
        const fallback = new URL(destination);
        fallback.searchParams.set('music', 'off');
        retry.href = fallback.href;
        clearTimeout(recoveryTimer);
        recoveryTimer = setTimeout(() => { recovery.hidden = false; }, 20000);
        frame.contentWindow.location.replace(destination.href);
    }

    function navigate(href, options = {}) {
        const destination = route(href);
        if (!destination) return false;
        const current = new URL(location.href);
        if (destination.href === current.href) {
            if (!destination.hash) frame.contentWindow.scrollTo({ top: 0, behavior: 'smooth' });
            return true;
        }
        rememberScroll();
        history[options.replace ? 'replaceState' : 'pushState']({ musicShell: true, scroll: [0, 0] }, '', destination.href);
        restoringScroll = null;
        if (current.pathname === destination.pathname && current.search === destination.search) {
            frame.contentWindow.history.replaceState(null, '', destination.href);
            const identifier = decodeURIComponent(destination.hash.slice(1));
            const target = frame.contentDocument.getElementById(identifier);
            if (target) target.scrollIntoView({ behavior: 'smooth' });
            else if (!identifier) frame.contentWindow.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            showPage(destination);
        }
        return true;
    }

    function sync(source) {
        if (source !== frame.contentWindow) return;
        clearTimeout(recoveryTimer);
        recovery.hidden = true;
        document.title = source.document.title;
        document.documentElement.lang = source.document.documentElement.lang;
        frame.title = source.document.title;
        document.body.dataset.page = pageName(new URL(source.location.href));
        if (restoringScroll) {
            const position = restoringScroll;
            restoringScroll = null;
            source.requestAnimationFrame(() => source.scrollTo(...position));
        }
    }

    window.SiteMusicHost = { root: root.href, navigate, route, sync };
    const requested = new URL(location.href).searchParams.get('route');
    const initial = route(requested || 'index.html') || new URL('index.html', root);
    const base = document.createElement('base');
    base.href = root.href;
    document.head.prepend(base);
    history.replaceState({ musicShell: true, scroll: [0, 0] }, '', initial.href);
    window.addEventListener('popstate', event => {
        const destination = route(location.href);
        if (!destination) return;
        restoringScroll = event.state?.scroll || [0, 0];
        if (frame.contentWindow.location.href.split('#')[0] === destination.href.split('#')[0]) {
            frame.contentWindow.history.replaceState(null, '', destination.href);
            frame.contentWindow.scrollTo(...restoringScroll);
            restoringScroll = null;
        } else {
            showPage(destination);
        }
    });
    frame.addEventListener('load', () => {
        if (frame.contentWindow.location.href !== 'about:blank') sync(frame.contentWindow);
    });
    showPage(initial);
})();
