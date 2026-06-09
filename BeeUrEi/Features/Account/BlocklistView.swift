import SwiftUI

/// 黑名单管理：查看/解除已拉黑的人，或按用户名新增拉黑。
/// 拉黑后双方互不出现在匹配/公开求助队列/来电中（含随机匹配）。
struct BlocklistView: View {
    @State private var blocks: [BlockedUser] = []
    @State private var showAdd = false
    @State private var newUsername = ""
    @State private var message: String?
    @State private var busy: Set<String> = []

    var body: some View {
        List {
            Section {
                Text("被你拉黑的人无法向你发起协助/求助请求，匹配也不会把你们配到一起。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if blocks.isEmpty {
                Section { Text("黑名单为空").foregroundStyle(.secondary) }
            } else {
                Section("已拉黑（\(blocks.count)）") {
                    ForEach(blocks) { b in
                        HStack {
                            Text(b.user.displayName)
                            Spacer()
                            Button("解除") { Task { await unblock(b) } }
                                .buttonStyle(.bordered)
                                .disabled(busy.contains(b.id))
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("已拉黑 \(b.user.displayName)，双击解除")
                    }
                }
            }
            if let message { Section { Text(message).foregroundStyle(.secondary) } }
        }
        .navigationTitle("黑名单")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAdd = true } label: { Image(systemName: "plus") }.accessibilityLabel("拉黑用户")
            }
        }
        .alert("拉黑用户", isPresented: $showAdd) {
            TextField("对方用户名", text: $newUsername).textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("拉黑", role: .destructive) { Task { await block() } }
            Button("取消", role: .cancel) { newUsername = "" }
        } message: {
            Text("输入要拉黑的用户名。拉黑后将互不收到对方的请求/匹配。")
        }
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: message) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
    }

    private func load() async {
        guard let token = KeychainStore.read() else { return }
        blocks = (try? await APIClient().blocks(token: token)) ?? []
    }
    private func block() async {
        let u = newUsername.trimmingCharacters(in: .whitespacesAndNewlines); newUsername = ""
        guard !u.isEmpty, let token = KeychainStore.read() else { return }
        do { try await APIClient().blockUser(token: token, username: u); message = "已拉黑 \(u)"; await load() }
        catch { message = "拉黑失败：找不到该用户名或网络错误" }
    }
    private func unblock(_ b: BlockedUser) async {
        guard let token = KeychainStore.read(), !busy.contains(b.id) else { return }
        busy.insert(b.id); defer { busy.remove(b.id) }
        await APIClient().unblock(token: token, id: b.id)
        message = "已解除拉黑 \(b.user.displayName)"
        await load()
    }
}
