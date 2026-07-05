import Foundation

/// 录制回看 / 删除 / 管理员留存 的双语文案（E5）。
enum RecordingStrings {
    static func title(_ l: Language) -> String { l == .zh ? "我的录音" : "My recordings" }
    static func adminTitle(_ l: Language) -> String { l == .zh ? "通话录制" : "Call recordings" }
    static func emptyTitle(_ l: Language) -> String { l == .zh ? "暂无录制" : "No recordings" }
    static func emptyMessage(_ l: Language) -> String { l == .zh ? "通话中录制的内容会出现在这里，可回放或删除。" : "Recordings you make during calls appear here to play back or delete." }
    static func adminEmptyMessage(_ l: Language) -> String { l == .zh ? "全站进行过的通话录制会出现在这里。" : "Call recordings made across the platform appear here." }
    static func play(_ l: Language) -> String { l == .zh ? "播放" : "Play" }
    static func delete(_ l: Language) -> String { l == .zh ? "删除" : "Delete" }
    static func deleteConfirmTitle(_ l: Language) -> String { l == .zh ? "删除这条录制？" : "Delete this recording?" }
    static func deleteConfirmMessage(_ l: Language) -> String { l == .zh ? "将从你的列表移除。为合规与安全，管理员在保留期内仍可查看。" : "It will be removed from your list. For safety and compliance, moderators can still review it during the retention window." }
    static func deleteFailed(_ l: Language) -> String { l == .zh ? "删除失败，请重试" : "Couldn't delete — please try again" }
    static func playFailed(_ l: Language) -> String { l == .zh ? "无法播放该录制" : "Couldn't play this recording" }
    static func mediaGone(_ l: Language) -> String { l == .zh ? "媒体已不可用（可能已过保留期）" : "Media unavailable (may be past retention)" }
    static func loadFailed(_ l: Language) -> String { l == .zh ? "加载失败（需登录并连接网络）" : "Load failed (needs sign-in and a connection)" }

    static func participantsLabel(_ names: [String], _ l: Language) -> String {
        let joined = names.joined(separator: l == .zh ? "、" : ", ")
        return joined.isEmpty ? (l == .zh ? "未知参与者" : "Unknown participants") : joined
    }
    static func durationLabel(_ sec: Int, _ l: Language) -> String {
        let m = sec / 60, s = sec % 60
        return l == .zh ? "时长 \(m) 分 \(s) 秒" : "Duration \(m)m \(s)s"
    }
    static func userDeletedBadge(_ l: Language) -> String { l == .zh ? "用户已删除 · 留存中" : "User-deleted · retained" }
    static func locationPrefix(_ l: Language) -> String { l == .zh ? "地点：" : "Location: " }
    /// 录制原因前缀（知情同意透明度：为何录这通话）。与 web "录制原因/Reason" 同口径；仅原因非空时展示。
    static func reasonPrefix(_ l: Language) -> String { l == .zh ? "录制原因：" : "Reason: " }

    static func timeText(_ ms: Double, _ l: Language) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        let f = DateFormatter()
        f.locale = Locale(identifier: l.localeIdentifier)
        f.dateStyle = .medium
        f.timeStyle = .short
        return f.string(from: date)
    }
}
