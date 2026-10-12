# 随笔阅读与论文档案

随笔正文仍来自 `site_content.json` 的 `life.thoughts`，标题和时间线归属来自
`life.moments`。编辑各语言的原文后运行 `python site_renderer.py --life-only`；
正文中的空行保留为段落，不需要添加 HTML。

专注阅读采用教育部标楷体 `EduKai`。只有 `zh-TW` 使用从右至左的竖排；
`zh-CN` 横排，英语使用横排的 Newsreader。入口有淡入纸面的动画，系统开启
“减少动态效果”时立即进入。关闭阅读后返回同一篇随笔，保留星图视角。

繁体长文可横向滑动、用滚轮向后阅读，或使用底部的“續讀／回看”。键盘的
Page Down、空格、左箭头前进，Page Up、Shift+空格、右箭头后退，Home／End
到达开头／结尾。触控板捏合继续使用浏览器缩放。语言切换会重置阅读位置。

阅读样式在 `assets/life/styles/05-life-content.css`，交互在
`assets/life/scripts/17-content-ui.js`，装饰竹叶在 `assets/life/reader-bamboo.svg`。
竖排的高度取自实际阅读区域，正文连续横向滚动，避免长文被裁成固定高度。
横竖排切换时重建滚动容器，取消浏览器尚未结束的原方向滚动，避免手机上
切换语言后的短暂错位；正文节点和对话框保持原有内容与焦点语义。

`home.publications` 保存完整论文档案。没有 `selected` 字段或值为 `true`
的论文进入主页精选；`selected: false` 的论文只在 Life 的 Pegasus 中展示。
例如 AppCopilot 保留在完整档案中，不进入主页精选。每篇论文只维护一份作者、
会议信息、链接与引用；星点归属仍由 `life.star_bindings.publications` 指定。

验证：

```powershell
python site_renderer.py --check --life-only
node scripts/validate-life-runtime.cjs
node scripts/validate-star-map.cjs --serve content
node scripts/validate-star-map.cjs --serve reduced-motion
```

浏览器检查覆盖桌面、390px 和 320px 手机：三种语言的完整原文、竖排最后一字、
滚轮／触控／键盘、入场时取消、焦点返回、星图视角以及完整／精选论文的区别。
