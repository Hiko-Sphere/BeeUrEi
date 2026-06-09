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
    let onClose: () -> Void

    /// 常用求助内容（也可不选直接求助）。
    private let topics = ["看看前面是什么", "读一段文字或标签", "帮我认方向 / 找路", "看看颜色或物品", "其他"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: BeeSpacing.md) {
                    // 主行动：向志愿者求助
                    BeeBigButton("向志愿者求助",
                                 systemImage: "hand.raised.fill",
                                 subtitle: "让在线的热心志愿者帮你看（陌生人）",
                                 tint: .beeHoney) {
                        showTopicPicker = true
                    }
                    .disabled(calling)

                    // 次行动：呼叫亲友（一键）
                    BeeBigButton("呼叫我的亲友",
                                 systemImage: "person.2.fill",
                                 subtitle: "呼叫你已绑定的家人或朋友",
                                 tint: .beeInk, foreground: .white) {
                        Task { await callForHelp() }
                    }
                    .disabled(calling)

                    if let statusText {
                        Text(statusText).font(.subheadline).foregroundStyle(.secondary)
                    }

                    Text("我的亲友 / 协助者").font(.headline).padding(.top, BeeSpacing.sm)
                    contactsSection
                }
                .padding()
            }
            .navigationTitle("求助")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("完成") { onClose() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { showAdd = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel("添加亲友")
                }
            }
            .alert("添加亲友", isPresented: $showAdd) {
                TextField("对方用户名", text: $newUsername)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("添加") { Task { await addLink() } }
                Button("取消", role: .cancel) { newUsername = "" }
            } message: {
                Text("输入可以帮你看东西的家人或朋友的 App 用户名。")
            }
            .confirmationDialog("你需要什么帮助？", isPresented: $showTopicPicker, titleVisibility: .visible) {
                ForEach(topics, id: \.self) { t in
                    Button(t) { Task { await callForVolunteer(topic: t) } }
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("选择后会把你的求助发给在线志愿者，并告诉他们你的大概位置和语言（不含精确地址）。")
            }
        }
        .task { await load() }
        .refreshable { await load() }
        // 所有求助/呼叫/错误状态变化主动朗读——盲人点完按钮后才能得到语音反馈，不会以为没反应反复点（见无障碍审计）。
        .onChange(of: statusText) { _, new in if let new, !new.isEmpty { A11y.announce(new) } }
        .fullScreenCover(item: $activeCall) { call in
            CallView(role: .blind, callId: call.id) {
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
        if let loadError {
            Text(loadError).foregroundStyle(.secondary)
        } else if links.isEmpty {
            BeeEmptyState(systemImage: "person.crop.circle.badge.plus",
                          title: "还没有绑定亲友",
                          message: "点右上角「＋」按用户名添加可以帮你看东西的家人或朋友。")
        } else {
            VStack(spacing: BeeSpacing.sm) {
                ForEach(links) { link in
                    Button { Task { await call(link) } } label: {
                        BeeCard {
                            HStack {
                                Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(.secondary)
                                VStack(alignment: .leading) {
                                    Text(link.memberName).font(.headline)
                                    if link.isEmergency {
                                        Text("紧急联系人").font(.caption).foregroundStyle(Color.beeWarn)
                                    }
                                }
                                Spacer()
                                Image(systemName: "video.fill").foregroundStyle(Color.beeSuccess)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(calling)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("呼叫 \(link.memberName)\(link.isEmergency ? "，紧急联系人" : "")")
                    .accessibilityAddTraits(.isButton)
                    .contextMenu {
                        Button("删除绑定", role: .destructive) { Task { await deleteLink(link) } }
                    }
                }
            }
        }
    }

    private func load() async {
        guard let token = KeychainStore.read() else { loadError = "请先在「设置 → 账号」登录"; return }
        do { links = try await APIClient().familyLinks(token: token); loadError = nil }
        catch { loadError = "加载亲友失败（需连接后端）" }
    }

    private func addLink() async {
        let username = newUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        newUsername = ""
        guard !username.isEmpty, let token = KeychainStore.read() else { return }
        do {
            try await APIClient().addFamilyLink(token: token, username: username, relation: nil, isEmergency: false, phone: nil)
            await load()
        } catch let APIError.server(msg) {
            statusText = msg == "member_not_found" ? "找不到该用户名" : "添加失败"
        } catch { statusText = "添加失败" }
    }

    private func deleteLink(_ link: FamilyLinkInfo) async {
        guard let token = KeychainStore.read() else { return }
        try? await APIClient().deleteFamilyLink(token: token, id: link.id)
        await load()
    }

    /// 向公开队列发起志愿者求助：取粗粒度地点 + 语言 → 广播 → 进入通话等待志愿者接入。
    private func callForVolunteer(topic: String) async {
        guard !calling, activeCall == nil else { return }
        guard let token = KeychainStore.read() else { statusText = "请先在「设置 → 账号」登录"; return }
        calling = true; statusText = "正在发起求助，请稍候…"; defer { calling = false }
        let callId = UUID().uuidString
        let locality = await CoarseLocality().fetch() // best-effort，未授权则为 nil
        let language = Locale.current.language.languageCode?.identifier // 设备语言（zh/en…）
        do {
            try await APIClient().postHelpRequest(token: token, callId: callId, language: language, locality: locality, topic: topic)
            statusText = "已发出求助，正在等待志愿者接入…" // 经 .onChange(statusText) 统一朗读
            activeCall = ActiveBlindCall(id: callId, isVolunteer: true)
        } catch {
            statusText = "求助未送达，请检查网络后重试，或改为呼叫亲友。"
        }
    }

    /// 一键求助：匹配在线的已绑定亲友/协助者 → 登记会合 → 进入通话。
    private func callForHelp() async {
        guard !calling, activeCall == nil else { return }
        guard let token = KeychainStore.read() else { statusText = "请先在「设置 → 账号」登录"; return }
        calling = true; statusText = "正在为你呼叫亲友…"; defer { calling = false }
        do {
            let online = try await APIClient().assistMatch(token: token, emergency: true)
            let targets = online.isEmpty ? try await APIClient().emergencyTargets(token: token) : online
            guard !targets.isEmpty else { statusText = "还没有可呼叫的亲友/协助者，请先添加并绑定，或改用「向志愿者求助」。"; return }
            let callId = UUID().uuidString
            try await APIClient().startEmergencyCall(token: token, callId: callId, targetUserIds: targets.map(\.memberId))
            statusText = (online.isEmpty ? "暂无在线，仍尝试呼叫：" : "正在呼叫：") + targets.map(\.memberName).joined(separator: " → ")
            activeCall = ActiveBlindCall(id: callId, isVolunteer: false)
        } catch { statusText = "呼叫未送达，请检查网络后重试，或改用电话联系。" }
    }

    /// 定向呼叫某位已绑定的亲友/协助者。
    private func call(_ link: FamilyLinkInfo) async {
        guard !calling, activeCall == nil, let token = KeychainStore.read() else { return }
        calling = true; statusText = "正在呼叫：\(link.memberName)"; defer { calling = false }
        do {
            let callId = UUID().uuidString
            try await APIClient().startEmergencyCall(token: token, callId: callId, targetUserIds: [link.memberId])
            activeCall = ActiveBlindCall(id: callId, isVolunteer: false)
        } catch { statusText = "呼叫 \(link.memberName) 未送达，请重试或改用电话联系。" }
    }
}
