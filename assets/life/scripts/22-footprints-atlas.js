(function () {
    'use strict';

    const ATLAS_VERSION = '20261010-relief-hd2';
    const ATLAS_URL = `assets/maps/relief/atlas.json?v=${ATLAS_VERSION}`;
    const MAP_DEFINITIONS = [
        {
            id: 'china',
            keys: ['china'],
            title: { en: 'China', 'zh-CN': '中国', 'zh-TW': '中國' },
            label: {
                en: 'Cities and routes visited in China',
                'zh-CN': '中国到访城市与足迹线路',
                'zh-TW': '中國到訪城市與足跡路線'
            }
        },
        {
            id: 'east-asia',
            keys: ['east_asia', 'east-asia', 'eastAsia'],
            title: { en: 'East Asia', 'zh-CN': '东亚', 'zh-TW': '東亞' },
            label: {
                en: 'Visited places in East Asia',
                'zh-CN': '东亚到访地点',
                'zh-TW': '東亞到訪地點'
            }
        },
        {
            id: 'euro-usa',
            keys: ['euro_usa', 'europe_usa', 'euro-usa', 'euroUsa'],
            title: { en: 'Europe + USA', 'zh-CN': '欧洲与美国', 'zh-TW': '歐洲與美國' },
            label: {
                en: 'Visited places in Europe and the United States',
                'zh-CN': '欧洲与美国到访地点',
                'zh-TW': '歐洲與美國到訪地點'
            }
        }
    ];

    const copy = {
        en: {
            zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset map',
            expand: 'View large map', close: 'Close large map', actual: 'Original resolution',
            visited: 'Visited terrain', unvisited: 'Unvisited', corridor: 'Journey corridors',
            count: '{count} places · rail & road', pending: 'Places yet to explore',
            unavailable: 'Map unavailable', mapLoading: 'Loading map',
            retry: 'Retry', controls: 'Map controls', route: 'Footprint route',
            rail: 'Rail journey', road: 'Road journey',
            hint: 'Ctrl + scroll or pinch to zoom · drag to explore · double-click to zoom',
            keyboard: 'Arrow keys to pan, plus and minus to zoom, 0 to reset.'
        },
        'zh-CN': {
            zoomIn: '放大地图', zoomOut: '缩小地图', reset: '重置地图',
            expand: '查看大图', close: '关闭大图', actual: '原始分辨率',
            visited: '到访地形', unvisited: '未到访', corridor: '沿途足迹',
            count: '{count} 座城市 · 铁路与自驾', pending: '留待未来点亮',
            unavailable: '地图暂不可用', mapLoading: '正在加载地图',
            retry: '重新加载', controls: '地图控制', route: '足迹线路',
            rail: '铁路旅程', road: '自驾旅程',
            hint: 'Ctrl + 滚轮或双指缩放 · 拖动查看 · 双击放大',
            keyboard: '方向键平移，加减键缩放，0 重置。'
        },
        'zh-TW': {
            zoomIn: '放大地圖', zoomOut: '縮小地圖', reset: '重置地圖',
            expand: '查看大圖', close: '關閉大圖', actual: '原始解析度',
            visited: '到訪地形', unvisited: '未到訪', corridor: '沿途足跡',
            count: '{count} 座城市 · 鐵路與自駕', pending: '留待未來點亮',
            unavailable: '地圖暫不可用', mapLoading: '正在載入地圖',
            retry: '重新載入', controls: '地圖控制', route: '足跡路線',
            rail: '鐵路旅程', road: '自駕旅程',
            hint: 'Ctrl + 滾輪或雙指縮放 · 拖動查看 · 雙擊放大',
            keyboard: '方向鍵平移，加減鍵縮放，0 重設。'
        }
    };

    let atlasPromise = null;
    let atlas = null;
    let root = null;
    let currentLanguage = 'en';
    const instances = new Map();

    function currentCopy() {
        return copy[currentLanguage] || copy.en;
    }

    function mapDefinition(id) {
        return MAP_DEFINITIONS.find(definition => definition.id === id) || MAP_DEFINITIONS[0];
    }

    function mapData(definition) {
        if (!atlas?.maps) return null;
        return definition.keys.map(key => atlas.maps[key]).find(Boolean) || null;
    }

    function localized(value) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value[currentLanguage] || value.en || value['zh-CN'] || value['zh-TW'] || Object.values(value)[0] || '';
        }
        return value == null ? '' : String(value);
    }

    function nameOf(item) {
        return localized(item?.label || item?.name || item?.title || item?.id);
    }

    function normaliseId(value) {
        return String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    }

    function geometryPath(geometry) {
        if (!geometry) return '';
        if (typeof geometry === 'string') return geometry;
        if (geometry.type === 'Feature' && geometry.geometry) return geometryPath(geometry.geometry);
        if (geometry.d) return String(geometry.d);
        const coordinates = geometry.coordinates || geometry.points || geometry.path || geometry.paths;
        if (!Array.isArray(coordinates)) return '';
        const rings = geometry.type === 'MultiPolygon'
            ? coordinates.flat(1)
            : geometry.type === 'Polygon'
                ? coordinates
                : [coordinates];
        return rings.map(ring => {
            if (!Array.isArray(ring) || ring.length < 2) return '';
            const points = ring.map(point => Array.isArray(point) ? point : [point.x, point.y]);
            if (!points.every(point => Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))) return '';
            return `M ${points.map(point => `${Number(point[0])} ${Number(point[1])}`).join(' L ')} Z`;
        }).filter(Boolean).join(' ');
    }

    function centerOf(item, path) {
        const center = item?.center || item?.centroid || item?.point;
        if (Array.isArray(center) && center.length >= 2) return [Number(center[0]), Number(center[1])];
        if (center && Number.isFinite(Number(center.x)) && Number.isFinite(Number(center.y))) {
            return [Number(center.x), Number(center.y)];
        }
        const values = path?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
        if (values.length < 2) return [0, 0];
        let totalX = 0;
        let totalY = 0;
        let count = 0;
        for (let index = 0; index + 1 < values.length; index += 2) {
            totalX += values[index];
            totalY += values[index + 1];
            count += 1;
        }
        return count ? [totalX / count, totalY / count] : [0, 0];
    }

    function svgElement(name, attributes = {}) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', name);
        Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
        return element;
    }

    function imageUrl(image) {
        if (!image) return '';
        if (/^(?:data:|https?:|\/)/i.test(image)) return image;
        const source = image.startsWith('assets/') ? image : `assets/maps/relief/${image}`;
        return `${source}?v=${ATLAS_VERSION}`;
    }

    function replaceLegacyMarkup(target) {
        const list = target.matches('.maps-list') ? target : target.querySelector('.maps-list') || target;
        list.classList.add('footprints-atlas-list');
        list.replaceChildren();
        MAP_DEFINITIONS.forEach((definition, index) => {
            const card = document.createElement('article');
            card.className = 'map-card footprints-map-card';
            card.dataset.atlasCard = definition.id;
            const heading = document.createElement('div');
            heading.className = 'map-card-title';
            const number = document.createElement('span');
            number.className = 'footprints-map-number';
            number.textContent = `0${index + 1}`;
            const title = document.createElement('h3');
            title.dataset.atlasTitle = definition.id;
            const subtitle = document.createElement('span');
            subtitle.className = 'footprints-map-subtitle';
            heading.append(number, title, subtitle);
            const mapBox = document.createElement('div');
            mapBox.id = `${definition.id}Map`;
            mapBox.className = 'map-box footprints-map-box';
            card.append(heading, mapBox);
            const legend = document.createElement('div');
            legend.className = 'footprints-map-legend';
            ['visited', 'corridor', 'unvisited'].forEach(key => {
                const item = document.createElement('span');
                item.className = `footprints-legend-${key}`;
                const swatch = document.createElement('i');
                swatch.setAttribute('aria-hidden', 'true');
                const text = document.createElement('span');
                text.dataset.atlasCopy = key;
                item.append(swatch, text);
                legend.append(item);
            });
            card.append(legend);
            const attribution = document.createElement('div');
            attribution.className = 'footprints-map-attribution';
            [
                ['© OpenStreetMap contributors', 'https://www.openstreetmap.org/copyright'],
                ['Natural Earth', 'https://www.naturalearthdata.com/'],
                ['Terrain Tiles', 'https://registry.opendata.aws/terrain-tiles/']
            ].forEach(([label, href], index) => {
                if (index) attribution.append(' · ');
                const link = document.createElement('a');
                link.textContent = label;
                link.href = href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                attribution.append(link);
            });
            card.append(attribution);
            list.append(card);
        });
        return list;
    }

    function controlsFor(instance) {
        const controls = document.createElement('div');
        controls.className = 'footprints-map-controls';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', currentCopy().controls);
        const labels = currentCopy();
        [
            ['zoom-out', '−', labels.zoomOut],
            ['zoom-in', '+', labels.zoomIn],
            ['reset', '↺', labels.reset],
            ['actual', '1:1', labels.actual],
            ['expand', labels.expand, labels.expand]
        ].forEach(([action, text, label]) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `footprints-map-control footprints-map-control-${action}`;
            button.dataset.mapAction = action;
            button.textContent = text;
            button.setAttribute('aria-label', label);
            button.title = label;
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopPropagation();
                if (action === 'zoom-in') instance.zoomBy(1.4);
                if (action === 'zoom-out') instance.zoomBy(1 / 1.4);
                if (action === 'reset') instance.resetView();
                if (action === 'actual') instance.zoomTo(instance.width / (instance.fitWidth * (window.devicePixelRatio || 1)));
                if (action === 'expand') instance.openViewer();
            });
            controls.append(button);
        });
        const zoom = document.createElement('output');
        zoom.className = 'footprints-map-zoom';
        zoom.setAttribute('aria-live', 'off');
        controls.insertBefore(zoom, controls.querySelector('[data-map-action="reset"]'));
        return controls;
    }

    function matchVisited(map, item, byId) {
        if (item?.visited === false) return false;
        if (item?.visited === true || item?.active === true) return true;
        const candidateIds = [item?.id, item?.name, item?.label].flatMap(value => {
            if (value && typeof value === 'object') return Object.values(value);
            return value;
        }).filter(Boolean).map(normaliseId);
        if (candidateIds.some(id => byId.has(id))) return true;
        if (Array.isArray(map.visited)) {
            return map.visited.some(value => {
                const values = [value?.id, value?.name, value?.label, value].flatMap(entry => {
                    if (entry && typeof entry === 'object') return Object.values(entry);
                    return entry;
                }).filter(Boolean).map(normaliseId);
                return values.some(id => candidateIds.includes(id));
            });
        }
        const siteVisited = typeof visited !== 'undefined' ? visited : window.visited;
        if (Array.isArray(siteVisited)) {
            return candidateIds.some(id => siteVisited.map(normaliseId).includes(id));
        }
        return false;
    }

    function regionFor(item, regions) {
        const candidates = [item?.region, item?.regionId, item?.area, item?.province, item?.parent]
            .flatMap(value => value && typeof value === 'object' ? [value.id, value.name] : value)
            .filter(Boolean).map(normaliseId);
        return regions.find(region => candidates.includes(normaliseId(region.id)) || candidates.includes(normaliseId(region.name))) || null;
    }

    function createMapInstance(definition, map, box) {
        const width = Number(map.width || map.projection?.width || 1000);
        const height = Number(map.height || map.projection?.height || 650);
        const source = imageUrl(map.image || map.raster || map.src);
        const colorSource = imageUrl(map.color_image || map.colorImage || map.image);
        const regions = Array.isArray(map.regions) ? map.regions : [];
        const citySource = Array.isArray(map.cities)
            ? map.cities
            : Array.isArray(map.visited)
                ? map.visited
                : regions.filter(region => region.visited === true || region.level === 'city' || region.kind === 'city');
        const cities = citySource.map(item => typeof item === 'string' ? { id: item, name: item } : (item || {}));
        const visitedSource = Array.isArray(map.visited) ? map.visited : [];
        const visitedIds = new Set(visitedSource.flatMap(item => [item?.id, item?.name, item?.label, item]).flatMap(value => {
            if (value && typeof value === 'object') return Object.values(value);
            return value;
        }).filter(Boolean).map(normaliseId));
        const regionById = new Map(regions.flatMap(region => [
            [normaliseId(region.id), region], [normaliseId(region.name), region]
        ]));
        box.replaceChildren();
        box.classList.add('footprints-map-shell');
        box.style.aspectRatio = `${width} / ${height}`;
        box.style.backgroundColor = map.display_background || map.background || '#dad5c3';
        box.setAttribute('role', 'region');
        box.setAttribute('aria-label', mapDefinition(definition.id).label[currentLanguage] || mapDefinition(definition.id).label.en);
        const viewport = document.createElement('div');
        viewport.className = 'footprints-map-viewport';
        viewport.tabIndex = 0;
        viewport.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + - 0');
        const stage = document.createElement('div');
        stage.className = 'footprints-map-stage';
        stage.style.aspectRatio = `${width} / ${height}`;
        const terrain = document.createElement('img');
        terrain.className = 'footprints-map-terrain';
        terrain.alt = '';
        terrain.draggable = false;
        terrain.loading = 'lazy';
        const status = document.createElement('div');
        status.className = 'footprints-map-status';
        status.setAttribute('role', 'status');
        status.textContent = currentCopy().mapLoading;
        const svg = svgElement('svg', {
            class: 'footprints-map-svg', viewBox: `0 0 ${width} ${height}`,
            preserveAspectRatio: 'none', focusable: 'false', role: 'group',
            'aria-label': definition.label[currentLanguage] || definition.label.en
        });
        const defs = svgElement('defs');
        const fillGroup = svgElement('g', { class: 'footprints-map-visited-terrain' });
        const cityGroup = svgElement('g', { class: 'footprints-map-cities' });
        svg.append(defs, fillGroup, cityGroup);
        stage.append(terrain, svg);
        viewport.append(stage);
        box.append(viewport, status);
        let terrainLoaded = false;
        let colorLoaded = false;
        let assetFailed = false;
        const updateAssetState = message => {
            if (message) {
                assetFailed = true;
                box.classList.add('is-map-error');
                status.classList.add('is-visible');
                status.textContent = message;
                return;
            }
            if (!assetFailed && terrainLoaded && colorLoaded) {
                box.classList.remove('is-map-loading');
                status.classList.remove('is-visible');
            }
        };
        box.classList.add('is-map-loading');
        terrain.addEventListener('load', () => {
            terrainLoaded = true;
            updateAssetState();
        });
        terrain.addEventListener('error', () => updateAssetState(currentCopy().unavailable));
        terrain.src = source;
        const colorPreload = new Image();
        colorPreload.addEventListener('load', () => {
            colorLoaded = true;
            updateAssetState();
        });
        colorPreload.addEventListener('error', () => updateAssetState(currentCopy().unavailable));
        colorPreload.src = colorSource;
        const instance = {
            definition, map, box, viewport, stage, svg, source, colorSource, width, height,
            cities, regions, regionById, visitedIds,
            scale: 1, panX: 0, panY: 0, activeCity: null, viewer: null,
            updateTransform() {
                const viewportWidth = viewport.clientWidth;
                const viewportHeight = viewport.clientHeight;
                if (!viewportWidth || !viewportHeight) return;
                const fitScale = Math.min(viewportWidth / width, viewportHeight / height);
                const fitWidth = width * fitScale;
                const fitHeight = height * fitScale;
                this.fitWidth = fitWidth;
                this.maxScale = Math.max(8, width / (fitWidth * (window.devicePixelRatio || 1)));
                svg.style.setProperty('--footprints-label-size', `${12 / (fitScale * this.scale)}px`);
                svg.style.setProperty('--footprints-label-outline', `${3 / (fitScale * this.scale)}px`);
                const maxPanX = Math.max(0, (fitWidth * this.scale - viewportWidth) / 2);
                const maxPanY = Math.max(0, (fitHeight * this.scale - viewportHeight) / 2);
                this.panX = Math.min(maxPanX, Math.max(-maxPanX, this.panX));
                this.panY = Math.min(maxPanY, Math.max(-maxPanY, this.panY));
                stage.style.width = `${fitWidth * this.scale}px`;
                stage.style.height = `${fitHeight * this.scale}px`;
                stage.style.transform = `translate3d(calc(-50% + ${this.panX}px), calc(-50% + ${this.panY}px), 0)`;
                viewport.style.touchAction = this.scale > 1 || this.viewer ? 'none' : 'pan-y';
                viewport.classList.toggle('is-zoomed', this.scale > 1);
                box.querySelector('[data-map-action="zoom-out"]')?.toggleAttribute('disabled', this.scale <= 1);
                box.querySelector('[data-map-action="zoom-in"]')?.toggleAttribute('disabled', this.scale >= this.maxScale);
                const readout = box.querySelector('.footprints-map-zoom');
                if (readout) readout.textContent = `${Math.round(this.scale * 100)}%`;
            },
            zoomTo(value, clientX, clientY) {
                const bounds = viewport.getBoundingClientRect();
                const anchorX = clientX == null ? 0 : clientX - bounds.left - bounds.width / 2;
                const anchorY = clientY == null ? 0 : clientY - bounds.top - bounds.height / 2;
                const scale = Math.max(1, Math.min(this.maxScale || 8, value));
                const ratio = scale / this.scale;
                this.panX = anchorX + (this.panX - anchorX) * ratio;
                this.panY = anchorY + (this.panY - anchorY) * ratio;
                this.scale = scale;
                if (this.scale === 1) { this.panX = 0; this.panY = 0; }
                this.updateTransform();
            },
            zoomBy(factor, clientX, clientY) {
                this.zoomTo(this.scale * factor, clientX, clientY);
            },
            resetView() {
                this.scale = 1; this.panX = 0; this.panY = 0; this.updateTransform();
            },
            openViewer() {
                if (this.viewer) return;
                const returnFocus = document.activeElement;
                const placeholder = document.createElement('div');
                placeholder.style.height = `${box.getBoundingClientRect().height}px`;
                box.before(placeholder);
                const viewer = document.createElement('dialog');
                viewer.className = 'footprints-map-viewer';
                viewer.setAttribute('aria-labelledby', `footprints-viewer-title-${definition.id}`);
                const header = document.createElement('div');
                header.className = 'footprints-viewer-header';
                const title = document.createElement('h2');
                title.id = `footprints-viewer-title-${definition.id}`;
                title.dataset.atlasTitle = definition.id;
                title.textContent = localized(definition.title);
                const close = document.createElement('button');
                close.type = 'button';
                close.className = 'footprints-viewer-close';
                close.textContent = '×';
                close.setAttribute('aria-label', currentCopy().close);
                close.addEventListener('click', () => viewer.close());
                header.append(title, close);
                const hint = document.createElement('p');
                hint.className = 'footprints-map-hint';
                hint.dataset.atlasCopy = 'hint';
                hint.textContent = currentCopy().hint;
                viewer.append(header, box, hint);
                viewer.addEventListener('keydown', event => {
                    event.stopPropagation();
                    if (event.key === 'Escape') { event.preventDefault(); viewer.close(); }
                });
                document.body.append(viewer);
                this.viewer = viewer;
                viewer.addEventListener('close', () => {
                    placeholder.replaceWith(box);
                    this.viewer = null;
                    viewer.remove();
                    this.resetView();
                    returnFocus?.focus?.({ preventScroll: true });
                }, { once: true });
                viewer.showModal();
                this.resetView();
                viewport.focus({ preventScroll: true });
            },
            setActive(city, force = false) {
                if (this.activeCity === city && !force) return;
                this.activeCity = city || null;
                cityGroup.querySelectorAll('.is-active').forEach(element => element.classList.remove('is-active'));
                if (city) city.element?.classList.add('is-active');
            },
            updateLanguage() {
                const labels = currentCopy();
                const mapLabel = definition.label[currentLanguage] || definition.label.en;
                box.setAttribute('aria-label', mapLabel);
                svg.setAttribute('aria-label', mapLabel);
                viewport.setAttribute('aria-label', `${mapLabel}. ${labels.keyboard}`);
                status.textContent = assetFailed ? labels.unavailable : (terrainLoaded && colorLoaded ? '' : labels.mapLoading);
                box.querySelector('.footprints-map-controls')?.setAttribute('aria-label', labels.controls);
                box.querySelectorAll('[data-map-action="zoom-in"]').forEach(button => button.setAttribute('aria-label', labels.zoomIn));
                box.querySelectorAll('[data-map-action="zoom-out"]').forEach(button => button.setAttribute('aria-label', labels.zoomOut));
                box.querySelectorAll('[data-map-action="reset"]').forEach(button => button.setAttribute('aria-label', labels.reset));
                box.querySelectorAll('[data-map-action="actual"]').forEach(button => button.setAttribute('aria-label', labels.actual));
                box.querySelectorAll('[data-map-action="expand"]').forEach(button => {
                    button.setAttribute('aria-label', labels.expand);
                    button.textContent = labels.expand;
                });
                box.querySelectorAll('[data-map-action]').forEach(button => { button.title = button.getAttribute('aria-label'); });
                this.viewer?.querySelector('.footprints-viewer-close').setAttribute('aria-label', labels.close);
                const card = document.querySelector(`[data-atlas-card="${definition.id}"]`);
                const openButton = card.querySelector('.footprints-map-open');
                if (openButton) { openButton.textContent = `↗ ${labels.expand}`; openButton.setAttribute('aria-label', labels.expand); }
                const count = regions.filter(region => region.visited).length;
                card.querySelector('.footprints-map-subtitle').textContent = count ? labels.count.replace('{count}', count) : labels.pending;
                card.querySelector('.footprints-legend-visited').hidden = count === 0;
                card.querySelector('.footprints-legend-corridor').hidden = !map.routes?.length;
                cityGroup.querySelectorAll('[data-city-id]').forEach(element => {
                    const city = element._footprintsCity;
                    const label = city ? nameOf(city.data) : '';
                    element.setAttribute('aria-label', label);
                    element.querySelector?.('title')?.replaceChildren(document.createTextNode(label));
                    const text = element.querySelector?.('.footprints-city-label-text');
                    if (text) text.textContent = label;
                });
            }
        };

        const visitedClipId = `footprints-${definition.id}-visited`;
        const visitedClip = svgElement('clipPath', { id: visitedClipId, clipPathUnits: 'userSpaceOnUse' });
        defs.append(visitedClip);

        cities.forEach((city, index) => {
            const region = regionFor(city, regions) || regionById.get(normaliseId(city?.id)) || regionById.get(normaliseId(city?.name));
            const path = geometryPath(city.geometry || city.path || city.d) || geometryPath(region?.geometry || region?.path || region?.d);
            const visitedCity = matchVisited(map, city, visitedIds) || Boolean(city.visited);
            if (!visitedCity || !path) return;
            const center = centerOf(city, path || geometryPath(region?.geometry));
            visitedClip.append(svgElement('path', { d: path, 'clip-rule': 'evenodd', 'data-clip-city': city.id }));
            const group = svgElement('g', { class: 'footprints-city', tabindex: 0, role: 'button', 'data-city-id': city.id || city.name || `city-${index}` });
            group._footprintsCity = { data: city, element: group };
            group.append(svgElement('path', { d: path, class: 'footprints-city-hit', fill: 'transparent', stroke: 'transparent', 'vector-effect': 'non-scaling-stroke' }));
            const label = svgElement('text', { x: center[0], y: center[1] - 9, class: 'footprints-city-label-text', 'text-anchor': 'middle' });
            label.textContent = nameOf(city);
            group.append(label);
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = nameOf(city);
            group.prepend(title);
            group.addEventListener('pointerenter', () => instance.setActive(group._footprintsCity));
            group.addEventListener('pointerleave', () => { if (document.activeElement !== group) instance.setActive(null); });
            group.addEventListener('focus', () => instance.setActive(group._footprintsCity));
            group.addEventListener('blur', () => instance.setActive(null));
            group.addEventListener('click', event => { event.stopPropagation(); instance.setActive(group._footprintsCity, true); });
            group.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); instance.setActive(group._footprintsCity, true); }
            });
            cityGroup.append(group);
        });

        (map.routes || []).forEach(route => {
            if (!route.corridor_path) return;
            visitedClip.append(svgElement('path', {
                d: route.corridor_path, 'clip-rule': 'evenodd',
                'data-route-id': route.id, 'data-corridor-width-km': route.corridor_width_km
            }));
        });
        if (visitedClip.childElementCount) {
            fillGroup.append(svgElement('image', { href: colorSource, x: 0, y: 0, width, height, preserveAspectRatio: 'none', class: 'footprints-map-visited-image', 'clip-path': `url(#${visitedClipId})` }));
        }

        box.append(controlsFor(instance));
        const openButton = document.createElement('button');
        openButton.type = 'button';
        openButton.className = 'footprints-map-open';
        openButton.setAttribute('aria-haspopup', 'dialog');
        openButton.addEventListener('click', () => instance.openViewer());
        box.closest('.footprints-map-card').querySelector('.map-card-title').append(openButton);
        const north = document.createElement('div');
        north.className = 'footprints-map-north';
        north.setAttribute('aria-hidden', 'true');
        north.textContent = 'N ↑';
        box.append(north);
        instance.updateTransform();
        let drag = null;
        let suppressClick = false;
        viewport.addEventListener('pointerdown', event => {
            event.stopPropagation();
            if (event.pointerType === 'touch' || event.button !== 0) return;
            suppressClick = false;
            if (instance.scale <= 1) return;
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: instance.panX, panY: instance.panY };
            viewport.classList.add('is-dragging');
            event.stopPropagation();
        });
        viewport.addEventListener('pointermove', event => {
            event.stopPropagation();
            if (!drag || drag.id !== event.pointerId) return;
            if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) {
                suppressClick = true;
                viewport.setPointerCapture?.(event.pointerId);
            }
            instance.panX = drag.panX + event.clientX - drag.x;
            instance.panY = drag.panY + event.clientY - drag.y;
            instance.updateTransform();
            event.stopPropagation();
        });
        const finishDrag = event => {
            event.stopPropagation();
            if (!drag || drag.id !== event.pointerId) return;
            drag = null;
            viewport.classList.remove('is-dragging');
            viewport.releasePointerCapture?.(event.pointerId);
            event.stopPropagation();
        };
        viewport.addEventListener('pointerup', finishDrag);
        viewport.addEventListener('pointercancel', finishDrag);
        viewport.addEventListener('click', event => {
            if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); }
        }, true);
        let touchGesture = null;
        const touchState = touches => {
            const first = touches[0];
            const second = touches[1] || first;
            return { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2,
                distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY) };
        };
        const beginTouch = event => {
            event.stopPropagation();
            suppressClick = false;
            touchGesture = event.touches.length ? touchState(event.touches) : null;
            if (event.touches.length > 1) event.preventDefault();
        };
        viewport.addEventListener('touchstart', beginTouch, { passive: false });
        viewport.addEventListener('touchmove', event => {
            event.stopPropagation();
            if (!touchGesture || (event.touches.length < 2 && instance.scale <= 1)) return;
            event.preventDefault();
            suppressClick = true;
            const next = touchState(event.touches);
            if (next.distance && touchGesture.distance) instance.zoomBy(next.distance / touchGesture.distance, touchGesture.x, touchGesture.y);
            instance.panX += next.x - touchGesture.x;
            instance.panY += next.y - touchGesture.y;
            instance.updateTransform();
            touchGesture = next;
        }, { passive: false });
        viewport.addEventListener('touchend', event => {
            event.stopPropagation();
            touchGesture = event.touches.length ? touchState(event.touches) : null;
        });
        viewport.addEventListener('touchcancel', () => { touchGesture = null; });
        viewport.addEventListener('dblclick', event => {
            event.preventDefault();
            event.stopPropagation();
            instance.zoomTo(instance.scale >= 4 ? 1 : instance.scale * 2, event.clientX, event.clientY);
        });
        viewport.addEventListener('wheel', event => {
            if (!event.ctrlKey && !event.metaKey && !instance.viewer) return;
            event.preventDefault();
            event.stopPropagation();
            instance.zoomBy(Math.exp(-Math.max(-180, Math.min(180, event.deltaY)) * 0.003), event.clientX, event.clientY);
        }, { passive: false });
        viewport.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape') {
                instance.setActive(null, true);
                if (instance.viewer) { event.preventDefault(); instance.viewer.close(); }
                return;
            }
            if (event.key === '+' || event.key === '=') { event.preventDefault(); instance.zoomBy(1.4); }
            if (event.key === '-' || event.key === '_') { event.preventDefault(); instance.zoomBy(1 / 1.4); }
            if (event.key === '0') { event.preventDefault(); instance.resetView(); }
            if (event.key === 'ArrowLeft') { event.preventDefault(); instance.panX -= 32; instance.updateTransform(); }
            if (event.key === 'ArrowRight') { event.preventDefault(); instance.panX += 32; instance.updateTransform(); }
            if (event.key === 'ArrowUp') { event.preventDefault(); instance.panY -= 32; instance.updateTransform(); }
            if (event.key === 'ArrowDown') { event.preventDefault(); instance.panY += 32; instance.updateTransform(); }
        });
        instance.updateLanguage();
        return instance;
    }

    async function loadAtlas() {
        if (!atlasPromise) {
            atlasPromise = fetch(ATLAS_URL, { credentials: 'same-origin' }).then(response => {
                if (!response.ok) throw new Error(`Atlas HTTP ${response.status}`);
                return response.json();
            }).then(value => {
                if (!value || typeof value !== 'object' || !value.maps) throw new Error('Invalid footprints atlas');
                atlas = value;
                return value;
            }).catch(error => {
                atlasPromise = null;
                atlas = null;
                throw error;
            });
        }
        return atlasPromise;
    }

    async function init(options = {}) {
        root = options.root || document.querySelector('[data-portal-entry="footprints-map"]');
        currentLanguage = options.language || window.state?.currentLang || 'en';
        if (!root) return false;
        const list = replaceLegacyMarkup(root);
        await loadAtlas();
        instances.clear();
        MAP_DEFINITIONS.forEach(definition => {
            const data = mapData(definition);
            const box = list.querySelector(`[data-atlas-card="${definition.id}"] .map-box`);
            if (data && box) instances.set(definition.id, createMapInstance(definition, data, box));
        });
        updateLanguage(currentLanguage);
        return instances.size > 0;
    }

    function updateLanguage(language) {
        currentLanguage = language || currentLanguage || 'en';
        instances.forEach(instance => instance.updateLanguage());
        document.querySelectorAll('[data-atlas-title]').forEach(title => {
            const definition = mapDefinition(title.dataset.atlasTitle);
            title.textContent = definition.title[currentLanguage] || definition.title.en;
        });
        document.querySelectorAll('[data-atlas-copy]').forEach(element => { element.textContent = currentCopy()[element.dataset.atlasCopy]; });
    }

    function resize() {
        instances.forEach(instance => instance.updateTransform());
    }

    function fail(error) {
        console.error('Footprints atlas unavailable:', error);
        const message = currentCopy().unavailable;
        document.querySelectorAll('.footprints-map-box').forEach(box => {
            box.replaceChildren();
            box.classList.add('is-map-error');
            const notice = document.createElement('div');
            notice.className = 'footprints-map-error';
            notice.textContent = message;
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'footprints-map-retry';
            retry.textContent = currentCopy().retry;
            retry.addEventListener('click', () => {
                atlasPromise = null;
                atlas = null;
                window.initMaps?.();
            });
            box.append(notice);
            box.append(retry);
        });
    }

    window.footprintsAtlas = { init, updateLanguage, resize, fail };
})();
