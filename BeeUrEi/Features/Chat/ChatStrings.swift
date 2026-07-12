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
    // 会话免打扰（静音只压推送横幅，不影响未读/站内；与 web 单聊/群聊静音同口径）。
    static func mutedBadge(_ l: Language) -> String { l == .zh ? "已静音" : "Muted" }
    static func muteAction(_ l: Language) -> String { l == .zh ? "静音该会话" : "Mute" }
    static func unmuteAction(_ l: Language) -> String { l == .zh ? "取消静音" : "Unmute" }
    static func mutedConfirm(_ l: Language) -> String { l == .zh ? "已静音，不再推送该会话通知" : "Muted — notifications silenced" }
    static func unmutedConfirm(_ l: Language) -> String { l == .zh ? "已取消静音" : "Unmuted" }
    static func muteFailed(_ l: Language) -> String { l == .zh ? "操作失败，请重试" : "Couldn't update — try again" }
    // 编辑已发消息（仅本人文字、15 分钟内；与 web/服务端同门控）。
    static func editAction(_ l: Language) -> String { l == .zh ? "编辑" : "Edit" }
    static func editTitle(_ l: Language) -> String { l == .zh ? "编辑消息" : "Edit message" }
    static func editSave(_ l: Language) -> String { l == .zh ? "保存" : "Save" }
    static func editSaved(_ l: Language) -> String { l == .zh ? "已保存修改" : "Saved" }
    static func editFailed(_ l: Language) -> String { l == .zh ? "编辑失败，可能已超过 15 分钟或网络异常" : "Couldn't edit — the 15-minute window may have passed" }
    // 引用回复（引用某条消息回复；群聊尤其需要分清在回谁哪句；与 web 对齐）。
    static func replyAction(_ l: Language) -> String { l == .zh ? "回复" : "Reply" }
    static func replyingToLabel(_ name: String, _ l: Language) -> String { l == .zh ? "回复 \(name)" : "Replying to \(name)" }
    static func cancelReply(_ l: Language) -> String { l == .zh ? "取消回复" : "Cancel reply" }
    static func repliedUnknown(_ l: Language) -> String { l == .zh ? "一条消息" : "a message" }
    static func replyingToA11y(_ name: String, _ preview: String, _ l: Language) -> String {
        l == .zh ? "正在回复 \(name)：\(preview)" : "Replying to \(name): \(preview)"
    }
    static func replyContextA11y(_ name: String, _ preview: String, _ l: Language) -> String {
        l == .zh ? "回复 \(name)：\(preview)。" : "Reply to \(name): \(preview). "
    }
    // —— 引用跳转（点击引用预览/VoiceOver 自定义操作跳到原消息；与 web '跳到被引用的消息' 同措辞）——
    static func jumpToQuotedAction(_ l: Language) -> String { l == .zh ? "跳到被引用的消息" : "Jump to quoted message" }
    // —— 转发（把内容自包含的消息复制到另一会话；与 web 同语义）——
    static func forwardAction(_ l: Language) -> String { l == .zh ? "转发" : "Forward" }
    static func forwardTo(_ l: Language) -> String { l == .zh ? "转发到" : "Forward to" }
    static func forwardedTo(_ name: String, _ l: Language) -> String { l == .zh ? "已转发给 \(name)" : "Forwarded to \(name)" }
    static func forwardFailed(_ l: Language) -> String { l == .zh ? "转发失败，请重试" : "Forward failed — try again" }
    static func forwardLoadFailed(_ l: Language) -> String {
        l == .zh ? "联系人加载失败，请检查网络后重开转发" : "Couldn't load contacts — check your connection and reopen"
    }
    static func forwardNoTargets(_ l: Language) -> String {
        l == .zh ? "没有可转发的联系人或群。先在亲友页添加联系人。" : "No contacts or groups to forward to. Add contacts on the Family page first."
    }
    static func forwardContactsHeader(_ l: Language) -> String { l == .zh ? "联系人" : "Contacts" }
    static func forwardGroupsHeader(_ l: Language) -> String { l == .zh ? "群聊" : "Groups" }
    /// 会话列表未发送草稿前缀（WhatsApp/Telegram 标配：没写完的话从列表一眼可见，不被新消息盖住）。
    static func draftTag(_ l: Language) -> String { l == .zh ? "草稿" : "Draft" }
    // —— 全局搜索 + 命中跳转 ——
    static func searchAllTitle(_ l: Language) -> String { l == .zh ? "搜索全部消息" : "Search all messages" }
    static func searchJumpHint(_ l: Language) -> String { l == .zh ? "点击前往该消息" : "Tap to go to this message" }
    /// 全局命中的 hint：只打开所属会话（消息级定位是会话内搜索的能力）——不许诺做不到的事。
    static func searchOpenConvHint(_ l: Language) -> String { l == .zh ? "点击打开所属会话" : "Tap to open the conversation" }
    static func searchLocatedSpeak(_ preview: String, _ l: Language) -> String {
        l == .zh ? "已定位：\(preview)" : "Located: \(preview)"
    }
    static func messageNotLoaded(_ l: Language) -> String {
        l == .zh ? "这条消息在更早的位置，请先加载更早的消息再试" : "This message is earlier in the conversation — load earlier messages first"
    }
    /// 跳转后的有声反馈（盲人对滚动本身无感知，必须听到跳到了哪条）。
    static func quotedSpeak(_ name: String, _ preview: String, _ l: Language) -> String {
        l == .zh ? "被引用的消息，\(name)：\(preview)" : "Quoted message from \(name): \(preview)"
    }
    /// 原消息在更早的未加载窗口：诚实引导（此前点了没反应=静默死按钮）。
    static func quotedNotLoaded(_ l: Language) -> String {
        l == .zh ? "被引用的消息在更早的位置，请先加载更早的消息再试" : "The quoted message is earlier in this conversation — load earlier messages first"
    }
    static func pickContact(_ l: Language) -> String { l == .zh ? "选择联系人" : "Choose a contact" }
    static func noContacts(_ l: Language) -> String {
        l == .zh ? "还没有绑定的亲友/协助者。先到亲友页发送绑定请求，对方接受后即可聊天。"
                 : "No linked contacts yet. Send a link request on the Family page first; once accepted you can chat."
    }
    static func photo(_ l: Language) -> String { l == .zh ? "图片" : "Photo" }
    static func sendPhoto(_ l: Language) -> String { l == .zh ? "发送图片" : "Send a photo" }
    static func openPhotoHint(_ l: Language) -> String { l == .zh ? "双击全屏查看" : "Double-tap to view full screen" }
    /// 盲人收到图片看不见内容——端侧 OCR 读出图中文字（亲友拍的处方/时刻表/说明/纸条等）。VoiceOver 自定义操作。
    static func readPhotoText(_ l: Language) -> String { l == .zh ? "读图中的文字" : "Read text in photo" }
    static func readingPhoto(_ l: Language) -> String { l == .zh ? "正在读取图中文字…" : "Reading text in photo…" }
    static func noTextInPhoto(_ l: Language) -> String { l == .zh ? "图中没有识别到文字" : "No text found in this photo" }
    /// 复制图中文字（盲人存下处方/地址/时刻表，粘进备忘录/提醒/地图）：读=听、复制=留存转发，两个独立操作。
    static func copyPhotoText(_ l: Language) -> String { l == .zh ? "复制图中文字" : "Copy text in photo" }
    static func photoTextCopied(_ l: Language) -> String { l == .zh ? "图中文字已复制" : "Text copied" }
    // —— AI 描述照片（读字之外的语义层："超市货架"/"公园长椅上有只猫"）——
    static func describePhoto(_ l: Language) -> String { l == .zh ? "描述这张照片" : "Describe this photo" }
    static func describingPhoto(_ l: Language) -> String { l == .zh ? "正在请 AI 描述照片…" : "Asking AI to describe the photo…" }
    /// 服务端错误码 → 盲人能听懂、不会徒劳重试的具体原因（与 sendErrorText 同范式）。
    static func aiDescribeErrorText(_ code: String, _ l: Language) -> String {
        // 复审：/api/vision 的 10/min 限流由 fastify 插件直接回 "Too Many Requests"（非蛇形码）——
        // 归一化后匹配，否则限流用户听到笼统"重试"（越重试越被限）。
        let normalized = code.lowercased().replacingOccurrences(of: " ", with: "_")
        switch normalized {
        case "ai_not_configured":
            return l == .zh ? "AI 描述服务未配置，请联系管理员" : "AI description isn't configured — contact the administrator"
        case "ai_daily_quota_exceeded":
            return l == .zh ? "今日 AI 描述次数已用完，明天会重置" : "Today's AI description quota is used up — it resets tomorrow"
        case "image_too_large":
            return l == .zh ? "图片太大，无法描述" : "The photo is too large to describe"
        case "too_many_requests":
            return l == .zh ? "请求太频繁，请稍等再试" : "Too many requests — wait a moment and try again"
        case "feature_disabled":
            return l == .zh ? "AI 描述已被管理员关闭" : "AI description is turned off by the administrator"
        default:
            return l == .zh ? "描述失败，请重试" : "Couldn't describe the photo — try again"
        }
    }
    /// 剩余配额提醒（纯门控可测）：付费额度有限，**临近上限（≤3）才提醒**——每次都念"还剩 N 次"是噪声。
    static func quotaRemainingNote(remaining: Int?, _ l: Language) -> String? {
        guard let r = remaining, r <= 3, r >= 0 else { return nil }
        return l == .zh ? "今日 AI 描述还剩 \(r) 次" : "\(r) AI description\(r == 1 ? "" : "s") left today"
    }
    static func recall(_ l: Language) -> String { l == .zh ? "撤回" : "Unsend" }
    static func recalled(_ l: Language) -> String { l == .zh ? "已撤回" : "Message unsent" }
    static func recallFailed(_ l: Language) -> String {
        l == .zh ? "撤回失败（仅发出 2 分钟内可撤回）" : "Couldn't unsend (only within 2 minutes)"
    }
    /// 撤回失败文案：时限过是常态(recallFailed)，但功能关停/维护/限流须点明真因——否则盲人以为"是不是超时了"
    /// 反复重试注定失败的撤回（与 sendErrorText / web chatErrorText 同取向：不可重试的真因要说清）。
    static func recallErrorText(_ error: Error, _ l: Language) -> String {
        guard case let APIError.server(code) = error else { return recallFailed(l) }
        switch code {
        case "feature_disabled":
            return l == .zh ? "聊天功能已被管理员暂时关闭，无法撤回" : "Messaging is turned off by the administrator, so you can't unsend."
        case "maintenance":
            return l == .zh ? "系统维护中，暂时无法撤回" : "Under maintenance — can't unsend right now."
        case "too_many_requests":
            return l == .zh ? "操作太频繁，请稍候再试" : "Too many attempts — please wait a moment."
        default:
            return recallFailed(l) // recall_window_passed / 未知 → "撤回失败（仅发出 2 分钟内可撤回）"
        }
    }
    static func react(_ l: Language) -> String { l == .zh ? "表情回应" : "React" }
    static func removeReaction(_ l: Language) -> String { l == .zh ? "取消回应" : "Remove reaction" }
    // —— 置顶消息（与网页同语义：每会话至多一条，顶部横幅随时可听）——
    static func pinAction(_ l: Language) -> String { l == .zh ? "置顶" : "Pin" }
    static func unpinAction(_ l: Language) -> String { l == .zh ? "取消置顶" : "Unpin" }
    static func pinnedConfirm(_ l: Language) -> String { l == .zh ? "已置顶" : "Pinned" }
    static func unpinnedConfirm(_ l: Language) -> String { l == .zh ? "已取消置顶" : "Unpinned" }
    static func pinFailed(_ l: Language) -> String { l == .zh ? "置顶操作失败，请重试" : "Pin action failed — try again" }
    /// 置顶横幅读屏标签（与网页 aria-label 同措辞）："置顶消息（X 置顶）：预览，点击跳转"。可单测。
    static func pinnedBannerA11y(pinnedByName: String?, preview: String, _ l: Language) -> String {
        let by = (pinnedByName?.isEmpty == false) ? (l == .zh ? "（\(pinnedByName!) 置顶）" : " (pinned by \(pinnedByName!))") : ""
        return l == .zh ? "置顶消息\(by)：\(preview)，点击跳转" : "Pinned message\(by): \(preview), tap to jump"
    }
    /// 置顶消息不在当前已加载窗口时，点横幅改为朗读其内容（盲人要的是"随时可听"，不强依赖滚动定位）。
    static func pinnedSpeakFallback(pinnedByName: String?, preview: String, _ l: Language) -> String {
        let by = (pinnedByName?.isEmpty == false) ? (l == .zh ? "\(pinnedByName!) 置顶：" : "Pinned by \(pinnedByName!): ") : (l == .zh ? "置顶消息：" : "Pinned message: ")
        return by + preview
    }
    static func reactionA11y(_ emoji: String, _ l: Language) -> String {
        l == .zh ? "对方回应了\(emoji)" : "Reacted with \(emoji)"
    }
    /// 逐用户表情胶囊的读屏标签（与网页 aria-label 同措辞）：有名单念"谁回应了"（比只念数字有用），
    /// 无名单（老服务端兜底）退回计数措辞；mine 时点击语义是"取消"。可单测。
    static func reactionChipA11y(emoji: String, names: [String], count: Int, mine: Bool, _ l: Language) -> String {
        let who = names.joined(separator: l == .zh ? "、" : ", ")
        if !who.isEmpty {
            return l == .zh ? "\(emoji)，\(who) 回应\(mine ? "（含你）" : "")，点击\(mine ? "取消" : "也回应")"
                            : "\(emoji), reacted by \(who), tap to \(mine ? "remove yours" : "add yours")"
        }
        return l == .zh ? "\(emoji)，\(count) 人回应\(mine ? "，含你" : "")，点击\(mine ? "取消" : "也回应")"
                        : "\(emoji), \(count) \(count > 1 ? "reactions" : "reaction")\(mine ? ", including you" : ""), tap to \(mine ? "remove" : "add") yours"
    }
    /// 全部胶囊并入气泡整体 a11y 的后缀（视觉胶囊独立可点、有自己的标签；整体标签给"扫读"用户一句总览）。
    static func reactionsSummaryA11y(_ chips: [MessageReactionInfo], _ l: Language) -> String {
        chips.map { c in
            let who = c.names.joined(separator: l == .zh ? "、" : ", ")
            if !who.isEmpty { return l == .zh ? "\(who) 回应了\(c.emoji)" : "\(who) reacted \(c.emoji)" }
            return l == .zh ? "\(c.count) 人回应了\(c.emoji)" : "\(c.count) reacted \(c.emoji)"
        }.joined(separator: l == .zh ? "；" : "; ")
    }
    /// 转发标记（视觉标签 + a11y 后缀）：让收件人知道这条**非发送者原创**——盲人靠 a11y 听到，防误信链式转发内容。
    static func forwardedTag(_ l: Language) -> String { l == .zh ? "已转发" : "Forwarded" }
    /// 编辑标记（视觉 + a11y）：消息发出后被改过（与 web "已编辑" 对齐；盲人此前完全听不到消息被改过）。
    static func editedTag(_ l: Language) -> String { l == .zh ? "已编辑" : "Edited" }
    /// 转发/编辑并入气泡整体 a11y 标签的后缀（视觉标签 accessibilityHidden，故盲人只经此听到）。可单测。
    static func forwardedEditedA11y(forwarded: Bool, edited: Bool, _ l: Language) -> String {
        (forwarded ? "，" + forwardedTag(l) : "") + (edited ? "，" + editedTag(l) : "")
    }
    /// 群已读回执视觉文案（WhatsApp 式，仅自己发的群消息）："已读 N/总"。此前群消息完全无已读反馈。
    static func groupReceipt(_ readBy: Int, _ readTotal: Int, _ l: Language) -> String {
        l == .zh ? "已读 \(readBy)/\(readTotal)" : "Read \(readBy)/\(readTotal)"
    }
    /// 群已读回执 a11y（并入气泡整体标签；"/"读音差，用可读措辞）：盲人靠此听到自己的群消息被几人读了。
    static func groupReceiptA11y(_ readBy: Int, _ readTotal: Int, _ l: Language) -> String {
        l == .zh ? "已读 \(readBy) 人，共 \(readTotal) 人" : "read by \(readBy) of \(readTotal)"
    }
    /// 自己回应/取消/失败的**语音反馈**：盲人看不到表情角标是否加上，长按选表情后须有声确认操作是否生效
    /// （此前成功/失败都静默，盲人完全不知按下的回应有没有成）。added 带上 emoji 便于复核选对了没。
    static func reactionAdded(_ emoji: String, _ l: Language) -> String {
        l == .zh ? "已回应\(emoji)" : "Reacted \(emoji)"
    }
    static func reactionRemoved(_ l: Language) -> String { l == .zh ? "已取消回应" : "Reaction removed" }
    static func reactionFailed(_ l: Language) -> String { l == .zh ? "回应失败，请重试" : "Couldn't react. Try again." }
    /// 对方给"我发的消息"贴了表情——盲人看不到角标，靠此语音得知被回应（WhatsApp 会通知表情回应）。
    static func reactionReceivedSpeak(_ emoji: String, _ l: Language) -> String {
        l == .zh ? "你的消息收到回应\(emoji)" : "Your message got a \(emoji) reaction"
    }
    /// 对方把已发出的消息改了——盲人只听过原文，若改了时间/地点等关键信息会按旧的行动；靠此语音得知修正后的内容。
    static func messageEditedSpeak(_ name: String, _ text: String, _ l: Language) -> String {
        l == .zh ? "\(name)把消息改成：\(text)" : "\(name) edited a message: \(text)"
    }
    /// 对方撤回了一条已见过的消息——盲人只听过原文，若据其行动（如去某处等）会扑空；靠此语音得知那条已作废。
    static func messageRecalledSpeak(_ name: String, _ l: Language) -> String {
        l == .zh ? "\(name)撤回了一条消息" : "\(name) unsent a message"
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
    /// 上传耗时>8秒时的周期性安慰：大视频/弱网下"正在上传"后若长时间静默，盲人会以为卡死/已失败。每 8 秒再报一次
    /// "还在上传"（droppable，不打断结果），让其知道仍在进行、别误以为要重发。快速上传（<8秒）此提示永不触发。
    static func uploadingVideoStill(_ l: Language) -> String { l == .zh ? "还在上传，请稍候…" : "Still uploading, please wait…" }
    static func videoLoadFailed(_ l: Language) -> String { l == .zh ? "视频加载失败" : "Couldn't load video" }
    // 发送成功语音确认：盲人看不到"已送达"的气泡出现，媒体/位置又是异步操作（图片压缩、视频上传、定位反查），
    // 只报进度/失败、成功却静默＝盲人不知到底发出去没有。文字发送即时且高频、用户刚亲手输入，故不在此列（免刷屏）。
    static func photoSent(_ l: Language) -> String { l == .zh ? "照片已发送" : "Photo sent" }
    static func videoSent(_ l: Language) -> String { l == .zh ? "视频已发送" : "Video sent" }
    static func locationSent(_ l: Language) -> String { l == .zh ? "位置已发送" : "Location sent" }
    // 语音是盲人**最自然的输入**（说话代替打字）：录完点发若静默，盲人看不到语音气泡冒出、最不确定发出没有。
    static func voiceSent(_ l: Language) -> String { l == .zh ? "语音已发送" : "Voice message sent" }
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
