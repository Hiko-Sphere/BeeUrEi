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

    /// 沿途**信息性** callout（途经地标 / 进入路名）——非时间敏感。走更低的 .query 通道且 droppable：
    /// 时间攸关的转向指令(.navigation > .query)会立即打断它、它绝不排在转向指令之前拖延；
    /// 总线繁忙(正在念转向)时直接丢弃，下次满足节流再报。修"地标播报拖住'现在左转'致错过路口"。
    func speakCallout(_ text: String) {
        SpeechHub.shared.speak(text, channel: .query, droppable: true)
    }

    func stop() { SpeechHub.shared.stopChannel(.navigation) }
}
