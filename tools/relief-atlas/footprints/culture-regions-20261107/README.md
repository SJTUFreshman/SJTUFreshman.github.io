# 中国文化分区重划

按文化联系组织区域，再选择已有地名或历史简称。综合考虑方言、迁徙历史、民俗及地域认同，不把任何单一因素当作唯一标准，也不从历史地名反推整块范围。

本版共 47 区，覆盖 370 个源单元，56 个单元改变归属。完整成员、逐区依据及局限保存在 `china-cultural-regions.json` 快照和根目录同名配置中。页面使用短名，区际边界可见，区内省市边界及成员计数隐藏。

## 主要调整

| 地区 | 当前处理与依据 |
| --- | --- |
| 长三角 | 上海、苏锡常与浙江合为吴越，体现吴语基础及长期经济民俗联系；温州、浙西南的内部差异仍存在。南京、镇江与皖中部分地区归江淮。 |
| 江南西缘 | 黄山归徽州；芜湖、马鞍山、铜陵、安庆、池州、宣城归皖江，避免把皖南全部等同徽州。历史徽州的绩溪、婺源受地级尺度限制，未单独切出。 |
| 北方 | 山西与内蒙古中西部若干城市合为晋绥，体现走西口、晋商和民俗联系；锡林郭勒、阿拉善归蒙古。呼伦贝尔与其余蒙东、东北大部归满洲，采用区域联系而非族群单一性判断。 |
| 环渤海 | 保留大连、营口与胶东、鲁北的跨海联系，使用胶辽；纳入鲁北不等于将其全部视作胶辽官话。 |
| 淮河流域 | 淮海保留徐州、宿迁、连云港与鲁南、皖北东部的联系；阜阳、亳州、菏泽、南阳归中原，信阳整体近似归江淮。 |
| 长江中上游 | 恩施、铜仁与湘西、张家界、怀化合为武陵；汉中、安康、商洛、十堰、陇南合为秦巴；昭通纳入巴蜀。 |
| 东南沿海 | 单列莆仙、海陆丰、高凉、钦廉；惠州与粤东北、赣南、闽西归客家；湛江与海南合为雷琼。惠州、三明等地内部文化多样，整市归属仅为近似。 |
| 西北与青藏 | 关中与陇中东部、固原合为关陇；西宁、海东、临夏归河湟；西藏连接甘孜、阿坝和青海部分地区，并纳入海北。标签概括区域联系，不表示各处文化完全一致。 |

这是一版可调整的文化联系展示。边界来自已有地级单元，不能细分同一地级市内的方言、城乡或族群差异；港澳台使用现有省级补充单元。完整处理原则见配置 `policy`，具体判断见各组 `basis`。

## 原生工程与验证

- 中卫目录：`/data/run01/scwb515/yangrunde/footprints-culture-regions-20261107`。
- Slurm 作业 `298556`：`COMPLETED`，退出码 `0:0`，耗时 2 分钟。
- Blender 4.5.3 / Cycles CUDA，192 采样，6000×5024 原生输出；无渲染后改色。
- `cultural/data/` 保留材质栅格与元数据，`cultural/renders/` 为原始 PNG，`cultural/scenes/` 为已重开核验的 `.blend`。
- 中国高程、陆地掩膜和坐标数组与 `selected-cultural-20261106/detail/` 相同，校验见 `cultural/prepare-manifest.json`。
- 原省份层、白色地形、其他主图及新加坡／夏威夷小窗沿用已发布工程；实际到访城市与路线不变。
- 原生 PNG 与工程的 SHA-256 在各自报告内，作业日志在 `logs/`，发布检查在 `production-report.json`。

## 重建

修改根配置后，选择新的 `NEW_ARCHIVE`，不覆盖本归档：

```powershell
python scripts/build-china-cultural-overview.py --prepare --archive NEW_ARCHIVE --source-archive tools/relief-atlas/footprints/selected-cultural-20261106
```

将准备好的数据、配色及渲染脚本上传到新服务器目录，用 `sbatch render-footprint-sectional.slurm cultural` 渲染。下载 PNG、场景、核验报告及日志后：

```powershell
python scripts/package-footprint-sectional.py --archive NEW_ARCHIVE --cultural-only --publish
python scripts/validate-footprint-overviews.py
python scripts/validate-footprint-atlas.py
node scripts/validate-footprint-overviews.cjs --serve
```

发布器核对当前分区版本、成员和名称与烤制输入一致，只替换文化层并重建预览图、运行时数据。卡片仍使用 960 像素静态预览，点击「查看大图」后才加载高清图和几何数据。
