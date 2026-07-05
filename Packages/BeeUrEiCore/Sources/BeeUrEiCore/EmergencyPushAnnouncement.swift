import Foundation

/// 前台收到时该用端侧 TTS 朗读的推送文本。覆盖两类：
/// ① **紧急类**：家人收到的求助告警 emergency_alert、发起人收到的已收到回执 emergency_ack、家人收到的报平安 emergency_clear。
/// ② **账号安全类 security_***：密码/邮箱/手机/用户名变更、新登录、2FA/passkey/Apple 绑解、恢复码重生成等——
///    服务端已让 security_* **越勿扰**（视其重要）。
/// 为何要读：本 App 主用户是**盲人**——系统横幅是视觉的、默认提示音也不传达内容，对盲人等于没收到。紧急类是最高压场景；
/// 账号安全类则是**接管信号**（如"你的密码刚被修改"）：若只静默横幅、要等下次开收件箱才看到，可能已来不及吊销会话——须即时听到。
/// 纯逻辑（可单测）：非这两类返回 nil（不打扰、也不误读来电/好友请求等普通提醒）；title/body 已是用户语言文案，此处仅拼接。
public enum EmergencyPushAnnouncement {
    private static let spokenKinds: Set<String> = ["emergency_alert", "emergency_ack", "emergency_clear"]

    public static func spokenText(kind: String?, title: String, body: String, language: Language) -> String? {
        // security_* 用前缀匹配（16+ 变体，逐个枚举易漏；服务端统一 kind=`security_<event>`）。
        guard let kind, spokenKinds.contains(kind) || kind.hasPrefix("security_") else { return nil }
        let parts = [title, body]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: language == .zh ? "。" : ". ")
    }
}
