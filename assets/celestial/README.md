# 天体近景纹理：来源、许可与真实性边界

本目录保存 `life.html` 天体近景所用的静态纹理。为避免仓库重复存放大型源文件，
这里只保留面向网页加载的派生文件，并在下方记录可复现的上游直链。除土星环外，
纹理均为等距圆柱投影（equirectangular，宽高比 2:1）。

这些资源用于明确标注的“放大近景”，不代表访客在当时、当地以肉眼能够看到的
天体角尺寸，也不是实时望远镜或航天器影像。

## 资产清单

| 网页资产 | 上游来源与 credit | 网页化修改 |
| --- | --- | --- |
| `moon.webp` | Solar System Scope 2K Moon | JPEG 转高质量 WebP；保持 2048×1024 |
| `mercury.webp` | Solar System Scope 2K Mercury | JPEG 转 WebP；保持 2048×1024 |
| `venus.webp` | Solar System Scope 2K Venus Atmosphere | JPEG 转 WebP；保持 2048×1024 |
| `earth.webp` | NASA Earth Observatory / Blue Marble，land_ocean_ice_2048 | JPEG 转 WebP，quality 90；保持 2048×1024 |
| `mars.webp` | Solar System Scope 2K Mars | JPEG 转 WebP；保持 2048×1024 |
| `jupiter.webp` | Solar System Scope 2K Jupiter | JPEG 转 WebP；保持 2048×1024 |
| `saturn.webp` | Solar System Scope 2K Saturn | JPEG 转 WebP；保持 2048×1024 |
| `sun.webp` | Solar System Scope 2K Sun | JPEG 转 WebP；保持 2048×1024 |
| `uranus.webp` | NASA VTAD Uranus 3D Model 的 1024×512 内嵌纹理 | 从官方 GLB 提取并转 WebP |
| `neptune.webp` | NASA VTAD Neptune 3D Model 的 1024×512 内嵌纹理 | 从官方 GLB 提取并转 WebP |
| `pluto.webp` | NASA VTAD Pluto 3D Model 的 4096×2048 内嵌 New Horizons 全球色图；NASA/JHUAPL/SwRI | 从官方 GLB 提取；缩至 2048×1024；转 WebP |
| `saturn-ring.png` | NASA VTAD Saturn 3D Model 的 4096×16 内嵌环纹理 | 从官方 GLB 提取；缩至网页渲染使用的 2048×8 PNG 径向条带 |

WebP、缩放和土星环条带均属于本项目为降低网络传输与解码成本所作的格式/尺寸
调整；没有将这些派生文件重新声明为新的独占作品或新许可。

## Solar System Scope 纹理

月亮、水星、金星、火星、木星、土星和太阳取自 Solar System Scope 的免费 2K
纹理包：

- 纹理主页：[Solar Textures](https://www.solarsystemscope.com/textures/)
- 月亮：[2k_moon.jpg](https://genesis-horizon.solarsystemscope.com/textures/download/2k_moon.jpg)
- 水星：[2k_mercury.jpg](https://genesis-horizon.solarsystemscope.com/textures/download/2k_mercury.jpg)
- 金星云层：[2k_venus_atmosphere.jpg](https://genesis-horizon.solarsystemscope.com/textures/download/2k_venus_atmosphere.jpg)
- 火星：[2k_mars.jpg](https://genesis-horizon.solarsystemscope.com/textures/download/2k_mars.jpg)
- 木星：[2k_jupiter.jpg](https://genesis-horizon.solarsystemscope.com/textures/download/2k_jupiter.jpg)
- 土星：[2k_saturn.jpg](https://genesis-horizon.solarsystemscope.com/textures/download/2k_saturn.jpg)
- 太阳：[2k_sun.jpg](https://genesis-horizon.solarsystemscope.com/textures/download/2k_sun.jpg)

Solar System Scope 说明这些纹理基于 NASA 的高程与影像数据，并参考
MESSENGER、Viking、Cassini 和 Hubble 的影像调色。它们以
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
（CC BY 4.0）发布，允许使用、修改与再分发，但必须保留署名并说明修改。

建议随站点保留的署名文本：

> Moon and planet textures by Solar System Scope, based on NASA elevation and
> imagery data, licensed under CC BY 4.0. Files were converted to WebP at
> their original 2K dimensions and, where applicable, resized/compressed for
> this website.

### 真实性边界

Solar System Scope 明确说明：尚未测绘的区域可能用与周边协调的虚构地形填补，
颜色也为突出各天体特征而略微提高饱和度。因此这些纹理适合可信的交互式可视化，
但不是可用于科学测量的原始数据产品。

- 金星使用的是云层而非雷达地表，因为可见光近景看到的是浓密云层；云纹不是
  当前时刻的真实天气。
- 月球贴图是静态全球表面图；实时计算只负责月相、光照方向、视角大小与朝向，
  不声称呈现当前地球大气造成的瞬时色偏或视宁度。
- 木星和土星的大气带、风暴会持续演化，静态贴图只代表典型外观。
- 太阳贴图只代表典型光球纹理，不包含当前时刻的太阳黑子、耀斑或日珥位置。

## NASA VTAD 模型纹理

地球使用 NASA Earth Observatory 的 Blue Marble 陆地、海洋与冰层合成图：
[2048×1024 原始 JPEG](https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2048.jpg)。
Credit: NASA Goddard Space Flight Center / Reto Stöckli。转换为 WebP，未改变地形。
这是一张静态地表合成图，不包含实时云层。

天王星、海王星、冥王星和土星环来自 NASA Science 3D Resources 中
NASA Visualization Technology Applications and Development（VTAD）发布的
官方可下载模型：

- 天王星：[资源页](https://science.nasa.gov/resource/uranus-3d-model/) ·
  [GLB 下载](https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/u/Uranus_1_51118.glb)
- 海王星：[资源页](https://science.nasa.gov/resource/neptune-3d-model/) ·
  [GLB 下载](https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/n/Neptune_1_49528.glb)
- 冥王星：[资源页与 GLB 下载入口](https://science.nasa.gov/resource/pluto-3d-model/)
- 土星环：[Saturn 3D Model 资源页](https://science.nasa.gov/resource/saturn-3d-model/) ·
  [GLB 下载](https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/s/Saturn_1_120536.glb)

Credit：

> NASA Visualization Technology Applications and Development (VTAD)

[NASA 3D Resources](https://science.nasa.gov/3d-resources/) 门户说明其中资产
可免费下载和使用，并要求遵循
[NASA Images and Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)。
NASA 自行制作的媒体在美国通常属于公有领域，但这不是 CC 许可：NASA 名称、
徽标和标识仍受保护，不得暗示 NASA 为本网站或产品背书；若上游条目另列第三方
credit，仍应保留该 credit。

### 真实性边界

- 这里使用的是 NASA 可视化模型内嵌纹理，不是实时观测数据，也不等于完整的
  辐射定标科学产品。
- 天王星与海王星的可见色会受仪器波段、白平衡、色彩处理和网页显示器影响；
  静态贴图也不会反映当前云层、风暴或季节变化。
- `saturn-ring.png` 是为近景渲染准备的径向视觉条带。它能表达主要明暗环带，
  但不解析所有细环、辐条、瞬时阴影或随观测几何变化的光度；其压缩后的纵向
  尺度不能用于测量土星环的真实厚度。

## 冥王星 New Horizons 全球色图

`pluto.webp` 使用 NASA Pluto 3D Model 内嵌的 4096×2048 全球色图；同一
New Horizons 数据产品另有 5926×2963 的 “Pluto Global Color Map”。该全球拼接图
基于 New Horizons 在 2015 年飞掠冥王星时，由 Ralph/Multispectral Visual
Imaging Camera 取得的三组彩色滤镜影像。

- NASA 原始说明与下载页：
  [Pluto Global Color Map](https://science.nasa.gov/resource/pluto-global-color-map/)
- 本目录留档文件所用的同尺寸镜像：
  [Wikimedia Commons — Pluto color mapmosaic.jpg](https://commons.wikimedia.org/wiki/File:Pluto_color_mapmosaic.jpg)
- Credit：`NASA/JHUAPL/SwRI`
- 许可状态：Wikimedia Commons 将该 NASA 制作文件标记为
  `Public domain in the United States / PD-USGov-NASA`。仍需遵循 NASA
  标识、署名和不得暗示背书等使用条件。

该图是多幅、不同分辨率观测的全球拼接，不是某一瞬间从单一视点拍摄的完整球面
照片；最接近 New Horizons 的半球细节最高，其他区域的信息量与清晰度不均。
网页缩放与有损 WebP 压缩还会进一步舍弃细节，因此只应用于视觉近景，不应用于
地质或测绘分析。

## 使用与维护约定

1. 保留本文件及上述 credit；更新上游资源时同步更新来源链接、尺寸和处理说明。
2. 不把“官方来源”表述成“实时影像”或“严格科学纹理”。近景界面应继续明确
   这是经过放大的可视化。
3. 纹理只描述表面/云层外观。实时位置、可见性、相位、照明方向、自转轴与
   土星环开合角应由天文计算和渲染逻辑决定，不能烘焙进这组静态贴图。
4. 若将来加入第三方处理、艺术补绘或新的数据源，应逐项记录作者、原始链接、
   许可、修改内容和真实性限制。

## 离线预渲染近景

太阳系近景由 `scripts/render-celestial-model.py` 打开用户提供的“太阳系全行星3D模型套装”原始 Blender 工程，保留网格、UV、云层与星环材质，修复贴图路径后在 Blender 4.5.3 LTS / Cycles 中离线烤制。原始模型与纹理留在用户素材目录和指定计算服务器，不随网站分发。模型包没有附带明确的再分发许可；此处仅记录用户提供的素材来源，不将其标记为 NASA 或 Solar System Scope 的公开模型。

这套近景优先保留原包 16384×8192 纹理；月球、火星使用包内 23040×11520 版本。没有因文件体积较小而用低分辨率纹理覆盖这些资源。上文 NASA / Solar System Scope 的来源说明继续适用于原有独立贴图，不适用于本节用户提供的模型。

主要调整是掠射主光、云层起伏、太阳重复表面清理，以及随原始扁球形状变化的大气薄壳。大气内缘保留薄雾，外缘按高度指数衰减至黑色太空；月球、水星不添加大气。旋转沿原模型自转轴进行，避免轴倾角在自动旋转时摆动。

海王星原色图在极点存在经度收束尖角。`scripts/prepare-celestial-polar-texture.py` 用 Pillow / NumPy 生成独立派生图：只在南北各 3.6° 范围内以平滑曲线向同纬度平均色过渡，其余像素保持原样，原文件不修改。将派生图命名为 `Derived/Neptune color map.png` 并附同名 JSON；渲染器优先读取 `Derived`，把处理范围和原图/派生图 SHA256 写入渲染记录。

此前发布的 v2 烤制规格为每颗星体 180 个方位角（间隔 2°）× 7 个俯仰角（−90° 至 +90°，间隔 30°），每张均为 3840×2160、Cycles 64 samples、WebP quality 90。十颗共 12,600 张，画面本身已经裁切为局部近景；旧版使用水平邻帧淡变，垂直选择最近的已烤视角。光照固定，不表示实时观测、当前天气或当前月相。

#### 完整球体烤制规格（v4）

新版样片可使用 `scripts/render-celestial-full-sphere.slurm` 和
`scripts/render-celestial-model.py --framing full-sphere`：输出包含整颗球体及安全边距的
4096×4096 方形 RGBA 帧，`render*.json` 的 `presentation` 记录归一化 `sphereRect`、正交投影、每个
俯仰角的 `spinAxes`，以及可选的独立 `clouds`、`rings` 帧路径。云层不烤进地表，播放器可以单独
快速移动云层；`cloudShadows: not-baked-into-surface` 的含义是地表不会出现与云层运动
不同步的固定云影，代价是此层暂不提供随云实时变化的投影阴影。`sphereRect` 描述实体球，
不包含大气晕或星环，播放器据此按屏幕宽高比安全取景。星环使用每个俯仰角一张独立帧，
避免表面自转造成星环变形。云层按独立、更快的经度相位移动，并叠加纬度相关风场扭曲。打包器会拒绝不透明、触碰边界或缺少完整视角网格的帧，
并将附加层作为独立可校验资源发布。

网页按需加载烘焙图片，使用轻量 WebGL 球面重投影实现相邻方位角之间的连续运动，
不运行原始模型、材质或实时光照。地表与静态云层各使用一张纹理，方位角之间以重投影衔接；
具有气候时间序列的云层默认只显示最近的一个时间帧，并在球面纬度方向施加局部风场扭曲，
因此运动连续且不会把两个时刻叠成虚影。只有同时显式设置 `allowTemporalBlend: true` 和
`interpolation: crossfade` 才会读取相邻时间帧进行预乘透明度混合。
星空依据已有 Hipparcos 星表投影，随拖动的相机方向变化，自转时保持固定。
GPU 不可用或上下文丢失时仍可用 Canvas2D 查看已烘焙的完整帧。

近景按星体分别设置球缘位置、半径与上下偏移：岩质天体更靠近表面，太阳与气态行星
保留较多星空，土星与天王星为星环预留空间。桌面构图以说明面板之外的实际可见区域
为基准，面板换边时镜像取景；手机使用上方 55% 画面独立取景。面板尺寸、开合与换边
通过事件更新布局缓存，动画帧不重复读取 DOM 布局。完整球体仍保留在资源里，近距离
裁切会放大源纹理，不能将屏幕的 4K 画布尺寸等同于原生 4K 地表细节。
星环层可使用独立的烘焙相机，以 `ringSphereRect` 记录同一实体球在星环帧内的位置和
尺寸；播放器据此与地表对齐，使地表能使用更紧凑的完整球体画幅，同时保留完整星环。
图片解码和浏览器合成仍使用系统资源；小屏按实际显示像素解码，缓存数量受内存预算限制。
自动旋转、暂停、鼠标/触屏拖动和方向键均由图片查看器负责。
重投影使用球面近似，烘焙光照与地形细节在切换源帧时仍可能有少量差异；俯仰仍选择最近的
30° 烘焙视角。旧版不透明帧保留原有播放逻辑，直到新版完整清单通过验证后才切换。

#### 气候时间序列（v6）

地球等具有动态天气的天体可以把云层作为时间序列发布。云层路径使用固定的时间目录：
`earth/clouds/t{time}/e{elevation}/a{azimuth}.webp`，其中 `time` 从 `000` 开始补足三位；
每个时间点仍包含完整的俯仰×方位网格。渲染记录的 `presentation.climate` 至少包含
`frameCount`，可同时声明 `model`、`simulation`、`timeStepSeconds`、`loopSeconds`、
`stepHours`、`periodHours`、`timeUnit`、`timeOrigin`、`source`、`surfaceReuse`、
`interpolation`、`windModel`、`densityModel`、`shadowMode`、`timePad` 和 `description`。其中
`timePad` 为时间目录的数字补零宽度（`0`–`6`，默认 `3`）；`allowTemporalBlend` 和
`localWarp` 只用于明确控制播放器行为，默认关闭跨帧混合并启用局部风场扭曲。当同时声明
`timeStepSeconds` 与 `loopSeconds` 时，后者必须等于 `frameCount × timeStepSeconds`。
渲染器也可以在每个分片的顶层 `climate` 记录 `timeIndex`；打包器会收集这些索引，
补齐 `frameCount` 与 `timeIndices`，并把旧的静态云模式升级为时间目录模式。

旧版 `earth/clouds/e{elevation}/a{azimuth}.webp` 清单继续有效；只有出现 `{time}` 时才
要求 climate 元数据和全部时间帧。时间序列的每个分辨率层沿用相同的 `t{time}` 目录结构，
发布器会把 climate 元数据、时间模式和每一帧的 SHA256 一并写入本地及托管清单。
当前气候烘焙批处理默认覆盖 `earth` 与 `mars`（通过 `CLIMATE_BODIES` 可扩展到其他
具有云层的天体）；没有动态云资源的天体继续使用 v5 静态云层或表面帧。
动态云层母版默认按 2048×2048 烘焙，地表仍保留 8K 母版；打包器会按清单生成 2K、4K
云层档位，避免为透明云层重复承担 8K 渲染和下载成本。

`generate-celestial-climate.py` 的 v2.1 使用周期性纬向喷流、南北形变和密度生消生成
视觉关键帧。地球与火星通过 `--body` 使用各自的云量、纬带配置；这是受物理现象启发的
外观模型，不是求解大气流体方程的天气模拟。完整周期在浮点计算和量化后均返回同一帧。
生成后需用 `climate.json` 保留模型版本、天体、帧数与时间步长；改变这些参数时使用新目录。

渲染器只替换 Earth/Mars 原云图节点，保留各材质原有颜色空间及 UV。
检查透明样片时应先进行 alpha 合成；不能把透明像素的 RGB 直接当成可见云层。
每个时间分片的记录命名为 `render-t000-ROW-COLUMN.json`，避免被下一时间帧覆盖。
`render-celestial-climate.slurm` 的 `CLIMATE_JOB_ROOT` 可隔离样片输出与场景，
`CLIMATE_VIEW_FRAMES=3:0,3:45,4:90` 可先验三个视角；正式发布仍要求全部视角和时间帧。

#### 多分辨率母版（v5）

`scripts/render-celestial-multires-production.slurm` 使用 8192×8192、Cycles 128 samples、
WebP quality 96 输出完整透明母版；土星和天王星的地表、星环采用独立相机范围。
打包时使用 `--resolution-widths 2048,4096` 从同一母版生成 2K、4K 两档，保持角度、
光影与归一化球体位置一致。每档图片、海报与来源哈希都记录在单颗资源包中，
完整验证后才将按宽度排序的 `resolutions` 写入网页清单。

播放器结合屏幕物理像素、设备像素比及近景球面放大倍率选择分辨率，先显示低分辨率
预览，再替换为当前画面需要的清晰度。8K 图片只将当前可见区域及旋转安全边距保留为
解码位图，避免完整 8K 位图长期占用缓存；浏览器内部解码仍可能短暂使用额外内存。
桌面与触屏的位图缓存预算分别为 256 MiB、64 MiB，云层、星环与替换中的图片均计入。
显示像素需求超过最高档时仍受母版纹理和烘焙分辨率限制。

分批提交受集群任务数限制时，使用
`scripts/complete-celestial-multires-production.py` 等待已有数组成功，再提交剩余分片；
初始 4 片、后续 16 片、剩余 20 片和打包 10 片必须逐片成功才进入下一阶段。
已手动提交的剩余数组用 `--remaining-job JOB_ID` 接管；分批或替换个别分片时可重复指定
`--remaining-job JOB_ID:18,19,21-29,31-38 --remaining-job REPLACEMENT_JOB_ID:39`。
接管记录中的索引不得重叠；被替换且未接管的取消分片不阻塞其他分片。已有打包数组可用
`--package-job JOB_ID` 接管。任务号、预期索引和连接错误均保存在 `--status` 指定的文件中，
同一状态文件同时只允许一个接续进程；进程退出后锁自动释放。
查询或同步脚本时遇到 SSH 断线会持续重试。提交只对明确的 `AssocMaxSubmitJobLimit` 重试；
若提交过程中断线或返回不明，先保留待确认记录，查询集群确认任务号后用接管参数恢复，
避免重复提交。前序分片已逐片验证完成后直接提交下一阶段，不引用可能已从调度器清除的依赖。
该程序完成时状态为 `package-complete`，后续仍需全量清单校验、资源安装、真实浏览器验收与发布。

### 本地生成

1. 在指定服务器 `~/run` 内放置 `user-models/`（十个 `.blend` 及 `Textures/`）、渲染脚本和 Slurm 文件。登录节点只编辑、安装、传输；渲染必须提交 GPU 计算节点。
2. 设置 `ATLAS_ROOT` 和 `BLENDER_BIN`，在 `ATLAS_ROOT` 创建 `logs/` 后运行 `sbatch scripts/render-celestial-model.slurm`（或已上传的同名文件）。20 个分片、最多 8 卡并行，每片可断点续渲染；可按空闲资源调低 array 并发上限。`baked-4k-v2/` 保存帧，`scenes-4k-v2/` 保存修改后的工程。每颗星体的俯仰轴由其自转轴与观察方向计算，天王星也能覆盖极区。
3. 取回完整帧目录后，安装 Pillow，并运行 `python scripts/package-celestial-atlas.py --input INPUT --output assets/celestial/baked --input-format webp --manifest`。已有 WebP 直接复制，不再次有损压缩；输入输出也可为同一目录。
4. 打包器校验全部图像的尺寸、解码、网格和 SHA256，全部十颗完整后才原子写入 `manifest.json`。默认土星、天王星使用 +30° 海报展示星环，其余使用 0°；可用 `--poster-frame BODY:ROW:COLUMN` 覆盖。
5. 在仓库根目录运行 `python -m http.server 8765`，打开 `http://localhost:8765/life.html`。使用 HTTP 服务，不能直接双击 HTML。

可用一次性收取程序替代手动传输：`python scripts/sync-celestial-atlas.py --job JOB_ID --remote-root REMOTE_BAKED_DIRECTORY --staging .render-work/celestial-delivery --browser-check`。程序等待这一个 20 分片作业，按星体取回完成的真实帧、打包并校验；全部就绪后发布本地 manifest 并执行真实资源浏览器检查，完成后退出。阶段和错误写入 staging 中的 `status.json`。浏览器检查需要现有 Playwright 环境（可通过 `PLAYWRIGHT_MODULE_PATH` 指定），不使用测试图片替代缺失帧。网络中断或渲染失败会保留已取回资源，修复后可用同一命令继续。

v4 正式作业使用 `scripts/render-celestial-full-sphere-production.slurm`：40 个分片，
每颗四片，最多 8 卡并行，180 个方位角 × 7 个俯仰角，64 samples、WebP quality 94。
完整产物包括 12,600 张地表、地球/火星的 2,520 张云层以及土星/天王星的 14 张星环，
共 15,134 张，另加海报与元数据。云层没有再次有损压缩。

集群限制同时提交的任务数量时，可先提交 `--array=0-19%8`，再用
`scripts/complete-celestial-production.py --initial-job JOB_ID --remote-root ATLAS_ROOT --blender BLENDER_BIN --staging STAGING --output OUTPUT`
接续剩余 20–39 分片。程序等待前批成功完成，随后提交后批和计算节点上的全量解码打包任务，
最后取回并逐文件校验哈希。状态记录在 `STAGING/production-status.json`；同一命令可以恢复，
不得同时启动多个接续进程。失败时保留状态和已有帧，不发布清单。
此流程仅准备本地资源，不能替代实际网页验收、资源托管和 GitHub Pages 发布。

直接同步已完成的多批 v4 作业可使用重复的 `--job`，并指定 `--layout full-sphere`
（默认 4096×4096、每颗四分片）。`--verified-remote --remote-archive-root DIRECTORY`
仅用于已经在计算节点完整解码验证的包。
如果某个尚未启动的分片被取消并在另一数组接续，可用
`--replacement-task 189070_39:189096_39` 明确声明相同分片的替代关系，并用 `--job`
包含两个数组。同步器仅在替代片有效时排除原取消片，仍要求最终全部分片成功。

如果已在服务器计算节点完成上述完整打包和解码校验，可连同 `package.json`、海报和 `render-metadata/` 一起取回。用 `python scripts/package-celestial-atlas.py --input assets/celestial/baked --output assets/celestial/baked --verify-only --body earth --hash-only` 复核单颗；全部取回后，把 `--body earth` 换成 `--manifest` 发布入口。此模式省去重复像素解码，仍检查文件格式、尺寸、完整视角网格、全部文件字节的 SHA256、海报及渲染记录；只用于已在可信环境完整验证的资源包。默认验证仍会完整解码。

生成的完整 `assets/celestial/baked/` 已被 Git 忽略。此次 12,600 张视角帧实测合计 8,627,301,634 字节（8.627 GB / 8.035 GiB，另有海报与校验记录），超过 GitHub Pages 的 1 GB 发布上限。

### 外置资源托管

完整帧通过独立资源仓库的 GitHub Releases 分发到静态资源服务器；网站仓库只保留 `assets/celestial/hosted/manifest.json` 和十张海报。资源服务器使用 HTTPS、允许页面跨域读取，并为每次发布分配独立版本目录；同一版本的帧禁止覆盖，可返回 `Cache-Control: public, max-age=31536000, immutable`。

`scripts/manage-celestial-release.py prepare` 会将超过 1900 MiB 的单颗归档拆为
`.tar.part001` 等文件，使用 schema 2 发布清单记录每片和完整归档的 SHA256。
上传时包含清单所列全部分片；安装器逐片验证并流式读取，不需要额外拼接出整包。
旧版 schema 1 单文件归档仍可安装。腾讯云部署操作只限 `/data/life-celestial-assets`，
不得修改 TeachMaster 或其他站点、服务和配置。

资源上传并可用后，使用真实 HTTPS 版本目录导出网站入口：

```powershell
python scripts/package-celestial-atlas.py --input assets/celestial/baked --output assets/celestial/baked --verify-only --hash-only --manifest --frame-base-url https://ASSET_HOST/atlas/RELEASE_VERSION/ --hosted-output assets/celestial/hosted
```

`--hosted-output` 在全量校验通过后，仅导出 HTTPS 帧地址和带内容哈希的海报文件名；最后原子写入部署清单。不会复制帧到网站仓库，也不会改变完整本地清单的相对地址。网站根目录的清单需要短缓存或重新验证，版本目录下的帧和带哈希的海报适合长期缓存。

正式网站读取 `hosted/manifest.json`。`localhost`、`127.0.0.1` 和 `::1` 上的预览优先读取完整本地 `baked/manifest.json`，本地清单不存在时才回退到托管入口。可在页面地址加 `?celestialAtlas=hosted` 强制验证远程资源，或加 `?celestialAtlas=local` 强制使用本地帧。HTTPS、CORS、线上帧和网站发布均需验证后，才能确认线上近景可用。

### 验证

`python scripts/package-celestial-atlas-tests.py` 验证打包失败处理及完整网格；`node scripts/validate-baked-closeup.cjs` 验证查看器角度、4K 解码、缓存与请求竞态。`scripts/validate-star-map.cjs --serve all --baked-fixtures` 是明确标记的交互测试素材；正式图像验收应省略该参数，使用已经完成打包的真实帧。

`node scripts/validate-celestial-compositor.cjs` 验证 GPU 资源与上下文恢复，
`node scripts/validate-celestial-starfield.cjs` 验证星表投影，
`python scripts/validate-celestial-sync.py`、`python scripts/validate-celestial-production.py`
和 `python scripts/validate-celestial-multires-production.py`
验证分批作业接续。`node scripts/validate-celestial-gpu-browser.cjs` 使用真实 Blender 样片
检查源图像素、云层透明度、各画幅、源帧切换和 Chrome GPU；报告保留实际渲染器及帧耗时。
样片测试不等同于 15,134 张正式资源的完整验收，也不保证所有设备达到固定帧率。

多分辨率裁切验收使用 `node scripts/validate-celestial-multires-browser.cjs`，覆盖真实 8K
样片、4K 桌面、面板换边和移动端，并比较裁切结果与完整源图；它只读取 `.render-work`
中的评审样片，不会把样片当作正式发布资源。

托管资源就绪后，运行 `node scripts/validate-star-map.cjs --serve all --hosted`，通过本地网页实际跨域读取线上帧，检查交互、4K 图像、手机和无 WebGL 场景。此模式不允许同时使用测试素材。

若暂时没有自有域名，可用 Cloudflare Quick Tunnel 做 HTTPS 验证；它是临时地址，服务器重启或隧道重建后需要重新导出 `hosted/manifest.json` 并推送网站。长期运行应改用自有域名绑定的命名隧道或 CDN。
