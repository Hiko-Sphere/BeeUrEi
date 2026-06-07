# BeeUrEi 后端（自托管）

为 BeeUrEi App 提供：账号登录与角色、亲友绑定、紧急呼叫、WebRTC 信令、管理员、录制与留存。

> 设计蓝本见 [../docs/BACKEND_PLAN.md](../docs/BACKEND_PLAN.md)。

## 技术栈

Node.js + TypeScript + Fastify + WebSocket(信令) + SQLite + JWT/bcrypt。媒体走 P2P WebRTC，
信令与 TURN（coturn）自托管——**不依赖第三方按量 RTC 服务**。

## 本地运行（自托管）

```sh
cd server
npm install
npm run dev      # 启动开发服务器（默认 http://localhost:8787），改文件自动重启
# 或
npm start        # 启动一次
npm test         # 跑单元测试（用 fastify.inject，无需绑定端口）
npm run typecheck
```

健康检查：`curl http://localhost:8787/health` → `{"status":"ok",...}`

## 状态（24 个测试全过）

- [x] 骨架：Fastify + TS，`/health`、`/api/version`
- [x] 账号与角色（注册/登录 JWT、bcrypt、RBAC、`/api/me`）
- [x] 亲友绑定 + 紧急呼叫路由（`/api/family/*`、`/api/emergency/trigger`）
- [x] WebRTC 信令（WebSocket `/ws`）+ 房间/匹配 + 视频门控消息
- [x] 管理员端点（列用户/封禁解封/举报处理）+ 举报提交
- [x] 录制配置 + 留存策略（默认关 + 知情同意 + 到期自动删）
- [x] 开发者测试端点（developer 角色 `/api/dev/*`）
- [x] SQLite 持久化（`node:sqlite`，默认；`DB_DRIVER=json` 可切回 JSON 文件）
- [x] 速率限制（`@fastify/rate-limit`）
- [x] 管理员引导（环境变量 `ADMIN_USERNAME`/`ADMIN_PASSWORD`）
- [x] coturn（自托管 TURN）配置示例 `coturn.conf.example`
- [ ] 可选（留后）：refresh token 轮换

## 引导管理员

```sh
ADMIN_USERNAME=root ADMIN_PASSWORD=你的强密码 npm run dev
```

## TURN（音视频中继，P2P 直连失败时）

见 `coturn.conf.example`：`brew install coturn` → 填好 `external-ip`/账号 → `turnserver -c coturn.conf`。
