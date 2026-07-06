import SwiftUI

/// 用户端"我的录音"：列出本人作为录制者的通话录制（含时间/地点/人/时长），可回放或删除。
/// 删除为软删除——管理员在保留期内仍可查看（合规/取证），界面如实说明。
struct MyRecordingsView: View {
    @State private var recordings: [RecordingInfo] = []
    @State private var loading = false
    @State private var errorText: String?
    @State private var busyIds: Set<String> = []
    @State private var deleteTarget: RecordingInfo?
    @State private var playing: PlayableVideo?
    @State private var playError: String?
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        List {
            if let errorText {
                Section { Text(errorText).foregroundStyle(Color.beeDanger) }
            }
            if recordings.isEmpty && !loading {
                Section {
                    BeeEmptyState(systemImage: "waveform.circle", title: RecordingStrings.emptyTitle(lang), message: RecordingStrings.emptyMessage(lang))
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(recordings) { rec in
                    RecordingRow(rec: rec, lang: lang, showOwner: false,
                                 onPlay: { Task { await play(rec) } },
                                 busy: busyIds.contains(rec.id))
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { deleteTarget = rec } label: { Label(RecordingStrings.delete(lang), systemImage: "trash") }
                        }
                }
            }
        }
        .navigationTitle(RecordingStrings.title(lang))
        .overlay { if loading && recordings.isEmpty { ProgressView() } }
        .refreshable { await load() }
        .task { await load() }
        // 加载/删除失败主动朗读——盲人看不到那行红字，此前只显示不朗读（与 BlocklistView/SavedPlacesView 同口径）。
        .onChange(of: errorText) { _, e in if let e, !e.isEmpty { A11y.announce(e) } }
        .fullScreenCover(item: $playing) { v in VideoPlayerSheet(url: v.url, lang: lang) }
        .alert(RecordingStrings.deleteConfirmTitle(lang), isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } })) {
            Button(RecordingStrings.delete(lang), role: .destructive) { if let t = deleteTarget { Task { await deleteRec(t) } }; deleteTarget = nil }
            Button(AccountStrings.cancel(lang), role: .cancel) { deleteTarget = nil }
        } message: { Text(RecordingStrings.deleteConfirmMessage(lang)) }
        .alert(RecordingStrings.playFailed(lang), isPresented: Binding(get: { playError != nil }, set: { if !$0 { playError = nil } })) {
            Button(AccountStrings.ok(lang), role: .cancel) { playError = nil }
        } message: { if let playError { Text(playError) } }
    }

    private func load() async {
        guard let token = KeychainStore.read() else { errorText = RecordingStrings.loadFailed(lang); return }
        guard !loading else { return }
        loading = true; defer { loading = false }
        do { recordings = try await APIClient().myRecordings(token: token); errorText = nil }
        catch { errorText = RecordingStrings.loadFailed(lang) }
    }

    private func play(_ rec: RecordingInfo) async {
        guard rec.hasMedia else { playError = RecordingStrings.mediaGone(lang); return }
        guard let token = KeychainStore.read(), !busyIds.contains(rec.id) else { return }
        busyIds.insert(rec.id); defer { busyIds.remove(rec.id) }
        do {
            let url = try await APIClient().downloadRecording(token: token, id: rec.id)
            SpeechHub.shared.stopAll() // 让位语音总线，避免与视频声重叠
            playing = PlayableVideo(id: rec.id, url: url)
        } catch { playError = RecordingStrings.playFailed(lang) }
    }

    private func deleteRec(_ rec: RecordingInfo) async {
        guard let token = KeychainStore.read(), !busyIds.contains(rec.id) else { return }
        busyIds.insert(rec.id); defer { busyIds.remove(rec.id) }
        do {
            try await APIClient().deleteMyRecording(token: token, id: rec.id)
            APIClient().evictCachedRecording(id: rec.id) // 兑现"删除"：清掉本机已下载的副本
            recordings.removeAll { $0.id == rec.id }
            A11y.announce(RecordingStrings.deleted(lang)) // 盲人看不到那行消失，须听到"已删除"
        } catch { errorText = RecordingStrings.deleteFailed(lang) }
    }
}

/// 一行录制：时间 / 参与者（人）/ 时长 / 地点 / 理由 + 播放按钮。admin 视图额外显示"用户已删除·留存中"。
struct RecordingRow: View {
    let rec: RecordingInfo
    let lang: Language
    var showOwner: Bool = false
    let onPlay: () -> Void
    var busy: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(RecordingStrings.timeText(rec.recordedAt, lang)).font(.subheadline.weight(.semibold))
                Spacer()
                if let d = rec.durationSec { Text(RecordingStrings.durationLabel(d, lang)).font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
            }
            Text(RecordingStrings.participantsLabel(rec.participantNames, lang)).font(.footnote).foregroundStyle(.secondary)
            // 录制原因（知情同意透明度）：服务端下发 reason 却从未在 iOS 列表呈现（死字段，与 web 2ef0c88 对齐）。
            // 仅原因非空白时展示（默认 ''）。
            if !rec.reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text(RecordingStrings.reasonPrefix(lang) + rec.reason).font(.caption).foregroundStyle(.secondary)
            }
            if let loc = rec.locationLabel, !loc.isEmpty {
                Text(RecordingStrings.locationPrefix(lang) + loc).font(.caption).foregroundStyle(.secondary)
            }
            if rec.deletedAt != nil {
                Text(RecordingStrings.userDeletedBadge(lang)).font(.caption.weight(.semibold)).foregroundStyle(Color.beeWarn)
            }
            Button(action: onPlay) {
                Label(RecordingStrings.play(lang), systemImage: "play.circle.fill")
            }
            .buttonStyle(.bordered)
            .disabled(busy || !rec.hasMedia)
            .padding(.top, 2)
            if !rec.hasMedia {
                Text(RecordingStrings.mediaGone(lang)).font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
