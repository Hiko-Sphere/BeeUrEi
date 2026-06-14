import SwiftUI

/// 应用内通知中心：聚合"待我确认的好友/协助请求" + 持久化通知收件箱（如举报处理结果），
/// 给出未读角标与列表。收件箱是可靠来源（推送只是离线提醒，可能丢/未配置）。
@MainActor
@Observable
final class NotificationsCenter {
    static let shared = NotificationsCenter()
    private(set) var pendingRequests: [IncomingLinkInfo] = []
    private(set) var feed: [NotificationInfo] = []   // 站内通知收件箱（时间倒序）
    private(set) var feedUnread = 0
    var unreadCount: Int { pendingRequests.count + feedUnread }

    func refresh() async {
        guard let token = KeychainStore.read() else { pendingRequests = []; feed = []; feedUnread = 0; return }
        if let inc = try? await APIClient().incomingLinks(token: token) {
            pendingRequests = inc.filter { $0.isPending }
        }
        if let n = try? await APIClient().getNotifications(token: token) {
            feed = n.items; feedUnread = n.unread
        }
    }

    /// 把收件箱全部标记已读（打开通知列表即视为看过）——清角标。失败不影响 UI。
    func markFeedRead() async {
        guard feedUnread > 0, let token = KeychainStore.read() else { return }
        try? await APIClient().markAllNotificationsRead(token: token)
        feedUnread = 0
        feed = feed.map { var x = $0; if x.readAt == nil { x = NotificationInfo(id: x.id, userId: x.userId, kind: x.kind, title: x.title, body: x.body, data: x.data, createdAt: x.createdAt, readAt: Date().timeIntervalSince1970 * 1000) }; return x }
    }
}

/// 工具栏铃铛 + 未读角标，点开应用内通知列表。
struct NotificationsBell: View {
    @State private var center = NotificationsCenter.shared
    @State private var show = false

    var body: some View {
        Button { show = true } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "bell.fill")
                if center.unreadCount > 0 {
                    Text("\(center.unreadCount)")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        .padding(4).background(Color.beeDanger, in: Circle())
                        .offset(x: 8, y: -8)
                }
            }
        }
        .accessibilityLabel(HelperStrings.notifBellA11y(center.unreadCount, FeatureSettings().language))
        .sheet(isPresented: $show) { NotificationsView() }
        .task { await center.refresh() }
    }
}

/// 应用内通知列表：待确认的请求（接受/拒绝）。
struct NotificationsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var center = NotificationsCenter.shared
    @State private var busy: Set<String> = []
    /// 通知列表文案语言（E5）。
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            List {
                if center.pendingRequests.isEmpty && center.feed.isEmpty {
                    Section {
                        BeeEmptyState(systemImage: "bell.slash.fill", title: HelperStrings.noNotifTitle(lang),
                                      message: HelperStrings.noNotifMessage(lang))
                    }
                    .listRowBackground(Color.clear)
                }
                // 持久化通知收件箱（举报处理结果等）。
                if !center.feed.isEmpty {
                    Section(HelperStrings.updatesHeader(lang)) {
                        ForEach(center.feed) { n in
                            HStack(alignment: .top, spacing: BeeSpacing.sm) {
                                if n.isUnread {
                                    Circle().fill(Color.beeHoney).frame(width: 8, height: 8).padding(.top, 6)
                                        .accessibilityHidden(true)
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(n.title).font(.subheadline.weight(.semibold))
                                    Text(n.body).font(.footnote).foregroundStyle(.secondary)
                                    Text(RecordingStrings.timeText(n.createdAt, lang)).font(.caption2).foregroundStyle(.tertiary)
                                }
                            }
                            .padding(.vertical, 2)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("\(n.title). \(n.body)")
                        }
                    }
                }
                if !center.pendingRequests.isEmpty {
                    Section(HelperStrings.pendingHeader(lang)) {
                        ForEach(center.pendingRequests) { r in
                            VStack(alignment: .leading, spacing: BeeSpacing.sm) {
                                HStack {
                                    AvatarView(dataURL: r.ownerAvatar, name: r.ownerName, size: 36)
                                    Text(HelperStrings.wantsRelation(owner: r.ownerName, relation: r.relation, lang))
                                }
                                HStack {
                                    Button(HelperStrings.accept(lang)) { Task { await accept(r) } }
                                        .buttonStyle(.borderedProminent).disabled(busy.contains(r.id))
                                    Button(HelperStrings.reject(lang), role: .destructive) { Task { await reject(r) } }
                                        .buttonStyle(.bordered).disabled(busy.contains(r.id))
                                }
                            }
                            .padding(.vertical, 4)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel(HelperStrings.wantsRelation(owner: r.ownerName, relation: r.relation, lang))
                        }
                    }
                }
            }
            .navigationTitle(HelperStrings.notifTitle(lang))
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(HelperStrings.done(lang)) { dismiss() } } }
            .refreshable { await center.refresh() }
            .task { await center.refresh() }
            .onDisappear { Task { await center.markFeedRead() } } // 打开过即视为看过收件箱 → 清角标
        }
    }

    private func accept(_ r: IncomingLinkInfo) async {
        guard let token = KeychainStore.read(), !busy.contains(r.id) else { return }
        busy.insert(r.id); defer { busy.remove(r.id) }
        try? await APIClient().acceptFamilyLink(token: token, id: r.id)
        A11y.announce(HelperStrings.acceptedAnnounce(r.ownerName, lang))
        await center.refresh()
    }
    private func reject(_ r: IncomingLinkInfo) async {
        guard let token = KeychainStore.read(), !busy.contains(r.id) else { return }
        busy.insert(r.id); defer { busy.remove(r.id) }
        try? await APIClient().deleteFamilyLink(token: token, id: r.id)
        await center.refresh()
    }
}
