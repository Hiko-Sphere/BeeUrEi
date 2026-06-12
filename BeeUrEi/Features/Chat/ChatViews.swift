import SwiftUI
import AVFoundation
import UIKit
import PhotosUI

// MARK: - 会话列表（WhatsApp 式：头像 + 最后一条预览 + 未读角标 + 时间）

struct ConversationsView: View {
    let session: AuthSession
    @State private var conversations: [ConversationInfo] = []
    @State private var pollTask: Task<Void, Never>?
    @State private var opened: ConversationInfo?
    @State private var showNewChat = false
    @State private var contacts: [FamilyLinkInfo] = [] // accepted 绑定 = 可聊天联系人
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            Group {
                if conversations.isEmpty {
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
                    List(conversations) { conv in
                        Button { opened = conv } label: { row(conv) }
                            .buttonStyle(.plain)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel(rowA11y(conv))
                            .accessibilityAddTraits(.isButton)
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
            }
            .navigationDestination(item: $opened) { conv in
                ChatView(session: session, peerId: conv.peer.id, peerName: conv.peer.displayName,
                         peerAvatar: conv.peer.avatar)
            }
            // 新建对话：从 accepted 绑定联系人中选一位进入聊天。
            .sheet(isPresented: $showNewChat) {
                NavigationStack {
                    Group {
                        if contacts.isEmpty {
                            BeeEmptyState(systemImage: "person.2.slash",
                                          title: ChatStrings.pickContact(lang), message: ChatStrings.noContacts(lang))
                        } else {
                            List(contacts) { c in
                                Button {
                                    showNewChat = false
                                    opened = ConversationInfo(
                                        peer: .init(id: c.memberId, username: "", displayName: c.memberName,
                                                    avatar: c.memberAvatar),
                                        last: ChatMessageInfo(id: "new-\(c.memberId)", fromId: "", toId: c.memberId,
                                                              kind: "text", text: "", createdAt: 0, readAt: nil, reaction: nil),
                                        unread: 0)
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
                    .navigationTitle(ChatStrings.pickContact(lang))
                    .navigationBarTitleDisplayMode(.inline)
                }
                .presentationDetents([.medium, .large])
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
            VStack(alignment: .trailing, spacing: 4) {
                Text(ChatStrings.timeFormat(c.last.createdAt)).font(.caption2).foregroundStyle(.secondary)
                if c.unread > 0 {
                    Text("\(c.unread)")
                        .font(.caption.bold()).foregroundStyle(.white)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Color.beeDanger, in: Capsule())
                }
            }
        }
        .padding(.vertical, 6)
    }

    private func preview(_ m: ChatMessageInfo) -> String {
        m.kind == "audio" ? "🎤 " + ChatStrings.voiceMessage(lang) : m.text
    }

    private func rowA11y(_ c: ConversationInfo) -> String {
        var parts = [c.peer.displayName, preview(c.last), ChatStrings.timeFormat(c.last.createdAt)]
        if c.unread > 0 { parts.append(ChatStrings.unreadBadgeA11y(c.unread, lang)) }
        return parts.joined(separator: "，")
    }
}

extension ConversationInfo: Hashable {
    static func == (l: ConversationInfo, r: ConversationInfo) -> Bool { l.peer.id == r.peer.id && l.last == r.last }
    func hash(into hasher: inout Hasher) { hasher.combine(peer.id) }
}

// MARK: - 聊天页（iMessage 式气泡 + 已读回执 + 语音条 + 轮询刷新）

struct ChatView: View {
    let session: AuthSession
    let peerId: String
    let peerName: String
    let peerAvatar: String?

    @State private var messages: [ChatMessageInfo] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var errorText: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var recorder = VoiceNoteRecorder()
    @State private var player: AVAudioPlayer?
    @State private var photoItem: PhotosPickerItem?
    @FocusState private var inputFocused: Bool
    private var lang: Language { FeatureSettings().language }
    private var myId: String { session.user?.id ?? "" }

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
        .navigationTitle(peerName)
        .navigationBarTitleDisplayMode(.inline)
        .task {
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
                bubbleContent(m, mine: mine)
                    .padding(.horizontal, m.kind == "image" ? 4 : 14)
                    .padding(.vertical, m.kind == "image" ? 4 : 10)
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
                    if mine && m.kind != "recalled" {
                        // 已读回执（iMessage 式）：✓ 已送达 / ✓✓ 已读。
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
            } else {
                Label(ChatStrings.photo(lang), systemImage: "photo")
            }
        case "recalled":
            Text(ChatStrings.recalled(lang)).font(.body.italic()).foregroundStyle(.secondary)
        default:
            Text(m.text).font(.body)
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

    private func bubbleA11y(_ m: ChatMessageInfo) -> String {
        let content: String
        switch m.kind {
        case "audio": content = ChatStrings.voiceMessage(lang)
        case "image": content = ChatStrings.photo(lang)
        case "recalled": content = ChatStrings.recalled(lang)
        default: content = m.text
        }
        var label = ChatStrings.bubbleA11y(from: m.fromId == myId ? ChatStrings.me(lang) : peerName,
                                           content: content, time: ChatStrings.timeFormat(m.createdAt), lang)
        if m.fromId == myId, m.kind != "recalled" {
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

    // MARK: 输入栏（文本 + 语音条）

    private var inputBar: some View {
        HStack(spacing: BeeSpacing.sm) {
            // 语音条：点击开始录音，再点结束并发送（盲人友好：点击切换而非长按）。
            Button {
                toggleVoiceNote()
            } label: {
                Image(systemName: recorder.isRecording ? "stop.circle.fill" : "mic.circle.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(recorder.isRecording ? Color.beeDanger : Color.beeHoney)
            }
            .accessibilityLabel(recorder.isRecording ? ChatStrings.voiceStop(lang) : ChatStrings.voiceStart(lang))

            // 图片消息（压缩后 data URL ≤ 后端 550KB 限制）。
            PhotosPicker(selection: $photoItem, matching: .images) {
                Image(systemName: "photo.circle.fill").font(.system(size: 34)).foregroundStyle(Color.beeHoney)
            }
            .accessibilityLabel(ChatStrings.sendPhoto(lang))
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                photoItem = nil
                Task { await sendPhoto(item) }
            }

            TextField(ChatStrings.inputPlaceholder(lang), text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.roundedBorder)
                .focused($inputFocused)

            Button {
                sendText()
            } label: {
                Image(systemName: "arrow.up.circle.fill").font(.system(size: 34))
                    .foregroundStyle(draft.trimmingCharacters(in: .whitespaces).isEmpty ? Color.secondary : Color.beeSuccess)
            }
            .disabled(sending || draft.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityLabel(ChatStrings.send(lang))
        }
        .padding(.horizontal).padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: 行为

    private func refresh(announceNew: Bool) async {
        guard let token = session.token else { return }
        guard let list = try? await APIClient().messages(token: token, with: peerId) else { return }
        if announceNew {
            let known = Set(messages.map(\.id))
            for m in list where !known.contains(m.id) && m.fromId == peerId {
                // 新到消息语音播报：经总线 .query（不打断避障/导航/来电播报，闲时补播）。
                let speak = m.kind == "audio" ? ChatStrings.newVoiceSpeak(peerName, lang)
                                              : ChatStrings.newMessageSpeak(peerName, String(m.text.prefix(60)), lang)
                SpeechHub.shared.speak(speak, channel: .query, voiceCode: lang.voiceCode)
            }
            if list.contains(where: { !known.contains($0.id) && $0.fromId == peerId }) { markRead() }
        }
        messages = list
    }

    private func markRead() {
        guard let token = session.token else { return }
        Task { await APIClient().markMessagesRead(token: token, fromId: peerId) }
    }

    private func sendText() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let token = session.token else { return }
        draft = ""
        sending = true
        Task {
            defer { sending = false }
            do {
                let m = try await APIClient().sendMessage(token: token, toId: peerId, kind: "text", text: text)
                messages.append(m)
                errorText = nil
            } catch {
                errorText = ChatStrings.sendFailed(lang)
                draft = text // 失败还原草稿，不丢内容
            }
        }
    }

    /// 发送图片：压缩到 ≤ ~380KB JPEG（base64 膨胀 1.33 倍后仍在后端 550KB 限制内）。
    private func sendPhoto(_ item: PhotosPickerItem) async {
        guard let token = session.token,
              let raw = try? await item.loadTransferable(type: Data.self),
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
        if let m = try? await APIClient().sendMessage(token: token, toId: peerId, kind: "image", text: b64) {
            messages.append(m)
        } else {
            errorText = ChatStrings.sendFailed(lang)
        }
    }

    private static func resized(_ image: UIImage, maxSide: CGFloat) -> UIImage {
        let longest = max(image.size.width, image.size.height)
        guard longest > maxSide else { return image }
        let scale = maxSide / longest
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    }

    /// 撤回（仅自己 2 分钟内；后端校验是权威）。
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
                guard let data, let token = session.token else { return }
                let b64 = "data:audio/m4a;base64," + data.base64EncodedString()
                Task {
                    if let m = try? await APIClient().sendMessage(token: token, toId: peerId, kind: "audio", text: b64) {
                        messages.append(m)
                    } else {
                        errorText = ChatStrings.sendFailed(lang)
                    }
                }
            }
        } else {
            recorder.start { granted in
                if granted {
                    SpeechHub.shared.speak(ChatStrings.recording(lang), channel: .query, voiceCode: lang.voiceCode)
                } else {
                    errorText = ChatStrings.micDenied(lang)
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
