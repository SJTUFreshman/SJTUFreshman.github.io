# Life 页面维护指南

`life.html` 是一幅分层三维星图。右键拖动旋转、左键拖动平移、滚轮缩放；触屏单指旋转，双指缩放和平移。指针始终自由，不需要 Pointer Lock。访客通过带连线的星座进入 Gallery、Footprints、Shelf、Thoughts、Friends、News、Publications、Projects、Notes 和 Home 等内容。

键盘方向键旋转，Shift + 方向键平移，`+` / `-` 缩放，`R` / `Home` 重置视角；`Esc` 逐层返回。界面不显示右下角控制栏或边界提示，距离和平移限制仍然生效。

## 星图层级

- 默认进入局部星域；局部范围内连续缩放，越过拉远阈值后用动画切到银河全景。银河全景的向内缩放触发动画返回局部，向外缩放停在边界。远处恒星是无平移视差的背景。
- 局部星域展开内容星座。星座图形采用原 Hipparcos 天球几何，以浅纵深编排到可探索的区域，避免真实星际尺度破坏导航。
- 太阳系在局部图中仅有一个入口。进入后展开太阳、八大行星及月球，选中后使用既有天体近景渲染与纹理。
- 仙女座星系与猎户座大星云分别为单个入口；详情使用有明确波段、来源署名的 NASA 观测照片。
- 银河盘、尘埃和空间布局是示意可视化；不把编排坐标标为真实物理距离。真实距离来自质量筛选的 Hipparcos 视差，详见 `../HIPPARCOS-DISTANCES-NOTICE.md`。

## 新星图运行时

`07-star-map-renderer.js` 提供 WebGL 体积尘埃、恒星和银河盘，失去 WebGL 时切换为 Canvas。`19-star-map.js` 管理有界相机、层级、星座、命中与输入；它在旧 `15` 之后、`16` 之前加载。`20-solar-system-map.js` 和 `21-deep-sky-map.js` 也在 `18` 初始化之前加载。`08-star-map.css`、`09-solar-system-map.css`、`10-deep-sky-map.css` 顺序追加到样式末尾。

旧天球投影、太阳系近景、内容、三语、图片查看器及主页转场继续共享原模块。`window.lifeStarMap` 存在时，`15` 将帧委托给新星图，`16` 跳过旧 Pointer Lock 输入，`18` 初始化新入口。修改时注意不要让旧地平线/昼夜可见性影响三维导航。

## CSS 分片

CSS 必须按 `life.html` 中的顺序加载。后面的文件会覆盖前面的基础规则，不要改用 `@import`。

| 顺序 | 文件 | 职责 |
| --- | --- | --- |
| 1 | `styles/01-foundation-sky.css` | 字体、变量、reset、天空 canvas、站点标记、语言切换、入场门、准星与 gaze UI |
| 2 | `styles/02-section-drawer.css` | 左侧 Life 索引、遮罩、可见性状态与抽屉按钮 |
| 3 | `styles/03-sky-navigation.css` | 星座、天体、恒星的透明命中区、标签和交互状态 |
| 4 | `styles/04-detail-panels.css` | 星座内容面板、天体观测面板、star reader 与 Home 航线预览 |
| 5 | `styles/05-life-content.css` | Gallery、Shelf、Thoughts、Friends、About 等 Life 原生内容样式 |
| 6 | `styles/06-homepage-parity.css` | News、Publications、Projects、Notes 等与主页保持一致的内容样式 |
| 7 | `styles/07-overlays-responsive.css` | 地图、lightbox、转场 veil、响应式布局、触屏和 reduced-motion 收尾规则 |

## Classic JS 顺序

这些文件共享同一个 classic-script 全局词法环境，不能改成 module，也不能改变顺序：

```text
01-content-data.js
02-sky-config.js
03-math-orientation.js
04-dom-state.js
05-astronomy.js
06-framing.js
07-galaxy-renderer.js
07-star-map-renderer.js
08-closeup-layout.js
09-closeup-renderer.js
10-sky-overlay.js
11-section-index.js
12-detail-navigation.js
13-gaze-constellations.js
14-celestial-visits.js
15-render-lock.js
19-star-map.js
20-solar-system-map.js
21-deep-sky-map.js
16-input-events.js
17-content-ui.js
18-bootstrap.js
```

`03` 必须先于 `04`：`04-dom-state.js` 在顶层创建 `camera`，会立即调用 `orientationFromYawPitch`。基础分片保持原顺序，星图 `19–21` 必须在旧 `16` 输入与 `18` 启动前加载。天文库、ECharts、Hipparcos 星表、视差数据和 StellarTransit 按 `life.html` 中的依赖顺序加载。

## 运行时边界

- 星空 renderer 使用 Hipparcos 星表和本地 Astronomy Engine 计算天空位置。
- 星座连线、中心注视、命中按钮、恒星内容和 Life 索引组成唯一的页面导航主线。
- 三维星图可绕观察中心旋转，俯仰接近两极时有限制；实际视角距离和平移中心都有硬上限，输入通过平滑插值靠近边界。
- 旧地平线与观察地点计算仅保留为天文工具，星图入口始终可从索引访问。
- 页面不维护环境 canvas、全景贴图、场景选择器、漫游 HUD、Three.js renderer、glTF loader 或场景碰撞。
- `galaxyWorld` 是星图手势容器，不代表地面环境。

## 内容生成

Footprints 使用三张同光照的高清浮雕地图：中国、东亚为 6000 px 宽，跨大西洋的欧美连续地图为 8000 px 宽。到访城市与真实路网沿线的窄幅地形走廊显露省份材质和山脊阴影；不会将沿线整座城市点亮。到访城市的名称和轮廓在悬停或键盘聚焦时出现。大图查看器支持 8 倍缩放、原始分辨率、双指缩放、拖动与 Esc 关闭。地图来源、重建流程和行程推定范围见 [`../maps/relief/README.md`](../maps/relief/README.md)，四个原始 Blender 工程和全部制作脚本见 [`../../tools/relief-atlas/README.md`](../../tools/relief-atlas/README.md)。`22-footprints-atlas.js` 在 `17-content-ui.js` 后、`18-bootstrap.js` 前加载。

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
node scripts/validate-star-map.cjs --serve
git diff --check
```

浏览器回归至少检查：右键旋转、平移/缩放边界、触屏双指、星座连线和点击拉近、恒星内容、索引、三语、地图、lightbox、银河全景、太阳系逐层进入与返回、系外照片详情、主页转场、窄屏、无 WebGL 和 reduced-motion。新浏览器验证脚本使用 Playwright；可通过 `PLAYWRIGHT_MODULE_PATH` 指向已有安装，不要求给站点添加依赖。`--serve` 在测试进程中启动临时本地服务器并自动关闭，也可传入已有页面 URL。
