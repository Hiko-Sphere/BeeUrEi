import Foundation
import AVFoundation

/// 导航语音通道（单例）。与避障语音(SpeechFeedback)分通道但**受其仲裁**：
/// 避障 obstacle/critical 级播报会立即掐断正在念的导航指令（Phase 2 成功标准：
/// 「避障语音能打断导航语音、不互相淹没」）。安全语义：碰撞警告 > 转向指令——
/// 转向晚几秒只是绕路，障碍警告晚一秒可能撞上。
final class NavVoice {
    static let shared = NavVoice()
    private let synthesizer = AVSpeechSynthesizer()
    private init() {}

    func speak(_ text: String, rate: Float) {
        let utterance = AVSpeechUtterance(string: text)
        // 按播报语言选嗓音（zh-CN / en-US）：英文文案用英文嗓音才自然（核心 Language.voiceCode）。
        utterance.voice = AVSpeechSynthesisVoice(language: FeatureSettings().language.voiceCode)
        utterance.rate = AVSpeechUtteranceMinimumSpeechRate
            + (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate) * rate
        synthesizer.speak(utterance)
    }

    /// 避障高优先级播报前调用：立即掐断导航语音，给安全警告让路。
    func yieldToSafety() {
        if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    }

    func stop() { synthesizer.stopSpeaking(at: .immediate) }
}
