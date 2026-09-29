# Life 页面当前方向

Life 页面已经收敛为纯交互星空：Hipparcos 星表、天文位置计算、星座连线、中心注视、星座／恒星点击和内容面板是唯一主线。

已移除：

- 全景预渲染资源与 manifest；
- Three.js、glTF loader 和场景 renderer；
- 19–25 环境脚本与场景选择器样式；
- Life 页面中的环境 canvas、场景 HUD、模型、材质和碰撞资源。

核心维护入口：

- `life.html`
- `assets/life/scripts/01-content-data.js` 至 `18-bootstrap.js`
- `assets/life/styles/01-foundation-sky.css` 至 `07-overlays-responsive.css`
- `scripts/validate-life-runtime.cjs`
- `scripts/validate-life-http.cjs`

最小验证：

```powershell
python site_renderer.py --check --life-only
node scripts/validate-life-runtime.cjs
node scripts/validate-life-http.cjs http://localhost:8765/life.html
git diff --check
```
