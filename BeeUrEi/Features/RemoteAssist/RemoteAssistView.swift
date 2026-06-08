import SwiftUI

/// 一个通话会话标识（用于 fullScreenCover 呈现）。
struct CallSession: Identifiable {
    let id = UUID().uuidString
}

/// 远程协助：一键求助 + 亲友名单；发起即进入隐私门控通话界面。VoiceOver 友好。
struct RemoteAssistView: View {
    @State private var model = RemoteAssistViewModel()
    @State private var showAdd = false
    @State private var newName = ""
    @State private var activeCall: CallSession?
    @State private var statusText: String?
    @State private var calling = false
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            contactsList
                .navigationTitle("呼叫帮手")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { onClose() }
                    }
                    ToolbarItem(placement: .primaryAction) {
                        Button { showAdd = true } label: { Image(systemName: "plus") }
                            .accessibilityLabel("添加亲友")
                    }
                }
                .alert("添加亲友", isPresented: $showAdd) {
                    TextField("姓名", text: $newName)
                    Button("添加") { model.addContact(name: newName); newName = "" }
                    Button("取消", role: .cancel) { newName = "" }
                } message: {
                    Text("添加一位可以帮你看东西的家人或朋友。")
                }
        }
        .onAppear { model.load() }
        .fullScreenCover(item: $activeCall) { session in
            CallView(role: .blind, callId: session.id) {
                // 挂断时取消待接登记，避免对端在 TTL 内仍弹出已结束的来电。
                if let token = KeychainStore.read() { Task { await APIClient().cancelCall(token: token, callId: session.id) } }
                activeCall = nil
            }
        }
    }

    /// 一键求助：匹配在线的已绑定亲友/协助者 → 登记会合(让对端轮询接听) → 进入通话。
    private func callForHelp() async {
        guard !calling else { return }
        guard let token = KeychainStore.read() else { statusText = "请先在「设置 → 账号」登录"; return }
        calling = true
        statusText = "正在为你呼叫帮手…"
        defer { calling = false }
        do {
            let online = try await APIClient().assistMatch(token: token, emergency: true)
            let targets = online.isEmpty ? try await APIClient().emergencyTargets(token: token) : online
            guard !targets.isEmpty else { statusText = "还没有可呼叫的亲友/协助者，请先添加并绑定。"; return }
            let session = CallSession()
            try? await APIClient().startEmergencyCall(token: token, callId: session.id, targetUserIds: targets.map(\.memberId))
            statusText = (online.isEmpty ? "暂无在线，仍尝试呼叫：" : "正在呼叫：") + targets.map(\.memberName).joined(separator: " → ")
            activeCall = session
        } catch {
            statusText = "呼叫失败，请检查网络后重试。"
        }
    }

    private var contactsList: some View {
        List {
            Section {
                Button { Task { await callForHelp() } } label: {
                    Label("一键求助（呼叫帮手）", systemImage: "person.fill.questionmark")
                        .font(.headline)
                }
                .disabled(calling)
                .accessibilityLabel("一键求助，呼叫帮手")
                if let statusText {
                    Text(statusText).font(.footnote).foregroundStyle(.secondary)
                }
            }

            if model.contacts.isEmpty {
                Text("还没有添加亲友。点右上角「＋」添加可以帮你看东西的家人或朋友。")
                    .foregroundStyle(.secondary)
            } else {
                Section("亲友") {
                    ForEach(model.contacts) { contact in
                        Button { Task { await callForHelp() } } label: {
                            HStack {
                                Image(systemName: "person.crop.circle.fill")
                                Text(contact.name).font(.headline)
                                Spacer()
                                Image(systemName: "video.fill").foregroundStyle(.green)
                            }
                        }
                        .disabled(calling)
                        .accessibilityLabel("呼叫 \(contact.name)")
                    }
                    .onDelete { indexSet in
                        indexSet.map { model.contacts[$0] }.forEach(model.removeContact)
                    }
                }
            }
        }
    }
}
