import SwiftUI
import UIKit

extension FamilyLinkInfo {
    /// 是否有"可用的紧急联系人"（已接受 ∧ 标为紧急）——SOS/紧急告警的扇出**只走这类**（服务端 linksByOwner∧isEmergency）。
    /// 无则紧急求助/摔倒告警**无人可通知**，属静默的假安心，须提前提示本人设置。纯逻辑可单测。
    static func hasUsableEmergencyContact(in links: [FamilyLinkInfo]) -> Bool {
        links.contains { $0.isAccepted && $0.isEmergency }
    }
}

/// 视障侧：亲友绑定（后端 /api/family）+ 紧急呼叫（/api/emergency/trigger 取优先级目标）+ 电话兜底。
struct FamilyLinksView: View {
    @State private var links: [FamilyLinkInfo] = []
    @State private var loaded = false            // 首次加载完成才判"无紧急联系人"，避免加载中闪现警告
    @State private var newUsername = ""
    @State private var newRelation = ""
    @State private var newPhone = ""
    @State private var isEmergency = false
    @State private var errorText: String?
    @State private var emergencyInfo: String?
    @State private var successText: String?   // 添加成功等正向确认——盲人看不到列表更新，须主动播报
    @State private var emergencyCall: CallSession?
    @State private var reportTarget: FamilyLinkInfo?   // 举报某联系人（信任与安全）；长按行触发
    @State private var api = APIClient()
    /// 亲友屏文案语言（E5）。
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        List {
            if let errorText {
                Section { Text(errorText).foregroundStyle(Color.beeDanger) }
            }

            Section(AssistStrings.emergencyHeader(lang)) {
                Button {
                    Task { await triggerEmergency() }
                } label: {
                    Label(AssistStrings.emergencyCallFamily(lang), systemImage: "sos.circle.fill")
                        .foregroundStyle(Color.beeDanger).font(.headline)
                }
                .accessibilityHint(AssistStrings.emergencyCallHint(lang))
                if let emergencyInfo {
                    Text(emergencyInfo).font(.footnote).foregroundStyle(.secondary)
                }
                // 主动安全提示：还没有"已接受的紧急联系人"时，SOS/摔倒告警将无人可通知（静默假安心）——
                // 提前在此醒目提示去设置，别等真出事触发 SOS 才发现"没有可通知的亲友"。
                if loaded && !FamilyLinkInfo.hasUsableEmergencyContact(in: links) {
                    Label(AssistStrings.noEmergencyContactWarning(lang), systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote).foregroundStyle(Color.beeDanger)
                        .accessibilityLabel(AssistStrings.noEmergencyContactWarning(lang))
                }
            }

            // 安全报到（dead-man's switch）：独自出行前设时限，到点未报平安则自动告警亲友。放在紧急功能区。
            if let token = KeychainStore.read() {
                Section {
                    NavigationLink { SafetyCheckInView(token: token) } label: {
                        Label(SafetyStrings.entry(lang), systemImage: "timer")
                    }
                }
            }

            Section(AssistStrings.familySection(lang)) {
                if links.isEmpty {
                    Text(AssistStrings.noLinksYet(lang)).foregroundStyle(.secondary)
                } else {
                    ForEach(links) { l in
                        HStack {
                            VStack(alignment: .leading) {
                                HStack(spacing: 6) {
                                    // 在线圆点（明眼/低视力用；语义由下方 caption 的"在线待命"承载，不靠颜色单独表意）。
                                    if l.online == true {
                                        Circle().fill(Color.beeSuccess).frame(width: 8, height: 8)
                                            .accessibilityHidden(true)
                                    }
                                    Text(l.memberName)
                                }
                                Text(l.relation
                                     + (l.isEmergency ? AssistStrings.emergencySuffix(lang) : "")
                                     + (l.online == true ? AssistStrings.onlineSuffix(lang) : "")
                                     + (l.isPending ? AssistStrings.pendingSuffix(lang) : ""))
                                    .font(.caption).foregroundStyle(l.isPending ? Color.beeWarn : .secondary)
                            }
                            Spacer()
                            if let phone = l.phone, !phone.isEmpty {
                                Button {
                                    // 经核心消毒（空格/连字符/括号会让裸插值的 URL(string:) 返回 nil——拨号静默失败）。
                                    if let s = EmergencyPhoneFallback.telURLString(phone), let url = URL(string: s) { UIApplication.shared.open(url) }
                                } label: {
                                    Label(AssistStrings.dial(lang), systemImage: "phone.fill")
                                }
                                .buttonStyle(.bordered)
                                .accessibilityLabel(AssistStrings.dialA11y(l.memberName, lang))
                            }
                        }
                        // 举报该联系人（信任与安全）：长按=VoiceOver「操作」转子里也可达。骚扰通常经聊天/通话就地举报，
                        // 此处补齐"从联系人举报"（对齐 web 亲友页；监护人发现不良协助者时可直接举报）。复用通话侧 ReportSheet。
                        .contextMenu {
                            Button(role: .destructive) { reportTarget = l } label: {
                                Label(CallStrings.reportShort(lang), systemImage: "flag")
                            }
                        }
                    }
                    .onDelete { idx in
                        idx.map { links[$0] }.forEach { l in Task { await remove(l) } }
                    }
                }
            }

            Section(AssistStrings.addByUsernameHeader(lang)) {
                TextField(AssistStrings.usernamePlaceholder(lang), text: $newUsername)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField(AssistStrings.relationPlaceholder(lang), text: $newRelation)
                TextField(AssistStrings.phonePlaceholder(lang), text: $newPhone)
                    .keyboardType(.phonePad)
                Toggle(AssistStrings.emergencyToggle(lang), isOn: $isEmergency)
                Button(AssistStrings.add(lang)) { Task { await add() } }
                    .disabled(newUsername.trimmingCharacters(in: .whitespaces).count < 3)
            }
        }
        .navigationTitle(AssistStrings.familyNavTitle(lang))
        // 错误/紧急状态/成功确认都主动朗读——盲人看不到屏幕上的提示（见 P2 审计）。
        // 用 announce()（非裸 A11y.announce）：本视图是视障侧，未开 VoiceOver 的盲人用户也须用 App 语音听到。
        .onChange(of: errorText) { _, e in if let e, !e.isEmpty { announce(e) } }
        .onChange(of: emergencyInfo) { _, m in if let m, !m.isEmpty { announce(m) } }
        .onChange(of: successText) { _, s in if let s, !s.isEmpty { announce(s) } }
        .task { await load() }
        .fullScreenCover(item: $emergencyCall) { s in
            CallView(role: .blind, callId: s.id) {
                // 挂断时取消待接登记，避免对端在 TTL 内仍弹出已结束的来电。
                if let token = KeychainStore.read() { Task { await api.cancelCall(token: token, callId: s.id) } }
                emergencyCall = nil
            }
        }
        .sheet(item: $reportTarget) { target in
            // 联系人举报无通话录制可附，canAttach=false；提交只带 targetUserId+理由（服务端 callId 可选）。复用通话侧 ReportSheet。
            ReportSheet(lang: lang, canAttach: false,
                        onSubmit: { reason, _ in reportTarget = nil; Task { await submitReport(target: target, reason: reason) } },
                        onCancel: { reportTarget = nil })
        }
    }

    /// 举报某联系人（无通话录制，callId=nil）。结果双路语音回执（盲人看不到 sheet 关闭之外的确认）。复用 CallStrings.reported/reportFailed。
    private func submitReport(target: FamilyLinkInfo, reason: String) async {
        guard let token = KeychainStore.read() else { return }
        do {
            try await api.submitReport(token: token, targetUserId: target.memberId, callId: nil, reason: reason)
            announce(CallStrings.reported(lang))
        } catch {
            announce(CallStrings.reportFailed(lang))
        }
    }

    private func load() async {
        guard let token = KeychainStore.read() else { errorText = AssistStrings.loginFirst(lang); return }
        do { links = try await api.familyLinks(token: token); errorText = nil; loaded = true }
        catch { errorText = AssistStrings.loadFailed(lang) }
    }

    /// 视障侧统一播报：VoiceOver 开→系统公告即可；未开→用 App 语音（SpeechHub .query）念出来，
    /// 让**不用 VoiceOver 的盲人用户**也不漏听错误/紧急状态/成功确认（与 LiveLocationManager.announce 同口径）。
    private func announce(_ text: String) {
        A11y.announce(text)
        if !UIAccessibility.isVoiceOverRunning {
            SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode)
        }
    }

    private func add() async {
        guard let token = KeychainStore.read() else { errorText = AssistStrings.loginShort(lang); return }
        do {
            // 用户名 / 邮箱 / 手机号均可：先精确查人，再按 userId 添加（newPhone 是对方的真实电话，用于 tel:// 兜底）。
            let target = try await api.lookupUser(token: token, query: newUsername.trimmingCharacters(in: .whitespaces))
            try await api.addFamilyLink(token: token, userId: target.id,
                                        relation: newRelation, isEmergency: isEmergency,
                                        phone: newPhone.trimmingCharacters(in: .whitespaces))
            // 成功确认须在清空字段**之前**取值——尤其点明是否设为紧急联系人（安全攸关，静默成功会让盲人不确定设上没）。
            errorText = nil
            successText = AssistStrings.contactAdded(name: target.displayName, relation: newRelation, isEmergency: isEmergency, lang)
            newUsername = ""; newRelation = ""; newPhone = ""; isEmergency = false
            await load()
        } catch let APIError.server(msg) {
            // 不把原始后端错误码直接念给用户——映射到可读文案（读屏会朗读，须人话；见 P2 审计）。
            switch msg {
            case "member_not_found": errorText = AssistStrings.memberNotFound(lang)
            case "already_linked": errorText = AssistStrings.alreadyLinked(lang)
            case "blocked": errorText = AssistStrings.blockedRelation(lang)
            case "too_many_links": errorText = AssistStrings.tooManyLinks(lang)
            case "cannot_link_self": errorText = AssistStrings.cannotLinkSelf(lang)
            // 门控/维护/违禁词此前落 default→「添加失败，请重试」，盲人对已关停功能徒劳重试（见审计 CROSS-CLIENT-ERR）。
            case "feature_disabled": errorText = lang == .zh ? "该功能已被管理员暂时关闭" : "This feature is currently turned off by the administrator"
            case "maintenance": errorText = lang == .zh ? "系统维护中，请稍后再试" : "Under maintenance — please try again later"
            case "content_blocked": errorText = lang == .zh ? "该内容不被允许，请换一个" : "That content isn't allowed — please try another"
            default: errorText = AssistStrings.addFailed(lang)
            }
        } catch { errorText = AssistStrings.addFailed(lang) }
    }

    private func remove(_ link: FamilyLinkInfo) async {
        guard let token = KeychainStore.read() else { return }
        do {
            try await api.deleteFamilyLink(token: token, id: link.id)
            await load()
            // 删成功确认（盲人看不到那行消失）；删的是紧急联系人且删后已无可用紧急联系人时追加安全提醒。
            let noEmergencyLeft = link.isEmergency && !FamilyLinkInfo.hasUsableEmergencyContact(in: links)
            successText = AssistStrings.contactRemoved(name: link.memberName, noEmergencyLeft: noEmergencyLeft, lang)
        }
        catch { errorText = AssistStrings.deleteFailed(lang) }
    }

    private func triggerEmergency() async {
        guard let token = KeychainStore.read() else { errorText = AssistStrings.loginShort(lang); return }
        do {
            // 优先呼叫"在线可用"的联系人（匹配）；无人在线则回退呼叫全部紧急联系人。
            let online = try await api.assistMatch(token: token, emergency: true)
            let targets = online.isEmpty ? try await api.emergencyTargets(token: token) : online
            guard !targets.isEmpty else {
                emergencyInfo = AssistStrings.noEmergencyTargets(lang)
                return
            }
            emergencyInfo = AssistStrings.emergencyCallingPrefix(anyOnline: !online.isEmpty, lang)
                + targets.map(\.memberName).joined(separator: " → ")
            let session = CallSession()
            // 登记本次呼叫，使在线的协助者/亲友前台轮询即可接听（免推送会合；真机后台响铃仍需推送）。
            // 用 try(非 try?)：登记失败时进入 catch 提示而非进"假通话"（见审查 #2）。
            try await api.startEmergencyCall(token: token, callId: session.id, targetUserIds: targets.map(\.memberId))
            emergencyCall = session
        } catch { errorText = AssistStrings.emergencyFailed(lang) }
    }
}

/// 安全报到剩余时间格式化（纯逻辑，可单测）。
enum SafetyTimerFormat {
    static func remainingText(sec: Int, _ l: Language) -> String {
        let s = max(0, sec)
        let h = s / 3600, m = (s % 3600) / 60
        if l == .zh { return h > 0 ? "还有约 \(h) 小时 \(m) 分钟" : "还有约 \(m) 分钟" }
        return h > 0 ? "About \(h)h \(m)m left" : "About \(m) min left"
    }
    /// 时长选项显示名（30 分钟 / 2 小时…）。
    static func durationName(_ m: Int, _ l: Language) -> String {
        if m >= 60, m % 60 == 0 { let h = m / 60; return l == .zh ? "\(h) 小时" : "\(h)h" }
        return l == .zh ? "\(m) 分钟" : "\(m) min"
    }
}

/// 安全报到文案（双语）。
enum SafetyStrings {
    static func navTitle(_ l: Language) -> String { l == .zh ? "安全报到" : "Safety check-in" }
    static func entry(_ l: Language) -> String { l == .zh ? "安全报到（独自出行）" : "Safety check-in" }
    static func explain(_ l: Language) -> String {
        l == .zh ? "独自出门前设一个时间。到点前点「我平安了」即可；若忘了或出意外没点，我们会自动把你的实时位置发给你的紧急联系人。"
                 : "Before heading out alone, set a timer. Tap “I'm safe” before it ends. If you forget or something happens and you don't, we automatically send your live location to your emergency contacts."
    }
    static func durationLabel(_ l: Language) -> String { l == .zh ? "多久内报平安" : "Check in within" }
    static func noteLabel(_ l: Language) -> String { l == .zh ? "备注（可选，会念给亲友）" : "Note (optional, read to your family)" }
    static func notePlaceholder(_ l: Language) -> String { l == .zh ? "例：我去菜市场，2 小时没回就是出事了" : "e.g. Going to the market; if not back in 2h, something's wrong" }
    static func start(_ l: Language) -> String { l == .zh ? "开始报到" : "Start check-in" }
    static func started(_ l: Language) -> String { l == .zh ? "安全报到已开始，到点前记得报平安。" : "Safety check-in started — remember to mark yourself safe." }
    static func active(_ l: Language) -> String { l == .zh ? "报到进行中" : "Check-in active" }
    static func imSafe(_ l: Language) -> String { l == .zh ? "我平安了（结束报到）" : "I'm safe (end check-in)" }
    static func safeConfirm(_ l: Language) -> String { l == .zh ? "已报平安，报到结束。" : "You're marked safe — check-in ended." }
    static func extend1h(_ l: Language) -> String { l == .zh ? "延长 1 小时" : "Extend 1 hour" }
    static func extended(_ l: Language) -> String { l == .zh ? "已延长 1 小时。" : "Extended by 1 hour." }
    static func cancelCheckin(_ l: Language) -> String { l == .zh ? "取消报到" : "Cancel check-in" }
    static func canceled(_ l: Language) -> String { l == .zh ? "已取消安全报到。" : "Safety check-in canceled." }
    static func failed(_ l: Language) -> String { l == .zh ? "操作失败，请重试。" : "Something went wrong — try again." }
}

/// 视障侧：安全报到（dead-man's switch）。空闲态设时长+备注开始；进行中显剩余时间 + 报平安/延长/取消。
struct SafetyCheckInView: View {
    let token: String
    @State private var timer: SafetyTimer?
    @State private var busy = false
    @State private var note = ""
    @State private var duration = 60
    private let durations = [30, 60, 120, 240]
    private let api = APIClient()
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        Form {
            if let t = timer, t.isActive {
                Section {
                    Text(SafetyTimerFormat.remainingText(sec: t.remainingSec, lang)).font(.headline)
                    if let n = t.note, !n.isEmpty { Text(n).font(.footnote).foregroundStyle(.secondary) }
                } header: { Text(SafetyStrings.active(lang)) }
                Section {
                    Button(SafetyStrings.imSafe(lang)) { Task { await complete() } }.disabled(busy)
                    Button(SafetyStrings.extend1h(lang)) { Task { await extend() } }.disabled(busy)
                    Button(SafetyStrings.cancelCheckin(lang), role: .destructive) { Task { await cancelTimer() } }.disabled(busy)
                }
            } else {
                Section { Text(SafetyStrings.explain(lang)).font(.footnote).foregroundStyle(.secondary) }
                Section {
                    Picker(SafetyStrings.durationLabel(lang), selection: $duration) {
                        ForEach(durations, id: \.self) { m in Text(SafetyTimerFormat.durationName(m, lang)).tag(m) }
                    }
                }
                Section {
                    TextField(SafetyStrings.notePlaceholder(lang), text: $note, axis: .vertical).lineLimit(1...3)
                } header: { Text(SafetyStrings.noteLabel(lang)) }
                Section {
                    Button(SafetyStrings.start(lang)) { Task { await start() } }.disabled(busy)
                }
            }
        }
        .navigationTitle(SafetyStrings.navTitle(lang))
        .task { timer = try? await api.safetyCheckin(token: token) }
    }

    /// 双路播报（安全攸关，未开 VoiceOver 的盲人也须听到确认）。
    private func announce(_ text: String) {
        A11y.announce(text)
        if !UIAccessibility.isVoiceOverRunning { SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode) }
    }
    private func start() async {
        busy = true; defer { busy = false }
        do { timer = try await api.startSafetyCheckin(token: token, durationMinutes: duration, note: note.trimmingCharacters(in: .whitespacesAndNewlines)); announce(SafetyStrings.started(lang)) }
        catch { announce(SafetyStrings.failed(lang)) }
    }
    private func complete() async {
        busy = true; defer { busy = false }
        do { try await api.completeSafetyCheckin(token: token); timer = nil; announce(SafetyStrings.safeConfirm(lang)) }
        catch { announce(SafetyStrings.failed(lang)) }
    }
    private func extend() async {
        busy = true; defer { busy = false }
        do { timer = try await api.extendSafetyCheckin(token: token, addMinutes: 60); announce(SafetyStrings.extended(lang)) }
        catch { announce(SafetyStrings.failed(lang)) }
    }
    private func cancelTimer() async {
        busy = true; defer { busy = false }
        do { try await api.cancelSafetyCheckin(token: token); timer = nil; announce(SafetyStrings.canceled(lang)) }
        catch { announce(SafetyStrings.failed(lang)) }
    }
}
