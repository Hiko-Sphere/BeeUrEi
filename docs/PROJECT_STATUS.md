<!-- BeeUrEi 项目交接状态 / 未完成项对照。隶属组织 Hiko Sphere 彦穹科技 · 软件制作人 Li Yanpei Hiko。
本文件是「当前真实状态 + 对照 docs/BACKLOG.md 与 docs/PLAN.md 的未完成项清单」，供新会话直接接续。 -->

# BeeUrEi 项目状态与未完成项对照（交接文档）

> **快照**：核心 233 + 后端 158 = **391 单元测试全过** · 后端行覆盖率 **91.2%**（funcs 87.2%）· 累计修复 **119 个真实缺陷** · 后端已部署
> `beeurei-api.hikosphere.com`（健康）· iOS 构建通过（含品牌启动屏 + App 图标）· CI 绿。
> 详细上架步骤见 [`docs/SHIP_CHECKLIST.md`](SHIP_CHECKLIST.md)；总计划见 [`docs/BACKLOG.md`](BACKLOG.md)。

---

## ✅ 已完成（在控、已交付）

- **三大安全子系统**（均经多视角对抗式深审 → 修复 → 防回归 → 修回归闭环）：
  - 避障：地面落差/台阶检测、轻量跟踪+TTC+风险排序、红绿灯颜色识别、接近声呐、`.critical` 优先级
  - 导航：空间音信标、偏航重规划、**定位精度门控**（差精度绝不下"过马路/转向"）、几何"越过波谷"步进推进（核心 `WaypointAdvance` 已测）
  - 反馈输出：语音/空间音/震动/协调器、**AVAudioSession 配置**（无视静音开关、中断后恢复）、Haptic 引擎自愈；**AirPods 空间音信标升级为真正的双耳 HRTF 渲染**（此前默认仅左右声像）+ 头部偏航零位标定（`HeadYawReference`，消除开机偏置/断连跳变）
- **远程协助**：信令/会合/隐私门控（按住才发画面）/举报/presence 智能匹配/**亲友绑定双向同意**（pending→accepted，杜绝单向绑定探测在线/强推来电）
- **账号后端安全**：JWT/RBAC、refresh 轮换、改密、删号；**封禁/改密令牌实时失效（tokenVersion）、登录/注册/refresh 专用限流、WS join 参与权校验、用户名大小写归一化、绑定去重/上限、心跳 seq 夹取**（后端安全深审 8/9 已部署+生产验证）
- **无障碍**：VoiceOver 协作、首启语音教程、触觉分级、安静模式/播报详略、高对比大字状态条
- **工程**：GitHub Actions CI、PrivacyInfo 隐私清单、**品牌启动界面（LaunchScreen.storyboard）+ App 图标（AppIcon 全尺寸）**、自托管后端 Docker 部署
- **测试**：核心 233（含安全危险判定边界用例 + AirPods 空间音核心 + 感知性能基准）+ 后端 158（含安全锁定测试 + APNs/高德/监控覆盖）= 391 全过

---

## ❌ 未完成项（对照 BACKLOG，按可行性分类）

### 🌐 一、外部资源阻塞（软件已就绪，只差你提供资源后"接上"）— 最大一块

| BACKLOG | 缺口 | 需要你提供 | 优先级 |
|---|---|---|---|
| A1 | 后台/锁屏**真实来电响铃**（PushKit+CallKit+APNs） | **Apple 开发者账号**（VoIP 推送证书） | P0 |
| A2 | **真实音视频打通**（WebRTC 媒体引擎已写好，#if 守卫） | Xcode 加 `stasel/WebRTC` 包 + **两台真机** | P0 |
| A3 | **跨网络接通**（coturn TURN，配置已备） | 开 AWS 安全组 UDP 端口起 coturn | P0 |
| A5 | 通话**实际录制**落地（元数据已有） | 对象存储 + 加密（且依赖 A2） | P2 |
| B5 | **检测更多高危类别**（路桩/玻璃门/台阶等） | 标注街景数据集（我可写训练/转换脚本） | P1 |
| C1 | **国内实时逐向导航**（Web 服务已接） | 高德/百度 **iOS 导航 SDK** + key + 资质 | P1 |
| C2 | 室内/公交地铁/动态码/"最后十米" | 第三方 SDK（NaviLens/室内地图） | P2 |
| D1 | **邮箱验证/找回密码** | 邮件/短信服务商 | P1 |
| D3 / F2 | **监控告警 / 崩溃监控** | Sentry/Prometheus/Crashlytics | P0/P1 |
| G2 | **App Store 上架** | Apple 账号 + 截图/描述/审核 | P0 |
| H1 | 外接眼镜/耳机算力机 | 硬件 | P3 |

### 🟡 二、代码已就绪，需真机调参/验证（你拿到真机即可做）

| BACKLOG | 内容 |
|---|---|
| B1 | 动态 ROI 碰撞走廊真机调参 + ARKit 平面估真实地面高度（替换 1.2m 近似） |
| B2 | 红绿灯/过街可靠识别真机调参（白天判对率、绝不红判绿） |
| B3 | 视觉‑惯性世界系稳像接入 ARKit（`PinholeCamera` 已测，待接运行时） |
| B4 | 地面落差检测真机调参（阈值/误报率） |
| B6 | **真机性能实测**（发热/帧率/延迟/功耗，上架前必做，校准 Thermal/Power 降级阈值） |
| C3 | 海外 MapKit 导航真机定位实测 |
| E1 | **全量 VoiceOver 走查**（最好盲人用户参与） |

### ⚙️ 三、在控、可在新会话继续做（纯软件，无外部依赖）

> **这是新 session 可直接动手交付代码的清单。**

1. **E5 多语言 i18n**（P1，"出海硬门槛"）：UI + 播报文案全量本地化（String Catalog；核心播报文案需加本地化机制）。**工作量大、跨多文件、建议作为主线分多轮做**。
2. **F1 iOS 适配层单测**（P1）：HomeViewModel/CallViewModel/NavigationViewModel 等核心 VM 抽象依赖为协议后注入 mock 单测（已先行抽出 `WaypointAdvance` 范例）。
3. **E2 视觉无障碍**（P1）：Dynamic Type 放大不破版走查、减少动效尊重系统设置。
4. **D2 数据持久化升级**（P1）：实现 `PostgresStore`（Store 接口已隔离）+ 备份脚本（仍需数据库实例才能跑通，但代码可先写）。
5. **后端安全 #5**（剩余项）：录制元数据参与者校验——需先建**通话参与者持久化日志**（pendingCalls 是临时会合表，生命周期不匹配）；属较大设计变更，且录制实际功能依赖 A2，**优先级低**。
6. **#6 双向同意收尾**：iOS 已加接受 UI；可补 iOS 端"我发出的绑定请求/待对方接受"更完整的状态展示与单测。
7. **文档**：`docs/BACKLOG.md` 顶部统计（核心/后端测试数、审查轮次、缺陷数）已滞后，可更新为本文件的真实数字。

### 🔴 四、安全立即处理（G4，不需写代码）

- **重置高德 API key**：key 曾出现在对话中，请在高德开放平台后台重置，绑定服务白名单/域名，并确认新 key 只在 `server/.env`（已 gitignore，从未提交）。

---

## 🧭 新会话建议执行顺序

**若你已拿到 Apple 账号/真机** → 按 [`docs/SHIP_CHECKLIST.md`](SHIP_CHECKLIST.md) 阶段 0→7 推进（真机跑起来 → WebRTC 包 → 上架）。

**若仍要纯软件推进（无外部资源）** → 从上面「⚙️ 三」选：建议先 **E5 多语言 i18n**（竞品硬门槛、价值最高、完全在控），或 **F1 iOS VM 单测**（提升回归保护）。给新会话的话术示例：
> `/loop 继续按 BACKLOG，从 E5 多语言 i18n 开始：先搭本地化基础设施（String Catalog），再逐屏与播报文案本地化为英文，每轮交付可编译可测的增量`

---

## 📌 关键事实备忘（给新会话）
- **构建**：改 `project.yml` 或加核心源文件后必须 `xcodegen generate` 再 `xcodebuild`。后端测试需 `NODE_OPTIONS=--experimental-sqlite`。
- **部署**：`ssh awsjapan` → `cd ~/repo/BeeUrEi` → `git pull` → `docker build -t beeurei-api ./server` → 重建容器（`--env-file server/.env -v beeurei-data:/app/data -p 127.0.0.1:8787:8787`）。
- **教训**：后端改数据模型字段务必同步 `SqliteStore`（schema 列 + 迁移 + 读写），否则 MemoryStore 测试通过但**生产静默失效**（tokenVersion/绑定 status 都踩过）。改完务必生产 E2E 验证。
- **纪律**：安全/安全攸关代码改动后做防回归复核（本项目多次发现自引入回归）。
