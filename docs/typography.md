# 中英文排版与字体子集

首页、Life 和观景页共用 Newsreader 西文正文、IBM Plex Sans 界面字和 IBM Plex Mono 等宽字。拉丁字母和数字不随中文界面改用楷体。中文字体声明限定 CJK Unicode 范围，正文栈优先使用 Newsreader，避免中文字体中的 ASCII 字形截获英文。

繁体正文优先使用 EduKai（台湾教育部标准楷体），缺字回退到 Site WenKai。原 EduKai 字库并不包含许多常用简体字，因此简体正文统一优先使用 Site WenKai，避免一段文字内频繁切换字形。Site WenKai 是 LXGW WenKai Regular v1.530 的改名网页子集，许可保存在 `fonts/OFL-WenKai.txt`。

## 重建

安装 Python 的 `fonttools[woff]` 后运行：

```powershell
python scripts/build-edukai-subset.py
python scripts/build-edukai-subset.py --check
```

默认构建 `fonts/edukai-site-subset.woff2` 和 `fonts/wenkai-site-subset.woff2`。EduKai 原始字库保存在仓库；WenKai 原始 TTF 首次由固定版本地址下载至忽略目录 `.render-work/`，必须通过脚本中固定的 SHA-256 校验。无需将 24.73 MiB 的完整 TTF 发布到网站。

构建扫描三张页面、Life/观景页引用的本地脚本与样式、`site_content.json`，以及拾文原文和译文 JSON。HTML 实体与 Unicode 转义均先解码。保留字体布局信息和竖排替代字形，验证生成文件后原子替换。`--check` 在当前文本有任何 CJK 字符不被两个发布子集覆盖时失败；添加内容后应先生成页面，再重建字体。

更新字体时同时更换首页和 `assets/life/styles/01-foundation-sky.css` 中字体 URL 的缓存版本，以及 Life/观景页引用样式的版本。字体按实际文字和语言加载，避免预加载错误语言的整个中文子集。

`node scripts/validate-reading.cjs` 在 Chrome 中检查首页和两个阅读页的简繁英字体，使用 CDP 的实际渲染字形信息验证 Newsreader、Site WenKai 与 TW-MOE-Std-Kai，而不是仅检查 CSS 字体栈。
