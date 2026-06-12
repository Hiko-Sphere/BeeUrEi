import Foundation

/// 聊天文案表（中英双语，E5 惯例）。
enum ChatStrings {
    static func navTitle(_ l: Language) -> String { l == .zh ? "消息" : "Messages" }
    static func empty(_ l: Language) -> String {
        l == .zh ? "还没有对话。绑定的亲友/协助者都可以互发消息——去亲友页添加。"
                 : "No conversations yet. You can message anyone you're linked with — add family first."
    }
    static func inputPlaceholder(_ l: Language) -> String { l == .zh ? "输入消息…" : "Message…" }
    static func send(_ l: Language) -> String { l == .zh ? "发送" : "Send" }
    static func voiceStart(_ l: Language) -> String { l == .zh ? "录语音" : "Record voice" }
    static func voiceStop(_ l: Language) -> String { l == .zh ? "结束并发送" : "Stop & send" }
    static func voiceMessage(_ l: Language) -> String { l == .zh ? "语音消息" : "Voice message" }
    static func playVoice(_ l: Language) -> String { l == .zh ? "播放语音" : "Play voice message" }
    static func recording(_ l: Language) -> String { l == .zh ? "正在录音，再点一次发送" : "Recording — tap again to send" }
    static func read(_ l: Language) -> String { l == .zh ? "已读" : "Read" }
    static func delivered(_ l: Language) -> String { l == .zh ? "已送达" : "Delivered" }
    static func sendFailed(_ l: Language) -> String { l == .zh ? "发送失败，请重试" : "Couldn't send. Try again." }
    static func micDenied(_ l: Language) -> String {
        l == .zh ? "需要麦克风权限才能发语音，请在系统设置中开启" : "Microphone access is needed for voice messages"
    }
    static func newMessageSpeak(_ name: String, _ preview: String, _ l: Language) -> String {
        l == .zh ? "\(name) 发来消息：\(preview)" : "Message from \(name): \(preview)"
    }
    static func newVoiceSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "\(name) 发来语音消息" : "Voice message from \(name)"
    }
    static func unreadBadgeA11y(_ n: Int, _ l: Language) -> String {
        l == .zh ? "\(n) 条未读" : "\(n) unread"
    }
    static func bubbleA11y(from: String, content: String, time: String, _ l: Language) -> String {
        l == .zh ? "\(from)：\(content)，\(time)" : "\(from): \(content), \(time)"
    }
    static func me(_ l: Language) -> String { l == .zh ? "我" : "Me" }
    static func messagesButton(_ l: Language) -> String { l == .zh ? "消息" : "Messages" }
    static func newChat(_ l: Language) -> String { l == .zh ? "发起新对话" : "New chat" }
    static func pickContact(_ l: Language) -> String { l == .zh ? "选择联系人" : "Choose a contact" }
    static func noContacts(_ l: Language) -> String {
        l == .zh ? "还没有绑定的亲友/协助者。先到亲友页发送绑定请求，对方接受后即可聊天。"
                 : "No linked contacts yet. Send a link request on the Family page first; once accepted you can chat."
    }
    static func photo(_ l: Language) -> String { l == .zh ? "图片" : "Photo" }
    static func sendPhoto(_ l: Language) -> String { l == .zh ? "发送图片" : "Send a photo" }
    static func recall(_ l: Language) -> String { l == .zh ? "撤回" : "Unsend" }
    static func recalled(_ l: Language) -> String { l == .zh ? "已撤回" : "Message unsent" }
    static func recallFailed(_ l: Language) -> String {
        l == .zh ? "撤回失败（仅发出 2 分钟内可撤回）" : "Couldn't unsend (only within 2 minutes)"
    }
    static func react(_ l: Language) -> String { l == .zh ? "表情回应" : "React" }
    static func removeReaction(_ l: Language) -> String { l == .zh ? "取消回应" : "Remove reaction" }
    static func reactionA11y(_ emoji: String, _ l: Language) -> String {
        l == .zh ? "对方回应了\(emoji)" : "Reacted with \(emoji)"
    }
    static let reactionChoices = ["👍", "❤️", "😂", "😮", "😢", "🙏"]
    static func timeFormat(_ ms: Int) -> String {
        let d = Date(timeIntervalSince1970: Double(ms) / 1000)
        let f = DateFormatter()
        f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "M月d日 HH:mm"
        return f.string(from: d)
    }
}
