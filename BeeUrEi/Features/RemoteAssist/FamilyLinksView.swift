import SwiftUI
import UIKit

/// 视障侧：亲友绑定（后端 /api/family）+ 紧急呼叫（/api/emergency/trigger 取优先级目标）+ 电话兜底。
struct FamilyLinksView: View {
    @State private var links: [FamilyLinkInfo] = []
    @State private var newUsername = ""
    @State private var newRelation = ""
    @State private var newPhone = ""
    @State private var isEmergency = false
    @State private var errorText: String?
    @State private var emergencyInfo: String?
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
            }

            Section(AssistStrings.familySection(lang)) {
                if links.isEmpty {
                    Text(AssistStrings.noLinksYet(lang)).foregroundStyle(.secondary)
                } else {
                    ForEach(links) { l in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(l.memberName)
                                Text(l.relation
                                     + (l.isEmergency ? AssistStrings.emergencySuffix(lang) : "")
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
        // 错误与紧急呼叫状态主动朗读——盲人看不到屏幕上的提示（见 P2 审计）。
        .onChange(of: errorText) { _, e in if let e, !e.isEmpty { A11y.announce(e) } }
        .onChange(of: emergencyInfo) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
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
        do { links = try await api.familyLinks(token: token); errorText = nil }
        catch { errorText = AssistStrings.loadFailed(lang) }
    }

    private func add() async {
        guard let token = KeychainStore.read() else { errorText = AssistStrings.loginShort(lang); return }
        do {
            // 用户名 / 邮箱 / 手机号均可：先精确查人，再按 userId 添加（newPhone 是对方的真实电话，用于 tel:// 兜底）。
            let target = try await api.lookupUser(token: token, query: newUsername.trimmingCharacters(in: .whitespaces))
            try await api.addFamilyLink(token: token, userId: target.id,
                                        relation: newRelation, isEmergency: isEmergency,
                                        phone: newPhone.trimmingCharacters(in: .whitespaces))
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
        do { try await api.deleteFamilyLink(token: token, id: link.id); await load() }
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
