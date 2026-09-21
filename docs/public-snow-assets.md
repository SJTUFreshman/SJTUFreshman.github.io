# 雪山离线来源：Jungfrau 与 Tapado

调查与下载日期：2026-09-14。此资源只进入 `.render-work/public-models/swisstopo/` 和离线渲染链。照片级连续通过轮数仍为 **0**，未安装全景，未修改 panorama manifest，也未替换 `scripts/refine-terrain.py`。

2026-09-17 更新：Jungfrau r1 / r2 已在 A800 实际渲染，均 **FAIL**，用户要求另找更真实的完整山体高模。正射图无法补足陡壁侧面，增加网格密度或近雪 normal 不能解决该问题；本方案与外圈扩展均暂停。2026-09-19 的 r19（A800 job `166102`）修复了固定视角人为肩部的根因：近景高度以观测点实测值归零，移除了 `_summit_shoulder` 的 48 m 内平台融合，并完成晴天/黄昏全景和原生近景。r19 不再出现旧版圆形凹坑或硬平台，但山肩仍有过度平滑、雪带和高度场无法表达的陡壁形体，仍 **FAIL**。以下来源和构建记录保留用于复现，不能读作视觉批准。

新取得的 Tapado 2019 / 2024 是研究作者发布的局部冰川 penitentes 扫描。2024 已完成完整静态审计和基于真实三角面的低机位选择，等待父代理 A800 诊断；它不是完整雪山，俯摄侧壁覆盖仍有明确限制，不能改变全场景验收为 0 的状态。详细审计见 `docs/public-snow-scan-candidates.md`。

## 已落实的来源与许可

作者与发布机构为 **Federal Office of Topography swisstopo**。官方无鉴权 STAC 可直接取得 DSM 与实际航空摄影 RGB；无需抓取预览图或账户下载链接。

- [swissSURFACE3D Raster 官方集合](https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swisssurface3d-raster)：真实数字表面模型，包括地面、自然覆盖和可见固定设施，1 km² 分瓦片。
- [SWISSIMAGE 官方集合](https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissimage-dop10)：实际正射航空摄影。阿尔卑斯山的原始采集地面分辨率为 **25 cm**；下载文件的 **10 cm 栅格**不能解释为原生 10 cm 细节。
- [官方 OGD 条款](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices)：明确允许使用、再分发、加工和商业使用，必须标注来源。已实际读取正文；STAC 的 `license: proprietary` 不是 CC0 标签，不能将来源写成 CC0。
- [官方署名细则](https://www.swisstopo.admin.ch/en/source-reference-ogd-swisstopo)：静态影像可在多图共用的中心位置标注；交互应用可在应用内可达的来源页标注；衍生作品同样必须署名。

本原型记录的署名为 `Source: Federal Office of Topography swisstopo`。未来若公开衍生全景，必须在对应可达来源记录中带上该署名。

## 已下载的连续三公里区域

地理范围为 Jungfrau / Jungfraujoch / Mönch 的连续雪山区域，约东经 7.9601–7.9994、北纬 46.5359–46.5631。精确边界必须以以下米坐标为准：

- LV95 水平坐标 `EPSG:2056`：E **2640000–2643000 m**，N **1154000–1157000 m**。
- LN02 高程 `EPSG:5728`，单位米。
- 原始 DSM：9 张 2000×2000、0.5 m 栅格；3×3 km 拼接为 6000×6000。
- 原始 RGB：9 张 10000×10000、0.1 m 输出栅格。雪、岩、冰川及设施来自真实航片，不是生成贴图。
- 共 **473,988,823 字节**，约 452 MiB。18 个原 TIFF 均已完整下载并与官方 STAC SHA-256 一致。

| 西南角瓦片（km） | DSM 年份 | RGB 年份 | DSM 字节 | RGB 字节 |
| --- | ---: | ---: | ---: | ---: |
| 2640-1154 | 2021 | 2023 | 16,717,735 | 38,111,241 |
| 2640-1155 | 2022 | 2024 | 15,492,270 | 44,388,912 |
| 2640-1156 | 2022 | 2024 | 15,833,226 | 47,510,000 |
| 2641-1154 | 2021 | 2023 | 15,319,228 | 22,976,144 |
| 2641-1155 | 2022 | 2023 | 15,655,949 | 41,438,475 |
| 2641-1156 | 2022 | 2024 | 16,249,701 | 44,343,852 |
| 2642-1154 | 2021 | 2023 | 13,794,294 | 28,077,861 |
| 2642-1155 | 2022 | 2023 | 14,128,688 | 25,263,882 |
| 2642-1156 | 2022 | 2024 | 16,594,493 | 42,092,872 |

全部不可变资产 URL、原始 STAC 元数据、原文件 SHA-256、尺寸、坐标、nodata 和年份记录于 `.render-work/public-models/swisstopo/sources.json` 及相邻 `*.json`。脚本锁定上述年份，不会在下一次执行时自动选择新年份。

中心瓦片的具体下载与校验示例：

- [DSM TIFF](https://data.geo.admin.ch/ch.swisstopo.swisssurface3d-raster/swisssurface3d-raster_2022_2641-1155/swisssurface3d-raster_2022_2641-1155_0.5_2056_5728.tif)，SHA-256 `24c7b566a93f53fbdddcca4bdcf5d106115e5e873cb8c74f715a6feaddccbec6`。
- [RGB TIFF](https://data.geo.admin.ch/ch.swisstopo.swissimage-dop10/swissimage-dop10_2023_2641-1155/swissimage-dop10_2023_2641-1155_0.1_2056.tif)，SHA-256 `38cd9ae56c5ef0eb2231bd45944e779f60e0272e8ee23955146f0c020303170a`。
- [中心 RGB 的 2 m 预览](https://data.geo.admin.ch/ch.swisstopo.swissimage-dop10/swissimage-dop10_2023_2641-1155/swissimage-dop10_2023_2641-1155_2_2056.tif)，实际 139,009 字节。已解码查看中心整体与原 RGB 局部，证实连续雪/岩/冰川覆盖。

对中心 DSM 实际发出 `Range: bytes=0-4095` 得到 HTTP **206**、`Content-Range: bytes 0-4095/15655949`，正文恰为 4096 字节。HEAD 没有 `Accept-Ranges` 并不表示不支持范围读取。后续可以用 COG 范围请求做有限窗口读取；本轮为完整原文件哈希取证下载了这 18 个有限瓦片。

## 可复现的 OBJ / MTL / UV 原型

独立预处理脚本为 `scripts/prepare-surveyed-mountain.py`。依赖 `numpy`、`Pillow`、`rasterio`；本地已安装 rasterio 1.5.1。

```powershell
python scripts/prepare-surveyed-mountain.py --download-only
python scripts/prepare-surveyed-mountain.py --skip-download
```

默认输出目录为 `.render-work/public-models/swisstopo/jungfrau-r1/`，包含 `terrain.obj`、`terrain.mtl`、9 张 `rgb-*.png`、俯视检查图 `aerial-overview.jpg` 及完整几何报告 `prototype.json`。

- 坐标为 **X 向东、Y 向北、Z 向上，一单位一米**。OBJ 导入时务必保持 Z-up；不要沿用依赖其它来源坐标系的默认旋转。
- 以观察点实际 LV95/LN02 坐标为局部原点，未改变水平与高程比例。
- 默认观察点周围 200×200 m 中央方区采用 0.5 m 网格，外围采用 2 m；为了让网格一致，穿过中央方区的坐标条带有一个方向仍为 0.5 m。原始 0.5 m TIFF 保留，可提升网格精度。
- 全区域共用采样轴；所有瓦片边界的坐标、高程和显式法线完全相同。三角形按向上的绕序输出。每个瓦片使用独立材质与 0–1 UV，V=1 对应北边/纹理上边。
- 0.5 m 原 DSM 用双线性采样映射至所声明网格。没有添加程序噪声、额外平滑、山顶削平或相机周围高度修形。区域最外面 0.25 m 夹到最近真实像素中心，记录于报告。
- RGB 使用面积平均重采样到每瓦片 **4096×4096**，对应约 **0.24414 m/像素**，接近该山区 25 cm 原生采集尺度。
- `prototype.json` 记录实际顶点数、三角形数、网格与纹理 SHA-256、真实高程范围、站位高程与局部坡度。此文件的 `visual_approval`、`installed`、`rendered` 初始均为 false。

## 站位与待审查项目

已在原 RGB 120×120 m 局部中检查候选雪地，默认观察点为 **E2641350 / N1155300**，原始采样地面约 **3466.75 m LN02**，一米邻域估算坡度约 **1.46°**。相机局部位置 `(0, 0, 1.7)`；无需制造水平站台。最终精确双线性采样高程与坡度以 `prototype.json` 为准。

较早候选 E2641450/N1155250 在真实 DSM 上约 34.49°，已排除。E2641500/N1155300 约 11.44°且靠近设施与人工雪道，保留为构图比较点，不作为默认站位。坐标仅是虚拟观察建议，不是登山路线或现场安全建议。

以下风险已在 A800 r1 `164267` 和 r2 `164273` 的两相实渲中得到检验：整体山形改善，但陡壁纹理竖拉、北向灰空和近处模糊不合格；r2 增加近雪 PBR 也未解决源数据缺侧面，仍为 FAIL。原始航空图真实或数据可下载不等同于最终画面真实：

1. RGB 固化了拍摄时的阴影和曝光。它不是去光照的 PBR 基础色，黄昏重光照可能出现重复阴影。
2. DSM 2021/2022 与 RGB 2023/2024 不同期；跨瓦片可能出现季节、积雪、冰川及设施变化。未做伪造填补。
3. DSM 是高度场，不能表示岩壁悬挑；0.5 m 栅格也不等于所有点具有 0.5 m 实测精度。25 cm 航片不能解析相机脚边厘米级雪粒。
4. 原型只有连续 3×3 km，六向视野已实际看到边界；真实地理轮廓也不能保证中远景视觉真实。

### r19 measured-height validation

The isolated `.render-work/review-20260914-snow-r19/` study used the same verified source scene and added only the measured-height correction in `scripts/refine-terrain.py`. A800 job `166102` rendered clear and dusk 4096 × 2048 panoramas, sky layers, and four native close views for each phase. The observation point is exactly zero after subtracting `tile.observation_offset`; the original foreground boundary and actual prop contact checks remain enforced. Independent review found the fixed camera ground more natural and no old circular depression, but the exposed DEM still reads as a smooth snowfield with repeated horizontal snow bands and stylized, rounded mountain shoulders. It is a diagnostic improvement, not a photographic pass or an installation candidate.

## 后续远山和备选

[swissALTI3D](https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d) 提供同 LV95/LN02 的 2 m COG，可在本 3×3 km 周边只查询有限环区，然后以 5–20 m 显式采样构建远山；不需要下载整个瑞士。官方 [产品说明](https://www.swisstopo.admin.ch/en/height-model-swissalti3d) 给出每张 1 km²、2 m COG 约 1 MB，但实际批量大小应在扩展前逐个 HEAD 求和。

9×9 km 的 72 瓦片环区后来已下载并导出，72 份 DTM 与 72 份 RGB 共 `92,006,446` 字节，均已核哈希；详细记录见 `docs/public-snow-farfield-plan.md`。当前 DSM/DTM 不同期及采样差异造成最大接边残差约 61.09 m，已应用的平滑接边最大改高约 54.74 m；该输出未经 GPU 审查且不推荐使用。用户要求改换源资产后，此环区继续暂停，不再作为照片级主方案。

第二候选 Matterhorn Hörnli ridge 的 `2618-1092` 瓦片已核实存在 2021 年 DSM、2024 年 DTM 和 2023 年 RGB；其 0.5 m DTM 为 17,203,173 字节，RGB 为 51,136,522 字节。它仍属于相同高度场/正射路线，未下载，不因更换山名而恢复为推荐主方案。

## Tapado 2024 局部冰川诊断交付

官方来源为研究作者公开的 [Zenodo 14755911](https://zenodo.org/records/14755911)，CC BY 4.0；论文为 [Ayala 等，2025](https://doi.org/10.1017/jog.2025.24)。离线原包位于 `.render-work/public-models/tapado-glacier/`，共 `228,066,505` 字节，官方 MD5 `508523c3625c99d8c9f70ba76ed72ceb` 与全部 ZIP CRC 一致。原包 SHA-256 为 `161f437367fd4544644211d21d4abaf74e7d99fd89026b4077d4c6ede45b6b9b`。

2024 模型实际包含 495,644 个顶点、1,000,000 个三角面、773,438 个 UV、1 张 8192² 图集；全部 v/vt/vn 索引在范围，退化面为 0。2019 模型的 2,499,407 顶点 / 5,000,000 三角面 / 16384² 图集也已静态验证，先不扩大 GPU 诊断范围。

2024 原始坐标、相机证据与依赖哈希分别位于 `2024-source-record.json`、`2024-diagnostic-camera.json` 和 `mesh-inspection.json`。导入必须使用 `forward_axis='Y', up_axis='Z'`，不居中、不将底部移至零、不缩放。低相机为 `[-27.80406630, 52.17293297, -47.79343363]`，正好在真实三角形 545332（零基）重心上方 1.7 源单位。初始目标 `[-29.37913323, 64.02596790, -41.71936670]` 被前侧雪脊遮挡；修正后的首个可见目标为 `[-28.89153350, 60.42109933, -43.70836640]`。全网格竖直射线确认相机和 X/Y 各 ±0.15 的五个脚域点均只有一个地表交点，净空约 1.65–1.75，不存在更高悬片。没有为相机制造平台、改变高度或增加表面平滑。

论文明确 2019 调查为 45 m 高度的 210 张俯视照片；后续 Mavic 3E 调查为 60 m 高度的航测网格。它有真实 UV 图集，但不能宣称已取得完整斜向侧壁颜色。物理单位和地理北向也未写入 OBJ，米仅是调查尺度推断，`units_verified=false`。先通过六向及晴天/黄昏低机位近景核查实际可用性；即使局部通过，也不能把它冒称完整雪山或计作全场景两轮通过。
