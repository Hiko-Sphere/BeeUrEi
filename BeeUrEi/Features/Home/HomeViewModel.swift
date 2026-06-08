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
            return
        }

        // 设备过热：安全停机并提示（见 PLAN §5.4）。
        let thermalPlan = thermalPolicy.plan(for: Self.mapThermal(ProcessInfo.processInfo.thermalState))
        if thermalPlan.stopCamera {
            proximityText = thermalPlan.advisory ?? "设备过热，避障暂停"
            return
        }

        guard currentMode != .suspended, let depth = frame.depth else {
            proximityText = "测距暂停"
            return
        }

        // 地面高危地形（落差/下台阶/路缘）——纯 LiDAR 几何，COCO 模型识别不了的"脚下"危险。
        // 安全优先：去抖 2.5s 即可播报，不等其它逻辑。
        let groundProfile = DepthSampling.groundProfile(depth: depth.depth)
        if let groundHint = groundHazard.hint(groundHazard.detect(groundProfile: groundProfile)),
           throttle.shouldAnnounce(key: "groundhazard", now: frame.timestamp, minGap: 2.5) {
            isSpeaking = true
            coordinator.submit(FeedbackEvent(priority: .obstacle, speech: groundHint))
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
            let s = DepthSampling.samples(depth: depth.depth, confidence: depth.confidence, normalizedX: det.normalizedX)
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
        if let danger = risk.mostDangerous(tracks) {
            let smoothed = Obstacle(label: danger.label,
                                    clock: ClockDirection(angleDegrees: danger.bearingDegrees),
                                    distanceMeters: danger.distanceMeters,
                                    confidence: 1)
            let phrase = speechComposer.announce(smoothed, concise: FeatureSettings().conciseAnnouncements)
            proximityText = phrase
            // 紧急度优先用 TTC（碰撞时间越小越急），否则退化到距离。
            let urgency = danger.timeToCollision.map { 1.0 / max($0, 0.3) }
                ?? danger.distanceMeters.map { 1.0 / max($0, 0.3) } ?? 1.0
            // 承诺式播报：用稳定的 track id+标签作目标键，说话期间不打断同目标，只有明显更紧急的新目标才打断。
            let decision = announcePolicy.decide(targetKey: "\(danger.id)|\(danger.label)", urgency: urgency,
                                                 isSpeaking: isSpeaking, now: frame.timestamp)
            if decision.announce {
                isSpeaking = true
                coordinator.submit(FeedbackEvent(priority: .obstacle, speech: phrase))
            }
            return
        }

        // 2) 深度兜底：分类器没认出但很近时，仅靠深度也要预警（见 PLAN §5.8）。
        let samples = DepthSampling.centerSamples(depth: depth.depth, confidence: depth.confidence)
        let result = depthSampler.evaluate(depths: samples.depths, confidences: samples.confidences)

        if let nearest = result.nearest {
            proximityText = String(format: "正前方约 %.1f 米", nearest)
        } else {
            proximityText = "正前方通畅"
        }

        if let phrase = speechComposer.announceProximity(result.zone, nearestMeters: result.nearest) {
            let minGap = result.zone == .danger ? 1.5 : 3.0
            if throttle.shouldAnnounce(key: "proximity:\(result.zone)", now: frame.timestamp, minGap: minGap) {
                coordinator.submit(FeedbackEvent(priority: .obstacle, speech: phrase))
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
        advisoryText = parts.joined(separator: " · ")
    }

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
