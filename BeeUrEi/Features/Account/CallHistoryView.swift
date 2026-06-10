import SwiftUI

/// 通话记录：呼出 / 呼入 / 未接 / 已拒绝。
struct CallHistoryView: View {
    @State private var calls: [CallRecordInfo] = []
    @State private var loaded = false

    var body: some View {
        List {
            if calls.isEmpty {
                Section {
                    if loaded {
                        BeeEmptyState(systemImage: "phone.badge.waveform.fill", title: "暂无通话记录",
                                      message: "呼出与呼入的通话都会记录在这里。")
                    } else {
                        HStack { Spacer(); ProgressView("加载中…"); Spacer() }.padding(.vertical, BeeSpacing.lg)
                    }
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(calls) { c in
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
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(c.peerName)，\(statusText(c))，\(timeText(c.createdAt))")
                }
            }
        }
        .navigationTitle("通话记录")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let token = KeychainStore.read() else { loaded = true; return }
        calls = (try? await APIClient().callHistory(token: token)) ?? []
        loaded = true
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
        switch c.status {
        case "answered": return c.direction == "outgoing" ? "已接通（呼出）" : "已接听（呼入）"
        case "declined": return c.direction == "outgoing" ? "对方已拒绝" : "已拒绝"
        default: return c.direction == "outgoing" ? "未接通（呼出）" : "未接来电"
        }
    }
    private func timeText(_ ms: Double) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateFormat = Calendar.current.isDateInToday(date) ? "HH:mm" : "MM-dd HH:mm"
        return f.string(from: date)
    }
}
