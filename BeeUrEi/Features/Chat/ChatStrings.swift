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

    // MARK: 视频消息
    static func video(_ l: Language) -> String { l == .zh ? "视频" : "Video" }
    static func videoMessage(_ l: Language) -> String { l == .zh ? "视频消息" : "Video message" }
    static func playVideo(_ l: Language) -> String { l == .zh ? "播放视频" : "Play video" }
    static func sendMedia(_ l: Language) -> String { l == .zh ? "发送照片或视频" : "Send a photo or video" }
    static func videoTooLarge(_ l: Language) -> String {
        l == .zh ? "视频太大（上限 50MB），请选短一点的视频" : "Video too large (50MB max). Pick a shorter one."
    }
    static func uploadingVideo(_ l: Language) -> String { l == .zh ? "正在上传视频…" : "Uploading video…" }
    static func videoLoadFailed(_ l: Language) -> String { l == .zh ? "视频加载失败" : "Couldn't load video" }
    static func newVideoSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "\(name) 发来视频" : "Video from \(name)"
    }
    static func close(_ l: Language) -> String { l == .zh ? "关闭" : "Close" }

    // MARK: 位置
    static func locationMessage(_ l: Language) -> String { l == .zh ? "位置" : "Location" }
    static func sendLocation(_ l: Language) -> String { l == .zh ? "发送当前位置" : "Send my location" }
    static func locatingNow(_ l: Language) -> String { l == .zh ? "正在获取位置…" : "Getting your location…" }
    static func locationFailed(_ l: Language) -> String {
        l == .zh ? "无法获取位置，请检查定位权限" : "Couldn't get your location — check location permission"
    }
    static func openInMaps(_ l: Language) -> String { l == .zh ? "在地图中打开" : "Open in Maps" }
    static func unknownPlace(_ l: Language) -> String { l == .zh ? "共享的位置" : "Shared location" }
    static func newLocationSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "\(name) 共享了位置" : "\(name) shared a location"
    }
    static func locationA11y(_ place: String, _ l: Language) -> String {
        l == .zh ? "位置：\(place)，点按可在地图中打开" : "Location: \(place). Tap to open in Maps."
    }

    // MARK: 群聊
    static func newGroup(_ l: Language) -> String { l == .zh ? "新建群聊" : "New group" }
    static func groupName(_ l: Language) -> String { l == .zh ? "群名称" : "Group name" }
    static func groupNamePlaceholder(_ l: Language) -> String { l == .zh ? "比如：一家人" : "e.g. Family" }
    static func pickMembers(_ l: Language) -> String { l == .zh ? "选择成员（可多选）" : "Pick members" }
    static func createGroup(_ l: Language) -> String { l == .zh ? "创建群聊" : "Create group" }
    static func createGroupFailed(_ l: Language) -> String { l == .zh ? "建群失败，请重试" : "Couldn't create group" }
    static func groupInfo(_ l: Language) -> String { l == .zh ? "群信息" : "Group info" }
    static func members(_ n: Int, _ l: Language) -> String { l == .zh ? "\(n) 名成员" : "\(n) members" }
    static func owner(_ l: Language) -> String { l == .zh ? "群主" : "Owner" }
    static func addMember(_ l: Language) -> String { l == .zh ? "添加成员" : "Add member" }
    static func removeMember(_ l: Language) -> String { l == .zh ? "移出群聊" : "Remove" }
    static func leaveGroup(_ l: Language) -> String { l == .zh ? "退出群聊" : "Leave group" }
    static func dissolveGroup(_ l: Language) -> String { l == .zh ? "解散群聊" : "Dissolve group" }
    static func dissolveConfirm(_ l: Language) -> String {
        l == .zh ? "解散后所有群消息将被删除，确定吗？" : "Dissolving deletes all group messages. Are you sure?"
    }
    static func leaveConfirm(_ l: Language) -> String {
        l == .zh ? "退出后将不再收到此群消息，确定吗?" : "You'll stop receiving this group's messages. Leave?"
    }
    static func noAddableContacts(_ l: Language) -> String {
        l == .zh ? "没有可添加的联系人（成员须是你的绑定好友）" : "No contacts to add (members must be your linked contacts)"
    }
    static func groupBubbleA11y(from: String, content: String, time: String, _ l: Language) -> String {
        l == .zh ? "\(from)：\(content)，\(time)" : "\(from): \(content), \(time)"
    }
    static func newGroupMessageSpeak(_ name: String, _ group: String, _ preview: String, _ l: Language) -> String {
        l == .zh ? "\(group)群，\(name)说：\(preview)" : "In \(group), \(name) says: \(preview)"
    }
    static func timeFormat(_ ms: Int) -> String {
        let d = Date(timeIntervalSince1970: Double(ms) / 1000)
        let f = DateFormatter()
        f.dateFormat = Calendar.current.isDateInToday(d) ? "HH:mm" : "M月d日 HH:mm"
        return f.string(from: d)
    }
}
