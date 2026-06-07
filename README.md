# BeeUrEi

用 iPhone 主摄像头 + LiDAR，为视障人士提供「实时避障 + 步行路线导航 + 远程明眼志愿者视频协助」三合一的原生 iOS App。所有 AI 推理在设备端完成。

> 完整设计见 **[docs/PLAN.md](docs/PLAN.md)**，调研依据见 **[docs/RESEARCH_NOTES.md](docs/RESEARCH_NOTES.md)**。工程任务清单与勾选状态见 PLAN.md **§13**。

## 立项决策（已固化）

- **仅适配带 LiDAR 的 iPhone**（iPhone 12 Pro 起）——避障只用 ARKit `sceneDepth`，运行时门控 + 不支持页。
- **发行地区：海外 + 中国大陆**——导航层地区抽象（海外 MapKit / 国内持牌图商，见 PLAN §5.6）。
- **远程协助：先做亲友名单定向呼叫**（CallKit/PushKit 骨架已就位）。
- **未来方向**：手机作为「算力机」，外接眼镜/耳机（相机+LiDAR）经 `FrameSource` 端口接入（见 PLAN §12）。
- 仅 iPhone（暂不支持 iPad）。

## 架构（端口-适配器）

```
Packages/BeeUrEiCore/   平台无关核心逻辑（仅 Foundation）——安全攸关，全部有单元测试
  ClockDirection / FeedbackArbiter / DepthSampler / ObstacleFusion / SpeechComposer
  LatencyBudget / LocationAccuracyGate / HeadingFilter / TrackingGate / ThermalPolicy
  RouteProviderSelector / RoutingFallback / RemoteAssistCall / DisclaimerPolicy

BeeUrEi/                iOS App（适配层，真机验证）
  App/                  入口
  Sensors/              FrameSource 端口 + SensorFrame；ExternalDeviceSource 占位（未来外接设备）
  Capture/              ARDepthCameraSource（ARKit+LiDAR）/ ARSessionPreviewView / DepthSampling
  Perception/           ObstacleDetecting（Core ML 检测，Week 2 接入）
  Feedback/             FeedbackCoordinator + 语音/震动/空间音 三个 FeedbackSink
  Navigation/           RouteGuiding + MapKitRouteGuide（海外）
  RemoteAssist/         RemoteAssistService（亲友名单 + CallKit/PushKit）
  Accessibility/        VoiceOver 协作工具
  Features/Home/        首屏：ARKit 预览 + 避障状态条（MVVM）
```

**Phase 1 避障闭环（已打通）**：ARKit LiDAR 深度 → 中央采样（`DepthSampling`）→ `DepthSampler` 分级（核心，已测）→ `SpeechComposer` 文案（核心，已测）→ `FeedbackCoordinator`（核心 `FeedbackArbiter` 仲裁）→ 语音 + 震动。

> 单一真相来源：核心逻辑源码同时被 `swift test`（Mac 本机跑单测）和 App 编译使用。

## 运行单元测试（无需模拟器，Mac 本机直接跑）

```sh
swift test --package-path Packages/BeeUrEiCore
```
当前：**54 个测试全部通过**，覆盖全部 14 个核心逻辑模块。

## 在真机运行 App（新手向）

> 相机/LiDAR **必须用真机**（且必须是带 LiDAR 的 iPhone Pro），模拟器没有摄像头/LiDAR。

1. **打开工程**：`open BeeUrEi.xcodeproj`
2. **设置签名**：选中工程 → TARGETS `BeeUrEi` → `Signing & Capabilities` → 勾 *Automatically manage signing* → `Team` 选你的 Apple ID（如 bundle id 冲突，把 `com.beeurei.BeeUrEi` 改成你自己的）。
3. **接真机**：连上带 LiDAR 的 iPhone（首次需「信任此电脑」并在 *设置 → 通用 → VPN 与设备管理* 信任开发者证书）。
4. **运行**：顶部选你的 iPhone，`Cmd+R`。
5. **预期**：授权相机后看到实时画面；把手机对准前方，底部状态条显示「正前方约 X.X 米」，靠近障碍时语音/震动提示；跟踪不稳时显示降级提示。非 LiDAR 设备会显示「设备不支持」。

> 免费 Apple ID 调试的 App 7 天过期，重新运行即可；正式用需 Apple Developer Program（$99/年）。

## 工程是怎么生成的

用 [XcodeGen](https://github.com/yonom/XcodeGen) 从 `project.yml` 生成。改了 `project.yml` 后在根目录运行 `xcodegen generate` 重建。一般你不用管，直接打开 `.xcodeproj` 即可。

## 下一步

- Week 2：接入现成 Core ML 检测模型（`ObstacleDetecting` 实现），与深度融合（`ObstacleFusion` 已就绪）输出「是什么 + 几点钟方向 + 多远」。
- Phase 2：MapKit/持牌图商导航 + 空间音信标落地。
- Phase 3：RTC SDK 接入远程视频（见 PLAN §13.3 外部依赖）。
- 真机实测：发热/帧率/端到端延迟（PLAN §5.4/§5.6）。
