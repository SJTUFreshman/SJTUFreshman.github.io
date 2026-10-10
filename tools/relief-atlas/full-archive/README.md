# 完整地图文件归档

四张参考地图和网站三张地图的全部工程文件均保存在本仓库中。清单逐目录枚举，没有按扩展名、用途、新旧版本或文件大小排除文件；每份清单的 `excluded_files` 都为空。这里保存完整快照，旁边的 `reference/` 和 `footprints/` 提供直接可打开的生产素材。

| 快照清单 | 文件数 | 原始字节数 | 完整源目录范围 |
| --- | ---: | ---: | --- |
| `reference-original.json` | 1628 | 921226914 | 本机 `relief-atlas-20261008/`，包含四个原始 Blender 工程、全部脚本、两份交付 ZIP、1547 个缓存文件、日志、旧光照方案和中间结果 |
| `website-work.json` | 91 | 251322291 | 本机 `.render-work/footprints/`，包含所有原始下载、DEM、渲染图、旧图与浏览器 QA 截图 |
| `website-production.json` | 22 | 493978938 | `tools/relief-atlas/footprints/`，包含中国与东亚白色/彩色、欧美白色共五个 Blender 工程，以及 DEM、高清 PNG 和验证报告 |
| `website-support.json` | 6 | 101364 | 工作目录外的地图缩放调试脚本及全部现存地图脚本字节码，保留原仓库相对路径 |
| `remote-reference.json` | 75 | 277296681 | `paracloud-Zhongwei1` 上的 `relief-atlas-20261008/` 全部文件，包括服务器特有的脚本版本、日志、临时数据和工程 |
| `remote-footprints.json` | 28 | 42607231 | 同一服务器的 `footprint-atlas-20261009/` 全部文件，包括所有 Slurm 日志和工程重开校验报告；回传后的五个 Blender 工程另完整保存在 `website-production` |

六份快照共 1850 条文件记录、1986533419 原始字节；不同快照之间的同一内容也各保留对应路径。仓库按内容去重复用，因此实际新增空间小于这些快照的总字节数。

当前网站制作脚本、页面交互、配色、路线数据和发布素材还直接保存在本仓库的 `scripts/`、`assets/maps/`、`assets/life/` 及本目录的上一级。补充调试脚本快照保留了已经被替代的脚本字节码。

## 文件格式

- 每份清单记录每个原始文件的相对路径、字节数、SHA-256、修改时间和文件模式，以及全部子目录（包含空目录）。`file_count` 和 `total_bytes` 可直接用于核对完整性。
- 未直接复用的原始文件按顺序切成最多 48 MiB 的 `.part` 分卷；分卷本身也是 SHA-256 命名。归档不会重新压缩或改写原 ZIP。
- 已直接保存的相同 `.blend`、`.npz`、PNG 等二进制素材可作为清单中的内容块复用。必须保留完整仓库，单独复制 `full-archive/` 不能还原所有文件。
- 所有其他内容按原字节存入 `objects/`，包括源文本及其原始换行符。`.gitattributes` 禁止 Git 对分卷进行文本转换。
- `provenance/` 保存服务器原始文件清单，包括远端路径、文件模式、纳秒修改时间和 SHA-256。服务器文件在快照前后各枚举核验一次，并逐文件校验本机副本。

## 验证与还原

需要 Python 3.11 或更新版本，仅用标准库。从仓库根目录执行，恢复路径必须不存在或为空：

```powershell
python scripts/archive-relief-projects.py verify tools/relief-atlas/full-archive/reference-original.json
python scripts/archive-relief-projects.py restore tools/relief-atlas/full-archive/reference-original.json --output .render-work/restored-relief/reference-original
```

将 `reference-original` 换成上表其他名称，可逐一还原。批量验证所有快照：

```powershell
Get-ChildItem tools/relief-atlas/full-archive -Filter '*.json' -File | ForEach-Object {
    python scripts/archive-relief-projects.py verify $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Archive verification failed: $($_.Name)" }
}
```

还原会先验证全部内容块，再写入文件，最后重新核验恢复后的完整文件/目录清单和每个 SHA-256。交付时已将每份快照实际还原到全新的本机目录，并与原清单逐文件核对。

如原始目录仍在，可追加源目录进行核对：

```powershell
python scripts/archive-relief-projects.py verify tools/relief-atlas/full-archive/website-work.json --compare-source .render-work/footprints
```

`archive-relief-projects.py archive --source 快照名=源目录` 用于制作完整快照；名称只用小写英文字母、数字及连字符。`snapshot-relief-project.py` 可通过 SSH 获取服务器完整目录，并优先复用 SHA-256 一致的本机文件减少传输。归档和还原不调用 Blender，也不需要连接原服务器。
