import Foundation

/// 紧急"回执"通知（家人**已收到**求助 emergency_ack / 发起人**报平安** emergency_clear）到达时该朗读的文本。
/// 为何要读：发起 SOS 的是**盲人**，此刻最需要听到"家人已收到、正在赶来"——而系统横幅是视觉的、默认提示音也不传达内容，
/// 对盲人等于没收到（无障碍攸关，且是全 App 最高压场景）。故前台收到这两类推送时用端侧 TTS 读出。
/// 纯逻辑（可单测）：非这两类返回 nil（不打扰）；title/body 都已是用户语言的推送文案，此处仅拼接。
public enum EmergencyReplyAnnouncement {
    public static func spokenText(kind: String?, title: String, body: String, language: Language) -> String? {
        guard kind == "emergency_ack" || kind == "emergency_clear" else { return nil }
        let parts = [title, body]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: language == .zh ? "。" : ". ")
    }
}
