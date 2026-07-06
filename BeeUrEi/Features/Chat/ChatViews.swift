import SwiftUI
import AVFoundation
import AVKit
import UIKit
import PhotosUI
import Vision

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
        return parts.joined(separator: lang.listSeparator)
    }

    private func groupRowA11y(_ g: GroupConversationInfo) -> String {
        var parts = [g.group.name, ChatStrings.members(g.group.memberIds.count, lang), groupPreview(g)]
        if g.unread > 0 { parts.append(ChatStrings.unreadBadgeA11y(g.unread, lang)) }
        return parts.joined(separator: lang.listSeparator)
    }
}

/// 表情回应播报差分（纯逻辑，可单测）：轮询刷新时，找出**我发的消息**上新贴/改变的表情——盲人看不到角标，
/// 靠此语音得知被回应。只报"我的消息"(fromId==myId)、表情非空、且相对上一份快照**有变化**的。
/// 自反应天然不重报：react() 会即时把我的表情写进本地 messages，故下次轮询 old 已含它、差分无变化。
/// 首次见到的消息（old 里没有）不在此报——由新消息分支处理，避免首载把历史表情全轰炸一遍。
enum ChatReactionAnnouncer {
    static func newReactionsOnMyMessages(old: [ChatMessageInfo], new: [ChatMessageInfo], myId: String) -> [String] {
        let oldReaction = Dictionary(old.map { ($0.id, $0.reaction ?? "") }, uniquingKeysWith: { a, _ in a })
        var out: [String] = []
        for m in new {
            guard m.fromId == myId, let r = m.reaction, !r.isEmpty else { continue }
            guard let prev = oldReaction[m.id] else { continue } // 首见消息不报
            if prev != r { out.append(r) }                       // 变化才报（含首次贴/换表情；移除→空由上面 !r.isEmpty 排除）
        }
        return out
    }
}

/// 消息编辑播报差分（纯逻辑，可单测）：轮询刷新时，找出**对方已发出的消息**被改过的——盲人只听过原文，
/// 若对方把时间/地点等关键信息改了会按旧的行动。只报 fromId != myId（对方发的；本人编辑自己知道）、
/// editedAt 相对旧快照增大（真被改）、非撤回（撤回文本空、另论）、且 old 里已存在（首见由新消息分支处理，念现文）。
enum ChatEditAnnouncer {
    static func peerEditsToAnnounce(old: [ChatMessageInfo], new: [ChatMessageInfo], myId: String) -> [ChatMessageInfo] {
        let oldEdited = Dictionary(old.map { ($0.id, $0.editedAt ?? 0) }, uniquingKeysWith: { a, _ in a })
        return new.filter { m in
            guard m.fromId != myId, m.kind != "recalled", let e = m.editedAt else { return false }
            guard let prev = oldEdited[m.id] else { return false } // 首见不报
            return e > prev
        }
    }
}

/// 消息撤回播报差分（纯逻辑，可单测）：轮询刷新时，找出**对方已见过的消息**从非撤回变为撤回的——盲人只听过原文，
/// 若据其行动（去某处等）会扑空。只报 fromId != myId（对方撤的；本人自己撤自己知道）、old 里非撤回而 new 里已撤回、
/// old 里已存在（首见即已撤回的消息由新消息分支跳过、不在此报，避免"进来就念一堆撤回"）。
enum ChatRecallAnnouncer {
    static func peerRecalls(old: [ChatMessageInfo], new: [ChatMessageInfo], myId: String) -> [ChatMessageInfo] {
        let oldKind = Dictionary(old.map { ($0.id, $0.kind) }, uniquingKeysWith: { a, _ in a })
        return new.filter { m in
            guard m.fromId != myId, m.kind == "recalled" else { return false }
            guard let prevKind = oldKind[m.id] else { return false } // 首见不报
            return prevKind != "recalled"                            // 非撤回→撤回 才报
        }
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
    @State private var canLoadEarlier = false   // 顶部"加载更早消息"是否可见
    @State private var loadingEarlier = false    // 正在加载更早历史
    @State private var reachedStart = false      // 已翻到对话最开头（再无更早）
    private let chatPageLimit = 50               // 与 APIClient 单次拉取条数一致
    @State private var pollTask: Task<Void, Never>?
    @State private var recorder = VoiceNoteRecorder()
    @State private var player: AVAudioPlayer?
    @State private var photoItem: PhotosPickerItem?
    @State private var playingVideo: PlayableVideo?
    @State private var zoomImage: ZoomableImage?    // 点开图片全屏查看
    @State private var groupDetail: GroupConversationInfo? // 群聊：成员表（发言人名字/管理）
    @State private var showGroupInfo = false
    @State private var showSearch = false
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
                        if canLoadEarlier {
                            Button { Task { await loadEarlier() } } label: {
                                if loadingEarlier { ProgressView() }
                                else { Text(ChatStrings.loadEarlier(lang)).font(.footnote).foregroundStyle(Color.beeAccent) }
                            }
                            .disabled(loadingEarlier)
                            .padding(.bottom, BeeSpacing.xs)
                        }
                        ForEach(messages) { m in bubble(m) }
                    }
                    .padding()
                }
                // 仅当**最新一条**变化时滚到底（新消息）；上翻加载更早消息时 last 不变，不应跳到底部。
                .onChange(of: messages.last?.id) { _, _ in
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
            ToolbarItem(placement: .primaryAction) {
                Button { showSearch = true } label: { Image(systemName: "magnifyingglass") }
                    .accessibilityLabel(ChatStrings.searchTitle(lang))
            }
            if isGroup {
                ToolbarItem(placement: .primaryAction) {
                    Button { showGroupInfo = true } label: { Image(systemName: "person.3") }
                        .accessibilityLabel(ChatStrings.groupInfo(lang))
                }
            }
        }
        .sheet(isPresented: $showSearch) {
            MessageSearchSheet(session: session, peerId: peerId, groupId: groupId,
                               memberName: isGroup ? { senderName($0) } : nil, selfId: myId, lang: lang)
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
                // 转发标记（WhatsApp 式，气泡上方）：让收件人知道非发送者原创。视觉呈现；a11y 并入气泡整体标签(bubbleA11y)。
                if m.forwarded == true, m.kind != "recalled" {
                    Text("↪ " + ChatStrings.forwardedTag(lang)).font(.caption2).italic()
                        .foregroundStyle(.secondary).accessibilityHidden(true)
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
                    // 已编辑标记（与 web 对齐）：视觉呈现；a11y 并入气泡整体标签(bubbleA11y)。
                    if m.editedAt != nil, m.kind != "recalled" {
                        Text(ChatStrings.editedTag(lang)).font(.caption2).foregroundStyle(.secondary).accessibilityHidden(true)
                    }
                    if mine && m.kind != "recalled" && !isGroup {
                        // 已读回执（iMessage 式）：✓ 已送达 / ✓✓ 已读。
                        Image(systemName: m.readAt != nil ? "checkmark.circle.fill" : "checkmark.circle")
                            .font(.caption2)
                            .foregroundStyle(m.readAt != nil ? Color.beeSuccess : Color.secondary)
                            .accessibilityHidden(true)
                    }
                    // 群已读回执（WhatsApp 式「已读 N/总」，仅自己发、群里有其他成员）：此前群消息完全无已读反馈。
                    // 视觉呈现；a11y 并入气泡整体标签(bubbleA11y)。全员已读时高亮。
                    if mine, m.kind != "recalled", isGroup, let total = m.readTotal, total > 0 {
                        Text(ChatStrings.groupReceipt(m.readBy ?? 0, total, lang)).font(.caption2)
                            .foregroundStyle((m.readBy ?? 0) >= total ? Color.beeSuccess : .secondary)
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
            // mine：自己发的不显示"用蜂之眼导航去这里"（导航到自己脚下无意义）。
            LocationBubble(payload: payload, lang: lang, mine: mine)
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
                    VStack(alignment: .leading, spacing: 6) {
                        Image(uiImage: img)
                            .resizable().scaledToFit()
                            .frame(maxWidth: 220, maxHeight: 280)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .onTapGesture { zoomImage = ZoomableImage(image: img) }
                            .accessibilityAddTraits(.isButton)
                            .accessibilityHint(ChatStrings.openPhotoHint(lang))
                            // 盲人收到图片看不见——端侧 OCR 读出图中文字（亲友常拍处方/时刻表/说明/纸条让盲人"看"）。
                            // VoiceOver 转子自定义操作；语音随文字语言（中/英）自动切换，复用识别屏同一朗读管线。
                            .accessibilityAction(named: Text(ChatStrings.readPhotoText(lang))) { readImageText(img) }
                            // 复制图中文字：盲人可把处方/地址/时刻表存下，粘进备忘录/提醒/地图（读=听、复制=留存转发）。
                            .accessibilityAction(named: Text(ChatStrings.copyPhotoText(lang))) { copyImageText(img) }
                        // 可见"读文字"按钮：上面的 OCR 读文字此前**只在 VoiceOver 转子**（最难发现的层）——转子操作连很多
                        // VoiceOver 用户都不知道、不用 VoiceOver 的盲人更无从触发。读亲友拍来的处方/时刻表/纸条是核心场景，
                        // 须有可见可点入口（同音频气泡的可见播放按钮）。转子操作保留，作为熟练用户的快捷。
                        Button { readImageText(img) } label: {
                            Label(ChatStrings.readPhotoText(lang), systemImage: "text.viewfinder").font(.footnote)
                        }
                        .buttonStyle(.borderless)
                    }
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

    /// 端侧 OCR 一张图片（中英双语），主线程回调**按阅读序整理**的正文（空=无文字）。读图/复制图共用。
    /// **纯端侧、不上传图片**（隐私优先，图片本就在本机）。cgImage 缺失（如 CIImage 后端）回调空串。
    private func ocrImage(_ img: UIImage, then handle: @escaping (String) -> Void) {
        guard let cg = img.cgImage else { handle(""); return }
        let request = VNRecognizeTextRequest { req, _ in
            let items: [(text: String, box: CGRect)] = ((req.results as? [VNRecognizedTextObservation]) ?? []).compactMap { o in
                guard let s = o.topCandidates(1).first?.string else { return nil }
                return (s, o.boundingBox)
            }
            let text = FramingAssistViewModel.orderedOCRText(from: items) // 核心 ReadingOrder 阅读序（已测）
            DispatchQueue.main.async { handle(text) }
        }
        // 简体 + **繁体** + 英文（与识别屏同用核心 OCRLanguagePolicy）：读亲友拍来的**繁体**处方/时刻表/纸条
        // 此前会乱码（台湾/港澳），单点补齐。
        request.recognitionLanguages = OCRLanguagePolicy.recognitionLanguages(interfaceLanguage: lang)
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        DispatchQueue.global(qos: .userInitiated).async {
            try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
        }
    }

    /// 读出图片里的文字（盲人收图看不见内容——亲友常拍处方/时刻表/说明书/纸条让盲人"看"）。
    /// 语音**随文字语言**（中/英）朗读，与识别屏"读文字"同一管线（orderedOCRText + dominantTextIsChinese）。
    private func readImageText(_ img: UIImage) {
        let lang = self.lang
        SpeechHub.shared.speak(ChatStrings.readingPhoto(lang), channel: .query, voiceCode: lang.voiceCode) // 即时提示，计算期间不冷场
        ocrImage(img) { text in
            if text.isEmpty {
                SpeechHub.shared.speak(ChatStrings.noTextInPhoto(lang), channel: .query, voiceCode: lang.voiceCode)
            } else {
                let voice = FramingAssistViewModel.dominantTextIsChinese(text) ? Language.zh.voiceCode : Language.en.voiceCode
                SpeechHub.shared.speak(text, channel: .query, voiceCode: voice)
            }
        }
    }

    /// 复制图片里的文字到剪贴板（盲人可把亲友拍来的处方/地址/时刻表存下，粘进备忘录/提醒/地图）。
    /// 读出=当下听；复制=留存转发，两个独立操作。复制后语音回执"已复制"（否则盲人无从确认成功）。
    private func copyImageText(_ img: UIImage) {
        let lang = self.lang
        ocrImage(img) { text in
            if text.isEmpty {
                SpeechHub.shared.speak(ChatStrings.noTextInPhoto(lang), channel: .query, voiceCode: lang.voiceCode)
            } else {
                UIPasteboard.general.string = text
                SpeechHub.shared.speak(ChatStrings.photoTextCopied(lang), channel: .query, voiceCode: lang.voiceCode)
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
        // 发送者已退群 → 不在成员表里：给兜底名，避免空署名行 / VoiceOver 读空白 / 播报"（空）发来消息"。
        let name = groupDetail?.members.first { $0.id == id }?.displayName ?? ""
        return name.isEmpty ? ChatStrings.formerMember(lang) : name
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
        // 转发/编辑并入盲人所听的整体标签：上方视觉标签 accessibilityHidden，故此处必须补——否则盲人完全听不到
        // 这条是"已转发"（防误信链式内容）或"已编辑"。撤回消息不带（内容已是"已撤回"）。
        label += ChatStrings.forwardedEditedA11y(forwarded: m.forwarded == true && m.kind != "recalled",
                                                 edited: m.editedAt != nil && m.kind != "recalled", lang)
        if m.fromId == myId, m.kind != "recalled", !isGroup {
            label += "，" + (m.readAt != nil ? ChatStrings.read(lang) : ChatStrings.delivered(lang))
        }
        // 群已读回执并入盲人所听标签（视觉"已读 N/总"accessibilityHidden）：否则盲人发群消息完全不知被几人读了。
        if m.fromId == myId, m.kind != "recalled", isGroup, let total = m.readTotal, total > 0 {
            label += "，" + ChatStrings.groupReceiptA11y(m.readBy ?? 0, total, lang)
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
                // 撤回消息（kind=recalled，text 为空）不播报：可能是对端在本端轮询看到原消息前就撤回了
                // （首次见到即已撤回），此时念"X 发来消息：（空）"对盲人是无意义噪声；列表仍显示"[已撤回]"占位。
                if m.kind == "recalled" { continue }
                // 新到消息语音播报：经总线 .query（不打断避障/导航/来电播报，闲时补播）。
                let name = isGroup ? senderName(m.fromId) : target.title
                let speak: String
                if LocationPayload.from(m) != nil {
                    speak = ChatStrings.newLocationSpeak(name, lang)
                } else {
                    switch m.kind {
                    case "audio": speak = ChatStrings.newVoiceSpeak(name, lang)
                    case "video": speak = ChatStrings.newVideoSpeak(name, lang)
                    case "image": speak = ChatStrings.newPhotoSpeak(name, lang) // 否则会把 base64 data URL 念给盲人
                    default:
                        speak = isGroup
                            ? ChatStrings.newGroupMessageSpeak(name, target.title, String(m.text.prefix(60)), lang)
                            : ChatStrings.newMessageSpeak(name, String(m.text.prefix(60)), lang)
                    }
                }
                SpeechHub.shared.speak(speak, channel: .query, voiceCode: lang.voiceCode)
            }
            if !fresh.isEmpty { markRead() }
            // 表情回应（我发的消息被对方贴表情）：盲人看不到角标，语音得知被回应。用**轮询前**的 messages 做差分基线
            // （messages 在本函数末尾才 merge 更新，此处仍是旧快照）；自反应已即时写入 messages 故不重报（见 helper 注）。
            for emoji in ChatReactionAnnouncer.newReactionsOnMyMessages(old: messages, new: list, myId: myId) {
                SpeechHub.shared.speak(ChatStrings.reactionReceivedSpeak(emoji, lang), channel: .query, voiceCode: lang.voiceCode)
            }
            // 对方改了已发的消息（可能改了关键信息，如约定时间/地点）：念出修正后的内容，盲人才不会按旧的行动。
            for m in ChatEditAnnouncer.peerEditsToAnnounce(old: messages, new: list, myId: myId) {
                let name = isGroup ? senderName(m.fromId) : target.title
                SpeechHub.shared.speak(ChatStrings.messageEditedSpeak(name, String(m.text.prefix(60)), lang), channel: .query, voiceCode: lang.voiceCode)
            }
            // 对方撤回了已发的消息：盲人只听过原文、看不到"[已撤回]"占位，据其行动会扑空——语音告知那条已作废。
            for m in ChatRecallAnnouncer.peerRecalls(old: messages, new: list, myId: myId) {
                let name = isGroup ? senderName(m.fromId) : target.title
                SpeechHub.shared.speak(ChatStrings.messageRecalledSpeak(name, lang), channel: .query, voiceCode: lang.voiceCode)
            }
        }
        // 最新一批满页且未翻到开头 → 可能还有更早历史，显示"加载更早"。
        canLoadEarlier = list.count >= chatPageLimit && !reachedStart
        // 合并而非直接替换：服务器为权威，但保留它**未返回**的已显示消息——既含尚未回流的本地已发
        // （否则乐观插入会被旧快照覆盖"消失"，这是"发完看不到消息"的根因），也含上翻加载的更早历史
        // （否则每次轮询都会把翻页加载的旧消息冲掉）。重叠 id 以服务器版本为准（如撤回更新）。
        messages = merged(server: list)
    }

    /// 加载更早历史（向上翻页）：取早于当前最旧一条的消息，前插去重。
    private func loadEarlier() async {
        guard let oldest = messages.first, !loadingEarlier, let token = session.token else { return }
        loadingEarlier = true; defer { loadingEarlier = false }
        let older: [ChatMessageInfo]?
        if let groupId {
            older = try? await APIClient().groupMessages(token: token, groupId: groupId, before: oldest.createdAt, beforeId: oldest.id)
        } else {
            older = try? await APIClient().messages(token: token, with: peerId ?? "", before: oldest.createdAt, beforeId: oldest.id)
        }
        guard let older else { return }
        if older.isEmpty { reachedStart = true; canLoadEarlier = false; return }
        // 去重并按时间排序（id 唯一；正常情况下 older 与现有不重叠，去重纯属稳妥）。
        var byId: [String: ChatMessageInfo] = [:]
        for m in older + messages { byId[m.id] = m }
        messages = byId.values.sorted { $0.createdAt != $1.createdAt ? $0.createdAt < $1.createdAt : $0.id < $1.id }
        if older.count < chatPageLimit { reachedStart = true; canLoadEarlier = false } // 不足一页 = 已到开头
    }

    /// 发送成功后把回流消息并入列表——**按 id 去重**：轮询可能在 `await send` 的窗口里已先带回同一条，
    /// 裸 append 会瞬时重复（盲人 TTS 把同一条念两遍），要等下次 merged() 才自愈。已存在则替换为新版本。
    private func appendSent(_ m: ChatMessageInfo) {
        if let i = messages.firstIndex(where: { $0.id == m.id }) { messages[i] = m }
        else { messages.append(m) }
    }

    /// 服务器最新窗口 ∪ 已显示但不在该窗口的消息（更早历史 + 本地待回流），按 id 去重、时间排序。
    private func merged(server: [ChatMessageInfo]) -> [ChatMessageInfo] {
        let serverIds = Set(server.map(\.id))
        let extra = messages.filter { !serverIds.contains($0.id) }
        guard !extra.isEmpty else { return server }
        // 稳定全序 (createdAt, id)：同毫秒的两条消息排序确定，避免轮询间相邻消息忽前忽后。
        return (server + extra).sorted { $0.createdAt != $1.createdAt ? $0.createdAt < $1.createdAt : $0.id < $1.id }
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
                appendSent(m)
                errorText = nil
            } catch {
                let msg = ChatStrings.sendErrorText(error, lang)
                errorText = msg
                SpeechHub.shared.speak(msg, channel: .query, voiceCode: lang.voiceCode)
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
                appendSent(m)
                errorText = nil
                SpeechHub.shared.speak(ChatStrings.locationSent(lang), channel: .query, voiceCode: lang.voiceCode) // "正在获取位置…"之后确认已发出
            } catch {
                let msg = ChatStrings.sendErrorText(error, lang)
                errorText = msg
                SpeechHub.shared.speak(msg, channel: .query, voiceCode: lang.voiceCode)
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
        do {
            let m = try await send(kind: "image", text: b64)
            appendSent(m)
            errorText = nil // 成功清掉上一条失败横幅，避免误导
            SpeechHub.shared.speak(ChatStrings.photoSent(lang), channel: .query, voiceCode: lang.voiceCode) // 盲人看不到气泡，须听到"已发送"
        } catch {
            let msg = ChatStrings.sendErrorText(error, lang)
            errorText = msg
            SpeechHub.shared.speak(msg, channel: .query, voiceCode: lang.voiceCode)
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
            appendSent(m)
            errorText = nil
            SpeechHub.shared.speak(ChatStrings.videoSent(lang), channel: .query, voiceCode: lang.voiceCode) // 上传后须确认送达（"上传中…"之后不能静默）
        } catch {
            // mediaUpload 功能被关 / 维护 / 聊天被关 都会到这里——给具体原因，不让盲人徒劳重试。
            let msg = ChatStrings.sendErrorText(error, lang)
            errorText = msg
            SpeechHub.shared.speak(msg, channel: .query, voiceCode: lang.voiceCode)
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
            do {
                let updated = try await APIClient().recallMessage(token: token, id: m.id)
                if let i = messages.firstIndex(where: { $0.id == m.id }) { messages[i] = updated }
                errorText = nil
            } catch {
                // 盲人看不到红字横幅——撤回失败必须**朗读**（此前只设 errorText，盲人得不到任何反馈、误以为已撤回）；
                // 且区分真因（时限过/功能关停/维护/限流），不恒显"是不是超时"。
                let msg = ChatStrings.recallErrorText(error, lang)
                errorText = msg
                SpeechHub.shared.speak(msg, channel: .query, voiceCode: lang.voiceCode)
            }
        }
    }

    /// 表情回应（空=取消）。
    private func react(_ m: ChatMessageInfo, emoji: String) {
        guard let token = session.token else { return }
        Task {
            if let updated = await APIClient().reactMessage(token: token, id: m.id, emoji: emoji) {
                if let i = messages.firstIndex(where: { $0.id == m.id }) { messages[i] = updated }
                // 盲人看不到表情角标——长按选完表情必须**有声确认**是否加上/取消（此前成功也静默，
                // 用户完全不知回应有没有成）。据服务器回传的最终 reaction 判"加上"还是"取消"。
                let applied = updated.reaction ?? ""
                let msg = applied.isEmpty ? ChatStrings.reactionRemoved(lang) : ChatStrings.reactionAdded(applied, lang)
                SpeechHub.shared.speak(msg, channel: .query, voiceCode: lang.voiceCode)
            } else {
                SpeechHub.shared.speak(ChatStrings.reactionFailed(lang), channel: .query, voiceCode: lang.voiceCode)
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
                    do {
                        let m = try await send(kind: "audio", text: b64)
                        appendSent(m)
                        errorText = nil
                        SpeechHub.shared.speak(ChatStrings.voiceSent(lang), channel: .query, voiceCode: lang.voiceCode) // 盲人看不到语音气泡，须确认已发出
                    } catch {
                        // 盲人看不到红字横幅——发送失败要朗读，且区分"功能关闭/维护"等不可重试原因。
                        let msg = ChatStrings.sendErrorText(error, lang)
                        errorText = msg
                        SpeechHub.shared.speak(msg, channel: .query, voiceCode: lang.voiceCode)
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
                // 盲人看不到红字横幅——点开的视频加载失败必须**朗读**（与发送/撤回失败同口径；此前只设 errorText、
                // 盲人得不到任何反馈，点了视频却像没反应）。
                let msg = ChatStrings.videoLoadFailed(lang)
                errorText = msg
                SpeechHub.shared.speak(msg, channel: .query, voiceCode: lang.voiceCode)
            }
        }
    }
}

// MARK: - 图片全屏查看（捏合缩放）

struct ZoomableImage: Identifiable {
    let id = UUID().uuidString
    let image: UIImage
}

/// 会话内消息搜索（参照 WhatsApp 搜索）：输入关键词 → 调后端搜索端点 → 列出命中文字消息
/// （发送者 + 内容 + 时间，时间倒序）。盲人友好：每条结果合并为单一 VoiceOver 标签朗读。
/// 首版只展示结果供阅读；跳转到原消息因翻页较复杂，留待后续。
struct MessageSearchSheet: View {
    let session: AuthSession
    let peerId: String?
    let groupId: String?
    let memberName: ((String) -> String)?  // 群聊：按 fromId 取发送者名；单聊为 nil
    let selfId: String
    let lang: Language

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [ChatMessageInfo] = []
    @State private var searching = false
    @State private var didSearch = false
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if searching {
                    ProgressView().frame(maxWidth: .infinity).padding()
                } else if didSearch && results.isEmpty {
                    BeeEmptyState(systemImage: "magnifyingglass",
                                  title: ChatStrings.searchNoResults(lang), message: "")
                } else if !didSearch {
                    BeeEmptyState(systemImage: "text.magnifyingglass",
                                  title: ChatStrings.searchTitle(lang), message: ChatStrings.searchPrompt(lang))
                } else {
                    List {
                        Section(ChatStrings.searchResultsCount(results.count, lang)) {
                            ForEach(results) { m in resultRow(m) }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(ChatStrings.searchTitle(lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(ChatStrings.close(lang)) { dismiss() } } }
            .searchable(text: $query, prompt: ChatStrings.searchPlaceholder(lang))
            .onChange(of: query) { _, _ in scheduleSearch() }
        }
    }

    private func resultRow(_ m: ChatMessageInfo) -> some View {
        let who = m.fromId == selfId ? ChatStrings.me(lang) : (memberName?(m.fromId) ?? "")
        let time = ChatStrings.timeFormat(m.createdAt)
        // 文本式位置（kind=text + 内嵌 maps 链接）命中时，显示 📍 地名而非一串原始 URL。
        let display: String
        if let loc = LocationPayload.from(m) {
            display = "📍 " + (loc.name ?? ChatStrings.unknownPlace(lang))
        } else {
            display = m.text
        }
        return VStack(alignment: .leading, spacing: 3) {
            HStack {
                if !who.isEmpty { Text(who).font(.caption.bold()).foregroundStyle(Color.beeHoney) }
                Spacer()
                Text(time).font(.caption2).foregroundStyle(.secondary)
            }
            Text(display).font(.body).lineLimit(3)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(ChatStrings.bubbleA11y(from: who.isEmpty ? ChatStrings.me(lang) : who,
                                                   content: display, time: time, lang))
    }

    /// 输入防抖 0.35s 再查（边输边查不打满后端）。
    private func scheduleSearch() {
        searchTask?.cancel()
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { results = []; didSearch = false; return }
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled, let token = session.token else { return }
            searching = true; defer { searching = false }
            let found = (try? await APIClient().searchMessages(token: token, peerId: peerId, groupId: groupId, query: q)) ?? []
            guard !Task.isCancelled else { return }
            results = found
            didSearch = true
        }
    }
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
