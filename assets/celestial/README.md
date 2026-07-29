# 天体近景纹理：来源、许可与真实性边界

本目录保存 `life.html` 天体近景所用的静态纹理。为避免仓库重复存放大型源文件，
这里只保留面向网页加载的派生文件，并在下方记录可复现的上游直链。除土星环外，
纹理均为等距圆柱投影（equirectangular，宽高比 2:1）。

这些资源用于明确标注的“放大近景”，不代表访客在当时、当地以肉眼能够看到的
天体角尺寸，也不是实时望远镜或航天器影像。

## 资产清单

| 网页资产 | 上游来源与 credit | 网页化修改 |
| --- | --- | --- |
| `mercury.webp` | Solar System Scope 2K Mercury | JPEG 转 WebP；保持 2048×1024 |
| `venus.webp` | Solar System Scope 2K Venus Atmosphere | JPEG 转 WebP；保持 2048×1024 |
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

水星、金星、火星、木星、土星和太阳取自 Solar System Scope 的免费 2K
纹理包：

- 纹理主页：[Solar Textures](https://www.solarsystemscope.com/textures/)
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

> Planet textures by Solar System Scope, based on NASA elevation and imagery
> data, licensed under CC BY 4.0. Converted to WebP and, where applicable,
> resized/compressed for this website.

### 真实性边界

Solar System Scope 明确说明：尚未测绘的区域可能用与周边协调的虚构地形填补，
颜色也为突出各天体特征而略微提高饱和度。因此这些纹理适合可信的交互式可视化，
但不是可用于科学测量的原始数据产品。

- 金星使用的是云层而非雷达地表，因为可见光近景看到的是浓密云层；云纹不是
  当前时刻的真实天气。
- 木星和土星的大气带、风暴会持续演化，静态贴图只代表典型外观。
- 太阳贴图只代表典型光球纹理，不包含当前时刻的太阳黑子、耀斑或日珥位置。

## NASA VTAD 模型纹理

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
