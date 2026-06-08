# BeeUrEi 项目计划书（终稿）

> 隶属组织：**Hiko Sphere 彦穹科技** ｜ 软件制作人：**Li Yanpei Hiko**

> 用 iPhone 主摄像头，为视障人士提供「实时避障 + 步行路线导航 + 远程明眼志愿者视频协助」三合一的原生 iOS App。所有 AI 推理在设备端完成（视频通话的信令/TURN 中继、地图路线检索/导航除外）。
>
> **本文档面向「第一次做 iOS App 的新手」编写**，每个技术点都给出框架、为什么这么选、新手难度，以及可验证的成功标准。

---

## 0. 给新手的一句话总览

你要做的是一个「相机一直开着、AI 一直在本机判断前方有没有障碍、用语音和震动告诉盲人用户、走错路或 AI 看不懂时能一键叫真人志愿者视频帮忙」的 App。

技术栈一句话：**SwiftUI（界面）+ AVFoundation（相机）+ Core ML / Vision（端侧 AI）+ ARKit/LiDAR（深度测距）+ MapKit / 持牌图商 SDK（步行路线）+ 空间音频/语音/震动（反馈）+ 托管 WebRTC SDK（志愿者视频）**。

最重要的一句话（贯穿全书）：**BeeUrEi 是「感知增强的辅助工具」，不是「安全保障」，永远不能替代白手杖 / 导盲犬 / 定向行走（O&M）训练。** 这条决定了产品定位、法律免责、App Store 过审，是不可逾越的红线。

第二重要的一句话（新手最易误解）：**「端侧 AI」≠「整个 App 离线」。** 避障的 AI 推理确实 100% 在手机本机完成；但**导航和视频协助都需要联网**——尤其在中国大陆，若走合规路线接入持牌图商（高德/百度），**导航将是「持续联网」，而不是「出发取一次路线后就离线」**（详见 §3.3、§5.6）。

---

## 1. 项目愿景与定位

### 1.1 愿景

让每一位视障人士，仅靠一部 iPhone（无需购买专用硬件），就能在出行中获得**实时的环境感知增强**：知道前方有没有障碍、大致往哪走、以及在 AI 力不能及时随时叫到一个真人帮忙看一眼。隐私优先——视觉理解全部在手机本机完成，画面默认不上云做推理。

### 1.2 三大核心功能

| 功能 | 一句话说明 | 端侧/联网 |
|---|---|---|
| ① 实时避障 | 摄像头/LiDAR 连续检测前方障碍，用语音+空间音+震动提示「是什么、几点钟方向、远近」 | **纯端侧、可离线** |
| ② 步行路线导航 | 给定目的地，用空间音频「信标」引导方向，沿途播报路口/地标 | **必须联网**：联网方式取决于走哪条路线（见下方⚠️与 §3、§5.6） |
| ③ 远程视频协助 | 端侧 AI 置信度低或用户主动呼叫时，无缝切到明眼志愿者视频 | **必须联网**（信令+TURN+匹配，但不做 AI 推理） |

> **⚠️ 关于「② 导航」联网口径的关键说明（新手必读，避免被误导）：**
> 导航有两条互斥的技术路线，联网行为**完全不同**，立项时（§11 开放问题 3）必须先拍板走哪条：
> - **路线 A（非中国大陆 / MapKit 路线）**：用 Apple `MKDirections` 取路线——**出发时联网取一次路线，之后的进度判断与播报可离线**。这是「取一次就离线」的情形。
> - **路线 B（中国大陆合规 / 持牌图商 SDK 路线）**：因测绘法 + GCJ-02 坐标偏移 + 数据闭源三重障碍（见 §5.6），**很可能必须接入持牌图商（高德/百度）SDK**。这类 SDK 是**持续联网**的（路线、坐标纠偏、实时引导都走厂商云），**不是「取一次就离线」**。
>
> 一句话：**只要在中国大陆走合规路线，导航就是持续联网，不要对外宣称「导航只在出发那一次联网」。** 纯端侧/离线的硬约束**只对「避障」成立**。

### 1.3 免责定位（红线，必须反复显著告知）

> **BeeUrEi 是辅助工具，不是安全保障设备。**
> - 它**不能替代**白手杖、导盲犬或定向行走（O&M）专业训练；请始终保留并优先使用它们。
> - 它**不保证**检测出所有障碍——尤其是低矮路桩、台阶边缘、地面坑洞、玻璃门、悬空的招牌/树枝、以及移动中的车辆。
> - 摄像头避障受光线、发热、设备性能、机型影响，可能漏报或误报；老旧机型上的可靠性尚未经实测验证。
> - 请勿将本 App 作为出行的唯一依据。

这段话要出现在：首次启动引导（onboarding）、用户协议、以及每次开始避障/导航时的提醒。原因见 §7（法律 + App Store Guideline 1.4.1）。

**如何「反复告知」又不造成警报疲劳（对盲人友好的具体实现范式）**：纯新手最容易做错的是「每次都用 VoiceOver 念一长段」，盲人用户会被烦到关掉提醒。推荐范式：

1. **首次启动**：完整免责全文 + 强制「我已理解」确认（知情同意，记录时间戳）。
2. **每次开始避障/导航**：只播**一句极简提醒**，例如「避障已开启，仅作辅助，请配合盲杖」（约 2 秒），且**可在设置里关闭这句的语音播报**（但不可关闭首次的完整版）。
3. **完整版常驻可查**：设置页固定有「安全须知/免责声明」入口，任何时候可重听完整版。
4. **定期重申**：每隔 N 天（如 30 天）或重大更新后，再强制确认一次完整版。

即「简短一句（可关）+ 首次/定期完整版（不可省）+ 设置里随时可查」三层，既满足法律「反复告知」，又不造成日常使用的警报疲劳。

### 1.4 差异化定位

业内**尚无**一款「实时避障 + 步行导航 + 远程志愿者视频」三合一、且坚持纯端侧 AI（避障层）的 iOS 产品；中文区 iOS 该空白尤为明显。BeeUrEi 的核心卖点：**三合一 + 端侧避障（隐私+实时）+ iOS + 中文本土化**。对比中文区现有产品（如「轻松无障碍」每 10 秒扫一次），BeeUrEi 的**接近实时避障**是关键差异。

---

## 2. 竞品速览与启示

| 产品 | 技术路线 | 亮点 | 局限 | 对 BeeUrEi 的启示 |
|---|---|---|---|---|
| **Be My Eyes** | 志愿者视频走云端转发；AI 描述走云端 GPT-4 | 850 万+志愿者、英语 <15 秒接通、单向视频+双向语音范式、C 端永久免费靠 B2B 补贴 | 完全依赖联网；无避障/导航；**历史上图像曾在服务端保留，Winter'25 起改为「30 天后删除」**——印证托管侧媒体留存策略必须明确 | 志愿者视频应作「端侧不足时的兜底」而非主入口；商业上学「免费众包 + 后期 B2B」；**隐私上要把「服务端是否留存、留存多久」写进隐私清单（见 §7.4/§8.8）** |
| **Microsoft Seeing AI** | 轻量识别端侧、丰富描述云端 | 「频道/模式切换」信息架构对盲人极友好、蜂鸣音引导对准目标、完全免费 | 无导航/避障/志愿者 | 直接借鉴「一手势切换模式」——避障/导航/求助设计成可切换模式 |
| **Google Lookout** | 官方明确「核心体验端侧、可离线」 | Find 模式播报目标的**方向+距离**（与避障最相关）、隐私好 | 仅 Android、生成描述需联网 | 「方向+距离实时播报」是端侧避障的直接参照；印证纯端侧工程可行 |
| **Microsoft Soundscape（已开源 MIT）** | 端侧 3D 空间音频导航 + OSM POI | **96% Swift 开源代码可直接学习**、空间音频「信标」指向目的地、探索式而非指令式 | 原版无避障/视觉 AI；停服后 OSM 后端需自理；OSM 无障碍数据稀疏 | **最重要的可复用资产**——研究其 AVAudioEngine 空间音频实现，用于 BeeUrEi 导航 |
| **OKO（红绿灯识别）** | 纯端侧 Core ML（2024 Apple Design Award） | Python→Core ML、Camera API 实时帧推理、恶劣天气可用、多模态反馈 | 功能单一 | **端侧约束的最佳可行性证据与技术模板**，新手应优先研读其 Apple Developer 文章 |
| **Super Lidar / EyeGuide / Obstacle Detector** | ARKit + LiDAR，纯端侧 | 用音高/振动编码距离、厘米级测距、利用现成 LiDAR | 仅 Pro 机型有 LiDAR、缺语义（知道「有障碍」不知「是什么」） | 避障层直接用 ARKit+LiDAR+音高/振动；叠加 Core ML 补「是什么」；非 LiDAR 机型要降级 |
| **WeWALK** | 智能盲杖超声波避障 + 手机云端导航 | 解决白杖盲区（齐胸/头顶）、「时钟方位」语音范式 | 需买专用硬件、导航联网 | 借鉴「时钟方位」播报；BeeUrEi 只用手机正好规避硬件门槛 |
| **Lazarillo** | GPS + 合作场所室内定位（联网） | 免费、持续播报途经 POI/路口 | 强依赖联网与场所覆盖 | 「持续播报环境」是好补充；B2B 室内地图作远期变现参考 |
| **Envision AI** | OCR 离线、场景描述云端 GPT-4V | 一键转 Be My Eyes/Aira「AI 不行就转人」 | 眼镜硬件 699–4000+ USD | **「端侧 AI 兜底 + 一键转人工」正是 BeeUrEi 第③功能的现成范式** |
| **Aira** | 纯云端付费专业口译员 | agent 质量稳定、机构买单扩展性强 | 贵、按分钟计费有心理负担 | 志愿者宜走免费众包利于冷启动；「按分钟付费」体验应避免 |
| **轻松无障碍（中文区）** | Android/云端 | 与 BeeUrEi 形态最接近（避障+识别+志愿者）、公益众筹 | 每 10 秒扫一次（非实时）、Android、云端 | **证明中文区 iOS 端侧实时三合一存在明显空白**；在「实时性+端侧」上超越它 |
| **高德视障导航（中文区）** | 高德大数据 + 北斗（云端） | 优先盲道路线、路口红绿灯倒计时播报 | 强依赖云端 | 路口红绿灯播报值得学；其「持牌图商持续联网」模式正是中国大陆导航的现实路径（见 §5.6） |

**核心启示汇总**：
1. **交互范式**：学 Seeing AI 的「模式切换」+ Lookout 的「方向+距离」+ WeWALK 的「时钟方位」。
2. **避障编码**：学 Super Lidar 的「音高/震动编码距离」+ Soundscape 的「空间音频信标」。
3. **优雅降级**：学 Envision 的「AI 不行就一键转人工」。
4. **开源基座**：以 Soundscape 开源 Swift 工程为学习/移植基座。
5. **端侧模板**：以 OKO 的 Apple Developer 文章为端侧实现模板。
6. **隐私底线**：学 Be My Eyes「图像曾保留→改 30 天删除」的教训，**一开始就把托管侧媒体留存策略写清楚**。
7. **要避开的坑**：联网强依赖（避障层）、专用硬件门槛、低频扫描（10 秒）、按分钟收费。

---

## 3. 总体架构

### 3.1 模块图（ASCII）

```
┌──────────────────────────────────────────────────────────────────────┐
│                        BeeUrEi App（原生 Swift / SwiftUI）              │
│                                                                        │
│  ┌────────────┐   ┌──────────────────────────┐   ┌─────────────────┐  │
│  │  Capture   │   │       Perception          │   │   Navigation    │  │
│  │  相机/帧    │──▶│  端侧感知层（核心）         │   │  步行路线导航     │  │
│  │ AVCapture  │   │  ┌────────────────────┐   │   │  MapKit 或       │  │
│  │  Session   │   │  │ LiDAR 深度(首选)     │   │   │  持牌图商 SDK    │  │
│  └────────────┘   │  │ ARKit sceneDepth     │   │   │  CLLocation     │  │
│        │          │  │ + trackingState 监听 │   │   │  CMPedometer    │  │
│        │          │  └────────────────────┘   │   └────────┬────────┘  │
│        ▼          │  ┌────────────────────┐   │            │           │
│  CVPixelBuffer ──▶│  │ 无 LiDAR 降级:       │   │            │           │
│   (每帧节流       │  │ Depth Anything V2    │   │            │           │
│    10-15 FPS)     │  │ (相对深度) +YOLO11n   │   │            │           │
│                   │  └────────────────────┘   │            │           │
│                   │  输出: 障碍{类别,方向,距离} │            │           │
│                   └──────────┬───────────────┘            │           │
│                              │                            │           │
│                              ▼                            ▼           │
│                   ┌──────────────────────────────────────────────┐   │
│                   │      Feedback Coordinator（仲裁中枢）           │   │
│                   │   优先级队列: P0 避障 > P1 转向 > P2 状态        │   │
│                   │              > P3 环境描述                      │   │
│                   │  ┌─────────┐ ┌──────────┐ ┌──────────────┐    │   │
│                   │  │ 语音TTS  │ │ 空间音频  │ │ 震动 Haptics │    │   │
│                   │  │AVSpeech  │ │AVAudioEnv │ │ CoreHaptics  │    │   │
│                   │  └─────────┘ └──────────┘ └──────────────┘    │   │
│                   └──────────────────────────────────────────────┘   │
│                              ▲                                        │
│  ┌───────────────┐          │ 触发兜底                                │
│  │ RemoteAssist  │──────────┘ (置信度低/用户呼叫)                      │
│  │ 远程志愿者视频  │                                                   │
│  │ 托管WebRTC SDK │                                                   │
│  └───────┬───────┘                                                    │
│          │                                                            │
│  ┌───────┴────────────────────────────────────────────────────────┐ │
│  │ Accessibility 无障碍层（贯穿全局）: VoiceOver / Dynamic Type /    │ │
│  │ 与 VoiceOver 协调播报 / 大触控区 / 多模态                          │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
            │ (仅以下走网络，且都不做 AI 推理)
            ▼
┌──────────────────────────────────────────────────────────────────────┐
│  网络边界（不参与任何 AI 推理）                                          │
│  ┌───────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │ 托管 RTC 后端       │  │ 匹配/在线状态后端  │  │ 地图/导航服务       │  │
│  │ 信令+STUN+TURN+SFU │  │ Firebase          │  │ A: MKDirections    │  │
│  │ (Agora/Daily)      │  │ Firestore+CFns    │  │   (出发联网一次)    │  │
│  │ 媒体可能服务端留存  │  │                   │  │ B: 高德/百度 SDK   │  │
│  │ → 留存策略须声明     │  │                   │  │   (持续联网)        │  │
│  └───────────────────┘  └──────────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

> 架构图说明（两个新手易错点）：
> - **导航服务有 A/B 两种**：A（MapKit，出发联网一次）与 B（中国大陆持牌图商 SDK，**持续联网**）。立项时（§11-3）二选一，会显著改变「联网时长/电量/隐私」假设。
> - **托管 RTC 后端的媒体可能在服务端留存**：即便本端「默认不录制」，画面经过 SFU/TURN 时是否在厂商侧落盘、留存多久，必须查清并对用户声明（见 §7.4/§8.8）。

### 3.2 数据流（三条时间尺度）

- **微观避障流（毫秒~秒级，最高优先级，纯端侧）**：
  `相机帧/LiDAR → CVPixelBuffer → 深度+检测推理 → 障碍{类别,方向,距离} → Feedback 仲裁 → 语音/空间音/震动`
- **宏观导航流（秒~分钟级）**：
  - 路线 A：`目的地 → MKDirections 取路线(联网一次) → CLLocation 进度判断 → 空间音信标+路口播报`（取到路线后可离线）
  - 路线 B：`目的地 → 持牌图商 SDK(持续联网，含坐标纠偏与实时引导) → 空间音信标+路口播报`（全程联网）
- **兜底流（联网）**：
  `端侧置信度低 / 用户长按求助按钮 → 匹配后端找同语言在线志愿者 → 托管 RTC 建立单向视频+双向语音`

### 3.3 端侧推理 vs 远程协助的边界（必须对外说清楚）

| 能力 | 在哪里算 | 是否联网 | 备注 |
|---|---|---|---|
| 避障：检测「是什么」 | **端侧**（Core ML/Vision） | 否 | YOLO11n / Vision |
| 避障：测距「多远」 | **端侧**（ARKit LiDAR 或单目深度） | 否 | LiDAR 给米数；单目只给相对远近 |
| 场景理解/语音播报生成 | **端侧** | 否 | 基础播报用模板文案即可；⚠️ iOS 26 Foundation Models 端侧 LLM **需 iOS 26+ 且仅限支持 Apple Intelligence 的较新机型**，与本项目 iOS 17 最低线不符，**只能作为高端机的「可选增强」，不是普遍可用方案** |
| 步行路线**计算**（路线 A，MapKit） | **Apple 服务器** | 是（首次出发） | ⚠️ MKDirections 不是端侧算法（见下方纠偏与 §4 选型表） |
| 步行路线**计算/引导**（路线 B，持牌图商） | **厂商云服务器** | 是（**持续**） | ⚠️ 中国大陆合规路线，全程联网，非「取一次就离线」 |
| 路线**进度判断/播报**（仅路线 A） | 端侧 | 否（已取到路线后） | 路线 B 由 SDK 在线驱动 |
| 志愿者视频**连接** | 信令/TURN 服务器 | 是 | 只转发媒体流，**不做 AI 推理**；媒体留存策略须声明 |

> **⚠️ 关键澄清（来自事实核查，避免架构与宣传出错）**：
> 「端侧不依赖服务器算力」**≠**「无需任何服务器 / 完全离线」。准确口径是：
> **「所有 AI 推理（避障检测、深度、场景理解）100% 在 iPhone 端完成，画面不上云做推理；但实时志愿者通话的信令/TURN 中继、以及地图路线检索/导航会走网络——这些只做网络通信，不做任何 AI 推理。」**
> 进一步：**「纯端侧/离线」的硬约束只对「避障」成立**；导航必然联网，中国大陆合规路线下更是**持续联网**。切勿对外宣称「完全无服务器」「视频也不出设备」或「导航只在出发那一次联网」，否则与物理现实/合规现实不符、可能构成误导。

---

## 4. 模块技术选型

| 模块 | 用什么框架 · 模型 | 为什么 | 新手难度 |
|---|---|---|---|
| **界面** | SwiftUI（iOS 17+ 最低部署目标） | Apple 主推、声明式、代码少、最适合第一次做 App；iOS 17 拿到 `@Observable` 现代特性 | ★★☆☆☆ |
| **架构** | SwiftUI 原生 MVVM：`@Observable` + `@State` | 取代旧 `ObservableObject/@Published`，属性级精确刷新、性能好 | ★★☆☆☆ |
| **相机取帧** | AVFoundation：`AVCaptureSession` + `AVCaptureVideoDataOutput` → `CVPixelBuffer` | 底层、可控、能拿到每帧喂给 AI；预览层用 `UIViewRepresentable` 桥接进 SwiftUI | ★★★☆☆ |
| **目标检测（是什么）** | **YOLO11n**（或 YOLOv8n）转 Core ML，用 Vision `VNCoreMLRequest` 跑 | ANE 上可 60-85 FPS；nano 变体省电控温。⚠️ **若自训精简类别（只留行人/车/少数障碍），会漏检未训练的障碍物（如路桩、台阶、消火栓），这是直接安全后果**——精简前必须采集真实街景数据，对比精简模型 vs 通用模型的漏检率做安全验证（见 §5.8） | ★★★★☆ |
| **深度（多远）首选** | **ARKit** Scene Reconstruction + `smoothedSceneDepth`（LiDAR） | 每像素**真实米数** + confidence map，有效 ~5m，避障最可靠。⚠️ 必须监听 `ARCamera.trackingState`，跟踪丢失/受限时降级（见 §5.2） | ★★★★☆ |
| **深度降级（无 LiDAR）** | **Depth Anything V2 small**（Apple 官方 Core ML，FP16 49.8MB，~30ms/帧） | 端侧实时、Apple 官方有 Swift 示例。⚠️ 官方 FPS 仅测到 iPhone 12 Pro Max，**iPhone 11/SE/A13-A14 等老机型无任何官方数据，实测空白**（见 §5.4/§5.7） | ★★★★☆ |
| **零模型补充信号** | Apple Vision 内置请求（人体框/姿态/显著性/运动轨迹） | 免训练免转换、毫秒级、跑在 ANE，可做「有人在前方/车在逼近」 | ★★☆☆☆ |
| **盲道/路面分割（v2）** | DeepLabV3+ / GRFB-UNet 转 Core ML | 需自采本地盲道数据微调，列为进阶 | ★★★★★ |
| **步行路线（路线 A，海外）** | MapKit `MKDirections(.walking)` → `MKRoute.steps` | 门槛最低，SwiftUI 有 `Map`+`MapPolyline` 直接渲染。⚠️ **路线计算在 Apple 服务器端、非端侧、首次出发必须联网**（这是新手速查最易忽略的边界，详见 §3.3、§5.6） | ★★☆☆☆ |
| **步行路线（路线 B，中国大陆）** | 高德 / 百度地图 iOS SDK（持牌图商） | 中国大陆合规导航的现实路径，自带 GCJ-02 纠偏与盲道路由。⚠️ **持续联网**，非端侧、非离线 | ★★★★☆ |
| **定位/航向** | CoreLocation `CLLocationManager` + `CLHeading`；`CMPedometer`（PDR 兜底） | 标准定位 + 失锁时步数推算桥接 | ★★★☆☆ |
| **空间音频（导航信标）** | `AVAudioEnvironmentNode` + HRTF（mono 声源） | 比 PHASE 上手快、资料多；3D 把方向「挂」在目标方位 | ★★★★☆ |
| **语音播报** | `AVSpeechSynthesizer` + `AVSpeechUtterance` | 端侧 TTS，可调语速；与 VoiceOver 协调用 `UIAccessibility.post(.announcement)` | ★★☆☆☆ |
| **震动反馈** | Core Haptics `CHHapticEngine`（intensity/sharpness） | 嘈杂环境语音失效时的冗余通道，「一种含义=一种震动」 | ★★★☆☆ |
| **远程视频** | 托管 RTC SDK：**Agora** 或 **Daily**（月免 10000 分钟） | SFU/TURN/信令全托管，1-3 周到 MVP，无需自建服务器 | ★★★★☆ |
| **来电唤醒** | PushKit（VoIP push）+ CallKit | 志愿者 App 在后台被唤醒、弹系统级来电；iOS 强制收到后立即 `reportNewIncomingCall` | ★★★★★ |
| **匹配后端** | Firebase Firestore + Cloud Functions（serverless，零 AI） | 存在线状态/语言/时区、做随机广播匹配、签发 RTC token，新手无需运维 | ★★★☆☆ |
| **依赖管理** | Swift Package Manager（Xcode 内置） | 官方、内置、无需学 CocoaPods | ★☆☆☆☆ |
| **进阶端侧能力（可选）** | Speech `SFSpeechRecognizer`（`requiresOnDeviceRecognition=true`） | 端侧语音指令，满足端侧约束 | ★★★★☆ |

> 难度说明：★=半天能懂，★★★★★=需要专门研究+真机反复实测。
>
> **关于「超老机型兜底」（修正之前的不准确）**：早期版本曾提议用 MobileNet-SSD 把 iPhone 7 当兜底机型。**已删除该兜底**，原因：① iPhone 7 最高仅支持 iOS 15，与本项目 **iOS 17 最低部署目标自相矛盾**；② iPhone 7 这类 A10 设备几乎不可能满足 Phase 1「检测+深度双模型并发 20 分钟不过热」的成功标准。**最低机型不应低于能稳定跑 iOS 17 的设备**，具体最低机型须在 Phase 0 由真机实测确定（见 §5.4、§11-1）。

---

## 5. 关键技术难点、风险与缓解

> 本节是整个项目的「安全脊柱」。每一条都来自事实核查确认的真实物理/工程限制，**不能靠算法完全消除**，只能靠产品设计与告知缓解。

### 5.1 避障的安全边界（最高优先级风险）

- **难点**：漏检（false negative）是最严重后果——检测器会漏掉低矮路桩、台阶边缘、坑洞、玻璃/反光门、悬空招牌/树枝（地面深度图也难发现）、移动车辆。文献明确指出很多避障 App 不考虑步速，**可能在用户已经撞上后才报警**。
- **缓解**：
  1. 产品定位为「感知增强」而非「安全保障」，反复显著告知局限（见 §1.3、§7）。
  2. 设保守的安全边距；对接近物用**多帧时间确认**降低误报。
  3. 误检（false positive）频繁会造成「警报疲劳」让用户忽视真警报——用置信度阈值 + LiDAR confidence map 过滤低置信像素平衡。
  4. 端到端延迟（拍帧→推理→决策→语音）必须在目标机型上**实测并满足可量化阈值**（见 §5.6-延迟量化）。

### 5.2 单目 vs LiDAR 深度 + ARKit 跟踪可靠性（结构性下限，必须分级承诺）

- **难点 1（事实核查上升为安全级警示）**：单张单目 RGB 图像**在数学上无法恢复绝对米制尺度**（scale ambiguity，ill-posed）。Depth Anything V2 只给**相对深度**（远近排序），给不出可信的「还有几米撞上」。LiDAR 仅 iPhone Pro 机型有（12 Pro 起）。
  - 关于「Pro 机型市占率」：曾有「约三分之一量级」的说法——**这是粗略估计、无确切数据来源**，仅供感受量级，不可作为正式依据。准确的可用机型范围应以「支持 iOS 17 且带 LiDAR 的 Pro 线」来界定，具体覆盖率以立项时的真实统计为准。
- **难点 2（ARKit/LiDAR 自身的可靠性盲点，之前遗漏）**：ARKit 世界跟踪在**快速移动、特征稀疏（如空白墙面）、剧烈晃动**时会**丢失或漂移**，直接影响 `sceneDepth` 的稳定性——这意味着「有 LiDAR 就一定可靠」是错的。**必须监听 `ARCamera.trackingState`**：
  - `.normal` → 正常测距级避障；
  - `.limited(reason:)`（如 `.excessiveMotion`/`.insufficientFeatures`/`.initializing`）→ 降级为相对预警，并语音提示「跟踪不稳，请放慢/减少晃动」；
  - `.notAvailable` → 暂停测距承诺，回退到纯检测或提示用户。
- **缓解（分层避障架构，核心建议）**：
  - **带 LiDAR 的 Pro 机型**：ARKit `smoothedSceneDepth`（每像素米数 + confidence）做**测距级**避障，**叠加 trackingState 门控**。
  - **无 LiDAR 机型**：Depth Anything V2（相对深度）+ YOLO11n，只做**相对远近预警级**避障，安全边界明显更低。
  - 运行时用 `ARWorldTrackingConfiguration.supportsSceneReconstruction` / `ARFrame.sceneDepth` 是否可用自动选路，并叠加 `trackingState` 实时降级。
  - **切勿一刀切宣称「全机型实时避障」**——必须据机型与跟踪状态分级调整安全话术。

### 5.3 定位漂移（导航维度最高安全风险）

- **难点**：城市峡谷（高楼/树荫）GPS 水平误差实测 7-18m、偶发近 100m；GPS 失锁回退 WiFi/基站时 `horizontalAccuracy` 跳到 65m+；视障者步速慢（<2-2.5km/h）更易 drift；`CLHeading` 磁力计受金属/电子设备干扰可瞬时偏差数十度。叠加起来足以把人引向车流。
- **缓解**：
  1. 把 `horizontalAccuracy` 当**一等公民做硬门控**：精度好（<10m）才下精确转向；精度差（>20m）降级为宽容的空间音信标 + 路口/地标语音让用户**自我校准**。
  2. **绝不在低精度下播「现在过马路 / 现在转向」**这类高确定性指令。
  3. 航向做平滑滤波 + 与 GPS course 交叉校验，检测磁干扰（`headingAccuracy` 差）时改粗粒度提示。
  4. GPS 失锁用 `CMPedometer`/CoreMotion 做短时 PDR 桥接（误差累积，不能当长期替代），拿到可信 GPS 立即纠正。

### 5.4 发热与掉电 + 老机型实测空白（可行性而非优化问题）

- **难点**：连续摄像头 + ANE 推理能耗高，过热触发 CPU/GPU 降频→FPS 抖动甚至卡顿（对行走中的盲人是直接危险），长时间还会耗尽电量中途关机。**事实核查补充**：BeeUrEi 要「检测+深度」**两个模型同时连续跑**，而所有官方/社区 FPS 数字几乎都是**单模型、且多在 iPhone 12 Pro Max 高端机测得**——双模型并发会进一步抬高发热、压低实际帧率。
- **难点（明确登记的待验证风险）**：**iPhone 11 / SE / A13-A14 等非 Pro/老机型上 Depth Anything 等深度模型的实测 FPS 完全空白**——官方只测到 12 Pro Max。这意味着「全机型避障」承诺的**最大不确定性来源就是「老机型上到底跑不跑得动、过不过热完全未知」**。这必须作为单列风险登记（见 §5.7），并进入 Phase 1 成功标准。
- **缓解**：
  1. 推理**帧节流到 10-15 FPS**，放独立串行队列，`alwaysDiscardsLateVideoFrames=true`。
  2. 监听 `ProcessInfo.thermalStateDidChangeNotification` **分级降级**：fair→降帧率；serious→降分辨率/换 nano 模型；critical→**停摄像头并语音告知「设备过热，避障暂停」**，并衔接到呼叫志愿者兜底。
  3. 低电量同样降级。
  4. **上线前必须在「目标机型矩阵（含至少一台无 LiDAR 的老机型）」上实测「双模型并发 + 长时间步行」的帧率、端到端延迟与温控关机表现**，这是可行性验证，不能跳过；老机型若实测不达标，则该机型不进入「支持避障」清单（诚实分级，而非硬宣称全机型）。

### 5.5 误检/漏检的通道层缓解

- 三通道反馈做**优先级仲裁**（见 §3.1）：避障 P0 可打断导航语音；用 `stopSpeaking(.immediate)` 抢占。统一 3D 声场表达，障碍与路线用不同音色但同一坐标系，避免「前方右转」和「左前障碍」互相淹没。
- 夜间/逆光/强日光下 RGB 检测器精度骤降、LiDAR 强日光下也降、单目夜间几乎失效——检测光照条件并主动告警「当前光线下避障可靠性降低」，必要时引导开手电或转志愿者。

### 5.6 中国大陆地图/合规三重障碍 + 导航联网后果（重大可行性风险，立项即决策）

- **难点（事实核查比原描述更严峻）**：
  1. **测绘法**：自 2002 年起私自测绘在中国大陆即违法，OSM 官方声明在华众包测绘存在合规风险，已有涉外非法测绘起诉先例。
  2. **数据**：高德盲道数据商业闭源；OSM 在华覆盖稀疏。
  3. **坐标系**：法定 GCJ-02 对原始 WGS-84 GPS 坐标强制施加 100-700m 偏移，iPhone 原始 GPS 叠到任何中国合规地图都会错位百米，必须做坐标纠偏。
- **直接后果（务必让新手明白）**：上述三重障碍意味着中国大陆**很可能必须接入持牌图商（高德/百度）SDK**，而**这类 SDK 是「持续联网」的——路线、坐标纠偏、实时引导都走厂商云**。因此**中国合规路线下，导航不是「出发取一次就离线」，而是全程联网**。功能表（§1.2）、架构图（§3.1）、边界表（§3.3）均已据此反映。
- **缓解/决策建议**：
  1. 对「导航」放宽端侧/离线约束、接入持牌图商，把纯端侧硬约束**只保留给「避障」**（立项拍板，见 §11-3）。
  2. **OSM 无障碍数据稀疏的降级路径**（之前遗漏，现纳入 Phase 2）：OSM 的人行道 / `tactile_paving`（盲道）等无障碍标签**严重不全，不能假设普遍可用**。**不能默认「视障友好路由」一定可达**。降级策略：当无障碍数据缺失 → **降级到普通步行路线（MapKit 或持牌图商）+ 摄像头避障兜底**，并语音告知用户「本段无盲道数据，已切换为普通步行+实时避障」。

- **端到端延迟的可量化阈值（之前缺失，现补齐，用于判定 Phase 1 成功）**：
  - **参照线索**：微观避障端侧总链路约 0.4–1.3s；正常步速约 1.0–1.4 m/s（视障者偏慢，<0.7 m/s 也常见）。
  - **可测目标**：避障端到端延迟（拍帧→推理→决策→开始播报/震动）**目标 ≤ 0.8s、上限 ≤ 1.3s**；据步速换算，应保证在用户**到达障碍前至少留出 ~2m / 约 1.5–2s 的反应+减速距离**（即「最小提前距离」）。达不到则不算 Phase 1 通过。
  - **怎么测（手把手）**：在代码里给每帧打时间戳——`captureOutput` 收到帧记 t0，推理出结果记 t1，调用 TTS/Haptics 那一刻记 t2；统计 `t2 - t0` 的 p50/p95；或用「相机对准秒表 → 听到播报瞬间再看秒表读数差」的土办法做端到端校验。在**最低目标机型**上测，不在 12 Pro Max 上测。

### 5.7 风险登记表（汇总）

| 风险 | 严重度 | 概率 | 缓解 |
|---|---|---|---|
| 避障漏检导致用户受伤 | 致命 | 中 | 定位为辅助、反复告知、保守边距、多帧确认、知情同意 |
| **裁剪类别漏掉未训练障碍物（路桩/台阶等）** | 致命 | 中 | 精简前采街景数据做漏检率安全验证；高风险类别（台阶/路桩/玻璃门）务必纳入训练或用通用模型兜底（见 §5.8） |
| 非 Pro 机型测距不可靠 | 高 | 高 | 分层架构 + 分级话术，不一刀切宣称全机型 |
| **ARKit 跟踪丢失/漂移（Pro 机型亦然）** | 高 | 中 | 监听 `trackingState`，limited/notAvailable 时降级并提示 |
| **老机型（无 LiDAR/A13-A14）深度模型实测数据空白、可行性未知** | 高（可行性） | 高 | Phase 0/1 真机实测；不达标则该机型不进「支持避障」清单 |
| GPS 漂移引向车流 | 致命 | 中 | `horizontalAccuracy` 硬门控，低精度禁高确定性指令 |
| 双模型并发发热降频/关机 | 高 | 高 | 帧节流 + thermalState 降级 + 目标机型矩阵实测 |
| 中国地图合规/坐标系 + 导航被迫持续联网 | 高（可行性） | 高 | 导航放宽端侧约束、接持牌图商（持续联网）、坐标纠偏 |
| **OSM 无障碍数据稀疏致视障路由不可达** | 中 | 高 | 降级到普通步行路线 + 摄像头避障兜底，并语音告知 |
| 志愿者冷启动无人接听 | 高（产品） | 高 | 端侧 AI 兜底 + 亲友名单 + 小社群（见 §8） |
| **托管 RTC 侧媒体留存（即便本端不录制）** | 中（隐私） | 中 | 查清厂商留存策略/留存期/是否过服务器，写进隐私清单并对用户声明（见 §7.4/§8.8） |
| 第三方供应商可信度（如 Twilio 承诺反复横跳） | 中 | 中 | 选 SDK 评估供应商可信度而非具体 EOL 日期；LiveKit 开源可自托管作退出策略 |
| **成本超额（视频 track 单价高 + TURN 带宽费）** | 中（产品） | 中 | 按视频单价而非音频外推预算；监控 TURN/GB 费用；超额前预警（见 §8.6） |

### 5.8 端侧语义识别的类别覆盖局限（安全相关，单列提醒）

- **难点**：Apple Vision **没有**通用 COCO 80 类的现成障碍检测器；若用 YOLO11n 自训**精简类别**模型（只留行人/车/少数类），**会漏掉未训练的障碍物**——而恰恰是路桩、台阶、消火栓、矮护栏、玻璃门这类「精简时容易被裁掉」的东西对盲人最危险。精简模型 vs 通用模型在真实街景的漏检率差异**属于必须用数据验证的开放问题，不能拍脑袋裁类别**。
- **缓解**：
  1. 列出「**绝不能漏的高危类别清单**」（台阶/路桩/玻璃门/低矮障碍/逼近车辆…），这些必须在训练集中有充分样本，或用通用模型兜底。
  2. 精简前后都在**自采真实街景测试集**上量化漏检率，把高危类别的召回率作为放行门槛。
  3. 深度通道（LiDAR/单目相对深度）作为「不认识但很近」的兜底信号——即使分类器没认出来，只要深度说「前方很近有东西」也要预警。

---

## 6. 分阶段路线图

> 原则：**先把最危险、最核心的「实时避障」做稳**，再逐步加导航、加志愿者、再打磨上架。每阶段都有「可验证的成功标准」——达不到不进下一阶段。

### Phase 0：准备（约 1-2 周）

| 项 | 内容 |
|---|---|
| **目标** | 装好工具链、跑通真机相机、建立工程骨架、想清楚机型/约束边界 |
| **交付物** | 能在真机看到后置摄像头实时画面的空壳 App；按 §3.1 模块分好文件夹；写下机型/iOS 最低版本决策（含「目标机型矩阵」，至少一台 Pro + 一台无 LiDAR 老机型）；写下导航走路线 A 还是 B |
| **要学的知识** | Xcode 安装与 Free Provisioning、SwiftUI 基础、`Info.plist` 权限、`UIViewRepresentable` 桥接相机预览、相机授权流程 |
| **难度** | ★★☆☆☆ |
| **成功标准** | ✅ 真机（最好带 LiDAR 的 Pro）上能稳定显示实时摄像头画面，不崩溃；✅ App 启动弹出相机权限文案，且用户拒绝后有引导（见 §9 第 1 周）；✅ 写下了机型矩阵与导航路线决策 |

### Phase 1：MVP — 实时避障（约 4-6 周，最关键）

| 项 | 内容 |
|---|---|
| **目标** | 端侧检测前方障碍并用「语音 + 空间音 + 震动」实时提示「是什么 + 几点钟方向 + 远近」 |
| **交付物** | ① 检测：YOLO11n Core ML 跑通（含高危类别覆盖核查）；② 深度：LiDAR 机型用 ARKit `smoothedSceneDepth` + `trackingState` 门控，无 LiDAR 用 Depth Anything V2；③ FeedbackCoordinator 优先级仲裁；④ thermalState 降级；⑤ 免责 onboarding（含 §1.3 的「简短一句+可查完整版」范式） |
| **要学的知识** | Core ML/Vision、ARKit sceneDepth 与 trackingState、AVAudioEnvironmentNode 空间音频、Core Haptics、AVSpeechSynthesizer、与 VoiceOver 协调、帧节流与后台队列、thermalState、延迟测量 |
| **难度** | ★★★★★ |
| **成功标准** | ✅ 在**目标机型矩阵的每一台**（含至少一台无 LiDAR 老机型）上「检测+深度双模型并发 + 连续步行 20 分钟」无温控关机、FPS 稳定 ≥10——**达不到的机型不列入「支持避障」清单**；✅ 端到端延迟实测 **p95 ≤ 1.3s（目标 ≤ 0.8s）**，按步速换算留出 ≥~2m 提前距离（测法见 §5.6）；✅「几点钟方向」按 §9 的定义算出且闭眼/盲用户能听出方向与远近；✅ LiDAR 机型给米数、非 LiDAR 机型给相对远近且话术分级；✅ ARKit `trackingState` limited/notAvailable 时能降级并提示；✅ 全程 VoiceOver 可操作 |

### Phase 2：步行路线导航（约 3-5 周）

| 项 | 内容 |
|---|---|
| **目标** | 给定目的地，用空间音频信标引导方向，沿途播报路口/地标；与避障**分层仲裁**（避障永远优先） |
| **交付物** | ① 路线 A：MapKit `MKDirections(.walking)` 取路线 / 路线 B：持牌图商 SDK（按 §11-3 决策选其一）；② `AVAudioEnvironmentNode` 空间音信标指向目的地；③ `CLLocationManager` 进度判断 + `horizontalAccuracy` 硬门控；④ 航向平滑 + 磁干扰降级；⑤ PDR 兜底；⑥ 路口/地标语音 callout；⑦ **无障碍数据缺失时的降级策略**（OSM 盲道/人行道数据不全 → 降级普通步行路线 + 摄像头避障兜底 + 语音告知，见 §5.6） |
| **要学的知识** | MapKit/MKDirections 或持牌图商 SDK、CoreLocation/CLHeading、PDR（CMPedometer）、空间音频信标范式（研读 Soundscape 开源代码）、声音通道仲裁、GCJ-02 坐标纠偏（路线 B） |
| **难度** | ★★★★☆ |
| **成功标准** | ✅ 能用空间音「听出」目的地方向，靠近音量增大；✅ 精度差时自动降级、**绝不播「现在过马路」**；✅ 避障语音能打断导航语音、不互相淹没；✅ 在城市峡谷实测漂移时不下达危险指令；✅ **无障碍数据缺失时能正确降级到普通步行+避障兜底并告知用户** |

### Phase 3：远程视频协助（约 3-5 周）

| 项 | 内容 |
|---|---|
| **目标** | 端侧置信度低或用户长按求助时，无缝切到明眼志愿者「单向视频+双向语音」 |
| **交付物** | ① 托管 RTC SDK（Agora/Daily）集成；② PushKit + CallKit 后台来电（志愿者侧）；③ Firebase 匹配后端（同语言/时区随机广播、签发 token）；④ 单 App 双角色 onboarding 分流；⑤ 举报/屏蔽/准入；⑥ 默认不录制 + **查清并声明厂商侧媒体留存策略**（见 §8.8） |
| **要学的知识** | WebRTC 概念与边界、托管 SDK 集成、PushKit/CallKit 合规（收到 push 必须立即 `reportNewIncomingCall`）、Firebase Firestore + Cloud Functions、AVAudioSession |
| **难度** | ★★★★★ |
| **成功标准** | ✅ 求助者一键发起、志愿者后台被唤醒弹系统来电并接通；✅ 受限网络下走 TURN 也能连通；✅ 求助者侧 100% VoiceOver 友好、大按钮、一键呼叫；✅ 通话后可举报+屏蔽；✅ 弱网下画质/音频自适应；✅ 隐私清单已写明「服务端是否留存媒体、留存多久」 |

### Phase 4：打磨 / 真实用户测试 / 上架（约 4-8 周）

| 项 | 内容 |
|---|---|
| **目标** | 真实视障用户测试、合规收口、上架 |
| **交付物** | ① 加入 Apple Developer Program；② Privacy Manifest（`PrivacyInfo.xcprivacy`）；③ 权限文案终稿；④ 法律免责终稿 + 知情同意；⑤ TestFlight 招募 6-12 名真实视障用户在真实街道走查；⑥ App Store 无障碍「营养标签」如实声明 VoiceOver；⑦ 性能/发热/电量最终实测；⑧ 「支持避障的机型清单」最终定稿 |
| **要学的知识** | Privacy Manifest、App Store Guideline 1.4.1、TestFlight、VoiceOver evaluation criteria、参与式设计 |
| **难度** | ★★★★☆ |
| **成功标准** | ✅ 真实视障用户能仅靠 VoiceOver+音频+震动独立完成「开避障→设目的地→求助」全流程；✅ 满足 VoiceOver evaluation criteria；✅ 过审（无绝对化安全承诺、Privacy Manifest 完整、权限文案清晰）；✅ 与盲协/O&M 机构沟通安全定位 |

---

## 7. 无障碍与合规红线

> 对盲人 App，无障碍**不是加分项，是产品的全部**——界面若不能被 VoiceOver 完全操作、不能纯听觉+触觉使用，目标用户根本无法上手。

### 7.1 VoiceOver（App Store 官方可声明能力，有硬性评测标准）

- 仅靠 VoiceOver 就能完成所有常见任务、无需明眼人协助。
- 所有控件有简洁准确 label（脱离上下文也能懂，禁止「点这里/了解更多」）；播报类型与状态（用 `accessibilityTraits`）；装饰图片 `accessibilityHidden(true)`；导航不卡死/不跳项/不循环；复杂手势做成 custom actions。
- SwiftUI 核心修饰符：`.accessibilityLabel/.accessibilityHint/.accessibilityValue/.accessibilityAddTraits/.accessibilityHidden/.accessibilityElement(children:.combine)/.accessibilityAction`。
- **数值红线**：正文对比度 ≥4.5:1、大字 ≥3:1；点按目标 ≥44×44pt；全面支持 Dynamic Type 到 AX 大字级不截断；不能仅用颜色传达信息（低视力用户也是目标人群）。

### 7.2 多模态反馈分工与优先级（导航类盲人 App 成败关键）

| 通道 | 承载什么 | 框架 |
|---|---|---|
| 语音 TTS | 语义信息（路线指引、障碍描述、菜单朗读） | `AVSpeechSynthesizer` |
| 空间音频/提示音 | 方向 + 紧急度（立体声/空间音指示左右，短促音=高优先级） | `AVAudioEnvironmentNode` |
| 震动 Haptics | 即时贴身物理提示（临近障碍、确认操作），「一种含义=一种震动」 | Core Haptics |

**优先级层级**：P0 安全/避障（打断一切，`stopSpeaking(.immediate)`）> P1 转向指令 > P2 状态/确认 > P3 环境描述。用一个统一的 `FeedbackCoordinator` 单例管理，防止三通道互相打断或信息过载。设正确的 `AVAudioSession`（如 `.playback + .duckOthers` 或 `.mixWithOthers`），检测 `UIAccessibility.isVoiceOverRunning` 与 VoiceOver 协调，一次性事件播报用 `UIAccessibility.post(.announcement)` 交给 VoiceOver、避免抢话。

**「几点钟方向」如何定义与计算（之前模糊，现写具体）**：
- **统一定义为：相对「手机背面摄像头朝向」的水平角**（不是用户身体/头部朝向）。理由：盲人通常会把手机朝向行进方向举着扫描，摄像头视野就是「前方」，这样无需额外的头部追踪，最简单可落地。12 点 = 正前方（画面中央），3 点 = 正右，9 点 = 正左。
- **计算方法（用相机视野内的水平角，不用 CLHeading）**：检测框中心的归一化横坐标 `x∈[0,1]`（0=最左，0.5=中央，1=最右）。设相机水平视场角 `HFOV`（后置广角约 60–70°，可从 `AVCaptureDevice` 的 `activeFormat` 读 `videoFieldOfView`）。则相对正前方的水平角 `θ = (x - 0.5) * HFOV`（正为右偏）。
- **再把角度映射到时钟点**：在 ±(HFOV/2) 范围内通常只覆盖约 10–2 点这一前方扇区，可量化为「11 点 / 12 点 / 1 点」等档位；超出视野的（如正左/正右/后方）摄像头看不到，本就不应承诺。
- **何时才需要 CLHeading**：只有「导航信标指向地理目的地」（§5.3）才用 `CLHeading`（设备相对地磁北）；**避障的「几点钟方向」纯用相机视野内的横向位置算，二者不要混淆**。

### 7.3 法律免责（红线）

- 行业共识：导航 App 与智能手杖**都不能替代白手杖与 O&M 训练**，只是「互补层」；白手杖与 O&M 仍是安全出行的 standard of care。
- App Store **Guideline 1.4.1（Safety - Physical Harm）** 会以更高标准审查可能致身体伤害的 App——**避免任何绝对化安全承诺**（如「保证检测所有障碍」），在描述与 App 内明确局限，保留清晰显著的免责声明 + 知情同意。
- 误导致伤在多法域可能触发产品责任/过失侵权；免责声明不能完全免责，但「清晰、显著、反复告知局限」是必要尽职动作。免责告知的具体落地范式见 §1.3（简短一句 + 可查完整版 + 定期重申）。

### 7.4 隐私合规

- **权限文案（`Info.plist` purpose string）**必须具体清晰（系统弹窗原样展示）：
  - `NSCameraUsageDescription`：「用于通过摄像头实时识别前方障碍并向你语音提示，以及在你呼叫志愿者时传输画面」
  - `NSLocationWhenInUseUsageDescription`：「用于规划步行路线并播报你途经的路口与地标」（优先 WhenInUse，不要 Always）
  - `NSMicrophoneUsageDescription`：「用于与远程志愿者实时语音交流」
- **Privacy Manifest（`PrivacyInfo.xcprivacy`）**：2024-05-01 起强制（用 Required Reason API 未声明则不予接受），2025-02-12 起第三方 SDK 也须随附其 manifest。如实声明数据类型、Required Reason API 理由、访问域名。即便 AI 全端侧，仍需声明定位/相机帧/音视频的处理与是否离开设备。
- **数据最小化与媒体留存（之前遗漏，现单列为隐私清单项）**：
  - 远程视频会拍到无关路人（bystander），GDPR 下无法取得有效同意——**本端默认不录制**（用完即弃）。
  - ⚠️ **「本端不录制」≠「服务端不留存」**：实时画面/截图会经过托管 RTC SDK 的 SFU/TURN，**必须查清并声明：媒体是否经服务器、服务端是否落盘留存、留存多久**（参照 Be My Eyes「图像曾保留→Winter'25 改 30 天后删除」的教训）。在隐私政策与 App 内如实告知，并向志愿者明确禁止录屏转发；尽可能选支持端到端加密的方案。
  - 若确需录制（如举报取证），必须显著告知 + 明确同意，并设最短留存期与到期自动删除。

### 7.5 真实用户测试（"Nothing about us without us"）

- 必须真正邀请视障用户全程参与设计与测试——sighted 开发者极易做出「看起来无障碍、实际不可用」的产品。
- 用 TestFlight 招募 6-12 名真实视障 beta 用户（盲协、O&M 训练师、AppleVis 社区），开着 VoiceOver 在真实街道走查。开发者自己全程开 VoiceOver+关屏自测，但**不能替代真实用户测试**。

### 7.6 发行地区合规差异（开放问题）

EU（GDPR + 2025-06-28 生效的 European Accessibility Act，WCAG AA 成法律要求）、US（ADA/Section 508）、中国（信息无障碍国标 GB/T 37668 等 + 测绘合规）要求不同，需按目标地区收口。

---

## 8. 远程视频协助方案

### 8.1 双角色（单 App）

进入即用无障碍友好的**角色选择 onboarding** 分流到两套导航栈：
- **求助者（视障）**：100% VoiceOver 适配、大触控区、最少步骤、一键（或长按）呼叫。
- **志愿者（明眼）**：常规视觉 UI。
保留后续切换入口，但避免每步都重选角色。

### 8.2 通话范式

沿用 Be My Eyes 的**「单向视频（求助者摄像头→志愿者）+ 双向语音」**：志愿者不开摄像头，降低带宽、续航与志愿者隐私风险。用 SDK 的 broadcaster/audience（发流/收流）角色配置实现。

### 8.3 匹配机制

学 Be My Eyes：求助发起时把通知**同时推送给多名「说同一语言、当地处于白天时段」的在线志愿者**，谁先接谁服务。用 Firebase Firestore 存在线状态/语言/时区/角色，Cloud Functions 做随机广播匹配并签发 RTC token（零 AI、零服务器运维）。

### 8.4 信令 / STUN / TURN（边界讲清）

- WebRTC 视频通话必需：信令（交换 SDP/ICE）+ STUN（发现公网地址）+ TURN（直连失败时中继媒体流）。
- **约 15%（受限/移动网络可达 30-40%）的连接无法直连、必须经 TURN 中继**——几乎没有生产级 WebRTC 能省掉 TURN。
- 这些组件**只做网络穿透与媒体转发，不做任何 AI 推理**，与「所有 AI 推理端侧」不矛盾。
- ⚠️ **TURN 中继会产生带宽费**（如 LiveKit 约 $0.12/GB），视频走中继时这部分成本不可忽略（见 §8.6 成本）。

### 8.5 志愿者来电唤醒（iOS 必备且有硬性合规）

志愿者 App 通常在后台，需用 **PushKit（VoIP push）** 唤醒 + **CallKit** 弹系统级来电。iOS 13+ **强制**：收到 VoIP push 后必须立即调用 `reportNewIncomingCall`，否则系统终止 App 并停止再向其投递推送。这是 MVP 不可省、新手最易踩坑的一环。

### 8.6 推荐托管方案与成本量级

| SDK | 免费额度 | 超额单价 | 备注 |
|---|---|---|---|
| **Agora（推荐）** | 月免 10,000 分钟 | 音频 ~$0.004/track-min，**视频 $0.0066-0.024/track-min（显著高于音频）** | 全球网络、iOS 文档/一对多教程齐全 |
| **Daily（推荐）** | 月免 10,000 participant-min | ~$0.004/分钟起（视频更高） | DX 口碑好 |
| 100ms | 月免 10,000 分钟 | — | 含预制 UI |
| LiveKit Cloud（备选） | 约 5,000 分钟（超额硬失败） | 连接 $0.0005/min 起，**+ TURN 中继约 $0.12/GB 带宽费** | 开源、未来可自托管迁移作退出策略 |

- **关于 Twilio Video（口径修正，统一为「供应商可信度低」）**：早期判断「已停服/剩余生命周期短」**已被推翻**——Twilio Video 并未停服，EOL 一度定 2024-12、又延至 2026-12，且官方公开宣布「继续作为独立产品投入（back from the dead）」；截至 2026-06，原 2026-12 的 EOL 承诺也已被撤回/改为继续投入。因此**不优先选 Twilio 的真正理由不是「生命周期短」，而是「供应商对该产品的承诺反复横跳、长期可信度低」**——对一个要长期运营的公益项目，这种不确定性本身就是风险。
- **成本量级感（修正：不能只按音频 $0.004 线性外推）**：
  - 1 对 1 协助一次约 5 分钟、双方各计费 ≈ 10 participant-min；若**纯音频**，10,000 免费分钟 ≈ 约 1,000 次免费通话/月。
  - ⚠️ **但本项目是「单向视频 + 双向语音」，求助者那一路是视频流**，视频 track 单价（$0.0066-0.024）是音频（$0.004）的 **1.7–6 倍**；若大量呼叫走视频并超出免费额度，**实际成本会显著高于按 $0.004 线性外推的估算**。
  - ⚠️ 还要叠加 **TURN 中继带宽费**（约 15% 连接必走中继，视频流按 GB 计费，如 $0.12/GB）。
  - **给新手的预算建议**：做预算时**按视频单价**（取区间上沿更稳妥）估算，并单列 TURN 带宽费；在控制台设**用量告警/硬上限**，超额前预警，避免账单失控。
- 公益项目可直接联系 SDK 厂商商务申请**非营利/无障碍折扣**。

### 8.7 冷启动策略

新 App 没有 Be My Eyes 的千万志愿者池，难达 15 秒接通。早期靠：**端侧 AI 兜底 + 亲友绑定名单 + 小规模志愿者社群**；避免「求助无人接听」摧毁信任。

### 8.8 隐私安全清单（MVP 必备）

志愿者基础准入（邮箱/实名/年龄声明）；通话后一键举报+屏蔽；社区准则与服务条款；传输与存储加密；**本端默认不录制**（保留举报取证机制）；**查清并声明托管 RTC 厂商侧的媒体留存策略（是否经服务器、是否落盘、留存多久），写入隐私政策**（见 §7.4）；求助界面提醒勿暴露证件/银行卡/住址。

---

## 9. 新手起步：前两周的具体步骤

> 目标：两周内从零到「相机实时画面 + 一个 Core ML 检测 + 语音播报 + VoiceOver 试听」。**模拟器没有摄像头**，所有相机/AI/LiDAR 只能真机验证——第一天就准备好真机和数据线。
>
> 一个贯穿提醒：Apple 官方示例工程「Recognizing Objects in Live Capture」是 **UIKit** 写的，而本项目主线是 **SwiftUI**。下面第 1 周会**手把手教你把 UIKit 示例的捕获逻辑搬进 SwiftUI**，这是新手最容易卡住的桥接点。

### 第 1 周：搭骨架 + 跑通相机（含 UIKit→SwiftUI 桥接 + 授权流程）

1. **装 Xcode**：Mac App Store 下最新 Xcode。在 Xcode 设置里用你自己的 Apple ID 登录拿 **Free Provisioning**（免费即可装真机测相机，但 build 7 天过期、无 TestFlight；认真后再买 Apple Developer Program $99/年）。
2. **建工程**：新建 iOS App，Interface 选 **SwiftUI**，最低部署目标设 **iOS 17**。
3. **加权限文案**：在 `Info.plist` 加 `NSCameraUsageDescription`（写清用途，**不加会直接崩溃**）。
4. **分模块文件夹**（从第一天就分）：`Capture / Perception / Navigation / Feedback / RemoteAssist / Accessibility`。
5. **写相机授权流程**（新手真机首次运行必踩，务必先做）：
   - 在启动相机前先查 `AVCaptureDevice.authorizationStatus(for: .video)`：
     - `.notDetermined` → 调 `AVCaptureDevice.requestAccess(for: .video) { granted in ... }` 弹系统授权框；
     - `.authorized` → 直接启动 session；
     - `.denied` / `.restricted` → **不要再弹系统框（弹不出来了）**，改在界面上放一段 VoiceOver 友好的引导文案「相机权限被关闭，请前往设置开启」，并给一个按钮调 `UIApplication.shared.open(URL(string: UIApplicationOpenSettingsURLString)!)` 跳到本 App 设置页。
   - 回调可能不在主线程，更新 UI 前切回主线程。
6. **把 UIKit 捕获逻辑搬进 SwiftUI（手把手 4 步）**：
   - **(1) 建文件**：在 `Capture/` 下新建 `CameraManager.swift`（一个继承 `NSObject` 的类，持有 `AVCaptureSession` + 后置主摄输入 + `AVCaptureVideoDataOutput`，配置/启动放一条后台串行 `DispatchQueue`，别阻塞主线程）。
   - **(2) 贴 delegate**：让 `CameraManager` 遵循 `AVCaptureVideoDataOutputSampleBufferDelegate`，实现 `captureOutput(_:didOutput:from:)`——这就是「每一帧」回来的地方（把官方 UIKit 示例里这个方法的逻辑直接搬过来）。
   - **(3) 在 Coordinator 里当 delegate 接帧**：新建一个 `CameraView: UIViewRepresentable`，用它的 `Coordinator` 持有/充当 `CameraManager` 的 delegate；`makeUIView` 里创建承载 `AVCaptureVideoPreviewLayer` 的 `UIView` 并把 layer 接上 session，实现预览。（`UIViewRepresentable` 的 `Coordinator` 就是 SwiftUI 里「接 UIKit delegate 回调」的标准位置。）
   - **(4) 写进 @Observable**：把每帧的结果（先简单点：例如「当前是否在出帧 / 帧尺寸」）通过 Coordinator 回调写进一个 `@Observable` 的 ViewModel，SwiftUI 界面观察它刷新。第 2 周再把「检测结果」写进这个 ViewModel。
7. **真机跑通**：数据线接真机（最好带 LiDAR 的 Pro），看到后置摄像头实时画面 = **第一个里程碑**；再手动到「设置」里关掉本 App 相机权限，验证你的「被拒引导」生效。

### 第 2 周：接通一个 Core ML 检测 + 语音 + VoiceOver

> **重要提醒（省事路径优先）**：纯新手**第一次不要自己训模型**——Create ML 训目标检测需要「带标注的数据集」（要自己拍照 + 一张张框出物体），是隐藏的大工程，第 2 周大概率卡在「数据从哪来、要标多少张」。**默认走「先用现成开源 Core ML 检测模型」这条路**，把端到端链路跑通后，**第 5 节的「自训精简类别 + 高危类别覆盖验证」留到 Phase 1 中后期再做**。

1. **拿模型（推荐顺序）**：
   - **首选（省事，强烈推荐先走这条）**：直接用现成开源 Core ML 检测模型——例如 Ultralytics `yolo-ios-app` 工程里自带的 YOLO Core ML 模型，或官方导出的 YOLO11n/YOLOv8n `.mlpackage`。拖进工程（勾 Copy items if needed + 选中 target），Xcode 自动生成 Swift 类，**当天就能跑推理**。
   - **进阶（Phase 1 再做）**：若要自训精简类别，用 Create ML（图形界面，无需写 Python）。但要先想清楚数据来源：可用公开数据集（如带标注的街景/COCO 子集）起步，自采样本补「高危类别」（台阶/路桩/玻璃门）；标注量级通常每类几百到上千张才稳，训练数小时起——所以**别在第 2 周做这件事**。
2. **跑推理**：在 `captureOutput(_:didOutput:from:)` 里从 `CMSampleBuffer` 取 `CVPixelBuffer`，用 `VNCoreMLModel` + `VNCoreMLRequest` + `VNImageRequestHandler(cvPixelBuffer:)` 推理，拿 `VNRecognizedObjectObservation`（含归一化 bounding box）。**抽帧降频到每秒 5-10 帧**，推理放后台串行队列。
3. **可视化验证**：结果写进 `@Observable` 的 ViewModel，SwiftUI 叠加层画 bounding box，确认检测准确。
4. **算「几点钟方向」**：用检测框中心横坐标 + 相机 HFOV 按 §7.2 的公式算出相对正前方的方向档位（如「1 点钟方向」），先打印验证。
5. **加语音**：接 `AVSpeechSynthesizer` 做最简播报（如「1 点钟方向，检测到 人」），并用 `UIAccessibility.post(.announcement)` 与 VoiceOver 协作、不抢话。
6. **VoiceOver 试听**：打开「设置→辅助功能→VoiceOver」（或快捷键三击侧边键），**关屏**，仅靠听觉走一遍你的 App，体验盲人用户的真实交互——这是新手最该养成的习惯。
7. **架构注意**：用 `@State` 持有 `@Observable` ViewModel 时初始化器会随 View 重建反复调用——**别把启动相机/加载模型写在初始化里**，放到 `.task`/`.onAppear` 或显式方法。

**两周成功标准**：✅ 真机看到实时画面；✅ 相机权限被拒时有引导（不是闷崩）；✅ 屏幕上画出检测框；✅ 检测到物体时有语音播报且带「几点钟方向」；✅ 关屏开 VoiceOver 能听到播报且不与 VoiceOver 抢话。

---

## 10. 推荐学习资源与开源参考

### 10.1 Apple 官方（API 写法分歧时以此为准）

- **示例工程**：
  - "Recognizing Objects in Live Capture"（完整实时链路：AVCaptureSession→VNCoreMLRequest→Core ML 检测，下载即可真机跑，作为 Perception 模块蓝本；**注意它是 UIKit 写的，搬进 SwiftUI 的步骤见 §9 第 1 周**）
  - "AVCam: Building a Camera App"（相机输入/输出编排）
  - Apple `huggingface/coreml-examples` 的 Depth Anything V2 Swift 示例（深度估计脚手架）
- **文档**：Integrating a Core ML model、ARDepthData / smoothedSceneDepth、`ARCamera.trackingState`、MKDirections、Adding package dependencies、Migrating to @Observable、Responding to VoIP Notifications from PushKit、Privacy Manifest Files、VoiceOver evaluation criteria。
- **WWDC**：Create a seamless speech experience（WWDC20）、PHASE 空间音频（WWDC21）、Vision 新 API（WWDC24）；Foundation Models 端侧 LLM（WWDC25）**仅作了解——需 iOS 26+ 与 Apple Intelligence 机型，不在本项目 iOS 17 基线内**。

### 10.2 开源工程（可直接学习/移植）

- **Microsoft Soundscape**（`github.com/microsoft/soundscape`，社区分支 `soundscape-community/soundscape`、VoiceVista）：**96% Swift，最重要的可复用资产**——研究其 `AVAudioEngine` 空间音频信标与 callout 实现，用于 BeeUrEi 导航（注意其 OSM 后端依赖云、且无障碍数据稀疏，需替换为端侧/预下载 GeoJSON 或持牌图商，并准备数据缺失降级）。
- **Ultralytics `yolo-ios-app`**：YOLO 在 iOS 的官方开源工程，相机→Core ML 检测脚手架，**自带现成 Core ML 模型，是第 2 周省事路径的首选来源**。
- **CoreMLHelpers**（`hollance/CoreMLHelpers`）：CVPixelBuffer 处理等实用工具。
- WebRTC + Firebase 官方 codelab：用 Firestore 作信令 broker、Cloud Functions 跑后端，适合学匹配后端。

### 10.3 可复用模型/库

- **YOLO11n / YOLOv8n**：`model.export(format="coreml", nms=True, half=True, imgsz=640)` 一行导出 Core ML。
- **Depth Anything V2 small**（Apple 官方 Core ML，Hugging Face `apple/coreml-depth-anything-v2-small`；⚠️ 官方 FPS 仅测到 12 Pro Max，老机型须自测）。
- **coremltools 8.x**：PyTorch/TF → `.mlpackage` 转换（离线在 Mac 上做，不在 App 里）。

### 10.4 新手教程（以官方为准、教程为辅）

createwithswift.com、Hacking with Swift、Kodeco（前 raywenderlich）、nshipster.com（AVSpeechSynthesizer 等）。**注意**：网上大量教程混用旧 `VN*` completion-handler 写法与 iOS 18+ async/await 写法——自定义 Core ML 模型目前仍以经典 `VNCoreMLRequest` 为最稳路径。

---

## 11. 待你拍板的开放问题

> 这些决策会显著改变架构、工作量与可行性，建议在 Phase 0 立项阶段就定下来。

1. **目标机型范围**：是否要求 iPhone Pro（LiDAR）以保证测距级避障，还是必须支持全机型？**最低机型不得低于能稳定跑 iOS 17 的设备**（iPhone 7 等不在范围内）；同时要定一个「目标机型矩阵」（至少一台 Pro + 一台无 LiDAR 老机型），因为**老机型上的深度模型实测数据完全空白，可行性需 Phase 0/1 真机验证**。
2. **避障深度来源策略**：以 LiDAR 为主（限 Pro，叠加 `trackingState` 门控）、单目估深为主（全机型但只能相对预警）、还是两者融合自动降级？
3. **导航是否放宽端侧约束（最关键的中国合规决策，并直接决定「导航联网行为」）**：在中国大陆，纯端侧离线步行导航面临测绘法 + 数据闭源 + GCJ-02 坐标偏移三重障碍。是否对「导航」放宽端侧/离线约束、接入持牌图商（高德/百度）SDK？**注意后果**：走持牌图商 = **导航持续联网**（非「取一次就离线」）；走 MapKit（仅海外）= 出发联网一次后可离线。二者会改变联网/电量/隐私假设与对外宣传口径。
4. **目标发行城市/地区**：决定 OSM/图商无障碍数据完整度、视障路由是否可行（**数据缺失要走 §5.6 降级**），以及 GDPR/EAA/ADA/中国国标的合规收口。
5. **远程志愿者来源**：自建众包网络、绑定亲友名单，还是设法接入/复用 Be My Eyes 等现有平台？（决定第③功能工程量与冷启动接通率）
6. **是否录制志愿者通话 + 托管侧媒体留存策略**：直接决定隐私合规复杂度（GDPR 同意、保留期、第三方/路人隐私）。建议本端默认不录制；并须查清并声明厂商侧是否落盘/留存多久。
7. **是否做红绿灯/过街识别**（类 OKO）作为避障子能力：自研 Core ML 还是寻求授权？
8. **AirPods 头部追踪**：作为空间音信标的强依赖，还是仅作增强（并非所有用户都有兼容耳机）？
9. **宏观导航与微观避障**：默认同时运行，还是用户可分别开关？（影响声音通道仲裁复杂度）
10. **室外定位精度阈值的安全策略**：是否与视障 O&M 专业人士共同制定「何种精度下允许下达哪类指令」？
11. **预算与可持续性**：公益项目能否承受 SDK 免费额度耗尽后的**按视频单价计费 + TURN 带宽费**（注意视频比音频贵 1.7–6 倍，见 §8.6）？是否申请厂商非营利/无障碍折扣？
12. **是否兼顾 iPad，还是仅 iPhone？**

---

### 附：一句话行动建议

**先用两周跑通「相机（含 UIKit→SwiftUI 桥接与授权流程）+ 一个现成 Core ML 检测 + 带「几点钟方向」的语音 + VoiceOver」（§9，第一次不要自己训模型）；同时立项就把第 11 节的「机型范围（含老机型实测）」「导航是否放宽端侧约束＝是否接受持续联网（中国合规）」「志愿者来源」三件事拍板——这三件决定整个架构走向。然后严格按 Phase 0→4 推进，每阶段达不到「成功标准」（含可量化的延迟阈值与逐机型的双模型并发实测）就不进下一阶段；安全免责红线（§1.3、§5、§7.3）从第一天起贯穿始终。**

---

## 12. 决策更新与未来方向（2026-06-07 追加）

### 12.1 决策更新：仅适配带 LiDAR 的 iPhone（硬性要求）

- 在原「仅 Pro 机型」基础上进一步明确：**BeeUrEi 只适配搭载 LiDAR 的 iPhone**（即 iPhone 12 Pro / Pro Max 起的 Pro 线）。**非 LiDAR 机型不在支持范围**。
- 直接影响（简化）：
  - **彻底移除单目深度（Depth Anything 等）降级线**——避障的「多远」统一由 ARKit `sceneDepth` / `smoothedSceneDepth`（每像素真实米数 + confidence）提供，叠加 `trackingState` 门控降级（见 §5.2）。架构、风险表、Phase 1 成功标准中关于「非 LiDAR 机型相对预警」的分支不再需要。
  - §5.4 的「老机型实测空白」风险大幅收敛——目标机型矩阵限定在带 LiDAR 的 Pro 机型；但**双模型并发的发热/帧率/延迟仍需在最低目标 Pro 机型上实测**。
- 强制手段（已落地到代码）：
  1. 运行时检查 `ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)`；无 LiDAR → 显示「设备不支持」页并停止（见 `Core/DeviceSupport.swift`、`HomeView` 的 `.unsupported` 分支）。
  2. `Info.plist` 的 `UIRequiredDeviceCapabilities` 加入 `arkit`，App Store 侧限制安装到 ARKit 设备（注意：`arkit` 能力 ≠ LiDAR，最终 LiDAR 限制仍靠上面的运行时检查）。

### 12.2 未来方向：手机作为「算力机」+ 外接设备（眼镜/耳机）

**愿景**：手机不一定是「举着扫描」的那台相机，而是作为**端侧算力中枢**；真正的传感器（相机 + LiDAR）可来自更自然的可穿戴外接设备——带摄像头/LiDAR 的**智能眼镜或耳机**。外部设备采集 → 流式传到手机 → 手机跑端侧 AI → 把引导（语音/震动指令）回传到外接设备播放。用户无需手持手机，解放双手、视角更贴近头部朝向。

**数据流（未来）**：
```
[外接设备: 相机+LiDAR]  --(低延迟传输)-->  [手机: 端侧 AI 算力机]
        ▲                                          │
        └────────(引导: 语音/震动指令)───────────────┘
```

**现在为它铺的路（已落地到代码的架构缝）**：
- **`FrameSource` 端口（感知输入抽象）**：上层（Perception / 决策 / Feedback）只依赖 `FrameSource` 协议拿 `SensorFrame`（画面 + 深度 + 时间戳），**不关心来源**。
  - 今天：`PhoneCameraSource`（手机自带相机/LiDAR）。
  - 未来：`ExternalDeviceSource`（外接设备经网络流式接入）——只需新增一个实现，**上层零改动**。占位类已建（`Sensors/ExternalDeviceSource.swift`）。
- **（下一步将加）`FeedbackSink` 抽象**：把「语音/空间音/震动」的**输出目的地**也抽象出来，可路由到手机本机或外接设备。
- **核心与 I/O 解耦（六边形 / 端口-适配器思路）**：感知→决策核心只做 `(画面, 深度) → (障碍, 引导)`，与「数据从哪来、引导往哪送」无关，从而手机能纯粹作为算力机被复用。

**未来要解决的难题（现在仅登记，不实现）**：
- **传输**：低延迟把视频帧 + 深度从外设传到手机（候选：Wi-Fi 直连 / 自定义 UDP 协议 / WebRTC DataChannel；蓝牙带宽不足以传视频+深度）。
- **延迟与带宽预算**：避障是安全攸关、端到端要 ≤ ~0.8–1.3s（见 §5.6），外设→手机→外设的来回必须挤进这个预算。
- **时间同步 / 标定**：外设相机与 LiDAR 的内外参标定、帧时间戳对齐。
- **断连降级**：外设断连时回退到手机自身传感器，或安全停机并告知。
- **功耗 / 发热分配**：双设备协同下的电量与热管理。
- **隐私**：外设视频流的传输加密与留存策略（同 §7.4）。

**与现阶段的关系**：现在**不实现**外接设备，只通过上述抽象把边界固定好，确保未来接入时无需重构 Perception / Feedback / Navigation。这就是本次「为以后铺路」的全部含义。

---

## 13. 工程任务清单（TDD 勾选）

> **勾选契约（重要）**：
> - **§13.1 核心逻辑**：安全攸关的纯逻辑放在平台无关的 `Packages/BeeUrEiCore`，用 `swift test` 在 Mac 本机直接运行（无需 iOS 模拟器）。每项「实现 + 单元测试通过」后才勾 `[x]`。
> - **§13.2 iOS 适配层**：相机/ARKit/语音/震动/地图/SwiftUI 等是 I/O 适配，**不做单元测试**（其内含的可测逻辑已下沉到 §13.1 并被覆盖）；当「适配代码写好且 App 能编译通过」后勾 `[x]`，运行时正确性由**真机**验证。
> - **§13.3 外部依赖 / 真人事项**：需 Apple 账号、第三方 SDK 商务、持牌图商 API key、真实视障用户测试等——**非本地可自动完成的工程项**，故不设勾选框，单独登记。

### 13.1 核心逻辑（🧪 BeeUrEiCore · swift test）

- [x] 几点钟方向计算 `ClockDirection`（§7.2）
- [x] 反馈优先级与抢占仲裁 `FeedbackArbiter`（§3.1）
- [x] LiDAR 深度采样 → 最近障碍距离 `DepthSampler`（§5.1/§5.2）
- [x] 障碍融合（检测框 + 深度 → 障碍模型）`ObstacleFusion`
- [x] 障碍播报文案合成 `SpeechComposer`（§7.2）
- [x] 端到端延迟与最小提前距离判定 `LatencyBudget`（§5.6）
- [x] 定位精度门控 `LocationAccuracyGate`（§5.3）
- [x] 航向平滑与磁干扰检测 `HeadingFilter`（§5.3）
- [x] LiDAR 跟踪状态门控 `TrackingGate`（§5.2）
- [x] 热状态分级降级策略 `ThermalPolicy`（§5.4）
- [x] 导航地区路由选择 `RouteProviderSelector`（§1.2/§5.6）
- [x] 无障碍数据缺失降级判定 `RoutingFallback`（§5.6）
- [x] 远程协助呼叫状态机 + 亲友筛选 `RemoteAssistCall`（§8）
- [x] 安全免责告知状态机 `DisclaimerPolicy`（§1.3）
- [x] 高危类别清单 `HazardCatalog`（§5.8）
- [x] 多障碍危险度排序 `ObstacleRanker`
- [x] 播报去抖节流 `AnnouncementThrottle`
- [x] 地理方位/距离计算 `Geo`（§5.3）
- [x] 空间音信标方位映射 `BeaconDirection`（§7.2）
- [x] 到下一转向播报决策（精度门控）`RouteProgress`（§5.3）
- [x] 低电量/省电降级 `PowerPolicy`（§5.4）
- [x] 偏航检测 `OffRouteDetector`（§5.3）
- [x] 距离→提示音节奏映射 `ProximityCueMapper`（§7.2）

### 13.2 iOS 适配层（📱 真机集成；编译通过即勾）

- [x] `FrameSource` 端口 + `SensorFrame`
- [x] `DeviceSupport` LiDAR 门控 + 不支持页
- [x] `ExternalDeviceSource` 占位
- [x] App 接入 `BeeUrEiCore`（去重，复用已测逻辑）
- [x] 采集层基于 ARKit `sceneDepth`（`ARDepthCameraSource` 填充 `SensorFrame.depth`；已取代 AVFoundation 源）
- [x] ARKit 相机预览桥接 `ARSessionPreviewView`
- [x] 深度中央采样适配 `DepthSampling`（喂给核心 `DepthSampler`）
- [x] `FeedbackSink` 适配：`AVSpeechSynthesizer` 语音
- [x] `FeedbackSink` 适配：Core Haptics 震动
- [x] `FeedbackSink` 适配：`AVAudioEnvironmentNode` 空间音
- [x] `FeedbackCoordinator` 接入核心 `FeedbackArbiter`
- [x] Navigation 适配：MapKit 步行路线（海外）
- [x] RemoteAssist 适配：PushKit + CallKit 来电骨架
- [x] Phase 1 闭环：ARKit 深度 → 采样 → `DepthSampler` → `SpeechComposer` → 语音/震动
- [x] 深度按检测位置采样 `DepthSampling.samples(at:)`
- [x] 检测→融合→排序→去抖→播报 接入 HomeViewModel（detector 仍为 Stub，路径就绪）
- [x] 热状态/电量降级提示接入 HomeViewModel（`ThermalPolicy`/`PowerPolicy`）
- [x] Vision+Core ML 检测器适配 `YOLOObstacleDetector`（模型为外部资产，缺失自动降级深度兜底）
- [x] 免责知情同意 onboarding `OnboardingView` + 持久化 `ConsentStore`（接 `DisclaimerPolicy`，VoiceOver 友好）
- [x] 开始避障播报简短免责提醒（接 `DisclaimerPolicy`；开关持久化已就位）
- [x] 设置页 `SettingsView`（开关简短提醒 + 重听完整安全须知）+ 首屏齿轮入口
- [x] 远程协助 UI `RemoteAssistView`/`RemoteAssistViewModel`（亲友名单本地持久化 `ContactStore`，呼叫状态接核心已测 `RemoteAssistCall`）+ 首屏求助入口（RTC 媒体连接仍属 §13.3 外部依赖）
- [x] VoiceOver 协作：`SpeechFeedback` 在 VoiceOver 开启时改用 `UIAccessibility` 播报而非直接 TTS，避免抢话（§7.2）；各视图 VoiceOver 标签/Header/Dynamic Type 审查通过
- [x] 已生成并编入 demo Core ML 模型 `BeeUrEi/Models/YOLO.mlpackage`（Ultralytics yolo11n + NMS，COCO 英文类别）→ 检测路径已激活、随 App 编译进包（`YOLO.mlmodelc`）。⚠️ 正式版需中文/裁剪高危类别模型（§5.8），当前英文标签不触发中文高危加成

### 13.3 外部依赖 / 真人事项（不设勾选框，登记备忘）

- 持牌图商（高德/百度）SDK + API key 接入（国内导航）— 需注册账号。
- 远程视频 RTC SDK（Agora/Daily）商务与集成 — 需账号/付费额度。
- Apple Developer Program、Privacy Manifest 终稿、上架审核。
- 真实视障用户 TestFlight 走查（§7.5）。
- 目标机型矩阵上的发热/帧率/端到端延迟真机实测（§5.4/§5.6）。

### 13.4 对抗式审查与加固（2026-06-07，🧪 已修复 + 回归测试，swift test 104 通过）

多智能体审查 26 个核心模块，确证 **10 个真实 bug**，已全部修复并补回归测试：

- [x] `ClockDirection` / `BeaconDirection` 非有限(NaN/∞)输入触发 `Int()` 崩溃 → 有限性门控 + 安全缺省(正前方/12 点)
- [x] `DepthSampler` 置信度数组偏短时安全门控被绕过 → 缺对应项即丢弃
- [x] `ObstacleRanker` 近区(<0.1m)危险度被封顶为 10 致排序非单调 → 改 `1/max(d, ε)`
- [x] `SpeechComposer` 厘米/米边界产出「100 厘米」 → ≥100cm 升「米」
- [x] `SpeechComposer` 退化距离产出「0 厘米/负/nan 米」→ 防护为「非常近」+ `announce` 净化非有限距离
- [x] `ObstacleFusion` 非法距离透传 → 源头归一为 nil
- [x] `RouteProgress` 负距离(已越过转向点)仍下高确定性「现在过马路」→ 负距离静音
- [x] `HeadingFilter.update` 忽略 `accuracyDegrees` 致磁干扰样本污染航向 → 强制可信门控
- [x] `OffRouteDetector` 反子午线(±180°)跨越把在线点误判偏航 → 经度差归一化
- [x] `OffRouteDetector` 端点夹取分支补回归测试

---

## 14. 后端与新功能（2026-06-07 启动）

### 14.1 决策定案（Q1–Q12）

- Q1/Q2 仅 LiDAR iPhone Pro；避障只用 ARKit `sceneDepth`（已定）。
- Q3/Q4 海外 + 国内：海外 MapKit；国内持牌图商（持续联网）。
- Q5 远程协助：亲友名单 + 紧急呼叫（自建后端账号体系）。
- **Q6 通话录制**：支持但**默认关闭**；需双方知情同意；紧急呼叫可按需自动录制留证；媒体**加密存储 + 默认保留 N 天后自动删除（可配置）**；非紧急默认不录制不留存。
- **Q7 红绿灯/过街识别**：做（端侧 Core ML 子能力）。
- **Q8 AirPods 头部追踪**：做，作为**增强**（`CMHeadphoneMotionManager` 提升空间音方向；无兼容耳机回退手机朝向）。
- **Q9 导航/避障**：**可分别开关**（默认避障开、导航按需）。
- **Q10 定位精度安全策略**：编码保守默认（核心 `LocationAccuracyGate`），标注**上线前需 O&M 专家复核**。
- **Q11 预算**：**自建后端 + WebRTC P2P 自托管信令/TURN**，规避按量 RTC 费用（仅服务器/TURN 带宽成本）；「申请厂商公益折扣」记为待办。
- Q12 仅 iPhone（不变）。

### 14.2 后端范围（自托管，`server/`）

栈：**Node.js + TypeScript + Fastify + WebSocket 信令 + SQLite + JWT/bcrypt**。`npm run dev` 即自托管运行。
功能：账号登录与**角色**（视障 / 协助者 / 亲友 / 管理员 / 开发者）、亲友绑定、紧急呼叫路由、WebRTC 信令与匹配、管理员（用户管理 / 封禁 / 举报处理）、录制与留存策略、开发/测试端点。

### 14.3 视频隐私模型

1:1 P2P WebRTC：协助者**不开摄像头**、只收视频 + 双向语音；视障侧摄像头默认**不输出画面**（只传音频），仅当**连续点击/长按隐私按钮**时才把视频轨发出（防误触、保护隐私），松开即停。

### 14.4 开发者模式

App 内**手动开启**（无需账号，如连点版本号），叠加显示**温度 / 帧率 / 延迟**等调试信息；后端另设 developer 角色用于测试端点。

> 详细 API / 数据模型 / 信令时序 / iOS 任务清单见 **docs/BACKEND_PLAN.md**（由设计工作流产出）。

### 14.5 工程任务（🚧 进行中）

- [x] 后端骨架（Fastify + TS，可 `npm run dev` 运行，含 /health + /api/version + 2 测试通过）
- [x] 账号与角色（注册/登录 JWT、bcrypt、RBAC、/api/me）— 6 测试
- [x] 亲友绑定 + 紧急呼叫路由（/api/family/links、/api/emergency/trigger、纯逻辑 `planEmergencyRoute`）— 共 11 测试
- [x] WebRTC 信令（WebSocket /ws）+ 房间/匹配 + 视频门控消息（含纯逻辑 `SignalingHub` 单测 + 真实双端 relay 集成测试）
- [x] 管理员端点（列用户/封禁解封/举报列表与处理）+ 举报提交
- [x] 录制配置 + 留存策略（默认关 + 知情同意 + 到期自动删，纯逻辑 `expiredRecordingIds` 单测）
- [x] 开发者后端测试端点（developer 角色：/api/dev/ping、/api/dev/stats）
- [x] 后端共 **24 个测试全过**（typecheck 干净）
- [x] 后端增强：SQLite 持久化（`node:sqlite`，默认驱动）、速率限制（`@fastify/rate-limit`）、admin 环境变量引导（`seedAdmin`）、coturn 配置示例（`server/coturn.conf.example`）— 后端共 **29 测试**
- [ ] 后端增强（可选，留后）：refresh token 轮换
- [x] 远程视频**真实媒体引擎** `WebRTCMediaEngine`（`#if canImport(WebRTC)` 守卫）：RTCPeerConnection 协商(offer/answer/ice 经 `SignalingClient` /ws) + 双向音频 + 视障侧隐私门控视频 + 协助者远端渲染 `RemoteVideoView`。装 `stasel/WebRTC` 包即激活（本机无包走 stub 仍编译），双真机验证。
- [x] 后端**已部署到 awsjapan**：Docker 容器 `beeurei-api`（`127.0.0.1:8787`，`--restart unless-stopped`，SQLite volume，admin 环境变量引导），经 Cloudflare Tunnel 暴露为 `beeurei-api.hikosphere.com`（用户在 CF 加 Public Hostname → `http://localhost:8787`）。iOS `ServerConfig` 默认指向该域名。
- [x] **角色化界面 + 入口流程**：安全须知 → 登录 → 恢复账号(/api/me) → **确认角色** → 进入对应主界面（`RootView`/`RoleEntryView`/`RoleHomeView`）。各角色**独立界面**：盲人=避障 `HomeView`｜协助者 `HelperHomeView`(在线待命+接听通话)｜亲友 `FamilyHomeView`(紧急待命+通话)｜管理员 `AdminHomeView`(用户封禁/解封+举报，接 /api/admin)｜开发者 `DeveloperHomeView`(任一角色界面预览+后端统计)。设计见 docs/ROLE_INTERFACES.md。
- [x] API 默认固定 `beeurei-api.hikosphere.com`；自定义 URL 仅开发者模式可见可改。
- [x] **导航真正可用（海外）**：把空间音信标 `SpatialAudioFeedback`（朝目标方位、~1.5s 一响）+ 偏航检测重规划 `OffRouteDetector` + AirPods 头追踪 `HeadTracker`(听者朝向世界固定) 真正接进 `NavigationViewModel`；转向播报含精度门控 + 可调语速。（之前这些是"定义了但零引用"。）真机+定位验证。
- [x] **亲友 + 紧急呼叫闭环（真接后端）**：iOS `APIClient` 加 family/emergency；后端加成员侧 `/api/family/incoming`(+ `linksByMember`)。视障侧 `FamilyLinksView`(绑定/解绑/紧急呼叫取优先级目标，入口在设置)；亲友角色 `FamilyHomeView` 显示"谁绑定了我"。真实响铃仍需 PushKit(真机)。后端 31 测试过。
- [x] **管理员面板完善**：用户封禁/解封 + **举报处理 resolve**（接 `/api/admin`，真数据）。
- [x] iOS：开发者模式叠层 `DevOverlayView`（`DevSettings` 手动开启）——FPS / 热状态档(中英) / 电量+省电 / 检测器 / 检测数 / ROI 坐标 / 跟踪状态 / 画面+深度图分辨率 / 距离 / 降级；并在预览上叠加 **ROI 检测框可视化** `DevROIOverlay`。⚠️ iOS 无公开摄氏温度 API，仅 thermalState 四档
- [x] iOS：导航/避障分别开关 `FeatureSettings`（Q9，设置页 + 避障门控）
- [x] iOS：登录界面 `LoginView` + `AuthSession` + Keychain + `APIClient`（接后端 /api/auth；可配服务器地址；ATS 本地网络例外）
- [x] iOS：双角色通话 UI `CallView`/`CallViewModel` + 信令客户端 `SignalingClient`(接 /ws) + 隐私门控视频(按住/切换发画面，video-gate 信令) + `MediaEngine` 抽象（⚠️ 真实 WebRTC 媒体引擎需 WebRTC SPM 包 + 双真机，属外部 §13.3；信令/UI/门控已就位）
- [x] iOS：红绿灯/过街提示 `CrossingAssistant`（Q7，存在性识别+过街提醒，已测+已接入；⚠️ 红/绿颜色判别需专用模型，属外部资产 §13.3）
- [x] iOS：AirPods 头部追踪 `HeadTracker`（Q8，增强空间音；核心 `BeaconDirection.relative` 已测；`SpatialAudioFeedback.setListenerYaw`；无耳机回退）
- [x] iOS：录制知情同意 UI `RecordingConsentView` + 核心 `RecordingConsent`（Q6，需各方同意，已测）
- [x] iOS：海外 MapKit 步行导航 `WalkNavigationView`/`NavigationViewModel`/`NavigationService`（搜索目的地→步行路线→定位→精度门控+转向播报，接已测核心 `RouteProgress`/`LocationAccuracyGate`/`Geo`；真机验证定位）
- [x] 国内导航：高德 **Web 服务**接入（key 在 `server/.env`，仅后端持有不进 App）；后端 `/api/nav/walking`（geocode + 步行路线，2 测试）+ iOS `AMapRouteClient` + 导航页地区选择 + 步骤读出。⚠️ 完整「实时逐向 + GCJ-02 定位」需高德 iOS SDK（外部）；当前为路线步骤读出 MVP
- [x] 署名：隶属组织 Hiko Sphere 彦穹科技 · 软件制作人 Li Yanpei Hiko（README/PLAN/NOTICE/Info.plist 版权/设置「关于」）
- [x] 修复：手抖检测闪烁致播报反复打断「说不完」→ `ObstacleStabilizer` 时间稳定化(迟滞) + 仅目标变化/每6s刷新才播报（已测）
- [x] 增强：ROI 中央带检测（Vision `regionOfInterest`，聚焦正前方）+ 检测框坐标重映射 `ROIMapper`（已测）
- [x] **抖动根治**：`DirectionSmoother`（方位/距离圆形 EMA）消手抖致几点钟方向跳变（"说不完"根因）+ **承诺式播报** `AnnouncementPolicy`（同目标说话期间不重播、只有明显更紧急的新目标才打断）+ 放宽稳定化迟滞 releaseFrames=6。已单测。
- [x] **简短播报 + 可调语速**：`SpeechComposer.conciseAnnounce`（如"正前方 行人 1米"）+ `FeatureSettings.conciseAnnouncements/speechRate` + 设置页「播报」开关/语速滑块。
- [x] **顶尖感知算法**（规格 docs/PERCEPTION_ALGORITHM.md）——核心+接入完成，余真机调参：
  - [x] 核心已实现 + **147 测试全过**：针孔投影 `PinholeCamera`、碰撞走廊 `CollisionCorridor`(动态ROI/3D inside/自适应纵深)、`AlphaBetaFilter`、轻量跟踪 `ObstacleTracker`(生命周期+ID+闭合速度)、`TimeToCollision`/`RiskScore`、`TrafficLightClassifier`。
  - [x] **跟踪+TTC+风险已接进避障主链路**：`HomeViewModel` 用 `ObstacleTracker`+`RiskScore` 取代 ranker/stabilizer/smoother（稳定ID/平滑/容忍漏检/按TTC排序威胁），承诺式播报用 track id 作键。
  - [x] 动态 ROI 碰撞走廊**已接进检测器**：`SensorFrame` 加 `CameraGeometry`(内参/位姿/上方向 from ARFrame, ARKit↔CV `transform*diag(1,-1,-1,1)`)；`HomeViewModel.dynamicROIBox` 用 `CollisionCorridor.imageROI` 算 ROI 喂 YOLO（`detect(in:regionOfInterest:)`），DevSettings 开关默认关 + 开发者叠层绿框可视化 + 退化安全回退静态。⚠️ 地面用 1.2m 近似，真机配合 ARPlaneAnchor 调参。
  - [x] 红绿灯**颜色识别已接进检测**：`ColorSampler`(YCbCr/BGRA 灯框均值) → `TrafficLightClassifier` → 播报"红灯请等待/绿灯可通行"。⚠️ 远距小目标不可靠，正式需专用模型。
- [x] 品牌：应用图标接入 `Assets.xcassets/AppIcon`（用品牌资产全套尺寸）+ 重写专业 README（字标/徽章/架构图）
- [x] iOS：检测标签 英文→中文 + 高危加成映射 `LabelCatalog`（§5.8，已单测、已接入检测链路）
