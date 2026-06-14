import SwiftUI

/// 一个通话会话标识（用于 fullScreenCover 呈现）。
struct CallSession: Identifiable {
    let id = UUID().uuidString
}

/// 视障侧正在进行的呼叫：区分「公开志愿者求助」与「呼叫亲友」，挂断时分别清理。
struct ActiveBlindCall: Identifiable {
    let id: String // = callId
    let isVolunteer: Bool
}

/// 远程协助（视障侧）：
/// ①「向志愿者求助」——广播到公开队列，任意在线志愿者可认领接入（陌生人帮你看）。
/// ②「呼叫亲友/协助者」——呼叫你已绑定的家人/朋友。
/// 发起即进入隐私门控通话界面。VoiceOver 友好、按钮超大。
struct RemoteAssistView: View {
    @State private var links: [FamilyLinkInfo] = []
    @State private var loadError: String?
    @State private var showAdd = false
    @State private var newUsername = ""
    @State private var activeCall: ActiveBlindCall?
    @State private var statusText: String?
    @State private var calling = false
    @State private var showTopicPicker = false
    @State private var topic = ""
    @State private var incomingRequests: [IncomingLinkInfo] = []  // 对方(协助者/亲友)发来的待确认请求
    @State private var linkBusy: Set<String> = []
    @State private var onlineCount = 0     // 我绑定的协助者/亲友在线人数
    @State private var totalCount = 0      // 绑定总数
    @State private var onlineTask: Task<Void, Never>?
    @State private var pendingVolunteerFallback = false // A4：亲友无人接听→关旧通话后自动转志愿者
    @Environment(AuthSession.self) private var session // 全站功能开关：关停时禁用对应呼叫按钮
    let onClose: () -> Void

    /// 求助屏文案语言（E5）：每次渲染解析，与各屏同一真相来源。
    private var lang: Language { FeatureSettings().language }
    /// 常用求助内容（也可不选直接求助）。
    private var topics: [String] { AssistStrings.topics(lang) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: BeeSpacing.md) {
                    NetworkStatusBar() // 当前网络类型（WiFi/移动数据/有线链接）

                    // 我的协助者/亲友在线人数（求助前一眼知道有没有人能接）。
                    HStack(spacing: BeeSpacing.sm) {
                        Circle().fill(onlineCount > 0 ? Color.beeSuccess : Color.secondary).frame(width: 10, height: 10)
                        Text(AssistStrings.onlineCount(onlineCount, lang))
                            .font(.subheadline.weight(.medium))
                        if totalCount > 0 { Text(AssistStrings.totalCount(totalCount, lang)).font(.caption).foregroundStyle(.secondary) }
                        Spacer()
                    }
                    .padding(.horizontal, BeeSpacing.md).padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.ultraThinMaterial, in: Capsule())
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(AssistStrings.onlineCountA11y(online: onlineCount, total: totalCount, lang))

                    // 主行动：向志愿者求助
                    BeeBigButton(AssistStrings.callVolunteerTitle(lang),
                                 systemImage: "hand.raised.fill",
                                 subtitle: AssistStrings.callVolunteerSubtitle(lang),
                                 tint: .beeHoney) {
                        showTopicPicker = true
                    }
                    .opacity(session.features.helpRequests ? 1 : 0.5)
                    .disabled(calling || !session.features.helpRequests)
                    .accessibilityHint(session.features.helpRequests ? "" : HomeStrings.featureOff(lang))

                    // 次行动：呼叫亲友（一键）
                    BeeBigButton(AssistStrings.callFamilyTitle(lang),
                                 systemImage: "person.2.fill",
                                 subtitle: AssistStrings.callFamilySubtitle(lang),
                                 tint: .beeInk, foreground: .white) {
                        Task { await callForHelp() }
                    }
                    .opacity(session.features.calls ? 1 : 0.5)
                    .disabled(calling || !session.features.calls)
                    .accessibilityHint(session.features.calls ? "" : HomeStrings.featureOff(lang))

                    if let statusText {
                        Text(statusText).font(.subheadline).foregroundStyle(.secondary)
                    }

                    if !incomingRequests.isEmpty {
                        BeeSectionHeader(AssistStrings.pendingSection(lang), systemImage: "person.crop.circle.badge.questionmark").padding(.top, BeeSpacing.sm)
                        ForEach(incomingRequests) { r in
                            BeeCard {
                                VStack(alignment: .leading, spacing: BeeSpacing.sm) {
                                    HStack {
                                        AvatarView(dataURL: r.ownerAvatar, name: r.ownerName, size: 36)
                                        Text(AssistStrings.wantsRelation(owner: r.ownerName, relation: r.relation, lang))
                                    }
                                    HStack {
                                        Button(AssistStrings.accept(lang)) { Task { await accept(r) } }
                                            .buttonStyle(.borderedProminent).disabled(linkBusy.contains(r.id))
                                        Button(AssistStrings.reject(lang), role: .destructive) { Task { await reject(r) } }
                                            .buttonStyle(.bordered).disabled(linkBusy.contains(r.id))
                                    }
                                }
                            }
                        }
                    }

                    BeeSectionHeader(AssistStrings.familySection(lang), systemImage: "person.2.fill").padding(.top, BeeSpacing.sm)
                    contactsSection
                }
                .padding()
            }
            .navigationTitle(AssistStrings.navTitle(lang))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(AssistStrings.done(lang)) { onClose() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { showAdd = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel(AssistStrings.addFamilyA11y(lang))
                }
                ToolbarItem(placement: .topBarLeading) { NotificationsBell() }
            }
            .alert(AssistStrings.addFamilyTitle(lang), isPresented: $showAdd) {
                TextField(AssistStrings.usernamePlaceholder(lang), text: $newUsername)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(AssistStrings.add(lang)) { Task { await addLink() } }
                Button(AssistStrings.cancel(lang), role: .cancel) { newUsername = "" }
            } message: {
                Text(AssistStrings.addFamilyMessage(lang))
            }
            .confirmationDialog(AssistStrings.topicTitle(lang), isPresented: $showTopicPicker, titleVisibility: .visible) {
                ForEach(topics, id: \.self) { t in
                    Button(t) { Task { await callForVolunteer(topic: t) } }
                }
                Button(AssistStrings.cancel(lang), role: .cancel) {}
            } message: {
                Text(AssistStrings.topicMessage(lang))
            }
        }
        .task { await load(); startOnlinePolling() }
        .refreshable { await load() }
        .onDisappear { onlineTask?.cancel(); onlineTask = nil }
        // 所有求助/呼叫/错误状态变化主动朗读——盲人点完按钮后才能得到语音反馈，不会以为没反应反复点（见无障碍审计）。
        .onChange(of: statusText) { _, new in if let new, !new.isEmpty { A11y.announce(new) } }
        .fullScreenCover(item: $activeCall, onDismiss: {
            // A4：呼亲友无人接听 → 关闭旧通话后自动发起志愿者求助（模态真正关闭后再开新 cover，防同 tick 吞没）。
            if pendingVolunteerFallback {
                pendingVolunteerFallback = false
                Task { await callForVolunteer(topic: AssistStrings.defaultTopic(lang)) }
            }
        }) { call in
            CallView(role: .blind, callId: call.id,
                     waitingText: call.isVolunteer ? AssistStrings.waitingVolunteer(lang)
                                                   : AssistStrings.waitingAnswer(lang),
                     onFallbackToVolunteer: call.isVolunteer ? nil : {
                         // 清理这通没人接的亲友呼叫，并在 cover 关闭后转向志愿者求助（A4）。
                         if let token = KeychainStore.read() {
                             let id = call.id
                             Task { await APIClient().cancelCall(token: token, callId: id) }
                         }
                         pendingVolunteerFallback = true
                         activeCall = nil
                     }) {
                if let token = KeychainStore.read() {
                    let id = call.id, isVol = call.isVolunteer
                    Task {
                        if isVol { await APIClient().cancelHelp(token: token, callId: id) }
                        else { await APIClient().cancelCall(token: token, callId: id) }
                    }
                }
                activeCall = nil
            }
        }
    }

    @ViewBuilder
    private var contactsSection: some View {
        let callable = links.filter { $0.isAccepted } // 只列已建立关系的（可呼叫）；待确认的不在此
        if let loadError {
            Text(loadError).foregroundStyle(.secondary)
        } else if callable.isEmpty {
            BeeEmptyState(systemImage: "person.crop.circle.badge.plus",
                          title: AssistStrings.noFamilyTitle(lang),
                          message: AssistStrings.noFamilyMessage(lang))
        } else {
            VStack(spacing: BeeSpacing.sm) {
                ForEach(callable) { link in
                    Button { Task { await call(link) } } label: {
                        BeeCard {
                            HStack {
                                AvatarView(dataURL: link.memberAvatar, name: link.memberName, size: 40)
                                VStack(alignment: .leading) {
                                    Text(link.memberName).font(.headline)
                                    if link.isEmergency {
                                        Text(AssistStrings.emergencyContact(lang)).font(.caption).foregroundStyle(Color.beeWarn)
                                    }
                                }
                                Spacer()
                                Image(systemName: "video.fill")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 36, height: 36)
                                    .background(Color.beeSuccess, in: Circle())
                            }
                        }
                    }
                    .buttonStyle(BeePressStyle())
                    .disabled(calling)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(AssistStrings.callMemberA11y(link.memberName, emergency: link.isEmergency, lang))
                    .accessibilityAddTraits(.isButton)
                    .contextMenu {
                        Button(AssistStrings.deleteLink(lang), role: .destructive) { Task { await deleteLink(link) } }
                    }
                }
            }
        }
    }

    /// 每 8 秒刷新在线协助者/亲友人数（求助界面打开期间）。
    private func startOnlinePolling() {
        onlineTask?.cancel()
        onlineTask = Task {
            while !Task.isCancelled {
                if let token = KeychainStore.read() {
                    let c = await APIClient().onlineHelperCount(token: token)
                    onlineCount = c.online; totalCount = c.total
                }
                try? await Task.sleep(for: .seconds(8))
            }
        }
    }

    private func load() async {
        guard let token = KeychainStore.read() else { loadError = AssistStrings.loginFirst(lang); return }
        do { links = try await APIClient().familyLinks(token: token); loadError = nil }
        catch { loadError = AssistStrings.loadFamilyFailed(lang) }
        if let inc = try? await APIClient().incomingLinks(token: token) { incomingRequests = inc.filter { $0.isPending } }
    }

    private func accept(_ r: IncomingLinkInfo) async {
        guard let token = KeychainStore.read(), !linkBusy.contains(r.id) else { return }
        linkBusy.insert(r.id); defer { linkBusy.remove(r.id) }
        try? await APIClient().acceptFamilyLink(token: token, id: r.id)
        await load()
    }

    private func reject(_ r: IncomingLinkInfo) async {
        guard let token = KeychainStore.read(), !linkBusy.contains(r.id) else { return }
        linkBusy.insert(r.id); defer { linkBusy.remove(r.id) }
        try? await APIClient().deleteFamilyLink(token: token, id: r.id)
        await load()
    }

    private func addLink() async {
        let username = newUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        newUsername = ""
        guard !username.isEmpty, let token = KeychainStore.read() else { return }
        do {
            // 支持用户名 / 邮箱 / 手机号添加：先精确查人，再按 userId 发起请求。
            let target = try await APIClient().lookupUser(token: token, query: username)
            try await APIClient().addFamilyLink(token: token, userId: target.id)
            await load()
        } catch let APIError.server(msg) {
            statusText = msg == "member_not_found" ? AssistStrings.memberNotFound(lang) : AssistStrings.addFailed(lang)
        } catch { statusText = AssistStrings.addFailed(lang) }
    }

    private func deleteLink(_ link: FamilyLinkInfo) async {
        guard let token = KeychainStore.read() else { return }
        try? await APIClient().deleteFamilyLink(token: token, id: link.id)
        await load()
    }

    /// 向公开队列发起志愿者求助：取粗粒度地点 + 语言 → 广播 → 进入通话等待志愿者接入。
    private func callForVolunteer(topic: String) async {
        guard !calling, activeCall == nil else { return }
        guard let token = KeychainStore.read() else { statusText = AssistStrings.loginFirst(lang); return }
        calling = true; statusText = AssistStrings.sendingHelp(lang); defer { calling = false }
        let callId = UUID().uuidString
        let locality = await CoarseLocality().fetch() // best-effort，未授权则为 nil
        let language = Locale.current.language.languageCode?.identifier // 设备语言（zh/en…）
        do {
            try await APIClient().postHelpRequest(token: token, callId: callId, language: language, locality: locality, topic: topic)
            statusText = AssistStrings.helpSent(lang) // 经 .onChange(statusText) 统一朗读
            activeCall = ActiveBlindCall(id: callId, isVolunteer: true)
        } catch {
            statusText = AssistStrings.helpFailed(lang)
        }
    }

    /// 一键求助：匹配在线的已绑定亲友/协助者 → 登记会合 → 进入通话。
    private func callForHelp() async {
        guard !calling, activeCall == nil else { return }
        guard let token = KeychainStore.read() else { statusText = AssistStrings.loginFirst(lang); return }
        calling = true; statusText = AssistStrings.callingFamily(lang); defer { calling = false }
        do {
            let online = try await APIClient().assistMatch(token: token, emergency: true)
            let targets = online.isEmpty ? try await APIClient().emergencyTargets(token: token) : online
            guard !targets.isEmpty else { statusText = AssistStrings.noCallableFamily(lang); return }
            let callId = UUID().uuidString
            try await APIClient().startEmergencyCall(token: token, callId: callId, targetUserIds: targets.map(\.memberId))
            statusText = AssistStrings.callingListPrefix(anyOnline: !online.isEmpty, lang)
                + targets.map(\.memberName).joined(separator: " → ")
            activeCall = ActiveBlindCall(id: callId, isVolunteer: false)
        } catch { statusText = AssistStrings.familyCallFailed(lang) }
    }

    /// 定向呼叫某位已绑定的亲友/协助者。
    private func call(_ link: FamilyLinkInfo) async {
        guard !calling, activeCall == nil, let token = KeychainStore.read() else { return }
        calling = true; statusText = AssistStrings.callingOne(link.memberName, lang); defer { calling = false }
        do {
            let callId = UUID().uuidString
            try await APIClient().startEmergencyCall(token: token, callId: callId, targetUserIds: [link.memberId])
            activeCall = ActiveBlindCall(id: callId, isVolunteer: false)
        } catch { statusText = AssistStrings.callOneFailed(link.memberName, lang) }
    }
}
