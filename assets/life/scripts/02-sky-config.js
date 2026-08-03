const LANGUAGES = ['en', 'zh-CN', 'zh-TW'];
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE_POINTER = window.matchMedia('(hover: none), (pointer: coarse)').matches;
const DEG = Math.PI / 180;
const MIN_CAMERA_ALTITUDE = 0.25 * DEG;
const ROUTE_PITCH_LIMIT = 89.5 * DEG;
const HORIZON_NEAR_ALTITUDE = 8 * DEG;
const GEOMETRIC_HORIZON_EPSILON = 1e-6;
const COMPACT_SKY_MAX_WIDTH = 1024;
const COMPACT_SKY_MAX_ASPECT = 3 / 2;
const COMPACT_SKY_NARROW_MAX_ASPECT = 16 / 9;
const SHORT_SKY_MAX_HEIGHT = 520;
const SHORT_SKY_MIN_ASPECT = 3 / 2;
const WEATHER_LOCATION_STORAGE_KEY = 'runde:weather-location:v1';
const DEFAULT_OBSERVER_LOCATION = Object.freeze({
    v: 1,
    latitude: 31.23,
    longitude: 121.47,
    height: 0,
    timezone: 'Asia/Shanghai',
    label: {
        en: 'Shanghai',
        'zh-CN': '上海',
        'zh-TW': '上海'
    },
    source: 'life-fallback'
});
const INITIAL_CAMERA = Object.freeze({
    yaw: 0.25,
    pitch: 0.72
});

function readWeatherObserverLocation() {
    try {
        const parsed = JSON.parse(localStorage.getItem(WEATHER_LOCATION_STORAGE_KEY));
        const valid = parsed &&
            parsed.v === 1 &&
            Number.isFinite(parsed.latitude) &&
            parsed.latitude >= -90 &&
            parsed.latitude <= 90 &&
            Number.isFinite(parsed.longitude) &&
            parsed.longitude >= -180 &&
            parsed.longitude <= 180;
        if (!valid) return { ...DEFAULT_OBSERVER_LOCATION };
        return {
            ...DEFAULT_OBSERVER_LOCATION,
            ...parsed,
            height: Number.isFinite(parsed.height) ? parsed.height : 0,
            label: parsed.label || DEFAULT_OBSERVER_LOCATION.label
        };
    } catch (error) {
        return { ...DEFAULT_OBSERVER_LOCATION };
    }
}

const skyModel = {
    available: Boolean(
        window.Astronomy?.Observer &&
        window.Astronomy?.Rotation_EQJ_HOR &&
        window.Astronomy?.Rotation_HOR_EQJ
    ),
    location: readWeatherObserverLocation(),
    observer: null,
    time: null,
    date: null,
    eqjToHor: null,
    horToEqj: null,
    nextRefreshAt: 0,
    refreshInterval: 15000
};

const portalDefinitions = [
    {
        id: 'gallery',
        titleKey: 'title_gallery',
        fallbackYaw: -0.64,
        fallbackPitch: 0.17,
        pattern: 'cassiopeia'
    },
    {
        id: 'footprints',
        titleKey: 'title_map',
        fallbackYaw: 0.04,
        fallbackPitch: 0.1,
        pattern: 'ursaMajor'
    },
    {
        id: 'shelf',
        titleKey: 'title_shelf',
        fallbackYaw: 0.72,
        fallbackPitch: 0.28,
        pattern: 'lyra'
    },
    {
        id: 'thoughts',
        titleKey: 'title_thoughts',
        fallbackYaw: 1.46,
        fallbackPitch: -0.08,
        pattern: 'cygnus'
    },
    {
        id: 'friends',
        titleKey: 'title_friends',
        fallbackYaw: -1.36,
        fallbackPitch: -0.24,
        pattern: 'gemini'
    },
    {
        id: 'news',
        titleKey: 'title_news',
        fallbackYaw: -2.02,
        fallbackPitch: 0.24,
        pattern: 'aquila'
    },
    {
        id: 'publications',
        titleKey: 'title_publications',
        fallbackYaw: 2.5,
        fallbackPitch: 0.18,
        pattern: 'pegasus'
    },
    {
        id: 'projects',
        titleKey: 'title_projects',
        fallbackYaw: 2,
        fallbackPitch: 0.5,
        pattern: 'hercules'
    },
    {
        id: 'notes',
        titleKey: 'title_notes',
        fallbackYaw: 1.18,
        fallbackPitch: 0.52,
        pattern: 'coronaBorealis'
    },
    {
        id: 'home',
        titleKey: 'title_home',
        fallbackYaw: 3.02,
        fallbackPitch: 0.04,
        pattern: 'ursaMinor',
        home: true
    }
];

const constellationPatterns = {
    cassiopeia: {
        hips: [4427, 746, 3179, 6686, 8886],
        contentOrder: [746, 3179, 4427, 6686, 8886],
        focusHip: 4427,
        fallbackPoints: [[0,0],[-0.07,0.045],[-0.035,0.012],[0.034,0.048],[0.072,0.008]],
        edges: [[1,2],[2,0],[0,3],[3,4]]
    },
    ursaMajor: {
        hips: [59774, 54061, 53910, 58001, 62956, 65378, 67301],
        contentOrder: [54061, 53910, 58001, 59774, 62956, 65378, 67301],
        focusHip: 59774,
        fallbackPoints: [[0,0],[-0.065,0.042],[-0.062,-0.028],[-0.012,-0.047],[0.034,0.012],[0.063,0.027],[0.092,0.006]],
        edges: [[1,2],[2,3],[3,0],[0,1],[0,4],[4,5],[5,6]]
    },
    lyra: {
        hips: [91262, 91971, 92420, 93194, 92791],
        contentOrder: [91262, 91971, 92420, 93194, 92791],
        focusHip: 91262,
        fallbackPoints: [[0,0.075],[-0.035,0.018],[-0.025,-0.045],[0.04,-0.052],[0.052,0.012]],
        edges: [[0,1],[1,2],[2,3],[3,4],[4,1]]
    },
    cygnus: {
        hips: [100453, 102098, 95947, 97165, 102488],
        contentOrder: [102098, 100453, 95947, 97165, 102488],
        focusHip: 100453,
        fallbackPoints: [[0,0],[0,0.08],[0,-0.085],[-0.07,0.005],[0.07,-0.006]],
        edges: [[1,0],[0,2],[3,0],[0,4]]
    },
    gemini: {
        hips: [35550, 36850, 37826, 32246, 30343, 31681],
        contentOrder: [36850, 37826, 32246, 35550, 30343, 31681],
        focusHip: 35550,
        fallbackPoints: [[0,0],[-0.03,0.075],[0.045,0.07],[-0.045,0.018],[-0.072,-0.055],[0.06,-0.055]],
        edges: [[1,2],[1,3],[3,4],[2,0],[0,5],[3,0]]
    },
    orion: {
        hips: [26207, 27989, 25336, 26727, 26311, 25930, 27366, 24436],
        contentOrder: [27989, 24436, 25336, 27366, 26207, 26311, 26727, 25930],
        focusHip: 26311,
        fallbackPoints: [[0,0.09],[-0.06,0.045],[0.055,0.05],[-0.035,0],[0,0],[0.035,0],[-0.055,-0.09],[0.06,-0.085]],
        edges: [[0,1],[0,2],[1,3],[2,5],[3,4],[4,5],[3,6],[5,7]]
    },
    aquila: {
        hips: [97649, 97278, 98036, 95501, 93747, 93244, 97804, 99473, 93805],
        contentOrder: [97649, 93244, 99473, 93805, 93747, 98036, 97278, 97804, 95501],
        focusHip: 97649,
        fallbackPoints: [[0,0],[-0.012,0.047],[0.018,-0.037],[-0.055,0.006],[-0.1,0.045],[-0.13,0.07],[0.052,-0.018],[0.105,-0.055],[-0.09,-0.035]],
        edges: [[5,4],[4,3],[3,0],[0,6],[6,7],[1,0],[0,2],[3,8]]
    },
    pegasus: {
        hips: [113963, 113881, 677, 1067, 112029, 109427, 107315],
        contentOrder: [113963, 677, 113881, 1067, 107315, 112029, 109427],
        focusHip: 113963,
        fallbackPoints: [[0.04,-0.045],[0.04,0.055],[-0.065,0.06],[-0.065,-0.045],[0.095,-0.06],[0.14,-0.065],[0.195,-0.08]],
        edges: [[0,1],[1,2],[2,3],[3,0],[0,4],[4,5],[5,6]]
    },
    hercules: {
        hips: [81833, 84380, 83207, 81693, 80816, 80170, 84379, 84345],
        contentOrder: [81693, 84380, 81833, 83207, 84345, 80170, 80816, 84379],
        focusHip: 83207,
        fallbackPoints: [[-0.035,0.04],[0.04,0.05],[0.045,-0.025],[-0.035,-0.035],[-0.09,-0.07],[-0.14,-0.09],[0.095,-0.065],[0.14,-0.1]],
        edges: [[0,1],[1,2],[2,3],[3,0],[3,4],[4,5],[2,6],[6,7]]
    },
    coronaBorealis: {
        hips: [76267, 75695, 76127, 76669, 76952, 77512, 78159, 78493, 79119],
        contentOrder: [76267, 76669, 79119, 75695, 78493, 76127, 78159, 76952, 77512],
        focusHip: 76267,
        fallbackPoints: [[0,-0.055],[-0.04,-0.035],[-0.075,-0.005],[-0.1,0.035],[0.04,-0.035],[0.075,-0.005],[0.095,0.035],[0.085,0.075],[0.055,0.105]],
        edges: [[0,1],[1,2],[2,3],[0,4],[4,5],[5,6],[6,7],[7,8]]
    },
    ursaMinor: {
        hips: [11767, 85822, 82080, 79822, 77055, 72607, 75097, 70692, 69112, 74605, 73199],
        contentOrder: [11767, 85822, 82080, 79822, 77055, 72607, 75097, 70692, 69112, 74605, 73199],
        focusHip: 11767,
        fallbackPoints: [[0,0],[-0.02,-0.038],[-0.046,-0.06],[-0.067,-0.035],[-0.06,0.012],[-0.018,0.035],[0.012,0.006],[0.01,0.066],[0.038,0.09],[-0.065,0.085],[-0.09,0.12]],
        edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,3],[5,7],[7,8],[6,9],[9,10]]
    }
};

const constellationStories = {
    gallery: {
        name: { en: 'Cassiopeia', 'zh-CN': '仙后座', 'zh-TW': '仙后座' },
        epithet: {
            en: 'The five-frame queen',
            'zh-CN': '五格天幕中的王后',
            'zh-TW': '五格天幕中的王后'
        },
        reason: {
            en: 'Cassiopeia’s unmistakable W reads like five frames hung across the northern sky. A constellation defined by being seen becomes the natural home for photographs and remembered light.',
            'zh-CN': '仙后座醒目的 W 像五只连续悬在北天的取景框。一个因“被看见”而格外鲜明的星座，正适合安放照片与被记住的光。',
            'zh-TW': '仙后座醒目的 W 像五隻連續懸在北天的取景框。一個因「被看見」而格外鮮明的星座，正適合安放照片與被記住的光。'
        }
    },
    footprints: {
        name: { en: 'Ursa Major · Big Dipper', 'zh-CN': '大熊座 · 北斗', 'zh-TW': '大熊座 · 北斗' },
        epithet: {
            en: 'The old instrument of direction',
            'zh-CN': '古老的辨向仪',
            'zh-TW': '古老的辨向儀'
        },
        reason: {
            en: 'Dubhe and Merak point onward to Polaris. For generations the Dipper has turned travel into direction, so every place reached belongs naturally along this celestial route.',
            'zh-CN': '天枢与天璇把视线引向北极星。北斗长久以来把远行变成方向，因此每一处抵达，都适合留在这条天上的路径上。',
            'zh-TW': '天樞與天璇把視線引向北極星。北斗長久以來把遠行變成方向，因此每一處抵達，都適合留在這條天上的路徑上。'
        }
    },
    shelf: {
        name: { en: 'Lyra', 'zh-CN': '天琴座', 'zh-TW': '天琴座' },
        epithet: {
            en: 'Works that continue to resonate',
            'zh-CN': '仍在回响的作品',
            'zh-TW': '仍在迴響的作品'
        },
        reason: {
            en: 'Lyra turns separate stars into the strings of one instrument. Books, films, music and art gather here not as a list, but as works that keep resonating after they end.',
            'zh-CN': '天琴座把分散的星连成同一件乐器。书、电影、音乐与艺术在这里不是清单，而是结束之后仍会回响的作品。',
            'zh-TW': '天琴座把分散的星連成同一件樂器。書、電影、音樂與藝術在這裡不是清單，而是結束之後仍會迴響的作品。'
        }
    },
    thoughts: {
        name: { en: 'Cygnus · Northern Cross', 'zh-CN': '天鹅座 · 北十字', 'zh-TW': '天鵝座 · 北十字' },
        epithet: {
            en: 'A timeline with branching wings',
            'zh-CN': '带着双翼的时间线',
            'zh-TW': '帶著雙翼的時間線'
        },
        reason: {
            en: 'Cygnus stretches along the Milky Way: its long axis reads as time, while its wings open like a thought dividing into new directions. Each diary entry becomes one stop in that inward flight.',
            'zh-CN': '天鹅座沿银河伸展：长轴像时间，双翼则像一段思绪向不同方向分岔。每篇日记，都是这次向内飞行的一站。',
            'zh-TW': '天鵝座沿銀河伸展：長軸像時間，雙翼則像一段思緒向不同方向分岔。每篇日記，都是這次向內飛行的一站。'
        }
    },
    friends: {
        name: { en: 'Gemini', 'zh-CN': '双子座', 'zh-TW': '雙子座' },
        epithet: {
            en: 'Two lights keeping pace',
            'zh-CN': '并肩前行的两束光',
            'zh-TW': '並肩前行的兩束光'
        },
        reason: {
            en: 'Castor and Pollux make companionship visible: distinct lights travelling side by side. Gemini therefore holds the people and communities whose paths meet this one.',
            'zh-CN': '北河二与北河三让陪伴变得可见：两束不同的光并肩前行。双子座因此收纳那些与这条人生轨迹相遇的人和群体。',
            'zh-TW': '北河二與北河三讓陪伴變得可見：兩束不同的光並肩前行。雙子座因此收納那些與這條人生軌跡相遇的人和群體。'
        }
    },
    about: {
        name: { en: 'Orion', 'zh-CN': '猎户座', 'zh-TW': '獵戶座' },
        epithet: {
            en: 'A portrait drawn in starlight',
            'zh-CN': '由星光勾出的肖像',
            'zh-TW': '由星光勾出的肖像'
        },
        reason: {
            en: 'Orion’s head, shoulders, belt and feet form the sky’s clearest human silhouette. About belongs here because it introduces the person behind every other constellation, not another archive.',
            'zh-CN': '猎户座以头、双肩、腰带和双足组成夜空最清楚的人形，像一幅由星光勾出的肖像。About 放在这里，因为它介绍的是其余星座背后的那个人，而不是另一份档案。',
            'zh-TW': '獵戶座以頭、雙肩、腰帶和雙足組成夜空最清楚的人形，像一幅由星光勾出的肖像。About 放在這裡，因為它介紹的是其餘星座背後的那個人，而不是另一份檔案。'
        }
    },
    news: {
        name: { en: 'Aquila', 'zh-CN': '天鹰座', 'zh-TW': '天鷹座' },
        epithet: {
            en: 'Dispatches carried across the Milky Way',
            'zh-CN': '越过银河的短讯',
            'zh-TW': '越過銀河的短訊'
        },
        reason: {
            en: 'Aquila crosses the Milky Way in flight. Altair and its flanking stars form the first clear signal, while the wings carry brief dispatches outward; each News item is a flash of arrival on one continuing route.',
            'zh-CN': '天鹰座展翼越过银河，牛郎星与两侧恒星组成最清楚的信号，双翼再把短讯送向远处。每条 News 都是一瞬抵达，也共同留下连续的时间航迹。',
            'zh-TW': '天鷹座展翼越過銀河，牛郎星與兩側恆星組成最清楚的信號，雙翼再把短訊送向遠處。每條 News 都是一瞬抵達，也共同留下連續的時間航跡。'
        }
    },
    publications: {
        name: { en: 'Pegasus · Great Square', 'zh-CN': '飞马座 · 秋季四边形', 'zh-TW': '飛馬座 · 秋季四邊形' },
        epithet: {
            en: 'Research given a page and wings',
            'zh-CN': '让研究拥有页面与翅膀',
            'zh-TW': '讓研究擁有頁面與翅膀'
        },
        reason: {
            en: 'In myth, Pegasus opened Hippocrene—the Muses’ spring—with a hoofbeat. The Great Square reads like a page, and the horse’s line carries finished research outward: insight made public and given wings.',
            'zh-CN': '传说飞马一踏涌出缪斯之泉 Hippocrene。秋季四边形像展开的一页，飞马的星线再把完成的研究送向远方：让洞见成为公开作品，也让它获得翅膀。',
            'zh-TW': '傳說飛馬一踏湧出繆斯之泉 Hippocrene。秋季四邊形像展開的一頁，飛馬的星線再把完成的研究送向遠方：讓洞見成為公開作品，也讓它獲得翅膀。'
        }
    },
    projects: {
        name: { en: 'Hercules', 'zh-CN': '武仙座', 'zh-TW': '武仙座' },
        epithet: {
            en: 'Intent made into work',
            'zh-CN': '把意图做成作品',
            'zh-TW': '把意圖做成作品'
        },
        reason: {
            en: 'Hercules is remembered through his labors: each challenge became work carried through. Its Keystone supplies a stable architecture and its limbs extend into different tasks, so Projects is where intent becomes something built.',
            'zh-CN': '武仙因一项项劳作而被记住：每个挑战都被真正做完。中央的 Keystone 像稳定架构，向外伸展的四肢像不同任务，因此 Projects 正是把意图变成成品的地方。',
            'zh-TW': '武仙因一項項勞作而被記住：每個挑戰都被真正做完。中央的 Keystone 像穩定架構，向外伸展的四肢像不同任務，因此 Projects 正是把意圖變成成品的地方。'
        }
    },
    notes: {
        name: { en: 'Corona Borealis', 'zh-CN': '北冕座', 'zh-TW': '北冕座' },
        epithet: {
            en: 'Small records completing an open crown',
            'zh-CN': '沿开放冠弧相连的短记',
            'zh-TW': '沿開放冠弧相連的短記'
        },
        reason: {
            en: 'Corona Borealis is an open arc assembled from separate jewels. A note may be small and complete on its own, yet notes placed through time form a larger crown; unlike Thoughts’ inward diary, Notes keeps concise research fragments.',
            'zh-CN': '北冕座是一道由独立宝石连成的开放冠弧。一则笔记可以短小而自足，沿时间排开后又会合成更大的形状；不同于 Thoughts 的内向日记，Notes 收纳简洁的研究片段。',
            'zh-TW': '北冕座是一道由獨立寶石連成的開放冠弧。一則筆記可以短小而自足，沿時間排開後又會合成更大的形狀；不同於 Thoughts 的內向日記，Notes 收納簡潔的研究片段。'
        }
    },
    home: {
        name: { en: 'Ursa Minor', 'zh-CN': '小熊座', 'zh-TW': '小熊座' },
        epithet: {
            en: 'The constellation of return',
            'zh-CN': '归途的星座',
            'zh-TW': '歸途的星座'
        },
        reason: {
            en: 'Polaris remains close to the north celestial pole while the sky turns around it. Here it is Home; nine other real stars in Ursa Minor become direct routes into the visible constellations of this life.',
            'zh-CN': '天空绕北天极旋转，而北极星近乎不动。在这里，它就是 Home；小熊座另外九颗真实恒星成为通往当前生活板块星座的航线。',
            'zh-TW': '天空繞北天極旋轉，而北極星近乎不動。在這裡，它就是 Home；小熊座另外九顆真實恆星成為通往目前生活板塊星座的航線。'
        }
    }
};

const starProfiles = {
    746: { names: { en: 'Caph', 'zh-CN': 'Caph · 仙后座 β', 'zh-TW': 'Caph · 仙后座 β' }, designation: 'β Cassiopeiae' },
    3179: { names: { en: 'Schedar', 'zh-CN': 'Schedar · 仙后座 α', 'zh-TW': 'Schedar · 仙后座 α' }, designation: 'α Cassiopeiae' },
    4427: { names: { en: 'Gamma Cassiopeiae', 'zh-CN': '仙后座 γ', 'zh-TW': '仙后座 γ' }, designation: 'γ Cassiopeiae' },
    6686: { names: { en: 'Ruchbah', 'zh-CN': 'Ruchbah · 仙后座 δ', 'zh-TW': 'Ruchbah · 仙后座 δ' }, designation: 'δ Cassiopeiae' },
    8886: { names: { en: 'Segin', 'zh-CN': 'Segin · 仙后座 ε', 'zh-TW': 'Segin · 仙后座 ε' }, designation: 'ε Cassiopeiae' },
    54061: { names: { en: 'Dubhe', 'zh-CN': '天枢', 'zh-TW': '天樞' }, designation: 'α Ursae Majoris' },
    53910: { names: { en: 'Merak', 'zh-CN': '天璇', 'zh-TW': '天璇' }, designation: 'β Ursae Majoris' },
    58001: { names: { en: 'Phecda', 'zh-CN': '天玑', 'zh-TW': '天璣' }, designation: 'γ Ursae Majoris' },
    59774: { names: { en: 'Megrez', 'zh-CN': '天权', 'zh-TW': '天權' }, designation: 'δ Ursae Majoris' },
    62956: { names: { en: 'Alioth', 'zh-CN': '玉衡', 'zh-TW': '玉衡' }, designation: 'ε Ursae Majoris' },
    65378: { names: { en: 'Mizar', 'zh-CN': '开阳', 'zh-TW': '開陽' }, designation: 'ζ Ursae Majoris' },
    67301: { names: { en: 'Alkaid', 'zh-CN': '摇光', 'zh-TW': '搖光' }, designation: 'η Ursae Majoris' },
    91262: { names: { en: 'Vega', 'zh-CN': '织女一', 'zh-TW': '織女一' }, designation: 'α Lyrae' },
    91971: { names: { en: 'Zeta Lyrae', 'zh-CN': '天琴座 ζ', 'zh-TW': '天琴座 ζ' }, designation: 'ζ Lyrae' },
    92420: { names: { en: 'Sheliak', 'zh-CN': 'Sheliak · 天琴座 β', 'zh-TW': 'Sheliak · 天琴座 β' }, designation: 'β Lyrae' },
    93194: { names: { en: 'Sulafat', 'zh-CN': 'Sulafat · 天琴座 γ', 'zh-TW': 'Sulafat · 天琴座 γ' }, designation: 'γ Lyrae' },
    92791: { names: { en: 'Delta² Lyrae', 'zh-CN': '天琴座 δ²', 'zh-TW': '天琴座 δ²' }, designation: 'δ² Lyrae' },
    102098: { names: { en: 'Deneb', 'zh-CN': '天津四', 'zh-TW': '天津四' }, designation: 'α Cygni' },
    100453: { names: { en: 'Sadr', 'zh-CN': 'Sadr · 天鹅座 γ', 'zh-TW': 'Sadr · 天鵝座 γ' }, designation: 'γ Cygni' },
    95947: { names: { en: 'Albireo', 'zh-CN': 'Albireo · 天鹅座 β', 'zh-TW': 'Albireo · 天鵝座 β' }, designation: 'β Cygni' },
    97165: { names: { en: 'Delta Cygni', 'zh-CN': '天鹅座 δ', 'zh-TW': '天鵝座 δ' }, designation: 'δ Cygni' },
    102488: { names: { en: 'Gienah', 'zh-CN': 'Gienah · 天鹅座 ε', 'zh-TW': 'Gienah · 天鵝座 ε' }, designation: 'ε Cygni' },
    36850: { names: { en: 'Castor', 'zh-CN': '北河二', 'zh-TW': '北河二' }, designation: 'α Geminorum' },
    37826: { names: { en: 'Pollux', 'zh-CN': '北河三', 'zh-TW': '北河三' }, designation: 'β Geminorum' },
    32246: { names: { en: 'Mebsuta', 'zh-CN': 'Mebsuta · 双子座 ε', 'zh-TW': 'Mebsuta · 雙子座 ε' }, designation: 'ε Geminorum' },
    35550: { names: { en: 'Wasat', 'zh-CN': 'Wasat · 双子座 δ', 'zh-TW': 'Wasat · 雙子座 δ' }, designation: 'δ Geminorum' },
    30343: { names: { en: 'Tejat', 'zh-CN': 'Tejat · 双子座 μ', 'zh-TW': 'Tejat · 雙子座 μ' }, designation: 'μ Geminorum' },
    31681: { names: { en: 'Alhena', 'zh-CN': 'Alhena · 双子座 γ', 'zh-TW': 'Alhena · 雙子座 γ' }, designation: 'γ Geminorum' },
    26207: { names: { en: 'Meissa', 'zh-CN': 'Meissa · 猎户座 λ', 'zh-TW': 'Meissa · 獵戶座 λ' }, designation: 'λ Orionis' },
    27989: { names: { en: 'Betelgeuse', 'zh-CN': '参宿四', 'zh-TW': '參宿四' }, designation: 'α Orionis' },
    25336: { names: { en: 'Bellatrix', 'zh-CN': '参宿五', 'zh-TW': '參宿五' }, designation: 'γ Orionis' },
    26727: { names: { en: 'Alnitak', 'zh-CN': '参宿一', 'zh-TW': '參宿一' }, designation: 'ζ Orionis' },
    26311: { names: { en: 'Alnilam', 'zh-CN': '参宿二', 'zh-TW': '參宿二' }, designation: 'ε Orionis' },
    25930: { names: { en: 'Mintaka', 'zh-CN': '参宿三', 'zh-TW': '參宿三' }, designation: 'δ Orionis' },
    27366: { names: { en: 'Saiph', 'zh-CN': '参宿六', 'zh-TW': '參宿六' }, designation: 'κ Orionis' },
    24436: { names: { en: 'Rigel', 'zh-CN': '参宿七', 'zh-TW': '參宿七' }, designation: 'β Orionis' },
    97649: { names: { en: 'Altair', 'zh-CN': '河鼓二 · 牛郎星', 'zh-TW': '河鼓二 · 牛郎星' }, designation: 'α Aquilae' },
    97278: { names: { en: 'Tarazed', 'zh-CN': '河鼓三', 'zh-TW': '河鼓三' }, designation: 'γ Aquilae' },
    98036: { names: { en: 'Alshain', 'zh-CN': '河鼓一', 'zh-TW': '河鼓一' }, designation: 'β Aquilae' },
    95501: { names: { en: 'Delta Aquilae', 'zh-CN': '天鹰座 δ', 'zh-TW': '天鷹座 δ' }, designation: 'δ Aquilae' },
    93747: { names: { en: 'Okab', 'zh-CN': 'Okab · 天鹰座 ζ', 'zh-TW': 'Okab · 天鷹座 ζ' }, designation: 'ζ Aquilae' },
    93244: { names: { en: 'Epsilon Aquilae', 'zh-CN': '天鹰座 ε', 'zh-TW': '天鷹座 ε' }, designation: 'ε Aquilae' },
    97804: { names: { en: 'Eta Aquilae', 'zh-CN': '天鹰座 η', 'zh-TW': '天鷹座 η' }, designation: 'η Aquilae' },
    99473: { names: { en: 'Theta Aquilae', 'zh-CN': '天鹰座 θ', 'zh-TW': '天鷹座 θ' }, designation: 'θ Aquilae' },
    93805: { names: { en: 'Lambda Aquilae', 'zh-CN': '天鹰座 λ', 'zh-TW': '天鷹座 λ' }, designation: 'λ Aquilae' },
    113963: { names: { en: 'Markab', 'zh-CN': '室宿一', 'zh-TW': '室宿一' }, designation: 'α Pegasi' },
    113881: { names: { en: 'Scheat', 'zh-CN': '室宿二', 'zh-TW': '室宿二' }, designation: 'β Pegasi' },
    677: { names: { en: 'Alpheratz', 'zh-CN': '壁宿二 · 仙女座 α', 'zh-TW': '壁宿二 · 仙女座 α' }, designation: 'α Andromedae · Great Square corner' },
    1067: { names: { en: 'Algenib', 'zh-CN': '壁宿一', 'zh-TW': '壁宿一' }, designation: 'γ Pegasi' },
    112029: { names: { en: 'Homam', 'zh-CN': '雷电一', 'zh-TW': '雷電一' }, designation: 'ζ Pegasi' },
    109427: { names: { en: 'Baham', 'zh-CN': '离宫四', 'zh-TW': '離宮四' }, designation: 'θ Pegasi' },
    107315: { names: { en: 'Enif', 'zh-CN': '危宿三', 'zh-TW': '危宿三' }, designation: 'ε Pegasi' },
    81833: { names: { en: 'Eta Herculis', 'zh-CN': '武仙座 η', 'zh-TW': '武仙座 η' }, designation: 'η Herculis' },
    84380: { names: { en: 'Pi Herculis', 'zh-CN': '武仙座 π', 'zh-TW': '武仙座 π' }, designation: 'π Herculis' },
    83207: { names: { en: 'Epsilon Herculis', 'zh-CN': '武仙座 ε', 'zh-TW': '武仙座 ε' }, designation: 'ε Herculis' },
    81693: { names: { en: 'Zeta Herculis', 'zh-CN': '武仙座 ζ', 'zh-TW': '武仙座 ζ' }, designation: 'ζ Herculis' },
    80816: { names: { en: 'Kornephoros', 'zh-CN': '河间一', 'zh-TW': '河間一' }, designation: 'β Herculis' },
    80170: { names: { en: 'Gamma Herculis', 'zh-CN': '河间二', 'zh-TW': '河間二' }, designation: 'γ Herculis' },
    84379: { names: { en: 'Sarin', 'zh-CN': '天纪二', 'zh-TW': '天紀二' }, designation: 'δ Herculis' },
    84345: { names: { en: 'Rasalgethi', 'zh-CN': '帝座', 'zh-TW': '帝座' }, designation: 'α Herculis' },
    76267: { names: { en: 'Alphecca', 'zh-CN': '贯索四', 'zh-TW': '貫索四' }, designation: 'α Coronae Borealis' },
    75695: { names: { en: 'Nusakan', 'zh-CN': '贯索三', 'zh-TW': '貫索三' }, designation: 'β Coronae Borealis' },
    76127: { names: { en: 'Theta Coronae Borealis', 'zh-CN': '北冕座 θ', 'zh-TW': '北冕座 θ' }, designation: 'θ Coronae Borealis' },
    76669: { names: { en: 'Zeta Coronae Borealis', 'zh-CN': '北冕座 ζ', 'zh-TW': '北冕座 ζ' }, designation: 'ζ Coronae Borealis' },
    76952: { names: { en: 'Gamma Coronae Borealis', 'zh-CN': '贯索二', 'zh-TW': '貫索二' }, designation: 'γ Coronae Borealis' },
    77512: { names: { en: 'Delta Coronae Borealis', 'zh-CN': '贯索一', 'zh-TW': '貫索一' }, designation: 'δ Coronae Borealis' },
    78159: { names: { en: 'Epsilon Coronae Borealis', 'zh-CN': '北冕座 ε', 'zh-TW': '北冕座 ε' }, designation: 'ε Coronae Borealis' },
    78493: { names: { en: 'Iota Coronae Borealis', 'zh-CN': '北冕座 ι', 'zh-TW': '北冕座 ι' }, designation: 'ι Coronae Borealis' },
    79119: { names: { en: 'Tau Coronae Borealis', 'zh-CN': '北冕座 τ', 'zh-TW': '北冕座 τ' }, designation: 'τ Coronae Borealis' },
    11767: { names: { en: 'Polaris', 'zh-CN': '北极星', 'zh-TW': '北極星' }, designation: 'α Ursae Minoris' },
    85822: { names: { en: 'Yildun', 'zh-CN': 'Yildun · 小熊座 δ', 'zh-TW': 'Yildun · 小熊座 δ' }, designation: 'δ Ursae Minoris' },
    82080: { names: { en: 'Epsilon Ursae Minoris', 'zh-CN': '小熊座 ε', 'zh-TW': '小熊座 ε' }, designation: 'ε Ursae Minoris' },
    79822: { names: { en: 'Eta Ursae Minoris', 'zh-CN': '小熊座 η', 'zh-TW': '小熊座 η' }, designation: 'η Ursae Minoris' },
    77055: { names: { en: 'Zeta Ursae Minoris', 'zh-CN': '小熊座 ζ', 'zh-TW': '小熊座 ζ' }, designation: 'ζ Ursae Minoris' },
    72607: { names: { en: 'Kochab', 'zh-CN': 'Kochab · 小熊座 β', 'zh-TW': 'Kochab · 小熊座 β' }, designation: 'β Ursae Minoris' },
    75097: { names: { en: 'Pherkad', 'zh-CN': 'Pherkad · 小熊座 γ', 'zh-TW': 'Pherkad · 小熊座 γ' }, designation: 'γ Ursae Minoris' },
    70692: { names: { en: '5 Ursae Minoris', 'zh-CN': '小熊座 5', 'zh-TW': '小熊座 5' }, designation: '5 Ursae Minoris' },
    69112: { names: { en: '4 Ursae Minoris', 'zh-CN': '小熊座 4', 'zh-TW': '小熊座 4' }, designation: '4 Ursae Minoris' },
    74605: { names: { en: 'HD 136064', 'zh-CN': 'HD 136064 · 小熊座', 'zh-TW': 'HD 136064 · 小熊座' }, designation: 'HD 136064 · historical ν Ursae Minoris' },
    73199: { names: { en: 'RR Ursae Minoris', 'zh-CN': '小熊座 RR', 'zh-TW': '小熊座 RR' }, designation: 'RR Ursae Minoris' }
};

const homeStarTargets = {
    11767: { type: 'home' },
    85822: { type: 'portal', portalId: 'gallery' },
    82080: { type: 'portal', portalId: 'shelf' },
    79822: { type: 'portal', portalId: 'thoughts' },
    77055: { type: 'portal', portalId: 'friends' },
    72607: { type: 'portal', portalId: 'footprints' },
    70692: { type: 'portal', portalId: 'news' },
    69112: { type: 'portal', portalId: 'publications' },
    74605: { type: 'portal', portalId: 'projects' },
    73199: { type: 'portal', portalId: 'notes' }
};

const starUiCopy = {
    en: {
        sectionKicker: 'LIFE ARCHIVE',
        constellationNote: 'CONSTELLATION NOTE',
        starNote: 'STAR NOTE',
        chooseMeta: count => `${count} real stars · choose one to continue`,
        choose: 'Move the cursor across the constellation and choose a star. Filled rings carry content; every other star still has its own story.',
        homeMeta: count => `${count} real stars · Home + nine direct routes`,
        homeChoose: 'Choose a star to preview its route. The view will trace the course first; navigation begins only after you confirm Launch.',
        routePreviewMeta: 'INTERSTELLAR ROUTE PREVIEW',
        departure: 'Departure',
        destination: 'Destination',
        previewing: target => `Course plotted toward ${target}. Review the route in the sky, then confirm when you are ready.`,
        launch: 'Launch',
        cancel: 'Cancel route',
        empty: 'This star does not carry any content yet.',
        filled: count => `${count} ${count === 1 ? 'entry is' : 'entries are'} fixed to this star, following this section’s saved order.`,
        home: 'Return to the homepage',
        route: target => `Fly to ${target}`
    },
    'zh-CN': {
        sectionKicker: '生活档案',
        constellationNote: '星座附注',
        starNote: '恒星附注',
        chooseMeta: count => `${count} 颗真实恒星 · 请选择一颗继续`,
        choose: '把鼠标移到星座中的恒星并选择。带细环的星已有内容；其余恒星也仍有自己的介绍。',
        homeMeta: count => `${count} 颗真实恒星 · Home 与九条直达航线`,
        homeChoose: '选择一颗恒星预览航线。视角会先沿航线望向目的地；只有再次确认“启航”后才会真正跳转。',
        routePreviewMeta: '星际航线预览',
        departure: '启程星',
        destination: '目的地',
        previewing: target => `已绘制前往${target}的航线。请先在星空中确认航向，准备好后再启航。`,
        launch: '启航',
        cancel: '取消航线',
        empty: '这颗星上暂时还没有内容。',
        filled: count => `这颗星固定承载 ${count} 条内容，并遵循该板块保存的顺序。`,
        home: '返回个人主页',
        route: target => `飞向${target}`
    },
    'zh-TW': {
        sectionKicker: '生活檔案',
        constellationNote: '星座附註',
        starNote: '恆星附註',
        chooseMeta: count => `${count} 顆真實恆星 · 請選擇一顆繼續`,
        choose: '把滑鼠移到星座中的恆星並選擇。帶細環的星已有內容；其餘恆星也仍有自己的介紹。',
        homeMeta: count => `${count} 顆真實恆星 · Home 與九條直達航線`,
        homeChoose: '選擇一顆恆星預覽航線。視角會先沿航線望向目的地；只有再次確認「啟航」後才會真正跳轉。',
        routePreviewMeta: '星際航線預覽',
        departure: '啟程星',
        destination: '目的地',
        previewing: target => `已繪製前往${target}的航線。請先在星空中確認航向，準備好後再啟航。`,
        launch: '啟航',
        cancel: '取消航線',
        empty: '這顆星上暫時還沒有內容。',
        filled: count => `這顆星固定承載 ${count} 條內容，並遵循該板塊儲存的順序。`,
        home: '返回個人主頁',
        route: target => `飛向${target}`
    }
};

const celestialUi = {
    en: {
        nav: 'Sun, Moon and planets in the live sky',
        kicker: 'MAGNIFIED OBSERVATION',
        badge: 'Optical close-up · not to scale',
        inspect: 'Current position · select to inspect',
        close: 'Return to the live sky',
        altitude: 'Altitude',
        azimuth: 'Azimuth',
        distance: 'Distance',
        magnitude: 'Magnitude',
        phase: 'Illuminated',
        horizon: 'Visibility',
        above: 'Above',
        below: 'Below',
        nakedEye: 'Visible to the unaided eye',
        marginal: 'Marginal under a dark sky',
        telescope: 'Requires optical aid',
        daylight: 'Lost in daylight or twilight',
        belowHorizon: 'Below the local horizon',
        observer: (label, latitude, longitude, time) =>
            `Calculated for ${label} · ${latitude}°, ${longitude}° · ${time}`,
        geometry: (diameter, phaseAngle) =>
            `Angular diameter ${diameter} · phase angle ${phaseAngle}`,
        scaleNote: 'The distant sky follows apparent magnitude and visibility. This close-up is magnified rather than size-scaled; position, phase, lighting, axis and ring tilt follow the current observation. Surface maps and animated cloud, solar-granulation and corona detail are representative reference imagery, not a live spacecraft feed.',
        unavailable: 'Astronomical coordinates unavailable',
        au: value => `${value} AU`
    },
    'zh-CN': {
        nav: '实时天空中的太阳、月亮与行星',
        kicker: '放大观测',
        badge: '光学近景 · 非等比例',
        inspect: '当前位置 · 选择查看',
        close: '返回实时星空',
        altitude: '地平高度',
        azimuth: '方位角',
        distance: '距离',
        magnitude: '视星等',
        phase: '受光比例',
        horizon: '可见条件',
        above: '地平线上',
        below: '地平线下',
        nakedEye: '肉眼可见',
        marginal: '仅在优良暗空下勉强可见',
        telescope: '需要光学设备',
        daylight: '淹没于日光或暮光',
        belowHorizon: '当前位于地平线下',
        observer: (label, latitude, longitude, time) =>
            `依据${label}计算 · 纬度 ${latitude}° · 经度 ${longitude}° · ${time}`,
        geometry: (diameter, phaseAngle) =>
            `视角直径 ${diameter} · 相位角 ${phaseAngle}`,
        scaleNote: '远景按实际视星等与可见条件呈现；此处是放大观测近景，并非天体尺寸比例。方位、盈亏、受光、自转轴与行星环倾角依据当前观测计算；表面图、动态云层、太阳米粒组织与日冕细节为代表性参考可视化，并非航天器实时画面。',
        unavailable: '天文坐标暂不可用',
        au: value => `${value} 天文单位`
    },
    'zh-TW': {
        nav: '即時天空中的太陽、月亮與行星',
        kicker: '放大觀測',
        badge: '光學近景 · 非等比例',
        inspect: '目前位置 · 選擇查看',
        close: '返回即時星空',
        altitude: '地平高度',
        azimuth: '方位角',
        distance: '距離',
        magnitude: '視星等',
        phase: '受光比例',
        horizon: '可見條件',
        above: '地平線上',
        below: '地平線下',
        nakedEye: '肉眼可見',
        marginal: '僅在優良暗空下勉強可見',
        telescope: '需要光學設備',
        daylight: '淹沒於日光或暮光',
        belowHorizon: '目前位於地平線下',
        observer: (label, latitude, longitude, time) =>
            `依據${label}計算 · 緯度 ${latitude}° · 經度 ${longitude}° · ${time}`,
        geometry: (diameter, phaseAngle) =>
            `視角直徑 ${diameter} · 相位角 ${phaseAngle}`,
        scaleNote: '遠景按實際視星等與可見條件呈現；此處是放大觀測近景，並非天體尺寸比例。方位、盈虧、受光、自轉軸與行星環傾角依據目前觀測計算；表面圖、動態雲層、太陽米粒組織與日冕細節為代表性參考視覺化，並非太空船即時畫面。',
        unavailable: '天文座標暫不可用',
        au: value => `${value} 天文單位`
    }
};

const skyIndexUi = {
    en: {
        kicker: 'LIVE SKY INDEX',
        title: 'Life constellations',
        listLabel: 'Life sections',
        open: 'Open life index',
        close: 'Close life index',
        above: 'Above horizon',
        near: 'Near horizon',
        below: 'Below horizon',
        veiled: 'Obscured by glare',
        homeTitle: 'Homepage route',
        homeMeta: 'Polaris course · confirm departure',
        note: 'Above-horizon constellations remain softly traced by day; sections below the horizon remain available here.',
        observer: (location, time) => `${location} · ${time}`,
        indexAccess: 'INDEX ACCESS',
        directAnnouncement: (name, status) => `${name}: ${status}. Opened through the life index without moving the live sky.`,
        compass: ['N', 'E', 'S', 'W']
    },
    'zh-CN': {
        kicker: '实时星空索引',
        title: '生活星座',
        listLabel: '生活板块',
        open: '打开生活板块索引',
        close: '关闭生活板块索引',
        above: '地平线上',
        near: '临近地平线',
        below: '地平线下',
        veiled: '隐没于眩光',
        homeTitle: '主页航线',
        homeMeta: '北极星航线 · 确认后启航',
        note: '白昼仍会柔和标出地平线以上的星座；地平线以下的板块也可由此索引进入。',
        observer: (location, time) => `${location} · ${time}`,
        indexAccess: '索引接入',
        directAnnouncement: (name, status) => `${name}当前状态：${status}。已通过生活索引打开，实时天空视角保持不变。`,
        compass: ['北', '东', '南', '西']
    },
    'zh-TW': {
        kicker: '即時星空索引',
        title: '生活星座',
        listLabel: '生活板塊',
        open: '開啟生活板塊索引',
        close: '關閉生活板塊索引',
        above: '地平線上',
        near: '鄰近地平線',
        below: '地平線下',
        veiled: '隱沒於眩光',
        homeTitle: '主頁航線',
        homeMeta: '北極星航線 · 確認後啟航',
        note: '白晝仍會柔和標出地平線以上的星座；地平線以下的板塊也可由此索引進入。',
        observer: (location, time) => `${location} · ${time}`,
        indexAccess: '索引接入',
        directAnnouncement: (name, status) => `${name}目前狀態：${status}。已透過生活索引開啟，即時天空視角保持不變。`,
        compass: ['北', '東', '南', '西']
    }
};

const celestialBodies = [
    {
        id: 'sun',
        body: 'Sun',
        color: '#ffd36f',
        radiusKm: 695700,
        flattening: 0.000009,
        material: 'sun',
        texture: 'assets/celestial/sun.webp',
        longitudeOffset: 0,
        angularDisc: true,
        refracted: true,
        distantAppearance: 'sun',
        visibilityModel: 'solar',
        names: { en: 'Sun', 'zh-CN': '太阳', 'zh-TW': '太陽' },
        kinds: { en: 'Our star', 'zh-CN': '我们的恒星', 'zh-TW': '我們的恆星' },
        descriptions: {
            en: 'The Sun is the star that anchors the Solar System. Its position here is calculated for the homepage weather location and the current moment, including the observer’s position on Earth.',
            'zh-CN': '太阳是太阳系的中心恒星。这里的位置依据主页天气所用地点与当前时刻计算，并计入观察者在地球表面的位置。',
            'zh-TW': '太陽是太陽系的中心恆星。這裡的位置依據主頁天氣所用地點與目前時刻計算，並計入觀察者在地球表面的位置。'
        },
        facts: [
            {
                en: 'Sunlight takes about 8 minutes 20 seconds to reach Earth.',
                'zh-CN': '阳光抵达地球大约需要 8 分 20 秒。',
                'zh-TW': '陽光抵達地球大約需要 8 分 20 秒。'
            },
            {
                en: 'The Sun contains about 99.86% of the Solar System’s mass.',
                'zh-CN': '太阳约占太阳系总质量的 99.86%。',
                'zh-TW': '太陽約占太陽系總質量的 99.86%。'
            }
        ]
    },
    {
        id: 'moon',
        body: 'Moon',
        color: '#e9e6dc',
        radiusKm: 1737.4,
        flattening: 0.0012,
        material: 'rock',
        texture: 'assets/celestial/moon.webp',
        longitudeOffset: 0,
        angularDisc: true,
        refracted: true,
        distantAppearance: 'moon',
        visibilityModel: 'moon',
        names: { en: 'Moon', 'zh-CN': '月亮', 'zh-TW': '月亮' },
        kinds: { en: 'Earth’s natural satellite', 'zh-CN': '地球的天然卫星', 'zh-TW': '地球的天然衛星' },
        descriptions: {
            en: 'The Moon is rendered at its topocentric position and apparent angular size for the current observer. Its phase, bright-limb direction, surface orientation and daylight visibility follow the current Sun–Earth–Moon geometry.',
            'zh-CN': '月亮按当前观察者的站心位置与真实视角大小呈现；月相、亮边方向、月面朝向与白昼可见性均取决于此刻的日—地—月几何关系。',
            'zh-TW': '月亮按目前觀察者的站心位置與真實視角大小呈現；月相、亮邊方向、月面朝向與白晝可見性均取決於此刻的日—地—月幾何關係。'
        },
        facts: [
            {
                en: 'The Moon’s apparent diameter varies by roughly 14% between apogee and perigee.',
                'zh-CN': '月亮从远地点到近地点的视直径变化约为 14%。',
                'zh-TW': '月亮從遠地點到近地點的視直徑變化約為 14%。'
            },
            {
                en: 'Daylight Moon visibility depends on phase, angular distance from the Sun, altitude and atmospheric contrast.',
                'zh-CN': '白昼月亮是否可见，取决于月相、与太阳的角距、高度及大气对比度。',
                'zh-TW': '白晝月亮是否可見，取決於月相、與太陽的角距、高度及大氣對比度。'
            }
        ]
    },
    {
        id: 'mercury',
        body: 'Mercury',
        color: '#b9b2a7',
        radiusKm: 2439.7,
        flattening: 0,
        material: 'rock',
        texture: 'assets/celestial/mercury.webp',
        longitudeOffset: 0,
        names: { en: 'Mercury', 'zh-CN': '水星', 'zh-TW': '水星' },
        kinds: { en: 'Inner planet', 'zh-CN': '内行星', 'zh-TW': '內行星' },
        descriptions: {
            en: 'Mercury is the smallest planet and the closest one to the Sun. From Earth it never strays far from the solar glare, so dawn and dusk offer the best chances to find it.',
            'zh-CN': '水星是最小、也最靠近太阳的行星。从地球看，它始终不会远离太阳的光辉，因此最适合在黎明或黄昏寻找。',
            'zh-TW': '水星是最小、也最靠近太陽的行星。從地球看，它始終不會遠離太陽的光輝，因此最適合在黎明或黃昏尋找。'
        },
        facts: [
            {
                en: 'One Mercury year lasts only about 88 Earth days.',
                'zh-CN': '水星公转一周只需约 88 个地球日。',
                'zh-TW': '水星公轉一周只需約 88 個地球日。'
            },
            {
                en: 'Its heavily cratered surface records the early Solar System.',
                'zh-CN': '布满撞击坑的表面保存着早期太阳系的痕迹。',
                'zh-TW': '布滿撞擊坑的表面保存著早期太陽系的痕跡。'
            }
        ]
    },
    {
        id: 'venus',
        body: 'Venus',
        color: '#e7c98f',
        radiusKm: 6051.8,
        flattening: 0,
        material: 'cloud',
        texture: 'assets/celestial/venus.webp',
        longitudeOffset: 0,
        names: { en: 'Venus', 'zh-CN': '金星', 'zh-TW': '金星' },
        kinds: { en: 'Inner planet', 'zh-CN': '内行星', 'zh-TW': '內行星' },
        descriptions: {
            en: 'Venus is wrapped in a dense carbon-dioxide atmosphere and bright clouds. Its changing phase and exceptional brightness make it the familiar “morning star” or “evening star.”',
            'zh-CN': '金星被浓厚的二氧化碳大气与明亮云层包裹。它会呈现盈亏变化，也常以极高亮度成为“启明星”或“长庚星”。',
            'zh-TW': '金星被濃厚的二氧化碳大氣與明亮雲層包裹。它會呈現盈虧變化，也常以極高亮度成為「啟明星」或「長庚星」。'
        },
        facts: [
            {
                en: 'Venus rotates in the opposite direction to most planets.',
                'zh-CN': '金星的自转方向与多数行星相反。',
                'zh-TW': '金星的自轉方向與多數行星相反。'
            },
            {
                en: 'Its surface is hotter than Mercury’s despite being farther from the Sun.',
                'zh-CN': '尽管离太阳更远，金星表面仍比水星更热。',
                'zh-TW': '儘管離太陽更遠，金星表面仍比水星更熱。'
            }
        ]
    },
    {
        id: 'mars',
        body: 'Mars',
        color: '#c96f4e',
        radiusKm: 3389.5,
        flattening: 0.00589,
        material: 'rock',
        texture: 'assets/celestial/mars.webp',
        longitudeOffset: 0,
        names: { en: 'Mars', 'zh-CN': '火星', 'zh-TW': '火星' },
        kinds: { en: 'Rocky planet', 'zh-CN': '岩石行星', 'zh-TW': '岩石行星' },
        descriptions: {
            en: 'Mars is a cold desert world colored by iron oxides. Its polar caps, extinct river valleys and buried ice preserve evidence of a wetter past.',
            'zh-CN': '火星是一颗被氧化铁染红的寒冷荒漠行星。极冠、古河谷与地下冰层记录了它更湿润的过去。',
            'zh-TW': '火星是一顆被氧化鐵染紅的寒冷荒漠行星。極冠、古河谷與地下冰層記錄了它更濕潤的過去。'
        },
        facts: [
            {
                en: 'Olympus Mons is the largest known volcano in the Solar System.',
                'zh-CN': '奥林帕斯山是太阳系已知最大的火山。',
                'zh-TW': '奧林帕斯山是太陽系已知最大的火山。'
            },
            {
                en: 'A Martian day is only about 40 minutes longer than an Earth day.',
                'zh-CN': '一个火星日只比地球日长约 40 分钟。',
                'zh-TW': '一個火星日只比地球日長約 40 分鐘。'
            }
        ]
    },
    {
        id: 'jupiter',
        body: 'Jupiter',
        color: '#d6ad78',
        radiusKm: 69911,
        flattening: 0.06487,
        material: 'gas',
        texture: 'assets/celestial/jupiter.webp',
        longitudeOffset: 0,
        names: { en: 'Jupiter', 'zh-CN': '木星', 'zh-TW': '木星' },
        kinds: { en: 'Gas giant', 'zh-CN': '气态巨行星', 'zh-TW': '氣態巨行星' },
        descriptions: {
            en: 'Jupiter is the Solar System’s largest planet, a rapidly rotating world of hydrogen and helium whose gravity shapes countless smaller orbits.',
            'zh-CN': '木星是太阳系最大的行星，由氢和氦构成并高速自转；它强大的引力持续塑造着许多小天体的轨道。',
            'zh-TW': '木星是太陽系最大的行星，由氫和氦構成並高速自轉；它強大的引力持續塑造著許多小天體的軌道。'
        },
        facts: [
            {
                en: 'The Great Red Spot is a storm larger than Earth.',
                'zh-CN': '大红斑是一场尺度超过地球的巨大风暴。',
                'zh-TW': '大紅斑是一場尺度超過地球的巨大風暴。'
            },
            {
                en: 'Jupiter completes one rotation in roughly ten hours.',
                'zh-CN': '木星自转一周大约只需十小时。',
                'zh-TW': '木星自轉一周大約只需十小時。'
            }
        ]
    },
    {
        id: 'saturn',
        body: 'Saturn',
        color: '#dbc896',
        radiusKm: 58232,
        flattening: 0.09796,
        material: 'gas',
        texture: 'assets/celestial/saturn.webp',
        ringTexture: 'assets/celestial/saturn-ring.png',
        longitudeOffset: 0,
        names: { en: 'Saturn', 'zh-CN': '土星', 'zh-TW': '土星' },
        kinds: { en: 'Ringed gas giant', 'zh-CN': '环状气态巨行星', 'zh-TW': '環狀氣態巨行星' },
        descriptions: {
            en: 'Saturn is a low-density gas giant surrounded by an immense ring system. The rings are broad but remarkably thin, built from innumerable pieces of ice and rock.',
            'zh-CN': '土星是一颗低密度气态巨行星，拥有宏大的行星环。环面宽阔却极薄，由无数冰与岩石碎片组成。',
            'zh-TW': '土星是一顆低密度氣態巨行星，擁有宏大的行星環。環面寬闊卻極薄，由無數冰與岩石碎片組成。'
        },
        facts: [
            {
                en: 'Saturn’s average density is lower than liquid water.',
                'zh-CN': '土星的平均密度低于液态水。',
                'zh-TW': '土星的平均密度低於液態水。'
            },
            {
                en: 'Its moon Titan has a dense atmosphere and methane lakes.',
                'zh-CN': '其卫星泰坦拥有浓厚大气与甲烷湖泊。',
                'zh-TW': '其衛星泰坦擁有濃厚大氣與甲烷湖泊。'
            }
        ]
    },
    {
        id: 'uranus',
        body: 'Uranus',
        color: '#8fd0d1',
        radiusKm: 25362,
        flattening: 0.02293,
        material: 'ice',
        texture: 'assets/celestial/uranus.webp',
        longitudeOffset: 0,
        names: { en: 'Uranus', 'zh-CN': '天王星', 'zh-TW': '天王星' },
        kinds: { en: 'Ice giant', 'zh-CN': '冰巨行星', 'zh-TW': '冰巨行星' },
        descriptions: {
            en: 'Uranus is a pale cyan ice giant. A violent ancient encounter may have tipped it almost onto its side, producing extreme seasons over its long orbit.',
            'zh-CN': '天王星是一颗淡青色冰巨行星。一次古老而剧烈的撞击可能让它几乎横躺自转，并形成极端漫长的季节。',
            'zh-TW': '天王星是一顆淡青色冰巨行星。一次古老而劇烈的撞擊可能讓它幾乎橫躺自轉，並形成極端漫長的季節。'
        },
        facts: [
            {
                en: 'Its rotational axis is tilted by about 98 degrees.',
                'zh-CN': '它的自转轴倾角约为 98 度。',
                'zh-TW': '它的自轉軸傾角約為 98 度。'
            },
            {
                en: 'Methane in its atmosphere absorbs red light and helps create its color.',
                'zh-CN': '大气中的甲烷吸收红光，形成了它的青蓝色外观。',
                'zh-TW': '大氣中的甲烷吸收紅光，形成了它的青藍色外觀。'
            }
        ]
    },
    {
        id: 'neptune',
        body: 'Neptune',
        color: '#557dc5',
        radiusKm: 24622,
        flattening: 0.01708,
        material: 'ice',
        texture: 'assets/celestial/neptune.webp',
        longitudeOffset: 0,
        names: { en: 'Neptune', 'zh-CN': '海王星', 'zh-TW': '海王星' },
        kinds: { en: 'Ice giant', 'zh-CN': '冰巨行星', 'zh-TW': '冰巨行星' },
        descriptions: {
            en: 'Neptune is the outermost major planet, an intensely blue ice giant discovered through mathematical prediction before it was identified in a telescope.',
            'zh-CN': '海王星是最外侧的大行星。这颗深蓝色冰巨行星先由数学预测其位置，随后才在望远镜中被确认。',
            'zh-TW': '海王星是最外側的大行星。這顆深藍色冰巨行星先由數學預測其位置，隨後才在望遠鏡中被確認。'
        },
        facts: [
            {
                en: 'Neptune hosts some of the fastest winds measured in the Solar System.',
                'zh-CN': '海王星拥有太阳系中速度最高的一些行星风。',
                'zh-TW': '海王星擁有太陽系中速度最高的一些行星風。'
            },
            {
                en: 'One Neptune year lasts about 165 Earth years.',
                'zh-CN': '海王星公转一周约需 165 个地球年。',
                'zh-TW': '海王星公轉一周約需 165 個地球年。'
            }
        ]
    },
    {
        id: 'pluto',
        body: 'Pluto',
        color: '#b9a698',
        radiusKm: 1188.3,
        flattening: 0,
        material: 'ice-rock',
        texture: 'assets/celestial/pluto.webp',
        longitudeOffset: 0,
        names: { en: 'Pluto', 'zh-CN': '冥王星', 'zh-TW': '冥王星' },
        kinds: { en: 'Dwarf planet', 'zh-CN': '矮行星', 'zh-TW': '矮行星' },
        descriptions: {
            en: 'Pluto is a complex dwarf planet in the Kuiper Belt. Its eccentric, tilted orbit and unexpectedly varied surface make it far more than a frozen point of light.',
            'zh-CN': '冥王星是柯伊伯带中的复杂矮行星。偏心且倾斜的轨道，以及远超预期的多样地貌，让它绝不只是一个冰冷光点。',
            'zh-TW': '冥王星是古柏帶中的複雜矮行星。偏心且傾斜的軌道，以及遠超預期的多樣地貌，讓它絕不只是一個冰冷光點。'
        },
        facts: [
            {
                en: 'Pluto and Neptune are locked in a stable 3:2 orbital resonance.',
                'zh-CN': '冥王星与海王星处在稳定的 3:2 轨道共振中。',
                'zh-TW': '冥王星與海王星處在穩定的 3:2 軌道共振中。'
            },
            {
                en: 'Its bright heart-shaped region includes a vast nitrogen-ice plain.',
                'zh-CN': '它明亮的心形区域包含一片广阔的氮冰平原。',
                'zh-TW': '它明亮的心形區域包含一片廣闊的氮冰平原。'
            }
        ]
    }
];
