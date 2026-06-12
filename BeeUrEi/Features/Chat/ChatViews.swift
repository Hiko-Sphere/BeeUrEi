import SwiftUI
import AVFoundation
import UIKit

// MARK: - 会话列表（WhatsApp 式：头像 + 最后一条预览 + 未读角标 + 时间）

struct ConversationsView: View {
    let session: AuthSession
    @State private var conversations: [ConversationInfo] = []
    @State private var pollTask: Task<Void, Never>?
    @State private var opened: ConversationInfo?
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            Group {
                if conversations.isEmpty {
                    BeeEmptyState(systemImage: "bubble.left.and.bubble.right",
                                  title: ChatStrings.navTitle(lang), message: ChatStrings.empty(lang))
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
            .navigationDestination(item: $opened) { conv in
                ChatView(session: session, peerId: conv.peer.id, peerName: conv.peer.displayName,
                         peerAvatar: conv.peer.avatar)
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
                Group {
                    if m.kind == "audio" {
                        Button {
                            playVoice(m)
                        } label: {
                            Label(ChatStrings.voiceMessage(lang), systemImage: "play.circle.fill")
                                .font(.body.weight(.semibold))
                        }
                        .accessibilityLabel(ChatStrings.playVoice(lang))
                    } else {
                        Text(m.text).font(.body)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(mine ? Color.beeHoney : Color(.secondarySystemBackground),
                            in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .foregroundStyle(mine ? Color.beeInk : Color.primary)
                HStack(spacing: 4) {
                    Text(ChatStrings.timeFormat(m.createdAt)).font(.caption2).foregroundStyle(.secondary)
                    if mine {
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
        .accessibilityLabel(ChatStrings.bubbleA11y(
            from: m.fromId == myId ? ChatStrings.me(lang) : peerName,
            content: m.kind == "audio" ? ChatStrings.voiceMessage(lang) : m.text,
            time: ChatStrings.timeFormat(m.createdAt), lang)
            + (m.fromId == myId ? "，" + (m.readAt != nil ? ChatStrings.read(lang) : ChatStrings.delivered(lang)) : ""))
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
