# Life 页面维护指南

`life.html` 是一片纯交互星空。访客通过拖动、自由视角和中心注视发现真实星辰与星座，再进入 Gallery、Footprints、Shelf、Thoughts、Friends、News、Publications、Projects、Notes 和 Home 等内容入口。页面不加载全景、Three.js、glTF 模型或其他地面场景。

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
```

`03` 必须先于 `04`：`04-dom-state.js` 在顶层创建 `camera`，会立即调用 `orientationFromYawPitch`。前 18 个文件按编号加载；天文库、ECharts、Hipparcos 星表和 StellarTransit 仍按 `life.html` 中的依赖顺序加载。

## 运行时边界

- 星空 renderer 使用 Hipparcos 星表和本地 Astronomy Engine 计算天空位置。
- 星座连线、中心注视、命中按钮、恒星内容和 Life 索引组成唯一的页面导航主线。
- 手动视角保持直立天穹：俯仰限制在地平线以上 8° 到天顶以下 12°，A/D 不再承担翻滚操作。
- 本地观察地点仍可从主页天气设置同步；地平线和大气可见性仍按真实观察地点计算。
- 页面不维护环境 canvas、全景贴图、场景选择器、漫游 HUD、Three.js renderer、glTF loader 或场景碰撞。
- `galaxyWorld` 仍是星空和 pointer-lock 的交互容器，不代表地面环境。

## 内容生成

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
git diff --check
```

浏览器回归至少检查：入场与 pointer lock、鼠标／触摸环顾、天穹俯仰边界、星座点击和拉近、恒星内容、Life 索引、三语切换、地图、lightbox、Home 航线、StellarTransit 返回、窄屏和 reduced-motion。
