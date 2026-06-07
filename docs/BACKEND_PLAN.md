# BeeUrEi 后端与新功能 — 实现蓝本

> 自托管后端（`server/`，Node + TS + Fastify）。配套 iOS 新功能。决策见 [PLAN.md §14](PLAN.md)。
> ✅ = 已实现并测试；🚧 = 进行中/待办。

## 1. 架构

```
[iOS App] ──REST(HTTPS)──> [自托管后端: Fastify]
   │  账号/亲友/紧急/管理/录制配置        │ SQLite/JSON 持久化
   │                                      │
   ├──WebSocket(/ws) 信令 ───────────────┤ 交换 SDP/ICE、视频门控通知、匹配
   │                                      │
   └──P2P 媒体(WebRTC) ⇄ 对端  ←(直连失败)→ [自托管 TURN: coturn] 中继
```
- **媒体不过业务后端**：音视频走 P2P，仅直连失败时经自托管 TURN 中继 → 规避第三方按量 RTC 费（Q11）。
- 后端只做：账号、关系、信令、匹配、管理、录制策略。

## 2. 数据模型

✅ 已实现（`src/db/store.ts`，Store 接口 + 内存/JSON 文件实现）：
- `User { id, username, passwordHash, displayName, role, status, createdAt }`，role ∈ {blind, helper, family, admin, developer}
- `FamilyLink { id, ownerId, memberId, relation, isEmergency, createdAt }`

🚧 计划：`Call/Session`（呼叫记录）、`Report`（举报）、`Recording`（录制元数据 + 到期删除）、`RefreshToken`。
🚧 持久化升级：JSON 文件 → SQLite（接口已隔离，可平滑替换）。

## 3. REST API

✅ 已实现：

| 方法 | 路径 | 角色 | 说明 |
|---|---|---|---|
| GET | /health, /api/version | 公开 | 健康检查 |
| POST | /api/auth/register | 公开 | 注册（仅 blind/helper/family 可自助），返回 JWT |
| POST | /api/auth/login | 公开 | 登录，返回 JWT |
| GET | /api/me | 登录 | 当前用户资料 |
| POST | /api/family/links | 登录 | 按用户名绑定亲友（可标紧急） |
| GET | /api/family/links | 登录 | 我的亲友列表 |
| DELETE | /api/family/links/:id | 登录(本人) | 删除绑定 |
| POST | /api/emergency/trigger | 登录 | 返回按优先级排序的呼叫目标（紧急优先） |

🚧 计划：`/api/calls`（创建/结束呼叫、查历史）、`/api/admin/*`（列用户/封禁/解封/处理举报，admin）、`/api/reports`（举报）、`/api/recordings/*`（配置/列表/删除）、`/api/dev/*`（developer 测试端点）。

鉴权：✅ JWT（access，bcrypt 密码哈希，RBAC preHandler）。🚧 refresh token、速率限制。

## 4. WebSocket 信令（🚧 下一阶段）

路径 `/ws`，连接时带 JWT。消息（JSON）：
- `join {callId, role}` / `leave` — 加入/离开房间
- `offer {sdp}` / `answer {sdp}` / `ice {candidate}` — 标准 WebRTC 协商
- `video-gate {on: bool}` — 视障侧通知"画面已开/关"（见 §5）
- `end {reason}` — 结束
匹配：紧急/呼叫时后端按 `planEmergencyRoute`（✅ 已实现纯逻辑）选目标，向在线目标推送来电（配合 App 端 PushKit/CallKit）。

## 5. 视频隐私门控（核心）

1:1 P2P：
- **协助者**：不开摄像头；`send audio` + `recv video`。
- **视障侧**：摄像头开启但 **video track 默认 `enabled=false`（不输出画面）**，只 `send audio`。
- **开启画面**：视障用户**连续点击/长按隐私按钮**才把 video track `enabled=true` 发出（防误触、保护隐私），松开即关；通过 `video-gate` 信令告知协助者。
- 紧急/必要场景同此门控，避免无意中持续广播画面。

## 6. 紧急呼叫与匹配

✅ `planEmergencyRoute(links)`：紧急联系人优先 → 按添加时间。`/api/emergency/trigger` 返回有序目标。
🚧 接通：信令 + App PushKit/CallKit 唤醒目标；超时无人接 → 兜底（端侧 AI 提示 / 下一目标）。

## 7. 管理员与举报（🚧）

admin：列用户、封禁/解封（`status`）、处理举报。举报：通话后一键举报 → 进审核队列。

## 8. 录制与隐私合规（Q6，🚧）

默认**不录制**。若启用：双方知情同意；紧急可按需录制留证；媒体**加密静态存储**、默认保留期到期**自动删除**、可配置；最小化访问 + 审计。隐私清单/权限文案、GDPR/EAA/中国个保法与无障碍国标合规；App Store 注意 UGC/安全审查。红线：未经同意不录、不长期留存、不向第三方泄露路人画面。

## 9. iOS 新功能任务（🚧）

- 账号登录 UI + token 存 Keychain
- 双角色通话界面（视障：一键求助 + 隐私门控视频"长按发画面"；协助者：看视频 + 对讲、无自身摄像头）
- 开发者模式叠层（**手动开启**，显示温度档/FPS/端到端延迟/跟踪状态）
- 红绿灯/过街识别（端侧 Core ML，接 Perception）
- AirPods 头部追踪（`CMHeadphoneMotionManager`）增强空间音方向，无耳机回退
- 导航/避障分别开关
- 录制知情同意 UI
- 可单测的纯逻辑（如门控状态机、匹配展示排序）下沉到核心包测试

## 10. 自托管部署

开发：`cd server && npm install && npm run dev`（默认 :8787）。
TURN：另起 coturn（生产）；开发可先用公共 STUN，P2P 直连测试。
持久化：JSON 文件（默认 `data/db.json`）→ 生产换 SQLite。

## 11. 分阶段实现顺序

1. ✅ 骨架（/health + 测试）
2. ✅ 账号 + 角色（JWT/bcrypt/RBAC）
3. ✅ 亲友绑定 + 紧急路由
4. 🚧 WebSocket 信令 + 房间/匹配
5. 🚧 管理员 + 举报
6. 🚧 录制配置 + 留存
7. 🚧 SQLite 持久化、refresh token、速率限制
8. 🚧 iOS：登录 → 通话 UI（隐私门控）→ 开发者叠层 → 红绿灯 → 头追踪 → 开关/同意
9. 🚧 真机端到端联调（App ↔ 自托管后端 ↔ TURN）
