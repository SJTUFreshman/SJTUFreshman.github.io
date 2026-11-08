(() => {
    'use strict';

    let host;
    try {
        if (window.frameElement?.id === 'sitePage') host = window.parent.SiteMusicHost;
    } catch (error) {
        return;
    }
    if (!host) return;
    window.SiteMusicNavigation = host.navigate;
    const sync = () => host.sync(window);
    new MutationObserver(sync).observe(document.querySelector('title'), { childList: true, subtree: true });
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    document.addEventListener('pointerdown', () => window.parent.dispatchEvent(new Event('music:outside')));
    document.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download')) return;
        if (link.target && link.target !== '_self') return;
        const destination = host.route(link.href);
        if (!destination) {
            link.target = '_top';
            return;
        }
        if (link.id === 'lifePortalLink' && window.StellarTransit) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (destination.pathname === location.pathname && destination.search === location.search) {
            host.navigate(destination.href);
        } else if (window.StellarTransit) {
            window.StellarTransit.navigate({
                href: destination.href,
                to: /\/(life|observatory)(\.html)?$/.test(destination.pathname) ? 'life' : 'index',
                mode: /\/(life|observatory)(\.html)?$/.test(destination.pathname) ? 'cool' : 'home',
                origin: link
            });
        } else {
            host.navigate(destination.href);
        }
    }, true);
    sync();
})();
