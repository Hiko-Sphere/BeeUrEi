import SwiftUI
import AVFoundation
import AVKit
import UIKit
import PhotosUI

// MARK: - 聊天目标（单聊 / 群聊）

enum ChatTarget: Identifiable, Hashable {
    case direct(peerId: String, name: String, avatar: String?)
    case group(id: String, name: String)

    var id: String {
        switch self {
        case .direct(let peerId, _, _): return "d-\(peerId)"
        case .group(let id, _): return "g-\(id)"
        }
    }
    var title: String {
        switch self {
        case .direct(_, let name, _): return name
        case .group(_, let name): return name
        }
    }
}

// MARK: - 会话列表（WhatsApp 式：单聊+群聊合并，头像 + 最后一条预览 + 未读角标 + 时间）

struct ConversationsView: View {
    let session: AuthSession
    @State private var conversations: [ConversationInfo] = []
    @State private var groups: [GroupConversationInfo] = []
    @State private var pollTask: Task<Void, Never>?
    @State private var opened: ChatTarget?
    @State private var showNewChat = false
    @State private var showNewGroup = false
    @State private var contacts: [FamilyLinkInfo] = [] // accepted 绑定 = 可聊天联系人
    private var lang: Language { FeatureSettings().language }
    private var myId: String { session.user?.id ?? "" }

    /// 单聊+群聊合并排序（最近活跃在前）。
    private enum Entry: Identifiable {
        case direct(ConversationInfo)
        case group(GroupConversationInfo)
        var id: String {
            switch self {
            case .direct(let c): return "d-\(c.peer.id)"
            case .group(let g): return "g-\(g.group.id)"
            }
        }
        var sortKey: Int {
            switch self {
            case .direct(let c): return c.last.createdAt
            case .group(let g): return g.last?.createdAt ?? g.group.createdAt
            }
        }
    }
    private var entries: [Entry] {
        (conversations.map(Entry.direct) + groups.map(Entry.group)).sorted { $0.sortKey > $1.sortKey }
    }

    var body: some View {
        NavigationStack {
            Group {
                if entries.isEmpty {
                    VStack(spacing: BeeSpacing.lg) {
                        BeeEmptyState(systemImage: "bubble.left.and.bubble.right",
                                      title: ChatStrings.navTitle(lang), message: ChatStrings.empty(lang))
                        // 空态直给"发起新对话"大按钮——没有人先发消息时也能开始聊天。
                        BeeBigButton(ChatStrings.newChat(lang), systemImage: "plus.bubble.fill", tint: .beeHoney) {
                            showNewChat = true
                        }
                        .padding(.horizontal)
                    }
                } else {
                    List(entries) { entry in
                        switch entry {
                        case .direct(let conv):
                            Button { opened = .direct(peerId: conv.peer.id, name: conv.peer.displayName,
                                                      avatar: conv.peer.avatar) } label: { row(conv) }
                                .buttonStyle(.plain)
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(rowA11y(conv))
                                .accessibilityAddTraits(.isButton)
                        case .group(let g):
                            Button { opened = .group(id: g.group.id, name: g.group.name) } label: { groupRow(g) }
                                .buttonStyle(.plain)
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(groupRowA11y(g))
                                .accessibilityAddTraits(.isButton)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(ChatStrings.navTitle(lang))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showNewChat = true } label: { Image(systemName: "square.and.pencil") }
                        .accessibilityLabel(ChatStrings.newChat(lang))
                }
                ToolbarItem(placement: .primaryAction) {
                    Button { showNewGroup = true } label: { Image(systemName: "person.3.fill") }
                        .accessibilityLabel(ChatStrings.newGroup(lang))
                }
            }
            .navigationDestination(item: $opened) { target in
                ChatView(session: session, target: target)
            }
            // 新建对话：从 accepted 绑定联系人中选一位进入聊天（首行可改为建群）。
            .sheet(isPresented: $showNewChat) {
                NavigationStack {
                    Group {
                        if contacts.isEmpty {
                            BeeEmptyState(systemImage: "person.2.slash",
                                          title: ChatStrings.pickContact(lang), message: ChatStrings.noContacts(lang))
                        } else {
                            List {
                                Button {
                                    showNewChat = false
                                    showNewGroup = true
                                } label: {
                                    Label(ChatStrings.newGroup(lang), systemImage: "person.3.fill")
                                        .font(.headline)
                                }
                                .accessibilityLabel(ChatStrings.newGroup(lang))
                                ForEach(contacts) { c in
                                    Button {
                                        showNewChat = false
                                        opened = .direct(peerId: c.memberId, name: c.memberName, avatar: c.memberAvatar)
                                    } label: {
                                        HStack(spacing: BeeSpacing.md) {
                                            AvatarView(dataURL: c.memberAvatar, name: c.memberName, size: 44)
                                            VStack(alignment: .leading) {
                                                Text(c.memberName).font(.headline)
                                                Text(c.relation).font(.caption).foregroundStyle(.secondary)
                                            }
                                        }
                                    }
                                    .accessibilityLabel(c.memberName)
                                }
                            }
                        }
                    }
                    .navigationTitle(ChatStrings.pickContact(lang))
                    .navigationBarTitleDisplayMode(.inline)
                }
                .presentationDetents([.medium, .large])
            }
            // 新建群聊：群名 + 多选成员。
            .sheet(isPresented: $showNewGroup) {
                NewGroupSheet(session: session, contacts: contacts) { group in
                    Task { await refresh() }
                    opened = .group(id: group.id, name: group.name)
                }
            }
        }
        .task {
            await refresh()
            pollTask = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    await refresh()
                }
            }
        }
        .onDisappear { pollTask?.cancel() }
    }

    private func refresh() async {
        guard let token = session.token else { return }
        if let list = try? await APIClient().conversations(token: token) { conversations = list }
        if let g = try? await APIClient().groups(token: token) { groups = g }
        if let links = try? await APIClient().familyLinks(token: token) {
            contacts = links.filter { $0.isAccepted }
        }
    }

    private func row(_ c: ConversationInfo) -> some View {
        HStack(spacing: BeeSpacing.md) {
            AvatarView(dataURL: c.peer.avatar, name: c.peer.displayName, size: 48)
            VStack(alignment: .leading, spacing: 3) {
                Text(c.peer.displayName).font(.headline)
                Text(preview(c.last)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            trailing(time: c.last.createdAt, unread: c.unread)
        }
        .padding(.vertical, 6)
    }

    private func groupRow(_ g: GroupConversationInfo) -> some View {
        HStack(spacing: BeeSpacing.md) {
            // 群头像：蜜橙底 + 三人图标。
            ZStack {
                Circle().fill(Color.beeHoney.opacity(0.25)).frame(width: 48, height: 48)
                Image(systemName: "person.3.fill").font(.system(size: 18)).foregroundStyle(Color.beeHoney)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(g.group.name).font(.headline)
                Text(groupPreview(g)).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            trailing(time: g.last?.createdAt ?? g.group.createdAt, unread: g.unread)
        }
        .padding(.vertical, 6)
    }

    private func trailing(time: Int, unread: Int) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(ChatStrings.timeFormat(time)).font(.caption2).foregroundStyle(.secondary)
            if unread > 0 {
                Text("\(unread)")
                    .font(.caption.bold()).foregroundStyle(.white)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Color.beeDanger, in: Capsule())
            }
        }
    }

    private func preview(_ m: ChatMessageInfo) -> String {
        if LocationPayload.from(m) != nil { return "📍 " + ChatStrings.locationMessage(lang) }
        switch m.kind {
        case "audio": return "🎤 " + ChatStrings.voiceMessage(lang)
        case "image": return "🖼️ " + ChatStrings.photo(lang)
        case "video": return "🎬 " + ChatStrings.videoMessage(lang)
        case "recalled": return ChatStrings.recalled(lang)
        default: return m.text
        }
    }

    private func groupPreview(_ g: GroupConversationInfo) -> String {
        guard let last = g.last else { return ChatStrings.members(g.group.memberIds.count, lang) }
        let sender = last.fromId == myId ? ChatStrings.me(lang)
                   : (g.members.first { $0.id == last.fromId }?.displayName ?? "")
        let sep = lang == .zh ? "：" : ": "
        return sender.isEmpty ? preview(last) : "\(sender)\(sep)\(preview(last))"
    }

    private func rowA11y(_ c: ConversationInfo) -> String {
        var parts = [c.peer.displayName, preview(c.last), ChatStrings.timeFormat(c.last.createdAt)]
        if c.unread > 0 { parts.append(ChatStrings.unreadBadgeA11y(c.unread, lang)) }
        return parts.joined(separator: "，")
    }

    private func groupRowA11y(_ g: GroupConversationInfo) -> String {
        var parts = [g.group.name, ChatStrings.members(g.group.memberIds.count, lang), groupPreview(g)]
        if g.unread > 0 { parts.append(ChatStrings.unreadBadgeA11y(g.unread, lang)) }
        return parts.joined(separator: "，")
    }
}

// MARK: - 聊天页（iMessage 式气泡 + 已读回执 + 语音条 + 图片 + 视频 + 轮询刷新；单聊/群聊共用）

struct ChatView: View {
    let session: AuthSession
    let target: ChatTarget

    @State private var messages: [ChatMessageInfo] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var errorText: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var recorder = VoiceNoteRecorder()
    @State private var player: AVAudioPlayer?
    @State private var photoItem: PhotosPickerItem?
    @State private var playingVideo: PlayableVideo?
    @State private var zoomImage: ZoomableImage?    // 点开图片全屏查看
    @State private var groupDetail: GroupConversationInfo? // 群聊：成员表（发言人名字/管理）
    @State private var showGroupInfo = false
    @State private var contacts: [FamilyLinkInfo] = []
    @Environment(\.dismiss) private var dismiss
    @FocusState private var inputFocused: Bool
    private var lang: Language { FeatureSettings().language }
    private var myId: String { session.user?.id ?? "" }

    private var isGroup: Bool { if case .group = target { return true }; return false }
    private var groupId: String? { if case .group(let id, _) = target { return id }; return nil }
    private var peerId: String? { if case .direct(let id, _, _) = target { return id }; return nil }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: BeeSpacing.sm) {
                        ForEach(messages) { m in bubble(m) }
                    }
                    .padding()
                }
                .onChange(of: messages.count) { _, _ in
                    if let last = messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            if let errorText {
                Text(errorText).font(.footnote).foregroundStyle(Color.beeDanger).padding(.horizontal)
            }
            inputBar
        }
        .navigationTitle(target.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if isGroup {
                ToolbarItem(placement: .primaryAction) {
                    Button { showGroupInfo = true } label: { Image(systemName: "person.3") }
                        .accessibilityLabel(ChatStrings.groupInfo(lang))
                }
            }
        }
        .sheet(isPresented: $showGroupInfo) {
            if let detail = groupDetail {
                GroupInfoSheet(session: session, detail: detail, contacts: contacts,
                               onChanged: { await refreshGroupDetail() },
                               onClosed: { showGroupInfo = false; dismiss() })
            }
        }
        .fullScreenCover(item: $playingVideo) { v in
            VideoPlayerSheet(url: v.url, lang: lang)
        }
        .fullScreenCover(item: $zoomImage) { z in
            ImageViewerSheet(image: z.image, lang: lang)
        }
        .task {
            await refreshGroupDetail()
            await refresh(announceNew: false)
            markRead()
            pollTask = Task {
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(3))
                    await refresh(announceNew: true)
                }
            }
        }
        .onDisappear { pollTask?.cancel(); recorder.cancel() }
    }

    // MARK: 气泡

    private func bubble(_ m: ChatMessageInfo) -> some View {
        let mine = m.fromId == myId
        return HStack {
            if mine { Spacer(minLength: 48) }
            VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
                // 群聊里别人的消息署名（WhatsApp 式）。
                if isGroup, !mine {
                    Text(senderName(m.fromId)).font(.caption.bold()).foregroundStyle(Color.beeHoney)
                }
                bubbleContent(m, mine: mine)
                    .padding(.horizontal, m.kind == "image" || LocationPayload.from(m) != nil ? 4 : 14)
                    .padding(.vertical, m.kind == "image" || LocationPayload.from(m) != nil ? 4 : 10)
                    .background(mine ? Color.beeHoney : Color(.secondarySystemBackground),
                                in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .foregroundStyle(mine ? Color.beeInk : Color.primary)
                    // 表情回应角标（WhatsApp 式贴在气泡角上）。
                    .overlay(alignment: mine ? .bottomLeading : .bottomTrailing) {
                        if let r = m.reaction, !r.isEmpty {
                            Text(r).font(.footnote)
                                .padding(5)
                                .background(.thinMaterial, in: Circle())
                                .offset(y: 12)
                                .accessibilityLabel(ChatStrings.reactionA11y(r, lang))
                        }
                    }
                    // 长按菜单：表情回应（双方）/ 撤回（自己 2 分钟内）。已撤回的不给菜单。
                    .contextMenu { if m.kind != "recalled" { bubbleMenu(m, mine: mine) } }
                HStack(spacing: 4) {
                    Text(ChatStrings.timeFormat(m.createdAt)).font(.caption2).foregroundStyle(.secondary)
                    if mine && m.kind != "recalled" && !isGroup {
                        // 已读回执（iMessage 式）：✓ 已送达 / ✓✓ 已读。群聊按人已读，不显示逐条回执。
                        Image(systemName: m.readAt != nil ? "checkmark.circle.fill" : "checkmark.circle")
                            .font(.caption2)
                            .foregroundStyle(m.readAt != nil ? Color.beeSuccess : Color.secondary)
                            .accessibilityHidden(true)
                    }
                }
            }
            if !mine { Spacer(minLength: 48) }
        }
        .id(m.id)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(bubbleA11y(m))
    }

    @ViewBuilder
    private func bubbleContent(_ m: ChatMessageInfo, mine: Bool) -> some View {
        if let payload = LocationPayload.from(m) {
            // 位置：地图缩略图气泡（kind=location 的 JSON 或 text 内嵌的地图链接都走这里）。
            LocationBubble(payload: payload, lang: lang)
        } else {
            switch m.kind {
            case "audio":
                Button { playVoice(m) } label: {
                    Label(ChatStrings.voiceMessage(lang), systemImage: "play.circle.fill")
                        .font(.body.weight(.semibold))
                }
                .accessibilityLabel(ChatStrings.playVoice(lang))
            case "image":
                if let img = Self.decodeImage(m.text) {
                    Image(uiImage: img)
                        .resizable().scaledToFit()
                        .frame(maxWidth: 220, maxHeight: 280)
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .onTapGesture { zoomImage = ZoomableImage(image: img) }
                        .accessibilityAddTraits(.isButton)
                        .accessibilityHint(ChatStrings.openPhotoHint(lang))
                } else {
                    Label(ChatStrings.photo(lang), systemImage: "photo")
                }
            case "video":
                Button { playVideoMessage(m) } label: {
                    Label(ChatStrings.videoMessage(lang), systemImage: "play.rectangle.fill")
                        .font(.body.weight(.semibold))
                }
                .accessibilityLabel(ChatStrings.playVideo(lang))
            case "recalled":
                Text(ChatStrings.recalled(lang)).font(.body.italic()).foregroundStyle(.secondary)
            default:
                Text(m.text).font(.body)
            }
        }
    }

    @ViewBuilder
    private func bubbleMenu(_ m: ChatMessageInfo, mine: Bool) -> some View {
        // 表情回应行（WhatsApp 常用六枚）。
        ForEach(ChatStrings.reactionChoices, id: \.self) { emoji in
            Button(emoji) { react(m, emoji: emoji) }
        }
        if let r = m.reaction, !r.isEmpty {
            Button(ChatStrings.removeReaction(lang)) { react(m, emoji: "") }
        }
        if mine, Date().timeIntervalSince1970 * 1000 - Double(m.createdAt) < 120_000 {
            Button(ChatStrings.recall(lang), role: .destructive) { recall(m) }
        }
    }

    private func senderName(_ id: String) -> String {
        groupDetail?.members.first { $0.id == id }?.displayName ?? ""
    }

    private func bubbleA11y(_ m: ChatMessageInfo) -> String {
        let content: String
        if let payload = LocationPayload.from(m) {
            content = ChatStrings.locationMessage(lang) + "：" + (payload.name ?? ChatStrings.unknownPlace(lang))
        } else {
            switch m.kind {
            case "audio": content = ChatStrings.voiceMessage(lang)
            case "image": content = ChatStrings.photo(lang)
            case "video": content = ChatStrings.videoMessage(lang)
            case "recalled": content = ChatStrings.recalled(lang)
            default: content = m.text
            }
        }
        let from = m.fromId == myId ? ChatStrings.me(lang) : (isGroup ? senderName(m.fromId) : target.title)
        var label = ChatStrings.bubbleA11y(from: from, content: content,
                                           time: ChatStrings.timeFormat(m.createdAt), lang)
        if m.fromId == myId, m.kind != "recalled", !isGroup {
            label += "，" + (m.readAt != nil ? ChatStrings.read(lang) : ChatStrings.delivered(lang))
        }
        if let r = m.reaction, !r.isEmpty { label += "，" + ChatStrings.reactionA11y(r, lang) }
        return label
    }

    static func decodeImage(_ dataURL: String) -> UIImage? {
        guard let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }

    // MARK: 输入栏（文本 + 语音条 + 照片/视频）

    private var inputBar: some View {
        HStack(spacing: BeeSpacing.sm) {
            // 语音条：点击开始录音，再点结束并发送（盲人友好：点击切换而非长按）。
            Button {
                toggleVoiceNote()
            } label: {
                Image(systemName: recorder.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(recorder.isRecording ? Color.beeDanger : Color.beeHoney)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel(recorder.isRecording ? ChatStrings.voiceStop(lang) : ChatStrings.voiceStart(lang))

            // 照片或视频（照片压缩成 data URL；视频上传到服务器磁盘再发 mediaId）。
            PhotosPicker(selection: $photoItem, matching: .any(of: [.images, .videos])) {
                Image(systemName: "photo.circle.fill").font(.system(size: 34)).foregroundStyle(Color.beeHoney)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .accessibilityLabel(ChatStrings.sendMedia(lang))
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                photoItem = nil
                if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                    Task { await sendVideo(item) }
                } else {
                    Task { await sendPhoto(item) }
                }
            }

            // 发送当前位置（取精确坐标 + 反查地址；接收方可点开地图导航）。
            Button {
                sendLocation()
            } label: {
                Image(systemName: "location.circle.fill").font(.system(size: 34)).foregroundStyle(Color.beeHoney)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .disabled(sending)
            .accessibilityLabel(ChatStrings.sendLocation(lang))

            TextField(ChatStrings.inputPlaceholder(lang), text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.roundedBorder)
                .focused($inputFocused)

            Button {
                sendText()
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 34))
                    .foregroundStyle(draft.trimmingCharacters(in: .whitespaces).isEmpty ? Color.secondary : Color.beeSuccess)
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
            .disabled(sending || draft.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityLabel(ChatStrings.send(lang))
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: 行为

    /// 发消息（按目标路由单聊/群聊）。
    private func send(kind: String, text: String) async throws -> ChatMessageInfo {
        guard let token = session.token else { throw APIError.unauthorized }
        if let groupId {
            return try await APIClient().sendGroupMessage(token: token, groupId: groupId, kind: kind, text: text)
        }
        return try await APIClient().sendMessage(token: token, toId: peerId ?? "", kind: kind, text: text)
    }

    private func refresh(announceNew: Bool) async {
        guard let token = session.token else { return }
        let list: [ChatMessageInfo]?
        if let groupId {
            list = try? await APIClient().groupMessages(token: token, groupId: groupId)
        } else {
            list = try? await APIClient().messages(token: token, with: peerId ?? "")
        }
        guard let list else { return }
        if announceNew {
            let known = Set(messages.map(\.id))
            let fresh = list.filter { !known.contains($0.id) && $0.fromId != myId }
            for m in fresh {
                // 新到消息语音播报：经总线 .query（不打断避障/导航/来电播报，闲时补播）。
                let name = isGroup ? senderName(m.fromId) : target.title
                let speak: String
                if LocationPayload.from(m) != nil {
                    speak = ChatStrings.newLocationSpeak(name, lang)
                } else {
                    switch m.kind {
                    case "audio": speak = ChatStrings.newVoiceSpeak(name, lang)
                    case "video": speak = ChatStrings.newVideoSpeak(name, lang)
                    default:
                        speak = isGroup
                            ? ChatStrings.newGroupMessageSpeak(name, target.title, String(m.text.prefix(60)), lang)
                            : ChatStrings.newMessageSpeak(name, String(m.text.prefix(60)), lang)
                    }
                }
                SpeechHub.shared.speak(speak, channel: .query, voiceCode: lang.voiceCode)
            }
            if !fresh.isEmpty { markRead() }
        }
        // 合并而非直接替换：服务器为权威，但保留它**尚未返回**的本地已发消息（刚发出、而本次轮询快照
        // 早于这条消息）。否则乐观插入的消息会被旧快照覆盖而"消失"——这正是"发完看不到消息"的根因。
        messages = merged(server: list)
    }

    /// 服务器列表 + 本地待回流的自己已发消息（按 id 去重、按时间排序）。
    private func merged(server: [ChatMessageInfo]) -> [ChatMessageInfo] {
        let serverIds = Set(server.map(\.id))
        let pendingLocal = messages.filter { !serverIds.contains($0.id) && $0.fromId == myId }
        guard !pendingLocal.isEmpty else { return server }
        return (server + pendingLocal).sorted { $0.createdAt < $1.createdAt }
    }

    private func refreshGroupDetail() async {
        guard isGroup, let token = session.token, let groupId else { return }
        if let all = try? await APIClient().groups(token: token) {
            groupDetail = all.first { $0.group.id == groupId }
        }
        if let links = try? await APIClient().familyLinks(token: token) {
            contacts = links.filter { $0.isAccepted }
        }
    }

    private func markRead() {
        guard let token = session.token else { return }
        Task {
            if let groupId {
                await APIClient().markGroupRead(token: token, groupId: groupId)
            } else if let peerId {
                await APIClient().markMessagesRead(token: token, fromId: peerId)
            }
        }
    }

    private func sendText() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        sending = true
        Task {
            defer { sending = false }
            do {
                let m = try await send(kind: "text", text: text)
                messages.append(m)
                errorText = nil
            } catch {
                errorText = ChatStrings.sendFailed(lang)
                SpeechHub.shared.speak(ChatStrings.sendFailed(lang), channel: .query, voiceCode: lang.voiceCode)
                draft = text // 失败还原草稿，不丢内容
            }
        }
    }

    /// 发送当前位置：取精确坐标 + 反查地址 → 作为内嵌地图链接的**文本消息**发送。
    /// 用文本而非 kind=location，使其在未重新部署的线上服务器也能发出（新客户端仍渲染为地图气泡）。
    private func sendLocation() {
        sending = true
        SpeechHub.shared.speak(ChatStrings.locatingNow(lang), channel: .query, voiceCode: lang.voiceCode)
        Task {
            defer { sending = false }
            guard let payload = await LocationShareFetcher().fetch() else {
                errorText = ChatStrings.locationFailed(lang)
                SpeechHub.shared.speak(ChatStrings.locationFailed(lang), channel: .query, voiceCode: lang.voiceCode)
                return
            }
            do {
                let m = try await send(kind: "text", text: payload.asText())
                messages.append(m)
                errorText = nil
            } catch {
                errorText = ChatStrings.sendFailed(lang)
                SpeechHub.shared.speak(ChatStrings.sendFailed(lang), channel: .query, voiceCode: lang.voiceCode)
            }
        }
    }

    /// 发送图片：压缩到 ≤ ~380KB JPEG（base64 膨胀 1.33 倍后仍在后端 550KB 限制内）。
    private func sendPhoto(_ item: PhotosPickerItem) async {
        guard let raw = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: raw) else { return }
        var quality: CGFloat = 0.7
        var side: CGFloat = 1280
        var jpeg: Data?
        for _ in 0..<5 { // 逐级压缩直到大小达标
            let scaled = Self.resized(image, maxSide: side)
            jpeg = scaled.jpegData(compressionQuality: quality)
            if let d = jpeg, d.count <= 380_000 { break }
            quality -= 0.15; side *= 0.75
        }
        guard let data = jpeg else { return }
        let b64 = "data:image/jpeg;base64," + data.base64EncodedString()
        sending = true
        defer { sending = false }
        if let m = try? await send(kind: "image", text: b64) {
            messages.append(m)
            errorText = nil // 成功清掉上一条失败横幅，避免误导
        } else {
            errorText = ChatStrings.sendFailed(lang)
            SpeechHub.shared.speak(ChatStrings.sendFailed(lang), channel: .query, voiceCode: lang.voiceCode)
        }
    }

    /// 发送视频：原始二进制上传到服务器磁盘（≤50MB），拿 mediaId 再发 kind=video 消息。
    private func sendVideo(_ item: PhotosPickerItem) async {
        guard let token = session.token,
              let raw = try? await item.loadTransferable(type: Data.self) else {
            errorText = ChatStrings.sendFailed(lang)
            SpeechHub.shared.speak(ChatStrings.sendFailed(lang), channel: .query, voiceCode: lang.voiceCode)
            return
        }
        guard raw.count <= 50 * 1024 * 1024 else {
            errorText = ChatStrings.videoTooLarge(lang)
            SpeechHub.shared.speak(ChatStrings.videoTooLarge(lang), channel: .query, voiceCode: lang.voiceCode)
            return
        }
        SpeechHub.shared.speak(ChatStrings.uploadingVideo(lang), channel: .query, voiceCode: lang.voiceCode)
        sending = true
        defer { sending = false }
        do {
            let mediaId = try await APIClient().uploadMedia(token: token, data: raw, mime: Self.videoMime(raw))
            let m = try await send(kind: "video", text: mediaId)
            messages.append(m)
            errorText = nil
        } catch {
            errorText = ChatStrings.sendFailed(lang)
            SpeechHub.shared.speak(ChatStrings.sendFailed(lang), channel: .query, voiceCode: lang.voiceCode)
        }
    }

    /// 视频容器嗅探：ftyp brand 在第 8~12 字节，"qt"开头是 QuickTime（相册原片常见），其余按 mp4。
    private static func videoMime(_ data: Data) -> String {
        guard data.count >= 12, let brand = String(data: data.subdata(in: 8..<12), encoding: .ascii) else {
            return "video/mp4"
        }
        return brand.hasPrefix("qt") ? "video/quicktime" : "video/mp4"
    }

    private static func resized(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let longest = max(image.size.width, image.size.height)
        guard longest > maxSide else { return image }
        let scale = maxSide / longest
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }

    /// 撤回（仅自己 2 分钟内；后端校验是权威，视频撤回时服务器同时删媒体文件）。
    private func recall(_ m: ChatMessageInfo) {
        guard let token = session.token else { return }
        Task {
            if let updated = await APIClient().recallMessage(token: token, id: m.id) {
                if let i = messages.firstIndex(where: { $0.id == m.id }) { messages[i] = updated }
            } else {
                errorText = ChatStrings.recallFailed(lang)
            }
        }
    }

    /// 表情回应（空=取消）。
    private func react(_ m: ChatMessageInfo, emoji: String) {
        guard let token = session.token else { return }
        Task {
            if let updated = await APIClient().reactMessage(token: token, id: m.id, emoji: emoji),
               let i = messages.firstIndex(where: { $0.id == m.id }) {
                messages[i] = updated
            }
        }
    }

    private func toggleVoiceNote() {
        if recorder.isRecording {
            recorder.stop { data in
                guard let data else { return }
                let b64 = "data:audio/m4a;base64," + data.base64EncodedString()
                sending = true
                Task {
                    defer { sending = false }
                    if let m = try? await send(kind: "audio", text: b64) {
                        messages.append(m)
                        errorText = nil
                    } else {
                        errorText = ChatStrings.sendFailed(lang)
                        // 盲人看不到红字横幅——发送失败要朗读（与文本/图片/视频路径一致，见 P1 审计）。
                        SpeechHub.shared.speak(ChatStrings.sendFailed(lang), channel: .query, voiceCode: lang.voiceCode)
                    }
                }
            }
        } else {
            recorder.start { granted in
                if granted {
                    SpeechHub.shared.speak(ChatStrings.recording(lang), channel: .query, voiceCode: lang.voiceCode)
                } else {
                    errorText = ChatStrings.micDenied(lang)
                    // 麦克风权限被拒：盲人点完麦克风毫无反馈——朗读原因（见 P1 审计）。
                    SpeechHub.shared.speak(ChatStrings.micDenied(lang), channel: .query, voiceCode: lang.voiceCode)
                }
            }
        }
    }

    private func playVoice(_ m: ChatMessageInfo) {
        guard let comma = m.text.firstIndex(of: ","),
              let data = Data(base64Encoded: String(m.text[m.text.index(after: comma)...])) else { return }
        SpeechHub.shared.stopChannel(.query) // 播语音条前让播报安静（同通道语义）
        player = try? AVAudioPlayer(data: data)
        player?.play()
        // 播放结束后恢复安全播报音频会话（录音侧已有同样恢复；漏掉这边会让后续播报变闷/无声）。
        if let duration = player?.duration {
            Task { [weak player] in
                try? await Task.sleep(for: .seconds(duration + 0.3))
                if player?.isPlaying != true { AudioSessionManager.configure() }
            }
        }
    }

    /// 播放视频消息：下载（带缓存）→ 全屏播放器。
    private func playVideoMessage(_ m: ChatMessageInfo) {
        guard let token = session.token else { return }
        Task {
            do {
                let url = try await APIClient().downloadMedia(token: token, id: m.text)
                SpeechHub.shared.stopChannel(.query) // 播视频前让播报安静（同通道语义）
                playingVideo = PlayableVideo(id: m.text, url: url)
            } catch {
                errorText = ChatStrings.videoLoadFailed(lang)
            }
        }
    }
}

// MARK: - 图片全屏查看（捏合缩放）

struct ZoomableImage: Identifiable {
    let id = UUID().uuidString
    let image: UIImage
}

/// 收到的照片点开后全屏查看，支持双指捏合缩放（聊天双方多为明眼亲友/协助者）。
struct ImageViewerSheet: View {
    let image: UIImage
    let lang: Language
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            Image(uiImage: image)
                .resizable().scaledToFit()
                .scaleEffect(scale)
                .gesture(MagnificationGesture()
                    .onChanged { scale = max(1, min($0, 4)) }
                    .onEnded { _ in if scale < 1.05 { withAnimation { scale = 1 } } })
                .accessibilityLabel(ChatStrings.photo(lang))
            Button { dismiss() } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 36)).foregroundStyle(.white.opacity(0.9)).padding()
            }
            .accessibilityLabel(ChatStrings.close(lang))
        }
    }
}

// MARK: - 视频全屏播放

struct PlayableVideo: Identifiable {
    let id: String
    let url: URL
}

struct VideoPlayerSheet: View {
    let url: URL
    let lang: Language
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            if let player {
                VideoPlayer(player: player).ignoresSafeArea()
            }
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 36))
                    .foregroundStyle(.white.opacity(0.9))
                    .padding()
            }
            .accessibilityLabel(ChatStrings.close(lang))
        }
        .onAppear {
            let p = AVPlayer(url: url)
            player = p
            p.play()
        }
        .onDisappear {
            player?.pause()
            AudioSessionManager.configure() // 恢复安全播报会话
        }
    }
}

// MARK: - 语音条录制（AAC m4a，上限 19s 对应后端 400KB 限制）

@Observable
final class VoiceNoteRecorder {
    private(set) var isRecording = false
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var url: URL?
    @ObservationIgnored private var limitTask: Task<Void, Never>?

    func start(completion: @escaping (Bool) -> Void) {
        AVAudioApplication.requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else { completion(false); return }
                let session = AVAudioSession.sharedInstance()
                try? session.setCategory(.playAndRecord, mode: .default, options: [.duckOthers])
                try? session.setActive(true)
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-\(UUID().uuidString).m4a")
                let settings: [String: Any] = [
                    AVFormatIDKey: kAudioFormatMPEG4AAC,
                    AVSampleRateKey: 22050,
                    AVNumberOfChannelsKey: 1,
                    AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
                ]
                guard let rec = try? AVAudioRecorder(url: url, settings: settings) else { completion(false); return }
                self.url = url
                self.recorder = rec
                rec.record()
                self.isRecording = true
                completion(true)
                // 19s 上限：自动停止（数据约 ≤350KB，留余量给 base64 膨胀后的 400KB 后端上限）。
                self.limitTask = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(19))
                    guard let self, self.isRecording else { return }
                    await MainActor.run { self.stop { _ in } } // 超时静默截停（用户再点会发现已停止）
                }
            }
        }
    }

    func stop(completion: @escaping (Data?) -> Void) {
        limitTask?.cancel(); limitTask = nil
        guard isRecording, let rec = recorder, let url else { completion(nil); return }
        rec.stop()
        isRecording = false
        recorder = nil
        AudioSessionManager.configure() // 恢复安全播报会话
        completion(try? Data(contentsOf: url))
        try? FileManager.default.removeItem(at: url)
        self.url = nil
    }

    func cancel() {
        limitTask?.cancel(); limitTask = nil
        recorder?.stop()
        recorder = nil
        isRecording = false
        if let url { try? FileManager.default.removeItem(at: url) }
        url = nil
        AudioSessionManager.configure()
    }
}
