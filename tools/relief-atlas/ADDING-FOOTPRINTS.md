# 后续怎样添加城市和路线

日常新增中国城市、铁路或自驾足迹，只需要更新名单或行程，再重新打包。三张图默认按省／文化区／国家显示，按钮可切回原来的城市与路线详情。白色底图与彩色地形已经对齐，浏览器按实际到访地区、城市和沿途走廊显露彩色地形，无需每次重跑 Blender。

## 先找对编辑入口

| 想改什么 | 编辑位置 |
| --- | --- |
| 新到访的中国城市（自动点亮其所属省） | `site_content.json` → `life.footprints.visited_china` |
| 日本／韩国文化区到访 | 同一处的 `visited_overseas_regions`（稳定区域 ID） |
| 欧美等国家到访 | 同一处的 `visited_country_codes`（地图国家代码） |
| 日本／韩国文化区划分 | `tools/relief-atlas/cultural-regions.json` |
| 铁路、自驾的途经顺序 | `scripts/prepare-footprint-routes.py` → `build_routes()` |
| 铁路途经车站的坐标 | 同一脚本的 `RAIL_STATIONS` |
| 省份颜料、海洋材质、走廊宽度 | `tools/relief-atlas/footprints-style.json` |
| 当前使用的 Blender 工程与原始 PNG | 配色文件的 `render_archive` 指向的目录 |
| 缩放上限、浏览器交互 | `assets/life/scripts/22-footprints-atlas.js` |

`assets/maps/relief/atlas.json`、WebP 和 `assets/maps/footprint-journeys.json` 是生成产物，请从这些输入重新生成，不要手改巨大的坐标文件。

后续智能体接手时，先区分“实际到访城市”和“只经过的铁路／公路”，按用户提供的实际顺序更新。
保留旧名单与旧行程。城市和路线分别控制整片行政区、沿线窄带，二者可以同时新增；不要把整条路线的所有途经市都视为到访。
生产归档 `footprints/material-white-20261012/` 和 `reference/` 中的同名脚本是历史快照；日常编辑仓库根下的 `scripts/`，无需修改归档副本或重写 `.blend`。

## 新增中国城市

1. 在 `visited_china` 数组追加地图中的地级市全称，例如 `"昆明市"`。保留“市”等后缀，不用简称或区县名。北京、天津、上海、重庆使用整座直辖市名称。
2. 从仓库根目录执行：

```powershell
python site_renderer.py --life-only
python scripts/build-footprint-atlas.py --package
python scripts/validate-footprint-atlas.py
```

打包器直接读取最新名单，同时更新中国和东亚中可见的城市及其所属省；地图范围以外的城市不会出现在该图上。拼错或不支持的城市全称会报错。已有地形和省份材质不变，原始工程不被改写。

城市点亮表示实际到访。经过一座城市只想显示旅程时，将它放进路线途经点即可，不要因此把它加入到访名单。

不确定地名时，从当前生产归档查可用名称，以下命令只读取数据：

```powershell
python -X utf8 -c "import json; from pathlib import Path; style=json.loads(Path('tools/relief-atlas/footprints-style.json').read_text(encoding='utf-8')); data=json.loads((Path(style['render_archive'])/'data/china.json').read_text(encoding='utf-8')); print('\n'.join(region['id']+' '+region['name'] for region in data['regions']))"
```

新增名单必须与其中的 `name` 完全一致。不要为了通过检查删掉未识别的新地点；先确认是否使用了区县名、简称，或是否需要补行政区数据。`--life-only` 只同步页面内容，不能代替 `--package`。

## 新增自驾路线

在 `build_routes()` 的 `routes` 列表中，参考已有公路条目追加一项。下面只是格式示例，名称和途经点按自己的实际行程替换：

```python
route(
    "my-new-road-trip",  # 唯一 ID，后续缓存和地图都靠它识别这条行程。
    names("My road trip", "我的自驾行程", "我的自駕行程"),
    "road",
    [
        point("济南", 117.120128, 36.651296),  # 坐标顺序固定为经度、纬度。
        point("青岛", 120.38264, 36.067082),
    ],
),
```

```powershell
python scripts/prepare-footprint-routes.py
python scripts/build-footprint-atlas.py --package
python scripts/validate-footprint-atlas.py
```

途经点决定路线方向，OSRM 返回完整公路几何；不会用两城之间的直线代替道路。可加入实际经过的中间点约束路线。未改动的请求复用本地缓存；要主动刷新公路路网，可加 `--force-roads`。首次重建需要网络。

路线 ID 必须在铁路和公路条目之间也唯一。每条至少两个途经点，坐标为 WGS84 的 `[经度, 纬度]`；高德／百度等地图的坐标应先核实坐标系。只凭起终点无法保证与历史行驶路线相同，已知中途停靠点应一并填写。

## 新增铁路路线

1. 在 `build_routes()` 追加 `kind="rail"` 的条目，途经点顺序按实际乘车顺序填写。
2. 在 `RAIL_STATIONS` 补齐各途经点同名车站的经纬度。铁路使用这张车站表，不能把城市中心当作铁路站点。
3. 重新生成铁路总表并打包：

例如复用现有上海、苏州车站，条目格式如下（仅为写法示例，不代表新增了这次旅行）：

```python
route(
    "my-new-shanghai-suzhou-rail",
    names("Shanghai–Suzhou rail trip", "上海—苏州铁路行程", "上海—蘇州鐵路行程"),
    "rail",
    [point("上海", *RAIL_STATIONS["上海"]), point("苏州", *RAIL_STATIONS["苏州"])],
),
```

同城不同站使用不同名称键。比如去上海虹桥应在 `RAIL_STATIONS` 新增对应车站坐标、在行程里使用相同名称，不能修改已有“上海”键，导致所有老行程一起换站。`point()` 的坐标用于行程记录，铁路实际寻路使用 `RAIL_STATIONS` 中同名坐标。

```powershell
python scripts/prepare-footprint-routes.py --refresh-rail
python scripts/build-footprint-atlas.py --package
python scripts/validate-footprint-atlas.py
```

`--refresh-rail` 会纳入新增或改动的铁路行程，未改动的分段仍复用缓存。BRouter 会核验每段为 `railway=rail`；如果站点不连通或服务不可用，应修正站点/稍后重试，不要改成两点直连。

即使只改了车站坐标或中间站顺序，也必须加 `--refresh-rail`。总表存在时默认直接复用，遗漏这个参数可能报缺失 ID，也可能仍显示旧走向。它不是清空所有分段缓存；如需强制更新未变端点的铁路路网，先保留旧缓存，只移出该行程对应的 `brouter-<route-id>-<leg-index>.json` 再刷新。`--force-roads` 只刷新公路。

`corridor_width_km` 是地图上彩色地形走廊的总宽度：目前铁路 30 km、自驾 26 km，是为区域图可读性设置的显示宽度。走廊在省界处沿用省份材质，不会把途经整座城市都标成到访。

## 省级、文化区和国家概览

三个地图各有独立切换按钮；概览与详细视图共用同一白色地形，`atlas.json` 的 `maps.*.overview` 保存概览单元，原有 `regions` 和 `routes` 仍保存详细城市／旅程。

- 中国概览按照省级行政区显示。到访省份只从 `visited_china` 中实际到访城市的 `province` 推导，不能用铁路、公路经过的省份来推导；不需要再维护一份到访省名单。
- 东亚中的中国部分用同一省名单；日本用八大地方（九州和冲绳合并），韩国用首都圈、关东、湖西、湖南、岭南、济州六个文化区。文化分组仅用于展示，具体成员见 `cultural-regions.json` 的 `members`，键为 Natural Earth 的 `iso_3166_2`。朝鲜及周边国家各自作为一个单元。
- 欧美按国家／地区聚合。原始 Natural Earth `adm0_a3` 是稳定代码，通常为 ISO 3166-1 alpha-3，例如 `FRA`、`DEU`、`USA`；它也有 `ALD`、`CYN` 等独立地区扩展码，严格使用实际元数据里的 ID。一个国家整体使用同一个原生 Blender 颜料颜色。
- 未到访的省、文化区、国家保持原来的白色材质，不能为了展示配色而虚构到访。当前海外到访数组均为空。

`build-footprint-overviews.py` 分成两阶段：`--prepare` 在独立归档准备新的区域几何与 DEM 材质编号，供 Blender 渲染；`--package` 用已渲染图片更新概览。旧的 `build-footprint-atlas.py --package` 会自动调用概览打包，不会在日常更新时丢失概览，也不会重复压缩图片。

## 海外地点

新到访日本或韩国时，往 `life.footprints.visited_overseas_regions` 添加文化区 ID，例如 `"JPN:kanto"` 或 `"KOR:capital"`；完整 ID 在 `cultural-regions.json`。一个文化区只要确实到访其中一处即可点亮，不要把仅途经的地区加入。国家列表不能代替这些文化区记录。

新到访欧美或其他以国家显示的地区时，往 `visited_country_codes` 添加地图中的国家代码，例如 `"FRA"` 或 `"USA"`。这里只记录新国家级足迹；中国仍然从实际城市自动推导，日本和韩国仍然使用文化区列表。原来的 `visited_countries` 是旧地图文案字段，不能用它点亮当前浮雕图。

```powershell
python scripts/build-footprint-atlas.py --package
python scripts/validate-footprint-atlas.py
python scripts/validate-footprint-overviews.py
```

这会更新概览的到访状态，无需再次跑 Blender。海外原详细图仍保持原始展示，不会把新增国家到访伪装成去过所有州／府县。以后需要海外细级城市、铁路或公路，仍需扩展 `build-footprint-atlas.py` 的 `regional_units()`、路由及陆地裁切，再准备相应细级材质；当前中国路线流程不覆盖海外。

概览渲染归档在 `footprints/administrative-20261016/`，其中有 `data/`、原生 PNG、Blender 工程以及压缩的原始 Natural Earth GeoJSON。中国概览复用 `material-white-20261012` 的全省彩色渲染。不要重写这两个历史目录；更改分组或颜料后用 `--render-root NEW_RENDER_ROOT` 准备并渲染新归档，并同步代码中的默认 `ARCHIVE` 路径。新归档缺少几何源时，把已有归档的 `cache/*.geojson.gz` 复制进去即可离线重建。

```powershell
python scripts/build-footprint-overviews.py --prepare --render-root NEW_RENDER_ROOT
# 新的 east_asia / europe_usa 彩色版需以原相机、DEM、光照 --variants colour --save-scene 渲染。
python scripts/build-footprint-overviews.py --package --render-root NEW_RENDER_ROOT
```

`stable_colour(ID)` 生成稳定的低饱和矿物色；新增国家或改变排序不会重设旧国家颜色。中国省色与既有全省彩色图完全一致。配置文件分组必须覆盖日本 47 个都道府县、韩国 17 个一级行政单元且每个恰好出现一次；构建器会拒绝漏项、重复项和未知到访 ID。

## 什么时候才需要 Blender

更改海色、省份颜料、地形、范围、光照或原生分辨率时，才需要重渲。只改变到访名单、行程或走廊宽度时，打包即可。

海洋材质可直接从配色文件读取；修改省份调色板、分辨率或采样数后，先执行 `python scripts/build-footprint-atlas.py --prepare --reuse-dem`，再把更新后的 `.render-work/footprints/data/` 放入新的渲染目录。这些参数也保存在准备好的地图元数据中，仅编辑配色文件后使用旧 `data/` 会沿用旧参数。

- 未到访材质是 `#ffffff` 的非自发光漫反射。阳面、背光坡面与投影仍应有明暗；“纯白材质”不等于成图每个陆地像素都是白色。
- 海色在 Blender 的海洋材质里调整。网页只把原始 PNG 编码为 WebP，不做亮度曲线、提亮阴影或二次换海色。
- 白色版、彩色版必须保持相同的 DEM、相机和光照，否则彩色裁切会错位或出现阴影接缝。
- 新渲染保存到独立目录，用 `--save-scene` 同时保存并重新打开核验 `.blend`。不要覆盖历史归档。

```text
blender --background --threads 8 --python-exit-code 1 --python scripts/render-footprint-atlas.py -- --root NEW_RENDER_ROOT --map china --save-scene
```

另外两个地图 ID 是 `east_asia`、`europe_usa`。输入的 `data/` 可从当前生产归档复制。先用 `--preview --sea-colour "#8ca6b5"` 做小图对比，预览写入独立的 `previews/`，不会覆盖生产图。集群仅通过有时限的 `sbatch` 在 GPU 节点运行，参数见 `render-footprint-atlas.slurm`。

## 检查和发布

```powershell
python scripts/validate-footprint-atlas.py
python scripts/validate-footprint-overviews.py
python site_renderer.py --check --life-only
node scripts/validate-life-runtime.cjs
node scripts/validate-star-map.cjs --serve footprints
```

准备发布时，更新 `22-footprints-atlas.js` 的 `ATLAS_VERSION`，以及 `life.html` 对该脚本 URL 的 `atlas=` 参数；这样浏览器会重新请求元数据和图片。若修改 CSS，也更新其资源版本参数。
由于脚本本身也可能被缓存，同时把 `life.html` 中所有本地 Life JS/CSS 的 `v=` 一起改成同一个新版本，不能只改一个文件；运行时检查会验证共享版本。这里的 `atlas=` 是地图内容版本，`v=` 是页面资源版本。

发布前逐项检查实际变更：

- 新城市在详细图上点亮，其所属省在中国及东亚概览点亮；旧城市仍保留，沿途未到访城市和省份不整片变色。
- 日本／韩国只点亮实际到访文化区，欧美只点亮实际到访国家。各图切换后视角、缩放保留，互不改变其他图的显示模式。
- 新行程 ID 出现在 `footprint-journeys.json`，并在范围相交的地图 `routes` 中包含非空 `corridor_path`；横跨省份时显露对应省份的地形颜色，山脊和阴影连续。
- 本地大图仍限制中国 300%、东亚／欧美 200%；图片原生清晰度、海色、纯白地形阴影不因新增足迹改变。
- 提交源名单／行程脚本、生成的行程与地图数据、实际改变的 WebP、页面生成文件和版本号。日常足迹更新不修改历史归档。

若新地点只更新了名单却没亮，先检查是否重新打包；若路线仍旧，检查铁路刷新参数及实际途经站；若本地正确而网页旧，检查部署目录、生产域名以及资源版本。页面不实时查询路由服务。

提交并推送后，按 `docs/cloudflare-pages.md` 构建、发布并核对正式域名。Git push 本身不会更新 Cloudflare 网站。
