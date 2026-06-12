<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="BeeUrEi-Brand-Assets/03-wordmark/beeurei-wordmark-horizontal-light-1720.png">
    <img alt="BeeUrEi" src="BeeUrEi-Brand-Assets/03-wordmark/beeurei-wordmark-horizontal-dark-1720.png" width="440">
  </picture>
</p>

<p align="center">
  <b>Be Your Eye · 用 iPhone 的摄像头与 LiDAR，做视障者的另一双眼睛</b><br/>
  <sub>On-device real-time obstacle avoidance · walking navigation · scene & object recognition · live human assistance — for the blind & low-vision. Free, private, self-hosted.</sub>
</p>

<p align="center">
  <img src="https://github.com/Hiko-Sphere/BeeUrEi/actions/workflows/ci.yml/badge.svg" alt="CI">
  <img src="https://img.shields.io/badge/iOS-17%2B-14161F?logo=apple&logoColor=white" alt="iOS 17+">
  <img src="https://img.shields.io/badge/Swift-5-FFC42E?logo=swift&logoColor=14161F" alt="Swift 5">
  <img src="https://img.shields.io/badge/on--device%20AI-Core%20ML%20%2B%20ARKit-14161F" alt="On-device AI">
  <img src="https://img.shields.io/badge/backend-Node%20%2B%20Fastify-339933?logo=nodedotjs&logoColor=white" alt="Backend">
  <img src="https://img.shields.io/badge/tests-577%20passing-2ea44f" alt="Tests">
  <img src="https://img.shields.io/badge/i18n-中文%20%2B%20English-FFC42E?logoColor=14161F" alt="Bilingual">
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="GPL-3.0">
</p>

---

## 这是什么

**BeeUrEi**（Be Your Eye）是一款原生 iOS App：用 iPhone 主摄像头 + LiDAR，为视力障碍人士提供四种核心能力——**零硬件、零订阅、隐私端侧**。

- 🛡️ **实时避障** —— 端侧 AI 连续判断前方障碍，语音 + AirPods 双耳空间音 + 震动提示「是什么、几点钟方向、还有多远」；地面落差/台阶检测、红绿灯三通道提示（节奏音 + 节奏震动 + 全屏色块）、接近声呐
- 🧭 **步行导航** —— 空间音「信标」指路 + 转向播报 + 路名 callout；**面包屑原路返回**（记下走过的路，一键带回出发点）；环境感知三键「我在哪 / 周围有什么 / 前方有什么」（时钟方位 + 米数）
- 📷 **场景识别** —— 对准即说：识别物品 / 朗读文字 / **读整页文档（多页连读）** / **识别纸币** / **扫码认商品** / 找我的东西（教它认你的物品）/ 找周围的物品 / **周围的人**（人数方位距离，不识别身份）/ 公交线路 / 光线探测 / 照片触摸探索 / 识别历史回放——全部端侧，画面不上云
- 🤝 **远程真人协助** —— 一键视频呼叫亲友/志愿者；视障侧画面**默认不外发**，按住才显示；来电铃声 + 振动 + 语音报来电人；通话中亲友可远程开手电/变焦帮你看清

> 名字寓意：一只蜜蜂正是眼睛的瞳孔，替你「看」路；外圈微光象征 LiDAR 扫描与蜂鸣提示。

### 安全红线（务必知悉）

> **BeeUrEi 是「感知增强的辅助工具」，不是「安全保障设备」。它不能替代白手杖、导盲犬或定向行走（O&M）训练，也不保证检测出所有障碍。请始终保留并优先使用它们，切勿将本 App 作为出行的唯一依据。**

---

## 🆚 为什么选 BeeUrEi

| | BeeUrEi | Seeing AI | Lookout | Be My Eyes | Soundscape 系 |
|---|---|---|---|---|---|
| 避障（LiDAR 测距 + 落差检测） | ✅ | ❌ | ❌ | ❌ | ❌ |
| 步行导航 + 空间音信标 + 原路返回 | ✅ | ❌ | ❌ | ❌ | ✅（仅信标） |
| 场景识别全家桶（文字/纸币/商品/找物/人/公交/光线） | ✅ | ✅ | ✅ | 部分 | ❌ |
| 真人视频协助 | ✅ 亲友+志愿者 | ❌ | ❌ | ✅ | ❌ |
| 三合一一个 App | ✅ | ❌ | ❌ | ❌ | ❌ |
| 画面不上云（识别全端侧） | ✅ | ❌ 部分云端 | ❌ 部分云端 | ❌ 云端 | — |
| 自托管后端（数据归你） | ✅ | ❌ | ❌ | ❌ | ❌ |
| 中文 + 英文 | ✅ 全链路 | 部分 | 部分 | ✅ | ❌ |
| 开源 | ✅ GPL-3.0 | ❌ | ❌ | ❌ | 部分 |

---

## ✨ 设计原则

| 原则 | 含义 |
|---|---|
| **端侧优先** | 所有视觉 AI 推理在 iPhone 本机完成；画面默认不上云——低延迟、可离线、隐私好 |
| **安全攸关** | 把避障/导航的物理与定位局限当一等公民：分级降级、保守门控（低定位精度绝不下达「现在过马路」）、置信度透明（拿不准就说「可能是」） |
| **一张嘴说话** | 全局语音总线统一仲裁：避障警告 > 来电 > 导航指令 > 识别/查询——**永不同时出声**；被打断的导航指令在警告说完后自动补播 |
| **无障碍即全部** | 100% VoiceOver 可用（Magic Tap：识别屏=描述前方、来电=接听、通话=挂断）；语音/空间音/震动多模态；高对比大字 |
| **端口–适配器** | 安全逻辑下沉为平台无关、可单测的核心包；I/O（相机/ARKit/语音/定位/网络）协议化可注入 |
| **自托管** | 后端 + WebRTC 信令 + TURN 全可自托管，零第三方按量费用，数据完全归你 |

---

## 🏗 架构

```
┌──────────────────────────── iPhone（原生 Swift / SwiftUI）────────────────────────────┐
│                                                                                       │
│  Capture(ARKit+LiDAR) ─▶ FrameSource 端口 ─▶ Perception(Core ML/Vision，端侧推理)      │
│        │                  （未来可换外接眼镜/耳机）          │                          │
│        ▼                                                    ▼                          │
│  ARSession 深度/画面                          障碍{类别·几点钟·米数} ─▶ 稳定化(迟滞)     │
│                                                             │                          │
│                          ┌─ 避障通道(FeedbackArbiter 优先级仲裁) ─▶ 语音/空间音/震动    │
│      语音输出统一仲裁 ──┤                                                              │
│                          └─ SpeechHub 总线(来电>导航>识别/查询，避障开播全员让位)        │
│                                                                                       │
│  ── 核心安全逻辑（平台无关 Swift Package，303 单测）──────────────────────────────────  │
│  ClockDirection · DepthSampler · ObstacleRanker · FeedbackArbiter · SpeechGate         │
│  LocationAccuracyGate · WaypointAdvance · CurrencyClassifier · BusDisplayReader ...    │
└───────────────────────────────────────────────────────────────────────────────────────┘
            │ REST + WebSocket 信令（仅网络通信，不做 AI 推理）           ▲
            ▼                                                            │ P2P 媒体(WebRTC)
┌──────────────── 自托管后端（Node + TypeScript + Fastify）─────────┐    │  直连失败时经
│ 账号/角色(JWT/RBAC) · 亲友绑定(双向同意) · 紧急呼叫路由 · 信令(/ws) │    │  ┌─────────────┐
│ 公开求助队列 · 推送(双语) · 管理员/举报 · SQLite 持久化            │◀───┘  │ coturn TURN │
└───────────────────────────────────────────────────────────────────┘       └─────────────┘
```

---

## 🧩 技术栈

| 层 | 选型 |
|---|---|
| 端侧感知 | ARKit `sceneDepth`（LiDAR 测距）· Core ML / Vision（YOLO 检测 · OCR · 条码 · 人脸框 · FeaturePrint）|
| 反馈 | AVSpeechSynthesizer（TTS，总线仲裁）· AVAudioEngine 双耳 HRTF 空间音 · Core Haptics · VoiceOver 协作 |
| 导航 | MapKit 步行路线（海外）· 持牌图商 SDK（中国大陆，规划中）· CoreLocation · CLGeocoder 路名 |
| 远程协助 | WebRTC P2P · 自托管 WebSocket 信令 · 自托管 coturn TURN · CallKit + PushKit（后台来电）|
| 界面 | SwiftUI（iOS 17+，`@Observable` MVVM）· AppIntents（Siri 中英 9 条快捷指令）|
| 后端 | Node.js + TypeScript + Fastify + `node:sqlite` + JWT + WebSocket |
| 工程 | XcodeGen · Swift Package（核心逻辑）· Vitest（后端）· GitHub Actions CI |

---

## 📂 项目结构

```
Project_BeeUrEi/
├─ BeeUrEi/                  iOS App（适配层 + 界面）
│  ├─ Sensors/ Capture/      FrameSource 端口、ARKit 采集、深度采样
│  ├─ Perception/            YOLO 检测器（Core ML/Vision，ROI 聚焦）
│  ├─ Feedback/              语音总线 SpeechHub、避障语音/空间音/震动仲裁、AirPods 头追踪
│  ├─ Navigation/            MapKit 步行导航、环境感知三键、面包屑回程
│  ├─ RemoteAssist/          信令客户端、媒体引擎、CallKit/铃声、亲友名单
│  ├─ Account/               登录、Keychain、API 客户端
│  └─ Features/              主屏、识别屏（频道全家桶）、导航、通话、设置、引导
├─ Packages/BeeUrEiCore/     平台无关核心安全逻辑（303 单测）
├─ Tests/BeeUrEiTests/       应用层回归（通话隐私门控/避障纪律/导航门控/来电/识别状态机，72 测）
├─ server/                   自托管后端（Node + TS，164 测）
├─ docs/                     PLAN.md（总设计）· PROJECT_STATUS.md（交接）· SHIP_CHECKLIST.md（上架）
└─ BeeUrEi-Brand-Assets/     品牌资产（图标 / 字标 / 配色）
```

---

## 🚀 快速开始

### App（需带 LiDAR 的 iPhone：12 Pro 及更新 Pro 机型）

```sh
open BeeUrEi.xcodeproj        # 工程由 XcodeGen 生成；改 project.yml 后 `xcodegen generate`
```
在 Xcode 选中 target → **Signing & Capabilities** 选你的 Apple ID → 接真机 → `⌘R`。
（相机/LiDAR 必须真机；模拟器会显示「设备不支持」。新手逐步教程见 [docs/SHIP_CHECKLIST.md](docs/SHIP_CHECKLIST.md)。）

### 后端（自托管，开箱即跑）

```sh
cd server
npm install
ADMIN_USERNAME=root ADMIN_PASSWORD=你的强密码 npm run dev   # http://localhost:8787
curl http://localhost:8787/health        # → {"status":"ok",...}
```

Docker 部署、TURN、APNs 推送等运维步骤见 [docs/SETUP_AND_HANDOFF.md](docs/SETUP_AND_HANDOFF.md)。

---

## 🧪 测试与质量

```sh
swift test --package-path Packages/BeeUrEiCore   # 核心安全逻辑：303 测试
xcodebuild test -scheme BeeUrEi ...              # 应用层回归：72 测试（模拟器）
cd server && npm test                            # 后端：164 测试
```

- **539 个测试全部通过**，GitHub Actions 每次推送自动复验；后端 `tsc` 类型检查干净。
- 经**多轮多智能体对抗式代码审查**，累计修复 130+ 个真实缺陷（含信令窃听、避障距离/方向错算、深色地面落差误报、到达判定绕过精度门控、磁干扰信标指错、中断后空间音永久失声、语音通道互相淹没等）并全部补齐回归测试。
- **三大安全子系统都有专属回归网**：通话隐私门控（新对端默认不发画面/远程控制最小权限）、避障安全纪律（暂停即静默/缺深度即降级）、导航安全门控（差精度不入轨/不误报到达）。
- 安全攸关的数学/门控全部下沉到核心包并单测——无需模拟器即可在本机秒级验证。

---

## ♿ 无障碍与安全

- 全程 **VoiceOver** 可用；开启时语音自动改走无障碍公告，不与 VoiceOver 抢话；**Magic Tap** 直达高频操作。
- **一张嘴原则**：全局语音总线仲裁所有播报——避障警告永远优先，来电/导航/识别各安其位，**绝不重叠出声**；取景提示须连续稳定才开口，不打断正在播的识别结果。
- **分级降级**：LiDAR 跟踪不稳、设备过热、低电量、定位精度差时主动降级并告知；过热安全停机。
- **置信度透明**：识别拿不准时说「可能是X」，绝不说死。
- **免责告知**：首次完整知情同意（中英双语）+ 每次开始一句可关的简短提醒。
- 上线前需**真实视障用户**参与测试，并与定向行走（O&M）专家共定安全策略。

---

## 🔐 隐私

- 视觉 AI **全部端侧**：识别、找物、读文档、识币、人物检测——画面不上云。
- 「周围的人」只报**人数与方位**，不识别身份、不存人脸。
- 远程视频走 **P2P**；视障侧画面**默认不外发**，按住才显示；新对端接入自动回到不发送。
- 识别历史/商品库/教学物品三库**仅存本机** + 锁屏文件保护（completeFileProtection）。
- 通话**默认不录制**；如启用需双方知情同意。
- 自托管后端：账号与通话路由数据存在**你自己的服务器**上。

---

## 🗺 状态与路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| 核心安全逻辑 | 60+ 模块 / 303 测试 / 多轮对抗式审查 | ✅ |
| Phase 1 实时避障 | LiDAR 深度 + YOLO + 落差/红绿灯 + 空间音 | ✅（待真机调参）|
| Phase 2 步行导航 | 海外 MapKit + 信标 + 回程 + 环境感知 | ✅（待真机定位）· 国内图商需 key ⏳ |
| 场景识别全家桶 | 文字/整页/纸币/商品/找物/人/公交/光线/历史 | ✅（部分待真机验证）|
| 多语言 | 双端全链路中英双语（约 450 条文案 + 推送）| ✅（英文待母语者校对）|
| 自托管后端 | 账号/亲友/呼叫/信令/推送/管理 | ✅ 已部署 |
| Phase 3 远程视频 | 信令 + 隐私门控 + 来电铃/CallKit | ✅ · WebRTC 媒体需 SPM 包 + 双真机 ⏳ |
| Phase 4 打磨上架 | 真机实测 / 视障用户测试 / App Store | ⏳ 外部资源 |

详见 **[docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)**（当前真实状态与未完成项对照）。

---

## 📚 文档

- [docs/SETUP_AND_HANDOFF.md](docs/SETUP_AND_HANDOFF.md) — **落地与运维手册（新手向）**：管理员界面、真实视频/后台来电/TURN/国内导航/监控的逐步落地
- [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) — **项目状态与未完成项对照**（交接文档）
- [docs/SHIP_CHECKLIST.md](docs/SHIP_CHECKLIST.md) — **上架与真机落地清单**（从真机跑起来到 App Store 的每一步）
- [docs/PLAN.md](docs/PLAN.md) — 完整项目计划、架构、风险、分阶段路线图
- [docs/BACKEND_PLAN.md](docs/BACKEND_PLAN.md) — 后端 API / 数据模型 / 信令协议 / 视频隐私门控
- [docs/COMPETITIVE_STRATEGY.md](docs/COMPETITIVE_STRATEGY.md) — 竞品对标矩阵与差异化策略
- [server/README.md](server/README.md) — 后端运行与端点

---

## 🎨 品牌

蜂蜜黄 `#FFC42E` · 墨蓝 `#14161F`。完整图标 / 字标 / 配色见 [`BeeUrEi-Brand-Assets/`](BeeUrEi-Brand-Assets/)。

<p align="center">
  <img src="BeeUrEi-Brand-Assets/02-mark/beeurei-mark-color-512.png" width="96" alt="BeeUrEi mark">
</p>

---

## 🏢 组织与作者

- **隶属组织**：Hiko Sphere 彦穹科技
- **软件制作人**：Li Yanpei Hiko

## 📄 许可证

本项目以 **[GNU GPL-3.0](LICENSE)** 开源：你可以自由使用、学习、修改与分发，但**衍生作品必须同样开源**——这是一个为视障者而做的公益项目，我们希望任何基于它的改进都回到社区，而不是被闭源拿去向视障用户收费。

> 重要：本软件按「现状」提供，不附带任何明示或暗示的担保（详见 LICENSE 第 15/16 条）。它是辅助工具，**不能替代白手杖、导盲犬或定向行走训练**。

<p align="center">
  <sub>BeeUrEi — Be Your Eye 🐝 ｜ © 2026 Hiko Sphere 彦穹科技 · Li Yanpei Hiko ｜ GPL-3.0</sub>
</p>
