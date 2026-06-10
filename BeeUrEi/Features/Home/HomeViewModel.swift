import Foundation
import Observation
import ARKit
import UIKit
import CoreVideo
import simd

/// 首屏视图模型（MVVM 的 VM）。用 iOS 17 的 `@Observable`。
///
/// 避障闭环：ARKit LiDAR 深度 → 采样（适配层）→ 核心已测逻辑（检测融合 `ObstacleFusion`、
/// 危险度排序 `ObstacleRanker`、深度分级 `DepthSampler`、去抖 `AnnouncementThrottle`、
/// 文案 `SpeechComposer`）→ `FeedbackCoordinator`（核心 `FeedbackArbiter` 仲裁）→ 语音/震动。
/// 同时按 `TrackingGate` / `ThermalPolicy` / `PowerPolicy`（核心、已测）做降级与提示。
@Observable
final class HomeViewModel {

    private(set) var state: FrameSourceState = .idle
    private(set) var isStreaming = false
    private(set) var proximityText = "—"
    private(set) var advisoryText = ""
    private(set) var fps: Int = 0
    private(set) var thermalText: String = ""
    // 开发者模式详细指标
    private(set) var trackingStateText: String = "—"
    private(set) var resolutionText: String = "—"
    private(set) var depthSizeText: String = "—"
    private(set) var detectionCountText: String = "0"
    /// 当前实际使用的检测 ROI（静态或动态走廊）——供开发者叠层可视化。
    private(set) var currentROI: CGRect = DetectionConfig.regionOfInterest

    /// 是否在用真实检测模型（否则深度兜底）——供开发者叠层显示。
    var detectorActive: Bool { detector is YOLOObstacleDetector }

    /// ROI 文本（含静态/动态标记），供开发者叠层显示。
    var roiText: String {
        let r = currentROI
        let tag = DevSettings().dynamicROIEnabled ? "动态" : "静态"
        return String(format: "%@ x%.2f y%.2f w%.2f h%.2f", tag, r.origin.x, r.origin.y, r.width, r.height)
    }

    /// 电量 + 省电模式（iOS 不暴露具体摄氏温度，故以热状态档 + 电量呈现）。
    var batteryText: String {
        let level = UIDevice.current.batteryLevel
        let pct = level >= 0 ? "\(Int(level * 100))%" : "未知"
        let low = ProcessInfo.processInfo.isLowPowerModeEnabled ? "省电:开" : "省电:关"
        return "\(pct) · \(low)"
    }

    @ObservationIgnored private let source = ARDepthCameraSource()
    // 有 Core ML 模型则用真实检测；模型缺失则降级为深度兜底（StubObstacleDetector 返回空）。
    @ObservationIgnored private let detector: ObstacleDetecting = {
        let yolo = YOLOObstacleDetector()
        return yolo.isAvailable ? yolo : StubObstacleDetector()
    }()
    @ObservationIgnored private let fusion = ObstacleFusion(horizontalFOVDegrees: 68)
    @ObservationIgnored private let labels = LabelCatalog()
    @ObservationIgnored private let crossing = CrossingAssistant()
    @ObservationIgnored private let tracker = ObstacleTracker()
    @ObservationIgnored private let risk = RiskScore()
    @ObservationIgnored private let hazards = HazardCatalog()
    @ObservationIgnored private let groundHazard = GroundHazardDetector()
    @ObservationIgnored private let proximityMapper = ProximityCueMapper()
    @ObservationIgnored private var paused = false // 暂停中(通话/取景)：丢弃在途帧，杜绝暂停后仍冒出"前方…"
    @ObservationIgnored private var zoneHysteresis = ZoneHysteresis() // 分区滞回（PERCEPTION §6）
    @ObservationIgnored private let sonifier = ProximitySonifier()
    @ObservationIgnored private let clearConfirmer = ClearPathConfirmer()
    @ObservationIgnored private let announcePolicy = AnnouncementPolicy()
    @ObservationIgnored private let depthSampler = DepthSampler()
    @ObservationIgnored private let speechComposer = SpeechComposer()
    @ObservationIgnored private let trackingGate = TrackingGate()
    @ObservationIgnored private let thermalPolicy = ThermalPolicy()
    @ObservationIgnored private let powerPolicy = PowerPolicy()
    @ObservationIgnored private let speech = SpeechFeedback()
    @ObservationIgnored private lazy var coordinator = FeedbackCoordinator(sinks: [speech, HapticFeedback()])
    @ObservationIgnored private let consent = ConsentStore()
    @ObservationIgnored private let disclaimer = DisclaimerPolicy()

    @ObservationIgnored private var throttle = AnnouncementThrottle()
    @ObservationIgnored private var lastProcess: TimeInterval = 0
    @ObservationIgnored private var currentMode: AvoidanceMode = .ranging
    @ObservationIgnored private var trackingAdvisory = ""
    @ObservationIgnored private var frameCount = 0
    @ObservationIgnored private var lastFpsStamp: TimeInterval = 0
    @ObservationIgnored private var isSpeaking = false
    @ObservationIgnored private var lastTrackTime: TimeInterval = 0

    /// 供预览使用的 ARSession。
    var arSession: ARSession { source.session }

    func onAppear() {
        guard DeviceSupport.hasLiDAR else {
            state = .unsupported("此设备没有 LiDAR。BeeUrEi 仅支持带 LiDAR 的 iPhone（iPhone 12 Pro 及更新的 Pro 机型）。")
            return
        }
        UIDevice.current.isBatteryMonitoringEnabled = true
        speech.onFinish = { [weak self] in
            self?.isSpeaking = false
            self?.coordinator.finishCurrent()
        }
        source.onStateChange = { [weak self] in self?.state = $0 }
        source.onTracking = { [weak self] quality in self?.handleTracking(quality) }
        source.onFrame = { [weak self] frame in self?.handle(frame) }
        source.start()
        maybeSpeakBriefReminder()
    }

    /// 每次开始避障播报一句简短免责提醒（可在设置关闭语音；见 PLAN §1.3）。
    private func maybeSpeakBriefReminder() {
        guard consent.briefReminderSpeechEnabled,
              disclaimer.requirement(hasEverAccepted: consent.hasEverAccepted,
                                     daysSinceLastAcceptance: consent.daysSinceLastAcceptance) == .briefReminder
        else { return }
        coordinator.submit(FeedbackEvent(priority: .status, speech: disclaimer.briefReminderText))
    }

    func onDisappear() {
        source.stop()
        sonifier.stop()
    }

    /// 暂停避障会话：当呼叫/取景等**也用相机**的界面盖在主页上时调用，避免与之争抢相机致
    /// ARKit "World Tracking failed"（求助返回后主页报错的根因）。
    func pauseSession() {
        paused = true               // 先置位：丢弃在途帧，杜绝暂停后再提交"前方…"
        source.stop()
        sonifier.stop()
        speech.stopAll()            // 立刻掐断正在念/排队的"前方…"，避免串入通话
        coordinator.finishCurrent() // 释放仲裁通道，resume 后可正常重新播报
    }

    /// 恢复避障会话（上述界面关闭返回主页时调用）。重跑得到干净的世界跟踪。
    func resumeSession() {
        guard DeviceSupport.hasLiDAR else { return }
        paused = false
        zoneHysteresis.reset() // 重新开始：不携带暂停前的分区状态
        source.start()
    }

    /// 降级/暂停（避障关、过热停机、跟踪暂停、无深度）时统一收尾：
    /// 停接近声呐（否则会持续误鸣陈旧"有近物"，见审查 #4/#10），并复位跟踪时间基线
    /// （置 0，使恢复后首帧用保守默认 dt 而非跨越中断时段的墙钟差污染速度/TTC，见审查 #11）。
    private func degradeStop() {
        sonifier.update(nil)
        lastTrackTime = 0
    }

    /// 重复播报当前避障状态（盲人常错过语音；用户主动触发，走专用路径不污染仲裁通道，见审查 #13）。
    func repeatLastAnnouncement() {
        let text = advisoryText.isEmpty ? proximityText : "\(proximityText)。\(advisoryText)"
        guard !text.isEmpty, text != "—" else { return }
        speech.speakUserInitiated(text)
    }

    /// 跳到系统「设置」让用户开启被拒的相机权限。
    func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func handleTracking(_ quality: TrackingQuality) {
        currentMode = trackingGate.mode(for: quality)
        trackingAdvisory = trackingGate.advisory(for: quality) ?? ""
        trackingStateText = Self.trackingText(quality)
        updateAdvisory()
    }

    private func handle(_ frame: SensorFrame) {
        guard !paused else { return } // 暂停后(已 source.stop)仍可能有在途帧到达主队列——直接丢弃，避免再提交播报
        if !isStreaming { isStreaming = true }

        // FPS 统计（每帧计数，约 1s 汇总一次）——供开发者模式显示。
        frameCount += 1
        if frame.timestamp - lastFpsStamp >= 1.0 {
            fps = frameCount
            frameCount = 0
            lastFpsStamp = frame.timestamp
        }

        // 节流到约 2Hz（避障决策不需要每帧跑）。
        guard frame.timestamp - lastProcess >= 0.5 else { return }
        lastProcess = frame.timestamp
        updateAdvisory()
        thermalText = Self.thermalLabel(ProcessInfo.processInfo.thermalState)
        resolutionText = "\(CVPixelBufferGetWidth(frame.pixelBuffer))×\(CVPixelBufferGetHeight(frame.pixelBuffer))"
        depthSizeText = frame.depth.map { "\($0.width)×\($0.height)" } ?? "无"

        // 导航/避障分别开关（Q9）：避障关闭时不做决策与播报。
        guard FeatureSettings().avoidanceEnabled else {
            proximityText = "避障已关闭"
            degradeStop()
            return
        }

        // 设备过热：安全停机并提示（见 PLAN §5.4）。
        let thermalPlan = thermalPolicy.plan(for: Self.mapThermal(ProcessInfo.processInfo.thermalState))
        if thermalPlan.stopCamera {
            proximityText = thermalPlan.advisory ?? "设备过热，避障暂停"
            degradeStop()
            return
        }

        guard currentMode != .suspended, let depth = frame.depth else {
            proximityText = "测距暂停"
            degradeStop()
            return
        }

        // 地面高危地形（落差/下台阶/路缘）——纯 LiDAR 几何，COCO 模型识别不了的"脚下"危险。
        // 安全优先：去抖 2.5s 即可播报，不等其它逻辑。
        let groundProfile = DepthSampling.groundProfile(depth: depth.depth, confidence: depth.confidence)
        let groundHazardResult = groundHazard.detect(groundProfile: groundProfile)
        var groundCritical = false // 本帧是否已播脚下危险(critical)，供后面避免被正前方极近播报截断/重复（见审查 #5）
        if let groundHint = groundHazard.hint(groundHazardResult),
           throttle.shouldAnnounce(key: "groundhazard", now: frame.timestamp, minGap: 2.5) {
            // 不设 isSpeaking：地面危险有自己的 2.5s 去抖且经 arbiter 仲裁；若在此置 true，同帧后面的危险
            // 障碍 announcePolicy.decide 会误以为"正在播报同一障碍目标"而把快速逼近的车/人静音漏播（见审查 #1/#8）。
            // 脚下危险(落差/台阶)都用 .critical：是即时足下危险，不应被前方普通障碍 stopSpeaking 截断（见审查 #1/#6）。
            // dropOff(下台阶/坠落)更紧急 → interrupt 立即打断；stepUp(台阶/竖直面)仅需不被截断，不强制打断。
            let isDropOff: Bool = { if case .dropOff = groundHazardResult { return true }; return false }()
            coordinator.submit(FeedbackEvent(priority: .critical, speech: groundHint, interrupt: isDropOff))
            groundCritical = true
        }

        // 接近声呐（可选）：用正前方最近距离驱动蜂鸣节奏/音高（核心 ProximityCueMapper，已测）。
        if FeatureSettings().proximitySonar {
            let center = DepthSampling.centerSamples(depth: depth.depth, confidence: depth.confidence)
            let nearest = depthSampler.evaluate(depths: center.depths, confidences: center.confidences).nearest
            sonifier.update(nearest.flatMap { proximityMapper.cue(distanceMeters: $0) })
        } else {
            sonifier.update(nil)
        }

        // 1) 检测路径：detector 无模型时返回空 → 自动走深度兜底。
        // 动态 ROI（碰撞走廊，开发者开关）优先；否则静态中央带。
        let dynamicROI = dynamicROIBox(for: frame)
        currentROI = dynamicROI ?? DetectionConfig.regionOfInterest
        let detections = detector.detect(in: frame.pixelBuffer, regionOfInterest: dynamicROI)
        detectionCountText = "\(detections.count)"

        // 红绿灯颜色识别（Q7）：检测器采样灯框平均色判红/绿/黄 → 一句较低优先级提醒（去抖 4s）。
        if let yolo = detector as? YOLOObstacleDetector,
           let hint = TrafficLightClassifier().hint(yolo.lastTrafficLightState),
           throttle.shouldAnnounce(key: "trafficlight", now: frame.timestamp, minGap: 4) {
            coordinator.submit(FeedbackEvent(priority: .turn, speech: hint))
        }
        let obstacles = detections.map { det -> Obstacle in
            // 用检测框真实纵向中心取距离，而非永远取深度图垂直中线(y=0.5)——否则地上/头顶等
            // 非居中目标会读到中线那片远处地面/背景的距离，距离严重说错（安全攸关，见审查 #6）。
            let s = DepthSampling.samples(depth: depth.depth, confidence: depth.confidence,
                                          normalizedX: det.box?.midX ?? det.normalizedX,
                                          normalizedY: det.box?.midY ?? 0.5)
            let dist = depthSampler.nearestDistance(depths: s.depths, confidences: s.confidences)
            // 英文 COCO 标签 → 中文（命中高危加成、中文播报，见 §5.8）。
            let localized = DetectedObject(label: labels.localizedName(det.label),
                                           normalizedX: det.normalizedX,
                                           confidence: det.confidence)
            return fusion.fuse(localized, distanceMeters: dist)
        }

        // 过街提示（Q7）：检测到红绿灯时给一句较低优先级的提醒（去抖 5s）。
        if let hint = crossing.hint(forLabels: obstacles.map(\.label)),
           throttle.shouldAnnounce(key: "crossing", now: frame.timestamp, minGap: 5) {
            coordinator.submit(FeedbackEvent(priority: .turn, speech: hint))
        }

        // 轻量跟踪 + TTC 风险（核心，已测）：稳定 ID、平滑方位/距离、容忍漏检，并按"碰撞时间"排序威胁。
        // 这同时取代了原 ranker/stabilizer/smoother——跟踪本身就完成了去抖 + 持久化 + 平滑。
        let dt = lastTrackTime > 0 ? min(max(frame.timestamp - lastTrackTime, 0.05), 2.0) : 0.5
        lastTrackTime = frame.timestamp
        let observations = obstacles.map { o in
            TrackObservation(label: o.label, bearingDegrees: o.clock.angleDegrees,
                             distanceMeters: o.distanceMeters, isHazard: hazards.isHighRisk(o.label))
        }
        let tracks = tracker.update(observations, dt: dt)
        // 只用**已确认**且本帧有观测(misses==0)的轨迹驱动危险播报：confirmed 需累计 confirmHits 帧、id 已稳定，
        // 承诺式去抖(announcePolicy 用 id 作 key)才有效；放行 tentative 高危轨迹会因 id 逐帧抖动绕过去抖、
        // 连珠重复播报、且单帧误检即触发打断式播报（见审查 #2/#6）。漏检期(misses>0)是陈旧值，排除（见审查 #4）。
        // 正前方极近的未分类危险由下方"中央深度兜底"即时兜住，不依赖此处。
        let activeTracks = tracks.filter { $0.misses == 0 }

        // 中央深度兜底**始终评估**：分类器没认出但很近的正前方障碍(玻璃门/矮桩/横杆)，
        // 不能因为存在(可能在侧前方的)跟踪目标就被跳过（见审查 #9）。
        let samples = DepthSampling.centerSamples(depth: depth.depth, confidence: depth.confidence)
        let centralResult = depthSampler.evaluate(depths: samples.depths, confidences: samples.confidences)
        // 分区过滞回（进 1.0m/出 1.4m；caution 2.5/2.9）：站在阈值边界时不再 danger↔caution 反复横跳（PERCEPTION §6）。
        let zone = zoneHysteresis.update(nearest: centralResult.nearest)
        // 跟踪受限(.relative 模式)：不报精确米数，改方向性措辞，避免给出不可信的精确距离（见审查 #5）。
        let suppressMeters = (currentMode == .relative)

        // 1) 正前方中央极近(深度 danger 区) = 最即时的物理危险 → 最高优先级安全门，即使有侧前方跟踪目标也先播（见审查 #9）。
        if zone == .danger {
            proximityText = suppressMeters ? "正前方很近，请停下"
                                           : String(format: "正前方约 %.1f 米，请注意", centralResult.nearest ?? 0)
            // 正前方极近 = 最即时碰撞 → .critical+打断（见审查 #9/#2）。
            // 但若本帧已播脚下危险(groundCritical)，不再叠加极近播报：避免 .critical 互相 stopSpeaking 截断、
            // 且"落差/台阶"已隐含"请停下"，语义重复（见审查 #5）。
            if !groundCritical,
               let phrase = speechComposer.announceProximity(.danger, nearestMeters: suppressMeters ? nil : centralResult.nearest),
               throttle.shouldAnnounce(key: "proximity:danger", now: frame.timestamp, minGap: 1.5) {
                coordinator.submit(FeedbackEvent(priority: .critical, speech: phrase, interrupt: true))
            }
            _ = clearConfirmer.update(isClear: false, now: frame.timestamp)
            return
        }

        // 2) 跟踪到的危险障碍（按 TTC 排序，承诺式播报）。
        if let danger = risk.mostDangerous(activeTracks) {
            let smoothed = Obstacle(label: danger.label,
                                    clock: ClockDirection(angleDegrees: danger.bearingDegrees),
                                    distanceMeters: suppressMeters ? nil : danger.distanceMeters,
                                    confidence: 1)
            let phrase = speechComposer.announce(smoothed, concise: FeatureSettings().conciseAnnouncements)
            proximityText = phrase
            let urgency = danger.timeToCollision.map { 1.0 / max($0, 0.3) }
                ?? danger.distanceMeters.map { 1.0 / max($0, 0.3) } ?? 1.0
            let decision = announcePolicy.decide(targetKey: "\(danger.id)|\(danger.label)", urgency: urgency,
                                                 isSpeaking: isSpeaking, now: frame.timestamp)
            if decision.announce {
                // 透传 interrupt：同目标危险骤升(快速逼近)时立即打断当前播报，VoiceOver 下也抢占（见审查 #2）。
                // 仅当事件**真正播出**才置 isSpeaking；若被更高优先级(.critical 地面/极近)吞掉，撤销承诺
                // (announcePolicy.reset)，否则策略会以为"已播报"而把这个真实障碍静音到刷新间隔(~6s)（见审查 #3/#4）。
                if coordinator.submit(FeedbackEvent(priority: .obstacle, speech: phrase, interrupt: decision.interrupt)) {
                    isSpeaking = true
                } else {
                    announcePolicy.reset()
                }
            }
            _ = clearConfirmer.update(isClear: false, now: frame.timestamp)
            return
        }

        // 3) 无跟踪危险：中央深度兜底(warn 区)或通畅。
        if let nearest = centralResult.nearest {
            proximityText = suppressMeters ? "正前方有障碍" : String(format: "正前方约 %.1f 米", nearest)
        } else {
            proximityText = "正前方通畅"
        }
        if let phrase = speechComposer.announceProximity(zone, nearestMeters: suppressMeters ? nil : centralResult.nearest) {
            let minGap = zone == .danger ? 1.5 : 3.0
            if throttle.shouldAnnounce(key: "proximity:\(zone)", now: frame.timestamp, minGap: minGap) {
                coordinator.submit(FeedbackEvent(priority: .obstacle, speech: phrase))
            }
        }

        // "前方通畅"周期确认（可选）。滞回后的 .clear 才算通畅，与播报分区一致。
        if FeatureSettings().clearPathConfirm {
            let clear = (zone == .clear)
            if clearConfirmer.update(isClear: clear, now: frame.timestamp) {
                coordinator.submit(FeedbackEvent(priority: .status, speech: "前方通畅"))
            }
        }
    }

    /// 动态 ROI：用碰撞走廊（核心 `CollisionCorridor`）从相机位姿投影出图像 ROI。
    /// 仅开发者开关开启 + 有相机几何时生效；退化/无相机时返回 nil（检测器回退静态 ROI）。
    /// ⚠️ 地面用"相机离地 1.2m 近似"，正式应配合 ARPlaneAnchor，见 PERCEPTION_ALGORITHM §2.4。
    private func dynamicROIBox(for frame: SensorFrame) -> CGRect? {
        guard DevSettings().dynamicROIEnabled, let cam = frame.camera else { return nil }
        let t = cam.cameraToWorld
        let camPos = SIMD3<Float>(t.columns.3.x, t.columns.3.y, t.columns.3.z)
        // CV 约定相机看 +Z：前向 = transform 第三列；投影到水平面。
        var forward = SIMD3<Float>(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        forward.y = 0
        guard simd_length(forward) > 0.01 else { return nil }
        forward = simd_normalize(forward)

        let holdHeight: Float = 1.2 // 相机离地近似（无平面检测时）
        let origin = SIMD3<Float>(camPos.x, camPos.y - holdHeight, camPos.z)
        let box = CollisionCorridor().imageROI(
            origin: origin, forward: forward, up: cam.worldUp,
            cameraToWorld: cam.cameraToWorld, intrinsics: cam.intrinsics,
            imageWidth: cam.imageWidth, imageHeight: cam.imageHeight)

        // 安全：退化/过小 → 回退静态。
        guard box.width >= 0.2, box.height >= 0.2 else { return nil }
        // NormalizedBox(原点左上) → Vision regionOfInterest(原点左下)。
        return CGRect(x: box.x, y: 1 - box.y - box.height, width: box.width, height: box.height)
    }

    /// 合并跟踪降级 + 热/电量降级提示。
    private func updateAdvisory() {
        var parts: [String] = []
        if !trackingAdvisory.isEmpty { parts.append(trackingAdvisory) }
        if let degrade = degradeAdvisory() { parts.append(degrade) }
        let text = parts.joined(separator: " · ")
        advisoryText = text
        // 降级提示是安全相关：内容变化且非空时主动朗读一次（去重防刷屏），
        // 否则盲人焦点不在状态条上时不知避障已降级/暂停仍照常行走（见无障碍审计）。
        if !text.isEmpty, text != lastAnnouncedAdvisory { A11y.announce(text) }
        lastAnnouncedAdvisory = text
    }
    private var lastAnnouncedAdvisory = ""

    private func degradeAdvisory() -> String? {
        let thermalPlan = thermalPolicy.plan(for: Self.mapThermal(ProcessInfo.processInfo.thermalState))
        if let advisory = thermalPlan.advisory { return advisory }
        let powerPlan = powerPolicy.plan(batteryLevel: Double(UIDevice.current.batteryLevel),
                                         lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled)
        return powerPlan.advisory
    }

    static func mapThermal(_ state: ProcessInfo.ThermalState) -> ThermalLevel {
        switch state {
        case .nominal:  return .nominal
        case .fair:     return .fair
        case .serious:  return .serious
        case .critical: return .critical
        @unknown default: return .fair
        }
    }

    static func thermalLabel(_ state: ProcessInfo.ThermalState) -> String {
        switch state {
        case .nominal:  return "正常 (nominal)"
        case .fair:     return "温热 (fair)"
        case .serious:  return "偏热 (serious)"
        case .critical: return "过热 (critical)"
        @unknown default: return "未知"
        }
    }

    static func trackingText(_ quality: TrackingQuality) -> String {
        switch quality {
        case .normal: return "正常"
        case .notAvailable: return "不可用"
        case .limited(let reason):
            switch reason {
            case .initializing:         return "初始化中"
            case .excessiveMotion:      return "移动过快"
            case .insufficientFeatures: return "特征不足"
            case .relocalizing:         return "重定位中"
            case .other:                return "受限"
            }
        }
    }
}
