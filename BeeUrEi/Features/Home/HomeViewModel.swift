import Foundation
import Observation
import ARKit
import UIKit

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

    /// 是否在用真实检测模型（否则深度兜底）——供开发者叠层显示。
    var detectorActive: Bool { detector is YOLOObstacleDetector }

    @ObservationIgnored private let source = ARDepthCameraSource()
    // 有 Core ML 模型则用真实检测；模型缺失则降级为深度兜底（StubObstacleDetector 返回空）。
    @ObservationIgnored private let detector: ObstacleDetecting = {
        let yolo = YOLOObstacleDetector()
        return yolo.isAvailable ? yolo : StubObstacleDetector()
    }()
    @ObservationIgnored private let fusion = ObstacleFusion(horizontalFOVDegrees: 68)
    @ObservationIgnored private let labels = LabelCatalog()
    @ObservationIgnored private let crossing = CrossingAssistant()
    @ObservationIgnored private let ranker = ObstacleRanker()
    @ObservationIgnored private let stabilizer = ObstacleStabilizer()
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
    @ObservationIgnored private var lastObstacleKey = ""
    @ObservationIgnored private var lastObstacleSpoken: TimeInterval = 0

    /// 供预览使用的 ARSession。
    var arSession: ARSession { source.session }

    func onAppear() {
        guard DeviceSupport.hasLiDAR else {
            state = .unsupported("此设备没有 LiDAR。BeeUrEi 仅支持带 LiDAR 的 iPhone（iPhone 12 Pro 及更新的 Pro 机型）。")
            return
        }
        UIDevice.current.isBatteryMonitoringEnabled = true
        speech.onFinish = { [weak self] in self?.coordinator.finishCurrent() }
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

        // 1) 检测路径：detector 无模型时返回空 → 自动走深度兜底。
        let detections = detector.detect(in: frame.pixelBuffer)
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

        // 时间稳定化：每帧喂入"最危险候选"(可能 nil)，迟滞消除手抖闪烁。
        if let stable = stabilizer.update(ranker.mostDangerous(obstacles)) {
            let phrase = speechComposer.announce(stable)
            proximityText = phrase
            // 只在目标变化或每隔 6 秒才播报——避免被反复打断、把话说完整（见用户反馈）。
            let key = "\(stable.label)|\(stable.clock.hour)"
            if key != lastObstacleKey || frame.timestamp - lastObstacleSpoken >= 6 {
                lastObstacleKey = key
                lastObstacleSpoken = frame.timestamp
                coordinator.submit(FeedbackEvent(priority: .obstacle, speech: phrase))
            }
            return
        }
        lastObstacleKey = ""

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
        case .nominal:  return "正常"
        case .fair:     return "温热"
        case .serious:  return "偏热"
        case .critical: return "过热"
        @unknown default: return "未知"
        }
    }
}
