/* A quiet, self-contained interface for the environments beneath the sky. */
(function () {
    'use strict';

    const SCENES = ['spaceship', 'shelter', 'hogwarts', 'snowmountain'];
    const COPY = {
        en: {
            where: 'YOU ARE HERE', choose: 'Choose a place', title: 'Somewhere under the stars',
            intro: 'Four places to pause. Turn your head and take it in.', close: 'Close places',
            observe: 'Observe', explore: 'Explore', sky: 'Just the sky', view: 'View mode', current: 'Here now',
            clear: 'Day', dusk: 'Dusk', quality: 'Panorama quality', auto: 'Auto', high: 'High', medium: 'Medium', low: 'Low',
            preview: 'Preview imagery · final production renders are not installed.', rendered: 'Offline panorama loaded', renderError: 'Panorama unavailable. Try another quality or scene.',
            renderedReview: 'Pre-rendered review version · visual acceptance is not complete.', renderedDraft: 'Pre-rendered draft · production work is still in progress.',
            sound: 'Ambient sound', soundOn: 'Sound on', soundOff: 'Sound off', reset: 'Return to arrival point',
            loading: 'Preparing your surroundings…', error: 'The surroundings could not load. The sky is still available.',
            walk: 'W A S D · walk', look: 'Mouse · look', interact: 'Interact', hint: 'M · change surroundings',
            skyHint: 'A / D · roll the sky', touchHint: 'Left · move     Right · look',
            observeHint: 'Mouse / drag · look around', leaveSeat: 'F · leave the seat',
            distance: 'wandered', pilot: 'AT THE HELM', pilotHint: 'W / S · pitch   A / D · yaw   Q / E · roll\nShift / Ctrl · throttle   Space · brake   Mouse · look',
            touchPilotHint: '↑ / ↓ · pitch   ← / → · yaw   + / − · throttle   Drag · look',
            pilotForward: 'Pitch up', pilotBack: 'Pitch down', pilotLeft: 'Turn left', pilotRight: 'Turn right', throttleUp: 'Increase throttle', throttleDown: 'Decrease throttle',
            move: 'Move through the environment', forward: 'Walk forward', back: 'Walk backward', left: 'Move left', right: 'Move right',
            entered: 'Now in', switchMode: 'Choose an observation mode',
            transit: ['The waiting place', 'Embers in an endless clearing.', 'FIRE / SILENCE'],
            lakeshore: ['Stillwater', 'A jetty, a lighthouse, the breathing lake.', 'WATER / REFLECTION'],
            observatory: ['The old observatory', 'A weathered dome above the clouds.', 'STONE / STARLIGHT'],
            spaceship: ['Frontier', 'At the helm, with the entire sky ahead.', 'NASA-PUNK / DEEP SPACE'],
            shelter: ['The courtyard settlement', 'An open-air refuge among ruined city streets.', 'WASTELAND / SETTLEMENT'],
            hogwarts: ['Above Hogwarts', 'A mountainside facing the castle and its lake.', 'CASTLE / DAYLIGHT'],
            snowmountain: ['The high ridge', 'Snow, sheer rock and a sky without limits.', 'ALPINE / DAYLIGHT'],
            train: ['The night train', 'A quiet platform. A journey without hurry.', 'RAIL / RHYTHM'],
            room: ['A room with a view', 'Lamplight, familiar things, an open sky.', 'LAMPLIGHT / STILLNESS'],
            loop: ['The returning path', 'A familiar fire. Something has changed.', 'FOG / MEMORY']
        },
        'zh-CN': {
            where: '此刻所在', choose: '选择一处风景', title: '在星空之下，停留片刻',
            intro: '四处值得停留的风景。环顾四周，慢慢欣赏。', close: '关闭场景选择',
            observe: '静静观景', explore: '自由探索', sky: '只看星空', view: '视角模式', current: '正在这里',
            clear: '晴天', dusk: '黄昏', quality: '全景画质', auto: '自动', high: '高', medium: '中', low: '低',
            preview: '当前为预览资源 · 最终制作级渲染尚未安装。', rendered: '已加载离线全景', renderError: '全景暂时无法加载，请尝试其他画质或场景。',
            renderedReview: '预渲染评审版 · 尚未完成最终画质验收。', renderedDraft: '预渲染草稿 · 美术制作仍在进行。',
            sound: '环境声音', soundOn: '声音已开', soundOff: '声音已关', reset: '回到抵达位置',
            loading: '正在铺开这片风景…', error: '场景暂时无法加载，仍可继续欣赏星空。',
            walk: 'W A S D · 行走', look: '鼠标 · 环顾', interact: '互动', hint: 'M · 更换场景',
            skyHint: 'A / D · 翻转视角', touchHint: '左侧移动 · 右侧滑动环顾',
            observeHint: '鼠标 / 滑动 · 环顾四周', leaveSeat: 'F · 离开驾驶位',
            distance: '漫游', pilot: '驾驶中', pilotHint: 'W / S · 俯仰   A / D · 转向   Q / E · 翻滚\nShift / Ctrl · 油门   空格 · 制动   鼠标 · 环顾',
            touchPilotHint: '↑ / ↓ · 俯仰   ← / → · 转向   + / − · 油门   滑动 · 环顾',
            pilotForward: '向上俯仰', pilotBack: '向下俯仰', pilotLeft: '向左转向', pilotRight: '向右转向', throttleUp: '增加油门', throttleDown: '减小油门',
            move: '在场景中移动', forward: '向前走', back: '向后走', left: '向左移动', right: '向右移动',
            entered: '已来到', switchMode: '选择观景模式',
            transit: ['永夜中转地', '空旷原野里，一堆未尽的篝火。', '余烬 / 寂静'],
            lakeshore: ['静夜湖岸', '栈桥延向湖心，远处灯塔明灭。', '湖水 / 倒影'],
            observatory: ['旧日天文台', '越过石阶，在旧穹顶下抬头。', '石阶 / 星光'],
            spaceship: ['开拓号', '坐在驾驶位，驶向整片星空。', 'NASA 朋克 / 深空'],
            shelter: ['废土聚落', '废弃街道之间，一处露天生活的小聚落。', '废土 / 聚落'],
            hogwarts: ['霍格沃兹山丘', '在城堡外的山上，远眺湖泊与尖塔。', '城堡 / 日光'],
            snowmountain: ['险峰之上', '冰雪、峭壁和没有边界的天空。', '雪岭 / 日光'],
            train: ['夜行列车', '没有催促的站台，缓慢经过的夜。', '铁轨 / 节奏'],
            room: ['有窗的房间', '一盏暖灯，几件旧物，一整片夜空。', '灯火 / 安宁'],
            loop: ['回环之路', '又见最初的篝火，有什么悄悄变了。', '薄雾 / 记忆']
        },
        'zh-TW': {
            where: '此刻所在', choose: '選擇一處風景', title: '在星空之下，停留片刻',
            intro: '四處值得停留的風景。環顧四周，慢慢欣賞。', close: '關閉場景選擇',
            observe: '靜靜觀景', explore: '自由探索', sky: '只看星空', view: '視角模式', current: '正在這裡',
            clear: '晴天', dusk: '黃昏', quality: '全景畫質', auto: '自動', high: '高', medium: '中', low: '低',
            preview: '目前為預覽資源 · 最終製作級渲染尚未安裝。', rendered: '已載入離線全景', renderError: '全景暫時無法載入，請嘗試其他畫質或場景。',
            renderedReview: '預渲染評審版 · 尚未完成最終畫質驗收。', renderedDraft: '預渲染草稿 · 美術製作仍在進行。',
            sound: '環境聲音', soundOn: '聲音已開', soundOff: '聲音已關', reset: '回到抵達位置',
            loading: '正在鋪開這片風景…', error: '場景暫時無法載入，仍可繼續欣賞星空。',
            walk: 'W A S D · 行走', look: '滑鼠 · 環顧', interact: '互動', hint: 'M · 更換場景',
            skyHint: 'A / D · 翻轉視角', touchHint: '左側移動 · 右側滑動環顧',
            observeHint: '滑鼠 / 滑動 · 環顧四周', leaveSeat: 'F · 離開駕駛位',
            distance: '漫遊', pilot: '駕駛中', pilotHint: 'W / S · 俯仰   A / D · 轉向   Q / E · 翻滾\nShift / Ctrl · 油門   空白鍵 · 制動   滑鼠 · 環顧',
            touchPilotHint: '↑ / ↓ · 俯仰   ← / → · 轉向   + / − · 油門   滑動 · 環顧',
            pilotForward: '向上俯仰', pilotBack: '向下俯仰', pilotLeft: '向左轉向', pilotRight: '向右轉向', throttleUp: '增加油門', throttleDown: '減小油門',
            move: '在場景中移動', forward: '向前走', back: '向後走', left: '向左移動', right: '向右移動',
            entered: '已來到', switchMode: '選擇觀景模式',
            transit: ['永夜中轉地', '空曠原野裡，一堆未盡的篝火。', '餘燼 / 寂靜'],
            lakeshore: ['靜夜湖岸', '棧橋延向湖心，遠處燈塔明滅。', '湖水 / 倒影'],
            observatory: ['舊日天文台', '越過石階，在舊穹頂下抬頭。', '石階 / 星光'],
            spaceship: ['開拓號', '坐在駕駛位，駛向整片星空。', 'NASA 朋克 / 深空'],
            shelter: ['廢土聚落', '廢棄街道之間，一處露天生活的小聚落。', '廢土 / 聚落'],
            hogwarts: ['霍格華茲山丘', '在城堡外的山上，遠眺湖泊與尖塔。', '城堡 / 日光'],
            snowmountain: ['險峰之上', '冰雪、峭壁和沒有邊界的天空。', '雪嶺 / 日光'],
            train: ['夜行列車', '沒有催促的月臺，緩慢經過的夜。', '鐵軌 / 節奏'],
            room: ['有窗的房間', '一盞暖燈，幾件舊物，一整片夜空。', '燈火 / 安寧'],
            loop: ['回環之路', '又見最初的篝火，有什麼悄悄變了。', '薄霧 / 記憶']
        }
    };

    // Small native illustrations keep the chooser light, with no image requests.
    const ART = {
        shelter: '<path d="M0 105V61h25v44h14V38h36v67h16V70h23v35h25V22h24v83h24V49h32v56h20V69h41v81H0Z" fill="#38424b"/><path d="M0 0h25v150H0Zm255 0h25v150h-25Z" fill="#71695f"/><path d="M25 125h230v25H25Z" fill="#292c2d"/><path d="M40 118h65v7H40m7-7V89h47v29" fill="#675c4b"/><circle cx="71" cy="77" r="8" fill="#ddb576" opacity=".8"/>',
        hogwarts: '<path d="M0 0h280v150H0Z" fill="#9aafb9"/><path d="m0 95 56-38 60 37 74-40 90 41v55H0Z" fill="#6e7a72"/><path d="M90 92V51h18v41h11V35h14v57h16V59h24v33h16V42h14v50Z" fill="#a59e88"/><path d="m86 51 13-23 13 23m3-16 11-24 11 24m48 7 11-20 11 20" fill="#525f68"/><path d="M0 129q69-23 112 1t168-9v29H0Z" fill="#535e49"/>',
        snowmountain: '<path d="M0 0h280v150H0Z" fill="#8ca8bd"/><path d="M0 138 55 51l28 31 63-77 47 68 31-27 56 91v13H0Z" fill="#dee6e8"/><path d="m55 51-7 49 26-8-9 29 38 2 43-118-24 91 37-18 34-5-27 58 58-85-8 57 33-4 31 38v13H0Z" fill="#6d8597"/><path d="m0 150 70-25 39 14 68-32 103 43Z" fill="#c6d5df"/>',
        transit: '<path d="M0 100Q70 86 140 96T280 93V150H0Z" fill="#171b22"/><ellipse cx="142" cy="119" rx="49" ry="10" fill="#c0773b" opacity=".09"/><path d="m126 120 29-8m-28 0 29 9" stroke="#795543" stroke-width="4"/><path d="M138 115q-10-9 3-25-2 13 8 17 2-8 0-12 15 16-2 24Z" fill="#e8a76a"/><path d="M143 116q-6-7 2-15 10 14-2 15Z" fill="#ffe0a3"/><path d="M72 116v-17h27v17M74 106h24" fill="none" stroke="#5d6269" stroke-width="2"/><circle cx="143" cy="79" r="1" fill="#edc892"/><circle cx="149" cy="65" r=".8" fill="#edc892"/>',
        lakeshore: '<path d="M0 88 24 82 51 88 88 72 126 86 164 78 201 85 245 73 280 82V100H0Z" fill="#1c2932"/><path d="M0 95H280V150H0Z" fill="#172731"/><path d="m123 150 14-46h7l23 46" fill="#3b3936"/><path d="M127 136h32m-27-13h19m-15-11h10" stroke="#777168" opacity=".55"/><path d="m209 91 3-38h10l3 38Z" fill="#738086"/><path d="M211 55V47h12v8m-14-9 8-8 8 8" fill="#c3bb9b"/><path d="m216 50-47 11v-19Z" fill="#f8e4a0" opacity=".08"/><path d="M211 105h15m-21 9h23m-19 11h21m-124-17h15m-52 25h34" stroke="#a4b4ba" opacity=".24"/>',
        observatory: '<path d="M0 140 43 119 96 115 124 105 187 108 227 122 280 131V150H0Z" fill="#252b32"/><path d="M98 108V73h88v35" fill="#525963"/><path d="M95 75a47 47 0 0 1 94 0Z" fill="#7a858f"/><path d="M139 30q-10 17-8 45h13q-3-30 8-44" fill="#26333e"/><path d="M94 75h96" stroke="#b0b7b8"/><path d="M108 85h14v16h-14m55-16h14v16h-14" fill="#e0b47c" opacity=".55"/><path d="M137 91h12v17h-12" fill="#171e24"/><path d="m140 112-10 27m10-27 18 27m-23-18h10m-14 9h20m-25 9h32" stroke="#80848a" opacity=".55"/>',
        spaceship: '<path d="M0 0h37l28 104-26 46H0Zm280 0h-37l-28 104 26 46h41Z" fill="#26333f"/><path d="m36 0 29 105m180-105-30 105" stroke="#8193a0" opacity=".7"/><path d="M65 104h150l32 46H33Z" fill="#27333d"/><path d="M95 115h91l12 23H84Z" fill="#101d2a" stroke="#526a7b"/><path d="M103 119h23v11h-26Zm45 0h24l4 11h-28Z" fill="#80b6b7" opacity=".55"/><path d="M133 122h9m-9 5h9m-59 17h114" stroke="#c4b698" opacity=".7"/><ellipse cx="179" cy="49" rx="19" ry="18" fill="#65748a" opacity=".55"/><path d="M160 45q18-13 36 7" fill="none" stroke="#a8b3c2" opacity=".35"/>',
        train: '<path d="M0 111H280V150H0Z" fill="#21252e"/><path d="M0 116H280M0 123H280" stroke="#8c8170" opacity=".55"/><path d="M45 74h210q12 0 12 12v22H39V82q0-8 6-8Z" fill="#445160"/><path d="M49 82h20v13H49m34-13h20v13H83m34-13h20v13h-20m34-13h20v13h-20m34-13h20v13h-20m34-13h25v13h-25" fill="#d6b783" opacity=".8"/><path d="M39 101h228" stroke="#abb7bb" opacity=".35"/><path d="M19 112V46m-8 0h16" stroke="#929d9f" stroke-width="2"/><path d="M12 49h15" stroke="#ffe4b0" stroke-width="3"/><path d="m0 150 91-22m77 22 15-22" stroke="#74818a" opacity=".6"/>',
        room: '<path d="M0 0h280v150H0Z" fill="#252932"/><path d="M76 17h145v103H76Z" fill="#132332" stroke="#727573" stroke-width="4"/><path d="M149 18v100m-73-51h145" stroke="#727573" stroke-width="3"/><circle cx="117" cy="43" r="1" fill="#fff1d5"/><circle cx="186" cy="89" r="1.2" fill="#fff1d5"/><circle cx="198" cy="39" r="1" fill="#fff1d5"/><path d="M21 121h105v5H21Zm6 5h5v24h-5m86-24h5v24h-5" fill="#67605a"/><path d="M49 119V88m-12 30h25" stroke="#b2a38c" stroke-width="2"/><path d="m35 70-8 20h45l-9-20Z" fill="#e5c79a"/><path d="M82 113h22v7H82" fill="#8a8275"/><path d="M229 97h35v47h-35" fill="#4c514d"/>',
        loop: '<path d="M0 99q67-16 140 0t140-3v54H0Z" fill="#222832"/><path d="M98 150q-2-35 27-43t29-29q0-10-21-17" fill="none" stroke="#737378" stroke-width="7" opacity=".36"/><path d="M180 103V48h34v55m-37-55h40" fill="none" stroke="#899398" stroke-width="3" opacity=".6"/><path d="M145 127q-7-6 2-17 0 8 7 11-1 10-9 6Z" fill="#d7b087"/><path d="M0 104q82-8 150 8t130-2M0 130q77-9 155 0t125-2" fill="none" stroke="#8b9eaa" stroke-width="10" opacity=".075"/>'
    };
    const ICONS = {
        sound: '<path d="m4 9 4 0 5-4v14l-5-4H4Z"/><path class="world-sound-waves" d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
        reset: '<path d="M5 9a8 8 0 1 1 0 6M5 4v5h5"/>',
        close: '<path d="m6 6 12 12M18 6 6 18"/>',
        chevron: '<path d="m7 10 5 5 5-5"/>',
        arrow: '<path d="m7 13 5-5 5 5"/>',
        place: '<path d="m12 3 8 5v8l-8 5-8-5V8Z"/><path d="m4 8 8 5 8-5m-8 5v8"/>'
    };
    const icon = name => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
    const svgScene = id => '<svg viewBox="0 0 280 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="M0 0h280v150H0Z" fill="#111c2a"/><g fill="#e0e9ef" opacity=".7"><circle cx="25" cy="26" r=".8"/><circle cx="78" cy="38" r="1"/><circle cx="132" cy="15" r=".7"/><circle cx="206" cy="23" r=".8"/><circle cx="253" cy="51" r="1"/><circle cx="46" cy="64" r=".7"/><circle cx="166" cy="46" r=".6"/></g>' + ART[id] + '</svg>';

    function boot() {
        if (document.getElementById('worldPlaceButton')) return;
        let root = document.getElementById('environmentUI');
        if (!root) { root = document.createElement('div'); root.id = 'environmentUI'; document.body.appendChild(root); }
        root.innerHTML = '<div class="world-dock">' +
            '<button class="world-place-button" id="worldPlaceButton" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="worldMenu">' +
            '<span class="world-place-symbol">' + icon('place') + '</span><span class="world-place-copy"><span class="world-eyebrow" data-world-copy="where"></span><strong id="worldCurrentName"></strong></span><kbd>M</kbd></button>' +
            '</div><div class="world-hud" id="worldHud"><button class="world-interaction" id="worldInteract" type="button" hidden><kbd>E</kbd><span></span></button>' +
            '<p class="world-action-message" id="worldActionMessage" role="status" aria-live="polite" aria-atomic="true" hidden></p><p class="world-walk-hint" id="worldWalkHint"></p><p class="world-distance" id="worldDistance"></p></div>' +
            '<div class="world-touch-pad" id="worldTouchPad" role="group"><button type="button" data-world-move="forward">' + icon('arrow') + '</button><button type="button" data-world-move="left">' + icon('arrow') + '</button><span aria-hidden="true"></span><button type="button" data-world-move="right">' + icon('arrow') + '</button><button type="button" data-world-move="back">' + icon('arrow') + '</button><button type="button" data-world-throttle="1">+</button><button type="button" data-world-throttle="-1">−</button></div>' +
            '<div class="world-modal" id="worldModal" hidden><div class="world-menu-backdrop" data-world-dismiss></div><section class="world-menu" id="worldMenu" role="dialog" aria-modal="true" aria-labelledby="worldMenuTitle" aria-describedby="worldMenuIntro" tabindex="-1">' +
            '<header class="world-menu-header"><div><span class="world-eyebrow" data-world-copy="choose"></span><h2 id="worldMenuTitle" data-world-copy="title"></h2><p id="worldMenuIntro" data-world-copy="intro"></p></div><button class="world-icon-button world-menu-close" id="worldMenuClose" type="button">' + icon('close') + '</button></header>' +
            '<div class="world-cards">' + SCENES.map((id, index) => '<button class="world-card" type="button" data-world-id="' + id + '" aria-pressed="false"><span class="world-card-art world-art-' + id + '">' + svgScene(id) + '<span class="world-card-number">0' + (index + 1) + '</span><span class="world-card-current" data-world-copy="current"></span></span><span class="world-card-copy"><strong data-world-name="' + id + '"></strong><span data-world-description="' + id + '"></span><small data-world-tag="' + id + '"></small></span></button>').join('') + '</div>' +
            '<footer class="world-menu-footer"><div class="world-view-control" role="group" id="worldViewControl"><button type="button" data-world-mode="observe" aria-pressed="true" data-world-copy="observe"></button><button type="button" data-world-mode="explore" aria-pressed="false" data-world-copy="explore"></button><button type="button" data-world-mode="sky" aria-pressed="false" data-world-copy="sky"></button></div><div class="world-view-control world-sky-control" role="group" id="worldSkyControl"><button type="button" data-world-sky="clear">Day</button><button type="button" data-world-sky="dusk">Dusk</button></div><div class="world-quality-control" role="group" id="worldQualityControl"><button type="button" data-world-quality="auto">Auto</button><button type="button" data-world-quality="high">High</button><button type="button" data-world-quality="medium">Medium</button><button type="button" data-world-quality="low">Low</button></div><div class="world-menu-tools"><button class="world-sound-button" id="worldSound" type="button" aria-pressed="false">' + icon('sound') + '<span></span></button><button class="world-icon-button" id="worldReset" type="button">' + icon('reset') + '</button></div></footer>' +
            '<p class="world-load-status" id="worldLoadStatus" role="status"></p></section></div>' +
            '<div class="world-arrival" id="worldArrival" aria-hidden="true"><span class="world-eyebrow" data-world-copy="entered"></span><strong></strong></div><div class="sr-only" id="worldAnnouncement" role="status" aria-live="polite" aria-atomic="true"></div>';

        const byId = id => document.getElementById(id);
        const placeButton = byId('worldPlaceButton'), modal = byId('worldModal'), menu = byId('worldMenu');
        const name = byId('worldCurrentName'), hud = byId('worldHud'), interaction = byId('worldInteract');
        const sound = byId('worldSound'), pad = byId('worldTouchPad'), status = byId('worldLoadStatus');
        const arrival = byId('worldArrival'), announcement = byId('worldAnnouncement'), actionMessage = byId('worldActionMessage');
        const menuTitle = byId('worldMenuTitle');
        let api, lang = '', t, snapshot = {}, open = false, suspended = false, mode = 'observe', quality = 'auto';
        let restoreFocus, arrivalTimer, lastId, lastReady = false, lastInfo = '', lastInteraction = '';
        let unsubscribe, boundApi, pendingSelection = null;
        const heldMoves = new Map();
        let unlockTapCount = 0, unlockTapTimer;
        const coarse = window.matchMedia('(pointer: coarse)');
        const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
        const setAttr = (node, attr, value) => { if (node.getAttribute(attr) !== String(value)) node.setAttribute(attr, value); };
        const classState = (node, cls, value) => { if (node.classList.contains(cls) !== value) node.classList.toggle(cls, value); };
        const isBlocked = () => ['panel-open', 'celestial-open', 'section-drawer-open', 'celestial-transition', 'celestial-closeup', 'celestial-returning'].some(cls => document.body.classList.contains(cls)) || Boolean(document.querySelector('.lightbox.active'));
        const isTyping = node => node instanceof Element && Boolean(node.closest('input,textarea,select,[contenteditable="true"]'));
        const canFocus = node => node instanceof HTMLElement && node.isConnected && node !== document.body && !node.closest('[hidden],[inert]') && node.getClientRects().length > 0;
        const localText = value => typeof value === 'string' ? value : value && (value[lang] || value.en) || '';
        function language() {
            const next = document.body.classList.contains('lang-zh-TW') ? 'zh-TW' : document.body.classList.contains('lang-zh-CN') ? 'zh-CN' : (COPY[document.documentElement.lang] ? document.documentElement.lang : 'en');
            if (next === lang) return;
            lang = next; t = COPY[lang];
            root.querySelectorAll('[data-world-copy]').forEach(node => setText(node, t[node.dataset.worldCopy]));
            for (const id of SCENES) {
                setText(root.querySelector('[data-world-name="' + id + '"]'), t[id][0]);
                setText(root.querySelector('[data-world-description="' + id + '"]'), t[id][1]);
                setText(root.querySelector('[data-world-tag="' + id + '"]'), t[id][2]);
            }
            setAttr(byId('worldMenuClose'), 'aria-label', t.close);
            setAttr(byId('worldReset'), 'aria-label', t.reset); setAttr(byId('worldReset'), 'title', t.reset);
            setAttr(byId('worldViewControl'), 'aria-label', t.switchMode);
            setAttr(byId('worldQualityControl'), 'aria-label', t.quality);
            root.querySelectorAll('[data-world-quality]').forEach(node => setText(node, t[node.dataset.worldQuality]));
            root.querySelectorAll('[data-world-sky]').forEach(node => setText(node, t[node.dataset.worldSky]));
            setAttr(pad, 'aria-label', t.move);
            pad.querySelectorAll('[data-world-move]').forEach(node => setAttr(node, 'aria-label', t[node.dataset.worldMove]));
            pad.querySelectorAll('[data-world-throttle]').forEach(node => setAttr(node, 'aria-label', Number(node.dataset.worldThrottle) > 0 ? t.throttleUp : t.throttleDown));
            lastId = null; lastInfo = ''; lastInteraction = ''; refresh();
        }
        function stopMotion() {
            heldMoves.clear(); pad.querySelectorAll('.is-held').forEach(node => node.classList.remove('is-held'));
            if (api && typeof api.setMotion === 'function') api.setMotion(0, 0);
            api?.setThrottle?.(0);
        }
        function updateMotion() {
            let forward = 0, strafe = 0, thrust = 0;
            heldMoves.forEach(value => { if (value === 'forward') forward++; if (value === 'back') forward--; if (value === 'left') strafe--; if (value === 'right') strafe++; if (value === 'throttleUp') thrust++; if (value === 'throttleDown') thrust--; });
            if (api && typeof api.setMotion === 'function') api.setMotion(Math.max(-1, Math.min(1, forward)), Math.max(-1, Math.min(1, strafe)));
            api?.setThrottle?.(Math.max(-1, Math.min(1, thrust)));
        }
        function menuState(value, restore = true) {
            if (open === value || (value && isBlocked())) return;
            open = value; stopMotion();
            if (open) {
                restoreFocus = document.activeElement;
                if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
            }
            classState(document.body, 'world-menu-open', open);
            modal.hidden = !open;
            setAttr(placeButton, 'aria-expanded', open);
            document.dispatchEvent(new CustomEvent('nightworld:menu', { detail: { open } }));
            if (open) {
                const active = menu.querySelector('[data-world-id="' + (snapshot.id || 'spaceship') + '"]');
                (active || byId('worldMenuClose')).focus({ preventScroll: true });
            } else if (restore && !isBlocked()) {
                const target = canFocus(restoreFocus) ? restoreFocus : placeButton;
                if (canFocus(target)) target.focus({ preventScroll: true });
            }
        }
        function showArrival(id) {
            if (!t[id]) return;
            clearTimeout(arrivalTimer);
            setText(arrival.querySelector('strong'), t[id][0]);
            setText(announcement, t.entered + ' ' + t[id][0]);
            classState(arrival, 'is-visible', true);
            arrivalTimer = setTimeout(() => classState(arrival, 'is-visible', false), 2500);
        }
        function changeMode(next) {
            stopMotion();
            if (api && typeof api.setViewMode === 'function' && api.setViewMode(next) !== false) mode = next;
            refresh();
        }
        function refresh() {
            if (!t) return;
            api = window.NightWorld;
            if (api && api !== boundApi) {
                if (unsubscribe) unsubscribe();
                boundApi = api;
                if (typeof api.onChange === 'function') unsubscribe = api.onChange(() => refresh());
            }
            if (api && typeof api.getSnapshot === 'function') snapshot = api.getSnapshot() || {};
            if (snapshot.panorama?.quality) quality = snapshot.panorama.quality;
            const ready = Boolean(api && (snapshot.ready == null ? api.ready : snapshot.ready));
            const id = SCENES.includes(snapshot.id || (api && api.currentId)) ? (snapshot.id || api.currentId) : 'spaceship';
            const currentMode = snapshot.mode || (api && api.mode);
            if (currentMode === 'observe' || currentMode === 'explore' || currentMode === 'sky') mode = currentMode;
            const blocked = isBlocked();
            if (blocked !== suspended) {
                suspended = blocked; classState(root, 'world-ui-suspended', blocked);
                if (blocked) { menuState(false, false); stopMotion(); }
                root.inert = blocked;
            }
            classState(document.body, 'world-explore-mode', mode === 'explore');
            classState(document.body, 'world-observe-mode', mode === 'observe');
            classState(document.body, 'world-sky-mode', mode === 'sky');
            classState(root, 'world-piloting', Boolean(snapshot.piloting));
            classState(root, 'world-ready', ready);
            if (id !== lastId) {
                lastId = id; setText(name, t[id][0]);
                setAttr(placeButton, 'aria-label', t.choose + ' · ' + t[id][0]);
                root.querySelectorAll('[data-world-id]').forEach(node => setAttr(node, 'aria-pressed', node.dataset.worldId === id));
                if (pendingSelection === id) { pendingSelection = null; showArrival(id); }
            }
            root.querySelectorAll('[data-world-mode]').forEach(node => {
                setAttr(node, 'aria-pressed', node.dataset.worldMode === mode);
                node.hidden = node.dataset.worldMode === 'explore' && !snapshot.explorationUnlocked;
            });
            root.querySelectorAll('[data-world-sky]').forEach(node => {
                const available = ['hogwarts','snowmountain'].includes(id);
                node.hidden = !available; setAttr(node, 'aria-pressed', available && node.dataset.worldSky === snapshot.skyMode);
            });
            byId('worldSkyControl').hidden = !['hogwarts','snowmountain'].includes(id);
            byId('worldQualityControl').hidden = mode !== 'observe';
            root.querySelectorAll('[data-world-quality]').forEach(node => setAttr(node, 'aria-pressed', node.dataset.worldQuality === quality));
            const audioEnabled = Boolean(snapshot.audioEnabled);
            setAttr(sound, 'aria-pressed', audioEnabled);
            setAttr(sound, 'aria-label', t.sound + ' · ' + (audioEnabled ? t.soundOn : t.soundOff));
            setText(sound.querySelector('span'), audioEnabled ? t.soundOn : t.soundOff);
            const loadError = snapshot.error || (api && api.error);
            const panoramaStatus = mode === 'observe' ? snapshot.panorama : null;
            const renderedLabel = panoramaStatus?.production === 'approved' ? t.rendered : panoramaStatus?.production === 'review' ? t.renderedReview : t.renderedDraft;
            const panoramaText = panoramaStatus?.status === 'preview' ? t.preview : panoramaStatus?.status === 'error' ? t.renderError : panoramaStatus?.status === 'loading' ? t.loading : panoramaStatus?.status === 'prerendered' ? renderedLabel + (panoramaStatus.tier ? ' · ' + t[panoramaStatus.tier] : '') : '';
            setText(status, loadError ? t.error : panoramaText || (ready ? '' : t.loading));
            status.hidden = ready && !loadError && !panoramaText;
            byId('worldReset').disabled = !ready;
            sound.disabled = !ready;
            root.querySelectorAll('[data-world-id]').forEach(node => { node.disabled = !ready; });
            const item = snapshot.interaction;
            const label = item && localText(item.label).replace(snapshot.piloting ? /^F\s*·\s*/ : /^E\s*·\s*/, '');
            const interactionText = ready && mode === 'explore' && label ? label : '';
            if (interactionText !== lastInteraction) {
                lastInteraction = interactionText;
                interaction.hidden = !interactionText;
                setText(interaction.querySelector('span'), interactionText);
                setAttr(interaction, 'aria-label', interactionText || t.interact);
            }
            setText(interaction.querySelector('kbd'), snapshot.piloting ? 'F' : 'E');
            const messageText = ready && mode !== 'sky' ? localText(snapshot.message) : '';
            setText(actionMessage, messageText);
            actionMessage.hidden = !messageText;
            const hint = mode === 'sky' ? t.skyHint : mode === 'observe' ? (snapshot.piloting ? (coarse.matches ? t.touchPilotHint : t.pilotHint) : t.observeHint) : snapshot.piloting ? (coarse.matches ? t.touchPilotHint : t.pilotHint) : coarse.matches ? t.touchHint : t.walk + '     ' + t.hint;
            setText(byId('worldWalkHint'), hint + (snapshot.piloting && mode === 'explore' && !coarse.matches ? '\n' + t.leaveSeat : ''));
            pad.querySelectorAll('[data-world-move]').forEach(node => {
                const direction = node.dataset.worldMove;
                const key = snapshot.piloting ? 'pilot' + direction.charAt(0).toUpperCase() + direction.slice(1) : direction;
                setAttr(node, 'aria-label', t[key]);
            });
            pad.querySelectorAll('[data-world-throttle]').forEach(node => { node.hidden = !snapshot.piloting; });
            let info = '';
            if (ready && mode !== 'sky') {
                if (snapshot.piloting) info = t.pilot + '  ·  ' + Math.round(Number(snapshot.speed) || 0) + ' m/s';
                else if (Number(snapshot.distance) >= 1) info = t.distance + '  ' + Math.floor(snapshot.distance) + ' m';
            }
            if (info !== lastInfo) { lastInfo = info; setText(byId('worldDistance'), info); }
            hud.hidden = !ready || open;
            pad.hidden = !ready || mode === 'sky' || (mode === 'observe' && !snapshot.piloting) || open;
            if (lastReady && !ready) stopMotion();
            lastReady = ready;
        }

        placeButton.addEventListener('click', () => menuState(true));
        menuTitle.addEventListener('click', () => {
            unlockTapCount += 1; clearTimeout(unlockTapTimer);
            unlockTapTimer = setTimeout(() => { unlockTapCount = 0; }, 1400);
            if (unlockTapCount >= 5) { unlockTapCount = 0; api?.unlockExploration?.(); refresh(); }
        });
        byId('worldMenuClose').addEventListener('click', () => menuState(false));
        root.querySelector('[data-world-dismiss]').addEventListener('click', () => menuState(false));
        root.querySelectorAll('[data-world-id]').forEach(button => button.addEventListener('click', () => {
            if (!api || button.disabled) return;
            const id = button.dataset.worldId;
            if (id !== snapshot.id) {
                pendingSelection = id;
                api.select(id);
            }
            if (mode === 'sky') changeMode('observe');
            menuState(false); refresh();
        }));
        root.querySelectorAll('[data-world-mode]').forEach(button => button.addEventListener('click', () => {
            if (button.dataset.worldMode === 'explore' && !snapshot.explorationUnlocked) return;
            changeMode(button.dataset.worldMode);
        }));
        root.querySelectorAll('[data-world-sky]').forEach(button => button.addEventListener('click', () => {
            if (api?.setSkyMode?.(button.dataset.worldSky)) refresh();
        }));
        root.querySelectorAll('[data-world-quality]').forEach(button => button.addEventListener('click', () => {
            quality = button.dataset.worldQuality; window.NightPanorama?.setQuality?.(quality); refresh();
        }));
        byId('worldReset').addEventListener('click', () => { if (api && api.reset) api.reset(); menuState(false); showArrival(lastId); });
        sound.addEventListener('click', () => { if (api && api.setAudio) api.setAudio(!snapshot.audioEnabled); refresh(); });
        interaction.addEventListener('click', () => { if (api && api.interact) api.interact(); refresh(); });
        root.addEventListener('pointerdown', event => event.stopPropagation());
        root.addEventListener('wheel', event => event.stopPropagation(), { passive: true });
        document.addEventListener('keydown', event => {
            if (isTyping(event.target)) return;
            if (event.code === 'KeyE' && event.shiftKey && event.altKey && !event.ctrlKey && !event.metaKey) { event.preventDefault(); api?.unlockExploration?.(); refresh(); return; }
            if ((event.code === 'KeyM' || event.key.toLowerCase() === 'm') && !event.ctrlKey && !event.metaKey && !event.altKey && !isBlocked()) {
                event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) menuState(!open); return;
            }
            if (!open) return;
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); menuState(false); return; }
            if (event.key === 'Tab') {
                const buttons = Array.from(menu.querySelectorAll('button:not(:disabled),[tabindex="0"]')).filter(node => !node.hidden && node.getClientRects().length);
                const first = buttons[0], last = buttons[buttons.length - 1];
                if (!buttons.length) { event.preventDefault(); menu.focus(); }
                else if (event.shiftKey && (document.activeElement === first || !menu.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
                else if (!event.shiftKey && (document.activeElement === last || !menu.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
            }
            event.stopImmediatePropagation();
        }, true);
        document.addEventListener('focusin', event => {
            if (open && !menu.contains(event.target)) byId('worldMenuClose').focus({ preventScroll: true });
        });
        // The touch pad owns only its own pointers; the rest of the screen keeps
        // the existing sky's drag gestures, including multi-touch focusing.
        pad.querySelectorAll('button').forEach(button => {
            button.addEventListener('pointerdown', event => {
                if (event.button !== 0 || open || suspended || mode === 'sky' || (mode === 'observe' && !snapshot.piloting)) return;
                event.preventDefault(); button.setPointerCapture(event.pointerId);
                heldMoves.set(event.pointerId, button.dataset.worldMove || (Number(button.dataset.worldThrottle) > 0 ? 'throttleUp' : 'throttleDown')); button.classList.add('is-held'); updateMotion();
            });
            const release = event => { heldMoves.delete(event.pointerId); button.classList.remove('is-held'); updateMotion(); };
            button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
            button.addEventListener('keydown', event => {
                if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); heldMoves.set('keyboard', button.dataset.worldMove || (Number(button.dataset.worldThrottle) > 0 ? 'throttleUp' : 'throttleDown')); button.classList.add('is-held'); updateMotion(); }
            });
            button.addEventListener('keyup', event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); heldMoves.delete('keyboard'); button.classList.remove('is-held'); updateMotion(); } });
            button.addEventListener('blur', () => { if (heldMoves.has('keyboard')) stopMotion(); });
        });
        window.addEventListener('blur', stopMotion);
        document.addEventListener('visibilitychange', () => { if (document.hidden) stopMotion(); });
        window.addEventListener('nightworld:ready', refresh);
        window.addEventListener('nightpanorama:change', refresh);
        const observer = new MutationObserver(() => { language(); refresh(); });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        language(); refresh();
        // State labels are sampled, not rendered on every animation frame.
        window.setInterval(() => { if (!document.hidden) refresh(); }, 50);
        window.NightWorldUI = { open: () => menuState(true), close: () => menuState(false) };
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
