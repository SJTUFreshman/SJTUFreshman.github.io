# 四幅 Blender 浮雕地图

根据参考图的蓝海白岛、纸色分区浮雕、冰蓝山地与地图集排版制作。成图不含小红书水印。

2026-10-09 光照更新：太阳高度由约 48.3° 降至 32°，保留西北方向入射（方位角约 321.8°）。同一高度的平面投影长度约为原来的 1.8 倍；同步补偿太阳强度以保持水平面的照度，让变化集中在山脊明暗与阴影长度。已比较 24° 候选，选用沿海拖影较收敛的 32°。本次原始四张附图路径已失效，调整依据为现有成图及之前记录的光照方向。

前后对比：`outputs/lighting_comparison.jpg`。原版交付 ZIP 保留在本机 `lighting_review/delivery-before-lighting.zip`，不重复放入新版交付包。

## 查看与编辑

- `outputs/shengsi.png`：嵊泗列岛，2400 × 1600。
- `outputs/china.png`：中国省域地形，2480 × 2000。
- `outputs/hainan.png`：雷州半岛与海南岛，2000 × 2400。
- `outputs/fujian_taiwan.png`：福建与台湾，2000 × 2300。
- `outputs/contact_sheet.jpg`：四图预览。
- `outputs/lighting_comparison.jpg`：海南地图与山地局部的原版 / 32° 斜光对比。
- `scenes/*.blend`：实际 DEM 网格、顶点配色、正交相机、西北方向日光、纸面/海面，以及内嵌的透明文字图层。
- `renders/*_terrain.png`：无文字地形渲染，适合另行排版。
- `outputs/*_labels.png`：独立透明标注图层。
- `outputs/*_blender.png`：从包含标注的 Blender 工程重新渲染的验收图。

在 Blender 4.5.3 或兼容版本中打开 `.blend`，选择相机视图或按 F12 渲染。工程设置为 Cycles GPU；本地电脑需要在 Blender 首选项启用自己的计算设备。文字图层已经打包，不依赖外部 PNG 或本机字体。要修改文字，编辑 `compose_atlas.py` 后重新生成图层，再运行 `pack_labels.py`。

## 服务器

SSH 主机：`paracloud-Zhongwei1`。

远程目录：`/data/home/scwb515/run/yangrunde/relief-atlas-20261008`。

阅读了 `/data/home/scwb515/run/yangrunde/使用方法.txt`。渲染及工程打包均使用 Slurm 的 `hp_a800` 队列，单张 NVIDIA A800-SXM4-80GB，未在登录节点执行渲染。地形下载与重投影在本机完成，文件通过 SCP 上传。

服务器原有 Blender：`/data/home/scwb515/run/yangrunde/life_worlds/tools/blender-4.5.3-linux-x64/blender`。没有另行安装或更改已有环境。

```bash
cd /data/home/scwb515/run/yangrunde/relief-atlas-20261008
sbatch render.slurm all
sbatch render.slurm hainan
sbatch pack_labels.slurm
```

可单独调整太阳高度：`sbatch render.slurm hainan --sun-elevation 32`。角度为光源相对地平面的高度，越小越斜。先生成候选预览可用 `sbatch preview_lighting.slurm --map hainan --elevations 32 24`；此脚本只写入 `lighting_review/`，不覆盖正式工程。普通 `render.slurm ... --preview` 仍会覆盖正式输出，只适合独立工作目录。

`render.slurm` 重新生成地形工程时会覆盖同名 `.blend`，如需保留文字合成，请随后执行 `pack_labels.slurm`。每次提交的作业完成后自动释放 GPU。

## 可复现流程

1. 本机 Python 执行 `python prepare_data.py`，下载缓存并生成 `data/*.npz` 和元数据。
2. 上传数据和 `render_atlas.py`，通过 Slurm 运行 Blender。
3. 回传 `renders/*_terrain.png` 和 `data/*_layout.json`。
4. 本机执行 `python compose_atlas.py` 生成成图和透明图层。需要 Pillow、pyproj；默认使用 Windows 宋体与 Times 字体。
5. 上传 `outputs/*_labels.png`，提交 `pack_labels.slurm`，把标签打包进工程并重新渲染验收。
6. 回传 `scenes/*.blend`、`outputs/*_blender.png` 和 `logs/scene_lighting_report.json`，执行 `python verify_delivery.py`，最后执行 `python package_delivery.py` 更新交付包。全量 `pack_labels.slurm` 会检查四个已保存工程的 32° 灯光、96 samples、100% 分辨率和内嵌标签哈希。

重新渲染底图后须再次执行步骤 3–5；部分标签的位置会根据底图明暗自动避让。标签打包后的验收渲染会重新打开已保存的 `.blend`，确保检查的是交付工程。

数据准备依赖：NumPy、Pillow、requests、rasterio、shapely、pyproj、SciPy。Blender 脚本只使用 Blender 内置 Python 与 NumPy。

## 地形与视觉参数

| 地图 | 投影 | 网格采样 | 高程视觉夸张 |
|---|---|---|---|
| 嵊泗 | 等距圆柱，参考纬度 30.7° | 约 44 m | 6 倍 |
| 中国 | Albers 等积 | 约 2.1 km | 22 倍 |
| 雷州 / 海南 | 等距圆柱，参考纬度 20° | 约 186 m | 13 倍 |
| 福建 / 台湾 | 等距圆柱，参考纬度 25° | 约 322 m | 7 倍 |

精确参数见每张图的 `data/*.json` 和 `data/*_layout.json`。地形使用真实高程，没有用程序噪声生成山脉。材质为哑光顶点色，正交俯视、Cycles CUDA、96 samples、降噪。海南图为接近参考的构图，裁去左上方一部分大陆；地理坐标及其余地形保持原投影位置。

光照参数同时记录在 `data/*_layout.json` 的 `lighting` 字段及 Blender 场景自定义属性中。天空强度保持 0.45，太阳角直径保持 3°；本次只调整太阳高度和相应的照度补偿。

## 数据来源与差异

- 高程：[Mapzen / AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)，Terrarium 编码，来源归属见 [Joerd attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)。
- 全国省域与福建地市：[Alibaba DataV](https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json)。
- 台湾县市：[geoBoundaries](https://www.geoboundaries.org/)，基于 OpenStreetMap / Wambacher，© OpenStreetMap contributors，ODbL 1.0。
- 洋山港填海轮廓：OpenStreetMap `natural=coastline` 的真实闭合岸线。保留原有高程山体；缺失的填海低地按 1.5 m 平面建模，这部分是视觉补充高度，非实测高程。© OpenStreetMap contributors，ODbL 1.0。
- 泗礁北侧高程源含圆弧形海面伪影，使用 OpenStreetMap 真实海岸线在局部窗口仅裁除海域像素，未扩张陆地；修复窗口和来源记录于 `data/shengsi.json`。
- 各源 URL、年份、数据许可与处理限制记录于 `data_notes.json`；原始边界存在 `cache/`。

这是参考视觉风格的地形艺术试作，并非逐像素描摹。地图轮廓、山体与分区来自公开地理数据；数据年代、精度和配色与参考图存在差异。小岛、潮滩和港口填海区可能因高程源年代或海拔阈值而遗漏。行政边界和 DEM 可能有数百米偏移，渲染将边界内负高程夹到海平面，以避免岸边深沟。南海附图取自同一全国边界源。

本成果未经过地图审图；供视觉与建模实验。若用于正式地图出版或需要精确海岸，请换用对应用途的权威地理数据并重新处理。
