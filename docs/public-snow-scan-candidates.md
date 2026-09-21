# 雪山替代扫描来源核验（2026-09-17）

当前没有完整雪山来源获准替换场景，照片级连续验收仍为 **0**。本轮不提交 GPU 作业、不安装全景、不修改 manifest。Jungfrau DSM/正射图与外圈拼接方案继续暂停；近雪扫描不能被表述成已经解决整座山的侧壁纹理和六向完整性。

## 已取得：Tapado Glacier 局部 penitentes 扫描

- 发布者：Álvaro Ignacio Ayala Ramos、Benjamin Aubrey Robson 等研究作者；完整作者列表保存在官方记录和下载收据。
- 官方数据：[Zenodo 14755911](https://zenodo.org/records/14755911)，DOI `10.5281/zenodo.14755911`。
- 许可：官方记录 `cc-by-4.0`。使用时应署名作者、数据集标题、DOI、许可证，并标明裁切或材质调整。
- 正式论文：[Monitoring the physical processes driving the mass loss of Tapado Glacier, Dry Andes of Chile](https://doi.org/10.1017/jog.2025.24)。
- 原包：[3D_mesh_PENITENTES.zip](https://zenodo.org/api/records/14755911/files/3D_mesh_PENITENTES.zip/content)。
- 本地：`.render-work/public-models/tapado-glacier/`。原包、解压文件、官方 JSON、论文 HTML、方法摘录、可续传下载脚本和校验记录都只位于离线目录。

完整 GET 曾收到 504；随后通过同一官方地址的 HTTP Range 下载全部数据块并重组。没有使用第三方缓存或受限模型提取。已验证文件大小 `228,066,505` 字节、官方 MD5、SHA-256 以及每个 ZIP 条目的 CRC。

| 项目 | 校验值 |
| --- | --- |
| 官方 MD5 | `508523c3625c99d8c9f70ba76ed72ceb` |
| 本地 SHA-256 | `161f437367fd4544644211d21d4abaf74e7d99fd89026b4077d4c6ede45b6b9b` |
| 2019 OBJ | `611,271,358` 字节；全文件确认 2,499,407 顶点 / 5,000,000 三角面 |
| 2019 JPG | `30,277,211` 字节，实际 `16384 × 16384` |
| 2024 OBJ | `119,470,620` 字节；全文件确认 495,644 顶点 / 1,000,000 三角面 |
| 2024 JPG | `14,961,960` 字节，实际 `8192 × 8192` |

两套模型均带 MTL，JPG 实际是包含大量独立图块的 UV 图集。原始 OBJ / MTL / JPG 保持不变。完整索引、UV 与包围盒验证结果保存为 `mesh-inspection.json`；没有 Blender 实渲结果时，不能将数据格式通过算作视觉通过。

### 2024 诊断交付

独立来源记录为 `2024-source-record.json`，相机证据为 `2024-diagnostic-camera.json`。父代理负责上传和提交 A800，本站审查代理没有创建 GPU job。

- 原始 OBJ SHA-256：`ae7bfc16c13ecf344542e826ea8517d5ed7abdda96e7bf77fc9462394a5b9c82`。
- 原始 MTL SHA-256：`a25bf10fc4e34e3e84c853ebbf4c0c02eece349a877fca720c20c3bea29e742a`。
- 原始 JPG SHA-256：`f7c18ba648788c933520c70c09199f0512c30cd40002e435387955319205940d`。
- 最小坐标：`[-366.4370117, -310.4800110, -213.0919952]`；最大坐标：`[400.9869995, 261.7900085, 136.5169983]`。
- Blender OBJ 参数 `forward_axis='Y', up_axis='Z'`，不平移、不重新居中、不缩放。`center_xy=false`、`base_at_zero=false`、`units_to_metres=1`。源 97.001% 顶点法线 Z 分量为正，几何支持 Z 向上；地理北向和物理单位没有嵌入 OBJ，米是调查尺度推断，因此 `units_verified=false`。
- 全部 1,000,000 面均为三角形；每角 v/vt/vn 索引正数且在范围；773,438 个 UV 坐标范围为 `[0.0001309, 0.0001309]` 至 `[0.999869, 0.999870]`。
- 几何退化面数为 0；面法线 91.268% 朝上，存在真实陡面及下向面，不能简化回单值高度网格。三角面面积中位数约 `0.4783` 平方源单位，这不是可近看厘米级网格的保证。
- 低相机：`[-27.80406630, 52.17293297, -47.79343363]`。它位于源三角形 545332（零基）的重心正上方 1.7 源单位，实际脚下重心为 `[-27.80406630, 52.17293297, -49.49343363]`，法线 `[0.17144219, -0.31313457, 0.93410616]`。
- 初始近景目标 `[-29.37913323, 64.02596790, -41.71936670]` 被完整三角射线审计证明会被前侧雪脊遮挡（沿相机到目标射线先命中面 527894，再命中面 527228，原目标面仅在更后方命中），不能作为安全可见目标。保留它只作遮挡对照。
- 修正后的首个可见近景目标为 `[-28.89153350, 60.42109933, -43.70836640]`；相机保持 `[-27.80406630, 52.17293297, -47.79343363]`，相机到目标距离约 `9.2684` 源单位，视向单位向量 `[-0.11733106, 0.88992670, 0.44075377]`，目标面朝相机 dot 约 `0.5225`。这只是几何安全诊断，仍需 Blender 实渲检查纹理、遮挡和相机周围可视性。
- 已对全 1,000,000 面作竖直射线检查：相机正下方仅一个交点，净空恰为 1.7；在 X/Y 各偏移 ±0.15 的四个点也均只有一个交点，净空 `1.6497–1.7503`。没有把下层面当成脚下、遗漏更高悬片。

`2024-textured-centroid-map.jpg` 仅为面重心采色的定位示意图，不是完整光栅化渲染，不作为照片级视觉证据。

### 拍摄方法的限制

已实际阅读论文方法，不能只凭标题中的“3D mesh”宣称完整多角侧面采集：

- 2019-03-21 使用 DJI Phantom 4 Pro，在 45 m 高度按双网格拍摄 210 张 **nadir（俯视）** 影像，纵横重叠率 75%，覆盖约 `0.08 km²`。
- 后续调查使用 DJI Mavic 3E，在地形上方 60 m 拍摄，纵横重叠率 80%，配 RTK。
- Pix4Dmapper 用多视图匹配生成稠密点云和 3D 网格；论文中的 2 cm 数值指 DSM / 正射图输出分辨率，不能等同于所有表面真实采样精度。
- 论文称首次飞行特意选择接近无阴影时段，但这不保证所有冰雪缝隙、低角度侧面均清晰，也不保证纹理适合黄昏重新照明。

图集预览能看见脏雪、尘土和深缝；这属于源纹理检查，尚未证明贴回网格后近景清晰。该资产是局部冰雪尖塔区域，**不是完整山体，不是普通平坦洁白雪地，也不能替代远山**。

2024 原 MTL 的 `Ks 1 1 1`、`Ns 0` 属于 MeshLab 导出参数，不能视为物理测量雪材质。后续诊断应记录粗糙度等材质调整，保留源 base color；必须实际查看地面高度附近的近景、背向侧面、接缝与晴天/黄昏。

## Sketchfab 候选的实际预览结论

以下官方模型元数据和官方预览已经保存到 `.render-work/public-models/alpine-candidates/`；每项采用 `UID.json` / `UID.jpeg` 命名。仅查看公开元数据和预览，不提取 viewer 缓存。匿名下载接口需要登录；没有把“downloadable=true”当作已经拿到模型。

| 来源 | 已见问题 / 决定 |
| --- | --- |
| [MoosStock Mountain Peak 3024 m](https://sketchfab.com/3d-models/moosstock-mountain-peak-3024-m-34583d6700a4433e8c9089f200cdc532)，Shahriar Shahrabi，CC BY 4.0 | 近处岩面明显揉皱、软化；漂亮远山背景不证明存在对应几何。不硬推荐。 |
| [Weisse Wand Mountain peek 2517 m](https://sketchfab.com/3d-models/weisse-wand-mountain-peek-2517-m-8257-ft-cddef5cc80bc4aab8be65b38c29987fa)，同作者，CC BY 4.0 | 作者明确 DJI Mavic Pro 2 / 50 张照片；近岩侧面比前者清楚，但仍有软化且主要无雪。不硬推荐。 |
| [Hokkaido snowfield, mountain road and forest](https://sketchfab.com/3d-models/hokkaido-snowfield-mountain-road-and-forest-f0052c62e2b24622a5175ffa648aae89)，Metazeon，CC BY 4.0 | 树木大量残片、尖锥、表面熔化，不适合作为完整近景。 |
| [Vallon de Nant – Les Martinets](https://sketchfab.com/3d-models/vallon-de-nant-les-martinets-ebee-drone-scan-cb512401911e4f68890e3b93c1878f73)，sr-prod，CC BY 4.0 | 谷坡扫描有破碎边缘、纹理粗；俯视预览不能证明低角侧面足够。 |
| [Mount Rainier](https://sketchfab.com/3d-models/mount-rainier-03fa9b67fed04bb49a0ea0359e23c8b1)，Christian Waldo，CC BY 4.0 | 实图是地理高程底板，陡壁仍有纵向拉伸；排除主方案。 |
| [Snowy mountains realistic photoscan](https://sketchfab.com/3d-models/snowy-mountains-realistic-photoscan-d635f454e3044e739cfb90c328774f6e)，RobenSikk，CC BY 4.0 | 岩雪侧壁预览相对具体，但树木有残片、雪面模糊；作者未给地点、拍摄方法或来源，用户档案也无补充。不能确证真实扫描来源，暂不纳入可用源名单。 |
| [Blaueis (Detail of the Glacier)](https://sketchfab.com/3d-models/blaueis-detail-of-the-glacier-1d84e7c986ec470baf63addb68406ba8)，University of Arts Linz / Media Design | 作者和无人机调查来源明确，CC BY-NC-SA 4.0；只是局部冰川，预览呈粗纹理，未选作主方案。 |
| [Rhone Glacier Collapse feature](https://sketchfab.com/3d-models/rhone-glacier-collapse-feature-as-26082023-652119f2400f4ab69d72b64e79087eaa)，ric.pedre，CC BY 4.0 | ETH 实习、Phantom 4 Pro / 75 m 调查来源明确；预览只是灰色小片冰川凹陷，不满足完整山景。 |

## 已排除的可匿名研究下载

[Nordenskiöldbreen / Tunabreen 2024，Zenodo 13623723](https://zenodo.org/records/13623723) 由 Richard Hann 发布、CC BY 4.0，虽描述提供“textured 3D models”，实际小模型已通过 HTTP 206 读取文件头，确认是标准 binary STL：Agisoft Metashape 生成、208,367 三角面，文件长 `10,418,434 = 84 + 50 × 208,367`。STL 不含 UV，配套 JPG 没有提供映射文件，因此不能当作现成的贴纹理网格。未下载其数 GB 原始影像。

后续只把具有明确源头、完整文件和实图质量依据的资产列为可渲染候选。没有任何一项数据获取或静态验证可计入连续两轮独立视觉验收。

## 新一轮公开候选核查（2026-09-18）

本轮通过 Sketchfab 官方 API 核查模型元数据和官方缩略图；没有提取 viewer 缓存，也没有把可下载标记当作已取得文件。以下模型均标记 `isDownloadable=true`、`isProtected=false`，许可证为 CC BY 4.0（商业使用允许，但必须署名），仍需登录后由主代理下载并在 A800 做六向及近景审查。

| 来源 | 几何 / 纹理 | 方法与视觉风险 |
| --- | --- | --- |
| [Mount Rainier](https://sketchfab.com/3d-models/mount-rainier-03fa9b67fed04bb49a0ea0359e23c8b1)，Christian Waldo，UID `03fa9b67fed04bb49a0ea0359e23c8b1` | 2,470,680 面、1,235,342 顶点、1 张纹理 | 描述为 geo-data photogrammetry；官方预览显示雪峰和陡壁细节，模型带厚方形地形底板，四侧切面必须裁掉或融合，不能直接当完整 360 山体。 |
| [Matterhorn – Cervino](https://sketchfab.com/3d-models/matterhorn-cervino-e676d59824e94db0945c7239483f3e7c)，rjgarnicap，UID `e676d59824e94db0945c7239483f3e7c` | 428,731 面、227,409 顶点、2 张纹理（作者说明 8K） | 48 张 Google Earth Pro 图、iTwin Modeler，OBJ 质量 100%；雪岩纹理有远景价值，但官方预览可见黑洞/扫描边缘，六向底部和背面需裁切验证。 |
| [Mont Blanc massif photographed from ISS](https://sketchfab.com/3d-models/mont-blanc-massif-photographed-from-iss-c66a5a559d3844eaac942939211a4b8d)，Spaceport3D，UID `c66a5a559d3844eaac942939211a4b8d` | 961,159 面、480,585 顶点、3 张纹理 | RealityCapture 由 ISS 远摄照片重建；雪峰群形体清楚，但预览有大块方形边界/底板，且低角度近景采样有限。 |
| [Snow Mountain](https://sketchfab.com/3d-models/snow-mountain-aa3ccbb5940d43ffab435a6b7fe7c69d)，prav in9152600513，UID `aa3ccbb5940d43ffab435a6b7fe7c69d` | 2,305,729 面、1,152,921 顶点、1 张纹理 | 作者说明为 Gaea 地形（程序生成，不是摄影测量）；雪岩视觉较强但开放/切边明显，只能作为备用远景源。 |
| [Fox Glacier 1953](https://sketchfab.com/3d-models/fox-glacier-1953-1c24bdecc03a4883a1777d6147d38e23)，b_nealie，UID `1c24bdecc03a4883a1777d6147d38e23` | 1,631,074 面、816,612 顶点、1 张纹理 | 7 张航片的 3DF Zephyr 摄影测量；实际冰川谷形体，但缩略图偏灰、覆盖为局部开口面，不能承担完整山景。 |

这些候选与 Tapado penitentes 一样都必须先做几何边界、法线、UV 和底部接触检查；在连续两轮独立视觉审查通过前，不得安装全景或修改 manifest。
