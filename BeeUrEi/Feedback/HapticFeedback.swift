import Foundation
import CoreHaptics

/// 震动通道：用 Core Haptics。优先级越高，震动强度越大（嘈杂环境语音失效时的冗余通道）。
final class HapticFeedback: FeedbackSink {
    private var engine: CHHapticEngine?

    init() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        engine = try? CHHapticEngine()
        try? engine?.start()
    }

    func play(_ event: FeedbackEvent) {
        guard let engine else { return }
        let intensityValue = Float(event.priority.rawValue + 1) / 4.0
        let intensity = CHHapticEventParameter(parameterID: .hapticIntensity, value: intensityValue)
        let sharpness = CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.7)
        let hapticEvent = CHHapticEvent(eventType: .hapticTransient,
                                        parameters: [intensity, sharpness],
                                        relativeTime: 0)
        guard let pattern = try? CHHapticPattern(events: [hapticEvent], parameters: []),
              let player = try? engine.makePlayer(with: pattern) else { return }
        try? player.start(atTime: 0)
    }
}
