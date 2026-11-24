(() => {
    const dialog = document.getElementById('newsJournal');
    const content = document.getElementById('newsJournalContent');
    const newsList = document.getElementById('newsList');
    if (!dialog || !content || !newsList) return;

    let opener = null;
    let pointerStartedOutside = false;

    function setLanguage(language) {
        const translations = i18n[language] || i18n.en;
        dialog.querySelectorAll('[data-key]').forEach(element => {
            const value = translations[element.dataset.key];
            if (value !== undefined) element.innerHTML = value;
        });
        dialog.querySelectorAll('[data-alt-key]').forEach(element => {
            const value = translations[element.dataset.altKey];
            if (value !== undefined) {
                const decoded = document.createElement('span');
                decoded.innerHTML = value;
                element.alt = decoded.textContent;
            }
        });
    }

    function openEntry(trigger) {
        const template = document.getElementById('journal-' + trigger.dataset.newsEntry);
        if (!template || dialog.open) return;
        opener = trigger;
        content.replaceChildren(template.content.cloneNode(true));
        content.querySelector('.journal-title').id = 'newsJournalTitle';
        dialog.dataset.journalLayout = content.querySelector('.journal-entry').dataset.journalLayout || 'note';
        setLanguage(document.documentElement.lang);
        dialog.classList.remove('is-closing');
        document.documentElement.classList.add('news-journal-open');
        dialog.showModal();
        dialog.scrollTop = 0;
    }

    newsList.addEventListener('click', event => {
        const trigger = event.target.closest('[data-news-entry]');
        if (trigger) openEntry(trigger);
    });

    function outsidePaper(event) {
        const bounds = dialog.getBoundingClientRect();
        return event.clientX < bounds.left || event.clientX > bounds.right
            || event.clientY < bounds.top || event.clientY > bounds.bottom;
    }

    async function closeEntry() {
        if (!dialog.open || dialog.classList.contains('is-closing')) return;
        const entry = content.firstElementChild;
        dialog.classList.add('is-closing');

        // Keep the modal in the top layer until its paper and backdrop have faded.
        const transitions = dialog.getAnimations?.().filter(animation =>
            animation.transitionProperty === 'opacity' || animation.transitionProperty === 'transform'
        );
        if (transitions?.length) {
            await Promise.allSettled(transitions.map(animation => animation.finished));
        }
        if (dialog.open && content.firstElementChild === entry) dialog.close();
    }

    dialog.addEventListener('cancel', event => {
        event.preventDefault();
        closeEntry();
    });

    dialog.addEventListener('submit', event => {
        if (event.target.method !== 'dialog') return;
        event.preventDefault();
        closeEntry();
    });

    dialog.addEventListener('pointerdown', event => {
        pointerStartedOutside = event.target === dialog && outsidePaper(event);
    });

    dialog.addEventListener('click', event => {
        if (pointerStartedOutside && event.target === dialog && outsidePaper(event)) closeEntry();
        pointerStartedOutside = false;
    });

    dialog.addEventListener('close', () => {
        if (dialog.open) return;
        dialog.classList.remove('is-closing');
        document.documentElement.classList.remove('news-journal-open');
        content.replaceChildren();
        delete dialog.dataset.journalLayout;
        opener?.focus({ preventScroll: true });
        opener = null;
        pointerStartedOutside = false;
    });

    window.NewsJournal = { setLanguage };
})();
