import SwiftUI

private struct RolePreview: Identifiable {
    let id = UUID().uuidString
    let role: String
}

/// 开发者主界面：以任一角色界面进入（测试）、后端连接、统计。
struct DeveloperHomeView: View {
    let session: AuthSession
    let onSwitchRole: () -> Void

    @State private var preview: RolePreview?
    @State private var statsText = "（点上方刷新）"
    @State private var api = APIClient()

    var body: some View {
        NavigationStack {
            List {
                Section("以角色界面进入（测试）") {
                    ForEach(["blind", "helper", "admin"], id: \.self) { r in // helper=合并后的协助端(含原 family 全部功能)
                        Button("以 \(roleDisplayName(r)) 界面进入") { preview = RolePreview(role: r) }
                    }
                    Text("从这里进入任一角色界面预览；下滑可关闭返回。").font(.footnote).foregroundStyle(.secondary)
                }

                Section("后端") {
                    LabeledContent("API", value: ServerConfig.baseURLString)
                    Button("刷新后端统计 /api/dev/stats") { Task { await loadStats() } }
                    Text(statsText).font(.system(.footnote, design: .monospaced)).foregroundStyle(.secondary)
                    Text("提示：自定义 API 地址在登录页（开发者模式下可见）。").font(.footnote).foregroundStyle(.secondary)
                }

                Section("避障调试") {
                    Text("开发者叠层（温度/帧率/ROI）在避障界面：从上方「以 求助者 界面进入」并在设置开启开发者模式。")
                        .font(.footnote).foregroundStyle(.secondary)
                }

                RoleAccountSection(session: session, onSwitchRole: onSwitchRole)
            }
            .navigationTitle("开发者")
        }
        .sheet(item: $preview) { p in
            RoleHomeView(role: p.role, session: session, onSwitchRole: { preview = nil })
        }
    }

    private func loadStats() async {
        guard let token = session.token else { statsText = "请先登录"; return }
        do {
            let stats = try await api.devStats(token: token)
            statsText = stats.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: "\n")
        } catch {
            statsText = "获取失败（需 developer 角色 + 后端）"
        }
    }
}
