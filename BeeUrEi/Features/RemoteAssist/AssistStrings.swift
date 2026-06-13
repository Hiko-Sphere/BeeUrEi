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
    static func noLinksYet(_ l: Language) -> String {
        l == .zh ? "还没有绑定。下面按对方用户名添加。" : "No links yet. Add someone by username below."
    }
    static func pendingSuffix(_ l: Language) -> String { l == .zh ? " · 待对方接受" : " · awaiting their approval" }
    static func emergencySuffix(_ l: Language) -> String { l == .zh ? " · 紧急联系人" : " · emergency contact" }
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
    static func sendingHelp(_ l: Language) -> String {
        l == .zh ? "正在发起求助，请稍候…" : "Sending your request, please wait…"
    }
    static func helpSent(_ l: Language) -> String {
        l == .zh ? "已发出求助，正在等待志愿者接入…" : "Request sent — waiting for a volunteer to join…"
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
}
