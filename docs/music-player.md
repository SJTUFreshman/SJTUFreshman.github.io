# 随身听

播放器位于页面右上角、导航栏下方，点击随身听入口向下展开。界面与 index 页共用白底、淡蓝／粉色点缀、细边框卡片和轻阴影；英文使用 Newsreader／IBM Plex Sans，中文使用兰米楷体及 WenKai 补字。首次访问不自动播放，点击播放后开始。支持歌单搜索、选曲、上一首／下一首、拖动进度、音量／静音、列表循环／单曲循环／随机播放，以及系统媒体按键。

首批收录张祺然的 38 段演唱，按发布日期倒序排列。保留短视频片段及军训晚会的完整音轨；没有猜测未注明的曲名。排除了人物小传、日常短片、开箱、篮球和柯泯薰本人现场。原视频链接保存在歌单中，播放器可直接打开。

## 连续播放

`index.html`、`life.html`、`observatory.html` 首次打开时通过 `location.replace` 进入 `assets/music/shell.html`。外层持有唯一的 audio 元素，内层 iframe 加载原页面。外层通过 History API 保留原页面 URL；内层通过 `location.replace` 切页，避免在浏览器历史中重复插入 iframe 导航。

`page-bridge.js` 接管内部链接，`StellarTransit` 在转场完成时交给同一导航入口。切换主页与 Life、浏览器前进／后退均不销毁 audio，也不会重新加载正在播放的曲目。哈希定位和页面标题同步到地址栏；目录前缀和查询参数保留。观景页共享此机制。

`sessionStorage` 记住本标签页的曲目、时间、音量、播放模式和播放状态，供刷新后恢复。浏览器若限制刷新后的自动播放，会提示点击继续；普通页面间切换无需再次播放。没有 JavaScript 时仍展示原页面；`?music=off` 可绕过外层播放器，便于独立页面调试和既有页面测试。播放器 HTML 加载失败时外层显示直接访问原页面的链接。

## 更新曲库

曲库位于 `assets/music/library.json`，音频按歌手 ID 放在独立目录，播放器自动读取歌手列表，不需要修改界面逻辑。

当前筛选及曲目名称记录在 `scripts/music-selection.json`。使用系统 PATH 中的 ffmpeg / ffprobe 和 Node.js：

```powershell
node scripts/import-music.cjs "C:\Users\Administrator\Desktop\张祺然"
```

AAC 音轨直接复制为支持流式播放的 M4A，不重复压缩；其他编码会转换为 AAC。原视频不修改。脚本核对时长和单文件 25 MiB 限制；未审核的新视频会停止导入，避免混入非演唱内容。

新增歌手时，新建相同格式的筛选文件，以视频 BV 号为键，在 `tracks` 中填写曲名等信息，在 `excluded` 中记录不收录的视频，然后执行：

```powershell
node scripts/import-music.cjs "D:\新歌手的视频" new-artist "歌手名字" "scripts/new-artist-selection.json"
```

导入仅更新对应歌手，保留其他歌手。部署时需要包含 `library.json`、播放器资源以及全部 M4A；Cloudflare Pages 的静态资源白名单已包含 `.m4a`。

播放器使用独立的小字体子集，覆盖界面文字和曲库中所有中文。新增曲目后执行 `python scripts/build-music-fonts.py` 更新 `assets/music/fonts/`，或用 `--check` 检查覆盖。脚本依赖 fontTools 与 Brotli，复用 `.render-work/` 中缓存的原始字体并校验 SHA-256；不修改主页或 Life 字体。原字体为 [兰米标准楷体简繁](https://font-99.zhaozi.org/9/9/994564c835872e6704691738983a393a.htm)（`LANMI_yujian2_jianfan.ttf`）和 [LXGW WenKai v1.530](https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530)（`LXGWWenKai-Regular.ttf`）。

## 验证

```powershell
node scripts/validate-music-player.cjs
python scripts/prepare-cloudflare-pages-tests.py
```

浏览器测试使用 Playwright 与 Chrome，可通过 `PLAYWRIGHT_MODULE_PATH` 和 `CHROME_EXECUTABLE_PATH` 指定本机安装位置。覆盖实际音频播放、两种进入方向的跨页连续播放、前进后退、刷新恢复、暂停及选曲、搜索、音量、播放模式、失败提示和窄屏布局。
