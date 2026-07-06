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
