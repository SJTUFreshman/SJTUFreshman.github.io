# 浮雕地图工程

这里保存四张参考地图和个人主页三张足迹地图的可编辑工程、原始数据、高清渲染与制作脚本。网站构建不再依赖仓库外的 `relief-atlas-20261008` 目录。

## 四张参考地图

`reference/` 保留嵊泗列岛、中国、雷州半岛与海南岛、福建与台湾的原始交付内容：

| 内容 | 路径 |
| --- | --- |
| 四个可编辑 Blender 工程，含真实 DEM 网格、材质、相机、光照与内嵌标注 | `reference/scenes/*.blend` |
| 四套高程、陆地掩膜、行政区编号和投影坐标 | `reference/data/*.npz`、`*.json` |
| 最终成图、透明标注、重新打开工程得到的验收图 | `reference/outputs/` |
| 无文字地形渲染 | `reference/renders/` |
| 数据准备、DEM 解码和投影 | `reference/prepare_data.py` |
| 网格建模、材质和 Cycles 渲染 | `reference/render_atlas.py` |
| 地图排版、标签避让和标注打包 | `reference/compose_atlas.py`、`pack_labels.py` |
| 光照比较与预览 | `reference/compare_lighting.py`、`preview_lighting.py` |
| 验收和交付包生成 | `reference/verify_delivery.py`、`verify_scene_lighting.py`、`package_delivery.py` |
| 当时的 Slurm 作业与说明 | `reference/*.slurm`、`reference/README.md` |

四个 `.blend` 文件的 SHA-256、光照检查记录保存在 `reference/logs/scene_lighting_report.json`，并由 `reference/verify_delivery.py` 验证。最大的工程约 70 MB，每个文件均低于 GitHub 的 100 MB 限制。行政区与海岸线原始快照保存在 `reference/cache/`，光照比较的输入与脚本保存在 `reference/lighting_review/`。原目录的全部文件（包括两份大型 ZIP、下载瓦片缓存、日志、字节码和旧版本）另有逐字节完整快照，保存在下述 `full-archive/` 中。历史 Slurm 文件保留当时的服务器路径，迁移机器时使用下列参数化命令。

## 全部文件归档与还原

[`full-archive/README.md`](full-archive/README.md) 列出本机原四图工程、网站工作目录、网站生产工程、补充调试文件和服务器两套工程的完整清单。所有快照均不排除任何文件；原始 ZIP、DEM 下载瓦片、缓存、日志、渲染中间结果、旧图、QA 截图和 Python 字节码都保留。

每个快照保存原始目录结构、每个文件的字节数、时间戳和 SHA-256。相同内容复用仓库内的二进制素材或内容寻址分卷；大文件切为不超过 48 MiB 的分卷，避免 GitHub 单文件大小限制。还原后文件名、目录结构和内容与对应源目录一致。文本也按原始字节保存，保留原始换行符。服务器原始清单在 `full-archive/provenance/`，逐文件核对过下载前后的大小和 SHA-256。

从仓库根目录验证并还原原四图的全部文件（Python 3.11+，仅标准库）：

```powershell
python scripts/archive-relief-projects.py verify tools/relief-atlas/full-archive/reference-original.json
python scripts/archive-relief-projects.py restore tools/relief-atlas/full-archive/reference-original.json --output .render-work/restored-relief/reference-original
```

将 `reference-original` 换成其他快照名即可还原相应目录；目标目录必须不存在或为空。具体范围和批量验证命令见完整归档说明。生产 `.blend`、DEM 和 PNG 也可直接从 `reference/`、`footprints/` 使用。制作和归档脚本随本仓库提交，网站部署只发布前端素材，不将大型工程文件复制到 Cloudflare Pages。

## 三张网站地图

`footprints/` 保存网站三图的完整生产素材：

| 内容 | 路径 |
| --- | --- |
| 中国白色 / 省份彩色地形工程 | `footprints/scenes/china-relief.blend`、`china-colour.blend` |
| 东亚白色 / 省份彩色地形工程 | `footprints/scenes/east_asia-relief.blend`、`east_asia-colour.blend` |
| 欧美白色地形工程 | `footprints/scenes/europe_usa-relief.blend` |
| 三套 DEM、陆地掩膜、省份编号、投影和城市数据 | `footprints/data/` |
| 五张原始高清 PNG 及渲染报告 | `footprints/renders/` |
| 工程重新打开后的网格、材质、相机、光照验证和 SHA-256 | `footprints/scenes/*-scenes.json` |

这些工程由生成网站 PNG 的同一脚本、已核验 DEM 和参数导出。中国、东亚各保留两个材质版本，欧美尚无到访区域，因此保留白色版本，共五个 `.blend`。全部工程独立可打开，不依赖外置纹理；渲染输出使用相对路径指向旁边的 `renders/`。网站最终的城市与路线裁切在 `assets/maps/relief/atlas.json`，路线来源在 `assets/maps/footprint-journeys.json`；两者也随仓库保存。

| 地图 | 原生渲染宽度 | 投影及范围 | 设计 |
| --- | --- | --- | --- |
| 中国 | 6000 px | 原参考图 Albers 投影 | 暖纸色、矿物色省份 |
| 东亚 | 6000 px | 等距圆柱，103–147° E / 18–47° N | 灰海蓝、同一省份配色 |
| 欧洲与美国 | 8000 px | 等距圆柱，128° W–40° E / 24–66° N | 浅海青、连续大西洋视野 |

统一用 Blender 4.5.3 / Cycles CUDA、192 采样原生重渲，未对旧成图放大插值。DEM 网格沿用已核验的高程采样：中国 2300×1926、东亚 2400×1908、欧美 3000×1061。图像分辨率与地形数据分辨率是两个独立指标；这三张是区域尺度浮雕图。

`footprints-style.json` 集中定义省份颜料、三张图的底色、渲染宽度、采样数和线路显示宽度。省份的配色分组沿用原中国工程，再使用网站专用的赭石、鼠尾草绿、陶土、灰蓝、砂岩与紫灰调色板。原四图配色保留在原工程中。

所有未到访区域保留纯白漫反射材质和真实地形阴影。32° 西北日光与原四图一致。铁路与公路按真实路网生成投影缓冲多边形，分别显示为约 30 km、26 km 宽的地形走廊。这是为了区域地图可读性所作的宽度夸张，不是交通设施实际宽度，也不会把沿线整座城市标为到访。

白色底图和彩色底图由相同网格、相机和光照渲染。浏览器通过到访城市与走廊的联合裁切显露彩色地形，所以山脊、坡面和阴影都会延续到沿线；没有额外叠加彩色描边。省界处的色彩直接来自地形材质。城市边线和名称仅在已到访城市悬停、聚焦或点击时出现。

| 制作步骤 | 仓库脚本 |
| --- | --- |
| 铁路、公路网络重建与省界分段 | `../../scripts/prepare-footprint-routes.py` |
| DEM、投影、城市和走廊几何、WebP 打包 | `../../scripts/build-footprint-atlas.py` |
| 三张图的白色与彩色材质渲染 | `../../scripts/render-footprint-atlas.py` |
| 参数化 GPU 提交 | `../../scripts/render-footprint-atlas.slurm` |
| 地理对齐、走廊覆盖、高清素材与源工程检查 | `../../scripts/validate-footprint-atlas.py` |
| 所有文件的清单、SHA-256、分卷归档、验证及还原 | `../../scripts/archive-relief-projects.py` |
| 服务器全部文件的核验快照，复用本机相同内容 | `../../scripts/snapshot-relief-project.py` |
| 网页显示、8 倍缩放、原始分辨率、大图及触摸交互 | `../../assets/life/scripts/22-footprints-atlas.js` |

## 重建网站素材

从仓库根目录操作。Python 依赖在 `requirements.txt`；Blender 使用独立的 4.5.3 CUDA 环境。

```powershell
python -m pip install -r tools/relief-atlas/requirements.txt
python scripts/prepare-footprint-routes.py
python scripts/build-footprint-atlas.py --prepare
```

更改配色、分辨率或到访城市时，可使用 `--prepare --reuse-dem` 复用 `.render-work/footprints/data/` 内的 DEM。网络来源与边界未更改时，无需重新请求线路服务；已发布的 `assets/maps/footprint-journeys.json` 即为完整路网输入。

本机有 CUDA 时，分别渲染 `china`、`east_asia`、`europe_usa`：

```text
blender --background --threads 8 --python-exit-code 1 --python scripts/render-footprint-atlas.py -- --root .render-work/footprints --map china
```

加 `--save-scene` 可保存各材质版本的可编辑工程；`--scene-only` 仅导出并重新打开校验工程，不重复渲染。Slurm 可设置 `ATLAS_SCENE_ONLY=1`。已经归档的工程位于 `tools/relief-atlas/footprints/scenes/`。

直接用归档 DEM 重建工程或高清 PNG，无需下载或预处理：

```text
blender --background --threads 8 --python-exit-code 1 --python scripts/render-footprint-atlas.py -- --root tools/relief-atlas/footprints --map china --scene-only
```

将 `china` 换成另外两个地图 ID 可导出其工程；移除 `--scene-only` 即渲染原尺寸 PNG。

在 Slurm 集群，将仓库及准备好的 `data/` 上传到 `~/run` 下。从仓库根目录提交，日志目录须先创建：

```bash
mkdir -p logs
export BLENDER_BIN=/path/to/blender-4.5.3-linux-x64/blender
sbatch scripts/render-footprint-atlas.slurm
```

可追加 `china` 等地图 ID，只渲染指定地图。`REPO_ROOT`、`ATLAS_WORK`、`REFERENCE_ROOT`、`RENDER_SCRIPT` 支持环境变量覆盖。下载准备与传输可在本机/登录节点处理，渲染仅在 GPU 计算节点执行。磁盘空间不足时分图渲染，回传并核验 SHA-256 后清理同一任务的重复中间图。

把 `renders/` 回传到 `.render-work/footprints/renders/` 后：

```powershell
python scripts/build-footprint-atlas.py --package
python scripts/validate-footprint-atlas.py
python tools/relief-atlas/reference/verify_delivery.py
python site_renderer.py --check --life-only
node scripts/validate-life-runtime.cjs
node scripts/validate-life-http.cjs http://127.0.0.1:8765/life.html
```

页面仅按需加载 `assets/maps/relief/` 的高清 WebP、裁切几何与地区元数据，不加载 Blender 工程。查看大图后可滚轮缩放、双指缩放和拖动；`1:1` 按屏幕像素密度显示原生分辨率，`↺` 恢复适配，Esc 关闭大图并返回原按钮。

## 重建原四图

已有 DEM 可直接渲染，无需重新下载：

```text
blender --background --python-exit-code 1 --python tools/relief-atlas/reference/render_atlas.py -- --root tools/relief-atlas/reference --map china --samples 96 --sun-elevation 32
python tools/relief-atlas/reference/compose_atlas.py --root tools/relief-atlas/reference
blender --background --python-exit-code 1 --python tools/relief-atlas/reference/pack_labels.py -- --root tools/relief-atlas/reference --verify
```

第一条对 `shengsi`、`china`、`hainan`、`fujian_taiwan` 各执行一次。重新排版需要宋体或 Noto Serif CJK；原 `.blend` 的文字已内嵌，直接打开不需要字体。详细图幅裁剪、海岸修正、数据来源与局限见原工程说明和 `data_notes.json`。

数据来源和许可：AWS Terrain Tiles（上游来源见其登记页）、Natural Earth 公有领域地理数据、DataV 行政区数据、OpenStreetMap ODbL 路网。路线是依照回忆途经点重建的真实网络路径，不是 GPS 记录；来源请求和推定说明保存在 `assets/maps/footprint-journeys.json`。网站地图下方提供来源链接。
