# Life 页面分片维护指南

`life.html` 只保留页面骨架、可访问性结构、站点内容区和资源引用。页面视觉与运行时分别拆到本目录的 7 个 CSS 和 18 个 classic JS 中，以便后续 Codex 在较小上下文内维护。

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
```

`03` 必须先于 `04`：`04-dom-state.js` 在顶层创建 `camera`，会立即调用 `orientationFromYawPitch`。文件编号与加载顺序保持一致。

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

## 跨文件状态约定

- 共享核心对象包括 `i18n`、`skyModel`、`portalDefinitions`、`celestialBodies`、`dom`、`state`、`camera`、`galaxyRenderer` 和 `celestialCloseupRenderer`。
- 顶层 `const`、`let`、class 和 function 由后续 classic script 直接按标识符访问；它们不保证是 `window` 属性。不要创建重名顶层绑定，也不要把单个文件包进 IIFE 而不同时改完全部调用方。
- `portalDefinitions` 与 `celestialBodies` 是运行时可变模型。代码会写入 `current`、`screen`、`button`、`entriesByHip` 等字段，不要把整个对象深度冻结。
- 顶层副作用必须保持唯一：renderer 只在 `09` 创建，事件只绑定一次，完整 bootstrap 只在 `18` 执行。
- 新的纯计算函数应放在依赖它的状态文件之前；新的顶层实例化只能放在其所有 class、DOM 和配置依赖之后。
- DOM `id`、`data-portal-*`、`data-star-hip`、`inert`、ARIA 和 focus-trap 行为也是运行时契约，修改标记时必须同步检查 `dom` 注册表与验证器。

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
```

可见文案或字形变化后再运行：

```powershell
python scripts/build-edukai-subset.py
```

浏览器回归建议通过本地 HTTP 服务进行，至少检查：昼夜天空、地平线、太阳与月亮、星座点击和拉近、Life 索引、pointer lock/fallback、Alt/Esc、三语切换、地图、lightbox、Home 航线、StellarTransit 返回、窄屏和触屏。不要只验证首屏是否能打开。
