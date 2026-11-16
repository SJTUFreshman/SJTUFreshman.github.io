(function () {
    'use strict';
    const BASE = 'assets/maps/regions/';
    const VERSION = '20261116-cultural-regions-v2';
    const cache = new Map();
    let active = null;
    let language = 'en';
    const words = {
        en: { atlas: 'THE LIVING ATLAS', close: 'Return to map', loading: 'Unfolding the landscape…', failed: 'This landscape could not be loaded.', retry: 'Try again', places: 'Places to explore', about: 'LAND & CULTURE', source: 'Read more', hint: 'Explore a district or a photograph', borders: 'International boundary', division: 'Cultural groupings are an editorial guide; boundaries are approximate.', photo: 'Landscape reference', visited: 'On my route', discover: 'Beyond my route', reset: 'Whole region', noPhoto: 'Landscape photograph unavailable', credit: 'Image credit' },
        'zh-CN': { atlas: '山河之间 · 地域图志', close: '返回地图', loading: '正在展开这片山河…', failed: '暂时未能加载这片地形。', retry: '重试', places: '循迹而行', about: '山川与人文', source: '阅读百科', hint: '移至分区或照片，探索当地风景', borders: '国界', division: '文化分区为导览编排，边界采用近似范围。', photo: '当地景观', visited: '足迹所至', discover: '延伸探索', reset: '整个地区', noPhoto: '景观照片暂不可用', credit: '照片署名' },
        'zh-TW': { atlas: '山河之間 · 地域圖志', close: '返回地圖', loading: '正在展開這片山河…', failed: '暫時未能載入這片地形。', retry: '重試', places: '循跡而行', about: '山川與人文', source: '閱讀百科', hint: '移至分區或照片，探索當地風景', borders: '國界', division: '文化分區為導覽編排，邊界採用近似範圍。', photo: '當地景觀', visited: '足跡所至', discover: '延伸探索', reset: '整個地區', noPhoto: '景觀照片暫不可用', credit: '照片署名' }
    };
    const copy = () => words[language] || words.en;
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
    function renderDetail(record) {
        if (!active) return;
        const session = active;
        const { dialog, content, options } = session;
        session.record = record;
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
            button.addEventListener('click', () => choose(item));
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
            path.addEventListener('click', () => choose(unit));
            path.addEventListener('keydown', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); choose(unit); } });
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
        footer.append(node('span', 'region-explore-hint', copy().hint));
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
        close.type = 'button'; close.addEventListener('click', () => dialog.close());
        header.append(heading, close);
        const content = node('div', 'region-explorer-content');
        dialog.append(header, content);
        const session = { dialog, content, options, title, kicker, close };
        active = session;
        dialog.addEventListener('keydown', event => event.stopPropagation());
        dialog.addEventListener('close', () => {
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
    window.footprintsRegions = { open, updateLanguage(value) { language = value; if (active?.record) renderDetail(active.record); } };
})();
