import SwiftUI

/// 应用内通知中心：聚合"待我确认的好友/协助请求" + 持久化通知收件箱（如举报处理结果），
/// 给出未读角标与列表。收件箱是可靠来源（推送只是离线提醒，可能丢/未配置）。
@MainActor
@Observable
final class NotificationsCenter {
    static let shared = NotificationsCenter()
    private(set) var pendingRequests: [IncomingLinkInfo] = []
    private(set) var feed: [NotificationInfo] = []   // 站内通知收件箱（时间倒序）
    private(set) var feedUnread = 0
    var unreadCount: Int { pendingRequests.count + feedUnread }

    func refresh() async {
        guard let token = KeychainStore.read() else { pendingRequests = []; feed = []; feedUnread = 0; return }
        if let inc = try? await APIClient().incomingLinks(token: token) {
            pendingRequests = inc.filter { $0.isPending }
        }
        if let n = try? await APIClient().getNotifications(token: token) {
            feed = n.items; feedUnread = n.unread
        }
    }

    /// 把收件箱全部标记已读（打开通知列表即视为看过）——清角标。失败不影响 UI。
    func markFeedRead() async {
        guard feedUnread > 0, let token = KeychainStore.read() else { return }
        try? await APIClient().markAllNotificationsRead(token: token)
        feedUnread = 0
        feed = feed.map { var x = $0; if x.readAt == nil { x = NotificationInfo(id: x.id, userId: x.userId, kind: x.kind, title: x.title, body: x.body, data: x.data, createdAt: x.createdAt, readAt: Date().timeIntervalSince1970 * 1000) }; return x }
    }
}

/// 遇险者医疗信息查看（施救关键）：紧急告警行内按需拉取遇险者的血型/过敏/用药。与网页端 ContactMedicalInfo 同链、
/// 同服务端授权（仅其已接受紧急联系人可读）。此前 iOS 完全缺失——iOS 施救者收到 SOS 却看不到医疗信息、无法转告急救员。
enum EmergencyMedicalStrings {
    static func viewButton(_ l: Language) -> String { l == .zh ? "查看紧急医疗信息" : "View emergency medical info" }
    static func viewButtonEmphasized(_ l: Language) -> String { l == .zh ? "此人有紧急医疗信息，点击查看" : "They have emergency medical info — tap to view" }
    static func heading(_ l: Language) -> String { l == .zh ? "紧急医疗信息" : "Emergency medical info" }
    static func loading(_ l: Language) -> String { l == .zh ? "加载中…" : "Loading…" }
    static func noneProvided(_ l: Language) -> String { l == .zh ? "对方未填写医疗信息" : "No medical info provided" }
    static func denied(_ l: Language) -> String { l == .zh ? "仅遇险者的紧急联系人可查看" : "Only their emergency contacts can view this" }
    static func failed(_ l: Language) -> String { l == .zh ? "加载失败" : "Failed to load" }
    static func updated(_ when: String, _ l: Language) -> String { l == .zh ? "更新于 \(when)" : "Updated \(when)" }
}

/// 紧急告警行内"查看医疗信息"按钮：按需拉取（敏感 PII，服务端会通知本人被查看，故不自动加载）。
/// 拉到后对 VoiceOver 用户**朗读**（A11y.announce 仅 VoiceOver 可闻）——盲人施救者无需摸索即刻听到血型/过敏/用药。
struct EmergencyMedicalButton: View {
    let userId: String
    let emphasize: Bool
    private enum LoadState: Equatable { case idle, loading, ok(text: String, updatedAt: Double?), noneProvided, denied, error }
    @State private var state: LoadState = .idle
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        switch state {
        case .idle:
            Button { Task { await load() } } label: {
                Label(emphasize ? EmergencyMedicalStrings.viewButtonEmphasized(lang) : EmergencyMedicalStrings.viewButton(lang),
                      systemImage: "cross.case.fill")
                    .font(.footnote.weight(emphasize ? .semibold : .regular))
                    .foregroundStyle(emphasize ? Color.beeDanger : Color.beeAccent)
            }
        case .loading:
            Text(EmergencyMedicalStrings.loading(lang)).font(.footnote).foregroundStyle(.secondary)
        case .ok(let text, let updatedAt):
            VStack(alignment: .leading, spacing: 3) {
                Label(EmergencyMedicalStrings.heading(lang), systemImage: "cross.case.fill")
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(text).font(.footnote)
                if let updatedAt {
                    Text(EmergencyMedicalStrings.updated(RecordingStrings.timeText(updatedAt, lang), lang))
                        .font(.caption2).foregroundStyle(.tertiary)
                }
            }
            .padding(8).background(Color.beeHoney.opacity(0.10), in: RoundedRectangle(cornerRadius: 10))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(EmergencyMedicalStrings.heading(lang))。\(text)")
        case .noneProvided, .denied, .error:
            Text(message).font(.footnote).foregroundStyle(.secondary)
        }
    }

    private var message: String {
        switch state {
        case .noneProvided: return EmergencyMedicalStrings.noneProvided(lang)
        case .denied: return EmergencyMedicalStrings.denied(lang)
        default: return EmergencyMedicalStrings.failed(lang)
        }
    }

    private func load() async {
        guard let token = KeychainStore.read() else { state = .error; return }
        state = .loading
        do {
            let info = try await APIClient().contactMedicalInfo(token: token, userId: userId)
            // 家庭端点有记录才 200（无则 404）；空串仍防御性按"未填"处理。
            if info.medicalInfo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                state = .noneProvided
            } else {
                state = .ok(text: info.medicalInfo, updatedAt: info.updatedAt)
                A11y.announce("\(EmergencyMedicalStrings.heading(lang))。\(info.medicalInfo)")
            }
        } catch APIError.server(let code) {
            state = code == "no_medical_info" ? .noneProvided : code == "not_emergency_contact" ? .denied : .error
        } catch {
            state = .error
        }
    }
}

/// 响应者回执 SOS 告警（与网页通知列表/告警横幅同语义、同后端流程）：「我在赶来」（更强安心信号）/
/// 「我已看到」（纯 ack——远在外地去不了的亲友不必谎称"在赶来"或干等，ack 即可停升级重呼）。
/// 此前 iOS 完全缺失——iOS 响应者收到 SOS 只能回拨，遇险者与其余亲友不知道"有人已动身"，
/// 服务端升级重呼也不知道已有人响应（会继续轰炸全体亲友）。
enum EmergencyAckStrings {
    static func onMyWay(_ l: Language) -> String { l == .zh ? "我在赶来" : "I'm on my way" }
    static func seen(_ l: Language) -> String { l == .zh ? "我已看到" : "I've seen it" }
    static func ackedOnMyWay(_ l: Language) -> String { l == .zh ? "已告知对方你正在赶来" : "They'll see you're on the way" }
    static func ackedSeen(_ l: Language) -> String { l == .zh ? "已回执，对方会看到你在响应" : "Acknowledged — they'll see you're responding" }
    static func failed(_ l: Language) -> String { l == .zh ? "回执失败，请重试" : "Couldn't send — try again" }
    static func onMyWayA11y(_ name: String, _ l: Language) -> String { l == .zh ? "我正赶去帮 \(name)" : "Tell \(name) you're on the way" }
    static func seenA11y(_ name: String, _ l: Language) -> String { l == .zh ? "回执：告诉 \(name) 我已看到求助" : "Let \(name) know you've seen the alert" }
    /// 门控（纯函数，可测）：只对**收到的** SOS 告警显示——kind 恒为 emergency_alert（升级重呼复用同 kind，
    /// 自然也显示），且须带 fromId（回执对象）。emergency_clear/emergency_responding/emergency_ack 等
    /// 后续协调通知、以及无 fromId 的关系事件（emergency_contact_set）都不显示。
    static func shouldOffer(kind: String, fromId: String?) -> Bool {
        kind == "emergency_alert" && !(fromId ?? "").isEmpty
    }
}

/// 紧急告警行内回执按钮组。乐观状态机：idle →（点击）sending → acked（就地显示回执状态，防连点）/
/// failed（可重试）。服务端本就幂等去重（同状态 5 分钟一条），连点无害但 UI 仍防。
struct EmergencyAckButtons: View {
    let fromId: String
    let fromName: String
    let eventId: String?
    private enum AckState: Equatable { case idle, sending, acked(onMyWay: Bool), failed }
    @State private var state: AckState = .idle
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        switch state {
        case .idle, .failed:
            VStack(alignment: .leading, spacing: 4) {
                if state == .failed {
                    Text(EmergencyAckStrings.failed(lang)).font(.footnote).foregroundStyle(Color.beeDanger)
                }
                HStack(spacing: BeeSpacing.sm) {
                    Button { Task { await respond(onMyWay: true) } } label: {
                        Label(EmergencyAckStrings.onMyWay(lang), systemImage: "figure.run")
                    }
                    .buttonStyle(.borderedProminent).controlSize(.small)
                    .accessibilityLabel(EmergencyAckStrings.onMyWayA11y(fromName, lang))
                    Button { Task { await respond(onMyWay: false) } } label: {
                        Label(EmergencyAckStrings.seen(lang), systemImage: "checkmark")
                    }
                    .buttonStyle(.bordered).controlSize(.small)
                    .accessibilityLabel(EmergencyAckStrings.seenA11y(fromName, lang))
                }
            }
        case .sending:
            ProgressView().controlSize(.small)
        case .acked(let onMyWay):
            Label(onMyWay ? EmergencyAckStrings.ackedOnMyWay(lang) : EmergencyAckStrings.ackedSeen(lang),
                  systemImage: "checkmark.circle.fill")
                .font(.footnote).foregroundStyle(.secondary)
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    private func respond(onMyWay: Bool) async {
        guard let token = KeychainStore.read() else { state = .failed; return }
        state = .sending
        if await APIClient().postEmergencyAck(token: token, fromId: fromId, eventId: eventId, onMyWay: onMyWay) {
            state = .acked(onMyWay: onMyWay)
            A11y.announce(onMyWay ? EmergencyAckStrings.ackedOnMyWay(lang) : EmergencyAckStrings.ackedSeen(lang))
        } else {
            state = .failed
        }
    }
}

/// 亲友请求共享位置（location_request）的**接收侧**一键响应：盲人用户基本只有 iOS——此前 iOS 不处理
/// 该通知（只显示文字），亲友在网页端点了"请求共享"后对方无从一键响应，请求回路断在最关键的一环。
/// 点按直接走 LiveLocationManager.startSharing()（权限/后台续传/语音播报它自己处理）；首帧位置上报落地后
/// **服务端**自动通知请求者"对方已开始共享"（iter153 回路），客户端无需额外调用。
enum LocationRequestStrings {
    static func share(_ l: Language) -> String { l == .zh ? "开始共享位置" : "Share my location" }
    static func alreadySharing(_ l: Language) -> String { l == .zh ? "已在共享位置，对方可以看到你" : "Already sharing — they can see you" }
    static func started(_ l: Language) -> String { l == .zh ? "已开始共享，对方会收到通知" : "Sharing started — they'll be notified" }
    static func shareA11y(_ name: String, _ l: Language) -> String {
        name.isEmpty ? share(l) : (l == .zh ? "开始共享位置给 \(name)" : "Start sharing your location with \(name)")
    }
    /// 门控（纯函数，可测）：只对亲友的位置共享请求（location_request，带 fromId=请求者）显示；
    /// location_share_started 等回执类、其他 kind 一律不显示。
    static func shouldOffer(kind: String, fromId: String?) -> Bool {
        kind == "location_request" && !(fromId ?? "").isEmpty
    }
}

/// location_request 行内"开始共享位置"按钮：直连 LiveLocationManager（@Observable，sharing 状态自动驱动 UI）。
/// 已在共享→显示状态不显示按钮（服务端对已共享者本就不发此通知，此为旧通知/中途开启的兜底）；
/// 权限被拒→显示引导文案（manager 已语音播报过）。
struct LocationRequestShareButton: View {
    let fromName: String
    @State private var manager = LiveLocationManager.shared
    @State private var tapped = false
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        if manager.sharing {
            Label(tapped ? LocationRequestStrings.started(lang) : LocationRequestStrings.alreadySharing(lang),
                  systemImage: "checkmark.circle.fill")
                .font(.footnote).foregroundStyle(.secondary)
        } else if manager.authorizationDenied && tapped {
            Text(LiveLocationStrings.permissionDenied(lang)).font(.footnote).foregroundStyle(Color.beeDanger)
        } else {
            Button {
                tapped = true
                manager.startSharing()
            } label: {
                Label(LocationRequestStrings.share(lang), systemImage: "location.fill")
                    .font(.footnote.weight(.semibold)).foregroundStyle(Color.beeAccent)
            }
            .accessibilityLabel(LocationRequestStrings.shareA11y(fromName, lang))
        }
    }
}

/// 通知逐 kind 图标（与 web notifIconKind **同键集、同判定顺序**，跨端一致；纯函数可测）。
/// 排序陷阱（与 web 同注释，勿重排）：
/// - emergency_contact（关系事件，人形）须在 emergency→闪电 之前——否则含子串 "emergency" 被误配成 SOS 红闪电。
/// - emergency_clear（报平安，绿勾）/ responding/ack（协调好消息，电话）须在通配 emergency→flash 之前——
///   否则亲友在通知流里把"安心"类误读成又一起新告警。
/// - security/kyc/report 等（盾牌）须在 friend/link/group 之前——security_apple_linked 含子串 "link"。
/// - checkin（安全报到）用盾牌=personal-safety 语义；location_request/route/place 用定位；message_pinned 用图钉键。
enum NotifIcon {
    static func kind(_ kind: String) -> String {
        if kind.contains("emergency_contact") { return "users" }
        if kind == "emergency_clear" { return "check" }
        if kind == "emergency_responding" || kind == "emergency_ack" { return "phone" }
        if kind.contains("emergency") { return "flash" }
        if kind.contains("battery") { return "battery" }
        if kind.contains("call") { return "phone" }
        if kind.contains("report") || kind.contains("moderation") || kind.contains("ban") || kind.contains("kyc")
            || kind.contains("verif") || kind.contains("security") || kind.contains("medical") { return "shield" }
        if kind.contains("checkin") { return "shield" }
        if kind == "message_pinned" { return "pin" }
        if kind.contains("route") || kind.contains("arrival") || kind.contains("place") || kind.contains("location") { return "pin" }
        if kind.contains("friend") || kind.contains("link") || kind.contains("group") { return "users" }
        if kind.contains("record") { return "film" }
        return "bell"
    }
    /// 键 → SF Symbol（视图用；键集与 web 一致，符号按 iOS 习惯选形）。
    static func symbol(forKey key: String) -> String {
        switch key {
        case "users": return "person.2.fill"
        case "flash": return "bolt.fill"
        case "battery": return "battery.25"
        case "phone": return "phone.fill"
        case "shield": return "checkmark.shield.fill"
        case "pin": return "mappin.and.ellipse"
        case "film": return "film.fill"
        case "check": return "checkmark.circle.fill"
        default: return "bell.fill"
        }
    }
}

/// 通知深链（与 web notifDestination 同判定顺序；纯函数可测）：点通知行的「打开」直达对应页面。
/// 排序陷阱同 web：security_apple_linked 含子串 "link" 须先归账户页；emergency_contact 是关系事件归亲友页
/// （真 SOS 告警有专属行内按钮，故意不深链）。iOS 差异（诚实适配，不跳错地方）：
/// - route 类：iOS 无独立路线库页 → 不深链（none）；
/// - group_removed/dissolved：你已进不去那个群，web 落聊天列表，iOS 通知文案已说明一切 → 不深链。
enum NotifDestination: Equatable {
    case account
    case family
    case directChat(peerId: String)
    case groupChat(groupId: String)
    case locations
    case none

    static func destination(kind: String, data: [String: String]?) -> NotifDestination {
        if kind.contains("security") || kind.contains("medical") || kind.contains("kyc") || kind.contains("verif") { return .account }
        if kind.contains("emergency_contact") { return .family }
        if kind.contains("checkin") { return .family }
        if kind.contains("friend") || kind.contains("link") { return .family }
        if kind.contains("group") || kind == "message_pinned" {
            if kind == "group_removed" || kind == "group_dissolved" { return .none }
            if let g = data?["groupId"], !g.isEmpty { return .groupChat(groupId: g) }
            if let f = data?["fromId"], !f.isEmpty { return .directChat(peerId: f) }
            return .none
        }
        if kind.contains("route") { return .none }
        if kind.contains("place") || kind.contains("arrival") || kind.contains("battery") { return .locations }
        if kind == "location_request" || kind == "location_share_started" { return .locations }
        return .none
    }

    /// 链接文案（读屏念得出去处，比笼统"查看"有用）。none 不显链接。
    func label(_ l: Language) -> String {
        switch self {
        case .account: return l == .zh ? "打开账户页" : "Open account"
        case .family: return l == .zh ? "打开亲友页" : "Open family"
        case .directChat: return l == .zh ? "打开会话" : "Open chat"
        case .groupChat: return l == .zh ? "打开群聊" : "Open group chat"
        case .locations: return l == .zh ? "打开位置页" : "Open locations"
        case .none: return ""
        }
    }
}

/// 工具栏铃铛 + 未读角标，点开应用内通知列表。
struct NotificationsBell: View {
    @State private var center = NotificationsCenter.shared
    @State private var show = false

    var body: some View {
        Button { show = true } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bell.fill")
                if center.unreadCount > 0 {
                    Text("\(center.unreadCount)")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        .padding(4).background(Color.beeDanger, in: Circle())
                        .offset(x: 8, y: -8)
                }
            }
        }
        .accessibilityLabel(HelperStrings.notifBellA11y(center.unreadCount, FeatureSettings().language))
        .sheet(isPresented: $show) { NotificationsView() }
        .task { await center.refresh() }
    }
}

/// 应用内通知列表：待确认的请求（接受/拒绝）。
struct NotificationsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthSession.self) private var session
    @State private var center = NotificationsCenter.shared
    @State private var busy: Set<String> = []
    /// 通知列表文案语言（E5）。
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            List {
                if center.pendingRequests.isEmpty && center.feed.isEmpty {
                    Section {
                        BeeEmptyState(systemImage: "bell.slash.fill", title: HelperStrings.noNotifTitle(lang),
                                      message: HelperStrings.noNotifMessage(lang))
                    }
                    .listRowBackground(Color.clear)
                }
                // 持久化通知收件箱（举报处理结果等）。
                if !center.feed.isEmpty {
                    Section(HelperStrings.updatesHeader(lang)) {
                        ForEach(center.feed) { n in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(alignment: .top, spacing: BeeSpacing.sm) {
                                    if n.isUnread {
                                        Circle().fill(Color.beeHoney).frame(width: 8, height: 8).padding(.top, 6)
                                            .accessibilityHidden(true)
                                    }
                                    // 逐 kind 图标（NotifIcon 纯函数已测，与 web 同判定）：SOS 红闪电/报平安绿勾/
                                    // 安全盾牌/位置定位/置顶图钉一眼可辨。纯装饰（语义在标题正文），a11y 隐藏。
                                    let ik = NotifIcon.kind(n.kind)
                                    Image(systemName: NotifIcon.symbol(forKey: ik))
                                        .font(.footnote)
                                        .foregroundStyle(ik == "flash" ? Color.beeDanger : ik == "check" ? Color.beeSuccess : Color.beeHoney)
                                        .frame(width: 20)
                                        .padding(.top, 2)
                                        .accessibilityHidden(true)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(n.title).font(.subheadline.weight(.semibold))
                                        Text(n.body).font(.footnote).foregroundStyle(.secondary)
                                        Text(RecordingStrings.timeText(n.createdAt, lang)).font(.caption2).foregroundStyle(.tertiary)
                                    }
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel("\(n.title). \(n.body)")
                                // 紧急告警带坐标：一键在地图查看对方位置（响应救助的关键信息）。独立可点元素，不并入上面的标签。
                                if let lat = n.data?["lat"], let lon = n.data?["lon"],
                                   let url = URL(string: "https://maps.apple.com/?ll=\(lat),\(lon)&q=\(lat),\(lon)") {
                                    // 诚实标注（核心 EmergencyLocationTag，已测；与网页端同口径）：服务端兜底的
                                    // 「最后已知位置」绝不能伪装成实时定位——协助者会赶去错误地点。
                                    let loc = EmergencyLocationTag.info(data: n.data, createdAtMs: n.createdAt)
                                    let label = loc.stale
                                        ? (loc.fixAtMs.map { ChatStrings.lastKnownLocationAt(RecordingStrings.timeText($0, lang), lang) }
                                           ?? ChatStrings.lastKnownLocation(lang))
                                        : ChatStrings.openInMaps(lang)
                                    Link(destination: url) {
                                        Label(label, systemImage: loc.stale ? "exclamationmark.triangle" : "mappin.and.ellipse").font(.footnote)
                                    }
                                    .padding(.leading, n.isUnread ? 16 : 0)
                                }
                                // 回执 SOS 告警：「我在赶来」/「我已看到」——回告遇险者有人在响应 + 停止服务端升级重呼。
                                // 只对收到的 emergency_alert 显示（EmergencyAckStrings.shouldOffer，纯函数已测）；与网页通知列表对等。
                                if EmergencyAckStrings.shouldOffer(kind: n.kind, fromId: n.data?["fromId"]) {
                                    EmergencyAckButtons(fromId: n.data?["fromId"] ?? "",
                                                        fromName: n.data?["fromName"] ?? "",
                                                        eventId: n.data?["eventId"])
                                        .padding(.leading, n.isUnread ? 16 : 0)
                                }
                                // 紧急告警：按需查看遇险者医疗信息（血型/过敏/用药）——与网页通知列表一致，施救关键。
                                // fromId 门天然排除关系事件（emergency_contact_set 无 fromId）。hasMedical=1 时醒目提示。
                                if n.kind.contains("emergency"), let fromId = n.data?["fromId"], !fromId.isEmpty {
                                    EmergencyMedicalButton(userId: fromId, emphasize: n.data?["hasMedical"] == "1")
                                        .padding(.leading, n.isUnread ? 16 : 0)
                                }
                                // 亲友请求共享位置：一键开始共享（LocationRequestStrings.shouldOffer 纯函数门控，已测）。
                                // 首帧上报落地后服务端自动回执请求者，这里无需再调接口。
                                if LocationRequestStrings.shouldOffer(kind: n.kind, fromId: n.data?["fromId"]) {
                                    LocationRequestShareButton(fromName: n.data?["fromName"] ?? "")
                                        .padding(.leading, n.isUnread ? 16 : 0)
                                }
                                // 通知深链（NotifDestination 纯函数已测，与 web 同判定）：直达对应页面。
                                // 独立链接元素而非整行可点——行内已有回执/共享等按钮，整行手势会与之冲突；
                                // 读屏用户也因此得到明确的"打开X页"独立元素。
                                let dest = NotifDestination.destination(kind: n.kind, data: n.data)
                                if dest != .none {
                                    NavigationLink { destinationView(dest, n: n) } label: {
                                        Label(dest.label(lang), systemImage: "arrow.forward.circle")
                                            .font(.footnote).foregroundStyle(Color.beeAccent)
                                    }
                                    .padding(.leading, n.isUnread ? 16 : 0)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
                if !center.pendingRequests.isEmpty {
                    Section(HelperStrings.pendingHeader(lang)) {
                        ForEach(center.pendingRequests) { r in
                            VStack(alignment: .leading, spacing: BeeSpacing.sm) {
                                HStack {
                                    AvatarView(dataURL: r.ownerAvatar, name: r.ownerName, size: 36)
                                    Text(HelperStrings.wantsRelation(owner: r.ownerName, relation: r.relation, lang))
                                    // 请求方实名徽标：决定是否接受一段安全关系时该看到（与列表徽标同源）。
                                    if r.showsVerifiedBadge {
                                        Image(systemName: "checkmark.seal.fill")
                                            .font(.caption).foregroundStyle(Color.beeSuccess)
                                            .accessibilityHidden(true) // 语义并入下方整行 label
                                    }
                                }
                                HStack {
                                    Button(HelperStrings.accept(lang)) { Task { await accept(r) } }
                                        .buttonStyle(.borderedProminent).disabled(busy.contains(r.id))
                                    Button(HelperStrings.reject(lang), role: .destructive) { Task { await reject(r) } }
                                        .buttonStyle(.bordered).disabled(busy.contains(r.id))
                                }
                            }
                            .padding(.vertical, 4)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel(HelperStrings.wantsRelation(owner: r.ownerName, relation: r.relation, lang)
                                + (r.showsVerifiedBadge ? "，" + AssistStrings.verifiedA11y(lang) : ""))
                        }
                    }
                }
            }
            .navigationTitle(HelperStrings.notifTitle(lang))
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(HelperStrings.done(lang)) { dismiss() } } }
            .refreshable { await center.refresh() }
            .task { await center.refresh() }
            .onDisappear { Task { await center.markFeedRead() } } // 打开过即视为看过收件箱 → 清角标
        }
    }

    /// 深链目的地视图（NotifDestination → 具体页面）。ChatView 名字用通知 data 的 fromName/groupName，
    /// 缺省空串（ChatView 自会刷新详情）；位置页 isBlind 按当前身份。
    @ViewBuilder private func destinationView(_ dest: NotifDestination, n: NotificationInfo) -> some View {
        switch dest {
        case .account: LoginView()
        case .family: FamilyLinksView()
        case .directChat(let pid):
            ChatView(session: session, target: .direct(peerId: pid, name: n.data?["fromName"] ?? "", avatar: nil))
        case .groupChat(let gid):
            ChatView(session: session, target: .group(id: gid, name: n.data?["groupName"] ?? ""))
        case .locations: LiveLocationView(isBlind: session.user?.role == "blind")
        case .none: EmptyView()
        }
    }

    private func accept(_ r: IncomingLinkInfo) async {
        guard let token = KeychainStore.read(), !busy.contains(r.id) else { return }
        busy.insert(r.id); defer { busy.remove(r.id) }
        // 此前用 try? 吞错后无条件播报"已接受"——失败时给盲人**虚假成功确认**。改为成功才报成功。
        do {
            try await APIClient().acceptFamilyLink(token: token, id: r.id)
            A11y.announce(HelperStrings.acceptedAnnounce(r.ownerName, lang))
        } catch {
            A11y.announce(HelperStrings.acceptFailed(lang))
        }
        await center.refresh()
    }
    private func reject(_ r: IncomingLinkInfo) async {
        guard let token = KeychainStore.read(), !busy.contains(r.id) else { return }
        busy.insert(r.id); defer { busy.remove(r.id) }
        do { try await APIClient().deleteFamilyLink(token: token, id: r.id) }
        catch { A11y.announce(HelperStrings.rejectFailed(lang)) }
        await center.refresh()
    }
}
