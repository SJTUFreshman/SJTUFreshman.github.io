# 东亚底图与文化边界投影对齐

本包是 2026-11-16 的纠偏派生工程。原 `selected-cultural-20261106`、
`culture-regions-20261107`、`east-asia-cultural-20261108` 归档保留原字节。

## 原因与修复

旧东亚 DEM、陆地掩膜和城市路径实际使用半径 6378137 米的球面等距圆柱
投影，但 CRS 字串写成 `+proj=eqc ... +datum=WGS84`。[PROJ 9.8 新增](https://github.com/OSGeo/PROJ/releases/tag/9.8.0)
椭球 EQC 后，同一旧字串在 pyproj 3.8 / PROJ 9.8.1 与
rasterio 1.5.2 / PROJ 9.7.1 产生不同坐标：上海附近相差约 20.03 km，
对应 6000 像素底图的 29.62 px。文化边界和文化色域因此向南偏移，
缩成 960 像素卡片后仍有约 4–5 px 的错位。

当前生成器统一明确 `+R=6378137`。中国文化区先从原 AEA 图像恢复地理
坐标，再用明确球体投影到东亚；日本、韩国及周边国家直接从归档真实
行政几何投影。`path`、`boundary_path`、`center` 和材质 ID 栅格使用同一
坐标变换。海外材质不再无条件拷回旧错位栅格。各区域成员、三语名字及
到访记录保持原值。

DEM 的 `elevation`、`mask`、`x`、`y` 与原白色底图逐值一致。仅文化材质
`region` 格网重新栅格化，并重新烤制 overview 彩色层；底图的地形、
海岸、相机、光照和 6000×4770 / 192 samples 规格保持一致。中国陆地
未分配缝隙格点从 34,731 降至 608；海外无须补缝。

## 重现

在仓库根目录运行当前 `scripts/`：

```powershell
python scripts/build-footprint-overviews.py --prepare --maps east_asia --render-root tools/relief-atlas/footprints/east-asia-aligned-20261116/overview
```

本次使用 Blender 4.5.3 LTS 的官方 Windows 便携版，以 Intel Arc 140T
的 ONEAPI 后端烤制。`render-footprint-atlas.py --device ONEAPI` 仅指定
计算后端；材质、光照、像素尺寸与采样数不变。可选择原服务器的 CUDA
或显式 CPU 后端重现，报告如实记录 `compute_device_type` 和设备名称。
服务器连接未能建立执行通道，本次没有提交远程渲染作业。

本机采样、去噪和 PNG 保存共 11 分 29 秒，其中首次 ONEAPI 内核编译
约 6 分 44 秒。最初重开校验遇到 Windows 相对路径分隔符规范化差异；
生成器现已兼容斜杠与反斜杠。`verify-existing-render.py` 随后只读重开
已经完成的原始 `.blend`，逐点核对 2,138,781 顶点的位置与材质，核验
原光照、相机、192 samples 和原生 PNG，再写入正式哈希报告；没有重烤
或重新保存该场景。

```powershell
blender --background --threads 8 --python-exit-code 1 --python scripts/render-footprint-atlas.py -- --root <本目录绝对路径>/overview --reference-root <本目录绝对路径> --style <本目录绝对路径>/style.json --map east_asia --variants colour --device ONEAPI --save-scene
python scripts/package-footprint-sectional.py --archive tools/relief-atlas/footprints/east-asia-aligned-20261116 --east-asia-overview-only --publish
python scripts/validate-footprint-overviews.py
```

发布步骤会重建浏览器 runtime、预览和 hit 数据。新增足迹仍按原流程维护
`site_content.json`；主生成器和路线投影也使用明确球体契约，避免后续
重打包重新引入版本相关漂移。

## 验证

`validate-footprint-overviews.py` 现在验证 pyproj 与 rasterio 的控制点
相差小于 1 mm，并将海外色域和新投影的实际来源多边形比较，而不是
要求重复旧色域的错误位置。独立闭式球面公式复核了 20 个海外单元；
另将 42 个大陆文化区与原城市成员并集比较。徽州、赣鄱、吴越、江淮的
质心纬向偏移分别从约 28.71、27.47、28.45、30.35 px 降至绝对值
0.02 px 以内。原始轮廓本身的行政来源差异与海岸采样精度仍然保留。

发布后 `validate-footprint-overviews.py` 全量通过；独立的
`validate-east-asia-projection.py` 核验 63/63 个单元，紧凑运行时及 hit
数据的拓扑、环数、误差和体积预算验证亦通过。前后对比数值保存在
`alignment-before.json` 与 `alignment-after.json`。当前东亚 WebP 相对
原生 PNG 的平均编码误差为 0.9966/255；其地形阴影保持原来强度。

官方工具来源：<https://download.blender.org/release/Blender4.5/>。
Windows ZIP 的 SHA-256：
`6b657c8bdd3a7b65b07b9e1ae17eb4be7dd4aa23121da7f3d3354fc2551330a7`。
来源地理数据和许可沿用前述原始归档；本工程未添加虚构边界。
