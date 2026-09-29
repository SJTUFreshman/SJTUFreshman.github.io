# Life 成品场景替换记录（2026-09-28）

用户要求以本机三个成品资源替换雪山、废土城市和城堡，保留飞船并重新下载 NASA 原模。成品地景保留作者几何与材质，只选择摄影机和烘焙设置。引擎及渲染仅在 `paracloud-Zhongwei1`，本机不安装 Unreal。

## 原始输入

| 场景 | 原包 | 大小（字节） | SHA-256 | 实测版本 |
| --- | --- | ---: | --- | --- |
| 雪山 | Snowy Mountains Landscape.rar | 653965355 | `09766479715126207556675c91e637d2b6a2d4ea9d03bf96ffcf2d3267341d55` | 主地图 4.19.2；素材样本 4.16.2，无 uproject |
| 废土城市 | ProjectsCity.rar | 4530403281 | `e6af0625e35a10f39b195579e7874616a30ffe76a136b84f49a4d4d51f95202e` | uproject 5.5，素材样本 5.5.4 |
| 圣米歇尔喷泉 | FontaineSaintMichel.rar | 12896868620 | `1809d554f6be5349b8a9b92cd9fb39d143e8012b64431c1ff89a8d6a35dee9cb` | uproject 5.6；部分旧素材 5.4.4 |

NASA 新下载 FBX 为 315560604 字节，SHA-256 `bb884b3f5fdae3fe6116bd2241b44e8efb2f804de8785840431f400ebfa09816`，与旧源一致；旧光照、缩放和开窗发生在派生场景。完整来源和下载证据见 `nasa-original-refresh-20260927.md`。

本地索引脚本：`scripts/inspect-authored-worlds.py`。本地 Windows bsdtar 不支持加密雪山 RAR；已在服务器使用官方 7-Zip 26.03 解压并读取原始地图包头，解决版本核查。三份原始 RAR 均已上传、SHA-256 校验并成功解压，未修改原包。

## 工作目录与地图

本地操作和证据目录为 `.render-work/authored-worlds-20260927/`；目录名沿用启动标签，实际执行日期为 2026-09-28。远端对应目录：

`/data/run01/scwb515/yangrunde/life_worlds/.render-work/authored-worlds-20260927/`

- `archives/`：原始包及新 NASA FBX。
- `sources/`：解压工作副本；原始描述文件保留，另建 `LifeAuthoredReview.uproject` 启用 Python、Sequencer、Movie Render Queue 和 glTF 导出插件。
- `metadata/`：源版本、哈希、解压记录和工作描述文件。
- `gpu-preflight/`：真实 A800 Vulkan 测试及作业证据。

应加载作者实际地图，不能盲目使用 GameDefaultMap（两个项目都可能指向引擎模板）：

- 雪山：`/Game/SnowyMountains/Maps/Overview/Overview`。
- 城市：`/Game/The_Projects/Levels/The_Projects_WP_Demonstration`，需核查 World Partition 全场景加载；`Startup_Level` 用于作者入口检查。
- 喷泉：`/Game/Paris/Demo/Maps/L_Paris_01_01_P`，保留作者流送子关卡、PCG 和光照。

用户于制作过程中提供巴黎机位参考：广场近侧树下正对喷泉，完整纪念碑居中，前景保留自行车和栏杆，右侧报刊柱、红篷与树围作为框景。参考文件保存在 `.render-work/authored-worlds-20260927/references/fontainesaintmichel-user-viewpoint.png`。最终机位应以原生画面匹配该区域，不能直接采用远处 PlayerStart 或仅凭 actor 名称确认构图。

已确认的巴黎机位是 `Fontaine-bike-square-front`：UE 位置 `[2242.742329, 2392.499975, 168.371211]` cm，偏航 `-112.248039`°、俯仰 `4.693729`°，来源为作者场景中的 `BPP_SideWalk_01_01_C_152`。原生画面已保留喷泉主体、自行车、树围、报刊柱和红色篷顶，作为后续六面渲染的唯一默认观察点。首轮 Vulkan 设备丢失通过关闭独立提交线程和 RHI bypass 复测成功，未修改源材质或灯光。

雪山的 UE4 地形材质包含 tessellation/displacement 相关函数，不能仅以 UE5 成功打开就宣布外观等价。应检查导入警告、纹理及实际画面，需要时使用兼容引擎制作。

## 引擎与服务器

已读取实际使用说明 `/data/home/scwb515/run/yangrunde/使用方法.txt`。用户指定的深层同名文件不存在。所有作业使用有时限 `sbatch`，不使用 `salloc`，只清理本任务作业。

SSH 别名可能进入不同登录节点：`ln01` 可联网，`ln02` 某些域名解析失败；下载安装经登录节点 `ln01`，计算经分配节点。引擎来自用户登录并自行接受 EULA 后的 Epic 官方 Linux 下载页，版本 5.5.4 / 5.6.1。下载时的签名 URL 仅放忽略目录，不进入版本控制。

引擎目标目录为 `/data/run01/scwb515/yangrunde/life_worlds/tools/unreal-5.5.4` 和 `unreal-5.6.1`。分段下载、安装和检查脚本在工作目录中；下载完成不等于安装或渲染成功。

A800 预检作业 `175186` 在 `d1n41a18g03` 4 秒完成，退出 `0:0`。NVIDIA A800-SXM4-80GB，驱动 590.48.01，真实 Vulkan 图形队列；descriptor indexing、64-bit shader atomics、acceleration structure 和 ray tracing pipeline 特性通过。`VK_KHR_ray_query` 未提供；尚需实际 Unreal offscreen 初始化测试，不能以该探测替代引擎渲染验证。

## 场景交付边界

当前处于迁移中的工作副本：HTML 已移除旧程序化 builder，菜单/manifest 已移除城堡并增加喷泉；NASA 探索导出及由 16K 母版生成的 2K/4K/8K/12K 全景已安装。雪山 175955 和巴黎 175946 已完成六面 4096²、64 samples 原生渲染，两者均已从 EXR 派生的 16K RGBA16 母版安装 2K/4K/8K/12K 全景评审档，保留作者天空。城市仍引用迁移前全景，新候选机位需要重选。三个 Unreal 场景的探索导出和浏览器最终验收未完成，不可将当前工作副本视为完成交付。

提交时的最新作业状态：城市全量 glTF 导出 175964 和巴黎探索重试 176081 已按用户优先级停止。城市固定视角探针 176088 在 24 分 23 秒后以 `FAILED`、`11:0` 结束，输出尚未检查，不能据此认定新的城市全景可用。当前保留已有城市全景；普通地景探索不再阻塞固定机位交付。

雪山原生 `CameraActor_1` 的源画面在临时移除 `MI_Sharpen` 并充分预热后恢复正常；保留该旧版后处理会重现蓝色条纹，因此这是渲染兼容诊断设置，不能改写源地图。175758 三面 Deferred 探针的 alpha 有变化，但 EV10 的 RGB 过暗，不能直接扩大为最终六面。先前按 alpha 阈值自动选择的样本只证明数值范围，未独立证明天空、实体和边缘的语义；`alphaConventionVerified` 仍为 false。后续需同视角原图校准曝光、六面拼接和边缘复核。

巴黎 175923 在同一 EV6、位置和三个方向下比较关闭 holdout、全部天空 holdout 和仅天空网格 holdout，并保留浮点 EXR。全部 holdout 时实体地面 alpha 中位数为 0.99560547，PNG 中对应 254；关闭 holdout 和仅网格 holdout 的该地面为 1，证明这来自雾的大气透射，不能把 254 强行归一为 255。将 MRQ 图重投影到作者预览的同方向和 70° 视野后，明暗关系相近，未发现整体照明丢失；不能仅凭不同 cube 方向的观感继续调亮。正在验证原生 MRQ stencil layer 是否能保留完整照明并给出独立地景遮罩。用户允许酌情选择天空；若半透明边缘无法可靠分离，保留作者完整天空也是可接受的观景路径。

城市 175754 的完整 Gameplay actor 枚举仍只有部分 World Partition 覆盖：7728 个 Gameplay actors、6019 个 Outliner actors，另有 1709 个未出现在 Outliner 的 actor；1160 个 Packed actors 包含 22075 个组件和 109550 个实例。四张候选图均出现破碎地面或漂浮建筑，因此不进入导出或 manifest。

进一步核对原生引擎源码发现，`WorldPartitionBlueprintLibrary.get_actor_descs()` 递归返回子容器叶节点，而 `load_actors()` 只在根 World Partition 解析 GUID。旧表中的 37146 行仅有 9593 个源 GUID，3485 个未匹配源身份全部来自子容器；这些数字不能称为缺失实例数。原生形状区域加载桥及按容器/实例 GUID 的完整已加载关卡审计在 175934 编译成功；175936 首次运行因在 LevelInstance 尚未注册有效 ID 时触发引擎断言而停止，完整日志和 before 审计已保留。修复后的 175953 bridge 增加引擎帧节流、World Partition streaming-busy gate 和 `HasValidLevelInstanceID` 检查。175954 已通过加载稳定门禁（pending=0、stable=56s），保存完整 after 审计和截图，然后在退出时 segmentation fault；不能把整个作业记作正常退出。最新分类器从原始 native-after 重算得到 40757 个跨 partition 描述身份，40597 个匹配已加载实例、160 个非 editor-relevant、0 个未解决；对应不同实际 actor 路径仍是 38864，不把重复 partition 视角计成更多 actor。中央北向截图实际是店铺窗户近景，不能作为最终街景；175964 只进行未验收的原生 glTF 诊断导出，最终六面须重新选择并验证机位。

雪山六面 PNG 和 EXR 的 alpha 均为完全不透明，EXR 转 sRGB 后的抽样 RGB 与配对 PNG 差值小于一个 8-bit 级别；转换未裁剪 RGB。12 条 cube 边界的匹配射线亮度差中位数为 0.00083–0.00423，P95 为 0.0052–0.01354，alpha 差为 0；人工查看接缝图未见明显直线断层。母版来自原生 EXR→RGBA16，再做线性光采样；不是从 PNG8 扩成 16-bit。最终采用完整作者天空，variant 标注 `background: authored-sky`，删除旧的 clear/dusk 假定组合，只保留实际渲染的 clear。观察位置使用真实 UE→Three `(X,Z,Y)*0.01`，即 `[-1453.87921875,267.9392578125,1283.8560937500001]`；导航 yaw 为 `0.687694705906684`，pitch 为 0。175979 的 16K 母版已完成，781611626 字节，本机与服务器 SHA-256 均为 `829547e52751fd97d490588e2b308b153ce735657884f4dc8224e3e4f30b49a9`，alpha 全为 65535；已替换此前 8K 母版派生档位。

巴黎 175946 六面 beauty 与独立 foreground EXR/PNG 已齐。175974 后处理因远端 OpenCV EXR 解码不可用退出，保留失败目录；改用官方 OpenEXR 解码后由 175977 完成 16K 母版，无需重渲染。母版 710766583 字节，SHA-256 为 `f2343b35723f3435944a2e7166f9671b07018ca66512f2bdc60e74d3fb9944f1`，alpha 全为 65535。12 边接缝已复核，对三条高差异树冠边另查 2048 像素投影的完整接缝和两端，未见明显建筑、树干断裂或天空色带；局部枝叶差异仍存在，不能声称逐像素一致或证明时间同步。完整 beauty 已安装为默认观景，时段保留实际作者光照子层 `L_ParisLighting_01_03_Sunset` 对应的 dusk。stencil foreground 只保留为独立辅助层，不能据此推断所有半透明材质合成正确。

巴黎探索作业 175976 在原生导出前因嵌套 LevelInstance 缺少权威可见性证据停止；这不证明源内容缺失。新增只读 `LifeLevelVisibilityBridge` 直接读取 `ULevel::bIsVisible` 和 pending 状态，覆盖完整关卡枚举及 editor/active actor 所属层，并与顶层 streaming 状态交叉核对，移除此前对 persistent level 直接设为 true 的假定。175989 使用 UE5.6.1 配套 v25 SDK 编译成功，插件和引擎 BuildId 均为 43139311；随后导出在现成网格缺少 MeshDescription 处触发 Unreal glTF 原生崩溃，改用 RenderData 路径的重试已停止。普通地景探索不是当前交付优先级，因此不继续消耗服务器时间，也不把未完成 glTF 写入 manifest。

安装后从清单实际引用的 8K WebP 按真实 observation 重建了雪山与巴黎默认视角，文件及哈希证据位于 `.render-work/authored-worlds-20260927/installed-panorama-review/`。已查看两张图，画面朝向和选定构图一致。全景方向、校准、运行时及 HTML 生成检查通过；浏览器接口重试仍返回 `unsupported Codex auth method: apikey`，所以这些离线检查不替代浏览器交互验收。

根据当前优先级，固定机位是普通地景的主要交付；普通地景探索即使作者源场景本身可走动，也不再等待全量 glTF 导出。NASA 飞船保留独立的实时探索：舱内使用用户设备 GPU 失重漂浮，默认舷窗位置就是驾驶位，`W/S` 俯仰、`A/D` 偏航、`Q/E` 翻滚、`Shift/Ctrl` 油门、空格制动，`F` 离开驾驶位；切换模式会保留飞船姿态、位置、速度和油门。`scripts/validate-night-worlds.cjs` 已覆盖默认驾驶、姿态、持续位移、离开驾驶位和返回重置。

雪山地形覆盖 8128 × 8128 米、1024 个组件，每组件 254 米。完整 LOD0 约 1.32 亿三角形，一张 16K 整景纹理约每像素 0.496 米，不能等同作者近景细节。175939 已实际导出观察点最近组件及四个相邻块的 LOD0/2/3/4 二进制几何和 1024/2048 基色；5 块所有 LOD0/2/4 位置边界重合，LOD3 最大边界误差约 1.53 微米，法线长度误差低于 6e-8。主块 LOD2 为 7,688 三角形，与 LOD0 相同 XY 采样点的高度偏差 p95 约 0.162 米、最大约 0.574 米；LOD3 最大约 1.231 米，不能把粗 LOD 当近景精度。原生基色探针与 component material bake 逐像素一致；world-normal 同 XY 方向点积中位约 0.999，证明行列方向可用，但仍未完成 Three/glTF 最终 UV 和光照复现。175943 编译了新版材质桥，175944 完成自动曝光、EV0/2/4/6 对照及五通道 PBR 探针；EV0 保留雪面与云层细节，正式六面 175955 已提交。全景观察点在地面上约 72.09 米，探索出生点另取真实地面上 1.7 米，不能直接沿用悬空机位。

最终应保留 `spaceship`、`shelter`、`snowmountain` ID，以 `fontainesaintmichel` 替换 `hogwarts`；废弃旧城堡和旧地景运行时入口。观景只加载全景，探索必须对应新的真实模型，不能继续指向旧代理场景。

新增 `25-authored-worlds.js` 已接入 HTML：整景 glTF 保持原始变换，按需加载并提供真实地面/墙体检测；运行时等待加载，失败返回观景。碰撞缓存保存在场景局部坐标，支持飞船外层姿态变换；原模自身动画的碰撞不在范围内。`navigation: float` 使用扫掠球与三角形 BVH，`walk` 检查地表坡度、台阶、悬崖和顶棚。数值及异步切换回归在 `validate-authored-worlds.cjs`、`validate-authored-runtime.cjs`。

NASA 独立导出作业 `175277`：257 个可见源对象、40 个 glTF 材质、97 张纹理，281049873 字节。Three.js 按 primitive 拆为 331 个网格、467705 个三角形；独立 accessor/变换检查证明 `export_yup=False` 保留源 XYZ。实际模型 BVH 精确分配 157103 节点，约 34.54 MiB，初始化约一秒（本机 CPU 测量，不等于浏览器 GPU 验收）。原始坐标未标定为米，因此 HUD 不显示米制距离/速度。

NASA 浏览器照明使用三盏原渲染面光的源位置、方向、颜色和功率数值；圆形面光转换为等面积矩形。Three.js 与 Cycles 的光照单位/间接照明不同，不能宣称数值相同即画面相同；浏览器实际外观仍待验收。

NASA 原模在本地浏览器已实际显示七面透明舷窗、原始材质及面光，漂浮移动和返回舷窗入口正常，没有页面错误；原始窗玻璃以不可见碰撞网格接入，静态导出无 skin，逐顶点误差约 4.06e−6 源单位。最终全景接入后的浏览器复查因浏览器接口中断尚未完成，不能用前一次原模验收替代。切换探索时会关闭本世界拥有的 ImageBitmap，保留声明为共享的图片，避免重复切换累积解码图片内存。

引擎安装已完成，5.5.4 ZIP SHA256 `e20acd77e6caad42ee1bf0df1cb4c5077ceb1350817cfdacb554f4a594710383`；5.6.1 为 `60cbb9942827ba15600452818f497fde96cb4568fa8f07e688dad8185acc3a81`。依赖检查均无缺失库。首次启动因默认 Zen DDC 无可写节点失败；当前检查采用 `InstalledNoZenLocalFallback` 文件缓存及分作业 XDG 配置目录。作业记录保存在服务器 metadata，需继续检查真实地图输出。

离线全景仍需满足 2:1、固定一致机位、轴向校准、透明天空遮罩和原星座命中。原始高分辨率母版独立保存；浏览器分档资源受纹理尺寸与格式限制。每个机位必须检查六方向、极点、接缝和近景。选定机位以前不得把旧坐标当作新素材默认坐标。
