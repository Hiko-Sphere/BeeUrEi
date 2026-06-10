<!-- 由多智能体竞品调研工作流生成（Be My Eyes/Seeing AI/OKO/Envision/WeWALK/biped/Aira/OrCam 等真实竞品 + 用户痛点 + SOTA）。Hiko Sphere 彦穹科技 · Li Yanpei Hiko -->

# BeeUrEi 竞品对标与超越战略

> 视障辅助赛道 · 产品战略文档 · 2026-06
> 定位一句话：**不与 NOA/.lumen 拼"感知上限"，而是用「普惠 × 端侧 LiDAR × 中文本土 × 自托管隐私远程协助」吃下全行业未解的"实时避障 + 最后几米 + 路口"刚需,用一台用户已有的 iPhone 覆盖 80% 日常出行。**

---

## 1. 赛道全景与分类

视障辅助赛道按"用户要解决的任务"可分为五类。关键事实：这五类几乎没有产品做"实时连续避障",而各类的旗舰产品在"识别/远程/导航"上已高度成熟——这决定了 BeeUrEi 的突破口在**移动安全(mobility)**而非"再造一个识别 App"。

| 分类 | 解决的任务 | 代表产品 | 形态 | 关键现状 |
|---|---|---|---|---|
| **A. AI 视觉识别** | 拍照问答/OCR/识物/识人/识币 | Be My AI、Seeing AI、Envision App、Supersense、Google Lookout | 手机 App | 成熟、多免费;均为"**一次一张照片的静态问答**",无连续避障 |
| **B. 远程人工协助** | 真人/坐席远程看画面帮忙 | Be My Eyes(志愿者)、Aira(付费坐席) | 手机 App | 二者皆"**陌生人**"协助、皆不自托管、皆无端侧避障 |
| **C. 出行避障** | 行走中实时躲障碍/过街 | OKO、WeWALK、biped NOA、.lumen、Glide、Ara | App/盲杖/穿戴/机器人 | 硬件型贵($850–€9,999);**OKO 是唯一同形态对手但只做过街** |
| **D. 可穿戴硬件** | 把摄像头/算力戴在身上 | OrCam MyEye 3、Envision Glasses、Meta Ray-Ban+BME、Ally Solos | 眼镜/夹件 | "眼镜=传感器、手机=算力"成主流;**全部无可靠避障/导航** |
| **E. 导航寻路** | 户外/室内到达目标 | Soundscape(开源)、GoodMaps、Lazarillo、NaviLens、Apple/Google Maps | App+基建 | C 端几乎全免费、靠 B2B 变现;**"最后几米/路口"全行业未解** |

**全行业三大集体盲区(= BeeUrEi 的战场)**：① 没有真正的端侧"实时连续避障"(连最强的 Meta Ray-Ban 都被 AFB 实测判定"不能替代白手杖、过街处理太慢");② LiDAR 深度几乎无人用于普惠 App(竞品要么云端拍照、要么靠 $3,500+ 专用眼镜);③ 中文/中国市场被系统性忽视(六类旗舰无一覆盖中国、无中文 POI/坐席网络)。

---

## 2. 竞品对标矩阵

### 2.1 主竞品 × 关键能力 × 价格 × 端侧/云 × 平台

| 竞品 | 类别 | 实时避障 | LiDAR/深度 | 导航 | 远程协助 | 识别 | 端侧/云 | 平台 | 价格 | 中国 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Be My AI / Be My Eyes** | A+B | ✕ | ✕ | ✕ | ✓志愿者(~15s,无SLA) | ✓强 | 云(GPT-4o) | iOS/Android | **免费**(B端付费) | ✕ |
| **Seeing AI** | A | ✕ | ✕ | ✕ | ✕ | ✓(频道化) | 端云混合 | iOS/Android | **免费** | 弱 |
| **Envision App / Glasses** | A+D | ✕ | ✕ | ✕ | ✓呼亲友/Aira | ✓ | 云 | iOS/Android+眼镜 | App免费;眼镜$1,899–3,500+$200/年 | ✕ |
| **Supersense** | A | ✕ | ✕ | ✕ | ✕ | ✓(扫描器,窄) | **端侧/离线** | iOS/Android | $4.99/月·$49.99/年·$99.99终身 | ✕ |
| **Google Lookout** | A | ✕ | ✕ | ✕ | ✕ | ✓ | 端云混合(可控网) | **仅Android** | 免费 | ✕ |
| **Aira** | B | ✕ | ✕ | ✕(坐席口述) | ✓坐席(30s SLA,NDA) | — | 云SaaS | iOS/Android | **$1.0–1.6/分钟**,$26–1,160/月 | ✕ |
| **OKO** | C | ✕(只过街) | ✕ | 仅过街 | ✕ | 信号灯/公交(窄) | **端侧** | **iOS** | $4.99/月·$29.99/年 | ✕ |
| **WeWALK 2** | C+D | △超声波(无语义) | ✕(超声ToF) | ✓杖上语音+公交 | ✕ | ✕无语义 | 部分端侧 | 盲杖+App | $850–1,150+$4.99/月 | ✕ |
| **biped NOA** | C+D | ✓✓(170°,10m) | ✓3深度相机 | ✓GPS逐步 | ✕ | ✓分层+场景描述 | **端侧** | 肩背vest(950g) | 未公开(贵)+订阅 | ✕ |
| **.lumen** | C+D | ✓✓(100次/秒) | ✓6相机+激光+深度 | ✓(部分) | ✕ | ✓含湿滑面 | 未明确 | 头戴眼镜 | **€9,999** | ✕ |
| **Glide** | C | ✓✓(15m) | ✓立体深度 | 预映射/自由 | ✕ | ✓障碍+路点(含头顶悬空物) | 未明确 | 两轮地面机器人(8磅) | $1,499+$30/月订阅(2026春起发货,已确认) | ✕ |
| **Ara** | C+D | △多层测距(无语义) | ✓LiDAR+超声 | ✕纯避障 | ✕ | ✕无语义 | 端侧(测距) | 胸带 | $1,700一次性 | ✕ |
| **Meta Ray-Ban+BME** | A+B+D | ✕(实测太慢) | ✕ | ✕不可靠 | ✓Be My Eyes | ✓ | **手机算力** | 眼镜+手机 | **$299–379** | ✕ |
| **Ally Solos** | A+D | ✕ | ✕(双目未做避障) | ✕ | ✓Ally生态 | ✓(<300ms对话) | **手机算力** | 眼镜+手机(15h续航) | $399(含1年Pro)→$599 | ✕ |
| **GoodMaps** | E | ✕ | ✓LiDAR预建图 | ✓室内~1m精度 | ✕ | ✕ | 端侧定位 | iOS/Android | **C端免费**(场馆按面积付) | ✕ |
| **NaviLens** | E | ✕ | ✕ | ✓彩色码(18m/160°) | ✕ | ✕ | 端侧扫码 | iOS/Android | 免费(需铺物理码) | ✕ |
| **Soundscape(开源)** | E | ✕ | ✕ | ✓空间音信标 | ✕ | ✕ | 端侧 | iOS(社区版) | 免费开源(MIT) | ✕ |
| **🐝 BeeUrEi** | A+B+C+E | **✓✓端侧** | **✓iPhone原生LiDAR** | **✓高德/MapKit+空间音** | **✓自托管WebRTC+亲友** | **✓频道化端侧**(文字/整页多页/识币/扫码商品库/找物/人物/颜色/光线/公交/历史，中英双语) | **✓端侧** | iOS(暂) | **零专用硬件零订阅** | **✓✓独占** |

### 2.2 各家强弱速读

- **Be My Eyes**：强=免费+真人兜底+850万志愿者+Meta独家;弱=纯云、幻觉、静态问答、无避障、曾陷"是否用于训练"争议。
- **Aira**：强=30s SLA+NDA坐席+Access Network(第三方买单);弱=**贵到引爆社区**($40/h→$100/h),个人难承受。
- **biped NOA / .lumen**：强=感知天花板(多深度相机/激光、分层避障、O&M共研);弱=**贵且笨重、不进中国、无远程协助**,NOA 仍被诟病"脚下不准需配盲杖"。
- **OKO**：强=同形态、端侧、已上架、App Store Awards 入围;弱=**只做过街窄场景**、不覆盖中国。
- **GoodMaps/NaviLens**：强=室内米级/枢纽部署;弱=**需预建图或铺物理码**(基建型,不进中国)。
- **Meta Ray-Ban / Ally Solos**：强=$299–399 击穿价格锚点、续航好、远程协助齐;弱=**无LiDAR、无避障、延迟靠云、英文生态**。

---

## 3. BeeUrEi 现状定位

**优势(护城河候选)**
1. **端侧 + LiDAR**：用 iPhone Pro 原生 LiDAR 做深度避障,是所有对手硬件上拿不到的(竞品要么云拍照、要么 $3,500+ 专用眼镜)。
2. **隐私姿态最激进**：盲人侧默认不出画面 + 录制策略门控 + 自托管后端,比 Be My Eyes/Aira(默认开盲人侧摄像头给陌生人看)更彻底,直接回应"数据外流/用于训练"争议。
3. **三合一闭环**：避障 + 导航 + 远程协助在一个 App,竞品普遍单一(用户需在多个 App 间切换)。
4. **中文本土**：深度中文语音 + 高德国内导航 + 中文 TTS + 合规自托管——六类旗舰无一覆盖,这是最现实的可超越点。
5. **自托管**：WebRTC 信令 + coturn 自建,可私有化部署,数据不过第三方云。
6. **零专用硬件、零订阅门槛即可避障**：复用用户已有 iPhone,成本结构碾压所有硬件型对手。

**劣势(必须正视)**
1. **未上架**(v0.1)——无任何真实用户、无评价、无 App Store 信任背书,是 P0 唯一目标。
2. **单平台**(仅 iOS,且 LiDAR 限 Pro 机型)——天花板受限;Lookout 仅 Android 的镜像问题。
3. **无品牌/无网络效应**——Be My Eyes 有 850 万志愿者、Aira 有 Access Network,BeeUrEi 的"亲友池"在亲友不在线时无兜底。
4. **FOV 与脚下精度天然弱项**——单 iPhone 视场窄,连 3 相机 170° 的 NOA 都被诟病脚下不准;必须诚实定位"辅助而非替代盲杖"。
5. **持续 LiDAR+CV 耗电**——续航是相对眼镜类对手的结构性劣势,需降级策略工程化。
6. **医疗/安全责任**——做 mobility aid 比做"识别 App"责任重得多。

---

## 4. 未被满足的用户痛点(突破口)

从六份调研提炼,按 ROI 排序(★=核心突破口)：

| # | 痛点 | 调研证据 | BeeUrEi 抓手 |
|---|---|---|---|
| **P1★** | **相机"瞄不准"**——盲人不知镜头对着哪,文档拍歪/被裁切,只能叫明眼人帮对准 | CHI 2024《Misfitting With AI》;Seeing AI"几乎不告诉你东西被切掉" | LiDAR+ARKit 位姿做**实时取景引导**(四角对齐音/震动、目标象限空间音)——把避障的空间感知复用到识物/读文档/找门牌,竞品最弱 |
| **P2★** | **AI 幻觉 + 验证负担 + 信息过载** | Be My AI 编造品牌;Seeing AI 读错日期;微软买 2000 万分钟视频修偏见;过量信息降信任 | **分级 verbosity + 置信度透明 + 安静模式**(只在危险时出声),"少说但说对"做成产品哲学 |
| **P3★** | **远程协助太贵**——Aira $40/h→$100/h,社区批"奢侈品" | mosen.org/airapricing | **免费亲友远程协助**(自托管 WebRTC),"日常找亲友、紧急才走人工",不按分钟计费 |
| **P4★** | **导航"最后几米"不准**——纯 GPS ~20m 误差,完不成 micro-navigation(找公交站台/门口) | TVST 公交站研究;目标精度应 ≤2m | "GPS 引导到门口附近"后**无缝切 LiDAR+视觉 micro-nav**(认门/台阶/信标),把米级做到分米级,无需铺码/预建图 |
| **P5★** | **路口/过街最难**——仅 16% 盲人能找到过街按钮,27% 绿变红人还在斑马线,97% 康复师称学员无法对准方向 | arXiv 2310.00491;StreetNav | 端侧识别人行横道线/红绿灯 + **对准方向的震动/空间音矫正**(高价值,但安全责任重需谨慎免责) |
| **P6** | **"孤儿应用"恐惧**——Soundscape 被砍,社区信任受创 | AppleVis;社区自救做 VoiceVista | **端侧离线可用 + 自托管 + 不消失承诺**:断网也能避障,不依赖大厂施舍 |
| **P7** | **动态/临时障碍盲区**——行人/车/临时招牌导航产品都不管 | StreetNav 研究点名 | LiDAR+YOLO+TTC 把**动态障碍实时注入导航语音**(避障与导航融合,独一份) |
| **P8** | **VoiceOver 顽疾/年年改版打乱肌肉记忆** | AppleVis 2024 Report Card(修 bug 仅 3.2/5) | UI **稳定可预测、少改版**、自带 onboarding、严格焦点测试 |

---

## 5. 差异化策略：BeeUrEi 如何"超越"

战略原则：**不在"感知上限"赛道烧硬件(NOA/.lumen 的红海),而在"普惠移动安全"赛道用一台手机赢。** 分三档：

### 5.1 维度打平(做到"够用",别被识别叙事带偏)
- **拍照识别/OCR/识人识币/场景描述**：对齐 Seeing AI 的频道化、Be My AI 的多轮追问——这是"入场券",不是卖点。可借 FastVLM(iPhone 16 Pro 上 0.5B 模型 TTFT<120ms)做端侧"看一眼即说"。
  **【2026-06-10 状态】频道化已达成**(文字/整页多页/识币/扫码+本地商品库/找物[私人+通用]/人物/颜色/光线/公交车头牌/识别历史,全端侧中英双语,均带置信度透明)；剩"富场景描述/照片多轮追问"依赖 VLM 决策(自托管 GPU vs 付费 API,待拍板)。TapTapSee/CamFind 类纯云拍照识别已被端侧频道覆盖且隐私占优。
- **远程视频协助**：四家有三家都有,是"必备项不是差异化项"。做到能用即可,差异化靠"亲友+自托管+隐私"而非协助本身。
- **空间音导航**：移植 Soundscape 开源(MIT)空间音信标范式 + OSM/Overpass 后端,**省一年**,别从零造。

### 5.2 维度领先(集中火力,正面取胜)
1. **端侧实时避障(主战场)**：LiDAR 深度 + YOLO 语义 + TTC/碰撞走廊动态 ROI,对标 320ms/100% 避障基准,把"**避障决策延迟(采集→检测→TTC→语音/震动)≤300ms**"做成可量化对外指标——直接戳 Meta"过街太慢"的云端延迟死穴。这是全行业空白。
2. **相机取景引导(最高 ROI)**：把空间感知复用到识物/读文档/找门牌,竞品最弱、你最强。
3. **避障+导航融合**：动态障碍实时注入导航语音 + 最后几米 LiDAR/VPS 微导航,解决 GoodMaps(需预建图)/NaviLens(需铺码)/Apple-Google(米级)全军覆没的痛点。
4. **中文本土全链路**：中文语音交互 + 高德导航 + 合规自托管,无现成对手。
5. **多通道反馈**：中文语音 + 震动 + 空间音 + AirPods 头追踪信标,采用 top/mid/low 三层高度分区(借鉴 Ara/NOA),远比竞品"只有 TTS"适合边走边用。

### 5.3 护城河(可持续壁垒,从难到易复制排序)
1. **iPhone 原生 LiDAR 端侧避障**(技术+硬件壁垒最高)——对手要么没深度传感器,要么深度只能落在 iPhone 端,反而强化"必须配 iPhone"叙事;长期若做外接眼镜,深度仍锚定 iPhone。
2. **中文 + 高德 + 自托管合规**(本地化壁垒,海外对手短期补不上)。
3. **自托管隐私 + 亲友闭环**(信任壁垒,Be My Eyes/Aira 的陌生人模式没打的差异化)。
4. **避障+导航+协助三合一闭环**(集成壁垒,竞品单一)。

> **诚实边界**：BeeUrEi 必须明确"**辅助而非替代盲杖/导盲犬**"。连 NOA(3 深度相机 170°)都被诟病脚下不准、仍需盲杖;单 iPhone FOV 更窄。把"脚下落差/台阶/路缘"作为重点攻关并诚实免责,是避免过度承诺反噬的前提。

---

## 6. 分阶段路线图

> 标注：【端】=iPhone 端侧可独立做;【外】=需外部资源(后端/地图 API/机构/O&M 专家/审核)。

### P0 — 上架就绪(0–3 个月) · 目标：把 v0.1 变成 App Store 上能装、能用、敢免责的真产品

| 可交付项 | 端/外 | 衡量指标 |
|---|---|---|
| App Store 审核通过(含隐私清单、医疗免责、无障碍声明) | 【外】审核 | 上架成功;首版通过率 |
| VoiceOver 全流程可用 + 焦点管理严格测试 + onboarding 教程 | 【端】 | VoiceOver 关键路径 100% 可达;无 focus jumping |
| 避障核心离线可用(断网仍能 LiDAR+YOLO 报警) | 【端】 | 飞行模式下避障闭环正常 |
| 隐私开关粒度(端侧默认/上云可控/限 WiFi 或移动网/彻底关闭,对齐 Lookout) | 【端】 | 设置项齐全;默认不上云 |
| 避障语音分级 + 置信度透明 + 安静模式(对冲幻觉信任危机) | 【端】 | 低置信说"可能/不确定";安静模式只在危险出声 |
| 续航降级策略(动态降帧、走廊 ROI 限算) | 【端】 | 持续避障耗电 ≤30%/小时;过热不崩 |
| 远程协助亲友闭环 + 多亲友轮询 + 离线降级到 AI | 【外】信令/coturn | 接通成功率;亲友不在线时降级路径可用 |

**P0 完成定义**：一个未受过训练的视障用户能独立装好、走通避障/识物/呼叫亲友三条主路径,且产品在断网下仍保护其安全。

### P1 — 核心体验领先(3–9 个月) · 目标：在"避障+取景引导"两个最高 ROI 点上做到可量化领先

| 可交付项 | 端/外 | 衡量指标 |
|---|---|---|
| **相机取景引导**(四角对齐音/震动、目标象限空间音、是否被裁切) | 【端】 | 盲人独立拍文档成功率 vs Seeing AI 提升;无明眼人协助完成率 |
| **避障延迟基准化**:采集→检测→TTC→反馈 ≤300ms,对外公开 | 【端】 | 端到端报警延迟 P50/P95;对标 320ms/100% |
| top/mid/low 三层高度分区反馈(头顶/胸前/脚下) | 【端】 | 三层障碍区分准确率;误报率(碰撞走廊只报路径内) |
| 单目深度降级兜底(无 LiDAR 机型用 Depth Anything 系) | 【端】 | 非 Pro 机型覆盖;降级模式 FPS≥可用阈值 |
| **引入 O&M 定向行走专家共研 + 量化验证**(对标 Ara"减少撞击80%/受伤30%") | 【外】O&M 专家 | 实测减少撞击率;受伤风险下降;盲杖协同满意度 |
| 过街信号灯/人行横道识别子模块(吸收 OKO 能力) | 【端】 | 信号灯识别准确率;倒计时播报 |

**P1 衡量主线**：避障延迟、取景引导成功率、撞击减少率——三项可量化领先即达成"核心体验领先"。

### P2 — 差异化/生态(9–18 个月) · 目标：把"避障+导航融合"和"中文本土+隐私"做成别人补不上的护城河

| 可交付项 | 端/外 | 衡量指标 |
|---|---|---|
| **避障+导航融合**:动态障碍(行人/车/临时招牌)实时注入导航语音 | 【端】 | 动态障碍召回率;导航中漏障率 |
| **最后几米 micro-navigation**:GPS 到门口后切 LiDAR/视觉 VPS 找入口/门/台阶 | 【端】 | 终点逼近误差(目标 ≤2m→分米级);找门成功率 |
| 移植 Soundscape 开源空间音信标 + 高德 POI(国内)/OSM(海外) | 【外】高德/OSM | 信标可用区域;偏航重规划成功率 |
| 路口对准矫正(震动/空间音,谨慎免责)——业界最难、最高价值 | 【端】+【外】合规 | 对准误差;过街方向矫正成功率(限非承诺安全口径) |
| 湿滑面/水洼/台阶识别(借鉴 .lumen) | 【端】 | 识别准确率;误报率 |
| B2B Access 点模式(商超/政务/银行/机构采购,对标 GoodMaps/Aira Access) | 【外】机构 BD | 签约场馆数;机构采购金额(避免向视障个人收费) |
| 安卓版评估(对标 Lookout 仅 Android 的镜像问题) | 【外】 | 市场覆盖扩大评估结论 |

### P3 — 硬件/规模(18 个月+) · 目标：在软件验证后,审慎进入外接形态与规模化

| 可交付项 | 端/外 | 衡量指标 |
|---|---|---|
| 外接眼镜形态评估(眼镜=传感器、手机=算力,对标 Meta/Ally Solos) | 【外】供应链 | 深度仍锚定 iPhone 端,强化"必须配 iPhone";原型续航/重量 |
| 商业化:C 端避障/导航免费,远程协助/亲友增值订阅(对标全行业 C 端免费+B2B) | 【外】 | 订阅转化;B2B 营收占比 |
| 志愿者/亲友网络规模化兜底(补"亲友不在线"短板) | 【外】运营 | 兜底接通率;响应时延 |
| 多城市高德 POI/无障碍数据补全(门/坡道/公交站台目标级对象) | 【外】数据 | 目标级 POI 覆盖城市数 |

---

## 7. 风险与合规

| 风险域 | 具体风险 | 缓解措施 |
|---|---|---|
| **医疗/安全免责** | 做 mobility aid 责任远重于识别 App;Meta 明确"不允许当专用 mobility aid";NOA/.lumen 都强调需配盲杖 | 产品内显著免责:"**辅助工具,不替代盲杖/导盲犬,不保证安全**";路口/过街措辞尤其谨慎;onboarding 强制告知;保留事故日志策略 |
| **隐私** | Be My Eyes 曾陷"是否用于训练"争议被迫整改(明确不训练+自动删除时限+opt-out) | 盲人侧默认不出画面;录制策略门控;自托管不过第三方云;明确"端侧数据不用于训练";给删除时限与 opt-out |
| **测绘/地图法规(中国)** | 国内地图/坐标/采集受测绘法约束;海外开源地图后端不能直接用于中国 | 国内走高德合规 Web 服务;不自行采集/上传精确地理坐标做地图;海外/国内地图后端分流 |
| **无障碍标准** | 需满足 WCAG 与 Apple Accessibility(VoiceOver/动态字体/对比度);App Store 审核对无障碍声明趋严 | 对齐 WCAG 2.x AA;VoiceOver 全路径测试;UI 稳定少改版(别复制 Apple"年年打乱布局");随版本回归测试 |
| **AI 幻觉责任** | LLM 答得"像权威"诱导过度信任,错误代价高(厕所标识读反等羞辱性错误) | 置信度透明、低置信明确"不确定"、危险才出声;关键识别给"无法确认"而非硬编 |
| **续航/过热** | 持续 LiDAR+CV 高耗电,可能过热降频甚至崩溃,影响避障可靠性 | 降级策略(降帧/ROI 限算/单目兜底);耗电作为公开指标管理;过热保护不中断核心避障 |
| **单平台依赖** | 仅 iOS + 限 Pep LiDAR 机型,天花板与"孤儿应用"风险 | 端侧离线可用 + 不消失承诺;P2 评估安卓/单目降级扩大覆盖 |

---

## 8. 关键来源清单

**AI 视觉**
- Be My AI 介绍 https://www.bemyeyes.com/blog/introducing-be-my-ai/ ;隐私争议 https://www.applevis.com/forum/ios-ipados/be-my-eyes-privacy-can-you-opt-out-model-training
- Seeing AI https://www.microsoft.com/en-us/ai/seeing-ai ;Android 发布 https://blogs.microsoft.com/accessibility/seeing-ai-app-launches-on-android-including-new-and-updated-features-and-new-languages/
- Envision 免费 App https://www.letsenvision.com/blog/envision-app-now-free-for-everyone
- Supersense https://www.supersense.app/
- Google Lookout https://support.google.com/accessibility/android/answer/9031274
- 行业空缺(实时避障/NaviGPT) https://pmc.ncbi.nlm.nih.gov/articles/PMC11727231/ · https://arxiv.org/pdf/2503.15494

**远程协助**
- Be My Eyes(Wikipedia) https://en.wikipedia.org/wiki/Be_My_Eyes ;610万融资 https://www.bemyeyes.com/news/be-my-eyes-raises-6-1-million-to-accelerate-adoption-of-its-ai-powered-accessibility-products/
- Aira 定价 https://aira.io/pricing/ ;Access 伙伴 https://aira.io/our-partners/ ;Aira 涨价社区批评 https://mosen.org/airapricing/

**出行避障**
- OKO https://apps.apple.com/us/app/oko-ai-copilot-for-the-blind/id1583614988
- WeWALK https://wewalk.io/en/product/ · TDK https://www.tdk.com/en/featured_stories/entry_084-WeWALK-Smart-Cane-2.html
- biped NOA(SightCity 实测) https://www.applevis.com/forum/assistive-technology/my-sightcity-impressions-about-noa-mobility-device-biped-ai
- .lumen https://www.dotlumen.com/glasses
- Glide https://glidance.io/product/
- Ara https://www.strap.tech/the-device

**可穿戴硬件**
- OrCam MyEye 3 Pro https://www.orcam.com/en-us/orcam-myeye-3-pro
- Envision Glasses https://www.letsenvision.com/glasses/home
- Meta Ray-Ban + Be My Eyes https://www.bemyeyes.com/be-my-eyes-smartglasses/
- **AFB 实测"不能替代白手杖"(最关键)** https://afb.org/aw/fall2025/meta-glasses-review
- Ally Solos https://www.ally.me/glasses/solos

**导航**
- Soundscape 开源/停服 https://www.applevis.com/blog/microsoft-discontinue-its-soundscape-app-make-code-available-open-source-software · GitHub https://github.com/microsoft/soundscape · VoiceVista https://drwjf.github.io/vvt/index.html
- GoodMaps LiDAR https://goodmaps.com/newsroom/lidar-mapping-for-precise-indoor-navigation/
- NaviLens/AFB https://afb.org/aw/march2023/navilens
- Lazarillo https://lazarillo.app/
- Google Maps Lens(MWC2024) https://blog.google/outreach-initiatives/accessibility/ai-accessibility-update-gaad-2024
- "最后几米"研究 https://pmc.ncbi.nlm.nih.gov/articles/PMC3435951/ · 路口难题/StreetNav https://arxiv.org/html/2310.00491v2

**SOTA + 痛点**
- Apple FastVLM(端侧<120ms TTFT) https://machinelearning.apple.com/research/fast-vision-language-models · GitHub https://github.com/apple/ml-fastvlm
- 检测+深度二合一空白 https://arxiv.org/html/2507.08165 · 单目深度移动端实时 https://arxiv.org/html/2501.11841v4
- 320ms/100% 避障基准 https://pmc.ncbi.nlm.nih.gov/articles/PMC11933268/
- **相机瞄不准《Misfitting With AI》(CHI 2024)** https://arxiv.org/html/2408.06546v1
- 微软修 AI 偏见(买2000万分钟视频) https://www.thenews.com.pk/latest/1403570-how-microsoft-is-fixing-ai-bias-in-blind-representation
- 公交站 micro-navigation https://tvst.arvojournals.org/article.aspx?articleid=2793285
- AppleVis 2024 Report Card https://www.applevis.com/blog/apple-vision-accessibility-2024-applevis-report-card
