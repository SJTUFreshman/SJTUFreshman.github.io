# 隔离全景预览

先把 `install-panorama.py` 的 `--manifest` 和 `--output-dir` 指向仓库内同一隔离审查目录。不要使用其默认生产清单路径。需要保留其他场景时，在该目录中准备完整审查清单。

从仓库根目录运行（将示例路径替换为实际存在的清单）：

```powershell
python scripts/serve-panorama-review.py --manifest .render-work/nasa-review/catalog.json --port 8766
```

浏览器打开 <http://127.0.0.1:8766/life.html>。页面的相对资源地址仍以仓库根目录为基准。服务仅把 `/assets/life/panoramas/manifest.json` 的 GET/HEAD 响应替换为隔离清单，其他资源正常读取仓库；清单中的 `src` 也必须使用相对于仓库根目录的地址。

启动输出包含清单路径、SHA-256 和场景/时相范围。清单是启动时的固定快照，修改后须重启；所有响应带 `no-store`。服务只监听 `127.0.0.1`，拒绝生产清单本身、仓库外路径及目录遍历，不修改生产文件。按 Ctrl+C 停止。

这是本地审查，不代表安装或通过验收。连续两轮独立审查通过前，仍不得更新生产 `assets/life/panoramas/manifest.json`。

## 2026-09-22 NASA 接入预览

本地已生成的真实预览清单可直接启动：

```powershell
python scripts/serve-panorama-review.py --manifest .render-work/nasa-life-20260922-r3/preview/catalog.json --port 8766
```

此清单复制生产基线，只用 A800 `168371` 的 NASA 全景替换 `spaceship/night`；其他三个场景与生产清单一致。进入 Life 的飞船场景查看。预览含 2048/4096 两档 WebP，源高模不进入浏览器。晴天/黄昏渲染另存于该版本的 `renders/` 和 `native/`，不代表预览提供全部三相切换。

清单 SHA-256 为 `53e04e6215aeadae1b2e79414b449f9e7eba56962e1b6ad44ec472375d0f6681`。本轮已检查页面、清单和 WebP HTTP 响应及 `no-store`；浏览器工具认证错误使实际页面视觉和星座交互尚未验收。该预览不是 GitHub 线上版本，隔离目录在 `.gitignore` 中。完整审查见 [NASA 接入审查](review-20260922-nasa-integration.md)。
