import SwiftUI

/// 通话记录：呼出 / 呼入 / 未接 / 已拒绝。
struct CallHistoryView: View {
    @Environment(AuthSession.self) private var session
    @State private var calls: [CallRecordInfo] = []
    @State private var loaded = false
    @State private var loadFailed = false
    @State private var hasMore = false        // 服务端还有更早的通话（hasMore，此前被丢弃）
    @State private var loadingMore = false
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        List {
            if calls.isEmpty {
                Section {
                    if !loaded {
                        HStack { Spacer(); ProgressView(AccountStrings.loadingGeneric(lang)); Spacer() }.padding(.vertical, BeeSpacing.lg)
                    } else if loadFailed {
                        // 区分"真的没有记录"与"加载失败"——否则网络错误会被误读成"无通话记录"。
                        BeeEmptyState(systemImage: "wifi.exclamationmark", title: AccountStrings.restoreFailedTitle(lang),
                                      message: AccountStrings.callHistoryLoadFailed(lang))
                    } else {
                        BeeEmptyState(systemImage: "phone.badge.waveform.fill", title: AccountStrings.callHistoryEmptyTitle(lang),
                                      message: AccountStrings.callHistoryEmptyMessage(lang))
                    }
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(calls) { c in
                    // 对端仍在（peerId 非空）→ 整行点进与其的聊天（跟进/回访，同 web CallHistoryRow）；
                    // 已注销用户 peerId 为 nil → 普通不可点行，无死链。
                    if let pid = c.peerId {
                        NavigationLink {
                            ChatView(session: session, target: .direct(peerId: pid, name: c.peerName, avatar: c.peerAvatar))
                        } label: { row(c) }
                        .accessibilityLabel("\(c.peerName)，\(statusText(c))，\(timeText(c.createdAt))，\(AccountStrings.openChatHint(lang))")
                    } else {
                        row(c)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("\(c.peerName)，\(statusText(c))，\(timeText(c.createdAt))")
                    }
                }
                // 游标翻页（服务端 hasMore/before/beforeId，iter233 契约）：此前 iOS 只能看到头 100 条。
                if hasMore {
                    Button { Task { await loadMore() } } label: {
                        if loadingMore { HStack { Spacer(); ProgressView(); Spacer() } }
                        else { Text(AccountStrings.loadEarlierCalls(lang)).frame(maxWidth: .infinity) }
                    }
                    .disabled(loadingMore)
                }
            }
        }
        .navigationTitle(AccountStrings.callHistory(lang))
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let token = KeychainStore.read() else { loaded = true; return }
        do {
            let page = try await APIClient().callHistory(token: token)
            calls = page.calls
            hasMore = page.more
            loadFailed = false
        } catch {
            loadFailed = true
        }
        loaded = true
    }

    /// 加载更早一页：游标=当前最旧一条（APIClient.CallHistoryPage.nextCursor，已测）；按 id 去重防重叠。
    private func loadMore() async {
        guard let token = KeychainStore.read(), !loadingMore,
              let cursor = APIClient.CallHistoryPage.nextCursor(after: calls) else { return }
        loadingMore = true; defer { loadingMore = false }
        guard let page = try? await APIClient().callHistory(token: token, before: cursor.before, beforeId: cursor.beforeId) else {
            A11y.announce(AccountStrings.callHistoryLoadFailed(lang))
            return
        }
        let known = Set(calls.map(\.id))
        let fresh = page.calls.filter { !known.contains($0.id) }
        calls.append(contentsOf: fresh)
        hasMore = page.more
        A11y.announce(AccountStrings.loadedEarlierCalls(fresh.count, lang)) // 盲人对底部追加无感知，念结果
    }

    @ViewBuilder private func row(_ c: CallRecordInfo) -> some View {
        HStack(spacing: BeeSpacing.md) {
            AvatarView(dataURL: c.peerAvatar, name: c.peerName, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(c.peerName).foregroundStyle(c.isMissed ? Color.beeDanger : .primary)
                HStack(spacing: 6) {
                    Image(systemName: icon(c)).font(.caption2).foregroundStyle(tint(c))
                    Text(statusText(c)).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(timeText(c.createdAt)).font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func icon(_ c: CallRecordInfo) -> String {
        if c.isMissed { return "phone.down.fill" }
        return c.direction == "outgoing" ? "phone.arrow.up.right.fill" : "phone.arrow.down.left.fill"
    }
    private func tint(_ c: CallRecordInfo) -> Color {
        if c.status == "missed" || c.status == "declined" { return .beeDanger }
        return .beeSuccess
    }
    private func statusText(_ c: CallRecordInfo) -> String {
        AccountStrings.callStatus(direction: c.direction, status: c.status, lang)
    }
    private func timeText(_ ms: Double) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        let f = DateFormatter()
        f.locale = Locale(identifier: lang.localeIdentifier)
        f.setLocalizedDateFormatFromTemplate(Calendar.current.isDateInToday(date) ? "Hmm" : "MMddHmm")
        return f.string(from: date)
    }
}
