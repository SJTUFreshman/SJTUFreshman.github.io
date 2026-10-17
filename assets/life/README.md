# Life 页面维护指南

`life.html` 是一幅分层三维星图。右键拖动旋转、左键拖动平移、滚轮缩放；触控板双指滑动旋转、捏合缩放；触屏单指旋转，双指缩放和平移。指针始终自由，不需要 Pointer Lock。访客通过带连线的星座进入 Gallery、Footprints、Shelf、Thoughts、Friends、News、Publications、Projects、Notes 和 Home 等内容。

星图的滚轮手势处理：浏览器的 Ctrl / Meta + wheel 捏合事件只缩放，连续像素滚动控制旋转，同一段滑动的加速和惯性保持旋转。浏览器不直接提供输入设备类型，因此按行、按页和较大的整数步进识别为普通鼠标滚轮；少数驱动或平滑滚轮可能无法准确区分，仍可用 Ctrl + 滚轮缩放。

键盘方向键旋转，Shift + 方向键平移，`+` / `-` 缩放，`R` / `Home` 重置视角；`Esc` 逐层返回。界面不显示右下角控制栏或边界提示，距离和平移限制仍然生效。

## 星图层级

- 默认进入局部星域；局部范围内连续缩放，越过拉远阈值后用动画切到银河全景。银河全景的向内缩放触发动画返回局部，向外缩放停在边界。局部星域外的旋臂星群和云层保留三维深度与平移视差；最远的星表背景与摄影天幕没有平移视差。
- 局部星域展开内容星座。星座图形采用原 Hipparcos 天球几何，以浅纵深编排到可探索的区域，避免真实星际尺度破坏导航。
- 太阳系在局部图中保留一个返回主页的入口。点击、触屏和键盘激活均通过主页转场返回 `index.html`；内部场景、近景、播放控制和纹理已移除。
- 仙女座星系与猎户座大星云分别为单个入口；详情使用有明确波段、来源署名的 NASA 观测照片。
- 银河盘、尘埃和空间布局是示意可视化；不把编排坐标标为真实物理距离。真实距离来自质量筛选的 Hipparcos 视差，详见 `../HIPPARCOS-DISTANCES-NOTICE.md`。

## 新星图运行时

`07-star-map-renderer.js` 提供 WebGL 体积尘埃、恒星和银河盘，失去 WebGL 时切换为 Canvas。`19-star-map.js` 管理有界相机、层级、星座、命中与输入；它在旧 `15` 之后、`16` 之前加载。`21-deep-sky-map.js` 也在 `18` 初始化之前加载。`08-star-map.css`、`10-deep-sky-map.css` 顺序追加到基础样式之后。

局部星图的可探索范围与周围环境分开：原有 Hipparcos 三维星点、内容星座、局部体积云以及相机限制保持不变，外围另有延伸的本地臂和邻近臂星群、云层与尘埃。这些有限距离的结构随相机平移产生视差，只提供环境，不新增导航目标。它们是空间示意，不是逐星测距或精确的银河旋臂定位；进入银河全景时平滑淡出。

最远景使用经过银河坐标对齐并调暗的 ESO/S. Brunier 实拍全天图，叠在体积云之后。它不接管相机，也不替换三维恒星；具体来源、许可、球面标定和重建脚本见 [`sky/README.md`](sky/README.md)。首屏先显示低分辨率预览，再加载 4K；拖动时推迟纹理上传，静止画面也会在加载完成后更新。WebGL 恢复会重新上传素材，图片请求失败仍保留三维星群、云层与原有银河切换。

银河全景保留外部旋臂视角，相机距离为 800，窄屏按横向视野适配。局部缩放上限 610 触发银河切换，银河混合量按整段飞行的进度平滑变化；投影、标签、平移和渲染共用当前视野。银河外观改编自 ESA 2025 年基于 Gaia 的艺术重建，保留不规则旋臂、密集尘埃暗带和较暖的中央棒；来源、CC BY-SA 3.0 IGO 许可及重建步骤见 [`galaxy/README.md`](galaxy/README.md)。

4096 px 星光纹理在最终画布分辨率下投影，使用各向异性过滤保留斜视细节。核球单独进行 32 步体积积分，低角度的年轻薄盘、较厚老年恒星层和尘埃采用 128 步积分；平滑体积层以较低分辨率计算，再与高清薄盘合成。银河支持最高 DPR 3、约 830 万像素，局部星图保留原有性能预算。银河全景不叠加随机旋臂粒子，星图不叠加装饰性颗粒，远处背景星也会变暗。Canvas 降级共用高清星光纹理；图片加载中或失败时使用程序旋臂兜底。素材加载完成后刷新静止画面，WebGL 恢复时重新上传纹理。

旧天球投影、内容、三语、图片查看器及主页转场继续共享原模块。`window.lifeStarMap` 存在时，`15` 将帧委托给新星图，`16` 跳过旧 Pointer Lock 输入，`18` 初始化新入口。修改时注意不要让旧地平线/昼夜可见性影响三维导航。

首屏 HTML 直接标记为星图模式，已经移除旧接管视角入口、Alt 控制说明、准星及注视提示；共享的无障碍播报仍保留。旧 UI 引用允许为空，仅在旧算法测试中提供节点。旧 `GalaxyRenderer` 延迟到实际使用时才初始化，正常星图启动不会创建它的 WebGL 上下文。银河高清图片在向外缩放接近边界时预取，请求进入银河后先完成解码与纹理准备，再启动飞行。准备期间局部图仍可旋转，向内缩放、Esc、重置或导航可取消进入；下载期间取消后不会自动上传或跳转。隐藏的项目图片按需加载。

旋转和平移直接跟随输入，缩放保留平滑插值。拖动、缩放和飞行时，仅柔和的体积云层使用半尺寸画布；停止操作后恢复原来的局部或银河体积精度。星点、星光亮度和银河高清薄盘保持原有质量，避免用降低整个画布清晰度来换取跟手性。

## CSS 分片

CSS 必须按 `life.html` 中的顺序加载。后面的文件会覆盖前面的基础规则，不要改用 `@import`。

| 顺序 | 文件 | 职责 |
| --- | --- | --- |
| 1 | `styles/01-foundation-sky.css` | 字体、变量、reset、天空 canvas、站点标记、语言切换、入场门、准星与 gaze UI |
| 2 | `styles/02-section-drawer.css` | 左侧 Life 索引、遮罩、可见性状态与抽屉按钮 |
| 3 | `styles/03-sky-navigation.css` | 星座、恒星的透明命中区、标签和交互状态 |
| 4 | `styles/04-detail-panels.css` | 星座内容面板、star reader 与 Home 航线预览 |
| 5 | `styles/05-life-content.css` | Gallery、Shelf、Thoughts、Friends、About 等 Life 原生内容样式 |
| 6 | `styles/06-homepage-parity.css` | News、Publications、Projects、Notes 等与主页保持一致的内容样式 |
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

`validate-3d-sky-environment.cjs` 对照原版 `2dcb662` 检查相机、星座和星表未变，通过实际渲染像素检查球外体积云、恒星的有限距离视差及银河全景时的淡出，并覆盖 WebGL 恢复和 Canvas 降级。截图保存在 `.render-work/3d-sky-environment/`。
