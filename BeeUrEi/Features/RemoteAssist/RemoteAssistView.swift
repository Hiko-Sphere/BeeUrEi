import SwiftUI

/// 一个通话会话标识（用于 fullScreenCover 呈现）。
struct CallSession: Identifiable {
    let id = UUID().uuidString
}

/// 远程协助：一键求助 + 亲友名单（**后端真实绑定**）；发起即进入隐私门控通话界面。VoiceOver 友好。
struct RemoteAssistView: View {
    @State private var links: [FamilyLinkInfo] = []
    @State private var loadError: String?
    @State private var showAdd = false
    @State private var newUsername = ""
    @State private var activeCall: CallSession?
    @State private var statusText: String?
    @State private var calling = false
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            contactsList
                .navigationTitle("呼叫帮手")
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
        }
        .task { await load() }
        .refreshable { await load() }
        .fullScreenCover(item: $activeCall) { session in
            CallView(role: .blind, callId: session.id) {
                // 挂断时取消待接登记，避免对端在 TTL 内仍弹出已结束的来电。
                if let token = KeychainStore.read() { Task { await APIClient().cancelCall(token: token, callId: session.id) } }
                activeCall = nil
            }
        }
    }

    private var contactsList: some View {
        List {
            Section {
                Button { Task { await callForHelp() } } label: {
                    Label("一键求助（呼叫所有可用帮手）", systemImage: "person.fill.questionmark")
                        .font(.headline)
                }
                .disabled(calling)
                .accessibilityLabel("一键求助，呼叫所有可用帮手")
                if let statusText {
                    Text(statusText).font(.footnote).foregroundStyle(.secondary)
                }
            }

            if let loadError {
                Text(loadError).foregroundStyle(.secondary)
            } else if links.isEmpty {
                Text("还没有绑定亲友。点右上角「＋」按用户名添加可以帮你看东西的家人或朋友。")
                    .foregroundStyle(.secondary)
            } else {
                Section("我的亲友 / 协助者") {
                    ForEach(links) { link in
                        Button { Task { await call(link) } } label: {
                            HStack {
                                Image(systemName: "person.crop.circle.fill")
                                VStack(alignment: .leading) {
                                    Text(link.memberName).font(.headline)
                                    if link.isEmergency {
                                        Text("紧急联系人").font(.caption).foregroundStyle(.orange)
                                    }
                                }
                                Spacer()
                                Image(systemName: "video.fill").foregroundStyle(.green)
                            }
                        }
                        .disabled(calling)
                        .accessibilityLabel("呼叫 \(link.memberName)\(link.isEmergency ? "，紧急联系人" : "")")
                    }
                    .onDelete { idx in Task { await deleteLinks(idx) } }
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

    private func deleteLinks(_ idx: IndexSet) async {
        guard let token = KeychainStore.read() else { return }
        for link in idx.map({ links[$0] }) {
            try? await APIClient().deleteFamilyLink(token: token, id: link.id)
        }
        await load()
    }

    /// 一键求助：匹配在线的已绑定亲友/协助者 → 登记会合(让对端轮询接听) → 进入通话。
    /// activeCall == nil 守卫：防止 cover 呈现前的一帧内重复触发生成第二个 CallSession 覆盖、
    /// 孤立刚登记的 callId（见审查 #3）。
    private func callForHelp() async {
        guard !calling, activeCall == nil else { return }
        guard let token = KeychainStore.read() else { statusText = "请先在「设置 → 账号」登录"; return }
        calling = true; statusText = "正在为你呼叫帮手…"; defer { calling = false }
        do {
            let online = try await APIClient().assistMatch(token: token, emergency: true)
            let targets = online.isEmpty ? try await APIClient().emergencyTargets(token: token) : online
            guard !targets.isEmpty else { statusText = "还没有可呼叫的亲友/协助者，请先添加并绑定。"; return }
            let session = CallSession()
            // 用 try(非 try?)：登记失败(断网/服务端拒绝)时进入 catch，不进"假通话"苦等（见审查 #2）。
            try await APIClient().startEmergencyCall(token: token, callId: session.id, targetUserIds: targets.map(\.memberId))
            statusText = (online.isEmpty ? "暂无在线，仍尝试呼叫：" : "正在呼叫：") + targets.map(\.memberName).joined(separator: " → ")
            activeCall = session
        } catch { statusText = "呼叫未送达，请检查网络后重试，或改用电话联系。" }
    }

    /// 定向呼叫某位已绑定的亲友/协助者。
    private func call(_ link: FamilyLinkInfo) async {
        guard !calling, activeCall == nil, let token = KeychainStore.read() else { return }
        calling = true; statusText = "正在呼叫：\(link.memberName)"; defer { calling = false }
        do {
            let session = CallSession()
            try await APIClient().startEmergencyCall(token: token, callId: session.id, targetUserIds: [link.memberId])
            activeCall = session
        } catch { statusText = "呼叫 \(link.memberName) 未送达，请重试或改用电话联系。" }
    }
}
