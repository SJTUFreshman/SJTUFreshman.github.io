# Life 页面维护指南

`life.html` 是一幅分层三维星图。右键拖动旋转、左键拖动平移、滚轮缩放；触控板双指滑动旋转、捏合缩放；触屏单指旋转，双指缩放和平移。指针始终自由，不需要 Pointer Lock。访客通过带连线的星座进入 Gallery、Footprints、Shelf、Thoughts、Friends、Meet Me Again、Wine Diary 和 Wishlist 等内容；主页通过左上角 Runde Yang 或太阳系弹窗返回。

星图的滚轮手势处理：浏览器的 Ctrl / Meta + wheel 捏合事件只缩放，连续像素滚动控制旋转，同一段滑动的加速和惯性保持旋转。浏览器不直接提供输入设备类型，因此按行、按页和较大的整数步进识别为普通鼠标滚轮；少数驱动或平滑滚轮可能无法准确区分，仍可用 Ctrl + 滚轮缩放。

键盘方向键旋转，Shift + 方向键平移，`+` / `-` 缩放，`R` / `Home` 重置视角；`Esc` 逐层返回。界面不显示右下角控制栏或边界提示，距离和平移限制仍然生效。

## 星图层级

- 默认进入局部星域；局部范围内连续缩放，越过拉远阈值后用动画切到银河全景。银河全景的向内缩放触发动画返回局部，向外缩放停在边界。局部星域外的旋臂星群和云层保留三维深度与平移视差；最远的星表背景与摄影天幕没有平移视差。
- 局部星域展开内容星座。星座图形采用原 Hipparcos 天球几何，以浅纵深编排到可探索的区域，避免真实星际尺度破坏导航。
- 两种星图均可点击星座文字或连线上的恒星进入内容。恒星命中按当前投影寻找最近星点，鼠标半径 16 px、触屏 26 px；只在单点按下后移动少于 8 px 时激活，星座中的每一颗恒星都打开同一份完整板块内容。拖动、右键旋转、多指捏合不触发进入。文字优先放在星座下方，也会尝试上方和两侧以避开底栏、其他标签和可点击星点。
- 点击太阳系，背景虚化并显示左右两个全屏选项：左侧“在太阳系观景”进入 `observatory.html`，右侧“返回主页”通过既有转场返回 `index.html`。原生 dialog 阻止背景操作并管理焦点，Esc/关闭回到原星图，支持触屏和键盘。行星内部场景、近景、播放控制和纹理仍已移除。
- `observatory.html` 启用原 `codex/legacy-life-observed-sky-20261017` 的太阳系观景，源码来自 `b0a31228292a6baf45f0ac06e95f19b35930ee3a`，两个专用运行时放在 `observatory/`。这里保持观测者位于原点，Hipparcos 恒星和星座按实际角位置排列，缩放改变视场；背景为 ESO/S. Brunier 全天摄影，星座内容和原版银河切换均保留。右下角可返回三维星图。
- 观景页由 `site_renderer.py` 从 `life.html` 派生，只替换运行时、标题和入口，不独立维护内容。执行 `python site_renderer.py --life-only` 同时更新两页，`--check --life-only` 检查同步；Cloudflare 构建包含两个入口。观景页仍使用 Life 的主页转场身份，直接链接切换两幅星图，浏览器返回清理选择弹层。
- 观景页渐进加载原生 6000×3000 银河摄影，使用三次球面重采样保留坐标转换中的细节；移动端和桌面端均按设备纹理上限上传，画布最高 DPR 2、约 830 万像素。共享三维星图继续使用 4K 远景。素材来源、分辨率限制和重建命令见 `sky/README.md`。
- 仙女座星系与猎户座大星云分别为单个入口；详情使用有明确波段、来源署名的 NASA 观测照片。
- 银河盘、尘埃和空间布局是示意可视化；不把编排坐标标为真实物理距离。真实距离来自质量筛选的 Hipparcos 视差，详见 `../HIPPARCOS-DISTANCES-NOTICE.md`。

## 新星图运行时

`07-star-map-renderer.js` 提供 WebGL 体积尘埃、恒星和银河盘，失去 WebGL 时切换为 Canvas。`19-star-map.js` 管理有界相机、层级、星座、命中与输入；它在旧 `15` 之后、`16` 之前加载。`21-deep-sky-map.js` 也在 `18` 初始化之前加载。`08-star-map.css`、`10-deep-sky-map.css` 顺序追加到基础样式之后。

局部星图的可探索范围与周围环境分开：原有 Hipparcos 三维星点、内容星座、局部体积云以及相机限制保持不变，外围另有延伸的本地臂和邻近臂星群、云层与尘埃。这些有限距离的结构随相机平移产生视差，只提供环境，不新增导航目标。它们是空间示意，不是逐星测距或精确的银河旋臂定位；进入银河全景时平滑淡出。

外围环境包含 16,605 颗旋臂星点、8,500 颗臂间盘面星点及 2,200 颗稀疏星晕星点。远处星点使用独立的像素核心和距离亮度预算，避免被微小光晕及尘埃衰减到不可见，原局部恒星绘制保持不变。全天 Hipparcos 背景的亮度提高，球外多个方向都有清晰星点；这些背景星沿用真实星表方向，新增有限距离的环境星则为示意分布。

最远景使用经过银河坐标对齐并调暗的 ESO/S. Brunier 实拍全天图，叠在体积云之后。它不接管相机，也不替换三维恒星；具体来源、许可、球面标定和重建脚本见 [`sky/README.md`](sky/README.md)。首屏先显示低分辨率预览，再加载 4K；拖动时推迟纹理上传，静止画面也会在加载完成后更新。WebGL 恢复会重新上传素材，图片请求失败仍保留三维星群、云层与原有银河切换。

实拍曝光由 0.12 提至 0.32，并使用柔和的 mip 过滤，保留臂外星野而避免颗粒盖过导航。接近天球两极时轻淡出摄影层，减少等距柱状纹理在极点的拉丝；清晰星表与三维星点继续显示。素材本身及其坐标标定不变。

银河全景保留外部旋臂视角，相机距离为 800，窄屏按横向视野适配。局部缩放上限 610 触发银河切换，银河混合量按整段飞行的进度平滑变化；投影、标签、平移和渲染共用当前视野。银河外观改编自 ESA 2025 年基于 Gaia 的艺术重建，保留不规则旋臂、密集尘埃暗带和较暖的中央棒；来源、CC BY-SA 3.0 IGO 许可及重建步骤见 [`galaxy/README.md`](galaxy/README.md)。

全景显示调色抑制大面积紫红偏色，以暖白核球、蓝白恒星区和褐灰尘埃区分结构，保留原图旋臂位置，并增强尘埃尺度的局部明暗。正面及斜视的体积核球按视线与翘曲尘埃盘的交点接受遮挡，前半核球和后半核球不再一律透过尘埃发光。调色属于视觉处理，三维厚度与尘埃密度为示意。

4096 px 星光纹理在最终画布分辨率下投影，使用各向异性过滤保留斜视细节。核球单独进行 32 步体积积分，低角度的年轻薄盘、较厚老年恒星层和尘埃采用 128 步积分；平滑体积层以较低分辨率计算，再与高清薄盘合成。银河支持最高 DPR 3、约 830 万像素，局部星图保留原有性能预算。银河全景不叠加随机旋臂粒子，星图不叠加装饰性颗粒，远处背景星也会变暗。Canvas 降级共用高清星光纹理；图片加载中或失败时使用程序旋臂兜底。素材加载完成后刷新静止画面，WebGL 恢复时重新上传纹理。

旧天球投影、内容、三语、图片查看器及主页转场继续共享原模块。`window.lifeStarMap` 存在时，`15` 将帧委托给新星图，`16` 跳过旧 Pointer Lock 输入，`18` 初始化新入口。修改时注意不要让旧地平线/昼夜可见性影响三维导航。

首屏 HTML 直接标记为星图模式，已经移除旧接管视角入口、Alt 控制说明、准星及注视提示；共享的无障碍播报仍保留。旧 UI 引用允许为空，仅在旧算法测试中提供节点。旧 `GalaxyRenderer` 延迟到实际使用时才初始化，正常星图启动不会创建它的 WebGL 上下文。银河高清图片在向外缩放接近边界时预取，请求进入银河后先完成解码与纹理准备，再启动飞行。准备期间局部图仍可旋转，向内缩放、Esc、重置或导航可取消进入；下载期间取消后不会自动上传或跳转。隐藏的项目图片按需加载。

旋转和平移直接跟随输入，缩放保留平滑插值。局部体积云固定使用半尺寸网格与 48 步中点积分，不随拖动启停切换采样数、网格或屏幕像素扰动；远处小于采样间隔的噪声细节按间隔滤除，减少旋转时的闪烁。银河柔和体积层固定为桌面 0.75、触屏 0.5 倍尺寸，上限 1200×900；星点、银河高清薄盘及摄影天幕仍按完整画布精度显示。`validate-cloud-stability.cjs` 读取实际体积像素，检查拖动启停一致性、微小旋转连续性及旋转返回后的重复性。

## 重新认识我与用户框

原 Notes 已由 `profile`（重新认识我 / Meet Me Again）替代，对应猎户座，以头、肩、腰带和双足构成的星光肖像介绍其他板块背后的人。点标题、任何一颗所属恒星或索引均进入同一份个人介绍，照片与个人简介取自 `home.hero`。页面沿用站点的圆角面板、淡蓝粉配色、中英文字体与圆形头像；仅用户框保留维基式的紧凑双栏内容形式，没有用户页命名空间、页签或百科页面外观。移动端可滚动查看。

用户框的选择与顺序来自 `life.profile.userboxes`，不另加标题或说明段落。已选择的 29 个框通过 `wiki_template` 指向 `userboxes/templates.json` 中经检查的维基百科模板快照，保留原配色、图标、矩形边框、两栏 / 三栏布局、链接与中文原文；英文正文使用 `text.en`。图片保存在本站，展示不依赖维基百科请求；切换语言时只显示对应版本。来源、图片署名、许可及适配说明见 [`userboxes/README.md`](userboxes/README.md) 和 `userboxes/sources.json`。

不设 `wiki_template` 的新条目仍可通过 `mark`、`tone`（blue / green / amber / violet / neutral）和三语 `text` 创建普通用户框，文本按普通文字转义。修改后运行 `python site_renderer.py --life-only`，同时更新 Life 和观景页；模板保持紧凑无衬线字体，外围面板沿用站点字体。

## CSS 分片

CSS 必须按 `life.html` 中的顺序加载。后面的文件会覆盖前面的基础规则，不要改用 `@import`。

| 顺序 | 文件 | 职责 |
| --- | --- | --- |
| 1 | `styles/01-foundation-sky.css` | 字体、变量、reset、天空 canvas、站点标记、语言切换、入场门、准星与 gaze UI |
| 2 | `styles/02-section-drawer.css` | 左侧 Life 索引、遮罩、可见性状态与抽屉按钮 |
| 3 | `styles/03-sky-navigation.css` | 星座、恒星的透明命中区、标签和交互状态 |
| 4 | `styles/04-detail-panels.css` | 星座内容面板、star reader 与 Home 航线预览 |
| 5 | `styles/05-life-content.css` | Gallery、Shelf、Thoughts、Friends、About 等 Life 原生内容样式 |
| 6 | `styles/06-homepage-parity.css` | News、Publications、Projects 等与主页保持一致的内容样式 |
| 7 | `styles/07-overlays-responsive.css` | 地图、lightbox、转场 veil、响应式布局、触屏和 reduced-motion 收尾规则 |

## Classic JS 顺序

星表、天文库及下列运行时使用 `defer` 并保持文档中的依赖顺序，使 HTML 和样式能先解析。这些文件共享同一个 classic-script 全局词法环境，不能改成 module、async，也不能改变顺序：

```text
01-content-data.js
02-sky-config.js
03-math-orientation.js
04-dom-state.js
05-astronomy.js
06-framing.js
07-galaxy-renderer.js
07-star-map-renderer.js
09-label-layout.js
10-sky-overlay.js
11-section-index.js
12-detail-navigation.js
13-gaze-constellations.js
14-portal-navigation.js
15-render-lock.js
19-star-map.js
21-deep-sky-map.js
16-input-events.js
17-content-ui.js
22-footprints-atlas.js
18-bootstrap.js
```

`03` 必须先于 `04`：`04-dom-state.js` 在顶层创建 `camera`，会立即调用 `orientationFromYawPitch`。基础分片保持原顺序，星图 `19–21` 必须在旧 `16` 输入与 `18` 启动前加载。天文库、ECharts、Hipparcos 星表、视差数据和 StellarTransit 按 `life.html` 中的依赖顺序加载。

## 运行时边界

- 星空 renderer 使用 Hipparcos 星表和本地 Astronomy Engine 计算天空位置。
- 星座连线、中心注视、命中按钮、恒星内容和 Life 索引组成唯一的页面导航主线。
- 三维星图可绕观察中心旋转，俯仰接近两极时有限制；实际视角距离和平移中心都有硬上限，输入通过平滑插值靠近边界。
- 旧地平线与观察地点计算仅保留为天文工具，星图入口始终可从索引访问。
- 页面不维护独立的地面环境 canvas、场景选择器、漫游 HUD、Three.js renderer、glTF loader 或场景碰撞；银河天幕在现有星图 renderer 内合成。
- `galaxyWorld` 是星图手势容器，不代表地面环境。

## 内容生成

Footprints 使用三张同光照的高清浮雕地图：中国、东亚为 6000 px 宽，跨大西洋的欧美连续地图为 8000 px 宽。未到访陆地使用 Blender 原生纯白、零自发光的哑光材质，海洋使用统一的灰蓝材质；发布时仅编码 WebP，不提亮成图或压淡地形阴影。到访城市与真实路网沿线的窄幅地形走廊显露省份材质和山脊阴影；不会将沿线整座城市点亮。到访城市的名称和轮廓在悬停或键盘聚焦时出现。中国最多放大至适配尺寸的 300%，东亚和欧美最多 200%，内嵌地图和大图查看器的全部输入方式共用该上限。百分比按钮直达最大缩放，支持双指缩放、拖动与 Esc 关闭。地图来源、重建流程和行程推定范围见 [`../maps/relief/README.md`](../maps/relief/README.md)，原始 Blender 工程与全部制作脚本见 [`../../tools/relief-atlas/README.md`](../../tools/relief-atlas/README.md)，新增城市与路线的步骤见 [`../../tools/relief-atlas/ADDING-FOOTPRINTS.md`](../../tools/relief-atlas/ADDING-FOOTPRINTS.md)。`22-footprints-atlas.js` 在 `17-content-ui.js` 后、`18-bootstrap.js` 前加载。

`site_content.json` 是可编辑内容的来源。`site_renderer.py` 的 Life 渲染流程只维护两个产物：

- `life.html`：更新 `SITEGEN:LIFE_*` HTML 区域。
- `scripts/01-content-data.js`：更新 `LIFE_I18N`、`LIFE_VISITED`、`LIFE_VISITED_COUNTRIES` 三个代码区域。

标记外的运行时代码不会由生成器改写。不要删除或移动 `SITEGEN` 标记，也不要直接维护标记内部的生成内容。

书影条目保存在 `life.shelf`，展示顺序由对应的 `life.moments` 决定。现有书籍保持紧凑文字形式；影视条目可增加 `image`、尺寸、三语图注、图源、短评，以及 `reviews` / `watch` 链接数组。链接的 `label` 与 `note` 均支持三语，后者说明文章类型、剧透或观看平台的订阅与地区条件。六张剧照保存在 `images/shelf/`，原始页面、图片地址和署名见其 `sources.json`；点击可用现有 lightbox 放大并在书影剧照间切换。原图比例保留，图片延迟加载，不嵌入第三方播放器。新增文字后重新生成字体子集，并同步更新两个页面的缓存版本。

## Friends 合照与浮动照片

`life.friend_portrait` 配置双人合照和三语提示，`life.friends` 中的 `portrait_side`、`portrait_outline` 定义人物左右位置与 SVG 轮廓。左侧 Yuheng 使用冷蓝微光，右侧 Qiran 使用暖色微光；点击人物或名字第一次展开照片，选中后再点同一人进入其 `href`。切换人物会替换照片，收起后重新从首次点击开始。原有 AAIL 链接仍保留。

每个人的 `memories` 数组按展示顺序保存照片。仅有 `id` 的条目显示占位卡；补入 `image`、`width`、`height` 和三语 `caption` 即可替换。当前只有 `qiran-01` 使用真实照片，`caption` 仅用于无障碍描述，不显示姓名编号。首次点击人物或名字后，照片在星空中漂浮展开；再点同一人物进入其主页。照片位于好友信息面板旁，窄屏时收拢在面板上方。关闭按钮或 Esc 收起照片。支持照片放大、键盘操作和 reduced-motion。

修改内容后运行 `python site_renderer.py --life-only`。在本地静态服务器运行时，可执行 `node scripts/validate-friends.cjs http://127.0.0.1:8793/`，检查两种星图页面、桌面与手机、首次展开／再次跳转、三语、占位卡、放大查看和焦点恢复。截图输出至 `.render-work/friends-qa/`。

## 修改与验证

运行时改动放入职责最接近的 JS，样式改动放入对应 CSS。最小验证：

```powershell
python -m py_compile site_renderer.py scripts/build-edukai-subset.py
python site_renderer.py --check --life-only
node scripts/validate-life-runtime.cjs
node scripts/validate-life-http.cjs http://localhost:8765/life.html
node scripts/validate-star-map.cjs --serve startup
node scripts/validate-star-map.cjs --serve motion
node scripts/validate-star-map.cjs --serve
node scripts/validate-star-map.cjs --serve visuals
node scripts/validate-3d-sky-environment.cjs --serve
git diff --check
```

浏览器回归至少检查：右键旋转、平移/缩放边界、触屏双指、星座连线和点击拉近、恒星内容、索引、三语、地图缩放上限、lightbox、银河全景、太阳系返回主页且不加载旧资源、系外照片详情、主页转场、窄屏、无 WebGL 和 reduced-motion。新浏览器验证脚本使用 Playwright；可通过 `PLAYWRIGHT_MODULE_PATH` 指向已有安装，不要求给站点添加依赖。`--serve` 在测试进程中启动临时本地服务器并自动关闭，也可传入已有页面 URL。可追加 `footprints` 单独检查三张地图在桌面和手机上的缩放上限。

`visuals` 分组在普通桌面、高分桌面及手机模拟视口中读取实际 WebGL 像素，检查星点可见性、普通星与主星的明暗层次及渲染错误，并保存局部图和银河各角度截图。银河检查覆盖纹理分辨率、取景、侧视暗尘埃带与核球、纹理加载及 WebGL 恢复；模拟视口验证不能代替真实手机屏幕的观感检查。

`startup` 分组故意延迟星图脚本，确认初始化前后都没有退役提示，正常启动只创建当前星图的 WebGL 上下文，不下载银河纹理或隐藏项目图片，并检查三语切换、内容关闭与项目图片的按需加载。

`motion` 分组检查输入即时跟随、运动中的云层预算及静止恢复、转场混合时长、高清素材在飞行前准备，以及取消飞行后的层级一致性。`visuals` 同时覆盖慢下载时仍可操作、取消准备、高清外观与 WebGL 恢复。实际性能比较应覆盖持续旋转和首次/重复切换，不能用启动速度或静止视角的帧率代替。

`validate-3d-sky-environment.cjs` 对照原版 `2dcb662` 检查相机、星座和星表未变，通过实际渲染像素检查球外体积云、恒星的有限距离视差及银河全景时的淡出，并覆盖 WebGL 恢复和 Canvas 降级。额外检查桌面／手机球外星点的实际明暗对比，以及远离银道面的四个方向是否显示摄影星野。截图保存在 `.render-work/3d-sky-environment/`。

### 星座与板块寓意

Life 和太阳系观景页共用八个内容入口：光影（仙后座）、足迹（大熊座 / 北斗）、书影（天琴座）、随笔（天鹅座）、友链（双子座）、重新认识我（猎户座）、品酒日记（巨爵座）、Wishlist（海豚座）。Home 星座板块已移除；主页通过左上角 Runde Yang、太阳系弹窗或全局转场访问。News、Publications、Projects 仅保留在学术主页，不再进入 Life 的页面、索引或恒星绑定。

点击星座名称、所属恒星或索引，统一打开整个板块；所有内容按保存顺序完整显示，点击另一颗星或切换语言不会筛选条目。旧 `data-star-hip` 仅保留为内容元数据，不再参与显示筛选。足迹地图在打开星座时初始化。

每个内容面板顶部的「星座寓意」读取 `02-sky-config.js` 的 `constellationStories`，随界面语言更新。巨爵座使用现有 Hipparcos 星表中的八颗真实恒星，杯形连线为本站自行编排；观景页保持真实天球位置。

品酒日记的数据保存在 `site_content.json` 的 `life.wine` 中：`copy` 提供栏目标签，`entries` 按展示顺序保存配方、步骤、风味、品鉴方法、调整建议与来源。当前收录「高潮」的等量咖啡／杏仁／奶油利口酒版本，以及玛格丽特的 IBA 50／20／15 ml 配方；内容为调制与品鉴指南，不包含虚构的个人经历或评分。每个条目提供英、简中、繁中三语文案，由 `render_life_wine()` 与 `wine_text_values()` 同步生成两种星图页面及语言数据。新增文字后须重新生成 EduKai 字体子集。

Wishlist 使用海豚座的五颗 Hipparcos 恒星，以轻快、好奇与结伴出发对应娱乐愿望。具体项目暂留空，通用邀约始终可用；在 `life.wishlist.entries` 按显示顺序添加具有唯一 `id`、三语 `title` 和 `description` 的条目，即可自动生成项目卡片及「这个我也想去」按钮。通用按钮复制含收件人、主题与正文的完整邮件，项目按钮自动带入项目标题；邮箱读取 `site.email_user` / `site.email_domain`，模板与状态提示读取 `life.wishlist.copy`。所有文字以纯文本转义。

邮件只在访客主动点击时写入剪贴板，不自动发出；旁边的 `mailto:` 链接预填收件人、主题和正文，由访客编辑发送。剪贴板 API 失败时尝试浏览器复制命令，两者均不可用则展开并选中只读草稿供手动复制。`setLang()` 同步草稿、邮件链接与提示；复制过程中禁止重复触发，切换语言后清除旧语言的成功状态。验证使用 `node scripts/validate-wishlist.cjs http://127.0.0.1:8788/`（需 Playwright），覆盖两页、桌面／手机、真实剪贴板、降级与邮件编码。

### 旋转时的标签稳定性

`09-label-layout.js` 为三维星图和太阳系观景页共用的标签布局器。星座和天体标签保留各自的候选位置，遮挡持续 220 ms 后才尝试换位；换位采用最近的可用位置，且有 650 ms 冷却。进入与退出避让区使用不同边距，避免临界位置反复切换。相机带来的位移直接跟随，标签自身的偏移变化限速平滑；显隐有独立缓冲。

标签优先级在视口布局时固定，悬停只改变高亮，不重新排布。星座边界使用前方全部投影点，不因一颗星刚好出屏就改变名称位置。窗口尺寸变化时重建布局。`node scripts/validate-label-stability.cjs http://127.0.0.1:8787/` 在桌面和触屏视口采样两种星图的持续旋转，检查大幅跳位、短暂闪烁、悬停引起的重排和旋转后的点击。
