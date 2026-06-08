import Foundation
import AVFoundation
import UIKit

/// 语音通道：用 AVSpeechSynthesizer 播报（端侧 TTS）。播报结束回调 `onFinish` 释放仲裁通道。
final class SpeechFeedback: NSObject, FeedbackSink {
    private let synthesizer = AVSpeechSynthesizer()
    var onFinish: (() -> Void)?

    /// 仲裁路径当前这条 utterance；只有它结束才释放仲裁通道（区分用户主动播报，见审查 #13）。
    private var arbiterUtterance: AVSpeechUtterance?
    /// VoiceOver 路径的代次令牌：异步释放时只认最新一条，避免旧释放误放新通道（见审查 #12）。
    private var voGeneration = 0

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func play(_ event: FeedbackEvent) {
        guard let text = event.speech, !text.isEmpty else { return }

        // 与 VoiceOver 协作（见 PLAN §7.2）：VoiceOver 开启时用无障碍播报而非直接 TTS，
        // 避免和 VoiceOver 抢话/互相打断。盲人用户通常常开 VoiceOver，这是主路径。
        if UIAccessibility.isVoiceOverRunning {
            // interrupt=true(危险骤升/极近)：用高优先级公告抢占正在朗读的内容，而非排到其后（见审查 #2）。
            if event.interrupt {
                let attr = NSAttributedString(string: text, attributes: [
                    .accessibilitySpeechAnnouncementPriority: UIAccessibilityPriority.high,
                ])
                UIAccessibility.post(notification: .announcement, argument: attr)
            } else {
                UIAccessibility.post(notification: .announcement, argument: text)
            }
            // 无 didFinish 回调：按文本长度估算播报时长，到时再释放仲裁通道；期间仲裁仍按优先级
            // 阻止低优先级抢占（立即释放会让优先级保证失效、并把 isSpeaking 同步重置，见审查 #12）。
            voGeneration += 1
            let gen = voGeneration
            DispatchQueue.main.asyncAfter(deadline: .now() + Self.estimatedDuration(text)) { [weak self] in
                guard let self, gen == self.voGeneration else { return } // 仅最新一条释放
                self.onFinish?()
            }
            return
        }

        // 高优先级（转向/避障）抢占正在播报的内容。
        if event.priority >= .turn {
            synthesizer.stopSpeaking(at: .immediate)
        }
        voGeneration += 1 // 使任何挂起的 VO 释放失效（避免 VO 切换时误释放）
        let utterance = makeUtterance(text)
        arbiterUtterance = utterance
        synthesizer.speak(utterance)
    }

    /// 用户主动触发的播报（如点状态条「重复」）——不经仲裁、其结束不释放仲裁通道，
    /// 避免污染正被障碍/转向播报占据的优先级状态（见审查 #13）。
    func speakUserInitiated(_ text: String) {
        guard !text.isEmpty else { return }
        if UIAccessibility.isVoiceOverRunning {
            UIAccessibility.post(notification: .announcement, argument: text)
            return
        }
        synthesizer.speak(makeUtterance(text)) // 不设 arbiterUtterance → didFinish 不会调 onFinish
    }

    private func makeUtterance(_ text: String) -> AVSpeechUtterance {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "zh-CN")
        let t = FeatureSettings().speechRate
        utterance.rate = AVSpeechUtteranceMinimumSpeechRate
            + (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate) * t
        return utterance
    }

    /// 估算中文播报时长（秒）：约 4.5 字/秒，保底 0.8s、上限 6s；偏长一点更安全（多占一会通道）。
    private static func estimatedDuration(_ text: String) -> Double {
        min(max(0.8, Double(text.count) * 0.22), 6)
    }
}

extension SpeechFeedback: AVSpeechSynthesizerDelegate {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        finishIfArbiter(utterance)
    }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        finishIfArbiter(utterance)
    }

    /// 仅当结束的是仲裁路径那条 utterance 才释放通道（用户主动播报/被抢占的旧句不释放，见审查 #13）。
    private func finishIfArbiter(_ utterance: AVSpeechUtterance) {
        guard utterance === arbiterUtterance else { return }
        arbiterUtterance = nil
        onFinish?()
    }
}
