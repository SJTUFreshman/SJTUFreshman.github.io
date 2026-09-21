# Tapado 局部冰川复审（2026-09-21）

照片级连续验收仍为 **0**，本轮没有安装全景或修改 `assets/life/panoramas/manifest.json`。

## A800 研究

- 作业：`167847`，分区 `hp_a800`，节点 `d1n41a22g03`，`COMPLETED`，耗时 `03:32`。
- 来源：Zenodo 14755911，CC BY 4.0，2024 OBJ；实际 1,000,000 三角面、8192² 图集。
- 研究目录：`.render-work/public-snow-tapado-20260921-r2/`。
- 生成晴天/黄昏 4096×2048 全景、原生方向透视图、低机位近雪和俯视检查图；相机脚下由真实三角形射线确定，净空为 1.7 个场景单位，不创建平台。来源证据的 `units_verified` 为 `false`，不能把该净空直接称为已标定的米制高度。

## 独立审图身份与范围

本次审图人为子代理 `scan_quality_audit`，未参与此版本实现或渲染，独立逐张查看了 `.render-work/review-20260921/tapado-{clear,dusk}-{six,close}.jpg` 共四张 contact。原文初稿由主代理写成，本次独立结论仅针对这些实际查看的图像。

已核对 `verify-studies.py`：这些 contact 取自 `renders/diagnostic/` 材质诊断组，不是 `renders/original/` 原材质组。`six` 是各相全景与独立天空合成后的 forward、right、rear、left、zenith、nadir 六向投影，不是六个原生相机渲染；`close` 是两相 near-visible-snow、footing、overview 原生透视渲染的缩图。已阅读该组 `evidence.json` 与 `verification.json`；后者记录图像哈希、原生视图 1600×1100 尺寸及全景尺寸一致。本次未逐张检查全分辨率 PNG，未视觉对比 original 材质组，也未验证浏览器交互；缩图已足以判定当前诊断结果不合格。

## 独立结论

晴天、黄昏均判定 **FAIL**。

- forward、left 和 near-visible-snow 中，近雪由大片平滑灰白面与尖锐三角折棱组成；越接近相机，平面与网格边越明显，缺少可辨认的雪颗粒、冰层和细小裂隙。远处密集的小起伏不能掩盖近景的粗糙几何。
- nadir 与原生 footing 几乎被无纹理感的灰白大面占满，并有突兀尖角和暗色楔形折边，脚下视图无法成立为照片级近雪。
- right、rear 的局部雪坡以外是大片均匀灰色背景，地平线没有连续险峻远峰，也没有山谷与多层山脊纵深。换成黄昏天空后，缺失地形仍完全可见。
- overview 能看到有限冰川扫描片区、两侧土石颜色及沟槽；其四周截断边界也清楚可见。它可提供局部 penitentes 冰川参考，无法承担用户要求的环绕远峰主体。百万面和 8K 图集不改变覆盖范围与近景表现。

本次只能确认诊断材质结果失败；不能把它直接说成原材质对比已完成。粗糙度或颜色调整无法补回缺失的群山与扫描细节，白色平滑表面也不能作为真实雪的替代证据。

Tapado 不能替代雪山主场景，不能计入连续通过轮数，也不允许写入 panorama manifest。
