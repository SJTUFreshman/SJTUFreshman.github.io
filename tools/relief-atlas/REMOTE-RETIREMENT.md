# 中卫工程迁回仓库与清理

2026-11-16：本轮行政区双视图在本机生成，未向中卫上传数据或提交作业。
SSH 配置 `paracloud-Zhongwei1` 一度返回后端握手 EOF；重试后恢复。
已读取远端《使用方法.txt》，原文保存在 `server-instructions-20261116.txt`。
下列八套历史地图工程已全部重新归档、逐文件核验并从服务器移除；
每套都有 `full-archive/provenance/retired-*-removal.json` 删除回执。
最终远端枚举确认没有剩余的 footprint/relief 工程目录或顶层相关文件。
其他项目与正在运行的 Slurm 任务保持原样。

## 已核验的本地归档

`full-archive/` 原有 10 份快照全部通过逐文件大小与 SHA-256 检查，包括参考地图、
网站工程、四份远端工程快照及历史审阅文件。后来的分区工程保留在
`footprints/sectional-20261105/`、`selected-cultural-20261106/`、
`culture-regions-20261107/`、`east-asia-cultural-20261108/`。
东亚校准重烤工程位于 `footprints/east-asia-aligned-20261116/`，该次也未上传中卫。

此前 119 个地区视图的源缓存已完整存为
`full-archive/regional-sources-20261116.json`：2,779 个文件、293,467,812 字节。
包括地形瓦片、边界来源及历史影像缓存；逐文件与本机源目录比对通过。
重建脚本为 `scripts/build-region-terrain.py`，现用材质仍是暖白素色。
还原源缓存后可重建，不必依赖原电脑的临时文件。

```text
python scripts/archive-relief-projects.py verify tools/relief-atlas/full-archive/regional-sources-20261116.json
python scripts/archive-relief-projects.py restore tools/relief-atlas/full-archive/regional-sources-20261116.json --output .render-work/region-sources-restored
```

## 已执行的迁回流程与后续复用

先读取服务器现行使用说明，枚举 `/data/run01/scwb515/yangrunde` 中与足迹地图相关的
目录，确认没有遗漏的新项目。禁止清理共享 Blender 安装、环境、其他网站工程或用户数据。

`scripts/retire-remote-relief.py` 默认只读清点一个明确命名的历史地图目录。
它的 `--project` 参数限制为已知的八个地图项目；先核对输出，再执行迁回命令：

```text
python scripts/retire-remote-relief.py --project footprints-east-asia-cultural-20261108
python scripts/retire-remote-relief.py --project footprints-east-asia-cultural-20261108 --archive-and-remove
```

执行迁回会重新下载并归档该目录**当前的全部文件**，不会只凭旧快照删除。
本地归档与下载目录逐文件验证后，远端再次核对全部文件的名称、大小、SHA-256；
有引用该地图目录的 Slurm 作业、文件变化、符号链接或目录越界时拒绝删除。
成功后在 `full-archive/provenance/*-removal.json` 留下明确的删除回执。
必须保存新增的分卷、清单和回执；只有回执确认的目录可以标为已清理。

其余已知目录：`relief-atlas-20261008`、`footprint-atlas-20261009`、
`footprints-material-white-20261012`、`footprints-administrative-20261016`、
`footprints-sectional-20261105`、`footprints-selected-cultural-20261106`、
`footprints-culture-regions-20261107`。若找到其他相关目录，先调查并归档，
不能对父目录使用通配符删除。
