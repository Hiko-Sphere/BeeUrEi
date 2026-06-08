import SwiftUI

/// 管理员主界面：用户管理（封禁/解封）、举报队列。接已建的后端 /api/admin。
struct AdminHomeView: View {
    let session: AuthSession
    let onSwitchRole: () -> Void

    @State private var users: [AccountInfo] = []
    @State private var reports: [ReportInfo] = []
    @State private var recConfig: RecordingConfig?
    @State private var errorText: String?
    @State private var loading = false

    @State private var api = APIClient()

    private var bannedCount: Int { users.filter { $0.status != "active" }.count }
    private var openReports: Int { reports.filter { $0.status == "open" }.count }

    var body: some View {
        NavigationStack {
            List {
                if let errorText {
                    Section { Text(errorText).foregroundStyle(.red) }
                }

                Section("概览") {
                    LabeledContent("用户总数", value: "\(users.count)")
                    LabeledContent("已封禁", value: "\(bannedCount)")
                    LabeledContent("待处理举报", value: "\(openReports)")
                }

                Section("用户（\(users.count)）") {
                    ForEach(users) { u in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(u.displayName)
                                Text("\(roleDisplayName(u.role)) · \(u.status == "active" ? "正常" : "已封禁")")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if u.role != "admin" {
                                Button(u.status == "active" ? "封禁" : "解封") {
                                    Task { await setStatus(u, to: u.status == "active" ? "disabled" : "active") }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                    }
                }

                Section("举报（\(reports.count)）") {
                    if reports.isEmpty {
                        Text("暂无举报").foregroundStyle(.secondary)
                    } else {
                        ForEach(reports) { r in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(r.reason)
                                    Text("\(r.reporterName ?? "?") 举报 \(r.targetName ?? "?") · \(r.status == "open" ? "待处理" : "已处理")")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if r.status == "open" {
                                    Button("处理") { Task { await resolve(r) } }
                                        .buttonStyle(.bordered)
                                }
                            }
                        }
                    }
                }

                Section("录制策略") {
                    if let cfg = recConfig {
                        Toggle("允许录制", isOn: Binding(get: { cfg.enabled }, set: { v in Task { await setRec(enabled: v) } }))
                        Toggle("录制需各方同意", isOn: Binding(get: { cfg.requireConsent }, set: { v in Task { await setRec(consent: v) } }))
                        LabeledContent("保留天数", value: "\(cfg.retentionDays) 天")
                    } else {
                        Text("加载中…").foregroundStyle(.secondary)
                    }
                }

                RoleAccountSection(session: session, onSwitchRole: onSwitchRole)
            }
            .navigationTitle("管理员")
            .refreshable { await load() }
            .overlay { if loading && users.isEmpty { ProgressView() } }
            .task { await load() }
        }
    }

    private func load() async {
        guard let token = session.token else { errorText = "请先登录"; return }
        loading = true; defer { loading = false }
        do {
            users = try await api.adminUsers(token: token)
            reports = try await api.adminReports(token: token)
            recConfig = try? await api.recordingConfig(token: token)
            errorText = nil
        } catch {
            errorText = "加载失败（需管理员权限并连接后端）"
        }
    }

    private func setRec(enabled: Bool? = nil, consent: Bool? = nil) async {
        guard let token = session.token else { return }
        do { recConfig = try await api.setRecordingConfig(token: token, enabled: enabled, requireConsent: consent) }
        catch { errorText = "录制配置更新失败" }
    }

    private func setStatus(_ user: AccountInfo, to status: String) async {
        guard let token = session.token else { return }
        do {
            try await api.setUserStatus(token: token, userId: user.id, status: status)
            await load()
        } catch {
            errorText = "操作失败"
        }
    }

    private func resolve(_ report: ReportInfo) async {
        guard let token = session.token else { return }
        do {
            try await api.resolveReport(token: token, id: report.id)
            await load()
        } catch {
            errorText = "操作失败"
        }
    }
}
