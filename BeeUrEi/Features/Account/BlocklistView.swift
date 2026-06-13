import SwiftUI

/// 黑名单管理：查看/解除已拉黑的人，或按用户名新增拉黑。
/// 拉黑后双方互不出现在匹配/公开求助队列/来电中（含随机匹配）。
struct BlocklistView: View {
    @State private var blocks: [BlockedUser] = []
    @State private var showAdd = false
    @State private var newUsername = ""
    @State private var message: String?
    @State private var busy: Set<String> = []
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        List {
            Section {
                Text(AccountStrings.blocklistExplain(lang))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if blocks.isEmpty {
                Section {
                    BeeEmptyState(systemImage: "hand.raised.slash.fill", title: AccountStrings.blocklistEmptyTitle(lang),
                                  message: AccountStrings.blocklistEmptyMessage(lang))
                }
                .listRowBackground(Color.clear)
            } else {
                Section(AccountStrings.blockedCount(blocks.count, lang)) {
                    ForEach(blocks) { b in
                        HStack {
                            Text(b.user.displayName)
                            Spacer()
                            Button(AccountStrings.unblock(lang)) { Task { await unblock(b) } }
                                .buttonStyle(.bordered)
                                .disabled(busy.contains(b.id))
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(AccountStrings.blockedRowA11y(b.user.displayName, lang))
                    }
                }
            }
            if let message { Section { Text(message).foregroundStyle(.secondary) } }
        }
        .navigationTitle(AccountStrings.blocklist(lang))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAdd = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel(AccountStrings.blockUserA11y(lang))
            }
        }
        .alert(AccountStrings.addBlockTitle(lang), isPresented: $showAdd) {
            TextField(AccountStrings.blockUsernamePlaceholder(lang), text: $newUsername)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button(AccountStrings.blockAction(lang), role: .destructive) { Task { await block() } }
            Button(AccountStrings.cancel(lang), role: .cancel) { newUsername = "" }
        } message: {
            Text(AccountStrings.addBlockMessage(lang))
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
        do { try await APIClient().blockUser(token: token, username: u); message = AccountStrings.blockedOk(u, lang); await load() }
        catch { message = AccountStrings.blockFailed(lang) }
    }
    private func unblock(_ b: BlockedUser) async {
        guard let token = KeychainStore.read(), !busy.contains(b.id) else { return }
        busy.insert(b.id); defer { busy.remove(b.id) }
        // 解除失败不能谎报成功（结果会被 VoiceOver 朗读给盲人）——按真实结果反馈。
        do {
            try await APIClient().unblock(token: token, id: b.id)
            message = AccountStrings.unblockedOk(b.user.displayName, lang)
            await load()
        } catch {
            message = AccountStrings.unblockFailed(lang)
        }
    }
}
