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

    @ObservationIgnored private let source = ARDepthCameraSource()
    // 有 Core ML 模型则用真实检测；模型缺失则降级为深度兜底（StubObstacleDetector 返回空）。
    @ObservationIgnored private let detector: ObstacleDetecting = {
        let yolo = YOLOObstacleDetector()
        return yolo.isAvailable ? yolo : StubObstacleDetector()
    }()
    @ObservationIgnored private let fusion = ObstacleFusion(horizontalFOVDegrees: 68)
    @ObservationIgnored private let ranker = ObstacleRanker()
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

        // 节流到约 2Hz（避障决策不需要每帧跑）。
        guard frame.timestamp - lastProcess >= 0.5 else { return }
        lastProcess = frame.timestamp
        updateAdvisory()

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

        // 1) 检测路径：detector 现为 Stub（返回空）；接入真实 Core ML 模型后自动生效。
        let detections = detector.detect(in: frame.pixelBuffer)
        if !detections.isEmpty {
            let obstacles = detections.map { det -> Obstacle in
                let s = DepthSampling.samples(depth: depth.depth, confidence: depth.confidence, normalizedX: det.normalizedX)
                let dist = depthSampler.nearestDistance(depths: s.depths, confidences: s.confidences)
                return fusion.fuse(det, distanceMeters: dist)
            }
            if let top = ranker.mostDangerous(obstacles) {
                let phrase = speechComposer.announce(top)
                proximityText = phrase
                if throttle.shouldAnnounce(key: "obstacle:\(top.label)", now: frame.timestamp, minGap: 1.5) {
                    coordinator.submit(FeedbackEvent(priority: .obstacle, speech: phrase))
                }
                return
            }
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
}
