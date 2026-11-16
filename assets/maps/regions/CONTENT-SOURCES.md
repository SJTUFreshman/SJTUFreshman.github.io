# 地域图志：文字与景观照片

`content.json` 与 `places.json` 由 `scripts/build-region-content.py` 生成；本地图片在 `photos/`。它们与地形烘焙数据分开维护，通过城市行政代码、文化区 ID 或 `poi:<城市代码>:<序号>` 关联。

## 文字

百科摘要来自各条记录 `textSources` 指向的中、英文维基百科条目，作者为相应条目历史中的 Wikipedia contributors，使用 [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)。发布版本保留短摘要，去除读音括注，并进行简繁转换；来源链接和许可随内容保留。文化分区的 `editorialBasis` 来自本站原有文化分区依据，是导览编排，不表示文化边界或行政疆界精确重合。

47 个文化区的主简介独立维护在 `scripts/region-culture-content.json`，均为原创文化摘要，依据 UNESCO、国家非遗机构、博物馆及地方文化机构的资料编写，使用 `textKind: editorial-cultural` 和逐条 `textSources` 标记。它们不使用对应行政省份的百科简介。文化主图呈现特定传统、文化建筑或聚落，其具体地点见图片替代文字与来源；一处景物不涵盖区域内所有社群。喜马拉雅新增单位及景点的原创文字、坐标和许可见 `scripts/region-extension-content.json`。行政子区仍保留原有百科内容。

显示文字按站点要求统一使用“中华台北／中華臺北／Chinese Taipei”，原始来源 URL、照片文件名与许可链接保留不变；英文完整名称 People's Republic of China 不受此映射影响。

## 照片

照片是当地景观参考资料，不表示网站作者本人拍摄，也不表示作者曾到访照片中的具体景点。每条 `photo` 包含：

- `source`：原始 Wikimedia Commons 文件介绍页。
- `credit`、`license`、`licenseUrl`：作者与原始许可。
- `originalFile`：原文件名。
- `modifications`：本地缩小、转换 WebP 的说明；不改动影像内容。

展示照片时应同时展示署名、许可和原页链接。CC BY-SA 图片的本地缩小版本沿用原许可；无需将文字或整个网站套用照片的许可。生成脚本排除旗帜、徽章、行政位置图，下载真实景观、建筑或遥感照片，并保留其地点说明。重新选择图片时应人工检查缩略图。

## 重建

安装 `pillow` 和 `opencc-python-reimplemented` 后执行：

```sh
python scripts/build-region-content.py
python scripts/build-region-content.py --package-content-only
python scripts/build-edukai-subset.py
python scripts/build-edukai-subset.py --check
```

API 快照与下载原图仅缓存于未发布的 `.render-work/region-content/`，无需放到网站。发布的 WebP 最长边不超过 720 px，无原图 EXIF、相机参数或无关元数据。更新文本后必须重建字体，以包含异步载入内容中的全部中文字符。

仅更新文化简介及主图时可执行 `python scripts/build-region-content.py --refresh-cultural-only`。新增景点后先刷新地形记录的 `places`，再执行 `--package-content-only`，生成每个地区独立的 `content/*.json`；页面按需载入该分片，无需下载全量内容库。

少量没有可核验地面照片的地点使用 NASA / USGS Landsat WELD 真彩遥感资料，以百科坐标定位裁切。`photo.type` 为 `satellite`，`date` 为 `2000`，署名及替代文字明确标出年代；这是历史地表景观参考，不代表新设城市目前的建筑状况。原始 WMS 请求 URL 保留在 `source` 中，便于复核经纬度、范围和日期。

We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services (GIBS), part of NASA's Earth Science Data and Information System (ESDIS). [GIBS data-use guidance](https://nasa-gibs.github.io/gibs-api-docs/)；[USGS copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)。
