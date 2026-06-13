import Foundation
import AVFoundation

/// 空间音通道：用 AVAudioEngine + AVAudioEnvironmentNode 把提示音「挂」在某个方位（见 PLAN §7.2）。
/// 这里是最小可用的 3D 音频图；导航信标的完整实现见 Phase 2（参考 Soundscape）。
final class SpatialAudioFeedback: FeedbackSink {
    private let engine = AVAudioEngine()
    private let environment = AVAudioEnvironmentNode()
    private let player = AVAudioPlayerNode()
    private var toneBuffer: AVAudioPCMBuffer?
    private var started = false
    private var routeObserver: NSObjectProtocol?

    init() {
        engine.attach(environment)
        engine.attach(player)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1)!
        engine.connect(player, to: environment, format: format)
        engine.connect(environment, to: engine.mainMixerNode, format: nil)
        environment.listenerPosition = AVAudio3DPoint(x: 0, y: 0, z: 0)
        toneBuffer = SpatialAudioFeedback.makeTone(format: format)
        configureSpatialization()
        // 路由中途变化（边走边插上 AirPods）也要重判耳机/扬声器——否则整段导航停留在非 HRTF 渲染（见 P2 审计）。
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshOutputType()
        }
    }

    /// 启用**真正的双耳空间化**——这是此前缺失的关键一环：`AVAudioPlayerNode` 默认渲染算法是
    /// `.equalPowerPanning`（只有左右声像 pan），AirPods 上听不出「几点钟方向」。
    /// 从环境节点支持的算法里挑最优双耳算法（HRTFHQ>HRTF>…，核心 `SpatialAudioPolicy` 已测）并设为点声源，
    /// 配合 `setListenerYaw`（AirPods 头追踪）即可让信标在用户转头时保持世界固定（Soundscape 式）。
    private func configureSpatialization() {
        let available = environment.applicableRenderingAlgorithms.map { $0.intValue }
        let best = SpatialAudioPolicy.bestBeaconAlgorithm(availableRawValues: available)
        if let avAlgo = AVAudio3DMixingRenderingAlgorithm(rawValue: best.rawValue) {
            player.renderingAlgorithm = avAlgo
        }
        player.sourceMode = .pointSource   // 信标是空间中的一个明确点，而非弥散声场
        refreshOutputType()
    }

    /// 按当前音频路由设置环境输出类型：戴 AirPods/耳机时用 `.headphones`（最佳 HRTF 双耳渲染），
    /// 否则内置扬声器（用扬声器播 HRTF 会闷且方位错乱）。路由可能在导航中变化，故每次启动引擎时刷新。
    private func refreshOutputType() {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs
        let onHeadphones = outputs.contains { out in
            [.headphones, .bluetoothA2DP, .bluetoothLE, .bluetoothHFP, .airPlay].contains(out.portType)
        }
        environment.outputType = onHeadphones ? .headphones : .builtInSpeakers
    }

    /// FeedbackSink：播放一个非定向提示音。定向版用 `playCue(azimuthDegrees:)`。
    func play(_ event: FeedbackEvent) {
        playCue(azimuthDegrees: 0)
    }

    /// 旋转听者朝向（用 AirPods 头部偏航驱动，使信标保持世界固定；见 HeadTracker / PLAN §14 Q8）。
    func setListenerYaw(_ degrees: Float) {
        environment.listenerAngularOrientation = AVAudio3DAngularOrientation(yaw: degrees, pitch: 0, roll: 0)
    }

    /// 在给定方位角播放短提示音（右为正，单位度），声源置于听者前方 1m 处的该方位。
    /// distanceMeters：到目标的距离（可选）——越近音量越大（Phase 2 标准「靠近音量增大」），
    /// 给盲人"快到了"的直觉反馈：>200m 轻(0.45)，线性增强至 ≤15m 最响(1.0)。
    func playCue(azimuthDegrees: Float, distanceMeters: Double? = nil) {
        guard let toneBuffer else { return }
        // 用 engine.isRunning 判断而非粘滞的 started：来电/Siri/媒体重置会停掉引擎，
        // 此处检测到未运行就重启，避免一次中断后信标永久失声（导航核心反馈，见审查 #10）。
        if !engine.isRunning {
            do {
                refreshOutputType()   // 路由可能在导航途中变化（插上 AirPods）：重启引擎时重判耳机/扬声器
                try engine.start()
                player.play()
                started = true
            } catch {
                started = false
                return
            }
        }
        if let d = distanceMeters, d.isFinite {
            let t = Float(max(0, min(1, (200 - d) / 185)))   // 200m→0, 15m→1
            player.volume = 0.45 + 0.55 * t
        } else {
            player.volume = 1.0
        }
        let radians = azimuthDegrees * .pi / 180
        player.position = AVAudio3DPoint(x: sin(radians), y: 0, z: -cos(radians))
        player.scheduleBuffer(toneBuffer, at: nil, options: [.interrupts], completionHandler: nil)
    }

    /// 停止并释放音频引擎（导航结束调用，避免占用音频会话；见审查 #11）。
    func stop() {
        if started {
            player.stop()
            engine.stop()
            started = false
        }
    }

    deinit { stop() }

    private static func makeTone(format: AVAudioFormat,
                                 frequency: Float = 880,
                                 durationSeconds: Float = 0.12) -> AVAudioPCMBuffer? {
        let frames = AVAudioFrameCount(format.sampleRate * Double(durationSeconds))
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames),
              let channel = buffer.floatChannelData else { return nil }
        buffer.frameLength = frames
        let sampleRate = Float(format.sampleRate)
        for i in 0..<Int(frames) {
            channel[0][i] = 0.2 * sin(2 * .pi * frequency * Float(i) / sampleRate)
        }
        return buffer
    }
}
