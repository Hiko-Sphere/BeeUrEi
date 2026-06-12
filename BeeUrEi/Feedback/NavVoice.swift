import Foundation

/// 导航语音通道：SpeechHub 总线的 .navigation 通道薄封装（保留既有调用面）。
/// 仲裁规则见 SpeechHub/SpeechGate：避障播报让位（指令积压补播）、来电可打断、
/// 同通道排队顺读（路线预览逐行依赖）、高于识别/查询通道。
final class NavVoice {
    static let shared = NavVoice()
    private init() {}

    func speak(_ text: String, rate: Float) {
        SpeechHub.shared.speak(text, channel: .navigation, rate: rate)
    }

    func stop() { SpeechHub.shared.stopChannel(.navigation) }
}
