import Foundation
import CoreHaptics
import UIKit

/// 震动通道：用 Core Haptics 播放**按优先级可区分的节奏**（核心 `HapticDesign`，已测）：
/// 1 下=环境/状态、2 下=转向、3 下强而锐=危险。让盲人不靠语音、仅凭手感分辨危险等级
/// （嘈杂或不便听语音时的冗余安全通道）。无 Core Haptics 硬件时回退基础震动。
final class HapticFeedback: FeedbackSink {
    private var engine: CHHapticEngine?
    private let fallbackGenerator = UIImpactFeedbackGenerator(style: .heavy)

    init() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        engine = try? CHHapticEngine()
        engine?.isAutoShutdownEnabled = false // 不自动停机，避免稀疏的危险震动到来时引擎已停（见审查 #5/#13）
        // 系统重置/停机(来电/资源回收)后引擎会失效——必须在回调里重启，否则危险四连震永久不再触发。
        engine?.resetHandler = { [weak self] in try? self?.engine?.start() }
        engine?.stoppedHandler = { [weak self] _ in try? self?.engine?.start() }
        try? engine?.start()
    }

    func play(_ event: FeedbackEvent) {
        let pulses = HapticDesign.pattern(for: event.priority)
        guard let engine else {
            playFallback(event.priority)
            return
        }
        let events = pulses.map { p in
            CHHapticEvent(
                eventType: .hapticTransient,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: Float(p.intensity)),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: Float(p.sharpness)),
                ],
                relativeTime: p.relativeTime)
        }
        guard let pattern = try? CHHapticPattern(events: events, parameters: []),
              let player = try? engine.makePlayer(with: pattern) else {
            playFallback(event.priority)
            return
        }
        try? engine.start()
        try? player.start(atTime: 0)
    }

    /// 无 Core Haptics 时用基础冲击反馈，按优先级给不同强度 + 危险时连击。
    private func playFallback(_ priority: FeedbackPriority) {
        // .critical(落差/极近)此前会落到最轻档(漏掉 .heavy 分支)——危险等级强度倒置；现 >=.obstacle 一律最强（见审查 #14）。
        let style: UIImpactFeedbackGenerator.FeedbackStyle = priority >= .obstacle ? .heavy
            : priority == .turn ? .medium : .light
        let count = HapticDesign.pattern(for: priority).count
        let generator = priority >= .obstacle ? fallbackGenerator : UIImpactFeedbackGenerator(style: style)
        generator.prepare() // 预热，避免首个危险脉冲被丢/减弱（见审查 #11）
        for i in 0..<count {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.15) {
                generator.impactOccurred()
                generator.prepare() // 为下一击续热
            }
        }
    }
}
