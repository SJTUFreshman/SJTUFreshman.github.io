# 东亚中国文化分区

东亚概览的中国部分改用与中国文化图一致的分区。当前视野覆盖 43 个中国文化区；日本八大地方、韩国六区和六个周边国家单元沿用原配置，总共 63 个单元。

边界来自 `culture-regions-20261107/cultural/data/china.json`：先合并内部市界缝隙、保留其他分区占地，再从中国图像坐标恢复投影坐标，转换为经纬度并投影到原东亚地图。原东亚中国陆地掩膜内未分配的材质格点归入最近文化区，海外材质范围直接沿用旧栅格，避免出现行政边界白缝。文化区成员、三语短名、分类版本及完整成员到访规则与中国图一致；相邻色索引转换为东亚原有冰川色系。区际边界使用与中国图相同的淡细线，内部省市边界不显示。

## 烤制记录

- 服务器：SSH 配置 `paracloud-Zhongwei1`。
- 工作目录：`/data/run01/scwb515/yangrunde/footprints-east-asia-cultural-20261108`。
- Slurm 作业：`304091`，`COMPLETED`，退出码 `0:0`，耗时 1 分 59 秒。
- Blender 4.5.3 / Cycles CUDA，192 采样，仅重烤 `overview/east_asia` 彩色层。
- 高程、陆地掩膜、横纵坐标与 `selected-cultural-20261106/detail` 完全一致；核验记录在 `prepare-manifest.json`。
- `overview/renders` 保存原生 PNG 和哈希报告，`overview/scenes` 保存已重开核验的 Blender 工程，`logs` 保存作业日志。
- 白色地形、城市与路线详情、新加坡和夏威夷小窗沿用原工程。

## 重建与发布

从仓库根目录使用当前 `scripts/`，本目录脚本是当次工程快照。准备新目录：

```powershell
python scripts/build-footprint-overviews.py --prepare --maps east_asia --render-root NEW_ARCHIVE/overview
```

上传新输入与渲染脚本，执行 `sbatch render-footprint-sectional.slurm east-asia-cultural`。下载场景、PNG 和日志后：

```powershell
python scripts/package-footprint-sectional.py --archive NEW_ARCHIVE --east-asia-overview-only --publish
python scripts/validate-footprint-overviews.py
python scripts/validate-footprint-atlas.py
node scripts/validate-footprint-overviews.cjs --serve
```

发布器检查分区版本、成员、几何参数、DEM、原生渲染与场景哈希，随后替换东亚概览并重建小图，更新 `map_overview_archives.east_asia`。中国卡片默认显示文化区，完整图继承卡片当前视图；详情仍按需加载。
