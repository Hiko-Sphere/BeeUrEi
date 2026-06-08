import Foundation
import CoreHaptics
import UIKit

/// 震动通道：用 Core Haptics 播放**按优先级可区分的节奏**（核心 `HapticDesign`，已测）：
/// 1 下=环境/状态、2 下=转向、3 下强而锐=危险。让盲人不靠语音、仅凭手感分辨危险等级
/// （嘈杂或不便听语音时的冗余安全通道）。无 Core Haptics 硬件时回退基础震动。
final class HapticFeedback: FeedbackSink {
    private var engine: CHHapticEngine?

    init() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        engine = try? CHHapticEngine()
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
        let style: UIImpactFeedbackGenerator.FeedbackStyle = priority == .obstacle ? .heavy
            : priority == .turn ? .medium : .light
        let count = HapticDesign.pattern(for: priority).count
        let generator = UIImpactFeedbackGenerator(style: style)
        for i in 0..<count {
            DispatchQueue.main.asyncAfter(deadline: .now() + Double(i) * 0.15) {
                generator.impactOccurred()
            }
        }
    }
}
