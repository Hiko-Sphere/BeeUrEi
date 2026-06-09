# BeeUrEi 落地与运维手册（新手向）

本文回答两类问题：①**怎么进入管理员界面** ②清单里 A1/A2/A3/C1/B5/D1/D3 这些"需要外部资源"的项**具体怎么落地**。
配套阅读：[PLAN.md](PLAN.md)、[BACKEND_PLAN.md](BACKEND_PLAN.md)。

---

## 0. 这次新增了什么（速览）

| 功能 | 在哪用 | 说明 |
|---|---|---|
| 协助者「待帮助队列」 | 协助端 →「帮助大家」 | 浏览陌生求助者（显示地点/语言/等待时长/求助内容），点「帮助 TA」直接接入 |
| 随机/偏好匹配 | 「帮助大家」→「随机匹配一位需要帮助的人」 | 按偏好语言匹配一位，**先看详情再决定是否帮助**，跳过则释放回队列 |
| 匹配偏好 | 「帮助大家」→「匹配偏好」 | 选优先语言、是否只接同语言 |
| 盲人「向志愿者求助」 | 盲人首屏「求助」→「向志愿者求助」 | 广播到公开队列，任意在线志愿者可接（陌生人帮你看），自动带上城市级地点+语言 |
| 协助者 + 亲友**合并** | 登录后 helper / family 都进同一「协助端」 | 一套界面同时具备「帮陌生人」和「帮我绑定的亲人」全部功能 |
| 真实视频 | 通话界面 | 见下 §A2（代码已就绪，需真机） |
| 找回密码 / 邮箱验证 | 登录页「忘记密码？」、账号页「绑定邮箱」 | 见下 §D1 |
| 监控指标 | 后端 `GET /metrics` | 见下 §D3 |

---

## 1. 如何进入管理员界面 ★

**没有单独的"管理员网址"。管理员就是一个 `role=admin` 的账号，用同一个 App 登录后自动进入管理员界面。**

管理员账号由**后端环境变量**引导创建（不能在 App 里自助注册）：

1. 在服务器的 `server/.env` 里设置（你部署时应已设过）：
   ```
   ADMIN_USERNAME=root
   ADMIN_PASSWORD=一个强密码
   ```
2. 重启后端（容器 `beeurei-api`）。启动时若该用户名不存在，会自动创建一个管理员账号；**已存在则不动**（不会覆盖密码）。
3. 打开 App → 登录页输入该**用户名/密码** → 登录后自动进入 `AdminHomeView`：用户管理（封禁/解封、**改角色**）、举报队列、录制策略。

> 忘了管理员密码？换一个新的 `ADMIN_USERNAME` 重启即可新建一个管理员；或给已有管理员账号绑定邮箱后走「忘记密码」。
> `developer` 角色登录后可在角色确认页选择以任意角色（含管理员）进入，方便自测。

本次新增：管理员可在用户列表里**给任意用户改角色**（晋升协助者/亲友/管理员等），后端 `POST /api/admin/users/:id/role`。

---

## A2. 真实视频音视频（代码已就绪，差两台真机）

视频"分享画面"之前看不到，根因是没装 WebRTC 包→运行到空实现。**现已接好**：

- `project.yml` 已加入 `stasel/WebRTC` 包（`from: 148.0.0`）与后台音频/voip 模式。
- `BeeUrEi/RemoteAssist/MediaEngine.swift` 的 `#if canImport(WebRTC)` 真实引擎已对着真正的 WebRTC SDK **编译通过**。

你要做的：
1. 在项目根目录运行 `xcodegen generate`（首次会从 GitHub 下载约百 MB 的 WebRTC 产物，需联网）。
2. 用 Xcode 打开 `BeeUrEi.xcodeproj`，连**真机**运行（签名见你的开发者账号）。
3. **两台真机**：一台登录视障账号发起求助/通话，一台登录协助者账号接听；视障侧点「显示画面给对方」，协助者侧即可看到画面。

注意：
- **stasel/WebRTC 的模拟器切片只含 arm64**。请用真机，或 Apple Silicon Mac 上的模拟器；Intel 模拟器会链接失败（CI 已固定为 arm64）。
- 同一局域网内两台真机用公共 STUN 即可直连；**跨网络**（一台 4G 一台 WiFi）需要 TURN，见 §A3。

---

## A1. 后台来电响铃（息屏唤起）— 代码已就绪，只差 Apple 凭据

目标：协助者/亲友 App 在**后台/锁屏**也能被求助来电唤醒响铃（像微信语音通话）。技术栈：PushKit（VoIP 推送）+ CallKit（系统来电界面）+ APNs。

**已完成（本次）：**
- iOS：`RemoteAssistService` 完整接好——PushKit 取 VoIP token 并上报后端、收到推送用 CallKit 拉起系统来电、接听后桥接到 `CallView` 自动加入对应 callId 房间、挂断结束 CallKit 通话。`project.yml` 已声明 `UIBackgroundModes: [audio, voip]`。
- 后端：`POST /api/push/register`（存 VoIP token）；定向呼叫 `/api/assist/call` 时自动向目标设备发 VoIP push（payload 带 callId+发起人名）；**零依赖 APNs 推送器**（`server/src/push/apns.ts`，Node 内置 `http2`+`crypto` 签 ES256，已单测）。未配 APNs 时自动降级为无推送（前台轮询仍可用）。

**你要做的（需付费 Apple 开发者账号）：**
1. **Apple 开发者后台**：App ID 打开 **Push Notifications**；Keys 新建 **APNs Auth Key**（下载 `.p8`，记 Key ID 与 Team ID）。
2. **Xcode**：Signing & Capabilities 给 App 添加 **Push Notifications** 与 **Background Modes → Voice over IP**（会生成 `.entitlements`，连你的开发团队签名）。
3. **后端 `server/.env`** 填（见 `.env.example`）：
   ```
   APNS_KEY_PATH=/绝对路径/AuthKey_XXXX.p8
   APNS_KEY_ID=10位KeyID
   APNS_TEAM_ID=10位TeamID
   APNS_TOPIC=com.beeurei.BeeUrEi.voip
   APNS_HOST=api.sandbox.push.apple.com   # 真机+开发签名用沙盒；上架后改 api.push.apple.com
   ```
   重启后端，日志出现「[apns] VoIP 推送已启用」即生效。

> 没配 APNs 时，现有"前台轮询会合"仍可用（App 在前台能接到来电），只是后台/锁屏不会响铃。验证需真机（模拟器不支持 PushKit/VoIP 推送）。

---

## A3. 跨网络接通（TURN）— 需开 AWS 安全组 + 跑 coturn

后端**签发短时效 TURN 凭据的逻辑已就绪**（`/api/assist/turn`，HMAC-SHA1），只差把 coturn 跑起来并放行端口：

1. 在 EC2（awsjapan）上用 `server/coturn/` 的配置启动 coturn（Docker 或系统服务），`static-auth-secret` 要与后端 `.env` 的 `TURN_SECRET` 一致。
2. **AWS 安全组**放行：`3478/udp`、`3478/tcp`，以及中继端口范围（如 `49152-65535/udp`）。
3. `server/.env` 设：
   ```
   TURN_URLS=turn:你的公网IP:3478
   TURN_SECRET=与coturn一致的密钥
   ```
4. 重启后端。App 通话前会自动从 `/api/assist/turn` 取到 TURN，跨网络即可接通。

---

## C1. 国内实时逐向导航 — 需高德/百度 iOS SDK + 资质

现状：高德 **Web 服务**已由后端接好（`/api/nav/walking`，key 仅后端持有）。要做**车机级实时逐向语音导航**，需集成图商的 **iOS 原生 SDK**：

1. 高德开放平台申请 **iOS 平台 key**（绑定 Bundle ID `com.beeurei.BeeUrEi`），完成相关资质/备案。
2. 在 `project.yml` 的 `packages`/`dependencies` 加入高德导航 SDK（或用 CocoaPods/手动 framework）。
3. 在 `BeeUrEi/Navigation/` 新增一个走高德 SDK 的导航服务，复用现有 `NavigationService` 抽象切换海外(MapKit)/国内(高德)。

> ⚠️ 安全：之前对话里出现过的高德 key 请到高德后台**重置**并设白名单（见 PROJECT_STATUS）。

---

## B5. 检测更多高危类别 — 需标注街景数据训练模型

现状：用 demo `yolo11n`（COCO 英文类别，已中文化播报）。要识别更多**高危类别**（如井盖缺失、台阶边缘、护栏缺口、电动车等）：

1. 采集/标注街景数据集（或用公开的城市街景数据）。
2. 用 Ultralytics 训练并导出 Core ML：`format=coreml, nms=True`（导出环境注意 `numpy==1.26.4`，否则 `.numpy()` 报错）。
3. 替换 `BeeUrEi/Models/YOLO.mlpackage`，并在 `Packages/BeeUrEiCore/.../HazardCatalog.swift` 补对应高危类别与加成。

---

## D1. 邮箱验证 / 找回密码（已实现，差邮件服务商）

后端流程**已完整实现并通过单测**：注册可带邮箱、设置/验证邮箱、忘记密码发码、凭码重置（重置后旧令牌全失效，不做用户枚举）。App 已有 UI：登录页「忘记密码？」、账号页「绑定邮箱」。

**默认无需任何外部服务即可用**：未配 SMTP 时，验证码会**打印到后端日志**（自托管下管理员可读）。要真正发到用户邮箱：

1. `cd server && npm i nodemailer`
2. `server/.env` 配置（示例见 `.env.example`）：
   ```
   SMTP_HOST=smtp.你的服务商.com
   SMTP_PORT=587
   SMTP_USER=...
   SMTP_PASS=...
   SMTP_FROM=BeeUrEi <no-reply@你的域名>
   ```
3. 重启后端。之后验证码/重置码会真实发信。

---

## D3 / F2. 监控告警 / 崩溃（已实现指标，Sentry 可选）

- **Prometheus 指标**（零依赖，已实现）：`GET /metrics` 暴露运行时长、按状态码族的请求计数、用户总数等。
  - 设 `METRICS_TOKEN` 后需 `Authorization: Bearer <token>` 才能抓取（生产建议设）。
  - 用 Prometheus 抓 `https://beeurei-api.hikosphere.com/metrics`，配 Grafana 看板。
- **崩溃/错误上报（Sentry，可选）**：进程级未捕获异常已兜底落日志。要接 Sentry：
  1. `cd server && npm i @sentry/node`
  2. `server/.env` 设 `SENTRY_DSN=...`（可选 `SENTRY_TRACES_SAMPLE_RATE`），重启即启用。
- **iOS 崩溃**：如需客户端崩溃监控，可在 Xcode 加 Sentry iOS SDK（另行集成）。

---

## 验证命令速查

```bash
# 后端：类型检查 + 全部单测
cd server && npm run typecheck && npm test

# 核心逻辑单测（Mac 本机）
swift test --package-path Packages/BeeUrEiCore

# iOS 编译（含 WebRTC，仅 arm64 模拟器）
xcodegen generate
xcodebuild -project BeeUrEi.xcodeproj -target BeeUrEi -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGNING_ALLOWED=NO build
```
