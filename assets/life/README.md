# Life 页面分片维护指南

`life.html` 只保留页面骨架、可访问性结构、站点内容区和资源引用。页面视觉与运行时分别拆到本目录的 8 个 CSS 和 24 个 classic JS 中：原有星空保留，默认观景使用可替换的离线全景资源，探索模式才启用 Three.js 实时场景。

## CSS 分片

CSS 必须按 `life.html` 中的顺序加载。后面的文件会覆盖前面的基础规则，不要改用 `@import`，也不要只按局部看似相关就随意移动规则。

| 顺序 | 文件 | 职责 |
| --- | --- | --- |
| 1 | `styles/01-foundation-sky.css` | 字体、变量、reset、天空 canvas、站点标记、语言切换、入场门、准星与 gaze UI |
| 2 | `styles/02-section-drawer.css` | 左侧 Life 索引、遮罩、可见性状态与抽屉按钮 |
| 3 | `styles/03-sky-navigation.css` | 星座、天体、恒星的透明命中区、标签和交互状态 |
| 4 | `styles/04-detail-panels.css` | 星座内容面板、天体观测面板、star reader 与 Home 航线预览 |
| 5 | `styles/05-life-content.css` | Gallery、Shelf、Thoughts、Friends、About 等 Life 原生内容样式 |
| 6 | `styles/06-homepage-parity.css` | News、Publications、Projects、Notes 等与主页保持一致的内容样式 |
| 7 | `styles/07-overlays-responsive.css` | 地图、lightbox、转场 veil、响应式布局、触屏和 reduced-motion 收尾规则 |
| 8 | `styles/08-worlds.css` | 透明环境 canvas、场景选择器、漫游 HUD、触屏方向键与环境响应式规则 |

约定：

- `body` 上的 `has-target`、`panel-open`、`celestial-open`、`section-drawer-open`、`route-preview-active`、`celestial-transition`、`celestial-closeup`、`celestial-returning`、`view-locked`、`cursor-free`、`touch-mode` 等 class 是 CSS 与 JS 之间的公共 API，不要单边改名。
- `styles/01-foundation-sky.css` 中字体 URL 相对该文件解析；移动文件时必须重新核对 `../../../fonts/...`。
- 响应式断点与 `scripts/02-sky-config.js` 的紧凑布局常量共同定义镜头和面板行为，必须同步修改并运行验证器。

## Classic JS 强制顺序

这些文件不是 ES modules，而是共享同一个 classic-script 全局词法环境。禁止增加 `type=module`、`async`，禁止改变下面的顺序：

```text
01-content-data.js
02-sky-config.js
03-math-orientation.js
04-dom-state.js
05-astronomy.js
06-framing.js
07-galaxy-renderer.js
08-closeup-layout.js
09-closeup-renderer.js
10-sky-overlay.js
11-section-index.js
12-detail-navigation.js
13-gaze-constellations.js
14-celestial-visits.js
15-render-lock.js
16-input-events.js
17-content-ui.js
18-bootstrap.js
assets/vendor/three-0.160.1.min.js（vendor 依赖，非本目录分片）
24-panorama.js
19-world-kit.js
21-world-outdoors.js
22-world-interiors.js
20-world-runtime.js
23-world-ui.js
```

`03` 必须先于 `04`：`04-dom-state.js` 在顶层创建 `camera`，会立即调用 `orientationFromYawPitch`。前 18 个文件按编号加载；环境文件的编号不等于依赖顺序。Three.js 必须先于 `19`，两个 builder 文件 `21` / `22` 必须先于创建场景的 `20`，最后加载 `23`。

`assets/vendor/astronomy-engine-2.1.19.min.js` 必须在以上列表之前加载；头部的 Hipparcos 星表也必须先可用。

| 文件 | 职责 |
| --- | --- |
| `01-content-data.js` | 由站点内容生成器维护的 `i18n`、中国足迹和国家足迹数据 |
| `02-sky-config.js` | 全局常量、观察地点、`skyModel`、星座/恒星/天体定义及多语言 UI 文案 |
| `03-math-orientation.js` | 数值工具、向量、四元数、镜头姿态与赤道坐标/本地坐标转换 |
| `04-dom-state.js` | `dom` 注册表、共享 `state`、drag 状态和 `camera` 单例 |
| `05-astronomy.js` | Astronomy Engine 接入、大气折射/消光、昼夜可见性、太阳月亮与行星位置刷新 |
| `06-framing.js` | 星座、Home 航线和天体构图；portal 几何、DOM 内容绑定与屏幕投影 |
| `07-galaxy-renderer.js` | 星空背景和 Hipparcos 恒星的 WebGL 渲染器 |
| `08-closeup-layout.js` | 天体近景布局、旋转工具和材质渲染配置 |
| `09-closeup-renderer.js` | 天体近景 WebGL/Canvas fallback；文件末尾创建两个 renderer 单例 |
| `10-sky-overlay.js` | 2D overlay、fallback 星空、地平线、流星、太阳月亮/行星远景绘制 |
| `11-section-index.js` | 左侧 Life 索引、天空状态文案、可访问性与焦点管理 |
| `12-detail-navigation.js` | 天体/恒星命中按钮、内容选择、星座面板和 Home 航线预览 |
| `13-gaze-constellations.js` | gaze 目标、星座线与恒星绘制、Home 航线绘制和自由视角输入 |
| `14-celestial-visits.js` | 镜头飞行、天体访问阶段、纹理 watchdog、面板打开/返回与数值格式化 |
| `15-render-lock.js` | 主渲染循环、入场 gate、pointer lock、Alt 游标释放和 modal 暂停 |
| `16-input-events.js` | 鼠标、触摸、键盘、resize 等顶层事件绑定 |
| `17-content-ui.js` | 语言切换、Thoughts、引用复制、ECharts 地图和 lightbox |
| `18-bootstrap.js` | 最终初始化、开始渲染、StellarTransit ready/restore 与 bfcache 恢复 |
| `19-world-kit.js` | Three.js 几何、材质、灯光、碰撞体与共享资源管理工具 |
| `21-world-outdoors.js` | 废土避难所、霍格沃兹山丘与险峻雪山的独立场景 builder |
| `22-world-interiors.js` | 开拓号飞船的独立场景 builder |
| `20-world-runtime.js` | 环境 renderer、步行和驾驶、碰撞、场景切换、天空遮挡、永夜时间与可选环境声音 |
| `23-world-ui.js` | 三语场景选择、模式和声音开关、交互提示、触屏移动与焦点管理 |
| `24-panorama.js` | 默认固定机位全景资源加载与天空窗口命中测试 |

## 跨文件状态约定

- 共享核心对象包括 `i18n`、`skyModel`、`portalDefinitions`、`celestialBodies`、`dom`、`state`、`camera`、`galaxyRenderer` 和 `celestialCloseupRenderer`。
- 顶层 `const`、`let`、class 和 function 由后续 classic script 直接按标识符访问；它们不保证是 `window` 属性。不要创建重名顶层绑定，也不要把单个文件包进 IIFE 而不同时改完全部调用方。
- `portalDefinitions` 与 `celestialBodies` 是运行时可变模型。代码会写入 `current`、`screen`、`button`、`entriesByHip` 等字段，不要把整个对象深度冻结。
- 顶层副作用必须保持唯一：原有 renderer 在 `09` 创建、天空 bootstrap 在 `18` 执行；新增透明环境 renderer 只在 `20` 首次进入探索时创建。默认观景不得调用完整 builder 或加载探索模型。事件各自只绑定一次。
- 新的纯计算函数应放在依赖它的状态文件之前；新的顶层实例化只能放在其所有 class、DOM 和配置依赖之后。
- DOM `id`、`data-portal-*`、`data-star-hip`、`inert`、ARIA 和 focus-trap 行为也是运行时契约，修改标记时必须同步检查 `dom` 注册表与验证器。

## 独立环境与星空的边界

四个环境 ID 为 `spaceship`、`shelter`、`hogwarts`、`snowmountain`。场景道具、地点和动作是纯环境体验，不对应 Home、Projects、Gallery 或任何内容板块。原有星座点击、恒星内容、天体观测和 Life 索引继续使用原有数据与导航机制。

环境工具通过 `window.NightWorldKit` 暴露，builder 注册到 `window.NightWorldBuilders`，运行时和 UI 分别为 `window.NightWorld` 与 `window.NightWorldUI`。环境脚本使用 IIFE 隔离其内部变量，但仍读取原有共享的 `state`、`camera` 与 `skyModel`。场景通过透明 canvas 叠在原有星空之上，不替换星表或星空 renderer；墙体等实际几何会遮挡其背后的天空命中区。

默认 `observe` 模式使用 `window.NightPanorama` 显示固定机位的离线全景，浏览器只做全景投影和轻量天空交互；这不是“零 GPU 使用”。`explore` 模式才构建、渲染有碰撞和道具互动的完整 Three.js 场景。`sky` 模式隐藏两种环境。默认观景的天空遮挡由全景 mask 判断，探索模式由真实几何射线判断。资源结构、生产状态与替换规范见 `panoramas/README.md`。

当前代码建立双模式管线、四场景和昼夜资源选择能力，预览资源与最终制作级资源必须明确区分。`preview`、`prerendered` 描述加载形式，不等于通过照片级画质验收；生产素材只有经过实际视觉审查后才能标记 `approved`。静态全景没有 120fps 素材帧率，转头显示速度取决于终端刷新率和性能。动态 4K/120fps 属于最终资源目标，不是当前已达成指标；4K 视口所需全景源分辨率也通常高于 4K。

永夜模式保留 Astronomy Engine 的位置计算，优先将观察时间冻结在本次访问日期、当前观察经度对应的当地太阳午夜。如果此时太阳仍高于 −18°（高纬夏季、极昼或极地暮光），改用同年、所在半球冬至日期的当地午夜，确保天文夜晚。正常夜间位置仍保留访问日期的星空；选定时间按观察地点和访问日期缓存，不随真实时钟推进到白天，也不是当前实时天空。改变观察位置时重新选择并验证观察时间；Astronomy Engine 不可用时保留普通午夜退路。不要在个别刷新入口直接用 `new Date()` 绕开这一约定。

飞船、废土避难所使用 `night`；霍格沃兹山丘、雪山支持 `clear` 与 `dusk`。`SceneSky.observationDate()` 在原始夜间参考日期之上选择白天或黄昏观测时刻，主渲染循环只转换一次。切换白天/黄昏必须同时更新天空、离线全景与探索环境光照，禁止只改变天空颜色却留下不匹配的地面光照。

环境选择只在本机 `localStorage` 的 `runde:night-world:v1` 中保存；存储不可用时仍可使用默认场景。环境声音由 Web Audio 本地合成，默认关闭，由用户点击开启，不请求外部音频。原有语言和观察地点等偏好仍按原有机制维护。

写实资源采用本地 glTF 模型与 PBR 材质；来源、许可、校验值和松树单变体提取流程见 `ASSETS.md`。近景松树在桌面 52 米、触屏 28 米之外切换为轻量程序化树木。模型异步加载期间保留几何替身，加载失败后再次进入场景可以重试；切换场景不会把迟到的模型挂回已销毁场景。桌面使用月光阴影和每场景最多一个点光源阴影，触屏关闭阴影以控制开销。

操作约定：

- 默认观景：固定选定机位，鼠标／拖动 360° 环顾；飞船坐在驾驶位，`W/S` 俯仰、`A/D` 转向、`Q/E` 翻滚、`Shift/Ctrl` 油门、空格制动。头部环顾与飞船姿态独立，可通过驾驶让任意方向的星空进入舷窗。
- 隐藏解锁：按 `Shift + Alt + E`，或打开场景菜单后连续点击／轻触菜单标题五次（相邻点击不超过 1.4 秒）。解锁仅限当前页面会话，显示实时渲染提示；之后菜单出现“自由探索”，可随时回到“静静观景”。
- 探索模式：隐藏解锁后，鼠标／拖动环顾，`W A S D` 行走，`Shift` 加速，`E` 与附近且在视野内的道具互动。
- `M` 打开场景选择；其中可切换环境、选择“只看星空”、开关声音或返回抵达位置。`Esc` 关闭选择器，打开时暂停漫游并隔离背景焦点。
- 飞船驾驶：默认观景和探索使用同一套姿态控制；仅探索模式可以按 `F` 或点击提示离开驾驶位。切换到探索保留当前驾驶状态。驾驶键与普通漫游键的含义不同。
- 触屏：左下方向键移动（驾驶时控制俯仰／转向），`+ / −` 调整飞船油门，其余区域拖动环顾；点击交互提示执行动作。非飞船默认观景不显示移动控制。
- 观景画质：场景菜单提供自动／高／中／低，由 `NightPanorama` 选择实际资源档位；晴天场景另有晴天／黄昏选择。菜单公开显示预览、加载与失败状态。
- “只看星空”隐藏环境并保留原有星空操作，包括 `A / D` 翻滚、星座点击、内容访问与返回。原有 pointer-lock fallback、Alt 游标释放和 detail/modal 状态仍须一起验证。

## 生成内容边界

`site_content.json` 是可编辑内容的来源。`site_renderer.py` 的 Life 渲染流程只维护两个产物：

- `life.html`：更新 `SITEGEN:LIFE_*` HTML 区域。
- `scripts/01-content-data.js`：更新 `LIFE_I18N`、`LIFE_VISITED`、`LIFE_VISITED_COUNTRIES` 三个代码区域。

`render_life()` 始终返回渲染后的 HTML；`--check --life-only` 不写文件，并逐字比较 `life.html` 与 `scripts/01-content-data.js` 的当前内容和预期生成结果，任一产物过期都会非零退出。不要删除或移动 SITEGEN 标记，也不要直接维护标记内部的生成内容；下次运行生成器会覆盖它们。标记外的运行时代码不会由生成器改写。

## 字体子集扫描

`scripts/build-edukai-subset.py` 仍扫描 `index.html` 与 `life.html`，并解析 `life.html` 实际引用的本地资源：

- 只接纳仓库内 `assets/life/styles` 下的 CSS 和 `assets/life/scripts` 下的 JS。
- 远程 URL、vendor 文件、data URL 和越出上述目录的路径会被忽略。
- 引用按 HTML 顺序收集并去重；缺失文件或非 UTF-8 文件会让构建明确失败。
- 新增可见文案的 CSS/JS 必须位于上述目录并在 `life.html` 中真实引用，否则字体扫描不会看到其中字符。
- `life.html` 的所有本地脚本与 CSS 使用同一个 `?v=` 发布版本。任何分片公共 API 变更后整体更新该版本，避免浏览器将新调用方与旧 helper 混载；验证器会拒绝缺少版本或版本不一致的资源。字体扫描与本地资源解析会正确忽略 query string。

修改中文、繁体字或其他新字形后，重新运行字体构建并确认 `fonts/edukai-site-subset.woff2` 的变更符合预期。

## 修改与验证

推荐流程：

1. 内容改动优先修改 `site_content.json`，再运行 Life renderer；不要手改生成区域。
2. 运行时改动放入职责最接近的 JS，保持 classic 全局名称和加载顺序。
3. 样式改动放入职责最接近的 CSS，检查前后文件的 cascade 与所有响应式尺寸。
4. 新增分片时同时更新 `life.html`、本 README、运行时验证器和字体扫描边界。

最小验证：

```powershell
python -m py_compile site_renderer.py scripts/build-edukai-subset.py
python site_renderer.py --check --life-only
node scripts/validate-life-runtime.cjs
node scripts/validate-night-worlds.cjs
git diff --check
```

本地 HTTP 服务已启动时，再运行 `node scripts/validate-life-http.cjs http://localhost:8765/life.html`，检查实际提供的每个版本化脚本/CSS 与磁盘一致、语法有效，并以页面真实顺序验证 `03` / `05` 的跨脚本 helper 依赖。

可见文案或字形变化后再运行：

```powershell
python scripts/build-edukai-subset.py
```

浏览器回归建议通过本地 HTTP 服务进行，至少检查：夜晚／晴天／黄昏、太阳与月亮的原有观测能力、星座点击和拉近、Life 索引、pointer lock/fallback、Alt/Esc、三语切换、地图、lightbox、Home 航线、StellarTransit 返回、窄屏和触屏。环境回归需逐一切换全部四处场景，检查默认机位固定、默认模式不构建探索模型、驾驶与环顾独立、所有方向的星座可达、隐藏解锁、船内步行／驾驶／离座、天空遮挡和窗口、质量／时段切换、菜单焦点恢复、加载失败重试、图形上下文丢失时回到观景与声音开关。静态与数值测试不能替代真实浏览器的视觉检查。
