<!-- BeeUrEi 上架与真机落地清单。隶属组织 Hiko Sphere 彦穹科技 · 软件制作人 Li Yanpei Hiko。
面向 iOS 新手：把"代码已就绪"→"真正上线"之间剩余的外部步骤写成可照做的清单。 -->

# BeeUrEi 上架与真机落地清单（一步步照做）

> 代码侧（端侧避障/视觉助手/导航/远程协助/账号后端）已完成并经**七轮多智能体对抗式审查**加固、
> **256 个测试全过**、后端已部署在 `beeurei-api.hikosphere.com`。本清单只列**需要你（人）去做、
> 代码无法自动完成**的外部步骤。按顺序做即可上线。每步标注：要什么、怎么做、做完怎么验证。

图例：⏱️=预计耗时 · 💰=花钱 · 🔑=需账号/密钥 · ✅=验证方法

---

## 阶段 0 · 真机跑起来（最先做，免费）

**目标**：把 App 装到自己的 iPhone 上，确认避障/视觉/导航能在真机跑。

1. **设备**：需带 **LiDAR** 的 iPhone（iPhone 12 Pro / 13 Pro / 14 Pro / 15 Pro / 16 Pro 及以上 Pro 机型，或 iPad Pro）。模拟器会显示"设备不支持"——避障必须真机。
2. **Xcode**：Mac 上装最新 Xcode（App Store 免费）。
3. **打开工程**：
   ```sh
   cd Project_BeeUrEi
   xcodegen generate      # 若改过 project.yml；首次 clone 后也跑一次
   open BeeUrEi.xcodeproj
   ```
4. **签名**：Xcode 选中 `BeeUrEi` target → **Signing & Capabilities** → Team 选你的 **Apple ID**（免费personal team 即可真机调试）。Bundle Identifier 改成你自己的（如 `com.你的名字.beeurei`）。
5. **接真机** → 顶部选你的设备 → `⌘R` 运行。首次会让你在 iPhone「设置 → 通用 → VPN与设备管理」信任开发者证书。
6. ✅ **验证**：App 启动 → 同意安全须知 → 登录/注册 → 进入避障首屏，相机预览出现、对着障碍物能听到中文播报（"X 点钟方向，…，约 X 米"）。点"看一看"测物体识别/朗读文字/识别颜色/扫码。点"步行导航"测海外 MapKit 路线。

> ⏱️ 1–2 小时（含 Xcode 下载）。💰 免费。

---

## 阶段 1 · Apple 开发者账号（上架前必须）🔑💰

**目标**：能上架 TestFlight / App Store，并启用推送等能力。

1. 注册 **Apple Developer Program**：<https://developer.apple.com/programs/> → 个人或公司（公司需邓白氏 D-U-N-S 编码）。💰 **$99/年**。⏱️ 审核 1–2 天（公司更久）。
2. 在 [App Store Connect](https://appstoreconnect.apple.com) 新建 App 记录，Bundle ID 与 Xcode 一致。
3. Xcode 的 Team 换成这个付费账号。
4. ✅ **验证**：Xcode `Product → Archive` 能成功归档并上传到 App Store Connect（出现在 TestFlight 里）。

---

## 阶段 2 · 远程视频真通（WebRTC）🔑

**目标**：让"呼叫帮手"真正传音视频（现在信令/会合/隐私门控/前台轮询接听已全部就绪并生产验证，只差真实媒体引擎）。

1. Xcode → **File → Add Package Dependencies** → 输入 `https://github.com/stasel/WebRTC` → 选最新版添加到 `BeeUrEi` target。
   - 代码里 `#if canImport(WebRTC)` 会自动启用真实引擎 `WebRTCMediaEngine`（无包时用 stub）。无需改代码。
2. 确认 `Info.plist` 有麦克风/相机用途说明（已配）。
3. **两台真机**：一台登录视障账号、一台登录协助者账号，互相绑为亲友。
4. 协助者端打开"协助者"页 → 打开"在线待命"（会开始每 3s 轮询）。视障端"一键求助" → 协助者端应弹出通话、看到视障端画面（视障端刻意开启画面时）、双向语音。
5. ✅ **验证**：双机能听到对方声音；协助者能看到视障端摄像头画面；挂断后双方回到主界面。
6. **TURN 中继**（NAT 穿透，跨网络必需）：见阶段 6 开 coturn UDP 端口。

> 注：后台来电响铃（App 没开着也能响）需阶段 5 的 APNs 推送；**前台**（两端 App 都开着）现在已能接通，无需推送。

---

## 阶段 3 · 国内步行导航（高德 iOS）🔑💰

**目标**：中国大陆实时逐向导航（海外 MapKit 已可用）。

1. 后端 Web 服务已接好（`server/.env` 里的 `AMAP_API_KEY`）。**国内实时逐向**还需高德 **iOS 定位/导航 SDK**。
2. 高德开放平台 <https://lbs.amap.com> 注册 → 创建应用 → 申请 iOS key（绑定你的 Bundle ID）。💰 有免费额度。
3. 按高德文档把 iOS SDK 加进工程，替换 `NavigationService` 国内分支的步骤读出为实时导航（接口已留好）。
4. ✅ **验证**：在国内真机选"中国大陆"导航到附近地点，能逐步语音播报转向。

> ⚠️ **安全红线**：定位精度差时**绝不**播"现在过马路"——核心 `RouteProgress`/`LocationAccuracyGate` 已强制此门控，接 SDK 时务必沿用。

---

## 阶段 4 · 检测模型升级（可选，提升避障）🔑

**目标**：识别更多"脚下/高危"类别（路桩、玻璃门、台阶边缘、共享单车等 COCO 没有的）。

1. 现用 Core ML/Vision YOLO（COCO-80）。要提升需**标注的街景/障碍数据集**训练自定义模型。
2. 用 Create ML / Roboflow 等训练 → 导出 `.mlmodel` → 放进工程，替换 `YOLOObstacleDetector` 的模型名。
3. ✅ **验证**：真机对常见高危障碍（路桩、玻璃门）能稳定识别并播报。

> 没有标注数据前，地面落差检测（纯 LiDAR 几何，已用置信度过滤防误报）仍能兜住部分"脚下"危险。

---

## 阶段 5 · 后台来电推送（APNs / PushKit）🔑

**目标**：协助者 App 没开着时也能响铃（真正的"来电"）。

1. App Store Connect / 开发者后台为 Bundle ID 开启 **Push Notifications** 能力，生成 **APNs 鉴权 key（.p8）**。
2. 后端补一个把 VoIP token 推给目标的服务（`RemoteAssistService` 的 PushKit 接收骨架已就绪：收到推送 → 进振铃状态机 → CallKit 来电 UI，已修复并测过）。
3. ✅ **验证**：协助者 App 杀掉后台，视障端求助 → 协助者手机弹出系统级来电界面、可接听。

---

## 阶段 6 · 服务器收尾（你已部署，几步收口）🔑

后端已在 `awsjapan` 上 Docker 运行、经 Cloudflare Tunnel 暴露为 `beeurei-api.hikosphere.com`（已验证 200）。剩余：

1. **TURN/UDP 端口**：在 AWS 安全组放行 coturn 的 UDP（3478 + 中继端口段），并起 coturn（`server/coturn/` 已备 `turnserver.conf`/`docker-compose.yml`）。✅ 跨蜂窝/不同 NAT 的两台真机能视频接通。
2. **密钥安全**：`JWT_SECRET` 已要求必须配置（缺失即拒绝启动）；**高德 key 只在 `server/.env`（已 gitignore），切勿提交**。建议把当前 key **重置**一次（之前若曾出现在对话中）。
3. **邮件/短信服务**（可选）：接 SendGrid/阿里云短信做邮箱验证、找回密码。
4. **数据库**（可选，规模化）：现用 `node:sqlite`（够用）。要多实例水平扩展再换 Postgres + Redis（presence/会合登记表换 Redis）。
5. **监控**（可选）：接 Sentry/Uptime 监控 `/health` 与错误率。

---

## 阶段 7 · 合规与真实用户测试（上架前，最重要）

1. **隐私清单**：`PrivacyInfo.xcprivacy` 已配；按最终用到的 API 核对一遍。App Store 隐私问卷如实填（端侧推理、不上传画面）。
2. **真实视障用户测试** + 与**定向行走（O&M）专家**共定安全策略——这是安全攸关 App 上架前不可省略的一步。
3. **安全免责**：首屏/定期完整知情同意 + 每次开始简短提醒已就绪；文案与律师/O&M 专家确认。
4. **TestFlight 公测** → 收集反馈 → 迭代 → 提交 App Store 审核（无障碍类通常顺利，但要写清"辅助而非替代"）。

---

## 一句话进度

| 模块 | 代码 | 还需你做 |
|---|---|---|
| 端侧避障 / 视觉助手 / 海外导航 | ✅ 完成+测试 | 真机调参（阶段0） |
| 自托管后端（账号/亲友/紧急/会合/信令/管理/录制） | ✅ 完成+部署+测试 | 阶段6 收口 |
| 远程协助（信令/会合/隐私门控/前台接听） | ✅ 完成+生产验证 | 加 WebRTC 包（阶段2）+ 推送（阶段5） |
| 国内实时导航 | ✅ Web 服务就绪 | 高德 iOS SDK（阶段3） |
| 上架 | — | Apple 账号 + 真实用户测试（阶段1/7） |

> **结论**：软件本体已是经深度审查、可上线水准的完整产品。上线只差上述**外部账号/SDK/真机/合规**步骤——按本清单逐项完成即可。
