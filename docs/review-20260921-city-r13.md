# 城市 r13 独立实图审查（2026-09-21）

结论：**FAIL，不得安装 manifest，也不能称照片级真实。**

本审查针对 A800 job `167943`（COMPLETED，远端目录
`/data/home/rdc829/run/yangrunde/life_worlds/.render-work/review-city-20260921-r13`）的实际输出，未修改 manifest，未提交 GPU 作业。远端 `output-sha256.txt` 已下载到本地并逐项重算；18 项全部匹配：四张全景/天空为 `4096×2048`，晴天和黄昏各六张原生近景为 `1600×1100`，两份原生 evidence JSON 也匹配。

## 可复核证据

- 独立完整性记录：`C:\Andrew_Allender\SJTUFreshman.github.io\.render-work\review-city-20260921-r13\review-independent\integrity-check.json`。
- 独立六向晴天 contact（`1440×1440`）：`C:\Andrew_Allender\SJTUFreshman.github.io\.render-work\review-city-20260921-r13\review-independent\shelter-clear-r13-six-directions.jpg`。
- 独立六向黄昏 contact（`1440×1440`）：`C:\Andrew_Allender\SJTUFreshman.github.io\.render-work\review-city-20260921-r13\review-independent\shelter-dusk-r13-six-directions.jpg`。
- 原生近景晴天 contact（`1440×1560`）：`C:\Andrew_Allender\SJTUFreshman.github.io\.render-work\review-city-20260921-r13\review-independent\shelter-clear-r13-native-contact.jpg`。
- 原生近景黄昏 contact（`1440×1560`）：`C:\Andrew_Allender\SJTUFreshman.github.io\.render-work\review-city-20260921-r13\review-independent\shelter-dusk-r13-native-contact.jpg`。
- 独立脚本及逐张 `1440` 放大图位于同一 `review-independent` 目录；脚本为 `.render-work\review-city-20260921-r13\audit-city-r13.py`。

## 视觉判定

### 1. 城市楼体与重复 U 形破口：FAIL

六向和街道前后原生图都能看到成排规则窗格的高层方盒：同一窗洞尺寸和间距重复，外墙大块平整，缺少真实建筑之间的退台、设备、阳台和不规则损坏。街道前视中心高楼、左侧砖楼与远端低楼排列成几组模板化立面；后视中央深色楼体仍是整齐的矩形框格。此前版本重点暴露的相同 U 形破口在本轮不再成为大洞，但替代结果仍是大面积完全规则的开窗/空框，不能作为真实破败城市的修复。街道尽头在前、后视都迅速收束到灰蓝色空地平线，纵深没有可辨识的远端街区或地形。

### 2. 工厂 735 立面模块与锯齿屋顶：FAIL

原生 `factory-front-left`/`factory-front-right` 近景显示砖厂材质和拱顶窗的局部细节较稳定，但墙体窗组重复节距非常明显；右侧工厂端部与后方楼体的交界像把几段模块直接拼接。屋顶可看到一排同角度、同高度的尖齿/薄片式锯齿端墙，边缘过于干净，缺少真实厂房屋面厚度、排水、锈蚀和玻璃天窗变化。其余工业立面仍主要由平直砖墙和重复窗洞组成，因此即使脚本中接入 735 个模块，也没有转化为照片级的结构变化。

### 3. 电杆与导线（5 杆、9 跨）：FAIL（结构可见，真实度不足）

前后及左右视图能看到多根木/灰色杆件和连续导线，导线端点没有明显断裂或穿入观察者中央天空走廊；可见跨度大致沿两侧街缘分布。近景中电杆几何过于均匀、杆身像干净圆柱，横担/绝缘子细节在距离拉远后几乎消失；导线弧垂统一且重复，和悬挂灯串的线缆混在一起，未形成真实街区电力网络的层次。五根杆、九股纵向跨度的几何接入不能抵消其模板感，判定不通过。

### 4. 地面接触、碎石与火：FAIL

地面近景能看到一条细长裂缝、少量稀疏碎块和路缘块，但大面积路面是均匀深灰平面，缺少沥青颗粒、油污、积尘、轮迹和不同尺度的废墟接触。`ground` 近景里杆影和裂缝清楚，但没有足够的地面层次来支撑照片级尺度。火堆在晴天/黄昏近景可见，然而木柴表面使用高对比橙色网格/龟裂式发光纹，火焰形状过于干净；石圈下缘形成近黑色平直底部，像悬浮的资产底座。火光虽照亮地面，材质和接触仍是明显 CG 缺陷。

### 5. 晴天与黄昏一致性：FAIL

两种天空和光照都能正常渲染，晴天云层、黄昏低照度和灯串均存在；但换相后建筑、道路和道具的模板几何完全不变，低照度只把同一组平面压暗，未显出真实材料粗糙度差异。全景天顶和原生近景的下半球仍是作者生成的地面/雾色，不是可被当作实景城市远景的连续环境。

## 独立最终意见

本轮比旧版少了明显的同形 U 形大破口，工厂砖材和灯光也可辨认；但楼体仍是重复方盒，远端纵深为空，锯齿厂房屋顶像规则薄片，电杆/九跨导线像统一程序件，地面极度平整，火堆有发光网格和黑底座。任一项都足以阻止照片级验收，综合判定 **FAIL**。保持 manifest 不变，下一轮应先重做建筑体量/远端街区和工厂屋顶结构，再处理地面材料与火堆接触。
