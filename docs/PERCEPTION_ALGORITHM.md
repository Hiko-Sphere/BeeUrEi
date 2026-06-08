<!-- 由多智能体调研+设计工作流生成（视觉-惯性稳像/MOT/TTC/动态ROI/音频反馈论文综述）。隶属组织 Hiko Sphere 彦穹科技 · Li Yanpei Hiko -->

# BeeUrEi 端侧感知算法规格 v1.0

> 面向视障实时避障/导航的顶尖端侧感知算法。目标平台 iOS（ARKit + LiDAR sceneDepth + VIO + CoreMotion + AirPods 头朝向）。
> 核心设计原则:**把"在抖动相机系里测方位"升级为"在 ARKit 重力对齐世界系里测方位 + 世界系 track 级时间稳定化 + TTC 风险排序 + 承诺式不打断播报"**,一次性解决动态 ROI、抖动闪烁、稳定跟踪、最优播报四个痛点。

---

## 0. 平台无关 / iOS 适配 分层总览

本规格严格区分两层,以便把纯逻辑下沉到可单测的 Swift 核心包 `BeeUrEiCore`(无 UIKit/ARKit 依赖),把硬件适配留在 App 层。

| 层 | 内容 | 依赖 | 可单测 |
|---|---|---|---|
| **Pure Core (`BeeUrEiCore`)** | 走廊几何与投影数学、3D inside 门控、世界系 bearing/range 计算、α-β/1D KF 平滑、两阶段数据关联、track 生命周期状态机、TTC/risk 打分、播报仲裁/throttle/hysteresis、模板渲染 | 仅 `simd`、Foundation | ✅ 全部 |
| **iOS Adapter (App)** | ARKit `ARFrame`(transform/intrinsics/sceneDepth/confidenceMap/trackingState)、CoreMotion(gravity/步速)、`ARPlaneAnchor`、`AVSpeechSynthesizer`、`AVAudioEnvironmentNode`、`CMHeadphoneMotionManager` | ARKit/CoreMotion/AVFoundation | ⚠️ 集成测试 |

**约定:** 所有几何量在 ARKit `worldAlignment = .gravity` 世界系下表达,Y 轴 = 重力反向(向上),(X, Z) = 水平面。核心包接收的是已经从 `ARFrame` 抽取出的**纯值类型**(下文 `SensorSnapshot`),不持有任何 ARKit 对象。

---

## 1. 总体管线图

```
                          ┌─────────────────────── iOS Adapter (App 层) ───────────────────────┐
传感器                     │                                                                     │
  ├ ARFrame ──────────────┤ camera.transform (T_cw, VIO 位姿)                                   │
  │  ├ sceneDepth.depthMap │ camera.intrinsics (K)                                               │
  │  ├ confidenceMap       │ capturedImage ──► YOLO (Core ML / Neural Engine, ~10fps)            │
  │  └ trackingState       │ sceneDepth + confidenceMap                                          │
  ├ CoreMotion ───────────┤ deviceMotion.gravity, 步速 v                                         │
  └ AirPods ──────────────┤ CMHeadphoneMotionManager (头部 yaw, 仅用于空间音渲染)                │
                          └────────────┬────────────────────────────────────────────────────────┘
                                       │ 打包成 SensorSnapshot (纯值)
                                       ▼
╔══════════════════════════════ Pure Core (BeeUrEiCore, 可单测) ══════════════════════════════╗
║                                                                                              ║
║  [A] 稳像/Ego-motion 补偿        把 2D 检测 + 深度 反投影到世界系 P_world (§3)                  ║
║         ↓  (只取水平 x,z 分量 → 天然滤俯仰手抖; TrackingGate 门控 .limited 冻结)               ║
║  [B] 动态 ROI / 碰撞走廊         世界系 3D 走廊 → 投影成楔形 image ROI + 3D inside 门控 (§2)    ║
║         ↓  (YOLO 只在 ROI crop 上跑; 走廊内深度点剔除墙/天花板)                                ║
║  [C] 检测 (YOLO 输出, 含低分框)  high/low 两档框传入关联                                        ║
║         ↓                                                                                     ║
║  [D] 轻量跟踪 + 平滑             ByteTrack 式两阶段关联 + tentative/confirmed/lost 生命周期     ║
║         ↓  (α-β 平滑 bearing/distance; 低分框续命; ORU 重检重置; ID 保持) (§4)                 ║
║  [E] 风险 / TTC                  τ=-Z/(dZ/dt); risk = w_t·f(TTC)+w_d·g(d)+w_lat·走廊相关 (§5)  ║
║         ↓  (只对 confirmed track; per-track KF 估 dZ/dt)                                       ║
║  [F] 播报决策                    优先级队列 + hysteresis + 语义 key throttle + 承诺式不打断 (§6)║
║         ↓  (zone 分级 / barge-in 规则 / min-utterance guard / 模板渲染)                        ║
╚══════════════════════════════════════╤═══════════════════════════════════════════════════════╝
                                       │ FeedbackEvent (speech 文本 + 优先级 + 空间方位 + tempo)
                                       ▼
                          ┌─────────────────────── iOS Adapter (App 层) ───────────────────────┐
                          │ Speech (AVSpeechSynthesizer, 可调语速) ──┐                          │
                          │ Earcon/Proximity tempo (AVAudioEnvironmentNode, 世界固定信标) ──────┼──► 用户
                          │ Haptic (critical 冗余)                   │ AirPods yaw 反补偿       │
                          └─────────────────────────────────────────────────────────────────────┘
```

**数据流时序:** ARFrame 60fps(位姿/深度) + YOLO ~10fps(检测)。两次检测之间用 §3.2 旋转补帧把已知 track 方向 warp 到当前帧,保持方位平滑。

---

## 2. 动态 ROI 算法(碰撞走廊 Collision Corridor)

**目标:** 把固定中央 ROI 换成由 LiDAR 深度 + ARKit 位姿 + 重力定义的 **3D 碰撞走廊**,投影回图像得到动态楔形 ROI,再用 3D inside 门控剔除墙/天花板误报。

### 2.1 走廊定义(世界系,重力对齐)

走廊是一个沿用户前进方向的竖直长方体(walking-tube):

| 参数 | 含义 | 默认 |
|---|---|---|
| `W` | 走廊宽度 = 肩宽 + 余量 | 0.8 m |
| `H` | 走廊高度(地面→头顶) | 1.7 m |
| `h_min` | 地面剔除下限(忽略贴地噪声) | 0.05 m |
| `N` | 走廊纵深(前向),**随步速自适应** | 3.0 m(见 §2.3) |

走廊以用户脚下水平投影为原点,前向 `ĝ⊥`(相机 yaw 的水平投影,低通后的 heading),8 个角点:

```
P_i ∈ { x ∈ {−W/2, +W/2} } × { y ∈ {h_min, H} } × { z ∈ {0, N} }   (世界系)
```

### 2.2 投影成 image ROI + 逐像素 3D 门控

**(a) 3D → 像素(pinhole,世界→相机→图像):**
```
P_cam = R_cw · P_world + t_cw            // R_cw, t_cw 来自 T_cw = camera.transform 的逆
u = fx · X_cam / Z_cam + cx
v = fy · Y_cam / Z_cam + cy
```
ROI = 8 个投影点的**凸包**(近大远小 → 自然楔形/梯形,而非死矩形)。YOLO 只在该 ROI 的 crop 上跑。

**(b) 逐像素 inside 门控(反投影回 3D 验证):**
对 ROI 内每个深度像素 `(u,v,Z)`,反投影并判断是否真落在走廊体内:
```
X_world, Y_world, Z_world = unproject(u, v, Z, T_cw, K)
inside = (|X_world| ≤ W/2) ∧ (h_min ≤ Y_world ≤ H) ∧ (0 ≤ Z_world ≤ N)
```
只有 `inside` 的检测/深度点才视为威胁。这一步把"图像里在 ROI 但实际在旁边墙/天花板"的点剔除。

**关键洞察(抗手抖):** 走廊在**世界系是稳定的**,相机抖动只改 `R_cw`(投影位置抖),但 3D inside 判定稳定 → 障碍不会因抖动进出 ROI 而闪烁。

### 2.3 走廊纵深随步速自适应

```
N = clamp(v · t_react + v² / (2 · a_dec),  N_min, N_max)
```
`v`=步速(CoreMotion/VIO), `t_react`≈1.0 s, `a_dec`≈舒适减速度。走得快→走廊伸长(提前播报);站定→缩短(减少无关播报)。

### 2.4 退化与边界

| 退化情形 | 检测 | 处理 |
|---|---|---|
| 无可靠深度(LiDAR >5m 衰减 / 低 confidence) | `confidenceMap` 低 / depthMap 空洞 | 退到 §3.2 纯旋转补帧,用全帧固定中央 ROI 兜底,distance 标记不可信 |
| `trackingState == .limited` | TrackingGate 门控 | **冻结 ROI 更新**,沿用上一帧走廊,不重投影 |
| 地面平面缺失(ARPlaneAnchor 未就绪) | 无 `Y_ground` | 用 `Y_g≈0` + ground height continuity(帧间地面高度平滑)估地面 |
| 走廊投影出画(俯仰极端) | 凸包面积 < 阈值 | clamp ROI 到画面边界,标记部分可见 |
| 步速估计抖动 | v 方差大 | N 用 EMA 平滑,避免走廊"呼吸" |

> **分层:** §2.1–2.3 几何/投影/门控全部是 **Pure Core**(给定 `K, T_cw, depth` 即可算,纯 `simd`)。仅"从 `ARFrame` 抽 `depthMap/confidenceMap/transform`、`ARPlaneAnchor` 取地面高度"是 iOS Adapter。

---

## 3. 视觉-惯性稳像(Ego-motion 补偿)

**核心思想:** 手抖污染的是相机姿态 `R_cw(t)`,不是静止障碍物本身。解法不是像素级 EIS,而是把检测**抬升到 ARKit 重力对齐世界系**测方位。**不要自己写 homography warp 或互补滤波**——ARKit VIO 已经把视觉+CoreMotion 融合好了。

### 3.1 反投影:2D 检测框 → 世界系 3D 点

设检测框中心像素 `(px,py)`,该处 LiDAR 鲁棒深度 `d`(框内 10th percentile,抗单点噪声),内参 `K`,位姿 `T_cw`:
```
// 像素 → 相机系射线
x_c = (px − cx) / fx
y_c = (py − cy) / fy
P_cam = d · [x_c, y_c, 1]              // 注意 ARKit 相机看 −z,按需取负

// 相机系 → 世界系(这一步消除手抖)
P_world = T_cw · [P_cam, 1]
```

**世界系方位(只取水平 x,z,丢弃重力轴 y → 天然滤俯仰抖):**
```
Δ        = P_world.xz − cam_pos.xz
bearing  = atan2(Δ.x, −Δ.z) − yaw_user        // 相对前进方向的水平角
clock    = round(bearing / (2π/12))           // 几点钟(12 桶)
range    = length(P_world − cam_pos)          // 米数
```
丢弃 y 轴等价于一次重力对齐投影,手抖中占比最大的 pitch(点头)抖动被天然滤掉。

### 3.2 纯旋转 ego-motion 补帧(无深度退路 / 60→10fps 补帧)

远处物体近似为方向向量,两次检测之间只用相对旋转把上帧方位搬到当前帧:
```
ΔR     = R_cw(t)ᵀ · R_cw(t−1)        // 取 transform 旋转块,成本几乎为零
dir_t  = ΔR · dir_{t−1}              // 只 warp 方向向量,不 warp 像素
```

### 3.3 参考系解耦(认知友好关键)

- **语义锚定用身体/前进方向**(相机水平 yaw 低通)→ "几点钟"语义稳定,转头不漂移。
- **AirPods 头朝向只用于空间音频渲染方向**(声源世界固定,转头反向补偿)。

### 3.4 TrackingGate 联动

当 `trackingState == .limited(.excessiveMotion / .relocalizing)`:世界位姿不可信 → **暂缓更新方位、维持上一稳定值**,而非用脏位姿算跳变方位。

> **分层:** §3.1–3.2 反投影/方位/旋转补帧数学是 **Pure Core**。`frame.camera.transform/intrinsics`、`deviceMotion.gravity`、`trackingState` 的提取是 iOS Adapter。**明确不做:** 自写像素级 EIS、自写互补滤波(CoreMotion `deviceMotion.gravity`/`attitude` 已融合更好)。

---

## 4. 轻量跟踪与平滑

**目标:** 把逐帧检测稳定成持久 track,消除闪烁、保 ID、跨漏检帧外推。方案 = **ByteTrack 式两阶段关联 + tentative/confirmed/lost 生命周期 + 逐 track α-β 平滑**。目标数为个位数,**不用** DeepSORT 外观 CNN(用 label+深度替代 ReID),**不用** 完整 7 维矩阵 KF(α-β/1D KF 足够)。

### 4.1 Track 状态(世界系,每障碍一条)

```
ObstacleTrack {
  id, label
  bearing, bearingRate           // α-β 平滑(横向角)
  distance, distanceRate         // α-β / 1D KF 平滑(米)
  hits, missCount
  state ∈ {tentative, confirmed, lost}
  lastObservation                // 给 ORU 重置用
}
```

### 4.2 两阶段数据关联(ByteTrack,但用更廉价的 gating)

代价用 **|Δbearing| + λ·|Δdistance| + 类别一致性**(已有角度/米数,比 2D IoU 信息更强、更省):
```
1. 所有 track 用 α-β 预测到当前帧 (bearing += bearingRate·dt; distance += distanceRate·dt)
2. D_high = {score ≥ τ_high},  D_low = {τ_low ≤ score < τ_high}
3. 第一次关联: D_high ↔ 所有 track   (贪心最近邻, 目标少免 Hungarian)
4. 第二次关联: D_low  ↔ 未匹配 track  ← 低分框只"续命"已有 track,不新建
5. 仍未匹配 track → lost(保留 release 帧,继续外推)
6. 新 track 只从未匹配高分框初始化 (score > τ_init)
```
**这一步直接解决"手抖那帧 YOLO 置信度掉到阈值下 → 轨迹断 → 播报被打断"。**

### 4.3 平滑与外推(逐 track α-β)

```
// 1D 距离平滑(方向同理)
预测:  x̂ = x + v·dt           // dt 用 ARFrame 时间戳实测,不写死(ARKit 帧率不稳)
       v̂ = v
残差:  r  = z − x̂             // z = 本帧 LiDAR 距离观测
更新:  x  = x̂ + α·r
       v  = v̂ + (β/dt)·r
```
观测噪声随 `ARConfidenceLevel` 自适应:低置信像素 → 少信本帧(等效调大 R / 调小 α)。

### 4.4 ORU 重检重置(借 OC-SORT,安全优先)

track 丢失超过 ~3 帧后又被检测到 → **直接用新观测硬重置 distance,不信恒速外推**(避免"幻觉距离"误导用户;宁可重报一次)。

### 4.5 生命周期 + ID 保持

```
tentative → confirmed:  M-of-N,连续 min_hits 帧命中(只有 confirmed 才允许播报 ← "把话说完"的根)
confirmed → lost:       连续 miss > release 帧(release ≈ 1 秒,按帧率换算)
lost → confirmed:       release 期内重新匹配 → 恢复同 id(ID 保持)
lost → delete:          超过 release 仍 miss
```
与 TrackingGate 联动:`.limited(excessiveMotion)` 时调大 release、暂停"切目标"。

> **分层:** §4 全部是 **Pure Core**(纯状态机 + 标量滤波,与现有 `ObstacleStabilizerTests` 同风格可单测)。仅"`dt` 来自 `ARFrame.timestamp`、confidence 来自 `ARFrame`"是 iOS Adapter。

---

## 5. 风险与优先级(TTC + 距离 + 居中 + 高危类别)

**核心:** 按 **TTC(time-to-contact)而非单纯距离**排序威胁——3 米外快速逼近的人 > 1.5 米静止的墙。

### 5.1 TTC / looming

```
τ = − Z / (dZ/dt)            // Z=深度(m), dZ/dt=闭合速度(track KF 估,非逐帧差分)
L = − (dZ/dt) / Z = −1/τ     // looming 量,逼近为正,越大越紧迫(0 处连续,适合渐进紧迫度)
```
`dZ/dt` 用 §4.3 的 track 级 α-β/KF 估,**不用逐帧差分**(差分对抖动极敏感)。τ>0 且小 → 危险;τ<0(远离)→ 风险置 0。

### 5.2 自运动区分(可选,调播报语气)

用 VIO 位姿做帧间补偿:把上帧 3D 点用 `T_{t−1→t}` 投到当前帧得预测深度 `Ẑ`,与实测 `Z_t` 差 → 物体**独立运动分量**。区分"我走近静物"(平静)vs"动物冲我来"(急促)。盲人场景两者都计入碰撞风险,仅用于调语气。

### 5.3 综合 risk 打分(排序键)

```
risk = w_t · f(TTC) + w_d · g(distance) + w_lat · lateral + w_cls · classWeight
  f(TTC)   = 1 / max(TTC, ε)                  // TTC 越小风险越大,远离物置 0
  g(dist)  = clamp(d_safe / Z, 0, 1)          // 近距离兜底(慢速但极近也要管)
  lateral  = clamp(1 − |X_world| / (W/2), 0, 1)// 越居中(走廊中心线)越相关
  classWeight ∈ [1, 1.5]                       // 高危类别(车/楼梯/坠落边缘)加权
```

### 5.4 分级(对应生物 η 函数"临撞响应骤升")

| TTC | zone | 行为 |
|---|---|---|
| τ > 4 s | safe | 不报 |
| 2 ≤ τ ≤ 4 s | caution | 平静提示:方向 + 物体 + 米数 |
| τ < 2 s | danger | 急促警告:缩短语句、提高语速、earcon 抢占 |

**每轮只播 risk 最高的 top-1**,其余抑制/合并。

> **分层:** §5.1、5.3、5.4 全部 **Pure Core**(给定 Z、dZ/dt、X_world、label → 标量打分)。§5.2 自运动补偿需 `T_{t−1→t}`,矩阵运算在 Core,位姿提取在 Adapter。

---

## 6. 播报策略

**核心痛点:** "承诺式不打断把话说完" + 去抖 + 抗警报疲劳。分三类音频通道,把语音从过载中解放。

### 6.1 三通道分工

| 通道 | 承载 | 频率 | 延迟容忍 |
|---|---|---|---|
| **Speech (TTS)** | 转向、命名物体、危险语义 | 低(事件触发) | 中 |
| **Earcon / Proximity tempo** | 方向 + 距离(连续,倒车雷达式) | 高(0.3–1s) | 低(<500ms) |
| **Haptic** | critical 冗余确认 | 事件 | 低 |

**距离 → 声呐(不占语音通道):** proximity 用 tempo 编码,`interval = clamp(d · k, 0.1s, 1.2s)`(越近 beep 越密)。pitch 不单独用(区分力差),必须配 tempo/rhythm。方位用 binaural,声源世界固定,AirPods 转头反向补偿。

### 6.2 优先级队列(4 级)

```
critical (即将碰撞/坠落)  > turn (导航转向)  > proximity (避障距离)  > ambient (landmark)
```

### 6.3 承诺式不打断(解决"说不完")

```
submit(e):
  if e.priority > current.priority and not nearlyDone(current):   // 严格更高才抢占
      stopSpeaking(.immediate); play(e)
  elif idle:
      play(e)
  elif e.priority == current.priority:
      pending = e                  // 单深度队列,只留最新一条; didFinish 后播
  else:
      drop(e)                      // 低/同优先级不打断
```
- **严格更高优先级**才 barge-in(同级让当前句说完 ← "说不完"的根因修复)。
- **min-utterance guard:** 即便高优先级到来,若当前句剩余 <300ms,让它说完再播(避免半句被切的认知碎裂)。
- **单深度 pending:** 同级事件只保留最新一条,`didFinish` 后播,避免堆积陈旧播报。

### 6.4 简短模板 / 可调详略

避障播报固定 **5–7 词**:
```
template = "{label}, {clock} o'clock, {round(distance)} meters"   // "Person, 2 o'clock, 3 meters"
```
- 距离给**米数**(实证优于"近/远");方向用 **clock position**(盲人社群惯例)。
- danger zone 进一步缩短(省 label 修饰词)、提高语速。
- 详略可调:simple(物体+方向)/ full(物体+方向+米数)。

### 6.5 可调语速

`AVSpeechUtterance.rate` 默认 0.55,Settings 暴露 0.4–0.7(熟练盲人用户常偏快,可达 300+ wpm)。

### 6.6 去抖 + 抗警报疲劳

```
zone     = classify(distance)                       // hysteresis 双阈值
sem_key  = "\(label)|bucket(clock)|zone"            // 语义 key(滞回桶),非逐帧 key
announce 仅当: zone==danger ∨ track.isNew ∨ zoneChanged
            ∧ throttle.shouldAnnounce(sem_key, minGap[zone])
```
- **Hysteresis 双阈值:** 进入 danger `d<1.0m`,退出 `d>1.4m`(防边界反复触发)。
- **语义 key 滞回桶:** clock/distance 只在跨桶中心 + margin 才换桶,基于 stable track-id 生成,对手抖鲁棒(直接修"手抖 → clock 跳变 → 反复播报")。
- **变化量播报:** 物体 3m→1m 才再播,静止不变不重复念。
- **留白原则:** 不塞满听觉通道,给用户留时间听真实环境声(交通/回声定位)。
- per-zone min-gap: danger=1.5s,其他=3.0s,可叠加"同物体冷却"。

### 6.7 打断规则汇总

| 来者优先级 vs 当前 | 当前剩余 | 动作 |
|---|---|---|
| 严格更高 | >300ms | 立即 barge-in(`.immediate`) |
| 严格更高 | <300ms | min-guard,让当前说完再播 |
| 相同 | — | 入单深度 pending,didFinish 后播(留最新) |
| 更低 | — | drop |
| VoiceOver 开启 | — | 走 `UIAccessibility.post(.announcement)`,critical 用 `.high` priority 减少截断 |

### 6.8 Latency 预算

感知帧 → 出声 `<500ms`。critical 用**预渲染 earcon**(零合成延迟),语义语音随后补。

> **分层:** §6.2–6.4、6.6、6.7 仲裁/throttle/hysteresis/模板渲染全部 **Pure Core**。§6.1 音频合成(AVSpeechSynthesizer/AVAudioEnvironmentNode/CMHeadphoneMotionManager/Haptic)、§6.5 rate 应用、VoiceOver 是 iOS Adapter。

---

## 7. 参数与默认值表

### 7.1 走廊 / ROI(§2)

| 参数 | 默认 | 说明 |
|---|---|---|
| `W` 走廊宽 | 0.8 m | 肩宽+余量 |
| `H` 走廊高 | 1.7 m | 地面→头顶 |
| `h_min` | 0.05 m | 贴地噪声剔除 |
| `N` 纵深 | 3.0 m(1.5–5.0 自适应) | `v·t_react+v²/(2a_dec)` |
| `t_react` | 1.0 s | 反应时间 |
| `a_dec` | 1.5 m/s² | 舒适减速度 |
| 地面阈值 `τ_g` | 0.05 m | gravity-aligned 地面带 |
| 障碍阈值 `τ_o` | 0.10–0.15 m | 高于地面判障碍 |
| 深度鲁棒分位 | 10th percentile | 框内取深度 |

### 7.2 跟踪 / 平滑(§4)

| 参数 | 默认 | 说明 |
|---|---|---|
| `α`(位置) | 0.5(0.4–0.6) | 盲人场景偏平滑,但别太小 |
| `β`(速度) | 0.1(0.05–0.15) | |
| `τ_high` | 0.5 | 高分框门(track_thresh) |
| `τ_low` | 0.1 | 低分框续命门 |
| `τ_init` | 0.6 | 新建 track 门 |
| `match_thresh` | gating: \|Δbearing\|<15° ∧ \|Δdist\|<0.5m | 关联门限 |
| `min_hits` | 2–3 | tentative→confirmed(M-of-N) |
| `release` (max_age) | ~1 s(10fps→8–10 帧) | confirmed→lost→delete |
| ORU 重置阈 | miss > 3 帧 | 重检硬重置距离 |

### 7.3 风险 / TTC(§5)

| 参数 | 默认 | 说明 |
|---|---|---|
| `w_t` (TTC) | 0.5 | risk 权重 |
| `w_d` (距离) | 0.2 | |
| `w_lat` (居中) | 0.2 | |
| `w_cls` (类别) | 0.1 | |
| `d_safe` | 1.0 m | 距离兜底参考 |
| `classWeight` | 1.0–1.5 | 车/楼梯/坠落=1.5 |
| `ε` | 0.1 s | f(TTC) 防除零 |
| τ safe / caution / danger | 4s / 2–4s / 2s | 分级阈值 |

### 7.4 播报(§6)

| 参数 | 默认 | 说明 |
|---|---|---|
| 语速 `rate` | 0.55(0.4–0.7) | AVSpeech,可调 |
| min-utterance guard | 300 ms | 半句保护窗 |
| danger 进入/退出 | 1.0m / 1.4m | hysteresis 双阈值 |
| min-gap danger | 1.5 s | per-zone throttle |
| min-gap 其他 | 3.0 s | |
| proximity tempo | `clamp(d·k, 0.1s, 1.2s)` | 倒车雷达式 |
| clock 桶滞回 margin | 0.5 桶 | 抗手抖换桶 |
| 模板长度 | 5–7 词 | |
| latency 预算 | <500 ms | 感知→出声 |

---

## 8. 可单测的纯逻辑清单(`BeeUrEiCore`,建议 Swift 签名)

> 全部无 ARKit/UIKit 依赖,输入纯值类型,确定性可单测。

### 8.1 几何 / 投影 / 稳像(§2、§3)

```swift
// 纯值传感快照(Adapter 从 ARFrame 填充)
struct SensorSnapshot {
    let timestamp: TimeInterval
    let intrinsics: simd_float3x3        // K
    let cameraTransform: simd_float4x4   // T_cw (camera→world, gravity-aligned)
    let yawUser: Float                   // 行进方向(相机水平 yaw 低通)
    let trackingLimited: Bool            // .limited?
}

enum WorldProjector {
    /// 2D 检测中心 + 深度 → 世界系 3D 点
    static func unproject(px: Float, py: Float, depth: Float,
                          intrinsics K: simd_float3x3,
                          transform T_cw: simd_float4x4) -> simd_float3

    /// 世界系点 → (bearing 相对行进方向, clock 几点钟, range 米)
    static func bearing(worldPoint p: simd_float3, camPos: simd_float3,
                        yawUser: Float) -> (bearing: Float, clock: Int, range: Float)

    /// 纯旋转补帧: 把方向向量 warp 到当前帧
    static func warpDirection(_ dir: simd_float3,
                              from R_prev: simd_float3x3,
                              to R_cur: simd_float3x3) -> simd_float3
}

struct CollisionCorridor {
    var width: Float; var height: Float; var hMin: Float; var depth: Float
    /// 8 角点(世界系)
    func corners(origin: simd_float3, heading: Float) -> [simd_float3]
    /// 投影成 image ROI 凸包(归一化坐标)
    func projectedROI(transform: simd_float4x4, intrinsics: simd_float3x3,
                      viewport: CGSize) -> [CGPoint]
    /// 逐点 3D inside 门控
    func contains(worldPoint p: simd_float3) -> Bool
    /// 纵深自适应
    static func adaptiveDepth(speed v: Float, tReact: Float, aDec: Float,
                              clampRange: ClosedRange<Float>) -> Float
}
```

### 8.2 平滑滤波(§4.3)

```swift
struct AlphaBetaFilter {
    var x: Double; var v: Double      // 位置, 速度
    let alpha: Double; let beta: Double
    mutating func predict(dt: Double)
    mutating func update(measurement z: Double, dt: Double)
    /// confidence 自适应: 低置信减小有效 alpha
    mutating func update(measurement z: Double, dt: Double, confidence: Double)
}
```

### 8.3 跟踪生命周期(§4)

```swift
enum TrackState { case tentative, confirmed, lost }

struct ObstacleTrack {
    let id: Int
    var label: String
    var bearing: AlphaBetaFilter
    var distance: AlphaBetaFilter
    var hits: Int; var missCount: Int
    var state: TrackState
    var lastObservation: Observation?
}

struct Observation {
    let label: String; let bearing: Double
    let distance: Double; let score: Double
}

final class ObstacleTracker {
    let config: TrackerConfig
    private(set) var tracks: [ObstacleTrack]

    /// 一帧更新: 两阶段关联 + 平滑 + 生命周期 + ORU
    func update(detections: [Observation], dt: Double,
                trackingLimited: Bool) -> [ObstacleTrack]   // 返回 confirmed

    // 内部可测单元:
    func associate(_ dets: [Observation], to tracks: [ObstacleTrack],
                   gate: AssociationGate) -> [(Int, Int)]    // (trackIdx, detIdx)
    func gateCost(_ a: ObstacleTrack, _ b: Observation) -> Double?  // nil=门外
}

struct TrackerConfig {
    var tauHigh, tauLow, tauInit: Double
    var minHits: Int; var releaseFrames: Int
    var oruResetMiss: Int
    var bearingGateDeg: Double; var distanceGateM: Double
}
```

### 8.4 风险 / TTC(§5)

```swift
enum RiskZone { case safe, caution, danger }

enum RiskScorer {
    /// τ = -Z/(dZ/dt)
    static func ttc(distance Z: Double, closingRate dZdt: Double) -> Double?
    static func looming(distance Z: Double, closingRate dZdt: Double) -> Double

    static func risk(ttc: Double?, distance: Double, lateralX: Double,
                     corridorHalfWidth: Double, classWeight: Double,
                     weights: RiskWeights) -> Double

    static func zone(ttc: Double?, distance: Double, thresholds: ZoneThresholds) -> RiskZone

    /// 每帧选 top-1
    static func prioritize(_ tracks: [ScoredTrack]) -> ScoredTrack?
}

struct RiskWeights { var t, d, lat, cls: Double }
struct ZoneThresholds { var safeTTC, dangerTTC: Double }
```

### 8.5 播报仲裁 / throttle / 模板(§6)

```swift
enum FeedbackPriority: Int { case ambient, proximity, turn, critical }

struct FeedbackEvent {
    let speech: String
    let priority: FeedbackPriority
    let azimuth: Double          // 空间音方位
    let proximityTempo: Double?  // beep 间隔
}

struct Hysteresis {
    let enter: Double; let exit: Double   // enter < exit
    func zone(distance: Double, prev: RiskZone) -> RiskZone
}

final class AnnouncementThrottle {
    func shouldAnnounce(key: String, minGap: TimeInterval, now: TimeInterval) -> Bool
}

enum SpeechTemplate {
    /// "Person, 2 o'clock, 3 meters"
    static func render(label: String, clock: Int, distance: Double,
                       verbosity: Verbosity, zone: RiskZone) -> String
    enum Verbosity { case simple, full }
}

/// 承诺式不打断仲裁(纯逻辑,无 AVSpeech)
final class FeedbackArbiter {
    enum Decision { case play(FeedbackEvent), preempt(FeedbackEvent),
                    enqueue(FeedbackEvent), drop }
    func decide(incoming: FeedbackEvent, current: FeedbackEvent?,
                currentRemainingMs: Double, minGuardMs: Double) -> Decision

    /// 语义 key(滞回桶,抗手抖)
    static func semanticKey(label: String, clock: Int,
                            distanceBucket: Int, zone: RiskZone) -> String
}
```

### 8.6 建议测试覆盖

- `WorldProjectorTests`: pitch/roll 抖动下同一静止点的 bearing 不变(核心抗抖断言)。
- `CollisionCorridorTests`: 走廊角点投影凸包正确;墙/天花板点 `contains==false`;N 随 v 单调。
- `AlphaBetaFilterTests`: 阶跃响应、漏检外推、confidence 自适应。
- `ObstacleTrackerTests`: 低分框续命(高分缺失帧 track 不断);ID 保持(release 期内重匹配同 id);ORU 重检重置。
- `RiskScorerTests`: 远处快速逼近 risk > 近处静止;远离物 risk=0;top-1 选择。
- `FeedbackArbiterTests`: 同级不打断、严格更高才抢占、min-guard 半句保护、单深度 pending 留最新。
- `AnnouncementThrottleTests` + `HysteresisTests`: 边界抖动不反复触发、语义 key 滞回。

---

## 9. 引用的代表论文清单

**动态 ROI / 碰撞走廊**
- Li, B., Muñoz, J.P., Rong, X., Chen, Q., Xiao, J., Tian, Y., Arditi, A., Yousuf, M. (2018). *Vision-based Mobile Indoor Assistive Navigation Aid for Blind People.* IEEE TMC.(双投影 occupancy:水平=路径、垂直=避障,移动端 5Hz / VIO 100Hz)
- Bai, J., Liu, Z., Lin, Y., Li, Y., Lian, S., Liu, D. (2019). *Wearable Travel Aid for Environment Perception and Navigation of Visually Impaired People.* arXiv:1904.13037.(RGB-D+IMU,ground height continuity 帧间分地面,抗抖)
- Nasri, M. et al. (2023). *Polar Collision Grids: Effective Interaction Modelling for Pedestrian Trajectory Prediction.* arXiv:2308.06654.(极坐标碰撞网格 + TTC)
- Yang, K. et al. (2018). *Detecting Walkable Plane Areas by Using RGB-D Camera and Accelerometer for Visually Impaired People.*(加速度计重力对齐 walkable plane)
- Hu, Z. & Uchimura, K.; Labayrade et al. *U-V-Disparity 障碍/地面检测.*(走廊在深度域的经典等价)

**视觉-惯性稳像 / Ego-motion**
- Tian, Zhang, Yang et al. (2014). *Adaptive Ego-Motion Tracking Using Visual-Inertial Sensors for Wearable Blind Navigation.* ACM SenSys/Wireless Health.(盲人视觉惯性 ego-motion,与本项目几乎同构)
- Jia, C. & Evans, B. *Video Stabilization and Rectification for Handheld Cameras.* UT Austin PhD thesis.(gyro 手持稳像 + rolling-shutter,运动估计→平滑→补偿三段式)
- *Gyroscope-Based Video Stabilization.* Sensors 2021 (PMC8473288).(gyro→图像平面→homography warp 完整链路)
- Li et al. (2023). *GyroFlow+: Gyroscope-Guided Unsupervised Deep Homography and Optical Flow Learning.* arXiv:2301.10018.
- *Intelligent Head-Mounted Obstacle Avoidance Wearable for the Blind and Visually Impaired.* Sensors 2023 (PMC10708878).(头/身转动污染读数 → IMU 参考系稳定)
- Van Hunter Adams. *Complementary Filters.* Cornell 课程讲义。

**跟踪(MOT)**
- Bewley, A., Ge, Z., Ott, L., Ramos, F., Upcroft, B. (2016). *Simple Online and Realtime Tracking (SORT).* ICIP 2016.
- Wojke, N., Bewley, A., Paulus, D. (2017). *Simple Online and Realtime Tracking with a Deep Association Metric (Deep SORT).* ICIP 2017.
- Zhang, Y. et al. (2022). *ByteTrack: Multi-Object Tracking by Associating Every Detection Box.* ECCV 2022.(低分框续命,本项目抗闪烁核心)
- Cao, J., Pang, J., Weng, X., Khirodkar, R., Kitani, K. (2023). *Observation-Centric SORT (OC-SORT): Rethinking SORT for Robust MOT.* CVPR 2023.(ORU 重检重置)
- *Alpha-beta filter / alpha-beta-gamma filter.*(稳态 KF 退化为固定增益滤波,端侧友好)

**TTC / Looming / 风险**
- Yepes, J. & Raviv, D. (2022). *Estimation of Looming from LiDAR.* arXiv:2202.10972.(LiDAR 逐点 looming,6-DOF 自运动,无需点云配准,落地蓝本)
- Keil, M.S. & López-Moliner, J. (2012). *Unifying Time to Contact Estimation and Collision Avoidance across Species.* PLOS Comput Biol.(τ=θ/θ̇、η 函数,决定何时报警的生物时机)
- Urban & Caplier (2021). *Time- and Resource-Efficient TTC Forecasting for Indoor Pedestrian Obstacle Avoidance.* J. Imaging 7(4):61.(盲人智能眼镜 TTC 特征工程)
- NVIDIA (2021). *Binary TTC: A Temporal Geofence for Autonomous Navigation.* arXiv:2101.04777.
- (2024). *oTTC: Object Time-to-Contact for Motion Estimation in Autonomous Driving.* arXiv:2405.07698.(object-level TTC 管线,配 YOLO)

**音频反馈**
- Brewster, S., Wright, P., Edwards, A. (1995). *Experimentally Derived Guidelines for the Creation of Earcons.* HCI'95.(earcon 设计事实标准)
- Dingler, T. & Lindsay, J. et al. (2008). *Learnability of Sound Cues: Auditory Icons, Earcons, Spearcons, and Speech.* ICAD 2008.
- Microsoft Soundscape (2018, 开源 2022).(binaural audio beacon / ambient awareness 范式)
- *Sonification of Navigation Instructions for People with Visual Impairment.* Int. J. HCS, 2023.
- *Large-scale, Longitudinal, Hybrid Participatory Design Program for Blind Navigation Technology.* arXiv:2410.00192 (2024).(information overload 警示)
- Guerreiro, J. & Gonçalves, D. *Faster Text-to-Speeches: Enhancing Blind People's Information Scanning with Faster Concurrent Speech.*(盲人可用 350+ wpm 语速)

**Apple 官方 API(落地依据)**
- ARKit `ARConfiguration.WorldAlignment.gravity`、`ARCamera.transform / intrinsics / projectPoint / unprojectPoint`、`ARFrame.sceneDepth / smoothedSceneDepth / confidenceMap`、`ARPlaneAnchor`、`trackingState`。
- AVFoundation `AVSpeechSynthesizer / AVSpeechUtterance.rate`、`AVAudioEnvironmentNode`。
- CoreMotion `CMDeviceMotion.gravity / attitude`、`CMHeadphoneMotionManager`。
