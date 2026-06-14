import SwiftUI

/// 管理员主界面：用户管理（封禁/解封）、举报队列。接已建的后端 /api/admin。
struct AdminHomeView: View {
    let session: AuthSession
    let onSwitchRole: () -> Void

    @State private var users: [AccountInfo] = []
    @State private var reports: [ReportInfo] = []
    @State private var recConfig: RecordingConfig?
    @State private var activeCalls: [ActiveCallInfo] = []   // 进行中通话实时总览（5s 轮询）
    @State private var observingCallId: String?              // 正在旁观的通话（驱动全屏 CallView）
    @State private var forceEndTarget: String?               // 待确认强制结束的通话
    @State private var recordings: [RecordingInfo] = []      // 全站录制（含用户已软删除·留存中）
    @State private var recPlaying: PlayableVideo?            // 正在播放的录制
    @State private var recPlayError: String?
    @State private var recPurgeTarget: RecordingInfo?        // 待确认彻底删除的录制
    @State private var errorText: String?
    @State private var loading = false
    @State private var busyIds: Set<String> = []   // 在途的封禁/解封/处理目标，防重复点击竞态（见审查 #1）
    @State private var savingRec = false             // 录制配置写入中，防两个开关并发覆盖（见审查 #2）
    @State private var livePoll: Task<Void, Never>?  // 进行中通话轮询任务（界面可见时运行）

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
                    LabeledContent(lang == .zh ? "进行中通话" : "Live calls", value: "\(activeCalls.count)")
                }

                liveCallsSection

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

                adminRecordingsSection

                RoleAccountSection(session: session, onSwitchRole: onSwitchRole)
            }
            .navigationTitle(lang == .zh ? "管理员" : "Admin")
            .refreshable { await load() }
            .overlay { if loading && users.isEmpty { ProgressView() } }
            .task { await load() }
            .onAppear { startLivePolling() }
            .onDisappear { livePoll?.cancel(); livePoll = nil }
            .fullScreenCover(item: $recPlaying) { v in VideoPlayerSheet(url: v.url, lang: lang) }
            .alert(RecordingStrings.playFailed(lang), isPresented: Binding(get: { recPlayError != nil }, set: { if !$0 { recPlayError = nil } })) {
                Button(AccountStrings.ok(lang), role: .cancel) { recPlayError = nil }
            } message: { if let recPlayError { Text(recPlayError) } }
            .alert(lang == .zh ? "彻底删除这条录制？" : "Permanently delete this recording?",
                   isPresented: Binding(get: { recPurgeTarget != nil }, set: { if !$0 { recPurgeTarget = nil } })) {
                Button(lang == .zh ? "彻底删除" : "Delete permanently", role: .destructive) {
                    if let t = recPurgeTarget { Task { await purgeRecording(t) } }; recPurgeTarget = nil
                }
                Button(AccountStrings.cancel(lang), role: .cancel) { recPurgeTarget = nil }
            } message: { Text(lang == .zh ? "媒体文件将被永久删除，无法恢复。" : "The media file will be permanently removed and cannot be recovered.") }
            // 旁观某通话：全屏 CallView（合规：参与方会收到"管理员正在监看"横幅 + 语音）。
            .fullScreenCover(isPresented: Binding(get: { observingCallId != nil }, set: { if !$0 { observingCallId = nil } })) {
                if let cid = observingCallId {
                    CallView(role: .adminObserver, callId: cid) {
                        observingCallId = nil
                        Task { await refreshActiveCalls() }
                    }
                }
            }
            // 强制结束二次确认。
            .alert(lang == .zh ? "强制结束通话？" : "Force-end this call?",
                   isPresented: Binding(get: { forceEndTarget != nil }, set: { if !$0 { forceEndTarget = nil } })) {
                Button(lang == .zh ? "强制结束" : "Force-end", role: .destructive) {
                    if let cid = forceEndTarget { Task { await forceEnd(cid) } }
                    forceEndTarget = nil
                }
                Button(lang == .zh ? "取消" : "Cancel", role: .cancel) { forceEndTarget = nil }
            } message: {
                Text(lang == .zh ? "双方会立即收线。" : "Both parties will be disconnected immediately.")
            }
        }
    }

    // MARK: 进行中通话（实时总览 + 旁观 + 强制结束）

    @ViewBuilder private var liveCallsSection: some View {
        Section {
            if activeCalls.isEmpty {
                Text(lang == .zh ? "当前没有进行中的通话" : "No calls in progress").foregroundStyle(.secondary)
            } else {
                ForEach(activeCalls) { call in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(call.members.map { $0.name ?? $0.userId }.joined(separator: " · "))
                                .font(.subheadline.weight(.semibold))
                            Spacer()
                            Text(fmtDuration(call.durationSec))
                                .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        Text(call.members.map { roleDisplayName($0.role, lang) }.joined(separator: ", "))
                            .font(.caption).foregroundStyle(.secondary)
                        HStack(spacing: 12) {
                            if call.hasAdminObserver {
                                Label(lang == .zh ? "已有管理员监看" : "Being monitored", systemImage: "eye.fill")
                                    .font(.caption).foregroundStyle(Color.beeHoney)
                            } else {
                                Button { observingCallId = call.callId } label: {
                                    Label(lang == .zh ? "监看" : "Monitor", systemImage: "eye")
                                }
                                .buttonStyle(.bordered)
                            }
                            Button(role: .destructive) { forceEndTarget = call.callId } label: {
                                Label(lang == .zh ? "强制结束" : "Force-end", systemImage: "phone.down.fill")
                            }
                            .buttonStyle(.bordered)
                            .disabled(busyIds.contains(call.callId))
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        } header: {
            Text(lang == .zh ? "进行中的通话（\(activeCalls.count)）" : "Live calls (\(activeCalls.count))")
        } footer: {
            Text(lang == .zh ? "监看时双方会看到「管理员正在监看」提示并收到语音播报。" : "When monitoring, both parties see an ‘admin is monitoring’ notice and hear a voice announcement.")
        }
    }

    private func fmtDuration(_ s: Int) -> String {
        String(format: "%d:%02d", s / 60, s % 60)
    }

    // MARK: 全站录制（查看/播放/留存/彻底删除）

    @ViewBuilder private var adminRecordingsSection: some View {
        Section {
            if recordings.isEmpty {
                Text(lang == .zh ? "暂无录制" : "No recordings").foregroundStyle(.secondary)
            } else {
                ForEach(recordings) { rec in
                    RecordingRow(rec: rec, lang: lang, showOwner: true,
                                 onPlay: { Task { await playRecording(rec) } },
                                 busy: busyIds.contains(rec.id))
                        .swipeActions(edge: .trailing) {
                            Button(role: .destructive) { recPurgeTarget = rec } label: { Label(lang == .zh ? "彻底删除" : "Delete", systemImage: "trash") }
                        }
                }
            }
        } header: {
            Text(lang == .zh ? "通话录制（\(recordings.count)）" : "Call recordings (\(recordings.count))")
        } footer: {
            Text(lang == .zh ? "含用户已删除但仍在保留期内的录制（标注「用户已删除·留存中」）。" : "Includes recordings users deleted but still within the retention window (marked “User-deleted · retained”).")
        }
    }

    private func playRecording(_ rec: RecordingInfo) async {
        guard rec.hasMedia else { recPlayError = RecordingStrings.mediaGone(lang); return }
        guard let token = session.token, !busyIds.contains(rec.id) else { return }
        busyIds.insert(rec.id); defer { busyIds.remove(rec.id) }
        do {
            let url = try await api.downloadRecording(token: token, id: rec.id)
            recPlaying = PlayableVideo(id: rec.id, url: url)
        } catch {
            if !handleAuthError(error) { recPlayError = RecordingStrings.playFailed(lang) }
        }
    }

    private func purgeRecording(_ rec: RecordingInfo) async {
        guard let token = session.token, !busyIds.contains(rec.id) else { return }
        busyIds.insert(rec.id); defer { busyIds.remove(rec.id) }
        do {
            try await api.adminDeleteRecording(token: token, id: rec.id)
            recordings.removeAll { $0.id == rec.id }
        } catch {
            if !handleAuthError(error) { errorText = actionFailed }
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
            let calls = try? await api.adminActiveCalls(token: token)
            let recs = try? await api.adminRecordings(token: token)
            users = u; reports = r; recConfig = c
            if let calls { activeCalls = calls }
            if let recs { recordings = recs }
            errorText = nil
        } catch {
            if handleAuthError(error) { return }
            errorText = lang == .zh ? "加载失败（需管理员权限并连接后端）" : "Load failed (needs admin rights and a backend connection)" // 失败不动已有数据
        }
    }

    private var actionFailed: String { lang == .zh ? "操作失败" : "Action failed" }

    /// 仅刷新进行中通话（轻量，5s 轮询调用）——失败静默，不覆盖既有错误/数据。
    private func refreshActiveCalls() async {
        guard let token = session.token else { return }
        if let calls = try? await api.adminActiveCalls(token: token) { activeCalls = calls }
    }

    /// 进行中通话轮询：界面可见时每 5s 刷新一次，离开即停。
    private func startLivePolling() {
        livePoll?.cancel()
        livePoll = Task {
            while !Task.isCancelled {
                await refreshActiveCalls()
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    /// 强制结束某通话（双方收线）。
    private func forceEnd(_ callId: String) async {
        guard let token = session.token, !busyIds.contains(callId) else { return }
        busyIds.insert(callId); defer { busyIds.remove(callId) }
        do {
            try await api.adminEndCall(token: token, callId: callId)
            await refreshActiveCalls()
        } catch {
            if handleAuthError(error) { return }
            if case let APIError.server(msg) = error {
                errorText = msg == "not_active" ? (lang == .zh ? "该通话已结束" : "That call already ended") : actionFailed
            } else { errorText = actionFailed }
        }
    }

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
