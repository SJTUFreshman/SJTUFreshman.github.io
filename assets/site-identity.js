(() => {
    const namesByLanguage = {
        en: ['Runde Yang', '楊潤德', '杨润德'],
        'zh-CN': ['杨润德', '楊潤德', 'Andrew Allender'],
        'zh-TW': ['楊潤德', 'Andrew Allender']
    };
    const hintsByName = {
        '楊潤德': 'Traditional Chinese name',
        '杨润德': 'Simplified Chinese name'
    };
    const flipLabels = { en: 'Flip name', 'zh-CN': '翻转姓名', 'zh-TW': '翻轉姓名' };
    const buttons = Array.from(document.querySelectorAll('button[data-site-name]'));
    const labels = Array.from(document.querySelectorAll('[data-site-name-text]'));
    const hints = Array.from(document.querySelectorAll('[data-site-name-hint]'));
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const titlePrefix = document.title.includes(' · ') ? document.title.slice(0, document.title.lastIndexOf(' · ') + 3) : '';
    let language = document.documentElement.lang || 'en';
    let nameIndex = 0;
    let generation = 0;
    let flipping = false;
    let animations = [];

    function render() {
        const name = namesByLanguage[language][nameIndex];
        const hint = language === 'en' ? hintsByName[name] || '' : '';
        document.title = titlePrefix + name;
        labels.forEach(label => { label.textContent = name; });
        hints.forEach(label => {
            label.textContent = hint;
            label.hidden = !hint;
        });
        document.querySelectorAll('[data-site-name-alt]').forEach(image => { image.alt = name; });
        buttons.forEach(button => {
            button.setAttribute('aria-label', `${name} — ${flipLabels[language]}`);
            if (hint) button.setAttribute('aria-describedby', button.dataset.siteNameHintId);
            else button.removeAttribute('aria-describedby');
        });
    }

    function setLanguage(nextLanguage) {
        generation += 1;
        animations.forEach(animation => animation.cancel());
        animations = [];
        flipping = false;
        language = Object.hasOwn(namesByLanguage, nextLanguage) ? nextLanguage : 'en';
        nameIndex = 0;
        render();
    }

    async function flip() {
        if (flipping) return;
        if (reducedMotion.matches) {
            nameIndex = (nameIndex + 1) % namesByLanguage[language].length;
            render();
            return;
        }
        flipping = true;
        const currentGeneration = generation;
        try {
            animations = labels.map(label => label.animate([
                { transform: 'rotateX(0deg)', opacity: 1 },
                { transform: 'rotateX(90deg)', opacity: 0 }
            ], { duration: 180, easing: 'ease-in', fill: 'forwards' }));
            await Promise.all(animations.map(animation => animation.finished));
            if (generation !== currentGeneration) return;
            nameIndex = (nameIndex + 1) % namesByLanguage[language].length;
            render();
            animations.forEach(animation => animation.cancel());
            animations = labels.map(label => label.animate([
                { transform: 'rotateX(-90deg)', opacity: 0 },
                { transform: 'rotateX(0deg)', opacity: 1 }
            ], { duration: 240, easing: 'ease-out' }));
            await Promise.all(animations.map(animation => animation.finished));
        } catch (error) {
            if (error.name !== 'AbortError') throw error;
        } finally {
            if (generation === currentGeneration) {
                animations = [];
                flipping = false;
            }
        }
    }

    buttons.forEach(button => button.addEventListener('click', flip));
    window.SiteIdentity = { setLanguage };
    setLanguage(language);
})();
