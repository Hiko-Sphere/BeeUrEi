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
    /// 把发送错误映射成盲人能听懂、不会徒劳重试的具体原因。
    /// 管理员关闭功能 / 维护 / 违禁词 / 已不是联系人等都是"重试也没用"的状态——必须区别于瞬时失败。
    static func sendErrorText(_ error: Error, _ l: Language) -> String {
        guard case let APIError.server(code) = error else { return sendFailed(l) }
        switch code {
        case "feature_disabled":
            return l == .zh ? "聊天功能已被管理员暂时关闭" : "Messaging is currently turned off by the administrator"
        case "maintenance":
            return l == .zh ? "系统维护中，请稍后再试" : "Under maintenance — please try again later"
        case "content_blocked":
            return l == .zh ? "消息含被禁止的内容，未发送" : "Message contains blocked content and wasn't sent"
        case "message_too_long":
            return l == .zh ? "消息太长，请缩短后再发" : "Message is too long — please shorten it"
        case "blocked":
            return l == .zh ? "你们之间存在拉黑，无法发送" : "Can't send — one of you blocked the other"
        case "not_linked":
            return l == .zh ? "对方已不是你的联系人，无法发送" : "This person is no longer your contact"
        case "not_member":
            return l == .zh ? "你已不在该群聊中" : "You're no longer in this group"
        // 以下此前 iOS 漏映射、落到笼统"发送失败，请重试"，而 web chatErrorText 早已区分。前三档由发视频
        // （sendVideo→uploadMedia）真实触达：太大/配额满/格式不支持都是**重试同一文件也没用**，须点明让盲人换文件；
        // too_many_requests 同理，反复重试只会持续被限流（与 web 对齐、跨端一致）。
        case "too_many_requests":
            return l == .zh ? "发送太频繁，请稍候再试。" : "Sending too fast — please wait a moment and try again."
        case "media_too_large":
            return l == .zh ? "视频太大（上限 50MB），请选短一点的。" : "Video too large (50MB max) — pick a shorter one."
        case "media_quota_exceeded":
            return l == .zh ? "你的媒体存储空间已满，请删除一些旧的视频消息。" : "Your media storage is full — delete some old video messages."
        case "unsupported_media_type":
            return l == .zh ? "不支持的文件格式。" : "Unsupported file type."
        default:
            return sendFailed(l)
        }
    }
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
    static func openPhotoHint(_ l: Language) -> String { l == .zh ? "双击全屏查看" : "Double-tap to view full screen" }
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
    static func newPhotoSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "\(name) 发来图片" : "Photo from \(name)"
    }
    static func loadEarlier(_ l: Language) -> String { l == .zh ? "加载更早的消息" : "Load earlier messages" }
    static func searchTitle(_ l: Language) -> String { l == .zh ? "搜索消息" : "Search messages" }
    static func searchPlaceholder(_ l: Language) -> String { l == .zh ? "搜索这个会话的文字消息" : "Search text messages in this chat" }
    static func searchNoResults(_ l: Language) -> String { l == .zh ? "没有找到匹配的消息" : "No matching messages" }
    static func searchPrompt(_ l: Language) -> String { l == .zh ? "输入关键词搜索本会话的文字消息" : "Type a keyword to search this chat's text messages" }
    static func searchResultsCount(_ n: Int, _ l: Language) -> String { l == .zh ? "找到 \(n) 条" : "\(n) found" }
    static func formerMember(_ l: Language) -> String { l == .zh ? "已退群成员" : "Former member" }
    static func close(_ l: Language) -> String { l == .zh ? "关闭" : "Close" }
    static func cancel(_ l: Language) -> String { l == .zh ? "取消" : "Cancel" }

    // MARK: 位置
    static func locationMessage(_ l: Language) -> String { l == .zh ? "位置" : "Location" }
    static func sendLocation(_ l: Language) -> String { l == .zh ? "发送当前位置" : "Send my location" }
    static func locatingNow(_ l: Language) -> String { l == .zh ? "正在获取位置…" : "Getting your location…" }
    static func locationFailed(_ l: Language) -> String {
        l == .zh ? "无法获取位置，请检查定位权限" : "Couldn't get your location — check location permission"
    }
    static func openInMaps(_ l: Language) -> String { l == .zh ? "在地图中打开" : "Open in Maps" }
    /// 紧急告警兜底位置的诚实标注（配核心 EmergencyLocationTag）：绝不把最后已知位置伪装成实时定位。
    static func lastKnownLocationAt(_ time: String, _ l: Language) -> String {
        l == .zh ? "最后已知位置 · \(time)" : "Last known location · \(time)"
    }
    static func lastKnownLocation(_ l: Language) -> String {
        l == .zh ? "最后已知位置（非实时）" : "Last known location (not live)"
    }
    static func unknownPlace(_ l: Language) -> String { l == .zh ? "共享的位置" : "Shared location" }
    static func newLocationSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "\(name) 共享了位置" : "\(name) shared a location"
    }
    static func locationA11y(_ place: String, _ l: Language) -> String {
        // 点按实际启动**步行导航**（openInMaps 用 walking 模式）——如实告知比"打开地图"更有用。
        l == .zh ? "位置：\(place)，点按开始步行导航前往" : "Location: \(place). Tap for walking directions."
    }

    // MARK: 群聊
    static func newGroup(_ l: Language) -> String { l == .zh ? "新建群聊" : "New group" }
    static func groupName(_ l: Language) -> String { l == .zh ? "群名称" : "Group name" }
    static func groupNamePlaceholder(_ l: Language) -> String { l == .zh ? "比如：一家人" : "e.g. Family" }
    static func pickMembers(_ l: Language) -> String { l == .zh ? "选择成员（可多选）" : "Pick members" }
    static func createGroup(_ l: Language) -> String { l == .zh ? "创建群聊" : "Create group" }
    static func createGroupFailed(_ l: Language) -> String { l == .zh ? "建群失败，请重试" : "Couldn't create group" }
    /// 建群错误码 → 可读文案（读屏会朗读）。区分违禁群名/功能关停/维护/成员非联系人，其余回退 createGroupFailed
    /// （此前 catch 一律压成「建群失败，请重试」，含违禁词群名者会用同名反复重试永远建不成，见审计 CROSS-CLIENT-ERR）。
    static func createGroupErrorText(_ error: Error, _ l: Language) -> String {
        guard case let APIError.server(code) = error else { return createGroupFailed(l) }
        switch code {
        case "content_blocked": return l == .zh ? "群名含被禁止的内容，请换一个" : "Group name contains blocked content — please choose another"
        case "feature_disabled": return l == .zh ? "群聊功能已被管理员暂时关闭" : "Groups are currently turned off by the administrator"
        case "maintenance": return l == .zh ? "系统维护中，请稍后再试" : "Under maintenance — please try again later"
        case "not_linked": return l == .zh ? "所选成员中有人已不是你的联系人" : "One of the selected members is no longer your contact"
        default: return createGroupFailed(l)
        }
    }
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
    static func groupActionFailed(_ l: Language) -> String {
        l == .zh ? "操作失败，请重试（仅群主可加人/踢人，群主退群须解散）" : "Action failed — try again (only the owner can add/remove; the owner must dissolve to leave)"
    }
    static func noAddableContacts(_ l: Language) -> String {
        l == .zh ? "没有可添加的联系人（成员须是你的绑定好友）" : "No contacts to add (members must be your linked contacts)"
    }
    // 群操作成功反馈（盲人依赖语音确认）。
    static func groupCreated(_ name: String, _ l: Language) -> String { l == .zh ? "已创建群聊 \(name)" : "Created group \(name)" }
    static func memberAdded(_ name: String, _ l: Language) -> String { l == .zh ? "已添加 \(name)" : "Added \(name)" }
    static func memberRemoved(_ name: String, _ l: Language) -> String { l == .zh ? "已移出 \(name)" : "Removed \(name)" }
    static func leftGroup(_ l: Language) -> String { l == .zh ? "已退出群聊" : "Left the group" }
    static func groupDissolved(_ l: Language) -> String { l == .zh ? "群聊已解散" : "Group dissolved" }
    static func removeMemberConfirm(_ name: String, _ l: Language) -> String {
        l == .zh ? "把 \(name) 移出群聊？" : "Remove \(name) from the group?"
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
        // 随 App 语言本地化日期（避免对英文用户显示中文"M月d日"）。
        f.locale = Locale(identifier: FeatureSettings().language.localeIdentifier)
        f.setLocalizedDateFormatFromTemplate(Calendar.current.isDateInToday(d) ? "Hmm" : "MdHmm")
        return f.string(from: d)
    }
}
