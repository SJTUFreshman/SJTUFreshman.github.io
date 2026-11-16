(function () {
    'use strict';
    const BASE = 'assets/maps/regions/';
    const VERSION = '20261116-administrative-dual-v1';
    const cache = new Map();
    let active = null;
    let language = 'en';
    let terrainModule;
    const words = {
        en: { atlas: 'THE LIVING ATLAS', close: 'Return to map', loading: 'Unfolding the landscape…', failed: 'This landscape could not be loaded.', retry: 'Try again', places: 'Places to explore', about: 'LAND & CULTURE', source: 'Read more', hint: 'Explore a district or a photograph', borders: 'International boundary', division: 'Cultural groupings are an editorial guide; boundaries are approximate.', photo: 'Landscape reference', visited: 'On my route', discover: 'Beyond my route', reset: 'Whole region', noPhoto: 'Landscape photograph unavailable', credit: 'Image credit' },
        'zh-CN': { atlas: '山河之间 · 地域图志', close: '返回地图', loading: '正在展开这片山河…', failed: '暂时未能加载这片地形。', retry: '重试', places: '循迹而行', about: '山川与人文', source: '阅读百科', hint: '移至分区或照片，探索当地风景', borders: '国界', division: '文化分区为导览编排，边界采用近似范围。', photo: '当地景观', visited: '足迹所至', discover: '延伸探索', reset: '整个地区', noPhoto: '景观照片暂不可用', credit: '照片署名' },
        'zh-TW': { atlas: '山河之間 · 地域圖志', close: '返回地圖', loading: '正在展開這片山河…', failed: '暫時未能載入這片地形。', retry: '重試', places: '循跡而行', about: '山川與人文', source: '閱讀百科', hint: '移至分區或照片，探索當地風景', borders: '國界', division: '文化分區為導覽編排，邊界採用近似範圍。', photo: '當地景觀', visited: '足跡所至', discover: '延伸探索', reset: '整個地區', noPhoto: '景觀照片暫不可用', credit: '照片署名' }
    };
    const copy = () => words[language] || words.en;
    const adminCopy = () => ({
        en: { back: 'Back to cultural region', whole: 'Entire administrative area', urban: 'Urban core', explore: 'Explore this area', loading: 'Preparing two perspectives…', sights: 'Landmarks & landscapes', hint: 'Select a photograph to explore its story', territory: 'TERRITORY', settlement: 'SETTLEMENT', overview: 'Area overview' },
        'zh-CN': { back: '返回文化区', whole: '行政全域', urban: '主城区', explore: '走进这一地区', loading: '正在展开全域与主城…', sights: '地标与风景', hint: '点选照片，阅读这里的故事', territory: '山川全貌', settlement: '聚落近景', overview: '地区概览' },
        'zh-TW': { back: '返回文化區', whole: '行政全域', urban: '主城區', explore: '走進這一地區', loading: '正在展開全域與主城…', sights: '地標與風景', hint: '點選照片，閱讀這裡的故事', territory: '山川全貌', settlement: '聚落近景', overview: '地區概覽' }
    })[language] || { back: 'Back', whole: 'Entire area', urban: 'Urban core', explore: 'Explore', loading: 'Loading…', sights: 'Landmarks', hint: '', territory: 'TERRITORY', settlement: 'SETTLEMENT', overview: 'Overview' };
    // Presentation names only: never rewrite source URLs, geography IDs or the PRC name.
    const displayText = value => String(value || '')
        .replace(/中华民国/g, '中华台北').replace(/中華民國/g, '中華臺北')
        .replace(/\b(?:People['’]s\s+)?Republic\s+of\s+China\b(?:\s*\(R\.?O\.?C\.?\))?/gi,
            match => /^People/i.test(match) ? match : 'Chinese Taipei')
        .replace(/\bR\.?O\.?C\b\.?/g, 'Chinese Taipei');
    const local = value => displayText(typeof value === 'object' && value ? value[language] || value.en || value['zh-CN'] || '' : value);
    const titleOf = item => local(item?.title || item?.label || item?.name || item?.id);
    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text) element.textContent = text;
        return element;
    }
    function svg(tag, attributes) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
        Object.entries(attributes || {}).forEach(([key, value]) => element.setAttribute(key, value));
        return element;
    }
    function url(path) { return /^(https?:|assets\/)/.test(path || '') ? path : BASE + path; }
    function terrainURL(record) { return `${url(record.image)}?v=${VERSION}`; }
    function fetchJSON(path) {
        const src = url(path) + '?v=' + VERSION;
        if (!cache.has(src)) cache.set(src, fetch(src).then(response => {
            if (!response.ok) throw new Error(`Atlas HTTP ${response.status}`);
            return response.json();
        }).catch(error => { cache.delete(src); throw error; }));
        return cache.get(src);
    }
    async function resolveDetail(options) {
        const index = await fetchJSON('manifest.json');
        const map = options.map.replace('east-asia', 'east_asia').replace('euro-usa', 'europe_usa');
        const ids = [`${map}:${options.view}:${options.region.id}`, `${map}:${options.region.id}`, options.region.id];
        const records = index.regions || index;
        const record = ids.map(id => records[id]).find(Boolean);
        if (!record) throw new Error('Region has no published landscape');
        const [detail, content] = await Promise.all([
            typeof record === 'string' ? fetchJSON(record) : record.file ? fetchJSON(record.file) : Promise.resolve(record),
            fetchJSON(`content/${typeof record === 'string' ? record : record.file}`)
        ]);
        const entries = content.entries || {};
        const enrich = item => {
            const article = entries[item.content_id || item.id] || {};
            return { ...item, ...article, title: article.label || item.title || item.label };
        };
        Object.assign(detail, enrich(detail));
        detail.subregions = (detail.subregions || []).map(enrich);
        detail.places = (detail.places || []).map(enrich);
        detail.credits = detail.credits || index.credits || [];
        await new Promise((resolve, reject) => {
            const image = new Image();
            image.decoding = 'async';
            image.onload = () => image.decode().then(resolve, reject);
            image.onerror = () => reject(new Error('Regional terrain image unavailable'));
            image.src = terrainURL(detail);
        });
        return detail;
    }
    function photoOf(item) {
        const photo = item?.photo || item?.photos?.[0];
        return typeof photo === 'string' ? { src: photo } : photo;
    }
    function photoNode(item, className) {
        const frame = node('div', className);
        const photo = photoOf(item);
        if (photo?.src || photo?.image) {
            const image = node('img');
            image.src = url(photo.src || photo.image);
            image.alt = local(photo.alt) || titleOf(item);
            image.loading = 'lazy';
            image.decoding = 'async';
            image.addEventListener('error', () => { image.remove(); frame.append(node('span', 'region-photo-fallback', copy().noPhoto)); }, { once: true });
            frame.append(image);
        } else frame.append(node('span', 'region-photo-fallback', copy().noPhoto));
        return frame;
    }
    function disposeModels(session) {
        (session?.models || []).forEach(dispose => dispose());
        if (session) session.models = [];
    }
    function renderDetail(record) {
        if (!active) return;
        const session = active;
        disposeModels(session);
        const { dialog, content, options } = session;
        session.record = record;
        session.view = 'region';
        dialog.classList.remove('is-administrative');
        content.replaceChildren();
        dialog.classList.add('is-ready');
        session.title.textContent = titleOf(record) || titleOf(options.region);
        session.kicker.textContent = copy().atlas;
        session.close.textContent = `← ${copy().close}`;
        const layout = node('div', 'region-explorer-layout');
        const main = node('section', 'region-landscape');
        const mapHeader = node('div', 'region-landscape-header');
        const routeStatus = node('span', 'region-route-status');
        mapHeader.append(routeStatus, node('span', 'region-north', 'N ↑'));
        const canvas = node('div', 'region-landscape-canvas');
        const map = svg('svg', { viewBox: '0 0 1200 900', class: 'region-landscape-svg', role: 'group', 'aria-label': titleOf(record) });
        const width = record.width || 1200, height = record.height || 900;
        const fit = Math.min(780 / width, 700 / height);
        const mapWidth = width * fit, mapHeight = height * fit;
        const left = (1200 - mapWidth) / 2, top = (900 - mapHeight) / 2;
        const project = point => [left + Number(point?.[0] || 0) * fit, top + Number(point?.[1] || 0) * fit];
        const terrain = svg('g', { transform: `translate(${left} ${top}) scale(${fit})` });
        terrain.append(svg('image', { href: terrainURL(record), width, height, class: 'region-terrain-image' }));
        (record.inset_frames || []).forEach(frame => {
            terrain.append(svg('rect', { x: frame.x, y: frame.y, width: frame.width, height: frame.height,
                class: 'region-inset-frame', 'vector-effect': 'non-scaling-stroke' }));
            const label = node('span', 'region-inset-label');
            label.textContent = local(frame.title);
            const labelPoint = project([frame.x + 4, frame.y]);
            label.style.left = `${labelPoint[0] / 12}%`;
            label.style.top = `${labelPoint[1] / 9}%`;
            canvas.append(label);
        });
        const units = Array.isArray(record.subregions) ? record.subregions : [];
        const places = Array.isArray(record.places) ? record.places : [];
        const lineGroup = svg('g', { class: 'region-photo-leaders', 'aria-hidden': 'true' });
        const markerGroup = svg('g', { class: 'region-place-markers' });
        const aside = node('aside', 'region-fieldnotes');
        const tabs = node('div', 'region-district-tabs');
        tabs.setAttribute('aria-label', copy().places);
        const notes = node('div', 'region-note-content');
        notes.setAttribute('aria-live', 'polite');
        let selection = null;
        function choose(item) {
            if (selection === item) return;
            selection = item;
            session.selection = item;
            terrain.querySelectorAll('[data-unit]').forEach(path => path.classList.toggle('is-active', path.dataset.unit === item?.id));
            canvas.querySelectorAll('[data-place]').forEach(card => card.classList.toggle('is-active', card.dataset.place === item?.id));
            tabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.unit === (item?.id || ''))));
            notes.replaceChildren();
            const entry = item || record;
            const visit = item ? item.visited ?? units.find(unit => unit.id === item.id)?.visited : options.region.visited;
            routeStatus.textContent = visit === true ? copy().visited : visit === false ? copy().discover : copy().photo;
            const contentEntry = entry.content || entry;
            notes.append(node('p', 'region-note-eyebrow', copy().about), node('h3', 'region-note-title', titleOf(entry)));
            const photograph = photoOf(contentEntry) || photoOf(record);
            if (photograph) {
                notes.append(photoNode({ ...entry, photo: photograph }, 'region-note-photo'));
                const credit = node('p', 'region-photo-credit');
                credit.textContent = local(photograph.credit || photograph.author || copy().photo);
                if (photograph.source) {
                    const link = node('a', '', copy().credit);
                    link.href = photograph.source; link.target = '_blank'; link.rel = 'noopener noreferrer';
                    credit.append(' · ', link);
                }
                notes.append(credit);
            }
            const description = local(contentEntry.description || contentEntry.summary || record.description);
            if (description) notes.append(node('p', 'region-note-description', description));
            const cultural = contentEntry.textKind === 'editorial-cultural';
            const sources = cultural ? contentEntry.textSources || [] : [];
            const source = (language === 'en' && contentEntry.textSources?.find(value => value.includes('en.wikipedia.org'))) || contentEntry.source || contentEntry.wikipedia;
            if (source) {
                const sourceLabel = cultural ? language === 'en' ? 'Cultural sources' : language === 'zh-TW' ? '文化資料來源' : '文化资料来源' : copy().source;
                const link = node('a', 'region-note-source', `${sourceLabel} ↗`);
                link.href = typeof source === 'object' ? source.url : source;
                link.target = '_blank'; link.rel = 'noopener noreferrer'; notes.append(link);
                if (!cultural && contentEntry.textLicenseUrl) {
                    const attribution = node('p', 'region-text-credit');
                    const license = node('a', '', 'Wikipedia · CC BY-SA 4.0');
                    license.href = contentEntry.textLicenseUrl; license.target = '_blank'; license.rel = 'noopener noreferrer';
                    attribution.append(license, document.createTextNode(language === 'en' ? ' · adapted excerpt' : language === 'zh-TW' ? ' · 節錄與繁簡轉換' : ' · 节录与繁简转换'));
                    notes.append(attribution);
                }
                if (cultural && sources.length > 1) {
                    const references = node('p', 'region-text-credit');
                    sources.filter(value => value !== link.href).forEach((value, index) => {
                        const reference = node('a', '', `${language === 'en' ? 'Reference' : language === 'zh-TW' ? '資料' : '资料'} ${index + 2}`);
                        reference.href = value; reference.target = '_blank'; reference.rel = 'noopener noreferrer';
                        if (references.childNodes.length) references.append(' · ');
                        references.append(reference);
                    });
                    notes.append(references);
                }
            }
        }
        function itemAt(target) {
            const element = target instanceof Element ? target.closest('[data-unit], [data-place]') : null;
            return element?.dataset.place ? places.find(place => place.id === element.dataset.place)
                : units.find(unit => unit.id === element?.dataset.unit) || null;
        }
        function restoreOnLeave(event) {
            // Touch selections stay open for reading; mouse/pen previews follow their location.
            if (event.pointerType !== 'touch') choose(itemAt(event.relatedTarget));
        }
        function tab(item) {
            const button = node('button', '', item ? titleOf(item) : copy().reset);
            button.type = 'button'; button.dataset.unit = item?.id || '';
            button.addEventListener('click', () => item && record.mode === 'cultural' ? openAdministrative(item, record) : choose(item));
            tabs.append(button);
        }
        tab(null);
        units.forEach(unit => {
            const path = svg('path', { d: unit.path, class: 'region-district', 'data-unit': unit.id,
                tabindex: 0, role: 'button', 'aria-label': titleOf(unit), 'vector-effect': 'non-scaling-stroke', 'fill-rule': 'evenodd' });
            path.addEventListener('pointerenter', () => choose(unit));
            path.addEventListener('pointerleave', restoreOnLeave);
            path.addEventListener('focus', () => choose(unit));
            path.addEventListener('blur', event => choose(itemAt(event.relatedTarget)));
            const enter = () => record.mode === 'cultural' ? openAdministrative(unit, record) : choose(unit);
            path.addEventListener('click', enter);
            path.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); enter(); } });
            terrain.append(path); tab(unit);
        });
        (record.borders || []).forEach(border => terrain.append(svg('path', { d: typeof border === 'string' ? border : border.path,
            class: `region-country-border${border.kind === 'disputed' ? ' is-disputed' : ''}`, 'vector-effect': 'non-scaling-stroke' })));
        map.append(terrain, lineGroup, markerGroup);
        canvas.append(map);
        // Photo cards sit in the margins; their leaders are in the same responsive coordinate system.
        // Keep a key place, then spread the remaining windows over the landscape.
        const selectedPlaces = places.length ? [places[0]] : [];
        while (selectedPlaces.length < Math.min(4, places.length)) {
            const candidates = places.filter(place => !selectedPlaces.includes(place));
            const distance = place => Math.min(...selectedPlaces.map(selected => Math.hypot(
                (place.point || place.center)[0] - (selected.point || selected.center)[0],
                (place.point || place.center)[1] - (selected.point || selected.center)[1])));
            candidates.sort((a, b) => distance(b) - distance(a));
            selectedPlaces.push(candidates[0]);
        }
        selectedPlaces.sort((a, b) => (a.point || a.center)[0] - (b.point || b.center)[0]);
        const half = Math.ceil(selectedPlaces.length / 2);
        const placed = [selectedPlaces.slice(0, half), selectedPlaces.slice(half)].flatMap((list, side) =>
            list.sort((a, b) => (a.point || a.center)[1] - (b.point || b.center)[1]).map((place, row) => ({ place, side, row })));
        placed.forEach(({ place, side, row }) => {
            const x = side ? 990 : 20, y = row ? 590 : 110;
            const point = project(place.point || place.center);
            const end = [side ? x : x + 190, y + 80];
            const elbow = [side ? 940 : 260, end[1]];
            lineGroup.append(svg('path', { d: `M${point.join(',')} L${elbow.join(',')} L${end.join(',')}` }));
            markerGroup.append(svg('circle', { cx: point[0], cy: point[1], r: 5 }));
            const card = node('button', 'region-photo-card');
            card.type = 'button'; card.dataset.place = place.id;
            card.dataset.side = side ? 'right' : 'left';
            card.style.left = `${x / 12}%`; card.style.top = `${y / 9}%`;
            card.setAttribute('aria-label', titleOf(place));
            card.append(photoNode(place, 'region-card-image'), node('span', 'region-card-caption', titleOf(place)));
            const select = () => choose(place);
            card.addEventListener('pointerenter', select); card.addEventListener('focus', select); card.addEventListener('click', select);
            card.addEventListener('pointerleave', restoreOnLeave);
            card.addEventListener('blur', event => choose(itemAt(event.relatedTarget)));
            canvas.append(card);
        });
        canvas.addEventListener('pointermove', event => {
            if (event.pointerType !== 'touch') choose(itemAt(event.target));
        });
        canvas.addEventListener('click', event => {
            if (!itemAt(event.target)) choose(null);
        });
        const footer = node('div', 'region-landscape-footer');
        const hint = record.mode === 'cultural' ? local({ en: 'Hover to discover · Click an area to explore its landscape', 'zh-CN': '悬停看简介 · 点击行政区，深入全域与主城', 'zh-TW': '懸停看簡介 · 點擊行政區，深入全域與主城' }) : copy().hint;
        footer.append(node('span', 'region-explore-hint', hint));
        if (record.borders?.length) footer.append(node('span', 'region-border-key', copy().borders));
        if (record.borders?.some(border => border.kind === 'disputed')) {
            footer.append(node('span', 'region-border-key is-disputed', language === 'en' ? 'Disputed / control line' : language === 'zh-TW' ? '爭議／控制線' : '争议／控制线'));
        }
        main.append(mapHeader, canvas, footer);
        aside.append(notes, node('h4', 'region-places-title', copy().places), tabs);
        layout.append(main, aside);
        content.append(layout);
        const caption = node('p', 'region-explorer-caption', local(record.note) || copy().division);
        content.append(caption);
        if (record.credits.length) {
            const credits = node('details', 'region-data-credits');
            credits.append(node('summary', '', language === 'en' ? 'Map & imagery sources' : language === 'zh-TW' ? '地形與影像來源' : '地形与影像来源'));
            record.credits.forEach(credit => {
                const link = node('a', '', credit.name);
                link.href = credit.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; credits.append(link);
            });
            content.append(credits);
        }
        // Force first rendering, including the whole-region introduction.
        selection = undefined;
        choose(null);
    }
    async function openAdministrative(unit, parent) {
        const session = active;
        if (!session) return;
        const request = session.request = (session.request || 0) + 1;
        session.parent = parent;
        session.unit = unit;
        session.view = 'admin-loading';
        session.title.textContent = titleOf(unit);
        session.close.textContent = `← ${adminCopy().back}`;
        session.content.replaceChildren(node('p', 'region-load-status', adminCopy().loading));
        session.content.setAttribute('aria-busy', 'true');
        session.content.scrollTop = 0;
        session.close.focus({ preventScroll: true });
        try {
            const index = await fetchJSON('assets/maps/administrative/manifest.json');
            const entry = index.units[unit.id];
            if (!entry) throw new Error(`Administrative landscape missing: ${unit.id}`);
            const detail = await fetchJSON(entry.file || entry);
            const article = await fetchJSON(detail.content_file);
            const entries = article.entries || Object.fromEntries([article, ...(article.places || [])].map(item => [item.id, item]));
            const enrich = item => ({ ...item, ...(entries[item.id] || {}), title: entries[item.id]?.label || item.title || item.label });
            const result = { ...detail, ...enrich(entries[unit.id] || article), id: detail.id, views: detail.views,
                urbanFocus: article.urbanFocus || entries[unit.id]?.urbanFocus || detail.urbanFocus,
                credits: detail.credits || index.credits || [] };
            Object.values(result.views).forEach(view => { view.places = (view.places || []).map(enrich); });
            await Promise.all(Object.values(result.views).map(view => new Promise((resolve, reject) => {
                const img = new Image(); img.onload = () => img.decode().then(resolve, reject);
                img.onerror = reject; img.src = terrainURL(view);
            })));
            if (active !== session || session.request !== request || !session.dialog.open) return;
            session.administrative = result;
            renderAdministrative(result);
        } catch (error) {
            if (active !== session || session.request !== request) return;
            const retry = node('button', 'region-load-retry', copy().retry);
            retry.type = 'button'; retry.addEventListener('click', () => openAdministrative(unit, parent));
            session.content.replaceChildren(node('p', 'region-load-status', copy().failed), retry);
            console.warn('Administrative atlas:', error);
        } finally {
            if (active === session && session.request === request) session.content.setAttribute('aria-busy', 'false');
        }
    }
    function returnToParent() {
        const session = active;
        if (!session?.parent) return;
        session.request = (session.request || 0) + 1;
        const id = session.unit?.id;
        renderDetail(session.parent);
        session.content.setAttribute('aria-busy', 'false');
        session.content.scrollTop = 0;
        const trigger = [...session.content.querySelectorAll('.region-district-tabs button')].find(button => button.dataset.unit === id);
        (trigger || session.close).focus({ preventScroll: true });
    }
    function renderAdministrative(record) {
        const session = active;
        if (!session) return;
        disposeModels(session);
        session.view = 'administrative';
        session.dialog.classList.add('is-ready', 'is-administrative');
        session.title.textContent = titleOf(record);
        session.kicker.textContent = `${titleOf(session.parent)} / ${adminCopy().overview}`;
        session.close.textContent = `← ${adminCopy().back}`;
        const content = session.content;
        content.replaceChildren();
        const layout = node('div', 'admin-explorer-layout');
        const landscapes = node('section', 'admin-landscapes');
        const aside = node('aside', 'region-fieldnotes admin-fieldnotes');
        const notes = node('div', 'admin-note-content');
        notes.setAttribute('aria-live', 'polite');
        const allPlaces = [...new Map(Object.values(record.views).flatMap(view => view.places || []).map(place => [place.id, place])).values()];
        const reset = node('button', 'admin-overview-button', adminCopy().overview);
        reset.type = 'button'; reset.addEventListener('click', () => choose(null));
        aside.append(reset, notes);
        let selected;
        function choose(place) {
            if (selected === place) return;
            selected = place;
            const item = place || record;
            notes.replaceChildren(node('p', 'region-note-eyebrow', place ? adminCopy().sights : copy().about), node('h3', 'region-note-title', titleOf(item)));
            if (photoOf(item)) {
                notes.append(photoNode(item, 'region-note-photo'));
                const photo = photoOf(item);
                const credit = node('p', 'region-photo-credit', local(photo.credit || photo.author));
                if (photo.source) {
                    const link = node('a', '', copy().credit); link.href = photo.source; link.target = '_blank'; link.rel = 'noopener noreferrer';
                    credit.append(' · ', link);
                }
                notes.append(credit);
            }
            notes.append(node('p', 'region-note-description', local(item.description || item.summary)));
            const source = (language === 'en' && item.textSources?.find(value => value.includes('en.wikipedia.org'))) || item.source || item.wikipedia;
            if (source) {
                const sourceLabel = item.textKind === 'editorial-locality' ? local({ en: 'Image sources', 'zh-CN': '影像资料', 'zh-TW': '影像資料' }) : copy().source;
                const link = node('a', 'region-note-source', `${sourceLabel} ↗`);
                link.href = typeof source === 'object' ? source.url : source; link.target = '_blank'; link.rel = 'noopener noreferrer'; notes.append(link);
            }
            if (item.textLicenseUrl) {
                const credit = node('a', 'region-text-credit', 'Wikipedia · CC BY-SA 4.0');
                credit.href = item.textLicenseUrl; credit.target = '_blank'; credit.rel = 'noopener noreferrer'; notes.append(credit);
            }
            content.querySelectorAll('[data-admin-place]').forEach(element => {
                const chosen = element.dataset.adminPlace === place?.id;
                element.classList.toggle('is-active', chosen);
                if (element.tagName.toLowerCase() === 'button') element.setAttribute('aria-pressed', String(chosen));
            });
            reset.setAttribute('aria-pressed', String(!place));
        }
        function readPlace(place) {
            choose(place);
            if (window.matchMedia('(max-width: 850px)').matches || notes.getBoundingClientRect().top < content.getBoundingClientRect().top) {
                notes.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
            }
        }
        for (const [key, view] of Object.entries(record.views)) {
            const panel = node('section', 'admin-model-panel'); panel.dataset.adminView = key;
            const header = node('header', 'admin-model-header');
            const heading = node('div');
            const focus = record.urbanFocus || {};
            const special = key === 'urban' && ['settlement', 'principal-settlement', 'island-detail', 'administrative-seat', 'administrative-seat-outside-display-outline'].includes(focus.kind);
            const viewTitle = key === 'whole' ? local(view.title) || adminCopy().whole : special ? local(view.title || focus.label) : adminCopy().urban;
            heading.append(node('p', 'region-note-eyebrow', key === 'whole' ? adminCopy().territory : adminCopy().settlement), node('h3', '', viewTitle));
            header.append(heading, node('span', 'region-north', 'N ↑'));
            const stage = node('div', 'admin-model-stage');
            const map = svg('svg', { viewBox: '0 0 1000 1000', class: 'admin-model-svg', role: 'img', 'aria-label': `${titleOf(record)} · ${viewTitle}` });
            const w = view.width || 1280, h = view.height || 1000;
            const scale = Math.min(900 / w, 650 / h), x = (1000 - w * scale) / 2, y = 24 + (650 - h * scale) / 2;
            const point = p => [x + p[0] * scale, y + p[1] * scale];
            map.append(svg('image', { href: terrainURL(view), x, y, width: w * scale, height: h * scale, class: 'region-terrain-image' }));
            (view.inset_frames || []).forEach((frame, index) => {
                const [fx, fy] = point([frame.x, frame.y]);
                map.append(svg('rect', { x: fx, y: fy, width: frame.width * scale, height: frame.height * scale, class: 'region-inset-frame' }));
                const label = svg('text', { x: fx + 4, y: fy - 7, class: 'admin-inset-label' });
                label.textContent = String(index + 1); map.append(label);
            });
            (view.guide_points || []).forEach(item => {
                const [gx, gy] = point(item.point);
                map.append(svg('circle', { cx: gx, cy: gy, r: 9, class: 'admin-place-dot admin-guide-point' }));
                const label = svg('text', { x: gx + 13, y: gy + 7, class: 'admin-inset-label' });
                label.textContent = String(item.index); map.append(label);
            });
            (view.borders || []).forEach(border => map.append(svg('path', { d: border.path || border, transform: `translate(${x} ${y}) scale(${scale})`, class: `region-country-border${border.kind === 'disputed' ? ' is-disputed' : ''}`, 'vector-effect': 'non-scaling-stroke' })));
            const places = (view.places || []).filter(place => Array.isArray(place.point));
            const shown = places.slice(0, 2).sort((a, b) => a.point[0] - b.point[0]);
            const leaders = [];
            function showCards(items) {
                leaders.forEach(({ line, dot, card }) => { line.remove(); dot.remove(); card.remove(); }); leaders.length = 0;
                items.forEach((place, index) => {
                const anchor = point(place.point || [w / 2, h / 2]), cx = items.length === 1 ? 500 : index ? 760 : 240;
                const line = svg('path', { d: `M${anchor.join(',')} L${cx},710 L${cx},752`, class: 'admin-photo-leader', 'data-admin-place': place.id });
                const dot = svg('circle', { cx: anchor[0], cy: anchor[1], r: 7, class: 'admin-place-dot', 'data-admin-place': place.id });
                map.append(line, dot);
                const card = node('button', 'admin-map-photo'); card.type = 'button'; card.dataset.adminPlace = place.id;
                card.style.left = `${cx / 10}%`; card.setAttribute('aria-label', titleOf(place));
                card.append(photoNode(place, 'admin-map-photo-image'), node('span', '', titleOf(place)));
                card.addEventListener('click', () => readPlace(place)); card.addEventListener('pointerenter', () => choose(place)); card.addEventListener('focus', () => choose(place));
                stage.append(card); leaders.push({ place, line, dot, card, cx, anchor });
                });
            }
            showCards(shown);
            stage.prepend(map);
            panel.append(header, stage);
            if (view.mesh?.file) {
                const labels = {
                    show: local({ en: 'Rotate terrain', 'zh-CN': '旋转地形', 'zh-TW': '旋轉地形' }),
                    flat: local({ en: 'Map view', 'zh-CN': '平面导览', 'zh-TW': '平面導覽' }),
                    help: local({ en: 'Drag or use arrow keys to rotate · + / − to zoom', 'zh-CN': '拖动或用方向键旋转 · ＋ / − 缩放', 'zh-TW': '拖動或用方向鍵旋轉 · ＋ / − 縮放' }),
                    failed: local({ en: '3D is unavailable here; the relief map remains available.', 'zh-CN': '暂时无法显示立体模型，可继续浏览浮雕地图。', 'zh-TW': '暫時無法顯示立體模型，可繼續瀏覽浮雕地圖。' }),
                    reset: local({ en: 'Reset angle', 'zh-CN': '复位', 'zh-TW': '復位' })
                };
                const toggle = node('button', 'admin-model-toggle', labels.show); toggle.type = 'button'; toggle.setAttribute('aria-pressed', 'false');
                const controls = node('div', 'admin-model-controls'); controls.hidden = true;
                const hint = node('p', 'admin-model-help', labels.help); hint.hidden = true; hint.setAttribute('role', 'status');
                const resetAngle = node('button', '', labels.reset); resetAngle.type = 'button';
                const smaller = node('button', '', '−'); smaller.type = 'button'; smaller.setAttribute('aria-label', local({ en: 'Zoom out', 'zh-CN': '缩小', 'zh-TW': '縮小' }));
                const larger = node('button', '', '+'); larger.type = 'button'; larger.setAttribute('aria-label', local({ en: 'Zoom in', 'zh-CN': '放大', 'zh-TW': '放大' }));
                controls.append(resetAngle, smaller, larger);
                const mainTitle = view.insets?.length && record.id !== '460300'
                    ? { en: 'Main landmass', 'zh-CN': '主体地形', 'zh-TW': '主體地形' }
                    : { en: 'Entire view', 'zh-CN': '全景', 'zh-TW': '全景' };
                const parts = [{ ...view.mesh, title: mainTitle },
                    ...(view.mesh.parts || (view.insets || []).filter(inset => inset.mesh?.file).map(inset => ({ ...inset.mesh, title: inset.title })))];
                let select;
                if (parts.length > 1) {
                    select = node('select', 'admin-model-part'); select.setAttribute('aria-label', local({ en: 'Island close-up', 'zh-CN': '离岛近景', 'zh-TW': '離島近景' }));
                    parts.forEach((part, index) => { const option = node('option', '', local(part.title)); option.value = index; select.append(option); });
                    controls.append(select);
                }
                header.append(toggle); panel.insertBefore(controls, stage); panel.append(hint);
                let controller, canvas, showing = false, generation = 0, retired = false;
                function restoreLines() {
                    leaders.forEach(({ line, dot, anchor, cx }) => {
                        line.removeAttribute('visibility'); dot.removeAttribute('visibility');
                        line.setAttribute('d', `M${anchor.join(',')} L${cx},710 L${cx},752`);
                        dot.setAttribute('cx', anchor[0]); dot.setAttribute('cy', anchor[1]);
                    });
                }
                function stop() {
                    generation++; controller?.dispose(); controller = null; canvas?.remove(); canvas = null;
                    showing = false; stage.classList.remove('is-model'); panel.classList.remove('is-model');
                    controls.hidden = true; hint.hidden = true; toggle.disabled = false; toggle.textContent = labels.show; toggle.setAttribute('aria-pressed', 'false'); showCards(shown); restoreLines();
                }
                async function start(part) {
                    const token = ++generation;
                    controller?.dispose(); controller = null; canvas?.remove();
                    canvas = node('canvas', 'admin-terrain-canvas'); canvas.tabIndex = 0;
                    const target = canvas;
                    target.setAttribute('aria-label', `${titleOf(record)} · ${viewTitle} · ${labels.help}`);
                    Object.assign(target.style, { left: `${x / 10}%`, top: `${y / 10}%`, width: `${w * scale / 10}%`, height: `${h * scale / 10}%` });
                    stage.append(target); toggle.disabled = true; toggle.textContent = copy().loading;
                    hint.textContent = copy().loading; hint.hidden = false;
                    try {
                        if (!terrainModule) terrainModule = import(`./24-terrain-model.mjs?v=${VERSION}`).catch(error => { terrainModule = null; throw error; });
                        const module = await terrainModule;
                        if (retired || token !== generation || !target.isConnected) return;
                        showCards(allPlaces.filter(place => part.points?.[place.id]).slice(0, 2));
                        const model = await module.mountTerrain(target, `${part.file}?v=${VERSION}`, {
                            onProject(project) {
                                leaders.forEach(({ place, line, dot, cx }) => {
                                    const position = part.points?.[place.id];
                                    if (!position) { line.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); return; }
                                    const p = project(position), px = x + p[0] * w * scale, py = y + p[1] * h * scale;
                                    line.removeAttribute('visibility'); dot.removeAttribute('visibility');
                                    line.setAttribute('d', `M${px},${py} L${cx},710 L${cx},752`); dot.setAttribute('cx', px); dot.setAttribute('cy', py);
                                });
                            },
                            onError() { if (!retired && token === generation) { stop(); hint.textContent = labels.failed; hint.hidden = false; } }
                        });
                        if (retired || token !== generation || !target.isConnected) { model.dispose(); return; }
                        controller = model; showing = true; stage.classList.add('is-model'); panel.classList.add('is-model');
                        controls.hidden = false; hint.textContent = labels.help; hint.hidden = false;
                        toggle.textContent = labels.flat; toggle.setAttribute('aria-pressed', 'true'); target.focus({ preventScroll: true });
                    } catch (error) {
                        if (!retired && token === generation) { stop(); hint.textContent = labels.failed; hint.hidden = false; }
                    } finally { if (!retired && token === generation) toggle.disabled = false; }
                }
                toggle.addEventListener('click', () => showing ? stop() : start(parts[Number(select?.value || 0)]));
                select?.addEventListener('change', () => start(parts[Number(select.value)]));
                resetAngle.addEventListener('click', () => controller?.reset()); smaller.addEventListener('click', () => controller?.zoomBy(-.1)); larger.addEventListener('click', () => controller?.zoomBy(.1));
                session.models.push(() => { retired = true; stop(); });
            }
            if (view.inset_frames?.length) {
                const legend = node('ol', 'admin-inset-key');
                view.inset_frames.forEach(frame => {
                    const item = node('li', '', local(frame.title));
                    if (frame.note) item.append(node('small', '', local(frame.note)));
                    legend.append(item);
                });
                panel.append(legend);
            }
            const definition = key === 'urban' ? focus.definition || view.description : view.description;
            if (definition) panel.append(node('p', 'admin-model-definition', local(definition)));
            landscapes.append(panel);
        }
        const gallery = node('section', 'admin-sights');
        gallery.append(node('h3', '', adminCopy().sights), node('p', '', adminCopy().hint));
        const photos = node('div', 'admin-sights-grid');
        const gallerySources = new Set();
        allPlaces.forEach(place => {
            const photo = photoOf(place);
            const photoKey = photo?.source || photo?.src?.split('/').pop() || place.id;
            if (gallerySources.has(photoKey)) return;
            gallerySources.add(photoKey);
            const card = node('button', 'admin-sight-card'); card.type = 'button'; card.dataset.adminPlace = place.id;
            card.append(photoNode(place, 'admin-sight-image'), node('span', '', titleOf(place)));
            card.addEventListener('click', () => readPlace(place)); card.addEventListener('focus', () => choose(place));
            photos.append(card);
        });
        gallery.append(photos);
        const main = node('div', 'admin-explorer-main'); main.append(landscapes, gallery);
        layout.append(main, aside); content.append(layout);
        const credits = node('details', 'region-data-credits admin-data-credits');
        credits.append(node('summary', '', local({ en: 'Terrain & map sources', 'zh-CN': '地形与地图来源', 'zh-TW': '地形與地圖來源' })));
        (record.credits || []).forEach(source => {
            const link = node('a', '', source.name); link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; credits.append(link);
        });
        content.append(credits);
        if ((record.credits || []).some(source => /openstreetmap/i.test(source.url))) {
            const attribution = node('a', 'admin-osm-credit', '© OpenStreetMap contributors');
            attribution.href = 'https://www.openstreetmap.org/copyright'; attribution.target = '_blank'; attribution.rel = 'noopener noreferrer'; content.append(attribution);
        }
        choose(null);
    }
    async function open(options) {
        if (active) active.dialog.close();
        language = options.language || language;
        const dialog = node('dialog', 'region-explorer');
        const header = node('header', 'region-explorer-header');
        const heading = node('div');
        const kicker = node('p', 'region-explorer-kicker', copy().atlas);
        const title = node('h2', 'region-explorer-title', titleOf(options.region));
        title.id = 'region-explorer-title';
        dialog.setAttribute('aria-labelledby', title.id);
        heading.append(kicker, title);
        const close = node('button', 'region-explorer-close', `← ${copy().close}`);
        close.type = 'button'; close.addEventListener('click', () => active === session && session.view !== 'region' && session.parent ? returnToParent() : dialog.close());
        header.append(heading, close);
        const content = node('div', 'region-explorer-content');
        dialog.append(header, content);
        const session = { dialog, content, options, title, kicker, close };
        active = session;
        dialog.addEventListener('cancel', event => {
            if (session.parent && session.view !== 'region') { event.preventDefault(); returnToParent(); }
        });
        dialog.addEventListener('keydown', event => event.stopPropagation());
        dialog.addEventListener('close', () => {
            disposeModels(session);
            dialog.remove(); if (active === session) active = null;
            if (options.trigger?.isConnected) options.trigger.focus({ preventScroll: true });
        }, { once: true });
        document.body.append(dialog); dialog.showModal(); close.focus();
        async function load() {
            content.replaceChildren(node('p', 'region-load-status', copy().loading));
            content.setAttribute('aria-busy', 'true');
            try {
                const record = await resolveDetail(options);
                if (active === session && dialog.open) renderDetail(record);
            } catch (error) {
                if (active !== session) return;
                const retry = node('button', 'region-load-retry', copy().retry);
                retry.type = 'button'; retry.addEventListener('click', load);
                content.replaceChildren(node('p', 'region-load-status', copy().failed), retry);
                console.warn('Region atlas:', error);
            } finally { content.setAttribute('aria-busy', 'false'); }
        }
        await load();
    }
    window.footprintsRegions = { open, updateLanguage(value) { language = value; if (active?.view === 'administrative') renderAdministrative(active.administrative); else if (active?.record && active.view === 'region') renderDetail(active.record); } };
})();
