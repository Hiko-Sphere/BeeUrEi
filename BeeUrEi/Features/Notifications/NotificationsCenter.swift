import SwiftUI

/// 应用内通知中心：聚合"待我确认的好友/协助请求"，给出未读角标与列表。
@MainActor
@Observable
final class NotificationsCenter {
    static let shared = NotificationsCenter()
    private(set) var pendingRequests: [IncomingLinkInfo] = []
    var unreadCount: Int { pendingRequests.count }

    func refresh() async {
        guard let token = KeychainStore.read() else { pendingRequests = []; return }
        if let inc = try? await APIClient().incomingLinks(token: token) {
            pendingRequests = inc.filter { $0.isPending }
        }
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
        .accessibilityLabel(center.unreadCount > 0 ? "通知，\(center.unreadCount) 条待处理" : "通知")
        .sheet(isPresented: $show) { NotificationsView() }
        .task { await center.refresh() }
    }
}

/// 应用内通知列表：待确认的请求（接受/拒绝）。
struct NotificationsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var center = NotificationsCenter.shared
    @State private var busy: Set<String> = []

    var body: some View {
        NavigationStack {
            List {
                if center.pendingRequests.isEmpty {
                    Section { Text("暂无新通知").foregroundStyle(.secondary) }
                } else {
                    Section("待确认的请求") {
                        ForEach(center.pendingRequests) { r in
                            VStack(alignment: .leading, spacing: BeeSpacing.sm) {
                                HStack {
                                    AvatarView(dataURL: r.ownerAvatar, name: r.ownerName, size: 36)
                                    Text("\(r.ownerName) 想和你建立\(r.relation)关系")
                                }
                                HStack {
                                    Button("接受") { Task { await accept(r) } }
                                        .buttonStyle(.borderedProminent).disabled(busy.contains(r.id))
                                    Button("拒绝", role: .destructive) { Task { await reject(r) } }
                                        .buttonStyle(.bordered).disabled(busy.contains(r.id))
                                }
                            }
                            .padding(.vertical, 4)
                            .accessibilityElement(children: .combine)
                            .accessibilityLabel("\(r.ownerName) 想和你建立\(r.relation)关系")
                        }
                    }
                }
            }
            .navigationTitle("通知")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
            .refreshable { await center.refresh() }
            .task { await center.refresh() }
        }
    }

    private func accept(_ r: IncomingLinkInfo) async {
        guard let token = KeychainStore.read(), !busy.contains(r.id) else { return }
        busy.insert(r.id); defer { busy.remove(r.id) }
        try? await APIClient().acceptFamilyLink(token: token, id: r.id)
        A11y.announce("已接受 \(r.ownerName) 的请求")
        await center.refresh()
    }
    private func reject(_ r: IncomingLinkInfo) async {
        guard let token = KeychainStore.read(), !busy.contains(r.id) else { return }
        busy.insert(r.id); defer { busy.remove(r.id) }
        try? await APIClient().deleteFamilyLink(token: token, id: r.id)
        await center.refresh()
    }
}
