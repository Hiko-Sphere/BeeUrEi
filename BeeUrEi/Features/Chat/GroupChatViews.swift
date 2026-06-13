import SwiftUI

// MARK: - 新建群聊（群名 + 从绑定好友多选成员）

struct NewGroupSheet: View {
    let session: AuthSession
    let contacts: [FamilyLinkInfo]
    var onCreated: (GroupInfo) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var selected: Set<String> = []
    @State private var creating = false
    @State private var errorText: String?
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            Form {
                Section(ChatStrings.groupName(lang)) {
                    TextField(ChatStrings.groupNamePlaceholder(lang), text: $name)
                }
                Section(ChatStrings.pickMembers(lang)) {
                    if contacts.isEmpty {
                        Text(ChatStrings.noContacts(lang)).font(.footnote).foregroundStyle(.secondary)
                    }
                    ForEach(contacts) { c in
                        Button {
                            if selected.contains(c.memberId) { selected.remove(c.memberId) }
                            else { selected.insert(c.memberId) }
                        } label: {
                            HStack(spacing: BeeSpacing.md) {
                                AvatarView(dataURL: c.memberAvatar, name: c.memberName, size: 40)
                                VStack(alignment: .leading) {
                                    Text(c.memberName).font(.headline).foregroundStyle(.primary)
                                    Text(c.relation).font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: selected.contains(c.memberId) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(selected.contains(c.memberId) ? Color.beeSuccess : Color.secondary)
                            }
                        }
                        .accessibilityLabel("\(c.memberName)，\(c.relation)")
                        .accessibilityAddTraits(selected.contains(c.memberId) ? [.isSelected] : [])
                    }
                }
                if let errorText {
                    Text(errorText).font(.footnote).foregroundStyle(Color.beeDanger)
                }
            }
            // 建群失败要朗读（盲人看不到红字横幅，见 P1 审计）。
            .onChange(of: errorText) { _, e in if let e, !e.isEmpty { A11y.announce(e) } }
            .navigationTitle(ChatStrings.newGroup(lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(ChatStrings.createGroup(lang)) { create() }
                        .disabled(creating
                                  || name.trimmingCharacters(in: .whitespaces).isEmpty
                                  || selected.isEmpty)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button(ChatStrings.close(lang)) { dismiss() }
                }
            }
        }
    }

    private func create() {
        guard let token = session.token else { errorText = AccountStrings.loginFirstShort(lang); return }
        creating = true
        Task {
            defer { creating = false }
            do {
                let group = try await APIClient().createGroup(
                    token: token,
                    name: name.trimmingCharacters(in: .whitespaces),
                    memberIds: Array(selected))
                A11y.announce(ChatStrings.groupCreated(group.name, lang))
                onCreated(group)
                dismiss()
            } catch {
                errorText = ChatStrings.createGroupFailed(lang)
            }
        }
    }
}

// MARK: - 群信息（成员列表 + 群主加人/踢人 + 退群/解散）

struct GroupInfoSheet: View {
    let session: AuthSession
    let detail: GroupConversationInfo
    let contacts: [FamilyLinkInfo]
    var onChanged: () async -> Void // 成员变化后让聊天页刷新
    var onClosed: () -> Void        // 退群/解散后关闭聊天页

    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var confirmLeave = false
    @State private var confirmDissolve = false
    @State private var pendingRemoval: PendingRemoval?   // 移出成员前确认（不可逆）
    @State private var errorText: String?
    private struct PendingRemoval: Identifiable { let id: String; let name: String }
    private var lang: Language { FeatureSettings().language }
    private var myId: String { session.user?.id ?? "" }
    private var isOwner: Bool { detail.group.ownerId == myId }
    /// 还能拉进群的好友（须是我的 accepted 绑定且不在群里——后端同样校验）。
    private var addable: [FamilyLinkInfo] {
        contacts.filter { !detail.group.memberIds.contains($0.memberId) }
    }

    // 各 Section 抽成独立属性：整个 List 内联会让 SwiftUI 类型推断超时（见构建修复）。
    private var membersSection: some View {
        Section(ChatStrings.members(detail.members.count, lang)) {
            ForEach(detail.members, id: \.id) { m in memberRow(m) }
        }
    }

    @ViewBuilder private var addSection: some View {
        if isOwner, !addable.isEmpty {
            Section(ChatStrings.addMember(lang)) {
                ForEach(addable) { c in addableRow(c) }
            }
        } else if isOwner {
            Section(ChatStrings.addMember(lang)) {
                Text(ChatStrings.noAddableContacts(lang)).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder private var actionsSection: some View {
        Section {
            if isOwner {
                Button(ChatStrings.dissolveGroup(lang), role: .destructive) { confirmDissolve = true }
            } else {
                Button(ChatStrings.leaveGroup(lang), role: .destructive) { confirmLeave = true }
            }
        }
        if let errorText {
            Section { Text(errorText).foregroundStyle(Color.beeDanger) }
        }
    }

    var body: some View {
        NavigationStack {
            List {
                membersSection
                addSection
                actionsSection
            }
            // 群管理操作失败要可感知（盲人用户尤其依赖语音反馈）。
            .onChange(of: errorText) { _, e in if let e, !e.isEmpty { A11y.announce(e) } }
            .disabled(busy)
            .navigationTitle(detail.group.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(ChatStrings.close(lang)) { dismiss() }
                }
            }
            .confirmationDialog(ChatStrings.leaveConfirm(lang), isPresented: $confirmLeave, titleVisibility: .visible) {
                Button(ChatStrings.leaveGroup(lang), role: .destructive) { remove(myId, closesChat: true) }
            }
            .confirmationDialog(ChatStrings.dissolveConfirm(lang), isPresented: $confirmDissolve, titleVisibility: .visible) {
                Button(ChatStrings.dissolveGroup(lang), role: .destructive) { dissolve() }
            }
            // 移出成员不可逆——先确认（见审计 P2）。
            .confirmationDialog(pendingRemovalTitle, isPresented: pendingRemovalPresented, titleVisibility: .visible) {
                if let p = pendingRemoval {
                    Button(ChatStrings.removeMember(lang), role: .destructive) { remove(p.id, closesChat: false, name: p.name) }
                }
                Button(ChatStrings.cancel(lang), role: .cancel) { pendingRemoval = nil }
            }
        }
    }

    private var pendingRemovalTitle: String {
        pendingRemoval.map { ChatStrings.removeMemberConfirm($0.name, lang) } ?? ""
    }
    private var pendingRemovalPresented: Binding<Bool> {
        Binding(get: { pendingRemoval != nil }, set: { if !$0 { pendingRemoval = nil } })
    }

    /// 可添加成员行（抽成独立方法，避免内联表达式过大致编译器类型推断超时）。
    private func addableRow(_ c: FamilyLinkInfo) -> some View {
        Button {
            add(c.memberId, name: c.memberName)
        } label: {
            HStack(spacing: BeeSpacing.md) {
                AvatarView(dataURL: c.memberAvatar, name: c.memberName, size: 40)
                Text(c.memberName).font(.headline).foregroundStyle(.primary)
                Spacer()
                Image(systemName: "plus.circle.fill").foregroundStyle(Color.beeSuccess)
            }
        }
        .accessibilityLabel("\(ChatStrings.addMember(lang))：\(c.memberName)")
    }

    /// 成员行（抽成独立方法，避免内联表达式过大致编译器类型推断超时）。
    @ViewBuilder
    private func memberRow(_ m: GroupConversationInfo.Member) -> some View {
        let canRemove = isOwner && m.id != detail.group.ownerId
        HStack(spacing: BeeSpacing.md) {
            AvatarView(dataURL: m.avatar, name: m.displayName, size: 40)
            Text(m.displayName).font(.headline)
            if m.id == detail.group.ownerId {
                Text(ChatStrings.owner(lang))
                    .font(.caption.bold())
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Color.beeHoney.opacity(0.25), in: Capsule())
            }
            Spacer()
            if canRemove {
                Button(ChatStrings.removeMember(lang), role: .destructive) {
                    pendingRemoval = PendingRemoval(id: m.id, name: m.displayName)
                }
                .font(.caption)
                .buttonStyle(.bordered)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(m.id == detail.group.ownerId
                            ? "\(m.displayName)，\(ChatStrings.owner(lang))" : m.displayName)
        // children:.combine 会吞掉行内"移出"按钮——把移出暴露为 VoiceOver 自定义操作（见 P1 审计）。
        .accessibilityActions {
            if canRemove {
                Button("\(ChatStrings.removeMember(lang))：\(m.displayName)") {
                    pendingRemoval = PendingRemoval(id: m.id, name: m.displayName)
                }
            }
        }
    }

    private func add(_ userId: String, name: String) {
        guard let token = session.token else { errorText = AccountStrings.loginFirstShort(lang); return }
        busy = true
        Task {
            defer { busy = false }
            if await APIClient().addGroupMember(token: token, groupId: detail.group.id, userId: userId) == nil {
                errorText = ChatStrings.groupActionFailed(lang)
            } else {
                errorText = nil
                A11y.announce(ChatStrings.memberAdded(name, lang))
            }
            await onChanged()
        }
    }

    private func remove(_ userId: String, closesChat: Bool, name: String? = nil) {
        guard let token = session.token else { errorText = AccountStrings.loginFirstShort(lang); return }
        busy = true
        Task {
            defer { busy = false }
            let ok = await APIClient().removeGroupMember(token: token, groupId: detail.group.id, userId: userId)
            if !ok { errorText = ChatStrings.groupActionFailed(lang) }
            if closesChat, ok {
                A11y.announce(ChatStrings.leftGroup(lang))
                onClosed()
            } else {
                if ok, let name { A11y.announce(ChatStrings.memberRemoved(name, lang)) }
                await onChanged()
            }
        }
    }

    private func dissolve() {
        guard let token = session.token else { errorText = AccountStrings.loginFirstShort(lang); return }
        busy = true
        Task {
            defer { busy = false }
            if await APIClient().dissolveGroup(token: token, groupId: detail.group.id) {
                A11y.announce(ChatStrings.groupDissolved(lang))
                onClosed()
            } else {
                errorText = ChatStrings.groupActionFailed(lang)
            }
        }
    }
}
