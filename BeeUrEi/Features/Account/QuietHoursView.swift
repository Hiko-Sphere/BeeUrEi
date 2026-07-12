import SwiftUI

/// 勿扰时段（Do-Not-Disturb）设置：在设定时段内只抑制**软通知**的推送横幅（好友请求/聊天/到家提醒等），
/// 站内通知照常持久化、次日照见；**紧急告警/来电/SOS 走独立扇出、绝不受影响**。与网页端 Account 勿扰卡片、
/// 服务端 /api/notifications/quiet-hours 同口径。此前 iOS 完全缺此设置（盲人夜里无法免打扰，web 却能设）。

/// 分钟-of-day ↔ Date 转换（纯逻辑，可单测）：DatePicker 绑定 Date，服务端存分钟-of-day [0,1439]。
/// 用设备日历取/设时分；分钟夹取到 [0,1439]（越界脏值不炸 DatePicker）。
enum QuietHoursTime {
    static func date(fromMinuteOfDay m: Int, calendar: Calendar = .current, reference: Date = Date()) -> Date {
        let clamped = min(max(m, 0), 1439)
        return calendar.date(bySettingHour: clamped / 60, minute: clamped % 60, second: 0, of: reference) ?? reference
    }
    static func minuteOfDay(from date: Date, calendar: Calendar = .current) -> Int {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return min(max((c.hour ?? 0) * 60 + (c.minute ?? 0), 0), 1439)
    }
}

enum QuietHoursStrings {
    static func navTitle(_ l: Language) -> String { l == .zh ? "勿扰时段" : "Quiet hours" }
    static func enableLabel(_ l: Language) -> String { l == .zh ? "开启勿扰时段" : "Enable quiet hours" }
    static func startLabel(_ l: Language) -> String { l == .zh ? "开始时间" : "Start time" }
    static func endLabel(_ l: Language) -> String { l == .zh ? "结束时间" : "End time" }
    static func save(_ l: Language) -> String { l == .zh ? "保存" : "Save" }
    static func saved(_ l: Language) -> String { l == .zh ? "已保存" : "Saved" }
    static func saveFailed(_ l: Language) -> String { l == .zh ? "保存失败，请重试" : "Couldn't save — try again" }
    static func loadFailed(_ l: Language) -> String { l == .zh ? "加载失败（需登录并连接后端）" : "Couldn't load (sign in and connect to the backend)" }
    static func explain(_ l: Language) -> String {
        l == .zh ? "此时段内只抑制软通知（好友请求、聊天、到家提醒等）的推送横幅——通知照常保存、次日照见。紧急告警、来电和求助不受影响，随时会响。"
                 : "During these hours, only push banners for soft notifications (friend requests, chat, arrival alerts) are muted — the notifications are still saved and visible later. Emergency alerts, calls and SOS are never affected."
    }
    static func overnightHint(_ l: Language) -> String {
        l == .zh ? "开始晚于结束表示跨夜（如 22:00 到次日 07:00）。" : "A start later than the end spans overnight (e.g. 22:00 to 07:00 next day)."
    }
}

/// 推送分类静音（与 web Account 同文案同语义）：开关 on=**接收**该类推送（未静音），符合直觉。
/// 危急类（紧急告警/来电/SOS/安全报到）服务端保证永不可静音——不在此表，非仅前端不展示。
enum PushCategories {
    /// 内置类别表（与服务端 MUTABLE_CATEGORIES 一致；服务端 available 为权威，此表作旧服务端兜底与文案键）。
    static let known = ["social", "route", "location"]
    static func label(_ key: String, _ l: Language) -> String {
        switch key {
        case "social": return l == .zh ? "社交" : "Social"
        case "route": return l == .zh ? "路线" : "Routes"
        case "location": return l == .zh ? "位置" : "Location"
        default: return key
        }
    }
    static func desc(_ key: String, _ l: Language) -> String {
        switch key {
        case "social": return l == .zh ? "好友请求、群成员变更" : "Friend requests, group changes"
        case "route": return l == .zh ? "亲友为你添加/修改/删除路线" : "Routes added/changed/removed for you"
        case "location": return l == .zh ? "到达/离开常用地点、共享者低电量" : "Place arrivals/departures, low battery"
        default: return ""
        }
    }
    /// 切换后的新静音集合（纯函数可测，视图与测试共用）：receive=true→移出静音；false→加入（去重）。
    static func toggled(muted: [String], key: String, receive: Bool) -> [String] {
        if receive { return muted.filter { $0 != key } }
        return muted.contains(key) ? muted : muted + [key]
    }
    static func header(_ l: Language) -> String { l == .zh ? "按类别静音" : "Mute by category" }
    static func footer(_ l: Language) -> String {
        l == .zh ? "关闭某类即不再收到该类推送横幅（站内通知照常保留）。紧急告警、来电与安全报到永不静音。"
                 : "Turn a category off to stop its push banners (in-app notifications are kept). Emergency alerts, calls and safety check-ins are never muted."
    }
    static func toggleFailed(_ l: Language) -> String { l == .zh ? "设置失败，请重试" : "Couldn't update — try again" }
    static func nowReceiving(_ label: String, _ l: Language) -> String { l == .zh ? "已开启\(label)类推送" : "\(label) push on" }
    static func nowMuted(_ label: String, _ l: Language) -> String { l == .zh ? "已静音\(label)类推送" : "\(label) push muted" }
}

struct QuietHoursView: View {
    let token: String
    @State private var enabled = false
    @State private var startDate = QuietHoursTime.date(fromMinuteOfDay: 22 * 60) // 默认 22:00
    @State private var endDate = QuietHoursTime.date(fromMinuteOfDay: 7 * 60)    // 默认 07:00
    @State private var loading = true
    @State private var loadFailed = false
    @State private var saving = false
    @State private var statusText: String?
    private let api = APIClient()
    private var lang: Language { FeatureSettings().language }

    @State private var mutedCategories: [String] = []
    @State private var availableCategories: [String] = PushCategories.known
    @State private var categoryBusy = false

    var body: some View {
        Form {
            if loading {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            } else if loadFailed {
                Section { Text(QuietHoursStrings.loadFailed(lang)).foregroundStyle(.secondary) }
            } else {
                Section {
                    Toggle(QuietHoursStrings.enableLabel(lang), isOn: $enabled)
                    if enabled {
                        DatePicker(QuietHoursStrings.startLabel(lang), selection: $startDate, displayedComponents: .hourAndMinute)
                        DatePicker(QuietHoursStrings.endLabel(lang), selection: $endDate, displayedComponents: .hourAndMinute)
                        Text(QuietHoursStrings.overnightHint(lang)).font(.caption).foregroundStyle(.secondary)
                    }
                } footer: {
                    Text(QuietHoursStrings.explain(lang))
                }
                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            Text(QuietHoursStrings.save(lang))
                            if saving { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(saving)
                    if let statusText {
                        Text(statusText).font(.footnote).foregroundStyle(.secondary)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
                // 按类别静音（与勿扰时段正交：时段决定何时静、类别决定哪类静）。开关 on=接收（未静音）。
                Section {
                    ForEach(availableCategories, id: \.self) { key in
                        Toggle(isOn: Binding(
                            get: { !mutedCategories.contains(key) },
                            set: { receive in Task { await setCategory(key, receive: receive) } }
                        )) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(PushCategories.label(key, lang))
                                Text(PushCategories.desc(key, lang)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .disabled(categoryBusy)
                    }
                } header: { Text(PushCategories.header(lang)) } footer: { Text(PushCategories.footer(lang)) }
            }
        }
        .navigationTitle(QuietHoursStrings.navTitle(lang))
        .task { await load() }
    }

    private func load() async {
        loading = true; loadFailed = false
        do {
            if let q = try await api.quietHours(token: token) {
                enabled = q.enabled
                startDate = QuietHoursTime.date(fromMinuteOfDay: q.startMinute)
                endDate = QuietHoursTime.date(fromMinuteOfDay: q.endMinute)
            } // nil=未设过：保留默认 22:00→07:00、未开启
            let cats = try await api.getPushCategories(token: token)
            mutedCategories = cats.muted
            if let avail = cats.available, !avail.isEmpty { availableCategories = avail } // 服务端权威表；旧服务端缺省用内置
        } catch {
            loadFailed = true
        }
        loading = false
    }

    /// 切换某类接收/静音：乐观更新（PushCategories.toggled，已测），失败回滚 + 语音告知。
    private func setCategory(_ key: String, receive: Bool) async {
        guard !categoryBusy else { return }
        categoryBusy = true; defer { categoryBusy = false }
        let previous = mutedCategories
        mutedCategories = PushCategories.toggled(muted: mutedCategories, key: key, receive: receive)
        do {
            mutedCategories = try await api.setPushCategories(token: token, muted: mutedCategories) // 服务端规整后回传为准
            let label = PushCategories.label(key, lang)
            A11y.announce(receive ? PushCategories.nowReceiving(label, lang) : PushCategories.nowMuted(label, lang))
        } catch {
            mutedCategories = previous // 回滚，不留"看着已静音实际没生效"的假状态
            A11y.announce(PushCategories.toggleFailed(lang))
        }
    }

    private func save() async {
        saving = true; statusText = nil
        let q = APIClient.QuietHours(enabled: enabled,
                                     startMinute: QuietHoursTime.minuteOfDay(from: startDate),
                                     endMinute: QuietHoursTime.minuteOfDay(from: endDate),
                                     tz: TimeZone.current.identifier) // 设备当前时区（服务端校验须为真实 IANA）
        do {
            let saved = try await api.setQuietHours(token: token, q)
            enabled = saved.enabled
            startDate = QuietHoursTime.date(fromMinuteOfDay: saved.startMinute)
            endDate = QuietHoursTime.date(fromMinuteOfDay: saved.endMinute)
            statusText = QuietHoursStrings.saved(lang)
            A11y.announce(QuietHoursStrings.saved(lang)) // 盲人：保存结果语音确认
        } catch {
            statusText = QuietHoursStrings.saveFailed(lang)
            A11y.announce(QuietHoursStrings.saveFailed(lang))
        }
        saving = false
    }
}
