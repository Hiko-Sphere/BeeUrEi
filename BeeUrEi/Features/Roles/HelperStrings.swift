import Foundation

/// 协助端主界面文案中心表——E5 多语言主线第九批（帮助大家/我的亲人/我的）。
/// 协助者也可能是英文用户（海外亲友）；匹配/认领状态经 A11y 朗读，必须随语言。中文与历史一致。
enum HelperStrings {

    // MARK: 标签

    static func tabQueue(_ l: Language) -> String { l == .zh ? "帮助大家" : "Help Others" }
    static func tabFamily(_ l: Language) -> String { l == .zh ? "我的亲人" : "My Family" }
    static func tabMe(_ l: Language) -> String { l == .zh ? "我的" : "Me" }

    // MARK: 帮助大家

    // MARK: 协助守则（Aira 范式：只描述、不替对方做安全决策；首次接单前一次性确认，服务端留痕）

    static func guidelineTitle(_ l: Language) -> String {
        l == .zh ? "开始协助前，请了解三条守则" : "Before you help — three ground rules"
    }
    static func guidelineRule1(_ l: Language) -> String {
        l == .zh ? "只描述你所见（如\u{201C}前方三米有台阶\u{201D}），不要替对方做安全决策——可以说\u{201C}灯是绿的\u{201D}，不要说\u{201C}可以走了\u{201D}。"
                 : "Describe what you see (\u{201C}steps three meters ahead\u{201D}). Never make safety decisions for them — say \u{201C}the light is green\u{201D}, not \u{201C}you can go\u{201D}."
    }
    static func guidelineRule2(_ l: Language) -> String {
        l == .zh ? "过马路等高风险时刻，不确定就直说\u{201C}我不确定\u{201D}，行动由对方自己决定。"
                 : "At risky moments like crossings, say \u{201C}I'm not sure\u{201D} when unsure — they decide whether to move."
    }
    static func guidelineRule3(_ l: Language) -> String {
        l == .zh ? "尊重隐私：画面与对话仅用于本次协助，不截屏、不外传。"
                 : "Respect privacy: what you see and hear is for this session only — no screenshots, no sharing."
    }
    static func guidelineConfirm(_ l: Language) -> String { l == .zh ? "我已了解，开始协助" : "Got it — start helping" }
    static func guidelineLater(_ l: Language) -> String { l == .zh ? "暂不" : "Not now" }

    static func matchPrefs(_ l: Language) -> String { l == .zh ? "匹配偏好" : "Match preferences" }
    static func matchPrefsHint(_ l: Language) -> String {
        l == .zh ? "设置随机匹配时优先的语言" : "Choose the preferred language for random matching"
    }
    static func onlineNow(_ l: Language) -> String { l == .zh ? "在线" : "Online" }
    static func onlinePillA11y(_ l: Language) -> String {
        l == .zh ? "在线中，可接听求助与亲人来电" : "Online — reachable for help requests and family calls"
    }
    static func matchRandom(_ l: Language) -> String {
        l == .zh ? "随机匹配一位需要帮助的人" : "Match me with someone who needs help"
    }
    static func queueHeader(_ l: Language) -> String { l == .zh ? "待帮助队列" : "Waiting for help" }
    static func queueLoadFailedTitle(_ l: Language) -> String { l == .zh ? "暂时无法加载" : "Couldn't load" }
    static func queueEmptyTitle(_ l: Language) -> String { l == .zh ? "暂时没有人等待帮助" : "Nobody waiting right now" }
    static func queueLoadFailedMessage(_ l: Language) -> String {
        l == .zh ? "下拉重试，或检查网络。" : "Pull to retry, or check your network."
    }
    static func queueEmptyMessage(_ l: Language) -> String {
        l == .zh ? "有人发起求助时会出现在这里。下拉刷新。" : "New requests appear here. Pull to refresh."
    }
    static func helpThem(_ l: Language) -> String { l == .zh ? "帮助 TA" : "Help them" }
    /// 求助者语言与本协助者一致时的提示（队列里更快认出能沟通的对象）。
    static func yourLanguage(_ l: Language) -> String { l == .zh ? "你的语言" : "your language" }
    static func queueCardA11y(name: String, topic: String?, locality: String?, languageName: String?,
                              waited: String, _ l: Language) -> String {
        switch l {
        case .zh:
            return "求助者 \(name)。"
                + (topic.flatMap { $0.isEmpty ? nil : "事项 " + $0 + "。" } ?? "")
                + (locality.flatMap { $0.isEmpty ? nil : "地点 " + $0 + "。" } ?? "")
                + (languageName.flatMap { $0.isEmpty ? nil : "语言 " + $0 + "。" } ?? "")
                + "已等待\(waited)。"
        case .en:
            return "Requester \(name). "
                + (topic.flatMap { $0.isEmpty ? nil : "Topic: " + $0 + ". " } ?? "")
                + (locality.flatMap { $0.isEmpty ? nil : "Area: " + $0 + ". " } ?? "")
                + (languageName.flatMap { $0.isEmpty ? nil : "Language: " + $0 + ". " } ?? "")
                + "Waiting \(waited)."
        }
    }
    static func queueCardHint(_ l: Language) -> String {
        l == .zh ? "双击接听并帮助 TA" : "Double-tap to answer and help"
    }
    static func anyLanguage(_ l: Language) -> String { l == .zh ? "不限语言" : "Any language" }
    static func prefer(_ name: String, _ l: Language) -> String { l == .zh ? "偏好\(name)" : "Prefer \(name)" }
    static func sameLanguageOnly(_ l: Language) -> String { l == .zh ? "仅同语言" : "Same language only" }
    static func preferredLanguageHeader(_ l: Language) -> String { l == .zh ? "优先语言" : "Preferred language" }
    static func anyOption(_ l: Language) -> String { l == .zh ? "不限" : "Any" }
    static func requireSameLanguage(_ l: Language) -> String {
        l == .zh ? "只匹配同语言的求助" : "Only match same-language requests"
    }
    static func requireSameLanguageFooter(_ l: Language) -> String {
        l == .zh ? "开启后，随机匹配只会匹配与上面所选语言一致的求助；关闭则优先同语言、其次等待最久者。"
                 : "When on, random match only picks requests in the language above; when off it prefers same language, then longest waiting."
    }
    static func done(_ l: Language) -> String { l == .zh ? "完成" : "Done" }

    // MARK: 我的亲人

    static func alwaysOnlineFooter(_ l: Language) -> String {
        l == .zh ? "打开 App 即自动在线：亲人紧急呼叫会在此直接弹出来电，无需手动待命。"
                 : "You're online whenever the app is open — family emergency calls ring here automatically."
    }
    static func pendingHeader(_ l: Language) -> String { l == .zh ? "待你接受的绑定请求" : "Requests awaiting your approval" }
    static func wantsToLink(owner: String, relation: String, emergency: Bool, _ l: Language) -> String {
        l == .zh ? "\(owner) 想把你加为\(relation)\(emergency ? "（紧急联系人）" : "")"
                 : "\(owner) wants to add you as \(relation)\(emergency ? " (emergency contact)" : "")"
    }
    static func accept(_ l: Language) -> String { l == .zh ? "接受" : "Accept" }
    static func reject(_ l: Language) -> String { l == .zh ? "拒绝" : "Decline" }
    static func outgoingHeader(_ l: Language) -> String { l == .zh ? "我发出的请求（待对方确认）" : "My requests (awaiting confirmation)" }
    static func pendingBadge(_ l: Language) -> String { l == .zh ? "待确认" : "Pending" }
    static func withdraw(_ l: Language) -> String { l == .zh ? "撤回" : "Withdraw" }
    static func withdrawA11y(_ name: String, _ l: Language) -> String {
        l == .zh ? "撤回发给 \(name) 的绑定请求" : "Withdraw the link request to \(name)"
    }
    static func familyHeader(_ l: Language) -> String { l == .zh ? "我的亲人 / 求助者" : "My family / requesters" }
    static func noRelationsYet(_ l: Language) -> String {
        l == .zh ? "还没有建立关系。点右上角「＋」按对方用户名发起，或让对方添加你后在上方确认。"
                 : "No links yet. Tap \"+\" to send a request by username, or approve theirs above."
    }
    static func emergencySuffix(_ l: Language) -> String { l == .zh ? " · 紧急联系人" : " · emergency contact" }
    static func callA11y(_ name: String, _ l: Language) -> String { l == .zh ? "呼叫 \(name)" : "Call \(name)" }
    static func familyNavTitle(_ l: Language) -> String { l == .zh ? "我的亲人" : "My Family" }
    static func addFamilyA11y(_ l: Language) -> String { l == .zh ? "添加亲人或求助者" : "Add family or requester" }
    static func addFamilyTitle(_ l: Language) -> String { l == .zh ? "添加亲人 / 求助者" : "Add family / requester" }
    static func usernamePlaceholder(_ l: Language) -> String { l == .zh ? "用户名 / 邮箱 / 手机号" : "Username, email, or phone" }
    static func sendRequest(_ l: Language) -> String { l == .zh ? "发送请求" : "Send request" }
    static func cancel(_ l: Language) -> String { l == .zh ? "取消" : "Cancel" }
    static func addFamilyMessage(_ l: Language) -> String {
        l == .zh ? "输入对方用户名发起绑定请求，对方确认后建立关系。"
                 : "Enter their username to send a link request; the link starts after they confirm."
    }
    static func callingTitle(_ name: String, _ l: Language) -> String { l == .zh ? "呼叫 \(name)" : "Calling \(name)" }
    static func notLinkedYet(_ l: Language) -> String {
        l == .zh ? "对方未确认绑定，暂不能呼叫" : "They haven't confirmed the link yet — can't call"
    }
    static func callFailed(_ l: Language) -> String { l == .zh ? "呼叫失败，请重试" : "Call failed, please retry" }
    static func requestSentTo(_ name: String, _ l: Language) -> String {
        l == .zh ? "已向 \(name) 发送请求，待对方确认" : "Request sent to \(name), awaiting confirmation"
    }
    static func memberNotFound(_ l: Language) -> String { l == .zh ? "找不到该用户名" : "Username not found" }
    static func alreadyLinked(_ l: Language) -> String { l == .zh ? "你们已绑定/已发过请求" : "Already linked or requested" }
    static func blockedRelation(_ l: Language) -> String { l == .zh ? "无法添加：存在拉黑关系" : "Can't add: one of you blocked the other" }
    static func sendFailed(_ l: Language) -> String { l == .zh ? "发送失败" : "Couldn't send" }
    static func sendFailedRetry(_ l: Language) -> String { l == .zh ? "发送失败，请重试" : "Couldn't send, please retry" }

    // MARK: 我的

    static func accountHeader(_ l: Language) -> String { l == .zh ? "账号" : "Account" }
    static func accountAndSecurity(_ l: Language) -> String { l == .zh ? "账号与安全" : "Account & security" }
    static func switchRole(_ l: Language) -> String { l == .zh ? "切换角色" : "Switch role" }
    static func logout(_ l: Language) -> String { l == .zh ? "退出登录" : "Sign out" }
    static func mergedExplain(_ l: Language) -> String {
        l == .zh ? "「协助者」与「亲友」已合并：你既能在「帮助大家」里帮助陌生求助者，也能在「我的亲人」里接听绑定亲人的呼叫。"
                 : "\"Helper\" and \"family\" are one role: help strangers in \"Help Others\" and answer linked family calls in \"My Family\"."
    }
    static func meNavTitle(_ l: Language) -> String { l == .zh ? "我的" : "Me" }

    // MARK: 设置（协助端统一设置页 v3：身份/语言与外观/匹配偏好/法律与帮助）

    static func settingsTitle(_ l: Language) -> String { l == .zh ? "设置" : "Settings" }
    static func languageAppearanceHeader(_ l: Language) -> String { l == .zh ? "语言与外观" : "Language & appearance" }
    static func languageAppearanceFooter(_ l: Language) -> String {
        l == .zh ? "选择 BeeUrEi 用于界面按钮与语音提示的语言。"
                 : "Choose the language BeeUrEi uses for buttons and spoken prompts."
    }
    static func appLanguageLabel(_ l: Language) -> String { l == .zh ? "界面与播报语言" : "App language" }
    static func onlineStatusLabel(_ l: Language) -> String { l == .zh ? "在线状态" : "Online status" }
    static func matchPrefsHeader(_ l: Language) -> String { l == .zh ? "匹配偏好" : "Match preferences" }
    static func legalHelpHeader(_ l: Language) -> String { l == .zh ? "法律与帮助" : "Legal & help" }
    static func aboutHeader(_ l: Language) -> String { l == .zh ? "关于" : "About" }

    // MARK: 动作状态（经 A11y 朗读）

    static func helpingTitle(_ name: String, _ l: Language) -> String { l == .zh ? "正在帮助 \(name)" : "Helping \(name)" }
    static func claimedByOther(_ l: Language) -> String {
        l == .zh ? "手慢了，这条求助已被其他志愿者接走。" : "Too late — another volunteer took this request."
    }
    static func matching(_ l: Language) -> String { l == .zh ? "正在为你匹配…" : "Matching…" }
    static func noSameLanguageRequest(_ l: Language) -> String {
        l == .zh ? "暂时没有符合所选语言的求助。" : "No requests in the selected language right now."
    }
    static func nobodyWaiting(_ l: Language) -> String { l == .zh ? "暂时没有等待帮助的人。" : "Nobody waiting right now." }
    static func matchFailed(_ l: Language) -> String { l == .zh ? "匹配失败，请稍后再试。" : "Matching failed, try again later." }
    static func matchedTitle(_ l: Language) -> String { l == .zh ? "为你匹配到一位需要帮助的人" : "Matched you with someone who needs help" }
    static func skipThisOne(_ l: Language) -> String { l == .zh ? "跳过这一位" : "Skip this one" }
    static func matchResultTitle(_ l: Language) -> String { l == .zh ? "匹配结果" : "Match Result" }
    static func matchedAnnounce(_ label: String, _ l: Language) -> String {
        l == .zh ? "为你匹配到：\(label)" : "Matched: \(label)"
    }
    static func matchedLabel(name: String, topic: String?, locality: String?, languageName: String?, _ l: Language) -> String {
        switch l {
        case .zh:
            return "求助者 \(name)。"
                + (topic.flatMap { $0.isEmpty ? nil : "事项 " + $0 + "。" } ?? "")
                + (locality.flatMap { $0.isEmpty ? nil : "地点 " + $0 + "。" } ?? "")
                + (languageName.flatMap { $0.isEmpty ? nil : "语言 " + $0 + "。" } ?? "")
        case .en:
            return "Requester \(name). "
                + (topic.flatMap { $0.isEmpty ? nil : "Topic: " + $0 + ". " } ?? "")
                + (locality.flatMap { $0.isEmpty ? nil : "Area: " + $0 + ". " } ?? "")
                + (languageName.flatMap { $0.isEmpty ? nil : "Language: " + $0 + ". " } ?? "")
        }
    }

    // MARK: 通知中心

    static func notifBellA11y(_ count: Int, _ l: Language) -> String {
        if count > 0 { return l == .zh ? "通知，\(count) 条待处理" : "Notifications, \(count) pending" }
        return l == .zh ? "通知" : "Notifications"
    }
    static func notifTitle(_ l: Language) -> String { l == .zh ? "通知" : "Notifications" }
    static func updatesHeader(_ l: Language) -> String { l == .zh ? "通知与处理结果" : "Updates" }
    static func noNotifTitle(_ l: Language) -> String { l == .zh ? "暂无新通知" : "No new notifications" }
    static func noNotifMessage(_ l: Language) -> String {
        l == .zh ? "好友请求等待你确认时会出现在这里。" : "Friend requests awaiting your approval appear here."
    }
    static func wantsRelation(owner: String, relation: String, _ l: Language) -> String {
        l == .zh ? "\(owner) 想和你建立\(relation)关系" : "\(owner) wants to link with you as \(relation)"
    }
    static func acceptedAnnounce(_ name: String, _ l: Language) -> String {
        l == .zh ? "已接受 \(name) 的请求" : "Accepted \(name)'s request"
    }
    static func acceptFailed(_ l: Language) -> String { l == .zh ? "接受失败，请重试" : "Couldn't accept — try again" }
    static func rejectFailed(_ l: Language) -> String { l == .zh ? "拒绝失败，请重试" : "Couldn't reject — try again" }
    static func cancelRequestFailed(_ l: Language) -> String { l == .zh ? "撤回失败，请重试" : "Couldn't withdraw — try again" }

    // MARK: 工具

    static func waitText(_ seconds: Int, _ l: Language) -> String {
        switch l {
        case .zh:
            if seconds < 10 { return "刚刚" }
            if seconds < 60 { return "\(seconds) 秒" }
            return "\(seconds / 60) 分钟"
        case .en:
            if seconds < 10 { return "just now" }
            if seconds < 60 { return "\(seconds) s" }
            return "\(seconds / 60) min"
        }
    }
    static func languageName(_ code: String, _ l: Language) -> String {
        switch code {
        case "zh": return l == .zh ? "中文" : "Chinese"
        case "en": return "English"
        default: return code
        }
    }
}
