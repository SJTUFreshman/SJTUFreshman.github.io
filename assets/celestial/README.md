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

当前烤制规格为每颗星体 180 个方位角（间隔 2°）× 7 个俯仰角（−90° 至 +90°，间隔 30°），每张均为 3840×2160、Cycles 64 samples、WebP quality 90。十颗共 12,600 张。水平邻帧淡变，垂直选择最近的已烤视角，因此上下拖动是离散视角切换。光照固定，不表示实时观测、当前天气或当前月相。

网页使用 Canvas2D 展示按需加载的图片，不创建太阳系近景的实时 3D 场景。图片解码和浏览器合成仍使用系统资源；4K 屏保留 4K 解码，小屏按实际显示像素解码，缓存数量受内存预算限制。自动旋转、暂停、鼠标/触屏拖动和方向键均由图片查看器负责。

### 本地生成

1. 在指定服务器 `~/run` 内放置 `user-models/`（十个 `.blend` 及 `Textures/`）、渲染脚本和 Slurm 文件。登录节点只编辑、安装、传输；渲染必须提交 GPU 计算节点。
2. 设置 `ATLAS_ROOT` 和 `BLENDER_BIN`，在 `ATLAS_ROOT` 创建 `logs/` 后运行 `sbatch scripts/render-celestial-model.slurm`（或已上传的同名文件）。20 个分片、最多 8 卡并行，每片可断点续渲染；可按空闲资源调低 array 并发上限。`baked-4k-v2/` 保存帧，`scenes-4k-v2/` 保存修改后的工程。每颗星体的俯仰轴由其自转轴与观察方向计算，天王星也能覆盖极区。
3. 取回完整帧目录后，安装 Pillow，并运行 `python scripts/package-celestial-atlas.py --input INPUT --output assets/celestial/baked --input-format webp --manifest`。已有 WebP 直接复制，不再次有损压缩；输入输出也可为同一目录。
4. 打包器校验全部图像的尺寸、解码、网格和 SHA256，全部十颗完整后才原子写入 `manifest.json`。默认土星、天王星使用 +30° 海报展示星环，其余使用 0°；可用 `--poster-frame BODY:ROW:COLUMN` 覆盖。
5. 在仓库根目录运行 `python -m http.server 8765`，打开 `http://localhost:8765/life.html`。使用 HTTP 服务，不能直接双击 HTML。

可用一次性收取程序替代手动传输：`python scripts/sync-celestial-atlas.py --job JOB_ID --remote-root REMOTE_BAKED_DIRECTORY --staging .render-work/celestial-delivery --browser-check`。程序等待这一个 20 分片作业，按星体取回完成的真实帧、打包并校验；全部就绪后发布本地 manifest 并执行真实资源浏览器检查，完成后退出。阶段和错误写入 staging 中的 `status.json`。浏览器检查需要现有 Playwright 环境（可通过 `PLAYWRIGHT_MODULE_PATH` 指定），不使用测试图片替代缺失帧。网络中断或渲染失败会保留已取回资源，修复后可用同一命令继续。

如果已在服务器计算节点完成上述完整打包和解码校验，可连同 `package.json`、海报和 `render-metadata/` 一起取回。用 `python scripts/package-celestial-atlas.py --input assets/celestial/baked --output assets/celestial/baked --verify-only --body earth --hash-only` 复核单颗；全部取回后，把 `--body earth` 换成 `--manifest` 发布入口。此模式省去重复像素解码，仍检查文件格式、尺寸、完整视角网格、全部文件字节的 SHA256、海报及渲染记录；只用于已在可信环境完整验证的资源包。默认验证仍会完整解码。

生成的完整 `assets/celestial/baked/` 已被 Git 忽略。此次 12,600 张视角帧实测合计 8,627,301,634 字节（8.627 GB / 8.035 GiB，另有海报与校验记录），超过 GitHub Pages 的 1 GB 发布上限。

### 外置资源托管

完整帧通过独立资源仓库的 GitHub Releases 分发到静态资源服务器；网站仓库只保留 `assets/celestial/hosted/manifest.json` 和十张海报。资源服务器使用 HTTPS、允许页面跨域读取，并为每次发布分配独立版本目录；同一版本的帧禁止覆盖，可返回 `Cache-Control: public, max-age=31536000, immutable`。

资源上传并可用后，使用真实 HTTPS 版本目录导出网站入口：

```powershell
python scripts/package-celestial-atlas.py --input assets/celestial/baked --output assets/celestial/baked --verify-only --hash-only --manifest --frame-base-url https://ASSET_HOST/atlas/RELEASE_VERSION/ --hosted-output assets/celestial/hosted
```

`--hosted-output` 在全量校验通过后，仅导出 HTTPS 帧地址和带内容哈希的海报文件名；最后原子写入部署清单。不会复制帧到网站仓库，也不会改变完整本地清单的相对地址。网站根目录的清单需要短缓存或重新验证，版本目录下的帧和带哈希的海报适合长期缓存。

正式网站读取 `hosted/manifest.json`。`localhost`、`127.0.0.1` 和 `::1` 上的预览优先读取完整本地 `baked/manifest.json`，本地清单不存在时才回退到托管入口。可在页面地址加 `?celestialAtlas=hosted` 强制验证远程资源，或加 `?celestialAtlas=local` 强制使用本地帧。HTTPS、CORS、线上帧和网站发布均需验证后，才能确认线上近景可用。

### 验证

`python scripts/package-celestial-atlas-tests.py` 验证打包失败处理及完整网格；`node scripts/validate-baked-closeup.cjs` 验证查看器角度、4K 解码、缓存与请求竞态。`scripts/validate-star-map.cjs --serve all --baked-fixtures` 是明确标记的交互测试素材；正式图像验收应省略该参数，使用已经完成打包的真实帧。

托管资源就绪后，运行 `node scripts/validate-star-map.cjs --serve all --hosted`，通过本地网页实际跨域读取线上帧，检查交互、4K 图像、手机和无 WebGL 场景。此模式不允许同时使用测试素材。
