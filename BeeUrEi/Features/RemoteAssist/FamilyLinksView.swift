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
    @State private var readiness: EmergencyReadinessInfo?  // 紧急就绪度（含紧急联系人可否被推送触达）——补"有没有"之外的"收不收得到"
    @State private var confirmTestAlert = false  // 「发送测试告警」二次确认（会给真实联系人发测试通知，防误发）
    @State private var sendingTest = false
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
                // 应急就绪**主提示**（就绪度以**实际告警扇出面** acceptedReachable 为准——SOS/摔倒扇给全体 accepted，
                // 非仅 isEmergency）：没联系人/有联系人却都收不到→危险；有可达联系人但没标紧急→提示级。**避免"有非紧急
                // 联系人却误报无人会被通知"的假警报**（与网页端 EmergencyReadinessCard 同口径）。
                if loaded, let notice = readiness?.readinessNotice(lang) {
                    Label(notice.text, systemImage: notice.danger ? "exclamationmark.triangle.fill" : "info.circle.fill")
                        .font(.footnote).foregroundStyle(notice.danger ? Color.beeDanger : .secondary)
                        .accessibilityLabel(notice.text)
                } else if let warn = readiness?.unreachableEmergencyWarning(lang) {
                    // 有可达紧急联系人、但其中个别不可达（没装 App/没开通知）：点名谁不可达，让盲人去让家人开通知。
                    Label(warn, systemImage: "bell.slash.fill")
                        .font(.footnote).foregroundStyle(Color.beeDanger)
                        .accessibilityLabel(warn)
                } else if loaded && readiness == nil && !FamilyLinkInfo.hasUsableEmergencyContact(in: links) {
                    // 就绪度加载失败的兜底：至少提醒"没有紧急联系人"（保守，宁可多提醒也别漏报安全网空）。
                    Label(AssistStrings.noEmergencyContactWarning(lang), systemImage: "exclamationmark.triangle.fill")
                        .font(.footnote).foregroundStyle(Color.beeDanger)
                        .accessibilityLabel(AssistStrings.noEmergencyContactWarning(lang))
                }
                // 「发送测试告警」：验证"我的求助真能送到联系人"——比读警告更确定（真发一条测试通知看谁收到）。
                // 仅在有联系人时显示（无联系人无从测起）。会给真实联系人发测试通知，故二次确认防误发。
                if loaded && !links.isEmpty {
                    Button {
                        confirmTestAlert = true
                    } label: {
                        Label(AssistStrings.testAlertButton(lang), systemImage: "bell.badge.fill")
                    }
                    .disabled(sendingTest)
                    .accessibilityHint(AssistStrings.testAlertConfirm(lang))
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
                                    // 实名徽标（与 web VerifiedBadge 同源同义）：KYC 真人核验过的亲友——信任信号。
                                    if l.showsVerifiedBadge {
                                        Image(systemName: "checkmark.seal.fill")
                                            .font(.caption).foregroundStyle(Color.beeSuccess)
                                            .accessibilityLabel(AssistStrings.verifiedA11y(lang))
                                    }
                                }
                                Text(l.relation
                                     + AssistStrings.emergencySuffix(lang, isEmergency: l.isEmergency, amOwner: l.amOwner)
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
        .confirmationDialog(AssistStrings.testAlertConfirm(lang), isPresented: $confirmTestAlert, titleVisibility: .visible) {
            Button(AssistStrings.testAlertButton(lang)) { Task { await sendTest() } }
            Button(AssistStrings.cancel(lang), role: .cancel) {}
        }
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
        readiness = await api.emergencyReadiness(token: token) // 就绪度并行/顺带取（失败=nil，不影响列表；只用于可达性警告）
        // 应急就绪问题**主动播报**（盲人看不到屏上警告条；VoiceOver 开→系统公告，否则 App 语音）：优先播危险级
        // 主提示（没联系人/都不可达），否则播"个别紧急联系人不可达"。提示级（有联系人会被通知、只是没标紧急）不打扰、不播。
        if let notice = readiness?.readinessNotice(lang), notice.danger { announce(notice.text) }
        else if let warn = readiness?.unreachableEmergencyWarning(lang) { announce(warn) }
    }

    /// 发送测试告警并把结果**朗读**给盲人（到底几位收到=SOS 真能到人吗）；完成后顺带刷新就绪度。
    private func sendTest() async {
        guard !sendingTest, let token = KeychainStore.read() else { return }
        sendingTest = true
        announce(AssistStrings.testAlertSending(lang))
        let outcome = await api.sendTestAlert(token: token)
        sendingTest = false
        successText = AssistStrings.testAlertResult(outcome, lang) // onChange 会朗读
        readiness = await api.emergencyReadiness(token: token) // 测完刷新可达性（家人可能刚开了通知）
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
    /// 实时剩余秒（与网页 liveRemainingSecFromDue 同口径）：绝对到期时刻 dueAt(ms) 减本机 now(ms)。
    /// 服务端 remainingSec 只是取时快照——页面开着数字不动，半小时后仍显"还有约 60 分钟"是
    /// dead-man's switch 的危险误导。坏输入（非有限）→ 0，绝不显 NaN/负数。
    static func liveRemainingSec(dueAtMs: Double, nowMs: Double) -> Int {
        guard dueAtMs.isFinite, nowMs.isFinite else { return 0 }
        return max(0, Int(((dueAtMs - nowMs) / 1000).rounded()))
    }
    /// 每日报到"下次开始"短标签（与网页 nextCheckinLabel 同口径）："今天 09:00"/"明天 09:00"——
    /// 启用中的持久确认，一眼看到安全网已生效且下次何时触发。nowMinuteOfDay=本机当前分钟数(0-1439)；
    /// 边界：当前恰为报到时刻本身算"明天"（本分钟的扫描已经或即将开启今天那次）。
    static func nextCheckinLabel(startMinute: Int, nowMinuteOfDay: Int, _ l: Language) -> String {
        let h = startMinute / 60, m = startMinute % 60
        let hhmm = String(format: "%02d:%02d", h, m)
        return nowMinuteOfDay < startMinute ? (l == .zh ? "今天 \(hhmm)" : "today at \(hhmm)")
                                            : (l == .zh ? "明天 \(hhmm)" : "tomorrow at \(hhmm)")
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
    /// 开始报到后的播报：有联系人→正常确认；**无任何 accepted 联系人→防假安心警告**（到期告警扇给全体 accepted，
    /// 一个都没有＝这道 dead-man's switch 到点也无人被通知）。纯逻辑·可单测·与网页端 Family 起始文案同口径。
    static func startedNotice(hasAnyContact: Bool, _ l: Language) -> String {
        if hasAnyContact { return started(l) }
        return l == .zh ? "已开始，但你还没有任何联系人——到点没报平安也无人会被通知。请先在下方添加联系人。"
                        : "Started, but you have no contacts yet — no one will be alerted if you miss it. Add a contact below first."
    }
    static func active(_ l: Language) -> String { l == .zh ? "报到进行中" : "Check-in active" }
    static func imSafe(_ l: Language) -> String { l == .zh ? "我平安了（结束报到）" : "I'm safe (end check-in)" }
    static func safeConfirm(_ l: Language) -> String { l == .zh ? "已报平安，报到结束。" : "You're marked safe — check-in ended." }
    static func extend1h(_ l: Language) -> String { l == .zh ? "延长 1 小时" : "Extend 1 hour" }
    static func extended(_ l: Language) -> String { l == .zh ? "已延长 1 小时。" : "Extended by 1 hour." }
    static func cancelCheckin(_ l: Language) -> String { l == .zh ? "取消报到" : "Cancel check-in" }
    static func canceled(_ l: Language) -> String { l == .zh ? "已取消安全报到。" : "Safety check-in canceled." }
    static func failed(_ l: Language) -> String { l == .zh ? "操作失败，请重试。" : "Something went wrong — try again." }
    /// 语音"报平安"但当前没有进行中的报到：如实告知（服务端幂等 completed:false），绝不假装已报。
    static func noActiveCheckin(_ l: Language) -> String {
        l == .zh ? "当前没有进行中的安全报到。要出门前可以在亲友页开始一次报到。"
                 : "You have no active safety check-in. You can start one from the Family screen before heading out."
    }
    /// 语音报平安失败（网络等）：如实告知并给替代路径——报到逾期会给亲友发告警，失败绝不能静默。
    static func reportSafeFailed(_ l: Language) -> String {
        l == .zh ? "报平安没有成功，请稍后再说一次，或到亲友页手动点「我平安了」。"
                 : "Marking you safe failed. Try saying it again, or tap “I'm safe” on the Family screen."
    }
    // —— 每日报到日程（与网页 Family 页同语义）——
    static func dailyHeader(_ l: Language) -> String { l == .zh ? "每日报到" : "Daily check-in" }
    static func dailyExplain(_ l: Language) -> String {
        l == .zh ? "每天固定时刻自动开始一次报到，忘了报平安就通知紧急联系人——独居的日常安全网。"
                 : "A check-in starts automatically at the same time every day; if you don't mark yourself safe, your emergency contacts are notified — a daily safety net for living alone."
    }
    static func dailyEnable(_ l: Language) -> String { l == .zh ? "启用每日报到" : "Enable daily check-in" }
    static func dailyTimeLabel(_ l: Language) -> String { l == .zh ? "每天开始时刻" : "Starts every day at" }
    static func dailySave(_ l: Language) -> String { l == .zh ? "保存日程" : "Save schedule" }
    static func dailySaved(_ l: Language) -> String { l == .zh ? "每日报到日程已保存。" : "Daily check-in schedule saved." }
    static func nextCheckin(_ label: String, _ l: Language) -> String { l == .zh ? "下次报到：\(label)" : "Next check-in: \(label)" }
    static func pause7(_ l: Language) -> String { l == .zh ? "暂停 7 天" : "Pause 7 days" }
    static func pause30(_ l: Language) -> String { l == .zh ? "暂停 30 天" : "Pause 30 days" }
    static func pausedUntil(_ date: String, _ l: Language) -> String { l == .zh ? "已暂停至 \(date)，到期自动恢复" : "Paused until \(date) — resumes automatically" }
    static func resumeNow(_ l: Language) -> String { l == .zh ? "立即恢复" : "Resume now" }
    static func paused(_ l: Language) -> String { l == .zh ? "每日报到已暂停，到期自动恢复。" : "Daily check-in paused — it will resume automatically." }
    static func resumed(_ l: Language) -> String { l == .zh ? "每日报到已恢复。" : "Daily check-in resumed." }
    static func dailyLoadFailed(_ l: Language) -> String {
        l == .zh ? "日程读取失败——为防误改真实日程，已锁定编辑。" : "Couldn't load the schedule — editing is locked to protect your real settings."
    }
    static func dailyRetry(_ l: Language) -> String { l == .zh ? "重试读取" : "Retry" }
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
                    // 实时倒计时：每秒从绝对 dueAt 重算——服务端 remainingSec 只是取时快照，页面开着
                    // 数字不动是 dead-man's switch 的危险误导（以为还有 1 小时，其实已快到期）。
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text(SafetyTimerFormat.remainingText(
                            sec: SafetyTimerFormat.liveRemainingSec(dueAtMs: t.dueAt, nowMs: ctx.date.timeIntervalSince1970 * 1000),
                            lang)).font(.headline)
                    }
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
            // 每日报到日程（独居日常安全网）：与一次性报到并存——拆独立子视图防 SwiftUI 类型推断超时。
            DailyCheckinSection(token: token, announce: announce)
        }
        .navigationTitle(SafetyStrings.navTitle(lang))
        .task { timer = (try? await api.safetyCheckin(token: token))?.timer }
    }

    /// 双路播报（安全攸关，未开 VoiceOver 的盲人也须听到确认）。
    private func announce(_ text: String) {
        A11y.announce(text)
        if !UIAccessibility.isVoiceOverRunning { SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode) }
    }
    private func start() async {
        busy = true; defer { busy = false }
        do {
            let status = try await api.startSafetyCheckin(token: token, durationMinutes: duration, note: note.trimmingCharacters(in: .whitespacesAndNewlines))
            timer = status.timer
            // 防假安心：无任何 accepted 联系人时，明确告知这道 dead-man's switch 到点也无人被通知（盲人听得到）。
            announce(SafetyStrings.startedNotice(hasAnyContact: status.hasAnyContact, lang))
        }
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

/// 每日报到日程编辑（与网页 Family 页同语义、同端点 PUT /api/safety/checkin/schedule）：
/// 启用开关 + 每天开始时刻 + 时长 + 备注 + 显式保存；启用中显示「下次报到：今天/明天 HH:MM」持久确认；
/// 暂停 7/30 天（住院/出行，到点自动恢复——比整体关闭安全，不必记得重开）+ 立即恢复。
/// 保存时**保留生效中的 pausedUntil**（改时间/备注不该顺手清掉暂停——与网页同教训）。
struct DailyCheckinSection: View {
    /// 暂停目标时刻（纯函数可测）：**整毫秒**——服务端 z.int() 拒绝小数（复审 HIGH：曾让暂停恒 400）。
    /// nil=立即恢复（0，服务端视作未暂停）。
    nonisolated static func pauseTarget(days: Int?, nowMs: Double) -> Int {
        guard let d = days else { return 0 }
        return Int((nowMs + Double(d) * 86_400_000).rounded())
    }

    let token: String
    let announce: (String) -> Void
    @State private var loaded = false
    @State private var loadFailed = false   // 复审：读取失败≠"未配置"——把默认值当权威展示会让用户误存、清掉真日程/生效中的暂停
    @State private var enabled = false
    @State private var startTime = Calendar.current.date(from: DateComponents(hour: 9, minute: 0)) ?? .now
    @State private var duration = 60
    @State private var dnote = ""
    @State private var pausedUntil: Double? // 生效中的暂停至(ms)；nil/过去=未暂停
    @State private var busy = false
    private let durations = [30, 60, 120, 240]
    private let api = APIClient()
    private var lang: Language { FeatureSettings().language }
    private var startMinute: Int {
        let c = Calendar.current.dateComponents([.hour, .minute], from: startTime)
        return (c.hour ?? 9) * 60 + (c.minute ?? 0)
    }
    private var isPaused: Bool {
        // 用已测的模型判定（复审：此前视图私有重实现，被测的 isPaused(nowMs:) 是死代码=假覆盖）。
        DailyCheckinSchedule(enabled: enabled, startMinute: startMinute, durationMinutes: duration,
                             tz: TimeZone.current.identifier, note: nil, pausedUntil: pausedUntil)
            .isPaused(nowMs: Date().timeIntervalSince1970 * 1000)
    }

    var body: some View {
        Section {
            Text(SafetyStrings.dailyExplain(lang)).font(.footnote).foregroundStyle(.secondary)
            if loadFailed {
                Text(SafetyStrings.dailyLoadFailed(lang)).font(.footnote).foregroundStyle(Color.beeDanger)
                Button(SafetyStrings.dailyRetry(lang)) { loaded = false; Task { await load() } }
            }
            Toggle(SafetyStrings.dailyEnable(lang), isOn: $enabled).disabled(busy || !loaded || loadFailed)
            if enabled {
                DatePicker(SafetyStrings.dailyTimeLabel(lang), selection: $startTime, displayedComponents: .hourAndMinute)
                Picker(SafetyStrings.durationLabel(lang), selection: $duration) {
                    ForEach(durations, id: \.self) { m in Text(SafetyTimerFormat.durationName(m, lang)).tag(m) }
                }
                TextField(SafetyStrings.notePlaceholder(lang), text: $dnote, axis: .vertical).lineLimit(1...3)
            }
            Button(SafetyStrings.dailySave(lang)) { Task { await save() } }.disabled(busy || !loaded || loadFailed)
            if enabled, loaded {
                if isPaused {
                    Text(SafetyStrings.pausedUntil(pausedDateText, lang)).font(.footnote).foregroundStyle(.secondary)
                    Button(SafetyStrings.resumeNow(lang)) { Task { await setPause(nil) } }.disabled(busy)
                } else {
                    // 持久确认：安全网已生效 + 下次何时触发（比 toast 一闪更安心；VoiceOver 可随时摸到）。
                    Text(SafetyStrings.nextCheckin(
                        SafetyTimerFormat.nextCheckinLabel(startMinute: startMinute,
                                                           nowMinuteOfDay: nowMinuteOfDay(), lang), lang))
                        .font(.footnote).foregroundStyle(.secondary)
                    Button(SafetyStrings.pause7(lang)) { Task { await setPause(7) } }.disabled(busy)
                    Button(SafetyStrings.pause30(lang)) { Task { await setPause(30) } }.disabled(busy)
                }
            }
        } header: { Text(SafetyStrings.dailyHeader(lang)) }
        .task { await load() }
    }

    private func nowMinuteOfDay() -> Int {
        let c = Calendar.current.dateComponents([.hour, .minute], from: Date())
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }
    private var pausedDateText: String {
        guard let p = pausedUntil else { return "" }
        let f = DateFormatter()
        f.locale = Locale(identifier: lang == .zh ? "zh_CN" : "en_US")
        f.setLocalizedDateFormatFromTemplate("MMMd")
        return f.string(from: Date(timeIntervalSince1970: p / 1000))
    }
    private func load() async {
        guard !loaded else { return }
        loadFailed = false
        do {
            let s = try await api.getCheckinSchedule(token: token)
            loaded = true
            guard let s else { return } // null=从未配置：默认值是真实状态
            apply(s)
            return
        } catch {
            // 网络/服务错：**不得**把编译期默认(未启用/09:00/无暂停)当权威展示——用户一存就清掉真日程
            // 与住院暂停（dead-man's switch 被静默改写）。标失败、禁保存、给重试。
            loadFailed = true
            loaded = true
            return
        }
    }
    private func apply(_ s: DailyCheckinSchedule) {
        if true {
            enabled = s.enabled
            startTime = Calendar.current.date(from: DateComponents(hour: s.startMinute / 60, minute: s.startMinute % 60)) ?? startTime
            duration = s.durationMinutes
            dnote = s.note ?? ""
            pausedUntil = s.pausedUntil
        }
    }
    private func save() async {
        busy = true; defer { busy = false }
        do {
            // 保留生效中的暂停（服务端把过去的 pausedUntil 视作未暂停，回传过期值无害）。
            let s = try await api.setCheckinSchedule(token: token, enabled: enabled, startMinute: startMinute,
                                                     durationMinutes: duration, tz: TimeZone.current.identifier,
                                                     note: dnote.trimmingCharacters(in: .whitespacesAndNewlines),
                                                     pausedUntil: pausedUntil)
            enabled = s.enabled; pausedUntil = s.pausedUntil
            announce(SafetyStrings.dailySaved(lang))
        } catch { announce(SafetyStrings.failed(lang)) }
    }
    /// days=nil → 立即恢复（pausedUntil 传 0，服务端视作未暂停）。
    private func setPause(_ days: Int?) async {
        busy = true; defer { busy = false }
        let target = Double(DailyCheckinSection.pauseTarget(days: days, nowMs: Date().timeIntervalSince1970 * 1000))
        do {
            let s = try await api.setCheckinSchedule(token: token, enabled: enabled, startMinute: startMinute,
                                                     durationMinutes: duration, tz: TimeZone.current.identifier,
                                                     note: dnote.trimmingCharacters(in: .whitespacesAndNewlines),
                                                     pausedUntil: target)
            pausedUntil = s.pausedUntil
            announce(days == nil ? SafetyStrings.resumed(lang) : SafetyStrings.paused(lang))
        } catch { announce(SafetyStrings.failed(lang)) }
    }
}
