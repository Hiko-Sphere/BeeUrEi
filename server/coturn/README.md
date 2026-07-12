# 自托管 TURN（coturn）——启用步骤与安全组要求

App/网页通话在双方都处于对称 NAT（蜂窝网络常见）时必须经 TURN 中继，否则 ICE 失败
（管理面板「通话中继失败」卡的 relay_unreachable 就是它）。

## 一次性启用步骤

1. 在宿主机（与 API 同机即可）：
   ```sh
   cd server/coturn
   TURN_SECRET=<与 server/.env 的 TURN_SECRET 完全一致> \
   TURN_EXTERNAL_IP=<EC2 公网 IP> \
   docker compose up -d
   ```
2. `server/.env` 设置（然后重建 api 容器）：
   ```
   TURN_URLS=turn:<EC2 公网 IP>:3478
   TURN_SECRET=<同上，必须与 coturn 完全一致>
   ```

## ⚠️ 安全组（Security Group）必须放行的入站端口

**只开 3478 是不够的**——3478 只是握手/分配端口；真正的媒体中继走独立的高位端口区间。
只开 3478 的症状极具迷惑性：TURN 分配成功、candidate 也有，但通话依旧单通/黑屏。

| 端口 | 协议 | 用途 |
|---|---|---|
| 3478 | **UDP + TCP** | STUN/TURN 握手与分配 |
| 49160–49200 | **UDP** | 媒体中继区间（对应 `turnserver.conf` 的 `min-port`/`max-port`） |

改动中继区间时，`turnserver.conf` 与安全组必须同步改。

## 验证

```sh
# 1) 凭据下发正常（登录后带 token 调用）：iceServers 里应出现 turn: 条目
curl -s -H "Authorization: Bearer <token>" https://beeurei-api.hikosphere.com/api/assist/turn

# 2) 端到端：两端分别用蜂窝网络（关 Wi-Fi）拨打——能接通即中继生效；
#    同时管理面板「通话中继失败」计数不再增长。
```

## 设计对照（勿改错）

- `use-auth-secret` + `--static-auth-secret`：与服务端 `assist/turnCredentials.ts` 的
  时限凭据（username=过期时间戳，credential=base64(HMAC-SHA1(username, secret))）是同一
  REST 约定——两边 secret 必须一字不差。
- `denied-peer-ip`（RFC1918 全段）：禁止经中继访问内网（防 SSRF/横向移动），**勿删**。
- `min-port/max-port` 区间约 40 个端口 ≈ 同时 ~20 路中继通话；扩容时两处同步调大。
