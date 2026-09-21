# 固定机位全景资源

此目录服务于 `observe` 默认观景；不是自由移动场景，也不是最终画质已经完成的声明。浏览器投影离线全景并叠加交互天空，隐藏探索才加载完整实时几何。四个场景为 `spaceship`、`shelter`、`hogwarts`、`snowmountain`。

## 资源与生产边界

- `manifest.json` 是已安装全景的清单，具体字段以 `24-panorama.js` 的读取契约为准。
- `*.scene.json` 是制作/导出中间产物，包含几何和材质描述；不是访客默认模式需要下载的资源，不应把它们当成已经烘焙好的图片。
- 夜间场景使用 night 资源；山丘、雪山需要 clear/dusk 两套匹配光照的资源，不可只给同一底图套颜色滤镜。
- 正式全景应包含天空透射/遮挡信息，使舷窗、窗外与开放天空保留星座命中，墙体、窗框、山体不能穿透点击。
- 低／中／高资源档位是交付分辨率选择；`draft`、`review`、`approved` 是生产验收状态，两者不能混用。

渲染器的 `status` 为 `loading`、`preview`、`prerendered` 或 `error`。`prerendered` 仅说明离线图片已加载，不证明照片级、4K 或 120fps 指标已经通过。没有正式资源时必须显示预览提示，不得把程序化替身宣传为最终照片级资源。

只有可见且完整加载的全景参与天空遮挡；加载中、隐藏或出错时清除 mask 的交互影响。WebGL 中断后等待全部受影响层恢复，再以低一档纹理与帧缓冲预算重试；`auto` 也保持这一安全上限。最低档再次中断会停止自动重试，直到访客明确重新选择画质，避免重复耗尽显存。

## 相机和驾驶契约

每套资源由固定 observation 机位完整覆盖 360°；镜头位置必须与 manifest 中 observation/pilot metadata 一致。飞船默认在驾驶座，环顾只改变头部本地四元数，`W/S` 俯仰、`A/D` 偏航、`Q/E` 翻滚改变飞船姿态。舱内全景随头部方向投影，舷窗外的星空使用全局相机姿态，因此舱内不用因飞船转向重新渲染。

默认模式不允许离开驾驶座；隐藏探索才可以离座。不能用一张固定视点图片伪装成有真实位移视差的漫游。服务器的算力用于离线建模、烘焙和渲染，不会自动减轻实时探索时访客的本机渲染负担。

## 生产验收

1. 固定镜位检查材质尺度、近景结构、玻璃、接缝、反射与光照是否可信；同时检查全景极点与水平接缝。
2. 检查同一天空资源的太阳方向、色温、阴影和环境反射一致；晴天与黄昏分别验收。
3. 验证舷窗及开放天空的 mask、360°星座点击、驾驶转向和场景切换，不得出现可见图像与命中区域错位。
4. 在桌面与移动设备验证低／中／高档位、首次下载大小、显存开销、转头流畅度和加载失败退路。
5. 连续两轮独立视觉与交互审查均未发现待修问题之后，才允许将对应生产资源标记为 approved；任一实质修正都需重新计轮。

静态全景图片没有素材帧率，120fps 表示浏览器转头显示目标；要制作动态全景视频，须另行提供无缝循环、编码、带宽与设备解码性能验证。4K 视口要覆盖全景的一小部分，源图通常必须明显高于 4K，不能将 4K 等距柱状整图等同于 4K 视口清晰度。

## 安装评审资源

安装工具需要 Python 与 Pillow，不会自动将资源标记为 approved。先用 `--dry-run` 验证输入；去掉该参数才生成 WebP 并原子更新 manifest：

```powershell
python scripts/install-panorama.py --scene spaceship --phase night --foreground .render-work/remote/spaceship.png --scene-json .render-work/scenes/spaceship.scene.json --dry-run
python scripts/install-panorama.py --scene hogwarts --phase clear --foreground .render-work/remote/hogwarts-clear.png --sky .render-work/remote/sky-clear.png --scene-json .render-work/scenes/hogwarts.scene.json --sky-metadata .render-work/remote/sky-clear-observation.json --dry-run
```

低／中／高档分别最多为 2048／4096／8192 像素宽；只生成源图支持的档位，小于 2048 的源图仅安装原尺寸 low，不放大后冒充更高画质。输出文件含内容哈希，可重复安装，不覆盖旧版本图片。前景必须为精确 2:1、保留透明天空和不透明场景的图像；天空图片可为 RGB。`--orientation x y z w` 默认为单位四元数，应使用离线方向图验证后的变换。

`--scene-json` 的场景 ID、坐标系与 observation 是机位的唯一来源；已有其他时段资源的机位不一致时拒绝安装。飞船驾驶位从该 observation 同步；浏览器异步得到 manifest 时只修正默认观景机位，不重置飞船姿态、速度，也不移动探索中的用户。

`--sky-metadata` 只接受显式美术方向校准，不可虚构 HDR 拍摄日期／地点。格式如下，`sunDirection` 是太阳在未旋转天空图中的 +Z-forward、Y-up 方向，安装时归一化；`source` 可保存真实来源与许可信息。`--sky-orientation x y z w` 可独立设置天空图旋转，默认与 `--orientation` 相同。浏览器将天空旋转应用一次，使太阳命中、镜头跟踪和场景光照对应天空图的太阳。切换至探索或纯星空模式时清除这项离线画面校准。

```json
{"kind":"art-direction-calibration","coordinateSystem":"sky-y-up-plus-z","sunDirection":[0,0.6,0.8],"source":{"name":"实际使用的天空资源名称"}}
```

校准不修改星座目录、用户经纬度或天文观测日期；太阳详情保留天文计算值并标注其与场景美术方位的区别。方向元数据不能替代实际验收：必须分别检查太阳像素中心、太阳命中点、山体阴影与环境反射。

用 `scripts/calibrate-rendered-sky.py` 对实际渲染的天空指定太阳 UV，会保存图片 SHA-256、像素尺寸、坐标约定及不确定度。当 `source.renderedImageSha256` 存在时，安装器拒绝与该哈希不符的天空图；重渲染后需要对应的新校准记录。

安装资源统一为 `production: review`，界面明确显示“预渲染评审版 · 尚未完成最终画质验收”。独立运行 `python scripts/validate-panorama-install.py` 检查尺寸、透明度、机位匹配、评审标记与 dry-run 行为，测试仅写入临时目录。

## 后台批处理与资源预检

从远端 `/data/home/scwb515/run/yangrunde/life_worlds` 工作目录提交当前飞船 r13、城市 r8 队列：

```bash
bash scripts/render-highpoly.slurm --check-inputs
sbatch scripts/render-highpoly.slurm
```

先上传 `scripts/` 中本轮脚本，以及 `.render-work/review-ship-r13.json`、`.render-work/review-city-r8.json` 到对应远端目录。预检只读取文件与 JSON，可在登录节点运行；确认场景贴图、glTF 外部资源、显式 HDR 和建模脚本所需资料存在，不启动 Blender。批处理启动时会再次预检；缺失输入立即退出，渲染中的 Python 错误也会返回非零退出码。预检不证明节点可用、几何正确或画质达标。

`sbatch` 可在断开终端后继续排队与执行，依次渲染两幅前景全景，日志写入 `logs/highpoly-<jobid>.out` 和 `.err`。完成、失败或达到两小时上限时由 Slurm 自动释放资源；不要取消正常等待资源的批处理。需要人工停止异常作业时，仅对确认的作业 ID 执行 `scancel`，再用 `squeue`/`sacct` 核对。当前两张夜景沿用原环境照明，不引用白天 HDR，也不会自动安装到网页。

预检回归命令为 `python scripts/validate-render-inputs-tests.py`；其他队列可直接使用 `python scripts/validate-render-inputs.py --queue <queue.json>`，用重复 `--required-file` 补充建模脚本中的静态依赖。
