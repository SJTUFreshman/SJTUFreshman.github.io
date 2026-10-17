const LANGUAGES = ['en', 'zh-CN', 'zh-TW'];
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const COARSE_POINTER = window.matchMedia('(hover: none), (pointer: coarse)').matches;
const DEG = Math.PI / 180;
const MIN_CAMERA_ALTITUDE = 8 * DEG;
const MAX_CAMERA_ALTITUDE = 78 * DEG;
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
    yaw: 0.04,
    pitch: MIN_CAMERA_ALTITUDE
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
        id: 'profile',
        titleKey: 'title_profile',
        sharedContent: true,
        fallbackYaw: 1.18,
        fallbackPitch: 0.52,
        pattern: 'orion'
    },
    {
        id: 'wine',
        titleKey: 'title_wine',
        fallbackYaw: 2.15,
        fallbackPitch: 0.16,
        pattern: 'crater'
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
        contentOrder: [26207, 27989, 24436, 25336, 27366, 26311, 26727, 25930],
        focusHip: 26311,
        fallbackPoints: [[0,0.09],[-0.06,0.045],[0.055,0.05],[-0.035,0],[0,0],[0.035,0],[-0.055,-0.09],[0.06,-0.085]],
        edges: [[0,1],[0,2],[1,3],[2,5],[3,4],[4,5],[3,6],[5,7]]
    },
    crater: {
        // Original cup outline, projected from these Hipparcos catalogue positions.
        hips: [53740, 54682, 55705, 55282, 55687, 56633, 58188, 57283],
        contentOrder: [56633, 55282, 53740, 55705, 54682, 55687, 57283, 58188],
        focusHip: 55282,
        fallbackPoints: [[-0.075,-0.025],[-0.043,-0.075],[-0.005,-0.018],[-0.02,0.015],[-0.005,0.06],[0.027,0.072],[0.08,-0.012],[0.05,-0.025]],
        edges: [[4,5],[4,3],[3,2],[2,7],[7,6],[6,5],[2,1],[1,0]]
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
    profile: {
        name: { en: 'Orion', 'zh-CN': '猎户座', 'zh-TW': '獵戶座' },
        epithet: {
            en: 'A portrait drawn in starlight',
            'zh-CN': '由星光勾出的肖像',
            'zh-TW': '由星光勾出的肖像'
        },
        reason: {
            en: 'Orion’s head, shoulders, belt and feet sketch a human figure in the night sky. Here that starlit portrait introduces the person behind the other constellations: a photograph, a few words and, in time, a collection of userboxes.',
            'zh-CN': '猎户座的头、双肩、腰带与双足，在夜空中勾出一个人的轮廓。这幅星光肖像适合介绍其余星座背后的那个人：一张照片、几段自述，以及慢慢添上的用户框。',
            'zh-TW': '獵戶座的頭、雙肩、腰帶與雙足，在夜空中勾出一個人的輪廓。這幅星光肖像適合介紹其餘星座背後的那個人：一張照片、幾段自述，以及慢慢添上的使用者框。'
        }
    },
    wine: {
        name: { en: 'Crater', 'zh-CN': '巨爵座', 'zh-TW': '巨爵座' },
        epithet: {
            en: 'A cup for remembered flavours',
            'zh-CN': '盛放风味记忆的杯子',
            'zh-TW': '盛放風味記憶的杯子'
        },
        reason: {
            en: 'Crater is the celestial cup; its Latin name comes from the Greek vessel used to mix wine and water. It is a fitting home for a wine diary, holding the aromas, flavours and moments worth remembering.',
            'zh-CN': '巨爵座是天上的杯子；它的拉丁名 Crater 源自古希腊用来调和葡萄酒与水的酒器。把品酒日记放在这里，是想让这只星空中的杯子，盛下值得记住的香气、滋味与片刻。',
            'zh-TW': '巨爵座是天上的杯子；它的拉丁名 Crater 源自古希臘用來調和葡萄酒與水的酒器。把品酒日記放在這裡，是想讓這隻星空中的杯子，盛下值得記住的香氣、滋味與片刻。'
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
            en: 'Polaris remains close to the north celestial pole while the sky turns around it. Here it is Home; seven other real stars in Ursa Minor become direct routes into the visible constellations of this life.',
            'zh-CN': '天空绕北天极旋转，而北极星近乎不动。在这里，它就是 Home；小熊座另外七颗真实恒星成为通往当前生活板块星座的航线。',
            'zh-TW': '天空繞北天極旋轉，而北極星近乎不動。在這裡，它就是 Home；小熊座另外七顆真實恆星成為通往目前生活板塊星座的航線。'
        }
    }
};

const starProfiles = {
    53740: { names: { en: 'α Crateris', 'zh-CN': '巨爵座 α', 'zh-TW': '巨爵座 α' }, designation: 'α Crateris' },
    54682: { names: { en: 'β Crateris', 'zh-CN': '巨爵座 β', 'zh-TW': '巨爵座 β' }, designation: 'β Crateris' },
    55705: { names: { en: 'γ Crateris', 'zh-CN': '巨爵座 γ', 'zh-TW': '巨爵座 γ' }, designation: 'γ Crateris' },
    55282: { names: { en: 'δ Crateris', 'zh-CN': '巨爵座 δ', 'zh-TW': '巨爵座 δ' }, designation: 'δ Crateris' },
    55687: { names: { en: 'ε Crateris', 'zh-CN': '巨爵座 ε', 'zh-TW': '巨爵座 ε' }, designation: 'ε Crateris' },
    56633: { names: { en: 'θ Crateris', 'zh-CN': '巨爵座 θ', 'zh-TW': '巨爵座 θ' }, designation: 'θ Crateris' },
    58188: { names: { en: 'η Crateris', 'zh-CN': '巨爵座 η', 'zh-TW': '巨爵座 η' }, designation: 'η Crateris' },
    57283: { names: { en: 'ζ Crateris', 'zh-CN': '巨爵座 ζ', 'zh-TW': '巨爵座 ζ' }, designation: 'ζ Crateris' },
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
    69112: { type: 'portal', portalId: 'profile' },
    73199: { type: 'portal', portalId: 'wine' }
};

const starUiCopy = {
    en: {
        sectionKicker: 'LIFE ARCHIVE',
        constellationNote: 'CONSTELLATION NOTE',
        constellationMeaning: 'Why this constellation',
        starNote: 'STAR NOTE',
        chooseMeta: count => `${count} real stars · choose one to continue`,
        choose: 'Move the cursor across the constellation and choose a star. Filled rings carry content; every other star still has its own story.',
        homeMeta: count => `${count} real stars · Home + seven direct routes`,
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
        constellationMeaning: '星座寓意',
        starNote: '恒星附注',
        chooseMeta: count => `${count} 颗真实恒星 · 请选择一颗继续`,
        choose: '把鼠标移到星座中的恒星并选择。带细环的星已有内容；其余恒星也仍有自己的介绍。',
        homeMeta: count => `${count} 颗真实恒星 · Home 与七条直达航线`,
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
        constellationMeaning: '星座寓意',
        starNote: '恆星附註',
        chooseMeta: count => `${count} 顆真實恆星 · 請選擇一顆繼續`,
        choose: '把滑鼠移到星座中的恆星並選擇。帶細環的星已有內容；其餘恆星也仍有自己的介紹。',
        homeMeta: count => `${count} 顆真實恆星 · Home 與七條直達航線`,
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
