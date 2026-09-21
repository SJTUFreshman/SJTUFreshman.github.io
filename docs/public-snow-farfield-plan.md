# Jungfrau 原型独立审查与真实远山环区

2026-09-17。本次不修改既有 `prepare-surveyed-mountain.py`、`jungfrau-r1` 产物或 panorama manifest。新远山导出独立放在 `.render-work/public-models/swisstopo/jungfrau-farfield-r1/`。照片级连续通过轮数仍为 **0**。

**最新状态：暂停此路线。** 用户要求转向真实多角度摄影测量的完整山体高模。远山仅保留研究产物，不作为照片级主方案，不建议安装或继续加工。

已导出的远山为 1,197,072 顶点、2,340,000 三角形。接边残差中位约 1.055 m、最大 61.093 m，当前 100 m 过渡带最大修改高程 54.739 m，因此不能视为可接受的真实几何。最大差值在 E2641012/N1157000 附近极陡北壁：核心 DSM 边界约 2659.405 m，向外 1.001 m 的 DTM 采样约 2720.498 m；差异包含陡坡上的采样位置偏移、产品与年份变化，不是已证明的地面真实位移。西边界 E2640000/N1156218 也出现约 50.057 m 差值。直接把这些残差向外延伸 100 m 会放大局部山带问题。没有进行 A800 远区渲染，没有修改 central DSM，没有计入任何验收通过。

## r1 的实际图审结论：未通过

已实际查看 `.render-work/public-snow-study-20260916/review/` 的 clear/dusk 六向，以及 `local/` 两相各五张 1600×1100 原生近景：`north-rock`、`west-massif`、`east-ridge`、`south-glacier`、`snow-contact`，另查看两张独立天空源。

- 真实 DSM 的大山体轮廓和雪脊形状明显优于此前程序山，值得保留。
- `north-rock` 与六向 forward 的大块灰色空白来自有限地形范围之后没有山地，天空源下半球是均色。必须补真实地形，不能用加厚雾或人工色带宣称解决。
- `west-massif` 和后/左六向的岩雪陡壁存在明显纵向拖影；`east-ridge` 峰顶与左侧岩壁也有拉伸。
- `south-glacier` 近雪大面积模糊，`snow-contact` 几乎没有可辨微观细节。25 cm 航片无法支持眼前厘米级雪质感。
- 黄昏沿用相同航空摄影固化阴影；真正的材质重光照仍未解决。

陡壁问题主要是来源映射限制，不是 UV 的 V 翻转。正射图按水平面积分配像素；真实表面沿坡面需要的距离约增加为 `1/cos(坡角)`，85° 陡坡的一个水平像素对应约 11.5 倍坡面距离。悬挑和遮蔽面也不由高度场/俯视图表示。加密 UV、升输出分辨率或叠程序噪声无法恢复缺失的侧视摄影信息；近景陡壁需要匹配地质与雪覆盖的真实扫描/侧视来源，或者重新选择不暴露近距离陡壁的真实观察点。

## 坐标、UV 与 Blender 导入复核

`prepare-surveyed-mountain.py` 的坐标计算是正确的：E→X、N→Y、LN02 高程→Z；全部以同一个真实米坐标原点作平移，没有改变山体比例。DSM 北向行索引正确处理了 GeoTIFF 负 Y 像元步长。合并后再双线性取样，使内部瓦片在相同位置得到相同高度。UV 的 V 随北增加，PNG 顶行表示北边，匹配 Blender V=1 的图像顶边。

需要在导入包装中显式设置：

```python
bpy.ops.wm.obj_import(filepath=source, forward_axis='Y', up_axis='Z', global_scale=1)
```

已实际查阅 [Blender 4.3 OBJ 导入器源码](https://raw.githubusercontent.com/blender/blender/v4.3.0/source/blender/editors/io/io_obj.cc)：默认是 `NEGATIVE_Z` forward / `Y` up，会旋转本原型，不能直接使用默认轴。原型不需要把整体尺寸归一化到几米。

MTL 中 `Kd 1 1 1` 与 `map_Kd rgb-TILE.png` 是兼容的，图像相对 MTL 查找；[Blender MTL 转换源码](https://raw.githubusercontent.com/blender/blender/v4.3.0/source/blender/io/wavefront_obj/importer/obj_import_mtl.cc) 把纹理 Color 接入 Principled Base Color。`Ka 0` 映射为 metallic 0，`Ks 0` 映射为 specular 0，`Ns 1` 对应 roughness 约 0.9684，因此它是粗糙的航空图漫反射原型，不是已经正确建模冰雪反射的 PBR。

每张图代表一个不重复的地域瓦片；导入后将所有 Image Texture 的 `extension` 设为 `EXTEND`，保持 RGB 的 `sRGB` 色彩空间。默认 `REPEAT` 可能让瓦片边界混入本瓦片另一端的颜色，形成细线。此项不能解决整片陡壁拖影。

中心 0.5 m 导出网格位于整半米坐标，原始像元中心在 0.25 m 偏移处，所以中心顶点是相邻样本的双线性平均，并非原始点逐点复刻。这会轻微软化最高频细节，但不会制造圆形凹坑或水平平台；本轮不更改该设计。

## 已核实、有限的九公里环区

完整外框 LV95 米坐标为 E **2637000–2646000**、N **1151000–1160000**，从中剔除已存在的中央 E2640000–2643000/N1154000–1157000，即 **72 个 1 km² 瓦片**。统一使用同一 swisstopo 来源：

| 资源 | 数量 | 文件分辨率 | 实际字节总数 |
| --- | ---: | --- | ---: |
| swissALTI3D DTM | 72 | 2 m，500×500 | 81,931,987 |
| SWISSIMAGE 航空 RGB | 72 | 2 m，500×500 | 10,074,459 |
| 合计 | 144 | 连续 72 km² 环区 | **92,006,446** |

这些大小已逐文件 HEAD 核实，并完成实际下载 SHA-256 校验。DTM 年份为 2024/2025，RGB 为 2023/2024。原始查询返回多年度数据，必须遍历所有 `rel=next` 页再逐空间瓦片选择最新；API 即使给 `limit=1000` 也只返回 100 条，不能把第一页当作完整区域。

实际访问过的查询入口：

- [DTM STAC 查询](https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissalti3d/items?bbox=7.92071,46.50873,8.03887,46.59025&limit=100)：3 页、284 条跨年度记录，筛出 72 块所需 DTM。
- [RGB STAC 查询](https://data.geo.admin.ch/api/stac/v0.9/collections/ch.swisstopo.swissimage-dop10/items?bbox=7.92071,46.50873,8.03887,46.59025&limit=100)：4 页，筛出 72 块所需 RGB。
- [西南角 DTM](https://data.geo.admin.ch/ch.swisstopo.swissalti3d/swissalti3d_2025_2637-1151/swissalti3d_2025_2637-1151_2_2056_5728.tif)：1,186,005 字节，SHA-256 `1484ce172c6ff3ea52cd29b39b2eb96a7a0c686e638b22f8b2c3133fc5b2583a`。
- [西南角 RGB](https://data.geo.admin.ch/ch.swisstopo.swissimage-dop10/swissimage-dop10_2024_2637-1151/swissimage-dop10_2024_2637-1151_2_2056.tif)：186,745 字节，SHA-256 `6333d8c5761c136b60d8cb72ebf8fc8ad0fb04c058f7be1f747abde8d3c2f8f7`。

所有 144 个真实资产 URL、年份、哈希、字节、nodata、坐标和缓存 STAC 页位于新目录的 `sources/`；`sources.json` 记录最终完整下载，`source-selection.json` 锁定本次年份。

许可与中央原型相同，遵守 [swisstopo OGD 条款](https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices)，署名 `Source: Federal Office of Topography swisstopo`，不能写成 CC0。

## 独立导出与接缝方案

新脚本 `scripts/prepare-surveyed-farfield.py` 只写新目录。默认外围为 **20 m** 网格；穿过中央区的条带保留中央原有坐标轴，使所有中央边界顶点逐点匹配，不产生 T 接头。原始 2 m 文件保留；LOD 分辨率不冒充原始测量精度。

```powershell
python scripts/prepare-surveyed-farfield.py --download-only
python scripts/prepare-surveyed-farfield.py --skip-download
```

环区在中央区域没有重叠面。边界坐标、高程、显式法线与中央原型一致；由于中央 DSM 与外围 DTM 采集年份/产品不同，只在边界外 **100 m** 带中把实际 DSM–DTM 高程残差渐退到 0。报告会记录残差分布和最大实际改变量；这不是新地形层，也没有添加噪声、雾或人工峰。残差过大或可见变形仍必须在实渲中拒绝。

OBJ、MTL 和 72 张原 500×500 RGB PNG 继续共用中央原点 `[2641350,1155300,3466.8075561523438]`，相机仍是 `(0,0,1.7)`。导入轴和贴图边界设置与中心相同。

## 九公里之后的真实地平线

九公里环区只把当前约 1.3–1.7 km 的地形边界推到约 4.3–4.7 km，不能提前保证全 360° 地平线闭合。观测点海拔约 3468.5 m，北向深谷可能暴露数十公里之外的山系。先做 A800 实渲和方位角地平线覆盖检查，再决定需要补哪些方位与距离。

21×21 km 的候选外框为 E2631000–2652000/N1145000–1166000；剔除中央共 432 块。按照本次 72 块的实测均值，完整同类 2 m DTM+RGB 源约 **552 MB**，这是外推预算，不是逐块 HEAD 总额。41×41 km 对应 1672 块，外推约 **2.14 GB**。本次未下载这些范围；21 km 查询曾遇 TLS 连接重置，不能声称更大范围已完整核实。

后续可以先对已有真实 DEM 计算 360° 每个方位的最高仰角及产生该仰角的位置；若峰值落在外边界附近或可见边界边，按该方位扩展真实地形。需要真正更广背景时，选择更粗的实际 DEM 产品或有限 COG 低分辨率读取，并继续匹配真实 RGB。最终审查要求地平线来自实际数据，不用重复山片、均色带或浓雾掩盖缺失。
