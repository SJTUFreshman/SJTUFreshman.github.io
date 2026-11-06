# 三图独立配色与中国文化区

用户选定中国「青瓷编辑」、东亚「北境冰川」、欧美「水墨朱砂」。三图分别使用完整方案的海色、留白和地区色阶；东亚中国省份使用冷青色，不再复用中国图的青瓷颜料。欧美的水墨朱砂方案使用陶土色国家层。实际到访名单、城市和道路几何保持原有记录。

## 原生工程

- `detail/data`：三张主图和新加坡、夏威夷两个小窗的 DEM 与元数据。
- `overview/data`：中国省份、东亚文化区、欧美国家元数据和区域材质栅格。
- `cultural/data`：中国跨省文化区的元数据、材质栅格与原有 DEM。
- 各层的 `renders`、`scenes`：Blender 原生 PNG、可重开工程、材质与 SHA-256 验证报告。
- `prepare-manifest.json`：主图高程、陆地掩膜、坐标数组与历史数据不变的校验。
- `style.json`：本次使用的全部材质；`logs` 为中卫 A800 的 Slurm 运行记录。

生产仍为 Blender 4.5.3 / Cycles CUDA、192 采样。中国与东亚宽 6000 px，欧美宽 8000 px，小窗为 1600×800。图像打包只做 WebP 编码，不对已渲染像素后期改色。中性地形材质分别为中国 `#f4f1e9`、东亚与小窗 `#f1f3ee`、欧美 `#f7f3ea`。

中国文化区使用现有地级市真实边界进行跨省组合，采用满洲、西藏、胶辽、江淮、淮海、客家、巴蜀等已有历史或地理名称。边界为地级尺度近似，不代表精确语言边界；配置可调整。到访任一成员城市即点亮文化区，页面不显示成员计数或内部边界。

## 重建

从仓库根目录运行：

```powershell
python scripts/prepare-footprint-palette.py
python scripts/build-china-cultural-overview.py --prepare
```

上传本目录的输入和脚本到中卫独立工程目录 `/data/run01/scwb515/yangrunde/footprints-selected-cultural-20261106`，创建 `logs` 后提交：

```bash
sbatch render-footprint-sectional.slurm
sbatch render-footprint-sectional.slurm insets
sbatch render-footprint-sectional.slurm cultural
```

将原始 PNG、Blender 工程、渲染报告和日志下载回相应层，验证后发布：

```powershell
python scripts/package-footprint-sectional.py
python scripts/package-footprint-sectional.py --publish
python scripts/validate-footprint-atlas.py
python scripts/validate-footprint-overviews.py
node scripts/validate-footprint-overviews.cjs --serve
```

主图和概览 Slurm 作业 `294277` 用时 13 分 06 秒，小窗作业 `294278` 用时 28 秒，文化区作业 `294352` 用时 2 分 08 秒，全部成功退出。首版文化区共 50 区，完整覆盖 370 个地理单元，其中 16 区有实际到访成员。完成状态记录在 `logs` 和 `production-report.json`。
