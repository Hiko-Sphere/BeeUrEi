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
        } catch {
            loadFailed = true
        }
        loading = false
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
