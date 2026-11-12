# 拾文 · 北冕座

`life.html` 的 `reading` 是独立于随笔的阅读收藏板块。北冕座的弧形冠冕寓意把喜爱的文字逐篇拾起、串珠成冠；恒星位置来自站点现有 Hipparcos 星表。星图、星座索引和观景页共用入口与内容。

栏目配置保存在 `site_content.json` 的 `life.reading`，原文通过 `articles_file` 从 `wechat-archives/西多梅/articles.json` 加载，三语译文通过 `translations_file` 从同目录的 `translations.json` 加载。原始 Markdown、清单、采集记录保持独立。通过 `python site_renderer.py --reading-only` 同时生成 Life、观景页和三语内容。该命令只更新拾文，保留其他板块已发布的内容；现有页面与旧生成器在其他区域存在历史不同步，不宜为拾文运行全量生成。不要手改生成区域。

每个 `collections` 条目代表一个来源或阅读系列，含唯一 `id`、三语 `title`、`source_url`、`following` 和 `articles`。`following: true` 展示“追更”标记，仅代表阅读状态，不意味着已经配置自动同步。空的 `articles` 明确展示“待收录”，不会表示内容已经归档。

文章字段：

| 字段 | 用途 |
| --- | --- |
| `id` | 来源内唯一的小写字母、数字、连字符或下划线标识 |
| `title`、`author` | 原文标题与作者署名 |
| `source_url` | 该篇文章的完整 HTTPS 原文链接 |
| `published` | 可选的原始发布日期，格式 YYYY-MM-DD |
| `language` | 正文语言，默认为 `zh-CN` |
| `body` | 按原文顺序排列的内容块 |

正文块支持 `text`、`heading`、`quote`（均使用 `text` 字段）、`image` 和 `link`。`link` 使用 `text`、`url`，只允许 HTTPS 来源，用于保留配乐等原文入口。图片使用 `src`、`width`、`height`、`alt`、可选的 `caption` 和溯源字段 `source_url`，文件须保存到 `images/reading/`，保留原始图片字节及 GIF 动画；图片可以单独打开查看。所有文字按纯文本转义，避免导入公众号脚本。收录时保留段落、图文顺序和具体署名，逐篇核对来源和图片数量。遇到当前模型不能保留的音视频、链接或格式，应先扩展支持，不可静默丢弃。

文章列表显示标题、发布日期与开篇摘录；点击后复用随笔的 `thoughtReader` 对话框、纸张和竹影效果、进度与退出动画。标题、摘录、正文、配乐文字、图片说明随站点或阅读器语言切换，打开中的文章也同步更新。繁体沿用随笔的右向左竖排，简体和英文横排，图片保持正向显示。关闭后恢复列表位置和触发按钮焦点。

`translations.json` 按文章 ID 保存三语 `title`、与原文逐块对应的 `body` 和原文 `source_sha256`。每个译文块只允许原文已有的 `text`、`alt`、`caption` 字段，并必须提供 `en`、`zh-CN`、`zh-TW`；图片文件、尺寸、顺序及原文地址来自原文数据。简繁版本以 OpenCC 转换为底稿，英文逐段翻译，解码显示用 HTML 实体并清理零宽字符。哈希覆盖原文标题和正文，原文变化后校验会要求同步译文，避免错段或漏译。所有译文仍按纯文本转义。

2026-11-07：31 篇拾文和《夢的餘燼》均提供繁简英完整内容。后者的繁体版保留用户修订原文，日期为 2026-11-05。中文段落中的拉丁字母使用 Newsreader；界面和等宽文字继续使用 IBM Plex。2026-11-08 按用户要求恢复简体、繁体均优先使用原标楷体，仅原字库缺少的字符由文楷补缺。字体构建与许可见 `docs/typography.md`。

2026-11-05：现已收录微信公众号「西多梅」的 31 篇已发现文章，2025-11-07 至 2026-10-30，正文费用 ¥0.30。界面明确显示“追更”、来源公众号、发布日期、文字版说明及逐篇微信原文入口；不自动把发布账号当作引用作品的作者。历史接口曾返回重复页，因此归档清单仍标记 partial，不宣称账号历史已完整。没有配置自动同步。归档正文和 CSV 均移除了未采集的互动零值。

2026-11-06：补齐 28 张正文配图，保存在 `images/reading/xiduomei/`，当前为图文版。原始地址、尺寸和文件校验值保存在归档目录的 `images.json`。图片通过已保存地址免费下载，无新增次幂费用；`python scripts/localize-reading-images.py`（依赖 Pillow）可复用已下载图片并更新归档。页面和整理后的 Markdown 已按要求清除“图源网络，侵删”类注记，保留具体图源和 AI 生成说明。

添加图文或译文后运行生成器，执行 `python scripts/build-edukai-subset.py` 重建正文和界面字体子集并更新相关资源版本。验证命令：

```powershell
python site_renderer.py --check --reading-only
python scripts/build-edukai-subset.py --check
python scripts/validate-reading.py
node scripts/validate-reading.cjs
```

旧的 `validate-life-runtime.cjs` 在基线即要求 21 个脚本，现有页面已经是 23 个；该断言会先行失败，与本板块无关。检查覆盖两个页面的桌面／手机、31 篇三语正文、阅读中语言切换、原文来源、图片与署名、失效译文及转义，并通过 Chrome 实际字形信息验证首页和阅读器的中英文混排。
