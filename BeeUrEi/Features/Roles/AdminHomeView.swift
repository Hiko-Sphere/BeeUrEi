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
    @State private var busyIds: Set<String> = []   // 在途的封禁/解封/处理目标，防重复点击竞态（见审查 #1）
    @State private var savingRec = false             // 录制配置写入中，防两个开关并发覆盖（见审查 #2）

    @State private var api = APIClient()
    private var lang: Language { FeatureSettings().language }

    private var bannedCount: Int { users.filter { $0.status != "active" }.count }
    private var openReports: Int { reports.filter { $0.status == "open" }.count }

    var body: some View {
        NavigationStack {
            List {
                if let errorText {
                    Section { Text(errorText).foregroundStyle(Color.beeDanger) }
                }

                Section(lang == .zh ? "概览" : "Overview") {
                    LabeledContent(lang == .zh ? "用户总数" : "Total users", value: "\(users.count)")
                    LabeledContent(lang == .zh ? "已封禁" : "Banned", value: "\(bannedCount)")
                    LabeledContent(lang == .zh ? "待处理举报" : "Open reports", value: "\(openReports)")
                }

                Section((lang == .zh ? "用户（\(users.count)）" : "Users (\(users.count))")) {
                    ForEach(users) { u in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(u.displayName)
                                Text("\(roleDisplayName(u.role, lang)) · \(u.status == "active" ? (lang == .zh ? "正常" : "Active") : (lang == .zh ? "已封禁" : "Banned"))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if let myId = session.user?.id, u.id != myId {  // 不能操作自己；身份未知则不显示菜单(fail-closed，见复审 #9)
                                Menu {
                                    Button(u.status == "active" ? (lang == .zh ? "封禁" : "Ban") : (lang == .zh ? "解封" : "Unban")) {
                                        Task { await setStatus(u, to: u.status == "active" ? "disabled" : "active") }
                                    }
                                    Menu(lang == .zh ? "设为角色" : "Set role") {
                                        ForEach(["blind", "helper", "admin", "developer"], id: \.self) { r in
                                            Button(roleDisplayName(r, lang)) { Task { await setRole(u, to: r) } }
                                        }
                                    }
                                } label: {
                                    Image(systemName: "ellipsis.circle").font(.title3)
                                }
                                .disabled(busyIds.contains(u.id))
                                .accessibilityLabel((lang == .zh ? "管理 " : "Manage ") + u.displayName)
                            }
                        }
                    }
                }

                Section((lang == .zh ? "举报（\(reports.count)）" : "Reports (\(reports.count))")) {
                    if reports.isEmpty {
                        Text(lang == .zh ? "暂无举报" : "No reports").foregroundStyle(.secondary)
                    } else {
                        ForEach(reports) { r in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(r.reason)
                                    Text("\(r.reporterName ?? "?") \(lang == .zh ? "举报" : "reported") \(r.targetName ?? "?") · \(r.status == "open" ? (lang == .zh ? "待处理" : "Open") : (lang == .zh ? "已处理" : "Resolved"))")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if r.status == "open" {
                                    Button(lang == .zh ? "处理" : "Resolve") { Task { await resolve(r) } }
                                        .buttonStyle(.bordered)
                                        .disabled(busyIds.contains(r.id))
                                }
                            }
                        }
                    }
                }

                Section(lang == .zh ? "录制策略" : "Recording policy") {
                    if let cfg = recConfig {
                        Toggle(lang == .zh ? "允许录制" : "Allow recording", isOn: Binding(get: { cfg.enabled }, set: { v in Task { await setRec(enabled: v) } }))
                            .disabled(savingRec)
                        Toggle(lang == .zh ? "录制需各方同意" : "Require everyone's consent", isOn: Binding(get: { cfg.requireConsent }, set: { v in Task { await setRec(consent: v) } }))
                            .disabled(savingRec)
                        LabeledContent(lang == .zh ? "保留天数" : "Retention", value: lang == .zh ? "\(cfg.retentionDays) 天" : "\(cfg.retentionDays) days")
                    } else if loading {
                        Text(AccountStrings.loadingGeneric(lang)).foregroundStyle(.secondary)
                    } else {
                        // 加载完成仍为 nil = 录制配置拉取失败：给重试，不要永远卡"加载中…"。
                        Button(AccountStrings.retry(lang)) { Task { await load() } }
                    }
                }

                RoleAccountSection(session: session, onSwitchRole: onSwitchRole)
            }
            .navigationTitle(lang == .zh ? "管理员" : "Admin")
            .refreshable { await load() }
            .overlay { if loading && users.isEmpty { ProgressView() } }
            .task { await load() }
        }
    }

    /// access token 过期(401)统一处理：登出回登录页，而非把鉴权过期误报成业务/权限错误（见复审 #3）。
    /// 返回 true 表示已作为 401 处理，调用方不必再设业务错误文案。
    private func handleAuthError(_ error: Error) -> Bool {
        if case APIError.unauthorized = error { session.logout(); return true }
        return false
    }

    private func load() async {
        guard let token = session.token else { errorText = AccountStrings.loginFirstShort(lang); return }
        guard !loading else { return } // 防重入：.task 与 .refreshable 与操作后刷新可并发，避免重叠 load 竞态（见审查 #3）
        loading = true; defer { loading = false }
        do {
            // 全部成功后再一次性提交，避免部分失败时半新半旧的不一致数据（见审查 #3）。
            let u = try await api.adminUsers(token: token)
            let r = try await api.adminReports(token: token)
            let c = try? await api.recordingConfig(token: token)
            users = u; reports = r; recConfig = c
            errorText = nil
        } catch {
            if handleAuthError(error) { return }
            errorText = lang == .zh ? "加载失败（需管理员权限并连接后端）" : "Load failed (needs admin rights and a backend connection)" // 失败不动已有数据
        }
    }

    private var actionFailed: String { lang == .zh ? "操作失败" : "Action failed" }

    private func setRec(enabled: Bool? = nil, consent: Bool? = nil) async {
        guard let token = session.token, !savingRec else { return } // 串行化，防两个开关并发覆盖（见审查 #2）
        savingRec = true; defer { savingRec = false }
        do { recConfig = try await api.setRecordingConfig(token: token, enabled: enabled, requireConsent: consent) }
        catch { if !handleAuthError(error) { errorText = lang == .zh ? "录制配置更新失败" : "Couldn't update recording policy" } }
    }

    private func setStatus(_ user: AccountInfo, to status: String) async {
        guard let token = session.token, !busyIds.contains(user.id) else { return } // 防重复点击（见审查 #1）
        busyIds.insert(user.id); defer { busyIds.remove(user.id) }
        do {
            try await api.setUserStatus(token: token, userId: user.id, status: status)
            await load()
        } catch {
            if handleAuthError(error) { return }
            if case let APIError.server(msg) = error {
                errorText = msg == "last_admin_protected" ? (lang == .zh ? "不能封禁最后一名管理员" : "Can't ban the last admin") : actionFailed
            } else { errorText = actionFailed }
        }
    }

    private func setRole(_ user: AccountInfo, to role: String) async {
        guard let token = session.token, !busyIds.contains(user.id) else { return }
        busyIds.insert(user.id); defer { busyIds.remove(user.id) }
        do {
            try await api.setUserRole(token: token, userId: user.id, role: role)
            await load()
        } catch {
            if handleAuthError(error) { return }
            // 映射后端真实原因，而非用一个写死的串覆盖所有情况（见复审 #8）。
            if case let APIError.server(msg) = error {
                switch msg {
                case "last_admin_protected": errorText = lang == .zh ? "不能降级最后一名管理员" : "Can't demote the last admin"
                case "cannot_change_own_role": errorText = lang == .zh ? "不能修改自己的角色" : "Can't change your own role"
                case "not_found": errorText = lang == .zh ? "该用户已不存在" : "That user no longer exists"
                default: errorText = (lang == .zh ? "改角色失败：" : "Role change failed: ") + msg
                }
            } else { errorText = lang == .zh ? "改角色失败，请检查网络后重试" : "Role change failed — check your network and retry" }
        }
    }

    private func resolve(_ report: ReportInfo) async {
        guard let token = session.token, !busyIds.contains(report.id) else { return } // 防重复点击（见审查 #1）
        busyIds.insert(report.id); defer { busyIds.remove(report.id) }
        do {
            try await api.resolveReport(token: token, id: report.id)
            await load()
        } catch {
            if !handleAuthError(error) { errorText = actionFailed }
        }
    }
}
