import Foundation

/// 紧急类推送到达前台时该朗读的文本——覆盖三类：家人收到的**求助告警** emergency_alert、
/// 发起人收到的**已收到回执** emergency_ack、家人收到的**报平安** emergency_clear。
/// 为何要读：本 App 主用户是**盲人**，且盲人可能互为紧急联系人——系统横幅是视觉的、默认提示音也不传达内容，
/// 对盲人等于没收到，而这是全 App 最高压场景。故前台收到这几类推送时用端侧 TTS 读出（无障碍攸关）。
/// 纯逻辑（可单测）：非这几类返回 nil（不打扰、也不误读来电/普通提醒）；title/body 都已是用户语言的推送文案，此处仅拼接。
public enum EmergencyPushAnnouncement {
    private static let spokenKinds: Set<String> = ["emergency_alert", "emergency_ack", "emergency_clear"]

    public static func spokenText(kind: String?, title: String, body: String, language: Language) -> String? {
        guard let kind, spokenKinds.contains(kind) else { return nil }
        let parts = [title, body]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: language == .zh ? "。" : ". ")
    }
}
