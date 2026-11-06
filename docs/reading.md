# 拾文 · 北冕座

`life.html` 的 `reading` 是独立于随笔的阅读收藏板块。北冕座的弧形冠冕寓意把喜爱的文字逐篇拾起、串珠成冠；恒星位置来自站点现有 Hipparcos 星表。星图、星座索引和观景页共用入口与内容。

栏目配置保存在 `site_content.json` 的 `life.reading`，正文通过 `articles_file` 从 `wechat-archives/西多梅/articles.json` 加载，和原始 Markdown、清单、采集记录集中在同一独立文件夹。通过 `python site_renderer.py --reading-only` 同时生成 Life、观景页和三语界面文案。该命令只更新拾文，保留其他板块已发布的内容；现有页面与旧生成器在其他区域存在历史不同步，不宜为拾文运行全量生成。不要手改生成区域。界面随站点语言切换，收录的正文、标题、作者与图注保留原文。

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

正文块支持 `text`、`heading`、`quote`（均使用 `text` 字段）、`image` 和 `link`。`link` 使用 `text`、`url`，只允许 HTTPS 来源；文字版以它保留原文配图和配乐入口。图片使用 `src`、`width`、`height`、`alt`、`caption`，文件须保存到 `images/reading/`，保留 GIF 动画等原始内容；图片可以单独打开查看。所有文字按纯文本转义，避免导入公众号脚本。收录时保留段落、图文顺序、图注和署名，逐篇核对来源和图片数量。遇到当前模型不能保留的音视频、链接或格式，应先扩展支持，不可静默丢弃。

2026-11-05：现已收录微信公众号「西多梅」的 31 篇已发现文章，2025-11-07 至 2026-10-30，正文费用 ¥0.30。界面明确显示“追更”、来源公众号、发布日期、文字版说明及逐篇微信原文入口；不自动把发布账号当作引用作品的作者。历史接口曾返回重复页，因此归档清单仍标记 partial，不宣称账号历史已完整。没有配置自动同步。归档正文和 CSV 均移除了未采集的互动零值。

添加图文后运行生成器，重新生成 `fonts/edukai-site-subset.woff2` 并更新相关资源版本。验证命令：

```powershell
python site_renderer.py --check --reading-only
python scripts/validate-reading.py
node scripts/validate-reading.cjs
```

旧的 `validate-life-runtime.cjs` 在基线即要求 21 个脚本，现有页面已经是 23 个；该断言会先行失败，与本板块无关。新增检查覆盖两个页面的桌面／手机、三语、独立导航、原文来源、待收录状态、正文与图注保留及转义。
