# BeeUrEi 运维与交接文档

面向维护者/未来的你。涵盖：构建、部署、管理员、推送、TURN、通话、常见排查。
（产品/算法设计见 PLAN.md / BACKEND_PLAN.md；本文只讲“怎么跑、怎么修”。）

---

## 1. 总览

- **iOS App**（Swift/SwiftUI，XcodeGen 生成工程）：端侧避障 + 远程协助（WebRTC 音视频）。仅 iPhone + LiDAR。
- **后端**（Node/TypeScript/Fastify，`server/`）：账号/亲友/黑名单/匹配/信令(WS)/通话记录/推送。零原生依赖（`node:sqlite`、内置 crypto/http2）。
- **自托管部署**：EC2 `awsjapan`（公网 IP `52.197.233.88`，东京），Docker 容器 `beeurei-api`，Cloudflare Tunnel → `beeurei-api.hikosphere.com`。
- **TURN**：同机 coturn 容器 `beeurei-coturn`，跨网络视频中继。

---

## 2. 构建并运行 iOS

```bash
cd Project_BeeUrEi
xcodegen generate          # 改了 project.yml / 新增源文件后必须重跑
open BeeUrEi.xcodeproj      # 选真机（推送/相机/LiDAR 需真机）运行
```

- WebRTC 用**本地 vendored 框架** `Frameworks/WebRTC.xcframework`（已 gitignore，91MB，需本地存在；`scripts/fetch-webrtc.sh` 可重新下载）。装上即激活 `#if canImport(WebRTC)` 真实引擎。
- 推送/来电需 **付费 Apple 开发者账号**：工程已声明 `BeeUrEi/BeeUrEi.entitlements`（`aps-environment=development`）。Xcode 自动签名会据此为 App ID 开 Push 能力；若没自动开，在 Signing & Capabilities 手动加 “Push Notifications”。
- 新增 Swift 文件后**务必 `xcodegen generate`**（否则报 “cannot find X in scope”）。

---

## 3. 部署后端到 awsjapan

改了 `server/` 后：
```bash
ssh awsjapan 'cd ~/repo/BeeUrEi && git pull --ff-only origin main \
  && docker build -t beeurei-api:latest server/ \
  && docker stop beeurei-api && docker rm beeurei-api \
  && docker run -d --name beeurei-api --restart unless-stopped \
       -p 127.0.0.1:8787:8787 --env-file server/.env -v beeurei-data:/app/data \
       beeurei-api:latest \
  && sleep 4 && curl -s localhost:8787/api/ready'
```
- 数据库：`node:sqlite`，数据卷 `beeurei-data` → `/app/data/beeurei.db`。
- 环境变量：`server/.env`（**永不提交**）。公共 API 经 Cloudflare 暴露，注册等接口对非浏览器 UA 返回 403（正常）。
- 跑测试：`cd server && npm test`（当前 141 通过）；`npm run typecheck`。

---

## 4. 管理员入口

- 管理员账号 **`root`**（`role=admin`），经 `server/.env` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 引导（启动时若不存在则创建）。
- 进入：App 登录页用 **root + 密码** 登录 → 进入页点「进入」→ **管理员界面**（用户列表 / 改角色 / 查举报）。
- 忘记密码：看 `server/.env` 的 `ADMIN_PASSWORD`；改了需重启容器。
- 也可由已有管理员给某账号改 `admin` 角色（`/api/admin/...`）。

---

## 5. 账号 / 昵称 / 头像

- **用户名(username)**：唯一登录标识，注册时查重，不可改。
- **昵称(displayName)**：可改、可重复；通话/CallKit/来电/列表都显示昵称。账号页「修改」。
- **头像**：账号页用相册选图 → 自动压到 256px JPEG → 上传（≤600KB）。显示在联系人、求助队列、通话对端、来电。

---

## 6. 通话

- **盲人→协助者/亲友**、**协助者/亲友→盲人**（双向，后端按已接受绑定放行）。接收方通话角色由“自己的账号角色”决定（盲人=画面分享方，协助者=观看方），视频方向恒为盲人→协助者。
- **来电唤起**：VoIP 推送 → CallKit（后台/锁屏/前台都响）。前台时协助端也轮询 `/api/assist/incoming` 兜底。
- **横幅兜底**：除 VoIP 外再发一条 `X 来电` 提醒推送，万一 CallKit 没弹也有横幅可点开接听。
- **拒绝**：协助者未接听即挂断 = 拒绝 → 发起方界面显示「对方已拒绝」（红色 + 朗读）。
- **通话记录**：呼出 / 呼入 / 未接 / 已拒绝。账号页「通话记录」。后端每 (callId,callee) 一条，接听/拒绝后更新状态。
- **CallKit 头像限制**：iOS 公开 API **不支持**在系统来电界面显示任意来电人头像（只能放 App Logo）；来电人头像在**接听后的应用内通话界面**显示。

---

## 7. 推送（APNs）

- 一把 APNs Auth Key（`.p8`）兼发两类：**VoIP**（来电，topic `com.beeurei.BeeUrEi.voip`，push-type voip）与**普通提醒**（好友请求/有人求助/来电横幅，topic `com.beeurei.BeeUrEi`，push-type alert）。
- `.p8` 在服务器 `/app/data` 与项目根（均 gitignore）。`server/.env`：`APNS_KEY_PATH/APNS_KEY_ID/APNS_TEAM_ID/APNS_TOPIC/APNS_HOST`。
- **开发**：`aps-environment=development` + `APNS_HOST=api.sandbox.push.apple.com`。
- **上架 App Store**：entitlement 改 `production` + 服务器 `APNS_HOST=api.push.apple.com`，重新部署。
- 客户端 token：VoIP token 经 PushKit、普通 token 经 `application(didRegisterForRemoteNotifications)`，分别上报 `/api/push/register`、`/api/push/apns-register`。
- 自测 token 是否可达：给某用户的 token 发一条 VoIP push，APNs 返回 `200` 即投递成功（`BadDeviceToken`=环境不符/token 失效）。

---

## 8. TURN（跨网络视频）

- coturn 容器 `beeurei-coturn`（host 网络），配置 `server/coturn/`。`TURN_SECRET` 与后端 `server/.env` 一致，`TURN_EXTERNAL_IP=52.197.233.88`。
- **AWS 安全组必须放行**（这步只能在 AWS 控制台做）：入站 `UDP 3478`、`TCP 3478`、`UDP 49160-49200`，来源 `0.0.0.0/0`。
- 后端 `/api/assist/turn` 用同一 secret 签发短期 HMAC 凭据下发给客户端。
- 验证连通：本机对 `52.197.233.88:3478` 做 STUN/TURN Allocate；成功会拿到 `…:491xx` 中继地址。

---

## 9. 关系：双向加好友 / 黑名单

- **双向加好友**：任一方按用户名发起请求 → **另一方确认**才建立。`owner` 恒为视障侧（保证匹配/紧急 `linksByOwner(blind)` 成立）。通话中也可「加为亲友/协助者」。
- **黑名单**：拉黑后双方互不出现在匹配/公开求助队列/随机匹配/来电；账号页「黑名单」管理。

---

## 10. 关键接口速查

| 用途 | 接口 |
|---|---|
| 注册/登录/我 | `POST /api/auth/{register,login}` `GET /api/me` |
| 昵称/头像 | `POST /api/account/{profile,avatar}` |
| 加好友(双向) | `POST /api/family/links`(username/userId) `…/:id/accept` `GET /api/family/{links,incoming}` |
| 黑名单 | `POST/GET /api/blocks` `DELETE /api/blocks/:id` |
| 定向呼叫 | `POST /api/assist/call` `…/cancel` `…/decline` `…/answered` `GET …/call/status` |
| 通话记录 | `GET /api/calls` |
| 来电轮询 | `GET /api/assist/incoming` |
| 公开求助 | `POST /api/assist/help/{request,claim,match,cancel}` `GET …/queue` |
| 匹配/在线 | `POST /api/assist/{match,heartbeat}` |
| TURN | `GET /api/assist/turn` |
| 推送注册 | `POST /api/push/register`(VoIP) `POST /api/push/apns-register`(提醒) |
| 信令 | `WS /ws?token=…`（join/offer/answer/ice/video-gate/end） |

---

## 11. 故障排查

- **来电不响（无 CallKit）**：① 真机 + 付费账号 + 重装含 entitlement 的新版本并重新登录（拿有效 token）；② 看后端日志 `docker logs beeurei-api | grep '\[call\] dispatch'`，确认 `voip=[1]`；③ 直接给该 token 发 VoIP push 看 APNs 是否 200。
- **视频有但无声**：已修（通话经 `RTCAudioSession` 切 `.playAndRecord`）。若复发查 AudioSessionManager 是否在通话期间被改回 `.playback`。
- **协助者看不到画面**：界面会显示真实媒体状态——「媒体连接失败」=网络/TURN（确认同 WiFi 或安全组已放行）；「等待对方点显示画面」=让盲人按分享；「正在显示对方画面」=成功。
- **跨网络无画面**：必是 TURN——确认 AWS 安全组三条端口已放行（见 §8）。

---

## 12. 已知限制

- CallKit 系统来电界面不能显示任意来电人头像（iOS 限制）；头像在应用内通话界面显示。
- 免费 Apple 账号无法使用任何推送（VoIP/提醒）；必须付费账号。
- 国内蜂窝偶发限制到境外 IP 的 UDP；已开 TCP 3478 兜底，极端情况可加 TLS(443) TURN（需证书）。

---

## 13. 上架前

见 `SHIP_CHECKLIST.md`。重点：APNs 切 production、`APNS_HOST` 切正式、entitlement 切 `production`、关闭明文 HTTP（ATS）、TURN 端口与密钥确认。
