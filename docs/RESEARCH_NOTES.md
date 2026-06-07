# BeeUrEi 调研笔记（PLAN.md 的支撑材料）

> 由多智能体联网调研生成，附事实核查。供查证与深入阅读，正式计划见 [PLAN.md](PLAN.md)。


## 一、事实核查与纠偏

- **[confirmed]** LiDAR 机型为 iPhone 12 Pro / 12 Pro Max 起的所有 Pro 机型(及 iPad Pro 2020 起)；非 Pro 机型无 LiDAR，需纯视觉降级。
  - 结论：准确。LiDAR 仅内置于 iPhone Pro/Pro Max 机型，自 iPhone 12 Pro (2020) 起连续到 16 Pro/17 Pro，以及 iPad Pro 2020 起。标准版与 Plus 机型均无 LiDAR。因此 BeeUrEi 若依赖 LiDAR 会把可用机型缩小到 Pro 线（市场占比约三分之一量级），非 LiDAR 机型必须有纯 RGB/单目深度降级方案——这是架构层面必须坐实的事实，不是可选项。
  - 来源：https://blog.fenstermaker.com/what-cell-phones-have-lidar/ ; https://www.applevis.com/forum/ios-ipados/use-lidar-sensor-iphone-pro-model
- **[confirmed]** 单目深度估计可端侧实时：Apple 官方 Core ML 版 Depth Anything V2 small 在 iPhone 上约 30 ms/帧 (≈29-33 FPS)，iPhone 12 Pro Max 31.1ms / iPhone 15 Pro Max 33.9ms，FP16 49.8MB，主算力为 Neural Engine。
  - 结论：逐项核实通过。Apple 官方 Hugging Face 页确认 FP16 small 版：iPhone 12 Pro Max 31.10ms、iPhone 15 Pro Max 33.90ms、M1 Max 32.80ms、M3 Max 24.58ms，主算力单元均为 Neural Engine；模型 24.8M 参数、FP16 49.8MB、输入 518×396。但务必注意两点：(1) 这是相对深度(relative depth)，非可靠绝对米数(见单独一条更正)；(2) 这些数字只测到 12 Pro Max 这类高端机，更老的非 Pro 机型(iPhone 11/SE/A13-A14)无官方数据，且这是‘单独跑深度一个模型’的帧率，不是‘检测+深度两个模型同时跑’的帧率。
  - 来源：https://huggingface.co/apple/coreml-depth-anything-v2-small ; https://www.promptlayer.com/models/coreml-depth-anything-v2-small
- **[confirmed]** Depth Anything V2 给出相对深度，可用于‘前方近/远’相对避障分级，绝对距离不如 LiDAR 可信。
  - 结论：正确且应被提升为安全级警示，而非脚注。学术界共识：单张单目 RGB 图像在数学上无法恢复绝对米制尺度(scale ambiguity，ill-posed 问题)——它能给相对形状/远近排序，但给不出可信的真实距离。对避障‘还有几米撞上’这种安全攸关判断，相对深度根本不够；要恢复米制需引入 IMU/惯性、焦点栈或语言先验等额外信息。结论:非 LiDAR 机型若只靠 Depth Anything，避障是‘相对预警’级别而非‘测距’级别，安全边界明显低于 LiDAR 机型，产品必须据此分级告知用户而非一视同仁地宣称‘全机型避障’。
  - 来源：https://www.mdpi.com/2073-431X/14/11/502 ; https://arxiv.org/pdf/2601.01457
- **[confirmed]** WebRTC 视频通话必需信令(signaling) + STUN + TURN；移动网络下约 10-20% 呼叫因 NAT/防火墙必须经 TURN 中继，故‘端侧不依赖服务器算力’≠‘无需任何服务器’。
  - 结论：准确。多个 WebRTC 行业来源一致:约 15%(范围 10-20%，受限网络/移动运营商可达 30-40%)的连接无法直连、必须经 TURN 中继；几乎没有生产级 WebRTC 服务能省掉 TURN。关键澄清对 BeeUrEi 成立:STUN/TURN/信令只做网络穿透与媒体转发、不做任何 AI 推理，因此‘所有 AI 推理在端侧’与‘通话需要轻量信令+TURN 后端’并不矛盾。对外宣传切勿说‘完全无服务器’，否则与物理现实不符且可能构成误导。
  - 来源：https://www.videosdk.live/developer-hub/webrtc/turn-server-for-webrtc ; https://www.nojitter.com/know-where-turn-when-deploying-webrtc
- **[corrected]** Twilio Programmable Video 已于 2024 年 12 月 EOL，新项目不应再选。
  - 结论：过时/已被推翻。Twilio 原定 2024-12-05 EOL，但在收到客户反馈后已‘反悔’,将 EOL 延期两年至 2026-12-05，并公开表示 Twilio Video 将作为独立产品继续投入(‘back from the dead’)。所以截至 2026 年中，该产品仍在支持期内。不过对一个全新的、长期(>1.5 年)项目而言,选一个 EOL 已排到 2026-12 且曾经反复横跳的供应商风险依然偏高，‘不优先选 Twilio’的实操结论仍成立，但理由应改为‘供应商承诺反复、剩余生命周期短’，而非‘已停服’。
  - 来源：https://help.twilio.com/articles/24158233644443 ; https://bloggeek.me/twilio-programmable-video-back/ ; https://www.twilio.com/en-us/changelog/-twilio-video-will-remain-a-standalone-product
- **[corrected]** MKDirections(.walking) 全程在端侧调用 Apple 地图服务获取一次路线后即可离线播报，不需要自建服务器算力，符合‘不依赖远程算力’约束。
  - 结论：措辞误导，需纠偏。MKDirections 的路线计算是在 Apple 的服务器端完成的(发起时必须联网)，不是端侧算法；只是‘拿到路线之后’的进度判断/语音播报可离线。因此准确表述应为:‘路线检索依赖 Apple 在线服务(非自建 GPU 推理)，首次出发需联网；离线只覆盖已下载路线的播报’。它并不满足严格意义的‘纯端侧/可完全离线导航’——若 BeeUrEi 的硬约束要求导航也完全离线，则 MKDirections 不达标，需预下载 OSM + 端侧路由引擎。约束边界应明确区分‘AI 推理端侧’与‘地图/路线检索可联网’两件事。
  - 来源：https://developer.apple.com/documentation/mapkit/mkdirections ; https://medium.com/@garejakirit/mastering-mapview-in-ios-with-swift-a-complete-guide-53f32112426f
- **[confirmed]** 城市峡谷 GPS 水平误差实测 7-18m、偶发近 100m；视障者慢步速更易 GPS 漂移，足以把人引向车流——是导航维度最严重安全问题。
  - 结论：成立，且是本项目最高安全风险之一。这类米级误差在贴近高楼/树荫处确属常见，叠加 CLHeading 磁干扰(可瞬时偏差数十度)，足以让 App 误判用户已过马路/站错路侧。正确的工程结论:必须用 horizontalAccuracy 做‘置信度门控’，精度差时禁止任何‘现在过马路/现在转向’的高确定性指令，降级为宽容的空间音信标+地标/路口语音让用户自我校准。GPS 误差本身是真实物理限制，不能靠算法完全消除。
  - 来源：https://pmc.ncbi.nlm.nih.gov/articles/PMC6638960/
- **[confirmed]** 业内共识:导航 App 与智能手杖都不能替代白手杖与定向行走(O&M)训练，只是互补层；BeeUrEi 必须定位为辅助工具、保留白手杖/导盲犬。
  - 结论：完全成立，是不可逾越的安全/合规红线。多个权威来源(O&M 专业实践、视障辅具评测)一致:智能避障/导航是‘补充层(complementary layer)’，白手杖与 O&M 训练仍是安全出行的标准(standard of care)。且文献明确指出一个直接危险点——很多避障 App 不考虑步速,可能在用户已撞上障碍后才报警。把摄像头避障当‘安全保障’而非‘感知增强’会直接触发产品责任风险并被 App Store Guideline 1.4.1(身体伤害)更严格审查。产品必须在 onboarding/协议/关键时刻反复显著告知局限，避免任何绝对化安全承诺。
  - 来源：https://floridareading.com/blogs/news/smart-canes-vs-navigation-apps-choosing-the-right-solution-for-independence ; https://www.applevis.com/forum/ios-ipados/introducing-obstacle-detector-app-travel-tools-blind-obstacle-distance-detection
- **[confirmed]** 中文区 POI/盲道数据获取难:高德盲道数据商业闭源，OpenStreetMap 在中国覆盖与合规(测绘资质)受限，端侧离线地图数据来源是工程与合规难点。
  - 结论：成立，且实际比 JSON 描述更严峻。据《中华人民共和国测绘法》,自 2002 年起私自测绘在中国大陆即属违法,OSM 官方也声明在华众包测绘存在合规风险，2006-2011 年间已有近 40 起涉外非法测绘案被起诉(罚款至 20 万元、严重者刑事追责)。此外中国法定坐标系 GCJ-02 对 WGS-84 原始 GPS 坐标施加 100-700m 的强制偏移——意味着即便拿到 iPhone 原始 GPS，叠加到任何中国合规地图上都会错位百米级，必须做坐标纠偏。结论:在中国大陆做‘纯端侧离线步行导航’同时面临数据来源、测绘合规、坐标系三重障碍，应作为可行性的重大开放风险对待，可能需要对‘导航’放宽端侧约束并接入持牌图商(高德/百度)。
  - 来源：https://en.wikipedia.org/wiki/Restrictions_on_geographic_data_in_China ; https://wiki.openstreetmap.org/wiki/China
- **[confirmed]** 对每一帧都跑 Core ML 会卡顿/掉帧/发热;连续摄像头+ANE 推理能耗高，过热会降频，需监听 thermalState 分级降级，critical 时停摄像头。
  - 结论：成立。多来源印证:持续摄像头+多模型 ANE 推理会快速积热触发 CPU/GPU 降频与掉电，必须帧节流(10-15fps)、模型变小、监听 thermalState 主动降级。但需补一条 JSON 低估的现实:BeeUrEi 的避障要‘检测+深度’两个模型同时连续跑，而所有官方/社区 fps 数字几乎都是单模型测得；双模型并发会进一步抬高发热与功耗、压低实际帧率，因此‘单模型 30fps’不能直接推断‘检测+深度也能实时’。真实可行性必须在目标机型上对‘双模型并发+长时间步行’做实测,尤其要测非 Pro 旧机的发热/温控关机表现。(注:某搜索摘要称‘30fps 功耗是 15fps 的一半’,与‘高帧率更费电’的常识及节流建议矛盾，疑为表述错误，不应采信;低帧率省电的方向才是对的。)
  - 来源：https://medium.com/@umairzahid508/performance-battery-optimization-under-ai-sensor-load-in-ios-4d5e39dea2b2 ; https://blog.roboflow.com/best-ios-object-detection-models/

### 必须强调的注意事项

- 安全定位是不可逾越的红线:摄像头/LiDAR 避障必须明确定位为‘感知增强的辅助工具’，绝不能宣传或暗示为‘安全保障’或‘可替代白手杖/导盲犬/O&M 训练’。文献明确避障 App 常不考虑步速、可能在用户已撞上后才报警;漏检(低矮路桩、台阶、玻璃门、悬空招牌、移动车辆)是必然存在的。误导致伤将触发产品责任并被 App Store Guideline 1.4.1 严格审查。onboarding/协议/关键场景须反复显著告知局限并取得知情同意。
- 非 LiDAR 机型的避障可靠性存在结构性下限,不能与 Pro 机型同等承诺:单目 RGB 只能给相对深度(数学上无法恢复绝对米制尺度),‘还有几米撞上’这种安全判断在非 Pro 机型上不可靠。要么把可用人群收敛到 LiDAR Pro 机型、要么明确把非 Pro 机型的避障降级为‘相对远近预警’并据此调整安全话术,切勿一刀切宣称‘全机型实时避障’。
- ‘端侧不依赖服务器算力’必须与‘无需任何服务器/完全离线’严格区分,否则架构与宣传都会出问题:(a) 远程志愿者视频在物理上必须有信令+TURN 中继(约 15% 呼叫必走中继),这是网络通信非 AI 推理,可保留;(b) MapKit/MKDirections 的路线计算在 Apple 服务器端完成、首次需联网,不是端侧算法。对外口径应为‘所有 AI 推理在设备端;通话信令/TURN 与地图路线检索走网络但不做 AI 推理’。
- 端侧实时避障的真实可行性尚未被‘检测+深度双模型并发’验证:所有官方 fps(如 Depth Anything ~30fps、YOLO11 60-85fps)都是单模型、且多在 12 Pro Max 这类高端机测得。双模型同时连续跑会显著抬高发热/功耗并压低帧率,更老的非 Pro 机(A13-A14、SE/11)无任何官方数据。上线前必须在目标最低机型上实测‘双模型并发+长时间步行’的帧率、端到端延迟与温控关机表现,这是可行性而非优化问题。
- 城市峡谷 GPS 漂移(7-18m、偶发近 100m)叠加磁力计航向干扰是导航维度最高安全风险:必须用 horizontalAccuracy 做硬门控,精度差时绝对禁止下达‘现在过马路/现在转向’的高确定性指令,改为宽容的空间音信标+地标自校准。
- 在中国大陆做纯端侧离线步行导航面临三重硬障碍:测绘法(私自测绘违法、OSM 在华合规风险、已有涉外起诉先例)、数据(高德盲道闭源、OSM 覆盖稀疏)、坐标系(GCJ-02 对 WGS-84 强制 100-700m 偏移需纠偏)。很可能必须对‘导航’放宽端侧/离线约束并接入持牌图商,而把纯端侧硬约束保留给‘避障’;此为重大可行性风险,应在立项阶段就决策。

## 二、分维度调研发现


### 竞品调研 (Competitive Landscape)

视障辅助赛道已分化为四类玩家：(1) 远程协助类（Be My Eyes、Aira），靠真人/云端 AI；(2) 场景识别类（Seeing AI、Google Lookout、Envision），核心是 OCR/物体识别/场景描述；(3) 导航类（Soundscape、Lazarillo、WeWALK、高德视障导航），核心是 POI 播报与路线规划；(4) 专项避障/安全类（OKO 红绿灯、Super Lidar 等 LiDAR 避障）。BeeUrEi 的差异化在于把"实时避障 + 步行路线导航 + 远程志愿者视频"三合一，且强约束全部 AI 端侧推理。关键发现是：业内几乎没有一款产品同时做好这三件事且坚持纯端侧——OKO 已验证端侧 Core ML 在专项识别上的可行性（2024 Apple Design Award），Soundscape 提供了开源的端侧空间音频导航范式，Be My Eyes 则定义了志愿者视频的体验标准。最值得避免的坑：导航类普遍依赖云端地图/POI 与持续联网；远程协助类商业模式重（Aira 按分钟付费），而 Be My Eyes 靠 B2B 企业客服补贴免费 C 端。对 iOS 新手而言，最可复用的技术资产是 Soundscape 开源 Swift 代码、Apple 原生 ARKit/LiDAR 深度 API、Core ML、AVAudioEngine 空间音频与 MapKit 步行路线。

**要点：**

- (high) **Be My Eyes —— 志愿者视频 + 端云 AI 的标杆，定义了体验与商业模式** — 核心功能：免费连接全球 850 万明眼志愿者（支持 185 种语言、24/7），呼叫时建立单向视频+双向语音；2023 年推出 Be My AI（基于 OpenAI GPT-4，云端），可拍照后多轮自然语言问答。用户超 75 万视障者，覆盖 150+ 国家。技术路线：志愿者视频走云端转发，AI 描述走云端 GPT-4（非端侧）。做得好：志愿者匹配与等待时长体验、企业级 Specialized Help（用户可直连微软/谷歌等客服）。诟病：完全依赖联网与第三方 LLM、隐私（图像曾保留，Winter'25 改为 30 天后删除）、无实时避障/导航能力。商业模式：C 端永久免费，靠 B2B（Be My Eyes for Business/Work，企业客服与无障碍）+ 企业志愿者项目变现，已融资约 6.1M USD。对 BeeUrEi 启示：志愿者视频应作为'端侧能力不足时的兜底'而非主入口，且需把'明眼志愿者众包免费 + 后期 B2B 补贴'作为可持续模型参考。
  - 来源：https://www.bemyeyes.com/ ; https://www.bemyeyes.com/business/ ; https://en.wikipedia.org/wiki/Be_My_Eyes
- (high) **Microsoft Seeing AI —— 多'频道(channel)'场景识别的经典 IA，部分端侧** — 核心功能：以'频道'组织任务——Short Text（实时朗读眼前文字）、Documents（引导拍整页并保留排版朗读）、Products（条码 + 蜂鸣引导）、Scenes（场景描述 + 手指触屏探索物体方位）、People、Currency、Colors、Handwriting。免费，2024 年上线 Android，语言扩到 36 种。技术路线：短文本/条码/颜色等轻量识别在端侧实时跑，丰富场景描述与新一代生成式描述偏云端。做得好：'频道'式信息架构对盲人极友好（一个手势切换任务）、音频蜂鸣引导对准目标的交互、完全免费且大厂背书。诟病：无导航、无避障、无志愿者；丰富描述需联网。商业模式：微软免费投入（无障碍 CSR）。对 BeeUrEi 启示：直接借鉴'频道/模式切换 + 蜂鸣音引导对准'的交互范式；BeeUrEi 的避障/导航/求助三大功能可设计成类似可一键切换的模式。
  - 来源：https://blogs.microsoft.com/accessibility/seeing-ai-app-launches-on-android-including-new-and-updated-features-and-new-languages/ ; https://www.microsoft.com/en-us/garage/wall-of-fame/seeing-ai/
- (high) **Google Lookout —— 七模式、核心体验端侧、含方向+距离的 Find 模式** — 核心功能：Text/Documents/Explore/Currency/Food labels/Find/Images 七模式。Find 模式（beta）让用户选 7 类目标（座椅、桌子、卫生间等），转动摄像头时播报目标的方向与距离——与 BeeUrEi 寻路/避障最相关。Images 模式可拍照生成 AI 描述并追问。技术路线：官方明确'核心体验在设备端处理，可离线使用'，30+ 语言，支持 Android 6+。做得好：纯端侧/离线、隐私好、Find 模式的方向+距离播报是导盲交互的优秀范式。诟病：仅 Android（BeeUrEi 是 iOS，可错位竞争）、生成式描述仍需联网、无步行路线导航、无志愿者。商业模式：谷歌免费（无障碍投入）。对 BeeUrEi 启示：Find 模式的'方向+距离实时播报'几乎是 BeeUrEi 端侧避障的直接参照；其'核心端侧可离线'正好印证 BeeUrEi 硬约束在工程上可行。
  - 来源：https://blog.google/company-news/outreach-and-initiatives/accessibility/ai-accessibility-update-gaad-2024/ ; https://support.google.com/accessibility/android/answer/9031274
- (high) **Microsoft Soundscape（已开源）—— 端侧 3D 空间音频导航范式，Swift 代码可直接学习** — 核心功能：用 3D 空间化音频（而非逐步 GPS 语音）增强环境感知——让用户'听'到 POI 在哪个方向/距离，自行构建心智地图；支持音频信标(beacon)指向目的地。微软 2023 年初停服并开源（github.com/microsoft/soundscape），社区接力 soundscape-community/soundscape，并衍生出 App Store 上的 VoiceVista('Soundscape Resurrection')。技术架构：代码 96% Swift（极适合 iOS 新手参照），iOS 客户端在 /apps/ios，POI 数据来自 OpenStreetMap (OSM)，含 VibroGuide 触觉反馈；空间音频是其灵魂。做得好：完全可复用的开源 Swift 工程、空间音频信标交互、OSM 免费数据、'探索式'而非'指令式'导航理念。诟病：原版无避障、无志愿者、无端侧视觉 AI（纯定位+地图）；停服后官方不再维护，需自行处理 OSM 数据服务。对 BeeUrEi 启示：这是最重要的可复用资产——可直接研究其 AVAudioEngine/空间音频实现与 OSM POI 拉取，把'信标指向目的地'用于 BeeUrEi 的步行导航。
  - 来源：https://github.com/soundscape-community/soundscape ; https://github.com/microsoft/soundscape ; https://drwjf.github.io/vvt/index.html
- (high) **WeWALK —— 智能盲杖（硬件）+ App，超声波避障 + 语音导航的软硬一体** — 核心功能：在传统白杖上加超声波传感器检测胸部以上/头顶障碍物并振动提示；App 提供逐步语音导航（含'时钟方位'播报，如'2 点钟方向'）、Explore 模式播报途经 POI、收藏地点。技术路线：避障靠盲杖硬件的超声波（非手机摄像头/LiDAR），导航靠手机 GPS+云端地图，无志愿者视频。获 Time Best Inventions 2023、Edison Awards 2024 等，覆盖 60+ 国。做得好：解决了白杖的盲区（齐胸/头顶障碍）、'时钟方位'语音范式直观、手机可放口袋骑行/步行。诟病：需购买专用硬件（成本高）、避障依赖外设而非手机本身、导航联网。商业模式：硬件销售 + 订阅。对 BeeUrEi 启示：BeeUrEi 用手机摄像头/LiDAR 做避障正好规避了 WeWALK 的硬件门槛；可借鉴其'时钟方位'语音播报与口袋免持交互。
  - 来源：https://wewalk.io/en/ ; https://www.tdk.com/en/featured_stories/entry_084-WeWALK-Smart-Cane-2.html
- (high) **Lazarillo —— 免费无障碍 GPS，强在 POI 周边播报与室内外定位** — 核心功能：逐步语音导航 + 持续播报周边环境（所在街道、临近路口、商家、公交站）；类别搜索（银行/医疗/餐饮等）；与商家/机构合作的室内导航网络；收藏与自定义地点；后台/熄屏仍持续语音播报。技术路线：依赖移动数据/Wi-Fi（需联网）、GPS + 合作场所室内定位，无摄像头视觉 AI、无避障、无志愿者。完全免费。做得好：免费、室内外一体、'走到哪播到哪'的环境感知、后台播报稳定。诟病：强依赖联网、室内导航受限于已合作场所覆盖、无避障与视觉理解。商业模式：C 端免费，靠 B2B（为商家/机构提供无障碍地图与室内定位）变现。对 BeeUrEi 启示：'持续播报途经 POI/路口'是步行导航的好补充；其 B2B 室内地图模式可作远期变现参考，但 BeeUrEi 应避免对联网与第三方场所覆盖的强依赖。
  - 来源：https://lazarillo.app/ ; https://www.perkins.org/resource/lazarillo-free-accessible-gps-app-blind-and-visually-impaired/
- (high) **Envision AI —— OCR 与场景描述强者，App 免费 + 高价智能眼镜，部分离线** — 核心功能：60+ 语言的 OCR（文档、街牌、手写、书刊），Describe Scene 场景描述（2024 年 v2.5 接入 GPT-4 Vision，云端），Smart Detection 给图表/表格加 alt-text 并保持阅读顺序；可一键转接 Be My Eyes / Aira 求真人协助。技术路线：OCR 支持离线（强调速度与隐私），场景描述走云端 GPT-4V；有手机 App 与 Google Glass 形态智能眼镜。做得好：离线 OCR 兼顾速度与隐私、与 Be My Eyes/Aira 打通形成'AI 不行就转人'的优雅降级、文档结构化阅读。诟病：眼镜硬件 699–4000+ USD 且软件 Pass 约 200 USD/年（昂贵）、丰富场景描述需联网、无导航/无避障。商业模式：App 免费引流 + 眼镜硬件 + 年度软件订阅。对 BeeUrEi 启示：其'端侧能力不足时一键转人工(Be My Eyes/Aira)'正是 BeeUrEi 第③功能的现成范式——印证'端侧 AI 兜底 + 远程志愿者'的产品逻辑被市场验证。
  - 来源：https://www.letsenvision.com/ ; https://attoday.co.uk/smart-glasses-latest-upgrade-provides-succinct-ai-powered-scene-descriptions/
- (high) **OKO —— 红绿灯识别，纯端侧 Core ML 的最佳样板（2024 Apple Design Award）** — 核心功能：用手机后置摄像头实时识别人行横道信号灯状态（Walk/Don't Walk），转成声音/振动告知是否可过街；轻转手机可定位信号灯方位；含 Maps 过街+导航。比利时 EYES 团队出品，获 2024 Apple Design Award（Inclusivity）与 App Store Award（Cultural Impact）。技术路线（关键）：Apple Developer 官方文章明确——AI 模型在端侧本地运行，团队把原 Python 模型转成 Core ML 部署到 iOS，'转换很顺畅'；用 Camera API 实时处理帧、Maps SDK 做导航。做得好：纯端侧 Core ML 的实时视觉识别在恶劣天气（雨雪风）下仍可用、声音+振动多模态反馈、专注单一高价值场景做到极致、Apple 官方背书。诟病：功能单一（仅过街/红绿灯），无通用避障、无志愿者。商业模式：App（部分功能/订阅）。对 BeeUrEi 启示：这是 BeeUrEi 端侧约束最直接的可行性证据与技术路线模板——Python→Core ML、Camera API 实时帧推理、多模态反馈，iOS 新手应优先研读这篇 Apple Developer 文章。
  - 来源：https://developer.apple.com/news/?id=58c4urmu ; https://apps.apple.com/us/app/oko-cross-streets-and-maps/id1583614988
- (high) **Aira —— 专业付费视觉口译，远程协助的'高端/重商业模式'对照** — 核心功能：通过手机摄像头连接经过培训的专业视觉口译员(visual interpreter)，提供随时随地的视觉信息口译（区别于 Be My Eyes 的免费志愿者，Aira 是付费专业 agent，质量/责任更可控）；另有 Aira ASL 服务聋人。技术路线：纯云端真人服务，无端侧 AI/避障。商业模式（关键）：订阅为主（2024 年 Silver 29、Gold 49、Platinum 99 USD/月，按分钟计），到 2024Q4 订阅占营收约 85%；Access Partner Network 让大学/企业/机构买单、终端用户在其场所免费使用（500+ 合作点）。做得好：专业 agent 质量稳定、机构买单模式扩展性强。诟病：贵、按分钟计费有心理负担、完全依赖联网与人力、无 AI 自动化兜底。对 BeeUrEi 启示：远程志愿者若走'免费众包'(Be My Eyes 路线)更利于冷启动；Aira 的'机构/场所买单'可作 B2B 变现远景，但'按分钟付费'体验应避免。
  - 来源：https://aira.io/ ; https://canvasbusinessmodel.com/blogs/how-it-works/aira-how-it-works
- (high) **Super Lidar / EyeGuide / Obstacle Detector —— iPhone LiDAR 端侧避障的直接同类** — 核心功能与技术：Super Lidar 用 iPhone LiDAR 在毫秒内构建约 5m 范围 3D 模型，用音高表示距离（高音=远、低音=近障碍物）；Obstacle Detector 用 LiDAR + TrueDepth，5m 内厘米级测距，提供声音/振动+实距播报；EyeGuide（2024 起）用 iPhone LiDAR 检测障碍/人体存在，播报'左转/右转/碰撞警告'并随距离增强振动，定位免费。技术路线：均基于 ARKit 深度/LiDAR，纯端侧、可离线，但多为'测距/避障'单点功能，无步行路线导航、无志愿者、无通用物体语义识别。做得好：纯端侧、隐私好、实时、利用 iPhone Pro 现成 LiDAR；音高/振动编码距离的交互成熟。诟病：仅 Pro 机型有 LiDAR（覆盖受限，需 RGB/深度估计兜底非 Pro 机型）、功能单一、缺语义（知道'有障碍'但不知'是什么'）。商业模式：付费/订阅或免费。对 BeeUrEi 启示：避障层可直接采用 ARKit+LiDAR+音高/振动编码，但要叠加 Core ML 语义识别补足'是什么'，并对无 LiDAR 机型设计纯视觉降级方案。
  - 来源：https://www.supersense.app/post/super-lidar-the-first-step-forward ; https://apps.apple.com/us/app/obstacle-detector-for-blind/id6461118479 ; https://eyeguide.netlify.app/
- (medium) **中国/中文区同类 —— 轻松无障碍、蝙蝠避障、高德视障导航、点明/讯飞读屏** — 轻松无障碍(easywza.com)：四模块——轻松求助（志愿者实时音视频，已完成 1.4 万次视频求助）、轻松伴行（摄像头 AI 每 10s 扫描一次播报障碍物类型+距离）、轻松识别（拍照识别）、轻松圈子（社区），公益众筹模式——与 BeeUrEi 形态最接近（避障+识别+志愿者视频），但为 Android/云端、扫描频率低(10s)、非实时。蝙蝠避障：集成激光雷达传感器实时识别障碍物位置/类型/距离 + 图像识别物体与文字。高德地图视障导航(2024-08 北京/杭州上线)：优先规划带盲道路线、避开无红绿灯路口、路口红绿灯语音倒计时播报、偏航实时纠偏、配合读屏；基于高德大数据+北斗亚米级定位（云端）。点明/心智无障碍/保益悦听：基于讯飞语音的安卓读屏类应用。中科院生物物理所有'虚拟陪伴系统'助盲出行研究。做得好：本土化（盲道数据、中文语音）、公益志愿者网络、高德的路口红绿灯播报。诟病：多为 Android、强依赖云端与联网、实时性弱（10s 扫描）、iOS 端侧方案稀缺。对 BeeUrEi 启示：中文区 iOS 端侧实时避障+导航+志愿者三合一存在明显空白，本土化 POI/盲道数据与中文语音是差异点；可参考轻松无障碍的功能组合但在'实时性+端侧'上超越它。
  - 来源：https://app.easywza.com/ ; https://www.crexpo.cn/media/news/industry/2397 ; https://m.163.com/dy/article/J9VHMSSU0514R9NP.html

**对 BeeUrEi 的建议：**

- 应吸收(交互范式)：采用 Seeing AI 的'频道/模式切换'信息架构，把避障、步行导航、呼叫志愿者设计为可一键(或一手势)切换的模式，并对每个模式用 VoiceOver 友好的极简交互。
- 应吸收(避障编码)：直接复用 Super Lidar/Google Lookout Find 模式的'方向+距离'多模态反馈——用音高/空间音频编码距离、振动强度随接近增强、语音播报'是什么+几点钟方向'(借鉴 WeWALK 时钟方位)。
- 应吸收(开源资产)：以 Soundscape 开源 Swift 工程(github.com/soundscape-community/soundscape)为学习与移植基座，研究其 AVAudioEngine 空间音频信标与 OpenStreetMap POI 拉取，用于 BeeUrEi 的步行导航'信标指向目的地'。
- 应吸收(端侧技术路线)：把 OKO 的 Apple Developer 文章作为端侧实现模板——Python 模型→Core ML、Camera API 实时帧推理、跑在 Neural Engine；避障物体语义用 Core ML 检测模型(如 YOLO 系/Vision 框架)补足 LiDAR 的'是什么'。
- 应吸收(优雅降级到人工)：照搬 Envision 'AI 不行就一键转人工(Be My Eyes/Aira)'的降级逻辑——BeeUrEi 第③功能应是端侧 AI 置信度低/用户主动呼叫时无缝切换到志愿者视频，并做好弱网下的画质/音频自适应。
- 应吸收(志愿者商业模式)：远程志愿者优先走 Be My Eyes 式'明眼志愿者免费众包'以利冷启动，远期再用 B2B(企业客服/机构买单，参考 Lazarillo 室内地图与 Aira Access Partner)补贴免费 C 端，而非对个人用户按分钟收费。
- 应避免(联网强依赖)：避免 Lazarillo/Aira/Be My AI 那种核心功能强依赖云端与联网——避障与基础导航必须满足'纯端侧、离线可用'硬约束，仅志愿者视频与可选的丰富场景描述需要网络。
- 应避免(硬件门槛)：避免 WeWALK/Envision Glasses 的专用硬件成本门槛；BeeUrEi 只用手机主摄像头(+ Pro 机型 LiDAR)是核心优势，但必须为无 LiDAR 机型设计纯 RGB/深度估计的避障降级方案，避免把用户群锁死在 iPhone Pro。
- 应避免(实时性不足)：避免轻松无障碍'每 10 秒扫描一次'的低频体验——避障必须接近实时(高帧率连续推理)，这正是 BeeUrEi 相对中文区现有产品的差异化卖点。
- 差异化定位：业内尚无一款'实时避障 + 步行路线导航 + 远程志愿者视频'三合一且坚持纯端侧的 iOS 产品；中文区 iOS 该空白尤为明显。BeeUrEi 应把'三合一 + 端侧 + iOS + 中文本土化(盲道/中文语音/本地 POI)'作为核心定位，避障实时性与隐私(端侧)作为对外宣传锚点。

**风险：**

- 端侧避障的实时性能与发热/耗电：连续高帧率 Core ML + LiDAR 推理对电池与发热压力大，长时间步行可能导致降频或温控关机，需在产品验证阶段实测。
- LiDAR 仅限 iPhone Pro 机型，非 Pro 机型需纯 RGB 深度估计兜底，避障精度与可靠性可能下降，存在安全责任风险。
- 安全与责任：避障/过街(类 OKO)涉及人身安全，误报/漏报有法律与伦理责任，需明确免责与'辅助而非替代白杖/导盲犬'的定位。
- 志愿者视频的冷启动与可用性：免费众包模式在用户量小时志愿者响应慢，初期可能需保底人工或与 Be My Eyes 等合作，存在生态依赖风险。
- 中文区 POI/盲道数据获取：高德盲道数据为商业闭源，OpenStreetMap 在中国覆盖与合规(测绘资质)受限，端侧离线地图数据来源是工程与合规难点。

**开放问题：**

- BeeUrEi 的目标机型范围？是否要求 iPhone Pro(LiDAR)，还是必须支持全机型(决定避障技术路线是 LiDAR 优先还是纯视觉优先)。
- 远程志愿者是自建众包网络，还是接入/对接 Be My Eyes 等现有平台？这直接影响第③功能的工程量与冷启动策略。
- 步行导航的地图/POI 数据源在中国如何解决(高德/百度 SDK 通常需联网，与'纯端侧'硬约束冲突；OSM 在华覆盖与测绘合规受限)——是否对'导航'放宽端侧约束仅保留'避障'纯端侧？
- 是否需要专门的红绿灯/过街识别(类 OKO)作为避障的子能力？若需要，是自研 Core ML 模型还是寻求授权。

### 端侧计算机视觉 / 避障 (On-device CV & Obstacle Avoidance)

在 2024-2026 年的 iOS 设备上，"全部 AI 推理在端侧完成" 的避障方案完全可行，且有成熟工具链。实时目标检测推荐用 YOLO11n/YOLOv8n 转 Core ML，借助 Apple Neural Engine (ANE) 在新机型上可达 60-85 FPS；对老设备或低功耗场景可用 MobileNet-SSD。单目深度估计已能端侧实时跑：Apple 官方发布的 Core ML 版 Depth Anything V2 small 在 iPhone 15 Pro Max 上约 30 ms/帧 (≈29-33 FPS)；而 Apple 自家的 Depth Pro 太重 (1536×1536)，目前不适合手机实时，官方作者本人也建议改用 Depth Anything。对带 LiDAR 的 Pro 机型 (iPhone 12 Pro 起 / iPad Pro 2020 起)，ARKit 的 Scene Reconstruction + sceneDepth 能直接给出每像素米制深度 (有效 ~5 m，室内外可用)，是避障最可靠的硬件级方案，应作为首选并把视觉模型作为非 LiDAR 机型的回退。实时管线为 AVCaptureSession → AVCaptureVideoDataOutput → CVPixelBuffer → Vision/Core ML，需做帧节流 (10-15 FPS)、监听 thermalState 降级，以控制发热和掉电。盲道/可行走路面用 DeepLabV3+ 等语义分割可实现但需自训数据，属于进阶模块。安全上必须把避障当成"辅助而非唯一依据"，对漏检/误检、夜间逆光、发热降频做工程兜底。

**要点：**

- (high) **YOLO11/YOLOv8 转 Core ML 后在 ANE 上可实时 (60-85 FPS)，是端侧目标检测首选** — Ultralytics 一行 Python 即可导出：model.export(format="coreml", nms=True, half=True, imgsz=640)。关键参数 nms=True 内置非极大值抑制 (输出直接是框)、half=True 走 FP16、int8=True 进一步压缩。Roboflow/Ultralytics 实测：YOLO11 量化部署到 iPhone Neural Engine 可轻松 60+ FPS，一个案例从 PyTorch 端侧 21 FPS 提升到 Core ML 85 FPS；YOLO11 在 COCO 上 53.4% mAP，比 YOLOv8m 少 22% 参数。对避障建议用 nano/small 变体 (省电、控温)，并只保留行人/车辆/常见障碍等少数类别或自训精简模型。集成方式：把 .mlpackage 拖进 Xcode → 自动生成 Swift 类，用 VNCoreMLRequest 包一层喂帧。
  - 来源：https://blog.roboflow.com/best-ios-object-detection-models/ ; https://docs.ultralytics.com/integrations/coreml/ ; https://www.ultralytics.com/blog/bringing-ultralytics-yolo11-to-apple-devices-via-coreml ; https://github.com/ultralytics/yolo-ios-app
- (high) **MobileNet-SSD 适合老机型/极致低功耗回退；RF-DETR 是更高精度的新选项** — MobileNet-SSD 模型仅 8-12 MB，在 iPhone 7 无 GPU 加速时也能 ~63 FPS，内存占用极小，适合做最低端兜底。2024-2026 趋势上 RF-DETR (transformer，经 Core ML/ANE 优化) 精度和泛化更好，但更重，适合高端机。对 BeeUrEi 这类安全攸关 App，建议主用 YOLO11n、对超老设备降级到 MobileNet-SSD。
  - 来源：https://blog.roboflow.com/best-ios-object-detection-models/ ; https://blog.roboflow.com/mobile-object-detection-models/
- (high) **Apple Vision 内置请求 (VNDetect*) 可零模型上手，但避障需求需配合 Core ML 模型** — Vision 提供二十多种端侧 CV 请求，全部跑在 ANE、毫秒级：VNDetectFaceRectangles/Landmarks (人脸 5-15 ms)、VNDetectHumanBodyPoseRequest (19 关节，<16 ms 可跟 60fps 视频)、VNDetectHumanRectanglesRequest (检人体框)、VNDetectHumanHandPose、VNGenerateObjectnessBasedSaliency / AttentionBasedSaliency (显著性/物体位置热图)、VNDetectTrajectories (运动物体轨迹，可判断接近的车/人)、VNClassifyImage。优点是免训练、免转换、随系统优化。但 Vision 没有通用 'COCO 80 类障碍物检测器'，所以通用避障仍需自带 YOLO Core ML 模型；Vision 适合做'有没有人在前方/人体姿态/运动物体逼近'这类补充信号。Vision 也能直接托管自定义 Core ML 模型 (VNCoreMLRequest)，统一管线。
  - 来源：https://blakecrosley.com/blog/vision-framework-built-in ; https://developer.apple.com/documentation/vision/vngeneratepersonsegmentationrequest
- (high) **单目深度估计能端侧实时：Apple 官方 Core ML 版 Depth Anything V2 small 在 iPhone 上 ~30 ms/帧** — Apple 已在官方 Core ML Models 库收录 Depth Anything V2 (2024-06)。官方 small-float16 实测：iPhone 12 Pro Max 31.1 ms、iPhone 15 Pro Max 33.9 ms、M1 Max 32.8 ms、M3 Max 24.6 ms，主算力单元均为 Neural Engine，即手机端 ~29-33 FPS。模型 24.8M 参数、FP16 仅 49.8 MB、输入 518×396。Apple 在 huggingface/coreml-examples 提供完整 Swift 示例。注意：这是相对深度 (单目无法给可靠绝对米数)，可用于'前方近/远'的相对避障分级，但绝对距离不如 LiDAR 可信。
  - 来源：https://huggingface.co/apple/coreml-depth-anything-v2-small ; https://www.aibase.com/news/10179 ; https://github.com/huggingface/coreml-examples
- (high) **Apple Depth Pro 目前不适合手机实时，应放弃端侧实时用途** — Depth Pro 是 Apple 的零样本'米制'高分辨率单目深度模型 (默认 1536×1536，标准 GPU 上 0.3 s 出 2.25 MP 深度图)。社区 Core ML 转换 PR (#45) 把它降到 1024×1024 FP16，仅针对 M2 MacBook 的 ANE，且明确标注'不打算合并'、'仍是 draft'；作者本人建议改用 Depth Anything，因其基于更小的 DINOv2、优化更好。结论：Depth Pro 可用于'拍一张照算精确距离'的离线场景，但不要指望它在 iPhone 上跑实时视频流。
  - 来源：https://github.com/apple/ml-depth-pro/pull/45 ; https://machinelearning.apple.com/research/depth-pro
- (high) **ARKit + LiDAR 是避障最可靠方案：每像素米制深度 + 3D 网格，有效 ~5 m，室内外可用** — LiDAR 机型：iPhone 12 Pro / 12 Pro Max 起的所有 Pro 机型，以及 iPad Pro 2020 (11" 2代 / 12.9" 4代) 起。能力：(1) Scene Reconstruction (ARSceneReconstruction) 输出环境 3D 网格拓扑；(2) ARFrame.sceneDepth / smoothedSceneDepth 给出 ARDepthData——一个深度 CVPixelBuffer (每像素直接是米数) + 一个 confidence map (可过滤低置信像素)；smoothedSceneDepth 做了跨帧平均、抗闪烁更稳。LiDAR 飞行时间测距有效约 5 m，室内外均可用 (强日光下精度会下降)。这是硬件级真实距离，避障决策应优先采信它，单目深度模型作为非 LiDAR 机型的回退。
  - 来源：https://developer.apple.com/documentation/arkit/ardepthdata ; https://developer.apple.com/documentation/arkit/arframe/smoothedscenedepth ; https://apple.gadgethacks.com/how-to/youre-using-lidar-your-iphone-and-ipad-and-you-dont-even-know-0385523/ ; https://www.nomtek.com/blog/lidar-scanner-research
- (medium) **盲道/可行走路面用语义分割可行但需自训数据，属进阶模块** — DeepLabV3+ 已被用于区分盲道的'警示块/引导块'两类；GRFB-UNet (多尺度注意力 + group receptive field block) 专做盲道分割。已有公开数据集：Tenji10K (日本第一人称盲道图 10K 张，2024)、GuideTWSI (合成+真实的盲道指示数据集)。室景点云方法在 HMLS Madrid 数据集 F1/IoU 达 0.83。落地路径：DeepLabV3+/分割网络可转 Core ML，但通用预训练模型对'各国盲道/人行道'泛化弱，BeeUrEi 需采集本地化数据微调。建议 v1 先做'障碍检测+深度'，盲道分割作为 v2 增量。
  - 来源：https://onlinelibrary.wiley.com/doi/10.1002/tee.24123 ; https://arxiv.org/pdf/2603.07060 ; https://dl.acm.org/doi/10.1145/3663547.3759735
- (high) **实时管线：AVCaptureSession → AVCaptureVideoDataOutput → CVPixelBuffer → Vision/Core ML，需帧节流与降级** — 标准管线：AVCaptureVideoDataOutput 设 alwaysDiscardsLateVideoFrames=true、像素格式 kCVPixelFormatType_32BGRA (或 420YpCbCr)，在 captureOutput 回调里把 CMSampleBuffer 取出 CVPixelBuffer，喂给 VNImageRequestHandler 跑 VNCoreMLRequest——Vision 会自动缩放/裁剪到模型输入尺寸。Core ML 自动在 CPU/GPU/ANE 间分配 (设 MLModelConfiguration.computeUnits=.all)。社区实践把推理节流到 ~10-15 FPS 省电；推理放后台串行队列，避免阻塞 capture 回调。
  - 来源：https://github.com/hollance/CoreMLHelpers/blob/master/Docs/CVPixelBuffer.markdown ; https://medium.com/@jonataneduard/building-a-live-image-classification-camera-in-swiftui-ios-15-0f894162191e ; https://developer.apple.com/documentation/coreml
- (high) **发热/电量是连续 CV 的主要工程约束，必须监听 thermalState 主动降级** — 持续摄像头+ANE 推理能耗高，iPhone 过热会降频 (CPU/GPU throttle)，导致 FPS 抖动甚至卡顿——对避障是安全隐患。最佳实践：注册 ProcessInfo.thermalStateDidChangeNotification，读取 thermalState (nominal/fair/serious/critical) 分级降级：fair→降推理帧率，serious→降模型分辨率/换 nano 模型，critical→Apple 建议停用摄像头 (此时应切到纯语音提示并提醒用户)。配合较小模型 (运行更凉)、用 Instruments/Xcode Energy Gauge 实测、避免 simulator 测性能。LiDAR + ARKit 长时间运行同样耗电发热，需同等对待。
  - 来源：https://developer.apple.com/videos/play/wwdc2019/422/ ; https://wesleydegroot.nl/blog/Thermal-States-on-iOS ; https://medium.com/@umairzahid508/performance-battery-optimization-under-ai-sensor-load-in-ios-4d5e39dea2b2

**对 BeeUrEi 的建议：**

- 分层避障架构 (核心建议)：把 LiDAR 当首选真值。在带 LiDAR 的 Pro 机型上用 ARKit Scene Reconstruction + smoothedSceneDepth (每像素米制 + confidence) 做避障距离判断；在无 LiDAR 机型上回退到 Core ML 版 Depth Anything V2 small (相对深度) + YOLO11n 目标检测。运行时用 ARWorldTrackingConfiguration.supportsSceneReconstruction / ARFrame.sceneDepth 是否可用来自动选路。
- 目标检测选 YOLO11n (或 YOLOv8n) 转 Core ML，导出用 model.export(format="coreml", nms=True, half=True, imgsz=640)，只保留行人/车辆/自行车/障碍等少数避障相关类别 (自训精简模型而非通用 COCO 80 类)，以提速、省电、降低误检。超老设备降级到 MobileNet-SSD。
- 新手友好的起步路径：先用 Apple 官方 huggingface/coreml-examples 的 Depth Anything Swift 示例和 Ultralytics 的 yolo-ios-app 开源工程作为脚手架，跑通 AVCaptureSession → CVPixelBuffer → VNCoreMLRequest 管线，再替换/裁剪模型。避免一上来就自己写转换脚本。
- 推理帧率节流到 10-15 FPS (避障对低延迟敏感但不需要 60 FPS)，推理放独立串行 DispatchQueue，AVCaptureVideoDataOutput 设 alwaysDiscardsLateVideoFrames=true，MLModelConfiguration.computeUnits=.all 让系统优先用 ANE。
- 必须实现热降级：监听 ProcessInfo.thermalStateDidChangeNotification，serious 时降分辨率/换 nano 模型、critical 时停摄像头并语音告知用户'设备过热，避障暂停'。同时给低电量同样的降级策略，因为这是连续高耗能场景。
- 盲道/可行走路面分割 (DeepLabV3+ 转 Core ML) 列为 v2 增量功能，需采集本地化盲道数据微调；v1 先把'障碍检测 + 深度距离 + 语音提示'做稳。
- Depth Pro 不要用于实时视频流；如需'对准目标拍一张算精确米数'的辅助功能可单独离线调用，但实时避障用 Depth Anything + LiDAR。

**风险：**

- 漏检 (false negative) 是最严重安全后果：检测器可能漏掉低矮障碍 (路桩、台阶边缘、地面坑洞)、透明/反光物 (玻璃门)、悬空障碍 (招牌、树枝——这些在地面深度图里也难发现)。绝不能把 CV 当唯一依据，必须明确告知用户这是辅助工具、保留白手杖/导盲犬，并在 UI/语音里设置保守的安全边距。
- 误检 (false positive) 导致频繁误报会让用户疲劳并最终忽视真实警报 (alarm fatigue)。需做时间维度的多帧确认、置信度阈值、对 LiDAR confidence map 低置信像素过滤，平衡灵敏度与噪声。
- 夜间/逆光/强日光：RGB 检测器在低光、逆光、强对比下精度骤降；LiDAR 在强日光下精度也下降、单目深度在夜间几乎失效。需检测光照条件并主动告警'当前光线下避障可靠性降低'，必要时引导用户开手电/降级到呼叫志愿者。
- 发热降频与掉电：连续摄像头+ANE 推理会让设备发热并触发 CPU/GPU 降频，造成 FPS 骤降甚至卡顿——对正在行走的盲人是直接危险；长时间使用还会快速耗电使设备中途关机。必须有热/电量降级策略和明确的状态语音播报。
- 深度语义歧义：单目相对深度 (Depth Anything) 给不出可靠绝对米数，可能把远处大物体误判为近处障碍；LiDAR 仅有效 ~5 m，超距障碍无法预警。应明确系统的距离作用域并向用户传达。
- 时延链路风险：从拍帧到语音提示的端到端延迟若过大，使用者可能已撞上障碍。需要约束整条管线 (capture+推理+决策+TTS) 的总延迟，并把节流 FPS 与延迟权衡测清楚。
- ARKit 漂移与初始化：ARKit 世界跟踪在快速移动、特征稀疏 (空白墙面) 或剧烈晃动时会丢失跟踪/漂移，影响 sceneDepth 稳定性，需监听 ARCamera trackingState 并降级。

**开放问题：**

- Depth Anything V2 small 在更老的非 Pro 机型 (如 iPhone SE / iPhone 11 / 入门 A 系列) 上的实测 FPS 和发热表现如何？官方只给到 iPhone 12 Pro Max。
- 端到端避障延迟 (capture→推理→深度→决策→语音) 在目标机型上的真实测量值是多少？是否满足正常步速下的安全提前量？
- 盲道分割模型 (DeepLabV3+/GRFB-UNet) 在中国/目标市场盲道形态上的泛化与 Core ML 端侧 FPS 尚需自测，公开数据集多为日本/西班牙场景。
- 在 critical 热状态被迫停摄像头时，产品如何无缝切换到'呼叫远程志愿者'兜底，体验衔接尚需设计。
- YOLO 自训精简类别模型 vs 通用模型在真实街景障碍上的漏检率对比，需要在目标场景采集数据做安全验证。

### 步行导航与空间音频交互 (Walking Navigation & Spatial Audio Interaction)

在原生 iOS / 全端侧约束下，BeeUrEi 的"宏观路线导航"层完全可用现成框架实现：MapKit 的 MKDirections（transportType=.walking）可返回 turn-by-turn 步行路线（每步含文字指令、坐标、polyline），全程在端侧调用 Apple 地图服务获取一次路线后即可离线播报，不需要自建服务器算力。但核心风险不在算法而在定位：iPhone 在城市峡谷（高楼/树荫）下 GPS 水平误差实测可达 7-18m 甚至偶发 99m，且视障者步速慢更易产生 GPS 漂移，CLHeading 指南针又易受磁干扰，二者叠加足以把人引向车流——这是本维度最严重的安全问题。交互范式上，业界标杆是 Microsoft Soundscape（已开源 MIT，社区分支 VoiceVista / Soundscape Community 活跃维护到 2025），其核心是"空间音频信标"（beacon）——用 3D HRTF 把一个持续的方向音"挂"在目标方位，靠近则音量增大，配合 AirPods 头部追踪；iOS 端可用 PHASE 或 AVAudioEnvironmentNode 原生实现，无需联网。数据层面 MapKit 自带步行路网够用作 MVP，但真正"视障友好路由"（优先 footway、少转弯、过有声红绿灯的路口、避开过宽广场）需要 OpenStreetMap + 自建/第三方 routing（GraphHopper / OpenRouteService / WalkersGuide 模式）。宏观路线与微观摄像头避障的融合是产品最大难点：两层时间尺度、坐标系、可信度都不同，必须做"分层仲裁"且摄像头避障永远拥有最高优先级。

**要点：**

- (high) **MKDirections 可直接产出端侧步行 turn-by-turn 路线，适合做宏观导航 MVP** — MKDirections.Request 设 transportType=.walking、requestsAlternateRoutes 后异步调用 calculate，返回的 MKRoute 含 steps（每个 MKRoute.Step 有 instructions 文字、polyline 坐标、distance）及整体 polyline overlay。路线计算调用 Apple 地图后端，但只需在出发时请求一次，之后的进度判断/语音播报均可端侧完成，符合'不依赖远程算力'约束（路线检索本身是 Apple 免费服务而非自建 GPU 推理）。对 iOS 新手这是门槛最低的方案，SwiftUI(iOS17+) 有 Map+MapPolyline 直接渲染。
  - 来源：https://developer.apple.com/documentation/mapkit/mkdirections ; https://www.createwithswift.com/getting-directions-in-mapkit-with-swiftui/
- (high) **城市峡谷 GPS 漂移是核心安全风险：实测水平误差 7-18m，最差近 100m** — iPhone 实测城市环境整体水平误差 7-13m；开阔点 RMSE 约 2.4-5.9m，但贴近多层建筑/树荫的点 RMSE 升到 11-18.9m，单次最大误差曾达 99.7m，且'建筑用地占比'与误差呈正相关。GPS 失锁时 CoreLocation 回退 WiFi/基站定位，horizontalAccuracy 会跳到 65m+。关键：视障者步速远低于常人，低于约 2-2.5km/h 时 GNSS 更易产生 drift error。这意味着十几米误差足以让 App 误判用户已过马路或站在错误一侧。
  - 来源：https://pmc.ncbi.nlm.nih.gov/articles/PMC6638960/ ; https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12480767
- (high) **Microsoft Soundscape 已开源(Swift/MIT)，是空间音频信标的最佳参考与可复用代码源** — Microsoft 2023年1月停服并开源 (github.com/microsoft/soundscape)，iOS 客户端为 Swift，用 3D audio cues 做'环境感知'而非死板转向；支持 AirPods 头部追踪让 POI 随头部转动保持空间方位。后端用 imposm3 摄取 OpenStreetMap 数据并以 GeoJSON 提供（这部分依赖云服务，BeeUrEi 需替换/端侧化）。活跃社区分支：VoiceVista(全球可用)、Soundscape Community、Scottish Tech Army 版，维护到 2025（VoiceVista 1.9.5, 2025-04）。核心交互可直接借鉴，但后端 POI 服务需重新设计以满足端侧约束。
  - 来源：https://github.com/microsoft/soundscape/blob/main/README.md ; https://www.applevis.com/apps/ios/navigation/voicevista
- (high) **空间音频信标(beacon)是视障导航最佳范式：方向音+靠近增大音量，比'左转/右转'更直觉** — Soundscape/VoiceVista 范式：在目标方位放一个持续的 3D 空间音(beacon)，当用户朝向正确方向时音色'对准/清晰'，偏离则音偏向一侧，靠近目标音量随距离增大；配合 breadcrumb（面包屑）模式与沿途路口/街道/POI 的定向语音 callout。相比纯'前方50米右转'的语音指令，空间音让用户用听觉自然朝向，减少认知负荷，且不锁死具体路径——更宽容定位误差。这应作为 BeeUrEi 宏观导航的主交互。
  - 来源：https://www.microsoft.com/en-us/research/blog/microsoft-soundscape-new-horizons-with-a-community-driven-approach/ ; https://www.applevis.com/apps/ios/navigation/voicevista
- (high) **iOS 原生即可端侧渲染 3D 空间音频：PHASE 或 AVAudioEnvironmentNode，无需联网** — 两条原生路径：(1) AVAudioEnvironmentNode + AVAudio3DMixingRenderingAlgorithm.HRTF/.HRTFHQ，给每个声源设 3D 坐标与监听者朝向，是经典做法（注意声源必须是 mono 格式否则空间化失效）。(2) PHASE(Physical Audio Spatialization Engine, WWDC21)更现代、支持几何感知与设备/AirPods 自动适配。两者全部端侧运行。配合 CMHeadphoneMotionManager 读取 AirPods 头部朝向，可在用户转头时让 beacon 方位保持稳定（与手机朝向解耦）。对新手 AVAudioEnvironmentNode 上手更快，资料多。
  - 来源：https://developer.apple.com/videos/play/wwdc2021/10079/ ; https://medium.com/@piram.singh/programming-spatial-audio-for-vr-a1540fe3a0df
- (high) **震动(Core Haptics)适合做'静默转向确认'，弥补嘈杂环境下语音失效** — CHHapticEngine 提供低层 Taptic Engine 访问，可用 CHHapticEvent 的 intensity/sharpness(0-1) 组合自定义模式，iPhone 8+ 全支持。可设计：到达转向点短促双震、偏离路线节奏性震动、靠近目标震动加密。PathFinder 用户研究明确指出'嘈杂/拥挤环境下语音不实用'，需要 haptic 备选。建议 BeeUrEi 把震动作为语音/空间音的冗余通道，而非主通道（震动信息带宽低）。
  - 来源：https://developer.apple.com/documentation/corehaptics ; https://arxiv.org/html/2504.20976v1
- (high) **CLHeading 指南针可用但有磁干扰风险，需结合 GPS 航向交叉校验** — CLHeading 由磁力计提供，magneticHeading/trueHeading 比原始磁力计稳定（已融合其它传感器），trueHeading 需 GPS 定位算磁偏角。didUpdateHeading 回调随朝向变化触发。但磁力计易受附近金属/电子设备/手机姿态干扰产生数十度偏差，会让'空间音信标方向'瞬时跳变误导用户。缓解：低速移动时用连续 GPS 点推算的行进航向(course)与 CLHeading 融合，并对朝向做平滑滤波。
  - 来源：https://www.oreilly.com/library/view/geolocation-in-ios/9781449309572/ch04.html ; https://www.devfright.com/how-to-use-the-iphone-digital-compass-in-your-app/
- (high) **视障友好路由需要 OSM 而非仅 MapKit：优先 footway、少转弯、过有声路口、避开过宽广场** — 实证研究(以色列, O&M 专家验证)显示视障最佳路由四准则：①路线复杂度(直线优先, >45°转弯显著增加难度) ②地标(公交站/面包店等永久声/触觉参照) ③道路类型六级分类(专用 footway 最优, service/未分类路最差; pedestrian zone 因'太宽太挤多用户共享'被列为better-to-avoid) ④无障碍设施(tactile_paving、有声红绿灯、人行横道)。OSM 用 tactile_paving=yes、kerb=lowered/flush 等标签承载这些信息。MapKit 无法表达这些偏好，故视障专用路由需 OSM + GraphHopper/OpenRouteService(含 wheelchair profile)或参考 WalkersGuide 架构。
  - 来源：https://journals.sagepub.com/doi/full/10.1177/2399808320933907 ; https://wiki.openstreetmap.org/wiki/Accessible_Routing ; https://wiki.openstreetmap.org/wiki/Key:tactile_paving
- (high) **OSM 人行道/无障碍数据严重不全，覆盖不均，不能假设到处可用** — OSM 人行道、人行横道、tactile paving 普遍 undermapped，存在数据质量(精度、拓扑错误)与完整性短板；road network 几何在多数城市较准，但 sidewalk 级与无障碍标签覆盖高度地区不均(欧美热点城市好, 多数城市稀疏)。临时障碍(街头艺人/小摊)无法建模。含义：BeeUrEi 不能把'有 OSM 无障碍路由'当默认能力；应有'数据缺失时降级到 MapKit 步行路线 + 摄像头避障兜底'的策略。
  - 来源：https://journals.sagepub.com/doi/full/10.1177/2399808320933907 ; https://openstreetmap.us/news/2022/01/12months_Mobility_and_Accessibility/
- (high) **宏观路线 + 微观摄像头避障的融合：必须分层仲裁，避障层永远最高优先级** — 学界(PathFinder/MR.NAVI 等)普遍把二者当独立层：宏观=GPS/OSM 目的地路由(秒-分钟尺度), 微观=单目深度/检测的即时无障碍路径(0.4-1.3s 端侧, clock-face '11点钟'方位表达)。难点：①两层坐标系与置信度不同 ②语音/音频通道争用——同一时刻不能既播'前方右转'又播'左前方障碍' ③优先级——眼前的车/坑必须压过'继续直行'指令。PathFinder 明确承认其只有微观、缺宏观目的地路由，反证融合是开放难题。BeeUrEi 应做'避障打断导航'的事件优先级队列 + 单一空间音场统一表达(障碍与路线用不同音色但同一 3D 声场)。
  - 来源：https://arxiv.org/html/2504.20976v1 ; https://arxiv.org/pdf/2506.05369
- (medium) **室外定位不准的兜底：PDR(步数+航向)端侧推算 + 地标语音确认 + 容错路由** — GPS 失锁/漂移时的端侧兜底链：(1) CMPedometer/CoreMotion 做 Pedestrian Dead Reckoning(步数检测可达~97%精度)结合 CLHeading 短时推算位移; (2) kCLLocationAccuracyBestForNavigation 在外接电源下融合更多传感器(注意耗电); (3) 用 horizontalAccuracy 做'信任阈值'——精度差时不下达精确转向指令, 改为更宽容的空间音信标+让用户用 POI/路口语音自我校准; (4) 借鉴 Soundscape 的环境 callout 让用户'听到自己在哪'而非'被精确牵引'。绝不在低精度时下达高确定性的'现在过马路'。
  - 来源：https://developer.apple.com/documentation/corelocation/kcllocationaccuracybestfornavigation ; https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6165578/

**对 BeeUrEi 的建议：**

- MVP 用 MKDirections(.walking) 做宏观路线，主交互采用 Soundscape 式'空间音频信标'(AVAudioEnvironmentNode + HRTF, mono 声源)而非生硬的'左转/右转'语音；信标随距离增大音量、随方位变音像。对 iOS 新手 AVAudioEnvironmentNode 比 PHASE 上手更快，资料更多。
- 直接研读并复用 github.com/microsoft/soundscape (Swift, MIT) 与社区分支 VoiceVista 的 beacon/callout/空间音渲染代码；但其 OSM 后端依赖 Azure 云，需替换为端侧或预下载的 GeoJSON 以满足'不依赖远程算力'约束。
- 把 horizontalAccuracy 当一等公民做'置信度门控'：精度好(<10m)才下达精确转向；精度差(>20m 或回退到 WiFi 65m+)时降级为宽容的空间音信标 + 路口/地标语音 callout，让用户自我校准，绝不在低精度下播'现在过马路'。
- 对朝向(CLHeading)做平滑滤波并与 GPS course 交叉校验，检测到磁干扰(headingAccuracy 差)时暂停空间音信标的精确方位、改用粗粒度提示，避免信标方向乱跳误导。
- 设计'分层仲裁事件队列'：摄像头实时避障(0.4-1.3s 端侧)优先级永远高于宏观导航语音；用统一 3D 声场表达——障碍与路线用不同音色但同一空间坐标系，避免双通道语音打架。
- 震动(Core Haptics)作冗余通道：嘈杂/拥挤环境语音失效时，用震动做转向确认、偏航警告、临近目标提醒；不要让震动承载复杂信息(带宽低)。
- 视障友好路由分两阶段：阶段一 MVP 用 MapKit 步行路线够用；阶段二再引入 OSM(优先 footway、少>45°转弯、过有声红绿灯路口、避开过宽广场)+ 预处理的端侧路由图或 GraphHopper/OpenRouteService 离线包，并参考 WalkersGuide 的视障路由准则。
- 始终保留'OSM 无障碍数据缺失→降级到 MapKit 步行 + 摄像头避障兜底'的优雅降级路径，因为 OSM 人行道/tactile_paving 覆盖在多数城市稀疏，不能假设普遍可用。
- GPS 失锁时用 CMPedometer/CoreMotion 做端侧 PDR(步数+航向)短时推算位置，配合 AirPods 头部追踪(CMHeadphoneMotionManager)稳定空间音方位；kCLLocationAccuracyBestForNavigation 仅在接电时启用以控耗电。
- 把'环境感知 callout'(街道名/路口/POI 的定向语音)作为常态信息底座，而非只在转向时说话——让用户持续'听到自己身处何方'，这比精确牵引更安全也更符合视障者的空间认知习惯。

**风险：**

- [最高安全风险] 城市峡谷 GPS 漂移(实测 7-18m, 偶发近 100m)叠加视障者慢步速的 drift error，可能让 App 误判用户已过马路/站错路侧，下达把人引向车流的致命指令。必须用 horizontalAccuracy 门控，低精度时禁止任何'现在过马路/现在转向'的高确定性指令。
- CLHeading 磁力计受金属/电子设备/手机姿态干扰可瞬时偏差数十度，会让空间音信标方向乱跳，把用户引向错误方位。需平滑滤波 + GPS course 交叉校验 + 磁干扰时降级。
- 宏观导航语音与微观避障语音/音频通道争用：同一时刻播'前方右转'与'左前障碍'会互相淹没甚至误导。若不做严格优先级仲裁(避障>导航)，融合反而比单独使用更危险。
- OSM 人行道与 tactile_paving/有声红绿灯数据在多数城市稀疏且质量不均，若产品宣称'无障碍路由'却在数据空白区给出经过危险路口的路线，会造成虚假安全感。需明确降级与告知。
- 端侧 PDR(步数推算)误差随时间累积，长距离失锁后位置会越漂越远；不能把 PDR 当长期定位替代，只能做短时桥接，并在重新拿到可信 GPS 时立即纠正。
- 过度依赖精确'牵引式'导航会让用户丧失自身空间判断；若某次定位错误导致危险，用户因习惯盲从指令而来不及用残余感官纠错。设计上应以'增强感知'为主、'精确指挥'为辅。

**开放问题：**

- BeeUrEi 是否能接受在出发时联网一次获取 MapKit 路线/OSM 数据(检索非 GPU 推理)，还是连地图数据也要求完全离线预下载？这直接决定路由方案选型。
- 目标城市/地区是哪里？OSM 无障碍数据完整度地区差异极大，决定视障路由是否可行。
- 是否计划支持 AirPods 头部追踪作为强依赖，还是仅作增强(因并非所有用户都有兼容耳机)？
- 宏观导航与微观避障在产品上是默认同时运行，还是用户可分别开关？这影响声音通道仲裁的复杂度。
- 对'室外定位精度阈值'的安全策略是否需要与视障 O&M(定向行走)专业人士共同制定，以确定何种精度下允许哪类指令？

### 远程实时视频协助（Remote Real-Time Video Assistance，类似 Be My Eyes）

本维度与 BeeUrEi 的"端侧不依赖服务器算力"硬约束并不冲突，关键在于区分两类服务器用途：①AI 推理/算力（约束要求全部端侧完成，这里完全不涉及）；②实时视频通话所必需的信令(signaling)、NAT 穿透(STUN/TURN 中继)与志愿者匹配后端——后者属于"通信协调"而非"算力推理"，在物理上无法完全避免（尤其 TURN 中继，移动网络下 NAT/防火墙会导致约 10-20% 的呼叫必须经中继才能连通）。因此正确表述是：BeeUrEi 仍可宣称"所有 AI 推理在设备端"，但呼叫功能不可避免地需要一个轻量后端（仅做信令+中继+匹配，零 AI）。对 iOS 新手而言，最务实的路径是采用托管 RTC SDK（推荐 Agora 或 Daily，月免 10000 分钟；LiveKit Cloud 为开源系托管但免费额度较小），它把 SFU/TURN/信令全部托管，开发者只需集成 Swift SDK + CallKit/PushKit 来响应来电，无需自建服务器。Be My Eyes 的核心范式是"单向视频+双向语音"，把求助随机广播给同语言、当地白天时段的多名在线志愿者，英语平均接通约 15 秒，依托 1,000,000 视障用户 / 10,000,000+ 志愿者的庞大池子。双角色（视障求助者 / 明眼志愿者）应在同一 App 内通过角色选择 onboarding 实现，配合举报、屏蔽、可选录制等隐私安全机制。

**要点：**

- (high) **硬约束澄清：端侧不做推理 ≠ 无需任何服务器；信令与 TURN 中继不可避免** — WebRTC 视频通话必需五大组件：signaling channel（交换 SDP/ICE）、STUN（发现公网地址）、TURN（直连失败时中继媒体流）、WebRTC 框架本身、iOS plumbing（CallKit/PushKit/AVAudioSession）。STUN/TURN 仅做网络穿透与媒体转发，不做任何 AI 推理，不违反'算力端侧'约束。业界明确警告：只部署 signaling 而省略 TURN，会导致一部分呼叫（移动网络下常见 10-20%）因 NAT/防火墙无法连通。故 BeeUrEi 的准确表述应为'所有 AI 推理在设备端完成；实时通话所需的信令与 TURN 中继由轻量后端/托管 SDK 承担，且该后端不参与任何 AI 推理'。
  - 来源：https://www.forasoft.com/blog/article/webrtc-in-ios-145 ; https://webrtc.ventures/2024/11/mastering-stun-turn-servers-a-guide-to-proper-integration-for-webrtc-applications/
- (high) **自建 Google WebRTC vs 托管 SDK：新手强烈推荐托管 SDK** — 自建（开源 WebRTC 框架 + 自托管 SFU 如 mediasoup/LiveKit OSS）需 8-14 周才能到生产级 iOS，要自己运维 TURN、信令、SFU、扩容；托管 SDK（LiveKit Cloud / Daily / Agora / 100ms）只需 1-3 周到 MVP，SFU/TURN/信令全托管。成本拐点经验法则：月用量 <100 万分钟用 SDK，>500 万分钟才考虑自托管。BeeUrEi 是 1对1 协助场景（一个视障+一个志愿者），属 P2P 或最简 SFU，更应直接用托管 SDK。
  - 来源：https://www.forasoft.com/blog/article/webrtc-in-ios-145
- (high) **Twilio Programmable Video 已于 2024 年 12 月 EOL，不应再选** — Twilio 的可编程视频产品已在 2024 年 12 月停止服务（end-of-life），新项目不要考虑。这是把它从候选清单剔除的关键时效信息。
  - 来源：https://getstream.io/blog/livekit-alternatives/
- (high) **托管 SDK 免费额度与成本量级对比（2025-2026）** — Daily.co：每月免费 10,000 participant-minutes，超出后 $0.004/分钟，DX 口碑好；Agora：每月免费 10,000 分钟（RTC 各产品共享），2025-08-29 起新项目自动订阅 RTC Free 包，音频 $0.004/track-min、视频 $0.0066-$0.024/track-min，全球 SD-RTN 网络、文档与 iOS 1对多教程齐全；100ms：免费 10,000 分钟，含预制 UI 组件与转录等；LiveKit Cloud：免费档(Build)仅约 5,000 WebRTC 分钟 + 100 并发 + 50GB 下行，超额硬上限直接失败，连接费 $0.0005/min 起、带宽 $0.12/GB 起，上行带宽免费，开源可后续自托管迁移。对早期/小规模公益 App，Agora 或 Daily 的 10,000 免费分钟最宽裕。
  - 来源：https://www.daily.co/pricing/video-sdk/ ; https://docs.agora.io/en/video-calling/overview/pricing ; https://livekit.com/pricing
- (high) **Be My Eyes 匹配机制：随机广播 + 语言/时区匹配 + 多人并发推送** — 求助发起时，系统把通知同时推送给多名'说同一语言、且当地处于白天(约8:00-21:00)时段'的在线志愿者，谁先接谁服务，确保总有人在线。例：美国用户深夜求助会接到澳大利亚白天的英语志愿者。接通后建立'单向视频+双向语音'（志愿者看摄像头画面、双方语音交流）。英语平均接通 <15 秒，多数其他语言 <30 秒。规模：100 万视障用户 / 1000 万+志愿者 / 150+ 国家 / 180+ 语言——这种'供给远大于需求'的池子是低等待的根本原因，新 App 早期难复制，需冷启动策略。
  - 来源：https://www.bemyeyes.com/news/be-my-eyes-reaches-1-million-blind-and-low-vision-users-and-10-million-volunteers/ ; https://support.bemyeyes.com/hc/en-us/articles/360005536558-Getting-Started-with-Be-My-Eyes
- (high) **志愿者接通依赖 VoIP 推送：PushKit + CallKit 是 iOS 必备且有硬性合规要求** — 志愿者 App 通常不在前台，需用 PushKit(VoIP push) 在后台唤醒并用 CallKit 弹出系统级来电界面。iOS 13+ 强制：收到 VoIP push 后必须立即调用 reportNewIncomingCall 上报 CallKit，否则系统会终止 App；反复不上报会导致系统停止再向该 App 投递 VoIP 推送。这是 BeeUrEi 实现'呼叫在线志愿者'的核心 iOS 原生技术点，新手需特别注意此合规约束。
  - 来源：https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit ; https://getstream.io/blog/pushkit-for-calls/
- (high) **单 App 双角色设计：onboarding 角色选择 + 可切换** — 主流做法是'一个 App 容纳所有角色'(类比 Facebook Marketplace 买家/卖家)，在首页前加一个角色选择 onboarding 屏，让用户先选'求助者(视障)'或'志愿者(明眼)'，并保留后续切换入口。注意避免每步都要重选角色（增加交互成本与认知负担）。对 BeeUrEi 尤其重要：求助者侧界面必须 100% VoiceOver 友好、大触控区、最少步骤一键呼叫；志愿者侧可走常规视觉 UI。两套体验差异大，建议进入后即按角色分流到不同导航栈。
  - 来源：https://medium.com/design-bootcamp/design-iteration-guide-two-distinct-user-types-in-one-app-817d8f9df687
- (high) **隐私与安全：录制、举报屏蔽、志愿者无法保证质量** — Be My Eyes 做法：视频/照片传输与存储均加密；会记录并存储通话用于安全与改进（用户可关注模型训练的退出选项）；通话后可在 App 内直接举报滥用以便平台立即处置；社区准则约束行为；平台明示'无法保证志愿者帮助质量、不为其行为负责'。视频含高度敏感信息（住址、证件、银行卡），需在 UI/培训中提醒用户避免暴露隐私。BeeUrEi 设计要点：默认是否录制要谨慎(录制利于事后举报取证但增加隐私与存储/合规负担)、明确告知与同意、提供事后举报+屏蔽、对志愿者做基础准入(实名/邮箱验证/行为分)。
  - 来源：https://www.bemyeyes.com/privacy-policy/ ; https://support.bemyeyes.com/hc/en-us/articles/360006067278-Community-Guidelines
- (high) **最小化后端（仅 signaling+TURN+匹配，零 AI）与 serverless 选项** — 若用托管 RTC SDK(Agora/Daily/LiveKit Cloud)，signaling+STUN+TURN+SFU 全部由 SDK 托管，开发者几乎不需自建服务器，仅需一处生成 token 的轻量端点。匹配/在线状态/角色数据可用 Firebase(Firestore + Cloud Functions)实现纯 serverless：官方 WebRTC+Firebase codelab 用 Firestore 作信令 broker，Cloud Functions 跑后端逻辑而无需管理服务器，天然适合新手且零 AI 推理。注意：自带 TURN 的最朴素自建方案是 coturn，但运维门槛高，新手不建议。
  - 来源：https://firebase.google.com/docs/functions ; https://webrtc.org/getting-started/firebase-rtc-codelab
- (medium) **Be My Eyes 的通话范式与带宽：单向视频降低端侧/网络压力** — 采用'单向视频(求助者→志愿者)+双向音频'，志愿者不必开摄像头，既保护志愿者隐私也降低带宽与电量。Agora 文档将此类场景映射为合适的 channel profile/client role 配置(广播者发流、其余接收)。这对视障用户的移动数据与续航更友好，BeeUrEi 应沿用该范式而非全双工视频。
  - 来源：https://www.agora.io/en/blog/building-a-one-to-many-ios-video-app-with-agora/

**对 BeeUrEi 的建议：**

- 对新手最易落地：首选托管 RTC SDK（Agora 或 Daily），二者均提供每月 10,000 免费分钟，把 SFU/STUN/TURN/信令全部托管，iOS 有原生 Swift SDK，开发者只需集成 SDK + CallKit/PushKit，几乎不必自建/运维服务器，1-3 周可到 MVP。LiveKit Cloud 作为备选（开源系、未来可自托管迁移），但免费额度小(约5000分钟)且超额硬失败，更适合后期。
- 对外宣传与合规口径要精确：可声明'所有 AI 推理(避障检测、路线/场景理解)100% 在 iPhone 端完成，不上传画面做云端推理'；同时如实说明'实时志愿者通话依赖第三方托管的信令与 TURN 中继来建立连接，这些组件只转发音视频、不做任何 AI 推理'。切勿宣称'完全无服务器'，否则与 WebRTC 物理现实不符。
- 坚决不要选 Twilio Programmable Video（2024-12 已 EOL）；也不建议新手从零自建 Google WebRTC + coturn + 自托管 SFU（需 8-14 周且运维重）。
- 志愿者接通必须用 PushKit(VoIP push) + CallKit：收到 VoIP push 后立即调用 reportNewIncomingCall 上报，否则 iOS 13+ 会杀进程并停止投递推送。这是 MVP 不可省的原生技术点，建议早期就把这条合规走通。
- 匹配后端用纯 serverless 起步：Firebase Firestore 存志愿者在线状态/语言/时区/角色，Cloud Functions 做'随机广播给同语言、当地白天的 N 名在线志愿者'的匹配与 token 签发，零 AI、零服务器运维，契合新手与端侧约束。生成 RTC token 的端点也放在 Cloud Functions。
- 沿用 Be My Eyes 的'单向视频(求助者摄像头)+双向语音'范式：志愿者不开摄像头，降低带宽、续航与志愿者隐私风险；用 SDK 的 broadcaster/audience(发流/收流)角色配置实现。
- 双角色单 App 设计：进入即用无障碍友好的角色选择 onboarding 分流到'求助者'与'志愿者'两套导航栈，保留切换入口但避免每步重选；求助者侧务必全程 VoiceOver 适配、大按钮、一键呼叫。
- 隐私安全清单（MVP 必备）：志愿者基础准入(邮箱/实名/年龄声明)、通话后一键举报+屏蔽、社区准则与服务条款、传输与存储加密、明确的录制告知与同意(建议默认不录制或仅在用户明确开启时录制，以降低敏感信息与合规风险，但保留举报取证机制)、在求助界面提醒勿暴露证件/银行卡/住址。
- 冷启动策略：新 App 没有 Be My Eyes 的千万志愿者池，难达 15 秒接通。早期可先做'端侧 AI 兜底 + 小规模志愿者社群/亲友绑定名单'，或先接入 Be My Eyes 之外的志愿者招募渠道，避免求助无人接听的体验崩塌。
- 成本预估给新手一个量级感：1对1 协助一次约 5 分钟、双方各计费=约 10 participant-min；Daily/Agora 每月 10,000 免费分钟 ≈ 约 1,000 次免费通话/月，足够 MVP 与早期验证，超出后约 $0.004/分钟，成本可控。

**风险：**

- 把'端侧不依赖服务器算力'误读为'完全不需要任何服务器'，会导致架构无法实现实时通话——TURN 中继与信令在物理上不可省，对外宣传若措辞不当还可能构成误导。
- 志愿者池冷启动不足：没有足够在线志愿者会造成长时间无人接听，直接摧毁视障用户信任；这是产品而非技术风险，且新 App 最易踩。
- 隐私/合规风险：视频常含住址、证件、银行卡等敏感信息；若录制则涉及数据存储、跨境传输、GDPR/CCPA 与未成年人保护等合规；志愿者行为不可控，需举报/屏蔽/准入机制兜底。
- 托管 SDK 免费额度为硬上限(尤其 LiveKit Build 超额直接失败)且单价随规模累积；若用户量增长，通话成本与带宽费可能成为公益项目的持续支出压力。
- CallKit/PushKit 合规复杂：VoIP push 未及时上报会被系统杀进程并停推，新手易在后台来电这一环踩坑，导致志愿者收不到呼叫。
- 对 SDK 供应商的依赖与锁定：Twilio Video EOL 就是先例，选型需评估厂商长期可用性与迁移成本(LiveKit 开源可自托管这点在退出策略上更有优势)。

**开放问题：**

- BeeUrEi 早期志愿者从哪里来？是自建志愿者社群、绑定亲友名单，还是设法复用既有志愿者网络？这决定接通率与产品可行性。
- 是否录制通话？需在'便于事后举报取证'与'隐私/存储/合规负担'之间做产品决策，并明确告知与同意流程。
- 目标用户的主要语言/地区？决定语言匹配与时区覆盖策略，以及是否需要多语言志愿者。
- 预算与可持续性：公益项目能否承受免费额度耗尽后的按分钟计费？是否申请 SDK 厂商的非营利/可访问性折扣(部分厂商对 accessibility/非营利有优惠，值得直接联系商务确认)。
- 是否需要 token 签发/匹配以外的任何后端能力（如举报工单后台、志愿者管理后台）？这会影响后端是否可纯 serverless。

### 无障碍设计与安全/合规 (Accessibility Design & Safety/Compliance)

BeeUrEi 服务于视障用户，无障碍不是"加分项"而是产品的全部——界面必须可被 VoiceOver 完全操作、可纯听觉+触觉使用，否则目标用户根本无法上手。技术上要点清晰：用 SwiftUI 的 accessibility 修饰符给每个交互元素加准确 label/hint/trait，支持 Dynamic Type（低视力用户需要大字），颜色对比满足 WCAG 1.4.3 的 4.5:1（大字 3:1），点按目标 ≥44×44pt。多模态输出（TTS / 提示音/空间音频 / Core Haptics 震动）必须做明确的"分工 + 优先级分层"，避免信息过载或互相打断——这是导航类盲人 App 成败的关键。安全/责任层面有几条硬红线：必须把产品明确定位为"辅助工具，不替代白手杖/导盲犬/定向行走(O&M)训练"，否则一旦误导致伤将面临严重法律风险，且 App Store Guideline 1.4.1（安全-身体伤害）会以更高标准审查。隐私合规上，相机/定位/麦克风权限的 Info.plist purpose string 必须具体清晰、需提供 Privacy Manifest(PrivacyInfo.xcprivacy，2024-05 起强制)、坚持数据最小化；远程视频会拍到路人，涉及第三方(bystander)隐私与 GDPR。最后，必须真正邀请视障用户全程参与设计与测试（"Nothing about us without us"），否则 sighted 开发者极易做出"看起来无障碍、实际不可用"的产品。

**要点：**

- (high) **VoiceOver 是 App Store 官方可声明的无障碍能力，且有明确评测标准** — Apple App Store Connect 的 VoiceOver evaluation criteria 要求：用户仅靠 VoiceOver 就能完成 App 所有常见任务、无需明眼人协助。具体硬性要求包括：①所有控件(按钮/图标/表单/文本框)有简洁准确的 label，且要脱离上下文也能懂(禁止'点这里''了解更多')；②VoiceOver 要能播报元素类型与状态/值(如'复选框，已勾选')，用 accessibilityTraits 实现；③装饰性图片必须对 VoiceOver 完全隐藏；④导航完整、不卡死、不跳项、不循环，弹出 modal 时光标要逻辑地移到新内容；⑤所有可点/拖的操作都要能用 VoiceOver 触发，复杂手势(拖拽/长按)要做成 custom actions(actions rotor)；⑥要在所有支持的设备上实测。对 BeeUrEi 而言这是设计阶段就要满足的底线，而非后期补丁。
  - 来源：https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voiceover-evaluation-criteria/
- (high) **SwiftUI 做 VoiceOver 可用界面的核心修饰符** — 用 .accessibilityLabel(_:) 描述元素是什么(简洁，最先读)、.accessibilityHint(_:) 描述操作后会发生什么(用户可在系统关闭 hint)、.accessibilityValue(_:) 描述当前值、.accessibilityAddTraits/.removeTraits 设置 .isButton/.isSelected 等特性、.accessibilityHidden(true) 隐藏装饰元素、.accessibilityElement(children:.combine) 把一组视图合并为单个可读元素、.accessibilityAction 加自定义操作。注意 SF Symbol 自带的 label 往往太泛(如'垃圾桶'应写成'删除项目'——描述动作而非图标)。所有 label/hint 都应随 App 本地化一起翻译。
  - 来源：https://www.createwithswift.com/preparing-your-app-for-voice-over-labels-values-and-hints/
- (high) **对比度、Dynamic Type 与触摸目标的具体数值红线** — Apple HIG / App Store Sufficient Contrast 标准与 WCAG 1.4.3(AA)一致：正文文本对比度 ≥4.5:1，大字(≥18pt 或 ≥14pt 粗体)≥3:1；点按目标 ≥44×44pt(Apple 标准)，WCAG 2.2 新增 2.5.8 Target Size(Minimum, AA)为 ≥24×24 CSS px——应取更严的 44pt。Dynamic Type 必须支持文本随系统设置缩放(至少到 200%+ / AX 大字级)且布局不截断、不重叠——低视力用户高度依赖大字。不能仅用颜色传达信息。SwiftUI 用 Font.body 等语义字体 + .dynamicTypeSize 即可自动支持。
  - 来源：https://developer.apple.com/help/app-store-connect/manage-app-accessibility/sufficient-contrast-evaluation-criteria
- (high) **Core Haptics：盲用户在看不到屏幕时最依赖触觉，必须一致** — Apple HIG 明确：'用户在看不到屏幕时最依赖 haptics，请在 App 内一致地使用系统定义的 haptics，避免让用户困惑。' Core Haptics(iOS 13+)用 CHHapticEngine + CHHapticPattern + CHHapticEvent 自定义震动，关键参数 intensity(强度)与 sharpness(锐度)取值 0–1。建议用单例 HapticManager 统一管理所有震动模式，让同一含义对应固定模式(如'前方障碍'=连续强震、'到达路口'=两短促震、'操作成功'=轻单击)。对 BeeUrEi 这是把'空间/方向'信息编码成可学习触觉语言的核心手段(如左/右转用不同节奏)。
  - 来源：https://medium.com/design-bootcamp/apples-human-interface-guidelines-on-accessibility-e9c3945b2ec5
- (high) **多模态输出必须做明确分工与优先级分层，否则信息过载/互相打断** — 三条通道建议分工：①TTS(AVSpeechSynthesizer)承载语义信息(路线指引、远处障碍描述、菜单朗读)——AVSpeechUtterance 可调 rate/pitch/volume，多条 utterance 会自动排队;②提示音/空间音频承载方向与紧急度(用立体声/空间音频指示障碍在左/右，短促音=高优先级)；③Core Haptics 承载即时、贴身的物理提示(临近障碍、确认操作)。关键设计:紧急避障提示(可能撞上)必须能打断(interrupt)正在播报的导航语音并优先播放;一般导航/确认类信息排队不打断。AVSpeechSynthesizer 用 stopSpeaking(at: .immediate) 实现高优先级抢占。还要设置 AVAudioSession 类别(如 .playback + .duckOthers / .mixWithOthers)以与 VoiceOver、音乐共存而不冲突。WWDC20'Create a seamless speech experience'建议用 usesApplicationAudioSession 让系统处理音频中断。需建立明确的'优先级层级':P0 安全/避障(打断一切)>P1 转向指令>P2 状态/确认>P3 环境描述。
  - 来源：https://developer.apple.com/videos/play/wwdc2020/10022/
- (high) **安全红线：必须明确定位为'辅助工具，不替代白手杖/导盲犬/O&M训练'** — 行业共识(Perkins School、Lighthouse Guild、定向行走专家)是:导航 App 与智能手杖都不能替代白手杖与定向行走(O&M)训练,它们是'互补层',即使用智能方案也应保留传统手杖作后备。BeeUrEi 必须在首次启动(onboarding)、用户协议、以及关键时刻持续告知用户:本 App 不保证检测所有障碍(尤其低悬、玻璃、坑洞、移动车辆、台阶边缘),不得作为唯一出行依赖。这既是伦理义务也是降低'误导致伤'法律风险的核心手段。
  - 来源：https://www.perkins.org/resource/how-i-use-my-phone-orientation-and-mobility/
- (high) **法律/审核风险：App Store Guideline 1.4.1 会以更高标准审查可能致身体伤害的 App** — App Store Review Guidelines 1.4(Safety-Physical Harm)/1.4.1:可能提供不准确信息、或可能造成身体伤害的 App 会被更严格审查;需清晰披露数据与方法以支撑准确性声明,无法验证则会被拒;应提醒用户在做相关决策前另行核实(类比医疗 App 提醒'请咨询医生')。建议 BeeUrEi:不要做绝对化的安全承诺(避免'保证检测所有障碍'之类措辞),在描述与 App 内明确局限,并保留清晰的免责声明(disclaimer)+ 用户知情同意。误导致伤在多法域可能触发产品责任/过失侵权,因此免责声明虽不能完全免责,但'清晰、显著、反复告知局限'是必要的尽职动作。
  - 来源：https://developer.apple.com/app-store/review/guidelines/
- (high) **权限文案(Info.plist purpose string)必须具体清晰，否则被拒** — 相机/定位/麦克风必须在 Info.plist 声明 purpose string,系统授权弹窗会原样展示给用户。所需键:NSCameraUsageDescription(主摄像头避障与志愿者视频)、NSLocationWhenInUseUsageDescription(步行路线导航,优先 WhenInUse 而非 Always)、NSMicrophoneUsageDescription(与志愿者实时语音)。Apple 要求文案清晰完整说明为何需要该数据,模糊或缺失会导致 App Store/TestFlight 直接拒审。文案应面向用户、说明具体用途与受益(如'用于通过摄像头识别前方障碍并向你语音提示')。
  - 来源：https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CocoaKeys.html
- (high) **Privacy Manifest(PrivacyInfo.xcprivacy)已强制，需声明数据类型与 Required Reason API** — 自 2024-05-01 起,新 App/更新若使用 Required Reason API 而未在 PrivacyInfo.xcprivacy 中说明,App Store Connect 不予接受;自 2025-02-12 起,使用常见第三方 SDK 也必须随附其 privacy manifest。该 plist 记录:App 及第三方 SDK 收集的数据类型、各 Required Reason API 的使用理由、访问的域名。Xcode 在打包时把所有 manifest 合并成 Privacy Report,并据此生成 App Store 隐私'营养标签'。BeeUrEi 即便所有 AI 推理在端侧(无服务器算力依赖),仍需如实声明定位、相机帧、音视频等的处理与是否离开设备。
  - 来源：https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- (high) **远程视频涉及第三方(bystander)隐私与数据最小化** — 呼叫明眼志愿者时摄像头会拍到无关路人,这些人无法同意却被处理个人数据,在 GDPR 下是明确难点(背景中被无意拍到的人无法获得有效同意)。隐私优先平台应'只收集服务所必需的最少数据,且在通话前让用户知道收集什么'。建议:①默认不录制视频(仅实时传输,用完即弃,数据最小化);若需录制必须显著告知并取得明确同意(affirmative act,默认不反对不算同意);②向志愿者明确仅用于即时协助、禁止录屏/转发;③考虑端到端加密;④隐私政策说明视频如何传输/是否经服务器中转/保留多久。把'AI 全端侧'作为隐私卖点时,要清楚区分'AI 推理在端侧'与'志愿者视频通话仍需经网络传输'。
  - 来源：https://www.digitalsamba.com/blog/gdpr-compliant-video-conferencing
- (high) **必须真正邀请视障用户参与设计与测试('Nothing about us without us')** — 残障社区与无障碍研究的共识原则:'没有我们的参与,不要替我们做决定'。参与式设计(participatory/co-design)涵盖前期调研、利益相关者咨询、原型可用性测试、同伴领导。盲人无障碍研究因人群基数小,常见样本量 6–12 人即有效;招募可通过盲人组织(如各地盲协、NFB/ONCE 类机构)、O&M 训练师、AppleVis 等社区。对 iOS 新手的实操建议:用 TestFlight 招募真实视障 beta 用户,让他们开着 VoiceOver、在真实街道场景下走查;sighted 开发者自己也要全程开 VoiceOver+关屏使用,但绝不能用这个替代真实用户测试。
  - 来源：https://www.perkins.org/resource/how-i-use-my-phone-orientation-and-mobility/
- (medium) **语音体验应与 VoiceOver 协调，避免双声源/打断混乱** — 当 VoiceOver 开启时,App 自定义 TTS 与 VoiceOver 的语音可能并存导致混乱与不适。最佳实践:检测 UIAccessibility.isVoiceOverRunning,在 VoiceOver 开启时优先用 accessibility 通知(AccessibilityNotification/UIAccessibility.post(notification:))把信息交给 VoiceOver 朗读,或确保自定义语音不与之争抢;让自定义语音与 VoiceOver 使用一致的语音/语速以减少违和。临时状态横幅、警报必须通过 accessibility notification 传达,否则盲用户感知不到。
  - 来源：https://niteeshyadav.com/blog/designing-for-voiceover-common-accessibility-issues-245848/

**对 BeeUrEi 的建议：**

- 从第一天就把无障碍当作核心需求:每个 SwiftUI 视图都加 accessibilityLabel/Hint/Value/Traits,装饰元素 accessibilityHidden(true),用 .accessibilityElement(children:.combine) 合并卡片;开发全程开着 VoiceOver + 关屏自测,但这不能替代真实视障用户测试。
- 为三条输出通道写一份明确的'信息架构与优先级表':TTS=语义、空间音频/提示音=方向+紧急度、Core Haptics=即时贴身提示;定义 P0(避障,打断一切,用 stopSpeaking(.immediate) 抢占)到 P3(环境描述,排队)的优先级层级,并在代码里用一个统一的 FeedbackCoordinator/单例管理,防止三通道互相打断或信息过载。
- 设置正确的 AVAudioSession(如 .playback + .duckOthers 或 .mixWithOthers),并检测 isVoiceOverRunning 与 VoiceOver 协调,避免双声源;Core Haptics 用单例 HapticManager 固定'一种含义=一种震动模式'形成可学习的触觉语言。
- 满足数值红线:正文对比 ≥4.5:1、大字 ≥3:1、点按目标 ≥44×44pt、全面支持 Dynamic Type 到 AX 大字级且不截断;不要仅靠颜色传达信息(低视力用户也是目标人群)。
- 安全/责任:在 onboarding、用户协议、关键场景持续、显著地告知'BeeUrEi 是辅助工具,不替代白手杖/导盲犬/O&M 训练,不保证检测所有障碍';避免任何绝对化安全承诺;准备清晰的免责声明并取得用户知情同意,以降低误导致伤的产品责任风险并符合 Guideline 1.4.1。
- 隐私合规:为相机/定位/麦克风写具体清晰的 Info.plist purpose string(定位优先 WhenInUse);创建并维护 PrivacyInfo.xcprivacy(声明数据类型、Required Reason API、域名,2024-05 起强制);坚持数据最小化。
- 针对远程志愿者视频:默认不录制(用完即弃),若录制需显著告知+明确同意;明确告知志愿者会拍到路人(bystander)、禁止录屏转发;考虑端到端加密;在营销中清楚区分'AI 推理端侧'与'视频通话仍经网络传输',不要误导用户以为视频也不出设备。
- 通过 TestFlight 招募真实视障 beta 用户(可联系当地盲协、O&M 训练师、AppleVis 社区),让他们在真实街道场景、开着 VoiceOver 走查;样本 6–12 人即有价值,贯彻'Nothing about us without us'。
- 声明 App Store 无障碍'营养标签'时务必如实——满足 VoiceOver evaluation criteria(可仅用 VoiceOver 完成所有常见任务)后再勾选 VoiceOver 支持,这本身也是优质宣传点。

**风险：**

- 误导致伤的法律风险最高:若用户因 App 漏报障碍而受伤,可能触发产品责任/过失侵权;免责声明可降低但不能完全消除责任,'清晰、显著、反复告知局限'是必要尽职动作。
- App Store 审核风险:Guideline 1.4.1(Safety-Physical Harm)会对此类 App 更严格审查;绝对化安全承诺、模糊权限文案、缺失 Privacy Manifest 都可能直接被拒。
- 第三方(bystander)隐私:远程视频拍到无关路人在 GDPR 等法域属灰区,无法取得有效同意;默认不录制 + 端到端加密 + 明确告知是关键缓解措施。
- '看似无障碍实则不可用':sighted 开发者仅靠自测 VoiceOver 极易遗漏真实视障用户的痛点(如手势冲突、信息过载、播报时机),不做真实用户测试是产品失败的主要风险。
- 多模态信息过载:TTS+音效+震动若无优先级分层与互斥管理,会在繁忙街景下变成噪音,反而降低安全性。
- 'AI 全端侧'宣传与实际不符的合规风险:志愿者视频通话仍需经网络,若营销暗示所有数据都不出设备,可能构成误导并影响隐私标签准确性。

**开放问题：**

- BeeUrEi 是否计划录制志愿者视频通话?录制与否直接决定隐私合规复杂度(GDPR 同意、保留期、第三方隐私)。
- 目标发行地区?欧盟(GDPR + 2025-06-28 生效的 European Accessibility Act,WCAG 2.5.8 等 AA 成为法律要求)、美国(ADA/Section 508)、中国(信息无障碍国标 GB/T 37668 等)合规要求不同。
- 志愿者视频是否端到端加密、是否经自有服务器中转?这关系到'AI 端侧'隐私叙事的一致性。
- 是否会与盲人组织/O&M 训练机构正式合作以招募测试用户并背书安全定位?
- 紧急避障的判定阈值与误报/漏报权衡如何设计?这直接影响优先级层级与安全免责的措辞。

### iOS 新手工程基础（第一次做 App）

面向"第一次写 iOS App"的开发者，给出 BeeUrEi 的工程起步路线。当前（2026 年 6 月）官方主线是 iOS 26 / Xcode 26 / Swift 6，UI 框架优先选 SwiftUI（新人首选、声明式、跟 Apple 主推方向一致），相机底层用 AVFoundation（AVCaptureSession + AVCaptureVideoDataOutput → CVPixelBuffer），AI 推理用 Core ML + Vision，全部可在端侧完成，完全满足"不依赖远程算力"的硬约束。真机摄像头测试只需免费 Apple ID（Free Provisioning）即可起步，但 7 天过期且无法用 TestFlight，发布/长期测试需要 99 美元/年的 Apple Developer Program。设备建议优先 iPhone 12 Pro 及以上的 Pro 机型（带 LiDAR，可做高精度避障与深度测距），最低部署目标建议 iOS 17（拿到 @Observable 等现代特性，同时覆盖面够广）。架构采用 SwiftUI 原生的 MVVM（@Observable + @State），按 Capture / Perception / Navigation / Feedback / RemoteAssist / Accessibility 分模块。依赖用 Swift Package Manager（Xcode 内置）。注意：相机、Vision 实时推理只能在真机上验证，模拟器没有摄像头。

**要点：**

- (high) **当前官方主线是 iOS 26 / Xcode 26 / Swift 6（2026 年 6 月）** — WWDC25 发布 iOS 26、Xcode 26（含 Swift 6 并发模型、actor 隔离、更简洁的 async/await）以及全新 Liquid Glass 设计语言。新人应直接下载最新版 Xcode（Mac App Store 免费），用最新 SDK 构建，但部署目标（Minimum Deployments）可单独设低以覆盖旧设备——SDK 版本与部署目标是两回事。
  - 来源：https://developer.apple.com/videos/play/wwdc2025/219/ ; https://medium.com/@serkankaraa/xcode-26-ios-26-the-new-frontier-of-apple-development-7ab30b81faf0
- (high) **真机摄像头测试用免费 Apple ID 即可起步，但有硬限制；发布需 99 美元/年** — Free Provisioning：仅用 Apple ID 登录 Xcode 即可把 App 装到自己的 iPhone 上测相机，无需付费。限制：签名的 build 7 天后过期需重装，provisioning profile 1 周过期，且无法用 TestFlight、Push、iCloud 等服务。要上架 App Store、用 TestFlight 邀请测试者、或长期稳定调试，需加入 Apple Developer Program（99 美元/年）。相机权限本身免费即可测。
  - 来源：https://catdoes.com/blog/how-to-test-app-on-iphone ; https://learn.microsoft.com/en-us/previous-versions/xamarin/ios/get-started/installation/device-provisioning/free-provisioning
- (high) **设备建议：优先 iPhone 12 Pro 及以上 Pro 机型（带 LiDAR）** — LiDAR 仅内置于 iPhone/iPad 的 Pro 机型，从 iPhone 12 Pro / 12 Pro Max 起。LiDAR 对盲人避障价值极大——可获取真实深度（米级测距），现有同类 App（EyeGuide、Super Lidar、Seeing AI 的 World/Apple 放大器的门检测/人物检测）都靠它做障碍距离提示且全部端侧处理。建议：开发主力机用一台带 LiDAR 的 Pro；但 App 应优雅降级——非 Pro 机型退回纯 Vision/Core ML 视觉避障。
  - 来源：https://www.applevis.com/forum/ios-ipados/use-lidar-sensor-iphone-pro-model ; https://techcabal.com/2025/10/24/eyeguide-uses-lidar-to-help-blind-people-navigate-public-spaces/
- (medium) **最低部署目标建议 iOS 17（拿到 @Observable，覆盖面足够）** — Xcode 26 仍可把 Minimum Deployments 设到很低（如 iOS 15+）。但 iOS 17 引入的 Observation 框架（@Observable 宏）是现代 SwiftUI MVVM 的基石，强烈建议至少 iOS 17。若想用 WWDC24/25 的新东西（Swift 原生 Vision API、Foundation Models 端侧 LLM）则需 iOS 18 / iOS 26。对一个无障碍新项目，iOS 17 是稳妥的最低线。
  - 来源：https://developer.apple.com/documentation/SwiftUI/Migrating-from-the-observable-object-protocol-to-the-observable-macro ; https://www.avanderlee.com/workflow/minimum-ios-version/
- (high) **SwiftUI vs UIKit：新人选 SwiftUI 为主，相机预览处用 UIViewRepresentable 桥接** — SwiftUI 声明式、代码量小、是 Apple 主推方向，最适合第一次做 App。但实时相机预览层（AVCaptureVideoPreviewLayer）属 UIKit/AVFoundation，需要用 UIViewRepresentable 包一层嵌入 SwiftUI。常见模式：UIViewRepresentable 内放预览层 + 一个 Coordinator 作为 AVCaptureVideoDataOutputSampleBufferDelegate 接帧，把推理结果写进 @Observable 的 ViewModel 驱动 SwiftUI 叠加层（bounding box、文字）。
  - 来源：https://dev.to/programmingcentral/bridging-the-gap-mastering-real-time-ai-camera-feeds-in-swiftui-with-uiviewrepresentable-pn5 ; https://neuralception.com/detection-app-tutorial-camera-feed/
- (high) **相机实时取帧骨架：AVCaptureSession + AVCaptureVideoDataOutput → CVPixelBuffer** — 标准骨架：建一个继承 NSObject 的 CameraManager，持有 AVCaptureSession、AVCaptureDeviceInput（后置主摄）、AVCaptureVideoDataOutput；用一条串行 DispatchQueue 接收帧回调保证有序。实现 captureOutput(_:didOutput sampleBuffer:from:)，从 CMSampleBuffer 取出 CVPixelBuffer 喂给 Vision/Core ML。必须在 Info.plist 加 NSCameraUsageDescription（Privacy - Camera Usage Description）说明用途，否则启动相机会崩溃。授权流程用 AVCaptureDevice.authorizationStatus / requestAccess。注意 session 配置和启动要放到后台队列，别阻塞主线程。
  - 来源：https://www.createwithswift.com/camera-capture-setup-in-a-swiftui-app/ ; https://developer.apple.com/documentation/vision/recognizing-objects-in-live-capture
- (high) **Core ML 集成：拖入 .mlpackage，用 Vision 跑推理** — 把 .mlmodel/.mlpackage 拖进 Xcode 工程（勾 Copy items if needed + 选中 target），Xcode 自动生成同名 Swift 类。推理两条路：(1) 直接用生成类 model.prediction(...)；(2) 推荐配合 Vision——VNCoreMLModel(for:) 包装模型，VNCoreMLRequest 发请求，VNImageRequestHandler(cvPixelBuffer:) 执行，结果转 VNRecognizedObjectObservation（目标检测含归一化 bounding box）。.mlpackage 是较新格式（ML Program），比旧 .mlmodel 功能更全。
  - 来源：https://developer.apple.com/documentation/coreml/integrating-a-core-ml-model-into-your-app ; https://www.createwithswift.com/tutorial-core-ml-using-an-object-detection-machine-learning-model-in-an-ios-app/
- (medium) **iOS 18+ 起 Vision 有全新 Swift 原生 API（async/await，去掉 VN 前缀），但旧 API 仍可用** — WWDC24 推出 Swift 原生 Vision：去掉 VN 前缀（如 RecognizeTextRequest、DetectBarcodesRequest），用 async/await，结果直接从 try await handler.perform(request) 返回，无需 completion handler；可用 performAll 并行多请求。Apple 明确表示旧 VN* API 不会移除、仍可用，但新功能只在新 API 加，建议新项目优先采用。重要提醒：截至目前 Core ML 自定义模型的推理仍主要走经典 VNCoreMLRequest/VNCoreMLModel 模式（WWDC24 新 API 演示集中在内置请求），自定义模型集成沿用经典写法最稳妥。
  - 来源：https://developer.apple.com/videos/play/wwdc2024/10163/ ; https://www.kodeco.com/ios/paths/apple-ai-models/49307523-vision-framework/04-unveiling-new-vision-framework-features-in-ios-18-ios-26/05
- (high) **coremltools 转换：PyTorch/TensorFlow → .mlpackage（在 Mac 上用 Python 做，不在 App 里）** — 模型转换是离线步骤：pip 装 coremltools（8.x），PyTorch 模型先 torch.jit.trace 转 TorchScript，再 ct.convert(..., convert_to='mlprogram')，model.save('Model.mlpackage')。视觉模型用 ImageType 指定输入 scale/bias（先乘 scale 再加 bias）做归一化。新人若不想自己训练，更省事的是用 Create ML（Xcode 自带、图形界面）直接训练目标检测/图像分类模型，导出即 Core ML 格式，无需写 Python。
  - 来源：https://apple.github.io/coremltools/docs-guides/source/convert-pytorch-workflow.html ; https://apple.github.io/coremltools/source/coremltools.converters.convert.html
- (high) **架构：SwiftUI 原生 MVVM 用 @Observable + @State（取代 ObservableObject/@Published）** — iOS 17 的 Observation 框架：ViewModel 标 @Observable（不再写 @Published），View 持有用 @State（取代 @StateObject），传入子 View 用普通属性（取代 @ObservedObject），性能更好（属性级精确失效）。坑：用 @State 持有 @Observable 时，View 每次重建都会调用初始化器，所以别在初始化里放重逻辑（如启动相机/加载模型），应放到 .task/.onAppear 或显式生命周期里。建议模块：Capture（相机/帧）、Perception（Vision+Core ML+LiDAR 感知）、Navigation（MapKit/CLLocation 步行路线）、Feedback（AVSpeechSynthesizer 语音 + Core Haptics 震动）、RemoteAssist（远程志愿者视频）、Accessibility（VoiceOver/动态字体贯穿全局）。
  - 来源：https://www.avanderlee.com/swiftui/observable-macro-performance-increase-observableobject/ ; https://www.jessesquires.com/blog/2024/09/09/swift-observable-macro/
- (high) **依赖管理首选 Swift Package Manager（Xcode 内置，无需第三方）** — SPM 已是 Apple 官方、Xcode 内置的依赖管理器，新人无需学 CocoaPods。加包：File → Add Package Dependencies，粘贴 Git 仓库 URL，选版本规则（建议 Up to Next Major），选 target，Add Package。BeeUrEi 端侧 AI 约束下基本不需要重型第三方库；唯一可能需要外部 SPM 包的是远程志愿者视频通话（WebRTC，如 stasel/WebRTC 或 LiveKit/Daily 等 SDK）。
  - 来源：https://developer.apple.com/documentation/xcode/adding-package-dependencies-to-your-app ; https://www.hackingwithswift.com/books/ios-swiftui/adding-swift-package-dependencies-in-xcode
- (high) **语音/震动反馈与无障碍：AVSpeechSynthesizer + Core Haptics + UIAccessibility 配合用** — 语音播报用 AVSpeechSynthesizer + AVSpeechUtterance（可调 rate/pitch/语言，默认跟随系统'朗读内容'设置）。关键原则：AVSpeechSynthesizer 不是替代 VoiceOver，要和 UIAccessibility API 配合——对一次性事件播报（如'前方有障碍'）用 UIAccessibility.post(notification:.announcement) 交给 VoiceOver，避免和 VoiceOver 抢话。震动用 Core Haptics（障碍越近震动越强，类似 EyeGuide）。整个 App 要保证 VoiceOver 可用、支持动态字体。
  - 来源：https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer ; https://nshipster.com/avspeechsynthesizer/
- (medium) **导航与远程协助：MapKit/MKDirections（步行）+ WebRTC（视频通话）** — 步行路线：CLLocationManager 取定位+权限，MKDirections.Request 设 transportType=.walking 算路线，异步拿 MKRoute；可逐段语音播报转向。远程明眼志愿者（类 Be My Eyes）：本质是实时视频，工业界标准是 WebRTC（P2P + 信令服务器）。注意——视频通话的信令/转发服务器属网络通信，不违反'AI 推理端侧'约束（约束是 AI 推理不上服务器，而非禁止任何网络）。Be My Eyes 2025 仍以实时视频+AI 连接盲人与志愿者，可作产品参考。
  - 来源：https://developer.apple.com/documentation/mapkit/mkdirections ; https://www.bemyeyes.com/news/be-my-eyes-releases-winter-25-app-update-promising-significant-new-capabilities-for-blind-users/
- (medium) **端侧语音指令与（可选）端侧 LLM 能力已是 2025-2026 标配** — 语音控制 App（'带我去最近的地铁站'）可用 Speech 框架 SFSpeechRecognizer，设 requiresOnDeviceRecognition=true 强制端侧识别（需先确认 supportsOnDeviceRecognition）。iOS 26 还有更新的 SpeechAnalyzer/SpeechTranscriber。WWDC25 的 Foundation Models 框架开放了 Apple Intelligence 端侧 LLM 的 Swift API（最少 3 行代码、离线可用、数据不出设备），可用于把视觉结果转成自然语言播报，完美契合'端侧 AI'约束（需 iOS 26 + 支持 Apple Intelligence 的机型）。
  - 来源：https://developer.apple.com/videos/play/wwdc2025/286/ ; https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition
- (high) **官方权威示例工程：Apple 'Recognizing Objects in Live Capture' 与 'AVCam'** — 最该参考的两个 Apple 官方示例：(1) Recognizing Objects in Live Capture——演示完整实时链路：AVCaptureSession→AVCaptureVideoDataOutput→captureOutput 取 CVPixelBuffer→VNImageRequestHandler→VNCoreMLRequest 跑 Core ML 目标检测，内置一个识别 6 种早餐食物的模型，下载即可在真机跑（注意它是 UIKit）。(2) AVCam——官方相机 App 范例，讲清 AVCaptureSession 输入/输出编排。新人可把 (1) 作为 Perception 模块的起点蓝本。
  - 来源：https://developer.apple.com/documentation/vision/recognizing-objects-in-live-capture ; https://developer.apple.com/documentation/avfoundation/cameras_and_media_capture/avcam_building_a_camera_app

**对 BeeUrEi 的建议：**

- 第一周（搭骨架+跑通相机）：① 在 Mac App Store 装最新 Xcode（26.x），用自己的 Apple ID 在 Xcode 设置里登录拿 Free Provisioning；② 新建 iOS App 工程，Interface 选 SwiftUI，最低部署目标设 iOS 17；③ 在 Info.plist 加 NSCameraUsageDescription；④ 照 Apple 'Recognizing Objects in Live Capture' 示例搭一个 CameraManager（AVCaptureSession + AVCaptureVideoDataOutput），用 UIViewRepresentable 把相机预览嵌进 SwiftUI；⑤ 用数据线接一台真机（最好带 LiDAR 的 Pro），跑通'屏幕能看到后置摄像头实时画面'——这是第一个里程碑，记住模拟器没相机。
- 第二周（接通 AI 推理+语音反馈）：① 用 Create ML（Xcode 自带）或下载现成 Core ML 目标检测模型，拖进工程；② 用 VNCoreMLModel + VNCoreMLRequest + VNImageRequestHandler(cvPixelBuffer:) 在 captureOutput 里对每帧（建议抽帧降频，如每秒 5-10 帧）跑推理，拿到 VNRecognizedObjectObservation；③ 把结果写进 @Observable 的 ViewModel，SwiftUI 叠加层画 bounding box 验证准确性；④ 接 AVSpeechSynthesizer 做最简语音播报（如'前方检测到 人'），并用 UIAccessibility.post(.announcement) 与 VoiceOver 协作；⑤ 全程开 VoiceOver 自测一遍交互。
- 架构上从第一天就按模块分文件夹：Capture / Perception / Navigation / Feedback / RemoteAssist / Accessibility，用 SwiftUI 原生 MVVM（ViewModel 标 @Observable、View 用 @State）。把'启动相机/加载模型'等重逻辑放进 .task 或显式方法，别放进 @State 持有对象的初始化器（每次重建都会调）。
- 设备与降级策略：主力开发机用一台带 LiDAR 的 iPhone Pro（12 Pro 及以上），把 LiDAR 深度（ARKit/AVFoundation depth）作为避障测距的首选信号；同时设计'无 LiDAR 时退回纯 Vision/Core ML 视觉避障'的降级路径，保证非 Pro 用户也能用。
- 依赖管理只用 Swift Package Manager（File → Add Package Dependencies）。端侧 AI 约束下尽量零第三方；唯一可能引入外部 SPM 包的是远程志愿者视频（WebRTC SDK，如 LiveKit 或 stasel/WebRTC）。明确区分约束边界：'AI 推理必须端侧'不等于'禁止任何网络'——视频通话的信令/中转服务器是允许的。
- 进阶（验证完 MVP 后）：考虑升级到 iOS 26 特性——用 Speech 的 requiresOnDeviceRecognition=true 做端侧语音指令、用 WWDC25 Foundation Models 端侧 LLM 把视觉结果转成更自然的语音描述（最少 3 行代码、离线、数据不出设备），这些都严格满足'端侧 AI'硬约束；导航模块用 MKDirections（transportType=.walking）+ CLLocationManager 做步行逐向播报。
- 学习资源主线：以 Apple 官方两份示例（Recognizing Objects in Live Capture、AVCam）+ 官方文档（Integrating a Core ML model、Adding package dependencies、Migrating to @Observable）为权威基准；createwithswift.com、Hacking with Swift、Kodeco 作为新手教程补充。遇到 API 写法分歧时以 developer.apple.com 为准。

**风险：**

- 模拟器没有摄像头：相机取帧、Vision 实时推理、LiDAR 全部只能在真机验证，从第一周就要准备好真机和数据线。
- Free Provisioning 的 7 天过期会反复打断调试：build 7 天后失效需重装，长期开发体验差；一旦项目认真起来建议尽早买 Apple Developer Program（99 美元/年）。
- 实时推理性能与发热：对每一帧都跑 Core ML 会卡顿/掉帧/发热，必须抽帧降频、把 session 配置与推理放后台队列、必要时降低输入分辨率；这是新人最容易踩的性能坑。
- @State + @Observable 的初始化陷阱：用 @State 持有 @Observable ViewModel 时初始化器会随 View 重建反复调用，若把启动相机/加载模型写在初始化里会导致重复创建/资源泄漏。
- API 时代差异导致教程踩坑：网上大量教程混用旧 VN* completion-handler 写法与 iOS 18+ 新 async/await 写法；新人易混淆。自定义 Core ML 模型目前仍以经典 VNCoreMLRequest 为最稳路径，需以官方文档为准核对当前 API。
- 无障碍是核心而非附加：这是给盲人用的 App，VoiceOver 兼容、语音播报不与 VoiceOver 抢话（用 announcement 通知）、动态字体、震动反馈必须从设计阶段就纳入，不能事后补。
- LiDAR 仅 Pro 机型：若只针对带 LiDAR 设备会大幅缩小用户面，必须设计纯视觉降级方案。
- 端侧大模型/新框架的机型门槛：Foundation Models 端侧 LLM 需 iOS 26 + 支持 Apple Intelligence 的较新机型，旧设备无法用，作为可选增强而非核心依赖。

**开放问题：**

- BeeUrEi 的最低支持机型与最低 iOS 版本最终定多少？这直接决定能否依赖 LiDAR、Foundation Models 端侧 LLM、Speech 端侧识别等较新能力。
- 避障的深度来源策略：是以 LiDAR 深度为主（限 Pro 机型）、还是以单目视觉估深为主（全机型可用）、还是两者融合并自动降级？
- 远程志愿者视频用自建 WebRTC 信令/TURN 服务，还是接第三方实时音视频 SDK（LiveKit / Daily / Agora 等）？这决定 SPM 依赖与运维成本。
- 目标检测模型来源：自己用 Create ML 训练、转换开源模型（coremltools），还是直接用 Apple 内置的 Vision 能力（人物/门检测）？影响第二周工作量。
- 是否需要兼顾 iPad 或仅 iPhone？以及是否要支持纯离线（无网络）下的步行导航（MapKit 在线为主）？
