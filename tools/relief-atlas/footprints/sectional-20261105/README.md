# 分区配色与东亚小窗

2026-11-05 生产工程。中国使用青瓷，东亚海外文化区使用雾蓝，欧美国家使用暖砂；中国同一省份在两张地图中保持同色。未到访地形为暖白 `#f4f1e9`，海色分别为 `#e3ebed`、`#e4edf0`、`#e5e9e9`。

- `detail/data`：三张主图及新加坡、夏威夷的真实 DEM 与地理元数据。
- `overview/data`：省份、文化区、国家的材质编号；中国概览复用 detail 烤制图。
- `detail/scenes`、`overview/scenes`：可重开的 Blender 工程与 SHA-256 校验。
- `detail/renders`、`overview/renders`：原生 PNG、CUDA 设备与材质报告。
- `logs`：Zhongwei A800 的 Slurm 日志。
- `prepare-manifest.json`：主图高程、陆地掩膜与坐标数组和历史输入完全一致的校验。

新加坡使用 Terrain Tiles z12 的 50 张真实高程瓦片，夏威夷使用 z9 的 91 张；海岸与邻近陆地取自已归档 Natural Earth 1:10m admin1。Natural Earth 海岸经过概化，因此这两个小窗用于区域展示。小窗独立投影、1600×800 原生渲染，放在东亚右下海面。新加坡高程夸张 4 倍，夏威夷 8 倍。没有配置到访记录，因此只发布暖白地形。

主图原生宽度保持中国/东亚 6000 px、欧美 8000 px；192 Cycles samples，Blender 4.5.3 / CUDA。光照沿用旧工程。材质直接烤进 PNG；打包只做 WebP 编码，不使用后期换色。

服务器工程位于 Zhongwei 的 `/data/run01/scwb515/yangrunde/footprints-sectional-20261105`。主图与概览 Slurm 作业 `292075` 成功完成，耗时 13 分 50 秒；最终小窗作业 `292089` 成功完成，耗时 24 秒。`292079` 为新加坡夸张程度调整前的初次小窗作业，日志保留，最终产物取自 `292089`。

## 重建

在仓库根目录运行：

```powershell
python scripts/prepare-footprint-palette.py
python scripts/prepare-footprint-insets.py
```

将本目录输入、`scripts/render-footprint-atlas.py`、`scripts/render-footprint-sectional.slurm`、`tools/relief-atlas/reference/render_atlas.py` 上传到独立服务器工作目录。工作目录下创建 `logs/`，提交：

```bash
sbatch render-footprint-sectional.slurm
sbatch render-footprint-sectional.slurm insets
```

下载原生输出、工程和日志后，先验证再发布：

```powershell
python scripts/package-footprint-sectional.py
python scripts/package-footprint-sectional.py --publish
python scripts/validate-footprint-atlas.py
python scripts/validate-footprint-overviews.py
node scripts/validate-footprint-overviews.cjs --serve
```

打包拒绝缺失、尺寸错误或 SHA 不一致的产物；保留当前仓库的访问记录、城市与路线几何。日常新增足迹仍使用 `scripts/build-footprint-atlas.py --package`，无需重烤。
