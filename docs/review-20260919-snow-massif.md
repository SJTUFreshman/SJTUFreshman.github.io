# 连续雪山群与固定机位研究（2026-09-19）

照片级连续验收仍为 **0**。所有研究只在离线 `.render-work` 目录；未安装新全景，未修改 panorama manifest。保留的 manifest SHA-256 为 `8ecb6a5fc4990027c9fb8a1a91888e4a14478fa569a6cb14b1ec82a94633d7b0`。

用户最新要求是从固定位置看到远处层叠、起伏、险峻的雪山群，参照《死亡搁浅》的视觉质量。孤立主峰加水平雪地不满足要求。近雪真实度与完整 360° 山体覆盖仍分别需要通过实图审查。

## 已拒绝：Rainier + Matterhorn r3

- A800 作业 `166196`，`COMPLETED 0:0`，用时 `00:05:06`，节点 `d1n41a28g02`。
- 本地 `.render-work/public-snow-alpine-cluster-r3/renders/` 已取回晴天/黄昏全景、独立天空、各 11 张透视图及 `evidence.json`。
- 主代理及独立代理实际查看两相六向 contact：远峰已出现，但集中在前方；蓝紫远峰色调与近山不同，扫描底板、正圆雪坡和下方圆弧接缝可见，左右及后方仍是大片水平空地。两者均判 FAIL。
- 环形 berm 只是两圈 96 个四边形的规则坡，不能解决近景地形。新研究移除这个坡和人工接收平面。

## 已定位的源处理错误

1. 世界裁切面的法线转局部时使用了错误矩阵。应为 `M.transposed() @ world_normal`，不能用 `M.inverted().transposed()`。保留世界 `z >= threshold` 使用 `clear_inner=True, clear_outer=False`，由独立 Blender 回归核实。
2. r2 的 Matterhorn 原有 428,731 面，错误裁切后只剩 14,840 / 27,944 面；远峰变小与缺失不是源素材本身的结论。
3. Mont Blanc GLB 不是空模型。本地完整解析得 961,158 面、621,051 UV 拆分顶点、10 个 mesh、8K 颜色贴图。原始导入尺寸为 `39.579768 × 38.011640 × 5.284126`；r1 再乘 `0.005` 后最高只 `0.026421`，用 `0.7` 裁切使所有面被删除。原来的“无有效网格”判断撤回。
4. 渲染器现拒绝零面来源和被全部裁掉的来源，避免再次将空模型当作成功导入。

新增 `scripts/validate-public-model-clipping.py` 以解析半空间结果比对旋转、平移、父层非均匀/负缩放下的几何、面积、材质和 UV，覆盖完全删除、完全保留及空成员。

## Mont Blanc 完整山脉机位

来源为 [Spaceport3D: Mont Blanc massif photographed from ISS](https://sketchfab.com/3d-models/mont-blanc-massif-photographed-from-iss-c66a5a559d3844eaac942939211a4b8d)，CC BY 4.0。原 GLB SHA-256：`950c81506444ea2fb58f9ba853a92c8f3e3ff9b79b177448582f64ce5b3357e5`，大小 54,062,724 字节。完整本地几何和图集诊断保存在 `.render-work/montblanc-diagnostic/`。

新研究保持完整山脉拓扑，不裁底、不复制单峰拼接。统一缩放 1000 用于约 40 km 级构图，但原始物理单位未被验证，因此仍记录 `units_verified=false`。

| 机位 | 居中/基底归零后的源坐标 | 原地形坡度 | 用途 |
| --- | --- | --- | --- |
| pass | `[-2, -2, 3.212383601]` | 8.27° | 从较低冰川仰看层叠峰群 |
| saddle | `[-6.5, 4.75, 3.998935527]` | 13.89° | 从雪鞍看附近陡壁和远峰 |

Blender 对相应 XY 从上方射线查找实际地表，再增加 1.7 单位净空；不修改相机脚下高程来制造平台。原生四向、近雪和远峰放大图使用同一全景机位，避免不同相机位置冒充固定机位验收。

近景补充 Poly Haven CC0 `snow_02` 的真实 4K diffuse/normal/roughness。为其建立独立世界 XY UV 层与对应 Normal Map 切线基，保留原来的山体图集 UV；补充材质仅按距离、雪色及坡度权重混合，不能被称为原山体的厘米级扫描。40 km 范围的 8K 颜色图仍不保证近景可用，烘焙阴影也需晴天/黄昏审查。

独立几何检查确认 pass 的承托三角边长约 78/78/82 场景单位，saddle 为 42/43/60；局部雪面位移不能恢复这些三角内部缺失的宏观起伏。后续若细分，必须保留原三角平面及图集 UV，对跨 primitive 的同坐标共享边统一处理；不得新铺平台或使用会改变整座山形的全局平滑。

另已取得 `snow_02` 4K EXR 高度图（CC0），2,727,453 字节，官方 MD5 校验通过，SHA-256 `b20a8f7343d4552a7202aa3c9fe335e1d8c46f8bf87029167b2b7f7fcf68399c`。它为 HALF Y+A，A 恒为 1，Y 均值 0.5590632；后续只能用 Y 作为 Non-Color 高度。物理幅度未经验证，此轮尚未用于位移，未安装。收据位于 `.render-work/public-materials/snow_02/snow_02_disp_4k.receipt.json`。

## 新作业记录

- 作业 `166266`：`life-montblanc-pass-r1`，单张 A800，限时 30 分钟。
- 隔离目录：远端 `/data/home/scwb515/run/yangrunde/life_worlds/.render-work/public-snow-montblanc-pass-r1/`。
- 该目录 `scripts/` 是实际通过回归并渲染的冻结代码，根目录旧脚本不应作为本次代码证据。最新工作源码在本地 `C:/Andrew_Allender/SJTUFreshman.github.io/scripts/`；后续远端继续时先以冻结脚本和 `source-sha256.txt` 对照，避免恢复旧裁切逻辑。
- 先运行裁切回归，再渲染两个机位的晴天/黄昏 4096×2048 全景与 1600×1100 原生近景。
- `166266` 已 `COMPLETED 0:0`，耗时 `00:06:39`，节点 `d1n41a24g01`，日志实际确认 `NVIDIA A800-SXM4-80GB` 与 Cycles CUDA。裁切回归 5 项全部通过，包含 6 组矩阵变换子测试。
- 两个机位全部 32 张输出已下载，逐张通过 SHA-256 和分辨率核对；两机位 BVH 实际落点与独立源三角射线结果相差小于 0.03 场景单位，净空为 1.7。详见 `.render-work/public-snow-montblanc-pass-r1/verification.json`。
- 主代理和独立代理查看两机位晴天/黄昏六向及原生近雪/山脊图，均判 **FAIL**。不是照片级验收通过。
- pass 的连续山系构图明显比孤峰加平地完整，但中近景山壁仍有泥塑平滑、直线棱边、图像拖伸和巨型三角面。近雪细纹存在，缺少真实体积起伏，重复污痕明显。
- saddle 的巨型近山挡住远峰，轮廓和坡面三角折边更明显，不适合作为当前主构图。其 `distant-ridges` 沿用 pass 的 `yaw=315/pitch=18`，多数画面是天空，不能作为 saddle 有效远峰检查证据；以后必须按该机位的实际峰位置设目标。
- Mont Blanc ISS 暂降为更远背景素材候选，不能继续用于 0–3 km 主要可见山壁。独立代理建议从 10–15 km 宽视角背景、15–25 km 放大远景开始试验，这些距离是研究建议，不是通过保证。
- 已核实 `166196`、`166266` 都结束，本任务队列为空。没有执行 scancel，没有取消无关的 `166148`、`165969` 或 pending `166149`、`166269`、`166256`。

## 后续来源检查与当前连接限制

用户的 Sketchfab 账号此前已登录，已实际读取官方候选 [Snow Mountain / aa3ccbb](https://sketchfab.com/3d-models/snow-mountain-aa3ccbb5940d43ffab435a6b7fe7c69d)：230 万面、Gaea 生成、CC BY；作者评论明确承认纹理质量问题，因此不因为面数高就作为中近景替代。另读到 [Rugged mountain landscape / teej_FBX](https://sketchfab.com/3d-models/rugged-mountain-landscape-61f68892e8b34f8a9fbd57a5243ea142)：581,400 面、Gaea 制作、CC BY，尚未完成视觉预览或下载，不能称为可用高质量源。

会话内浏览器工具更新后原连接消失；新的 inventory 返回 `unsupported Codex auth method: apikey`，已登录的官方浏览器下载暂时不可用。没有读取 cookie/令牌或绕过登录。该连接恢复前，继续使用已核验本地素材或公开无需登录来源；不要重新要求用户重复提供密码。

下一步先补更高分辨率的中近景雪坡/冰川/岩壁扫描，再把连续远峰放在合适视距；避免继续把整片几十公里的低密度航拍网格放在人眼近处。连续通过仍为 **0**，安装禁令不变。
