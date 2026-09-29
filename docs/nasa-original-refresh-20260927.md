# NASA 原始舱体重新下载与核验（2026-09-27）

已重新从 NASA 官方 GitHub 仓库下载全部八个分卷，并独立解压出原始 FBX。新下载与现存原始 FBX 的 SHA-256 完全一致，现存源文件没有被此前渲染流程改写。此前 Life 的 `.blend` 和全景是另行配置的派生产物，不能当作原始 NASA 成品。

重新下载阶段只新增隔离下载和核验记录，没有修改生产场景、既有 NASA 源文件或渲染脚本。后续获准进行了下述隔离 GPU 机位审查，使用有时限的 `sbatch`，未启动 `salloc`。

## 官方来源与下载方式

- 官方模型页：<https://science.nasa.gov/3d-resources/international-space-station-iss-e-internal/>
- 官方仓库：<https://github.com/nasa/NASA-3D-Resources/tree/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/International%20Space%20Station%20%28ISS%29%20%28E%29%20%28Internal%29>
- 本次下载使用上述固定版本 `11ebb4ee043715aefbba6aeec8a61746fad67fa7`，不是沿用磁盘上的旧分卷。
- 第一卷实际 URL：<https://raw.githubusercontent.com/nasa/NASA-3D-Resources/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/International%20Space%20Station%20%28ISS%29%20%28E%29%20%28Internal%29/International%20Space%20Station%20%28ISS%29%20%28E%29%20%28Internal%29.7z.001>；其余七卷的完整 URL 与逐卷哈希在 `source/provenance.json` 中。
- 官方使用说明：<https://www.nasa.gov/nasa-brand-center/images-and-media/>。本项目沿用 NASA 署名，不暗示 NASA 对网站的认可。

本次重新获取了模型页和许可页快照。原下载脚本查询 GitHub API 时遇到匿名限流 `HTTP 403`；NASA 页面列出的 assets 分卷链接返回 `HTTP 404`。因此本次从 NASA 自己的 GitHub 仓库固定版本重新取得八卷，逐卷核对已记录的 NASA Git blob SHA-1 与 SHA-256。未声称成功查询了当前 `master`，也未使用第三方模型镜像。

## 本地结果

目录：`.render-work/nasa-original-refresh-20260927/`。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `source/International Space Station (ISS) (E) (Internal).7z` | 303,774,173 | `a850b0f2f173dd704d63fbc183f86c7750016872da231262112004dddc0e1bd1` |
| `source/International Space Station (ISS) [internal].fbx` | 315,560,604 | `bb884b3f5fdae3fe6116bd2241b44e8efb2f804de8785840431f400ebfa09816` |

八卷均通过逐卷 Git blob / SHA-256 校验；解压过程通过归档 CRC 检查。归档只含上述一个 FBX 文件，没有独立场景工程、相机方案或外置贴图目录。核验时间为 UTC 2026-09-28；目录名保留本轮约定的 `20260927` 标识。

- `source/provenance.json`：下载时间、实际来源、页面快照哈希、逐卷及重组归档哈希。
- `source/extraction-verification.json`：归档成员、解压后 FBX 哈希、旧源文件对照。
- `fetch-original.py`：本次固定版本下载与核验过程。
- `extract-original.py`：本次受限成员检查、解压与源文件对照。
- `python-packages/`：仅供此次解压的 `py7zr` 依赖；未添加项目运行时依赖。

现存 `.render-work/public-models/nasa/International Space Station (ISS) [internal].fbx` 的本次实测哈希同样为 `bb884b3f5fdae3fe6116bd2241b44e8efb2f804de8785840431f400ebfa09816`。

## 原始结构与直接渲染可行性

这是 ISS 内部舱段集合，包含 Cupola、Node1/2/3、US Lab、Columbus、JPM/JLP 等；不是带完整外壳、驾驶舱和预设光照的科幻飞船工程。FBX 内嵌贴图，无需另外下载纹理包。

相同 FBX 哈希的既有真实 Blender 4.5.3 导入记录为 `.render-work/nasa-inspect-20260916-r1/inspection.json`：265 个 mesh、474,527 个三角形、41 个材质。已记录的源数据包含 97 张嵌入 PNG，其中 91 张 4K；Blender 首次导入产生 108 个可加载图像 datablock，重载后为 106 个，区别包括重复实例，并非源贴图丢失。后续新源机位作业 `175182` 再次实际导入并确认相同计数。

本次实际重新打开了既有 `cupola-imported-down.png` 和 `uslab-imported-forward.png`：US Lab 的设备架、舱门与扶手可用于舱内固定机位；Cupola 原导入的玻璃反射强、窗盖关闭、显示器未正确连接源贴图。这些是同源旧诊断图，不是本次新渲染结果。

因此可在现有服务器 Blender/Cycles 原生渲染，无需 Unreal；但原 FBX 仍需要相机、照明和贴图导入状态核查。Cupola 的七个关闭窗盖会挡住独立天空。若使用开窗全景，应仅在渲染副本中记录窗盖与玻璃的可见性设置；原始 FBX 始终保留。NASA 源单位的物理尺度仍未标定，不应称旧 `.22` 缩放为实测尺寸。

## 与旧 Life 派生场景的区别

`scripts/integrate-nasa-interior.py` 的旧接入保留几何与 UV，但执行了 `.22` 人工缩放、X 轴旋转、源显示器贴图连接修复、四盏新增 area light，并隐藏 `Cupola_WC_01` 至 `Cupola_WC_07` 和 `Cupola_Int_Glass`。这些是已记录的派生配置，不是 NASA 原始配置；重新下载相同原文件不会自动消除旧派生光照或机位的问题。

本轮已从此次新源复制到新的渲染目录，比较不同的 Cupola/舱内观察点及照明，保留源几何和材质纹理，并将必要的源贴图连接、开窗与光照设置写入证据。下面记录最终母版和页面接入状态，旧派生版本不再作为本轮结果。

## 新源原生机位审查

作业 `175182` 使用新下载并上传的 FBX，在 `hp_a800` 单张 A800 上运行，节点 `d1n41a15g02`，`COMPLETED 0:0`，用时 `00:03:26`。本地和服务器隔离目录均为 `.render-work/nasa-original-views-20260927/`。产出 26 张 960×960、48 samples 原生 PNG，全部下载后逐张哈希一致，五张 contact sheet 已实际打开审查。

新导入含 265 mesh、474,527 三角形、41 材质、108 张已加载图像。渲染前后几何坐标、拓扑、UV 和对象变换的组合哈希一致；源 FBX 哈希保持不变。只连接 `Generic_Misc_Details` 的 NASA 原有 Diffuse/Metallic 贴图，显式隐藏七窗盖和玻璃，不改玻璃参数、不增加几何、不使用旧程序驾驶舱、不启用人工粗糙度贴图。相机、环境光及 area lights 是本次明确记录的渲染配置。

机位比较：

| 原始坐标 | 视觉观察 |
| --- | --- |
| Cupola `[0,98,-18.5]` | 七窗在前视中最完整，控制台与相连 Node3 舱体同时有可用空间关系，是本轮优选固定观察点。 |
| Cupola `[0,98,-20.5]` | 中央窗更大，外围窗和设备开始被画面边缘切断。 |
| Cupola `[0,98,-22.5]` | 距窗口过近，外围窗裁切明显，左右近景更拥挤。 |
| US Lab `[49,33.8,0]` | 舱内设备与纵深丰富、曝光均匀，但缺少 Cupola 七窗的星空观察体验。 |

本轮 Cupola 的前舱依然暗于后舱；提高两侧光功率 1.6 倍变化不明显，提示需要检查遮挡和布光位置。第一轮六向原生图的侧向 roll 并非统一全景基底，只用于位置和光照诊断，不能用它们直接拼接最终全景。`175182` 已结束，查询时本账户 GPU 队列为空，无需取消。

后续隔离 `r2/` 布光与全景审查作业为 `175194`，仍限定 30 分钟、单 GPU。它独立渲染六色轴标记校验投影，记录旧光源到机位的遮挡射线，将前光放在已测量无遮挡的机位内部，比较三档强度。所有方向从同一相机正交基底计算，并输出 4096×2048、128 samples 的候选全景；作业状态与结果需以该目录最终证据为准。

`175194` 已 `COMPLETED 0:0`，用时 `00:07:33`，节点 `d1n41a18g03`。11 张结果图片在本地校验哈希与尺寸通过，几何/UV/变换指纹仍一致。独立六色轴渲染校验通过：全景 U=0.5 指向 source −Z，U=0.75 指向 +X，顶部为 +Y，与 Life Three.js 全景约定一致。相机旋转为恒等，六向图由同一全景重投影生成，消除了独立 look-at 的 roll 歧义。

遮挡证据显示旧右侧软光中心至窗口方向在仅 `0.0938` 原始单位处碰到 `Cupola_Int_MSS_AV`；相机附近的新前光位置则有清晰空间。比较 1200/3000/7000 W 后选择 3000 W：七窗周围框架、螺钉、面板和显示器清楚，同时保留舱体明暗关系。前光位置 `[0,98,-18.35]`，朝 `[0,98,-30]`，圆盘直径 3 原始单位；连接舱 180 W，Node3 250 W。光功率是本次渲染配置，并非 NASA 舱内灯具实测数据。

最终母版由作业 **`175360`** 完成，`COMPLETED 0:0`，用时 **`00:53:18`**，4 张 A800，16384×8192 RGBA、2048 最大采样、adaptive threshold `.001`、去噪。固定观察点 `[0,98,-18.5]` 和 3000 W 前光保持不变。32-bit EXR 为 1,472,499,311 字节，SHA-256 `a6d469aee29d9667eeb17e7dbea864abb5b2e1eb82e2acd38c29ccf9b0576f36`；16-bit PNG 为 576,021,447 字节，SHA-256 `a1c93b5e8f87c05b083a6456e941b714692a373acac994864d5d07284dbb55ec`。证据在 `.render-work/nasa-original-views-20260927/r3-final/final-evidence.json`；PNG 已下载并独立核对完整哈希，EXR 保留于服务器母版目录。

前置作业 `175225/175227` 因 PNG 格式下先设置 32-bit 深度而立即失败；修正格式设置后单卡 `175243` 预计超过 2 小时时限，被明确取消并改用多卡；`175261` 在更新设备识别后由本任务取消。`175263` 完成采样后因大型 Render Result 尺寸检查不可靠而在保存前失败；最终 `175360` 使用直接写入 EXR 再保存 PNG 的流程成功。以上均保留记录，未取消其他任务；NASA 本轮作业已全部结束。

母版独立视觉审查图片为 `r3-final/master-review/master-six-directions.jpg` 及同目录六张 `master-*.png`，确实由最终 16K PNG 重投影，已逐图打开。前方七窗构图、框架/螺钉/显示器细节清楚；左右和上下保留 ISS 原始舱体方位；未见 tile 边界或全景接缝错位。Node3 顶部源模型凹暗区域仍保留，未为抹除它新增几何。当前结论是保留用户认可的 NASA 成品资产，所选机位与布光可用于页面 review；未宣称模型比源资产更真实。

母版包含 4,780,489 个完全透明像素和 129,368,465 个完全不透明像素。首尾列 RGBA 平均差为 `[1.60,1.81,1.72,0.0045]/255`，接缝未见可视断裂。透明区域保持真实 alpha，审查图深蓝色仅为背景占位。旧机位的七点探针坐标不再完全落在新机位窗孔内，故没有用旧探针结果宣称七窗逐点全零。

## 同源浏览器探索模型

单独导出作业 `175277` `COMPLETED 0:0`，用时 `00:01:10`，入口为 `.render-work/nasa-original-views-20260927/explore-export/nasa-iss-internal.gltf`。99 个资源文件共 **281,049,873 字节**，最大文件 23,599,240 字节；含 97 张 PNG 贴图。全部下载哈希通过，按独立 accessor 解码和父级矩阵连乘，Cupola 三个关键对象的顶点/边界与 Blender 源世界坐标最大误差小于 `0.000018` 原始单位。

导出明确使用 `export_yup=False`，因此 source `(x,y,z)` 原样保留，不发生 Blender 默认 `(x,z,-y)` 变换。仅导出 257 个可见 source mesh；七个窗盖和玻璃按选中全景设置排除，其余源几何/UV 保留。相机与 area lights 没有作为替代点光塞进 glTF，完整灯光配置另存 `export-evidence.json`，由浏览器合理近似；源纹理输入经标准 glTF 导出，Metallic/Roughness 可能做通道打包。

原始总边界约 `[-55.3819,-47.4843,-34.1718]` 至 `[171.2722,158.3671,51.2141]`；NASA 源坐标未标定到米。页面探索使用**失重自由漂浮**，scale **1**，起点 `[0,98,-18.5]` 对应 Life `[0,1.68,-9.95]`，朝 −Z、头顶 +Y，移动单位明确为 source units。没有凭空定义 `pilot.exit`、地面高度或可行走平面。

原始坐标与 Life 观察点 `[0,1.68,-9.95]` 的 scale=1 映射仅为平移：`(x,y,z) → (x, y−96.32, z+8.55)`。已接入 `assets/life/models/nasa-iss-cupola/nasa-iss-internal.gltf`、bin 及 97 张原纹理，浏览器按 metadata 建立与烤制相对应的面积光；无需附加坐标旋转。

为防止自由漂浮穿过已隐藏的透明窗口，另从源 `Cupola_Int_Glass` 导出碰撞专用几何。初次 skin 导出不适合静态 BVH，最终作业 `175464` `COMPLETED 0:0`（3 秒）将原始当前 pose 的 evaluated mesh 固化为无 rig/skin 的静态 mesh，保留 world matrix；未造新窗面。`collision-window.gltf/.bin` 仅用于碰撞，不加入可见渲染。独立实际模型测试确认 552 三角形、全部 source/export 顶点双向误差小于 `1e-4`；前行约 12.10 source units 撞到原玻璃，向后约 45.18 source units 的 Node3 通道仍可通过。

## 当前页面接入状态

四档 WebP 从上述最终母版生成并保留 alpha，已由主执行安装到正式 manifest 的 `spaceship/night`：

| 档位 | 尺寸 | 字节数 | 已安装文件 |
| --- | --- | ---: | --- |
| low | 2048×1024 | 317,560 | `spaceship-night-scene-low-e640a052f4c4.webp` |
| medium | 4096×2048 | 1,065,878 | `spaceship-night-scene-medium-2990f2b7e093.webp` |
| high | 8192×4096 | 3,041,666 | `spaceship-night-scene-high-202d9441b93a.webp` |
| ultra | 12288×6144 | 6,659,910 | `spaceship-night-scene-ultra-0d70e6f18ee0.webp` |

完整哈希在 `r3-final/web-tiers.json` 和页面 manifest。观察 pitch 为 `.03`，保留 full-source glTF 探索、scale=1、面积光与静态原玻璃碰撞。生产标签仍为 **review**。主执行已看过真实浏览器原模探索效果和碰撞行为；最终新全景安装后的浏览器复测受工具认证故障影响尚待完成，离线六向/alpha/接缝检查不能替代该项。NASA 源、母版、页面资源与实际检验的边界均已记录。
