import Foundation

/// 求助屏（盲人侧远程协助）文案中心表——E5 多语言主线第五批（与 FramingStrings/NavStrings/HomeStrings 同模式）。
/// 求助是盲人侧最关键的链路之一：状态文案会经 onChange 统一朗读，必须随语言。中文输出与历史完全一致。
enum AssistStrings {

    // MARK: 求助主题（发给志愿者的求助类型）

    static func topics(_ l: Language) -> [String] {
        switch l {
        case .zh: return ["看看前面是什么", "读一段文字或标签", "帮我认方向 / 找路", "看看颜色或物品", "其他"]
        case .en: return ["See what's ahead", "Read some text or a label", "Help me find my way", "Check a color or an item", "Other"]
        }
    }
    static func defaultTopic(_ l: Language) -> String { l == .zh ? "需要帮助" : "Need help" }

    // MARK: 在线状态 / 主按钮

    static func onlineCount(_ n: Int, _ l: Language) -> String {
        if n > 0 { return l == .zh ? "\(n) 位协助者/亲友在线" : "\(n) helpers/family online" }
        return l == .zh ? "暂无协助者/亲友在线" : "No helpers or family online"
    }
    static func onlineCountA11y(online: Int, total: Int, _ l: Language) -> String {
        if online > 0 {
            return l == .zh ? "\(online) 位协助者或亲友在线，共 \(total) 位"
                            : "\(online) helpers or family online, \(total) in total"
        }
        return l == .zh ? "暂无协助者或亲友在线" : "No helpers or family online"
    }
    static func totalCount(_ n: Int, _ l: Language) -> String { l == .zh ? "（共 \(n) 位）" : "(\(n) total)" }
    static func wantsRelation(owner: String, relation: String, _ l: Language) -> String {
        l == .zh ? "\(owner) 想和你建立\(relation)关系" : "\(owner) wants to link with you as \(relation)"
    }
    static func callVolunteerTitle(_ l: Language) -> String { l == .zh ? "向志愿者求助" : "Ask a Volunteer" }
    static func callVolunteerSubtitle(_ l: Language) -> String {
        l == .zh ? "让在线的热心志愿者帮你看（陌生人）" : "Let an online volunteer see for you (a stranger)"
    }
    static func callFamilyTitle(_ l: Language) -> String { l == .zh ? "呼叫我的亲友" : "Call My Family" }
    static func callFamilySubtitle(_ l: Language) -> String {
        l == .zh ? "呼叫你已绑定的家人或朋友" : "Call the family or friends you've linked"
    }

    // MARK: 列表 / 工具栏

    static func pendingSection(_ l: Language) -> String { l == .zh ? "待确认的请求" : "Pending requests" }
    static func accept(_ l: Language) -> String { l == .zh ? "接受" : "Accept" }
    static func reject(_ l: Language) -> String { l == .zh ? "拒绝" : "Decline" }
    static func familySection(_ l: Language) -> String { l == .zh ? "我的亲友 / 协助者" : "My family / helpers" }
    static func navTitle(_ l: Language) -> String { l == .zh ? "求助" : "Get Help" }
    static func done(_ l: Language) -> String { l == .zh ? "完成" : "Done" }
    static func addFamilyA11y(_ l: Language) -> String { l == .zh ? "添加亲友" : "Add family" }
    static func addFamilyTitle(_ l: Language) -> String { l == .zh ? "添加亲友" : "Add family" }
    static func usernamePlaceholder(_ l: Language) -> String { l == .zh ? "用户名 / 邮箱 / 手机号" : "Username, email, or phone" }
    static func add(_ l: Language) -> String { l == .zh ? "添加" : "Add" }
    static func cancel(_ l: Language) -> String { l == .zh ? "取消" : "Cancel" }
    static func addFamilyMessage(_ l: Language) -> String {
        l == .zh ? "输入可以帮你看东西的家人或朋友的 App 用户名。"
                 : "Enter the app username of a family member or friend who can see for you."
    }
    static func topicTitle(_ l: Language) -> String { l == .zh ? "你需要什么帮助？" : "What do you need help with?" }
    static func topicMessage(_ l: Language) -> String {
        l == .zh ? "选择后会把你的求助发给在线志愿者，并告诉他们你的大概位置和语言（不含精确地址）。"
                 : "Your request goes to online volunteers with your approximate area and language (no exact address)."
    }
    static func emergencyContact(_ l: Language) -> String { l == .zh ? "紧急联系人" : "Emergency contact" }
    static func callMemberA11y(_ name: String, emergency: Bool, _ l: Language) -> String {
        l == .zh ? "呼叫 \(name)\(emergency ? "，紧急联系人" : "")"
                 : "Call \(name)\(emergency ? ", emergency contact" : "")"
    }
    static func deleteLink(_ l: Language) -> String { l == .zh ? "删除绑定" : "Remove link" }
    static func noFamilyTitle(_ l: Language) -> String { l == .zh ? "还没有绑定亲友" : "No family linked yet" }
    static func noFamilyMessage(_ l: Language) -> String {
        l == .zh ? "点右上角「＋」按用户名添加可以帮你看东西的家人或朋友（对方确认后建立）。"
                 : "Tap \"+\" at top right to add family or friends by username (the link starts after they confirm)."
    }

    // MARK: 亲友与紧急呼叫屏（FamilyLinksView）

    static func emergencyHeader(_ l: Language) -> String { l == .zh ? "紧急呼叫" : "Emergency call" }
    static func emergencyCallFamily(_ l: Language) -> String { l == .zh ? "紧急呼叫亲友" : "Emergency Call Family" }
    static func emergencyCallHint(_ l: Language) -> String {
        l == .zh ? "按优先级依次呼叫标记为紧急联系人的亲友" : "Calls your emergency contacts in priority order"
    }
    /// 无紧急联系人时的主动安全提示：SOS/摔倒告警将无人可通知，提示去设置。
    static func noEmergencyContactWarning(_ l: Language) -> String {
        l == .zh ? "你还没有紧急联系人。紧急求助或摔倒告警将无人可通知——请在下方添加亲友并设为紧急联系人。"
                 : "You have no emergency contacts. SOS and fall alerts will reach no one — add a family member below and mark them as an emergency contact."
    }
    static func noLinksYet(_ l: Language) -> String {
        l == .zh ? "还没有绑定。下面按对方用户名添加。" : "No links yet. Add someone by username below."
    }
    static func pendingSuffix(_ l: Language) -> String { l == .zh ? " · 待对方接受" : " · awaiting their approval" }
    static func emergencySuffix(_ l: Language) -> String { l == .zh ? " · 紧急联系人" : " · emergency contact" }
    /// 对方此刻在线/待命——盲人据此优先呼叫"接得通"的联系人（与 web Family 在线圆点同义，服务端仅 accepted 才为 true）。
    static func onlineSuffix(_ l: Language) -> String { l == .zh ? " · 在线待命" : " · online" }
    static func dial(_ l: Language) -> String { l == .zh ? "拨打" : "Call" }
    static func dialA11y(_ name: String, _ l: Language) -> String {
        l == .zh ? "拨打 \(name) 的电话" : "Phone call \(name)"
    }
    static func addByUsernameHeader(_ l: Language) -> String {
        l == .zh ? "添加亲友（按对方用户名）" : "Add family (by username)"
    }
    static func relationPlaceholder(_ l: Language) -> String { l == .zh ? "关系（如 母亲）" : "Relation (e.g. mother)" }
    static func phonePlaceholder(_ l: Language) -> String {
        l == .zh ? "手机号（可选，App 连不上时电话兜底）" : "Phone (optional, fallback when the app can't connect)"
    }
    static func emergencyToggle(_ l: Language) -> String { l == .zh ? "设为紧急联系人" : "Set as emergency contact" }
    static func familyNavTitle(_ l: Language) -> String { l == .zh ? "亲友与紧急呼叫" : "Family & Emergency Calls" }
    static func loginShort(_ l: Language) -> String { l == .zh ? "请先登录" : "Sign in first" }
    static func loadFailed(_ l: Language) -> String {
        l == .zh ? "加载失败（需登录并连接后端）" : "Couldn't load (sign in and connect to the backend)"
    }
    static func deleteFailed(_ l: Language) -> String { l == .zh ? "删除失败" : "Couldn't remove" }
    static func acceptedOk(_ name: String, _ l: Language) -> String { l == .zh ? "已接受 \(name) 的请求" : "Accepted \(name)'s request" }
    static func acceptFailed(_ l: Language) -> String { l == .zh ? "接受失败，请重试" : "Couldn't accept — try again" }
    static func rejectFailed(_ l: Language) -> String { l == .zh ? "拒绝失败，请重试" : "Couldn't reject — try again" }
    static func noEmergencyTargets(_ l: Language) -> String {
        l == .zh ? "没有可呼叫的亲友，请先添加紧急联系人。" : "Nobody to call — add an emergency contact first."
    }
    static func emergencyCallingPrefix(anyOnline: Bool, _ l: Language) -> String {
        if anyOnline { return l == .zh ? "正在呼叫在线联系人：" : "Calling online contacts: " }
        return l == .zh ? "暂无在线联系人，仍尝试呼叫：" : "Nobody online, trying anyway: "
    }
    static func emergencyFailed(_ l: Language) -> String { l == .zh ? "紧急呼叫发起失败" : "Couldn't start the emergency call" }

    // MARK: 呼叫状态（经 onChange 统一朗读，盲人听到的话）

    static func waitingVolunteer(_ l: Language) -> String {
        l == .zh ? "正在为你寻找愿意帮忙的热心人，请稍候…" : "Finding a willing helper for you, please wait…"
    }
    static func waitingAnswer(_ l: Language) -> String {
        l == .zh ? "正在呼叫，等待对方接听…" : "Calling, waiting for an answer…"
    }
    static func loginFirst(_ l: Language) -> String {
        l == .zh ? "请先在「设置 → 账号」登录" : "Sign in first in Settings → Account"
    }
    static func loadFamilyFailed(_ l: Language) -> String {
        l == .zh ? "加载亲友失败（需连接后端）" : "Couldn't load family (backend connection required)"
    }
    static func memberNotFound(_ l: Language) -> String { l == .zh ? "找不到该用户名" : "Username not found" }
    static func addFailed(_ l: Language) -> String { l == .zh ? "添加失败" : "Couldn't add" }
    static func alreadyLinked(_ l: Language) -> String { l == .zh ? "你们已是亲友/协助者" : "You're already linked" }
    static func blockedRelation(_ l: Language) -> String { l == .zh ? "无法添加：存在拉黑关系" : "Can't add: one of you blocked the other" }
    static func tooManyLinks(_ l: Language) -> String { l == .zh ? "联系人数量已达上限" : "Contact limit reached" }
    static func cannotLinkSelf(_ l: Language) -> String { l == .zh ? "不能添加自己" : "Cannot add yourself" }
    /// 添加联系人成功的语音确认（盲人看不到列表里冒出新条目）：点明加了谁、什么关系；**尤其**确认是否设为紧急联系人
    /// ——设紧急联系人是安全攸关操作，静默成功会让盲人不确定"到底设上没有"，真出事时才发现没配。
    static func contactAdded(name: String, relation: String, isEmergency: Bool, _ l: Language) -> String {
        let rel = relation.trimmingCharacters(in: .whitespaces)
        if l == .zh {
            let base = rel.isEmpty ? "已把\(name)添加为联系人" : "已把\(name)添加为\(rel)"
            return isEmergency ? base + "，并设为紧急联系人" : base
        }
        let base = rel.isEmpty ? "Added \(name) as a contact" : "Added \(name) as \(rel)"
        return isEmergency ? base + ", set as an emergency contact" : base
    }
    static func sendingHelp(_ l: Language) -> String {
        l == .zh ? "正在发起求助，请稍候…" : "Sending your request, please wait…"
    }
    static func helpSent(_ l: Language) -> String {
        l == .zh ? "已发出求助，正在等待志愿者接入…" : "Request sent — waiting for a volunteer to join…"
    }
    /// 新求助进队的 VoiceOver 公告（协助端；与提示音同发）。
    static func newHelpInQueue(_ count: Int, _ l: Language) -> String {
        if l == .zh { return count > 1 ? "有 \(count) 条新的求助等待接听" : "有新的求助等待接听" }
        return count > 1 ? "\(count) new help requests waiting" : "New help request waiting"
    }
    static func helpFailed(_ l: Language) -> String {
        l == .zh ? "求助未送达，请检查网络后重试，或改为呼叫亲友。"
                 : "Request didn't go through. Check your network and retry, or call family instead."
    }
    static func callingFamily(_ l: Language) -> String { l == .zh ? "正在为你呼叫亲友…" : "Calling your family…" }
    static func noCallableFamily(_ l: Language) -> String {
        l == .zh ? "还没有可呼叫的亲友/协助者，请先添加并绑定，或改用「向志愿者求助」。"
                 : "No family or helpers to call yet. Add and link someone first, or ask a volunteer."
    }
    static func callingListPrefix(anyOnline: Bool, _ l: Language) -> String {
        if anyOnline { return l == .zh ? "正在呼叫：" : "Calling: " }
        return l == .zh ? "暂无在线，仍尝试呼叫：" : "Nobody online, trying anyway: "
    }
    static func familyCallFailed(_ l: Language) -> String {
        l == .zh ? "呼叫未送达，请检查网络后重试，或改用电话联系。"
                 : "Call didn't go through. Check your network and retry, or use a phone call instead."
    }
    static func callingOne(_ name: String, _ l: Language) -> String {
        l == .zh ? "正在呼叫：\(name)" : "Calling: \(name)"
    }
    static func callOneFailed(_ name: String, _ l: Language) -> String {
        l == .zh ? "呼叫 \(name) 未送达，请重试或改用电话联系。"
                 : "Couldn't reach \(name). Retry, or use a phone call instead."
    }
    /// 语音"给X打电话"没找到唯一联系人：不猜、不误拨，提示从列表里选。ambiguous=匹配到多个（名字太笼统）。
    static func voiceCallNoContact(_ name: String, ambiguous: Bool, _ l: Language) -> String {
        if ambiguous {
            return l == .zh ? "有多位亲友的名字含「\(name)」，请从下面的联系人里选一位。"
                            : "Several contacts match “\(name)”. Please pick one from the list below."
        }
        return l == .zh ? "没找到叫「\(name)」的亲友，请从下面的联系人里选一位。"
                        : "No contact named “\(name)”. Please pick one from the list below."
    }

    /// 管理员关闭呼叫/求助功能或系统维护时，求助路径返回这些码——必须明确告知是"暂不可用"
    /// 而非网络问题，否则盲人会对着一个被关停的求助按钮反复重试。其余错误回退到 `fallback`。
    static func callErrorText(_ error: Error, fallback: String, _ l: Language) -> String {
        guard case let APIError.server(code) = error else { return fallback }
        switch code {
        case "feature_disabled":
            return l == .zh ? "呼叫功能已被管理员暂时关闭，请改用电话联系亲友。"
                            : "Calling is temporarily turned off by the administrator. Please use a phone call instead."
        case "maintenance":
            return l == .zh ? "系统维护中，呼叫暂不可用，请改用电话联系亲友。"
                            : "Under maintenance — calling is unavailable. Please use a phone call instead."
        // 以下三档此前 iOS 漏映射、落到笼统"呼叫/求助失败"，而 web callErrorText 早已区分——"重试也没用/
        // 已结束"的状态若不点明，盲人会对着注定失败的操作反复重试（与 web 对齐、跨端一致）。
        case "too_many_requests":
            return l == .zh ? "呼叫太频繁，请稍候几秒再试。" : "Too many call attempts — please wait a few seconds and try again."
        case "not_linked":
            return l == .zh ? "你们尚未建立联系，无法呼叫。" : "You're not linked yet, so you can't call."
        case "already_claimed_or_gone":
            return l == .zh ? "这条求助已被其他人接手或已结束。" : "This help request was already taken by someone else or has ended."
        default:
            return fallback
        }
    }
}
