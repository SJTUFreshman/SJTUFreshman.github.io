# Life 场景高模优化交接说明

## 用户最终目标

继续把 Life 页面中的四个固定位置全景场景做到照片级真实。普通访客默认只允许在固定位置 360° 查看预渲染全景，不让用户设备实时渲染高模；隐藏探索模式继续保留轻量代理几何。夜空、星座点击、场景切换、晴天/黄昏和现有 Home 内容必须保持独立且不被场景绑定。

默认模式采用工业显卡离线渲染的高分辨率全景，并根据访客设备下采样。不要把 4K/8K 离线模型或贴图直接加入浏览器运行时。

## 当前真实状态

- 2026-09-22 最新优先事项是用户要求的「先把 NASA 资产接入」。已完成真正的 Life 离线接入：`scripts/integrate-nasa-interior.py` 保留官方 ISS 几何/UV，恢复源显示器贴图，将 Cupola 七窗与相连 Node3 舱段放到 Life 固定观察点。新参数 `--nasa-interior` 只允许 refined spaceship，隐藏探索代理不变。A800 `168371` 在 `d1n41a21g02` 完成（12:21，0:0），产出夜间/晴天/黄昏三组 4096×2048 RGBA 全景、两张独立天空和 27 张 1600×1100 原生视图；32 PNG + 4 evidence 的 36 项哈希全部一致。独立视觉审查 **FAIL**：前暗后亮、后舱顶部矩形黑区需诊断、窗缘分段和贴图平面感。技术接入成立，照片级连续通过仍为 `0`；正式 manifest 未改。详见 `docs/review-20260922-nasa-integration.md`。
- NASA 本地隔离预览：`http://127.0.0.1:8766/life.html`，进入飞船查看。启动命令为 `python scripts/serve-panorama-review.py --manifest .render-work/nasa-life-20260922-r3/preview/catalog.json --port 8766`。只替换本地 manifest HTTP 响应中的 spaceship/night，其他场景保留生产目录内容；NASA 高模和派生全景未加入生产资源。该服务需保持运行，修改 catalog 后需重启。HTTP 页面、catalog、WebP 已验证；浏览器控制工具仍报 `unsupported Codex auth method: apikey`，因此本轮没有完成真实浏览器视觉/星座交互验收。不要将 HTTP 验证写成浏览器验收。
- NASA 首次 `168355` 与第二次 `168368` 均在 15 秒内 FAILED，原因是 Blender 懒解码图片被过早的 `has_data` 检查误判；已通过先读取 size/pixels 修复。失败目录保留。成功目录为 `.render-work/nasa-life-20260922-r3/`，其中图片后缀仍为 `r1`，应按目录和 job 区分。三个自建 job 均已结束；最近队列为无关训练 `167803` RUNNING、`168319` PENDING，均未操作。

- 2026-09-21 延续：已完成 Tapado r2 A800 `167847` 的两相全景/近雪诊断，仍 FAIL（局部冰川、白色平滑面和明显三角折面，不能承担连续远峰）。NASA 材质对照 r4 `167850` 完成，新增可选源 Diffuse 明度粗糙度响应，Cupola 七窗独立天空仍成立，但仅为源诊断。Hohenzollern r7/r8 修复真实裁切边界封口，`167851` 因 Blender 三角剖分 API 差异立即失败，修正后 `167855` 完成，仍 FAIL（融合植被、绿色碎片、硬切边）；未安装。城市两脚本已修复重复体量和破口关联，尚待新 A800 渲染。详见 `docs/review-20260921-tapado.md`、`docs/review-20260921-nasa-r4.md`、`docs/review-20260921-castle-r7.md`。

- 2026-09-19 最新雪山延续：用户要求《死亡搁浅》式层叠险峻远峰。Rainier + Matterhorn r3 `166196` 实渲及独立审查均 FAIL（圆形 berm、平地、底板、蓝紫远峰）。已修复裁切世界法线变换并增加全空拒绝；Mont Blanc 原 GLB 实为 961,158 面，旧版被二次缩小后裁空，不能继续当作无效来源。新研究 `166266` 在 A800 完成完整 Mont Blanc 两个真实地表机位，32 张图全部取回校验，5 项裁切回归通过；四周群山构图改善，但山壁软化拉伸、巨型三角面、近雪重复仍使两机位独立审查均 FAIL。无接收平面或 berm，不得安装。Mont Blanc 仅留作更远背景候选，中近景另找高分辨率扫描。两个 job 均已结束，自有队列为空。详情见 `docs/review-20260919-snow-massif.md`；浏览器工具更新后的认证连接异常也已记录，不能绕过官方登录。
- 当前没有场景被批准为照片级真实，连续干净审查轮数为 `0`。
- 当前网站 manifest 仍使用旧的 `review` 版本；新渲染没有自动安装。
- 最新公开高模实渲、用户复核与作业记录见 `docs/review-20260916.md`；旧程序场景记录见 `docs/review-20260914.md`。
- 城堡 r15/r16/r17、雪山 r15/r16、城市 r11、飞船 r14/r15 已在远端 A800 实际渲染并独立审查，仍不合格。
- 城堡主体已放大并真正重组模块；r17 实图已确认门楼三角黑洞封闭、远山规则纹理减少。均匀草地/岛台、重复桥墩和过平滑远山仍不合格。Hohenzollern 已授权下载并完成 r1–r6 A800 隔离研究：轴向修正后近景建筑漂亮，但融合植被、黑色扫描边界和开放裁切裙座仍不合格；不得安装或更新 manifest。
- 雪山旧版圆形凹坑在 r15 已消除，r16 山肩进一步收窄为弯曲凸脊。仍有圆滑山块、横向积雪带、悬挑岩片、模具感背包及部分背景拉伸，未到照片级。
- 飞船和废土城市也仍未达到照片级，不能只继续增加小零件，必须优先解决大体量、材质和构图。
- 本轮保留原 panorama manifest SHA-256：`8ecb6a5fc4990027c9fb8a1a91888e4a14478fa569a6cb14b1ec82a94633d7b0`。历史上它曾是 dirty；2026-09-22 核对已与 Git HEAD 基线一致，本轮未改，不要回滚为更旧版本。
- 最新完整渲染：城堡 r18 `162094`（08:23）、雪山 r17 `162099`（14:50）、城市 r12 `162113`（46:58）、飞船 r16 `162089`（21:25）及 r17 `162110`（22:16），均为 COMPLETED。城堡 r18、飞船 r16 完整独立审查失败；城市 r12、飞船 r17 的主代理审查也失败，尚无完整独立通过。
- 飞船 r16 首次 `162080` 因材质插槽名错误在 5 秒内 FAILED，失败源快照保留；正确插槽为 `Anisotropic`。r17 的 40 个顶棚支座经 80 对真实网格接触验证，整体外观仍 CG。
- 雪山 r18 `162168` 已 COMPLETED（14:42），两相全景与 8 张原生近景均已下载和主代理查看。蜂窝岩纹消除，但山体、积雪斑与山肩仍明显圆滑，孤立怪石柱及匀色地平线仍不合格。本轮自身队列已核实为空；无关训练 `162062`、`162163` 及 `162164`–`162167` 不得取消。后续若创建作业，必须再次核对。
- 独立审查服务曾因额度错误中断；最新续接已恢复三位子代理的只读公开资产调研。不要把服务恢复或自审失败算成验收通过。

## 用户最新制作方向（优先于旧细节列表）

用户明确要求优先采用可公开下载的高模与真实扫描组合，城堡不必是霍格沃兹，任何合适的真实城堡都可以。需要优先解决整个建筑、山体、航天舱段的形体和真实材质，不要继续只增加程序化草叶、噪声或小零件。

2026-09-17 用户亲自检查后再次明确：**只有 NASA 舱段的真实度符合其源资产标准；城堡与雪山另找更真实的公开高模**。NASA 保留作飞船基础，暂停继续加工小仓城与 Jungfrau DEM/正射主方案。城堡要完整建筑、可用近景与清晰侧面；雪山要多角摄影测量侧面颜色，不能把更密的高度网格或近雪 normal 称为解决陡壁拉伸。正在并行核实替代来源的许可与实际下载；高模仍只存离线目录。

### 已完成的公开资产研究

- 小仓城：AVATTA、CC BY 4.0，88MB GLB，实际 1,460,392 三角面与 8K 图；来源/署名已核实。裁切 r1 + Poly Haven `coastal_cliff_04`（实际 1,537,926 三角面、8K PBR）在 A800 作业 `164268` 完成，主代理与来源代理均看到悬空、长封口三角和附楼破面。r2 仅生成/上传未渲染，现暂停。详见 `docs/public-castle-assets.md`。
- 城堡新方向：用户明确淘汰 Bodiam 和 Upnor，认为它们不够真实或太像堡垒。2026-09-18 本地筛选出的首选是 LZCreation 的 Hohenzollern Castle（UID `e846059e2d624910b4913d73899e4e3d`，CC BY 4.0，官方统计 461,176 面、230,461 顶点、1 张纹理），尖塔和宫殿式立面更符合目标。用户已完成官方 Sketchfab 登录下载；原始 ZIP SHA-256 为 `9a61ad10605486c0758929e8924d6048610621b97c04564e0262e215b957fde9`，OBJ SHA-256 为 `e9c9a60fbfbe53af1eb0cd4ad8accb0186ff5f30aa89b29c32e3b33802e1ccd7`，16K 纹理 SHA-256 为 `c4f0d5b4fca61e2e71ad8956295d8df17e9363d93b9d68524cc85f69004b5603`。A800 `166002` 轴向错误；`166009` 轴向修正后城堡直立但仍有融合植被/黑色地块和扫描边界；`166051` 底部裁切仍失败；`166086` 低壳删除暴露开放三角孔，已拒绝；`166094` 正在审查真实岩壁纹理裙座方案。当前仍未安装或验收，详见 `docs/public-castle-assets.md`。
- 城堡备选筛选：Château de la Bretesche、Moszna、Grafenegg、Dona Chica、Bojnice 预览已保存；其中 Bojnice 轮廓最漂亮但为 CC BY-NC-SA，Bretesche 为 CC BY-NC 且地块偏软，均未下载。不能按面数或“可下载”直接安装。
- Tapado 2024 低机位审计发现原 near-feature target 被前侧雪脊遮挡；修正首击目标为 `[-28.89153350, 60.42109933, -43.70836640]`，旧目标只作遮挡对照。仍未提交 GPU、未安装、不能称完整雪山或照片级通过。
- 雪山：swisstopo Jungfrau 3km DSM/航片共 18 原 TIFF、474MB，官方哈希一致；衍生 6,480,000 三角面、9张4K图。A800 r1 `164267`、r2 `164273` 均完成；真实轮廓比旧程序山改善，但陡壁航片竖拉、北方灰空严重，仍 FAIL。r2 近雪 PBR 确有微细节，不能弥补源数据缺侧面。r19 A800 `166102` 以观测点实测高程归零，移除 `_summit_shoulder` 人工平台并完成晴天/黄昏及原生近景；旧圆形凹坑消失，但山肩过度平滑、积雪横带和高度场陡壁问题仍 FAIL。9km 环区另下144份DEM/RGB、92MB；当前混年DSM/DTM接边有最高54.74m人工改高，不推荐渲染。详见 `docs/public-snow-assets.md`。
- NASA：官方 ISS Internal (E) 315.6MB FBX、97内嵌图（91张4K），实际265 mesh、474,527三角面、41材质；物理单位未标定。`164261` 导入、`164271` 五视图、`164545` 三窗诊断均 COMPLETED。US Lab/Columbus 可作为真实舱体基础；Cupola 隐藏7原窗盖及玻璃后形成独立 RGBA 天空开口。用户源资产认可不等于全场景连续验收通过。详见 `docs/public-space-assets.md`。
- 旧NASA作业 `162212`/`162218` 虽Slurm显示COMPLETED，Python实际失败；保留失败记录。Jungfrau首次 `164256` 因上传未完hash拒绝而FAILED，完成上传核hash后才提交 `164267`。
- `.render-work/public-snow-study-20260916-r2/{local,review}`、`.render-work/nasa-inspect-20260916-r{2,3}` 保存本地图；远端隔离目录内还有 packed blend、完整证据和源快照。不要覆盖失败版本。
- 本任务作业截至 `164545` 全部结束，最近队列只有无关训练 `164021`；未取消无关作业。新任务提交后必须重新核实，不沿用该空队列结论。

## 已加入的公开资源

所有资源来自 Poly Haven CC0 1.0，并记录在 `assets/life/models/manifest.json`：

- `modular_fort_01`：城堡/堡垒模块。
- `large_castle_door`：城堡门。
- `mountainside`：高模山体岩壁。
- `rock_07`、`rock_09`、`rock_moss_set_01`：岩石高模。
- `modular_factory_facade`：废土城市工业建筑立面。
- `modular_electricity_poles`：城市电力杆和线缆组件。

下载脚本为 `scripts/fetch-world-models.cjs`，支持尺寸、MD5、SHA-256、来源和许可证记录。不要抓取授权不明的 Sketchfab 或游戏提取模型。

## 已完成的代码能力

- `scripts/render-world-panorama.py` 和 `scripts/validate-render-inputs.py` 支持本地 glTF 自动选择 `8K → 4K → 2K → 1K`。
- 浏览器运行时仍优先轻量模型；高模只用于离线 Blender/Cycles 渲染。
- `scripts/refine-castle.py` 正确处理 22 个展示模块的 Z-up 和各自原点，重建加大后的校园、城墙和堡塔；检查基础、真实模块凸包、门叶/圆拱、窗洞和封山。窗洞 BVH 已统一世界坐标，不能改回对象空间。
- `scripts/refine-highlands.py` 扩大匹配岛基，统一全桥石材/UV/截面，修正亮白圆石，远地 PBR 按距离渐退高频重复。
- `scripts/refine-city-industrial.py` 新接入三个砖厂、735 个立面模块、五根电杆和九股沿街导线；接地基准必须取真实街面 `z=-0.025`，端点接触不能仅凭包围盒判断。
- `scripts/refine-terrain.py` 移除 DEM 截顶、平台保护和相机圆形零位移，保留固定观察点零地面高度；`ground_props` 在最终网格上接地。不要恢复已删的人工凹坑制造逻辑。
- `scripts/refine-cockpit.py` 重建大控制台、分离前板/后屏承台、设备底座及内衬；r15 新增真实 31°防滑脚踏、地板接触与连杆验证，转正后方唯一铭牌并固定到原门楣。原后部天空开口保留。
- `scripts/render-review-isolated.slurm` 在版本隔离目录执行全景和可选 `native-queue.json`；`scripts/render-review-views.py` 从保存 blend 实际渲染 1600×1100 透视图，可加晴天/黄昏诊断全景。
- `scripts/create-world-review.py` 生成六向/局部投影及哈希证据；夜背景是占位，原生图在 `native` 中。城市正确厂房视角为约 316°/40°，270°/90°实际上拍高楼/棚内。
- `assets/life/scripts/21-world-outdoors.js` 已让岩石在运行时尝试使用 `rock_07`/`rock_09` 变体；没有 1K 资源时应保持 fallback 正常。

## 下一步优先级

用户最新要求优先接入 NASA。接入代码和本地预览现已具备，接下来先处理此次三相完整全景审查中的前后舱光照与后舱顶部黑区，补真实浏览器星空/星座/切换验证；不要退回只看单张源资产图。`.22` 是美术缩放而非物理尺寸标定，四盏补光为作者设置。材质使用 repair-only，没有启用粗糙度映射对照。城堡和雪山仍未获准安装，以下四场景列表属于持续目标。

1. 继续处理城堡整体构图、草地、岛岸和重复桥墩/山脊；先读取 r17 原生近景结论，不要重复修已消除问题。
2. 工厂/电杆接入已完成；城市优先重构重复高楼及相同 U 形破口、远端城市纵深、锯齿屋顶和地面碎石分布。
3. 雪山旧凹坑已去掉；优先真实山体岩雪层次、悬挑扫描岩体与积雪方向、背景下半球拉伸及道具接触细节。
4. 飞船先读 `docs/review-20260922-nasa-integration.md` 和对应三相六向/原生图，继续改善 NASA 基础舱的光照、大表面材质与结构可信度，保持驾驶位及天空可见性；r15 程序舱属于历史参考。
5. 每个版本都用真实六向、近景、晴天/黄昏图审查；不合格版本不安装 manifest。
6. 只有连续两轮独立审查均无明显视觉/交互问题，才允许更新 manifest 并宣布照片级完成；本轮禁止按历史惯例仅作 review baseline 安装。

## GPU 使用方式

服务器：`paracloud-Zhongwei1`，A800 分区 `hp_a800`。已完整阅读 `/data/home/scwb515/run/yangrunde/使用方法.txt`；用户原来指定的更深目录没有该文件。登录节点只查看、编辑、编译、传输和提交作业，计算必须在分配节点。优先 `sbatch`。每次只取消自己创建的 job，并在完成后执行：

```bash
ssh paracloud-Zhongwei1 "squeue -u scwb515 -o '%i %j %T %M %L %N'"
```

确认本任务队列为空后再结束。远端渲染根目录通常为 `/data/home/scwb515/run/yangrunde/life_worlds`，但该路径可能解析到 `/data/run01/...`。

本轮目录为远端 `.render-work/review-20260914-*`；本地六向和近景在 `.render-work/review-20260914/`，原始 PNG 在 `.render-work/remote/`。旧失败版全部保留。城市 `161994` 为 TIMEOUT，但三组全景实际完整保存；后续 `162012`/`162027` 使用其已有 blend 补完原生近景，无需再次全量重建。

## 验证命令

```powershell
python scripts/validate-render-inputs-tests.py
python -m py_compile scripts/refine-*.py scripts/render-world-panorama.py
node scripts/validate-life-runtime.cjs
node scripts/validate-night-worlds.cjs
git diff --check
```

## 重要工作区规则

- 当前工作树是有意保留的 dirty worktree，不要 `git reset --hard`、`git clean` 或删除用户改动。
- 不要把“渲染完成”表述成“照片级完成”。
- 不要未经视觉审查就替换 `assets/life/panoramas/manifest.json`。
- 用户之前提到过 push，但当前交接的首要任务仍是继续高模、渲染和审查；提交/push 前先检查改动范围。

## 2026-09-21 续接状态

- 城市 r13 A800 `167943` 已完成并取回；独立复审晴天/黄昏六向及 12 张原生近景均 **FAIL**。砖厂材质局部可用，但楼体仍是规则方盒阵列，远端纵深灰空，735 个工厂模块、5 根电杆/9 跨导线和火堆仍有明显程序化重复或接触问题。详情见 `docs/review-20260921-city-r13.md`。
- NASA r5 对照 `167947` 已由独立代理复核：原始→repair-only 恢复了源显示器贴图，repair-only→authored 只有局部反光变化；暗舱、窗框分段和贴图平面化仍 **FAIL**。详情追加在 `docs/review-20260921-nasa-r4.md`。
- Tapado 2024、Hohenzollern r7/r8 已完成独立审图，均 **FAIL**；文档已更正作业节点、图像来源和审查范围。当前边界诊断脚本未用来重渲染城堡，不得用旧图证明新脚本视觉通过。
- Tapado 2019 五百万面局部冰川 A800 `168086` 已完成；22 张图哈希/尺寸通过，主代理自审 **FAIL**，尚无该版本单独的子代理审查记录。近景冰雪尖塔比 2024 丰富，但孤立扫描块缺少连续远峰，近雪仍有平滑大面和三角折棱。详情见 `docs/review-20260921-tapado-2019.md`。
- 本轮没有安装新全景、没有修改 manifest；连续照片级验收轮数仍为 `0`。本任务自建作业 `168086` 已结束，远端 `squeue` 只剩无关训练 `167803`，不得取消。
