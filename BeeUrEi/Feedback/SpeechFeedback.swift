import Foundation
import AVFoundation
import UIKit

/// 语音通道：用 AVSpeechSynthesizer 播报（端侧 TTS）。播报结束回调 `onFinish` 释放仲裁通道。
final class SpeechFeedback: NSObject, FeedbackSink {
    private let synthesizer = AVSpeechSynthesizer()
    var onFinish: (() -> Void)?

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func play(_ event: FeedbackEvent) {
        guard let text = event.speech, !text.isEmpty else { return }

        // 与 VoiceOver 协作（见 PLAN §7.2）：VoiceOver 开启时用无障碍播报而非直接 TTS，
        // 避免和 VoiceOver 抢话/互相打断。盲人用户通常常开 VoiceOver，这是主路径。
        if UIAccessibility.isVoiceOverRunning {
            UIAccessibility.post(notification: .announcement, argument: text)
            onFinish?()   // 无 didFinish 回调，立即释放仲裁通道
            return
        }

        // 高优先级（转向/避障）抢占正在播报的内容。
        if event.priority >= .turn {
            synthesizer.stopSpeaking(at: .immediate)
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        // 可调语速（设置里 0...1 → AVSpeech 速率区间）。
        let t = FeatureSettings().speechRate
        utterance.rate = AVSpeechUtteranceMinimumSpeechRate
            + (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate) * t
        synthesizer.speak(utterance)
    }
}

extension SpeechFeedback: AVSpeechSynthesizerDelegate {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        onFinish?()
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        onFinish?()
    }
}
