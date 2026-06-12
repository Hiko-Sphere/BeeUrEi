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
                        .accessibilityLabel(c.memberName)
                        .accessibilityAddTraits(selected.contains(c.memberId) ? [.isSelected] : [])
                    }
                }
                if let errorText {
                    Text(errorText).font(.footnote).foregroundStyle(Color.beeDanger)
                }
            }
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
        guard let token = session.token else { return }
        creating = true
        Task {
            defer { creating = false }
            do {
                let group = try await APIClient().createGroup(
                    token: token,
                    name: name.trimmingCharacters(in: .whitespaces),
                    memberIds: Array(selected))
                dismiss()
                onCreated(group)
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
    private var lang: Language { FeatureSettings().language }
    private var myId: String { session.user?.id ?? "" }
    private var isOwner: Bool { detail.group.ownerId == myId }
    /// 还能拉进群的好友（须是我的 accepted 绑定且不在群里——后端同样校验）。
    private var addable: [FamilyLinkInfo] {
        contacts.filter { !detail.group.memberIds.contains($0.memberId) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section(ChatStrings.members(detail.group.memberIds.count, lang)) {
                    ForEach(detail.members, id: \.id) { m in
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
                            // 群主可移出非群主成员。
                            if isOwner, m.id != detail.group.ownerId {
                                Button(ChatStrings.removeMember(lang), role: .destructive) {
                                    remove(m.id, closesChat: false)
                                }
                                .font(.caption)
                                .buttonStyle(.bordered)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(m.id == detail.group.ownerId
                                            ? "\(m.displayName)，\(ChatStrings.owner(lang))" : m.displayName)
                    }
                }
                if isOwner, !addable.isEmpty {
                    Section(ChatStrings.addMember(lang)) {
                        ForEach(addable) { c in
                            Button {
                                add(c.memberId)
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
                    }
                } else if isOwner {
                    Section(ChatStrings.addMember(lang)) {
                        Text(ChatStrings.noAddableContacts(lang)).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section {
                    if isOwner {
                        Button(ChatStrings.dissolveGroup(lang), role: .destructive) { confirmDissolve = true }
                    } else {
                        Button(ChatStrings.leaveGroup(lang), role: .destructive) { confirmLeave = true }
                    }
                }
            }
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
        }
    }

    private func add(_ userId: String) {
        guard let token = session.token else { return }
        busy = true
        Task {
            defer { busy = false }
            _ = await APIClient().addGroupMember(token: token, groupId: detail.group.id, userId: userId)
            await onChanged()
        }
    }

    private func remove(_ userId: String, closesChat: Bool) {
        guard let token = session.token else { return }
        busy = true
        Task {
            defer { busy = false }
            let ok = await APIClient().removeGroupMember(token: token, groupId: detail.group.id, userId: userId)
            if closesChat, ok {
                onClosed()
            } else {
                await onChanged()
            }
        }
    }

    private func dissolve() {
        guard let token = session.token else { return }
        busy = true
        Task {
            defer { busy = false }
            if await APIClient().dissolveGroup(token: token, groupId: detail.group.id) {
                onClosed()
            }
        }
    }
}
