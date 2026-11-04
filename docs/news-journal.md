# 首页动态手账

`site_content.json` 的 `home.news` 按数组顺序展示，每条动态都是一个可用键盘打开的按钮。
点击后显示独立手账，支持关闭按钮、Escape、点击纸页外关闭，并恢复入口焦点。
手机使用单栏排版，纸页可滚动；系统开启“减少动态效果”时取消入场动画。

当前两页都是明确标记的占位演示，插画为本地 SVG，没有使用真实活动照片或编造活动记录。
`2026/10/30` 使用万圣节插画，`2026/6/29` 使用书本与夏日插画。

后续可为每条动态的 `journal` 补充以下字段：

- `theme`：`halloween` 或 `summer`，默认 `summer`。
- `body`：`en`、`zh-CN`、`zh-TW` 三种语言的正文，空行保留为段落；按纯文本处理。
- `image`：本地图片路径，推荐横向 4:3 图片。
- `image_alt`：三种语言的图片替代文字。
- `caption`：三种语言的图片说明。
- `demo`：默认 `true`；正式内容准备好后设为 `false`，移除占位演示标记。

未填写正文、图片或说明时自动使用演示内容。标题和日期直接使用动态的 `text` 与 `date`。
通用界面文字在 `home.labels` 中维护；样式和交互位于 `assets/news-journal.css`、
`assets/news-journal.js`。

生成与验证：

```powershell
python site_renderer.py --home-updates-only
python site_renderer.py --check --home-updates-only
node scripts/validate-home-news.cjs
```

此生成模式只同步动态、手账、论文、相关翻译和引用，保留主页其余布局及交互。
完整站点生成器仍有既有的 `HOME_GALLERY` 区域缺失问题；首页这些内容可使用上述独立模式维护。
浏览器验证沿用项目的 `PLAYWRIGHT_MODULE_PATH` 和 `CHROME_EXECUTABLE_PATH` 环境变量，
默认使用本机 Chrome，截图保存在 `.render-work/home-news/`。

DevicesWorld 的标题、作者顺序、年份和论文链接核对自
<https://arxiv.org/abs/2607.13465>；代码链接来自该页面的 Comments。
AppCopilot 沿用完整论文档案中的资料。
