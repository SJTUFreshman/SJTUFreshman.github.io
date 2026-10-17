# 省／文化区／国家概览材质工程

新增三张地图的默认概览视图，保留旧城市／路线视图和白色底图。

- 中国使用34个省级单位；实际到访城市推导19个已到访省级地区。几何在 `data/china.json`，彩色地形直接复用 `../material-white-20261012/renders/china-colour.png`。
- 东亚按中国省份、日本八大地方（九州与冲绳合并）、韩国首都圈／关东／湖西／湖南／岭南／济州分组。周边其他单元保持国家级。
- 欧美按 Natural Earth 国家／地区代码归并，一国一种稳定矿物色。所有海外地区当前均未到访，因此网页保持白色，完整彩色 PNG 仅供按名单裁切。

`data/` 保留投影、裁切、材质编号及与旧工程完全一致的 DEM；`cache/` 保留压缩原始 Natural Earth 行政单元；`scenes/` 保存两份独立可打开的 `.blend`；`renders/` 是6000／8000像素宽、192采样的原生彩色 PNG；`logs/` 保留全部作业日志。

Blender 4.5.3 / Cycles CUDA，海洋材质 `#8ca6b5`，32°西北日光。没有后期提亮或改色。材质、网格、相机和光照已在保存后重新打开检查，SHA-256位于 `scenes/*-scenes.json`。作业223838于2026-10-16完成，耗时3分27秒，单GPU、20分钟时限。

小于原DEM单格的微型地区（例如直布罗陀）保留独立矢量几何，但此区域尺度无法可靠显示独立地形色块。图形范围、地形精度与旧图相同。

维护入口是仓库根目录 `scripts/build-footprint-overviews.py` 与 `tools/relief-atlas/ADDING-FOOTPRINTS.md`；本目录脚本是生产快照。日常新增到访只运行 `scripts/build-footprint-atlas.py --package` 即同步两种视图，不改写历史工程。更改文化区分组或配色需要独立重渲。完整服务器快照见 `../../full-archive/remote-administrative-20261016.json`。
