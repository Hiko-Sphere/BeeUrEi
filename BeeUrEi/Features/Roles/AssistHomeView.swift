import SwiftUI

/// 协助端主界面（协助者 + 亲友**合并**）：三个标签页，同时具备两个角色的全部功能。
/// ①「帮助大家」公开求助队列 + 随机/偏好匹配（帮陌生人）
/// ②「我的亲人」绑定亲人收件箱 + 在线时自动弹出亲人来电
/// ③「我的」账号与安全、切换角色、退出
///
/// 复用既有后端：/api/assist/help/*（公开队列）、/api/assist/incoming（亲人来电会合）、
/// /api/assist/heartbeat（在线待命）。隐私门控通话沿用 CallView(role:.helper)。
struct AssistHomeView: View {
    let session: AuthSession
    let onSwitchRole: () -> Void

    @State private var online = true               // 在线待命：默认开（亲人紧急呼叫/被匹配可达）
    @State private var queue: [HelpRequestSummary] = []
    @State private var queueError = false
    @State private var pendingLinks: [IncomingLinkInfo] = []
    @State private var linkBusy: Set<String> = []
    @State private var answering: AnsweringCall?    // 正在接听/帮助（认领的陌生人 + 亲人来电统一走这里）
    @State private var matched: HelpRequestDetail?  // 随机匹配到、待确认是否帮助
    @State private var dismissedCallIds: Set<String> = []
    @State private var statusText: String?
    @State private var prefsShown = false
    @State private var busy = false

    @State private var hbTask: Task<Void, Never>?
    @State private var pollIncomingTask: Task<Void, Never>?
    @State private var pollQueueTask: Task<Void, Never>?

    @AppStorage("match.preferredLanguage") private var preferredLanguage = "" // "" = 不限
    @AppStorage("match.requireLanguage") private var requireLanguageMatch = false

    var body: some View {
        TabView {
            queueTab.tabItem { Label("帮助大家", systemImage: "hand.raised.fill") }
            familyTab.tabItem { Label("我的亲人", systemImage: "person.2.fill") }
            meTab.tabItem { Label("我的", systemImage: "person.crop.circle") }
        }
        .tint(.beeInk)
        .task { await onAppear() }
        .onDisappear { stopTasks(goOffline: true) }
        .sheet(item: $matched) { detail in matchedSheet(detail) }
        .fullScreenCover(item: $answering) { call in
            CallView(role: .helper, callId: call.callId) {
                if let token = session.token {
                    let id = call.callId
                    Task {
                        await APIClient().cancelCall(token: token, callId: id)   // 亲人来电会合清理
                        await APIClient().cancelHelp(token: token, callId: id)    // 公开求助放弃认领
                    }
                }
                if call.isIncoming { dismissedCallIds.insert(call.callId) }
                answering = nil
            }
        }
    }

    // MARK: 标签一：帮助大家（公开求助队列）

    private var queueTab: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: BeeSpacing.md) {
                    HStack {
                        BeeStatusPill(online: online)
                        Spacer()
                        Button { prefsShown = true } label: {
                            Label("匹配偏好", systemImage: "slider.horizontal.3")
                        }
                        .accessibilityHint("设置随机匹配时优先的语言")
                    }

                    Toggle("在线待命（接听求助与亲人来电）", isOn: $online)
                        .onChange(of: online) { _, v in setOnline(v) }
                        .font(.subheadline)

                    BeeBigButton("随机匹配一位需要帮助的人",
                                 systemImage: "shuffle",
                                 subtitle: prefsSubtitle,
                                 tint: .beeHoney) {
                        Task { await matchRandom() }
                    }
                    .disabled(busy)

                    if let statusText {
                        Text(statusText).font(.footnote).foregroundStyle(.secondary)
                    }

                    Text("待帮助队列").font(.headline).padding(.top, BeeSpacing.sm)

                    if queue.isEmpty {
                        BeeEmptyState(systemImage: queueError ? "wifi.exclamationmark" : "checkmark.circle",
                                      title: queueError ? "暂时无法加载" : "暂时没有人等待帮助",
                                      message: queueError ? "下拉重试，或检查网络。" : "有人发起求助时会出现在这里。下拉刷新。")
                    } else {
                        ForEach(queue) { req in queueCard(req) }
                    }
                }
                .padding()
            }
            .navigationTitle("帮助大家")
            .refreshable { await refreshQueue() }
        }
        .sheet(isPresented: $prefsShown) { prefsSheet }
    }

    private func queueCard(_ r: HelpRequestSummary) -> some View {
        Button { Task { await claim(r) } } label: {
            BeeCard {
                VStack(alignment: .leading, spacing: BeeSpacing.sm) {
                    HStack {
                        Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(.secondary)
                        Text(r.fromName).font(.headline)
                        Spacer()
                        Text(waitText(r.waitedSeconds)).font(.caption).foregroundStyle(.secondary)
                    }
                    if let topic = r.topic, !topic.isEmpty { BeeInfoRow(systemImage: "text.bubble", text: topic) }
                    if let loc = r.locality, !loc.isEmpty { BeeInfoRow(systemImage: "mappin.and.ellipse", text: loc) }
                    if let lang = r.language, !lang.isEmpty { BeeInfoRow(systemImage: "globe", text: languageName(lang)) }
                    HStack {
                        Spacer()
                        Label("帮助 TA", systemImage: "video.fill")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background(Color.beeSuccess, in: Capsule())
                            .foregroundStyle(.white)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("求助者 \(r.fromName)。\(r.topic ?? "")。\(r.locality.map { "地点 " + $0 + "。" } ?? "")\(r.language.map { "语言 " + languageName($0) + "。" } ?? "")已等待\(waitText(r.waitedSeconds))。")
        .accessibilityHint("双击接听并帮助 TA")
        .accessibilityAddTraits(.isButton)
    }

    private var prefsSubtitle: String {
        var parts: [String] = []
        parts.append(preferredLanguage.isEmpty ? "不限语言" : "偏好\(languageName(preferredLanguage))")
        if requireLanguageMatch && !preferredLanguage.isEmpty { parts.append("仅同语言") }
        return parts.joined(separator: " · ")
    }

    private var prefsSheet: some View {
        NavigationStack {
            Form {
                Section("优先语言") {
                    Picker("优先语言", selection: $preferredLanguage) {
                        Text("不限").tag("")
                        Text("中文").tag("zh")
                        Text("English").tag("en")
                    }
                    .pickerStyle(.inline)
                }
                Section {
                    Toggle("只匹配同语言的求助", isOn: $requireLanguageMatch)
                        .disabled(preferredLanguage.isEmpty)
                } footer: {
                    Text("开启后，随机匹配只会匹配与上面所选语言一致的求助；关闭则优先同语言、其次等待最久者。")
                }
            }
            .navigationTitle("匹配偏好")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { prefsShown = false } } }
        }
    }

    // MARK: 标签二：我的亲人

    private var familyTab: some View {
        NavigationStack {
            List {
                Section {
                    Toggle("在线待命（接听亲人紧急呼叫）", isOn: $online)
                        .onChange(of: online) { _, v in setOnline(v) }
                    Text(online ? "亲人发起紧急呼叫时会在此自动弹出来电。" : "已离线，不会接到亲人来电。")
                        .font(.footnote).foregroundStyle(.secondary)
                }

                if pendingLinks.contains(where: { $0.isPending }) {
                    Section("待你接受的绑定请求") {
                        ForEach(pendingLinks.filter { $0.isPending }) { l in
                            VStack(alignment: .leading, spacing: 10) {
                                Text("\(l.ownerName) 想把你加为\(l.relation)\(l.isEmergency ? "（紧急联系人）" : "")")
                                    .font(.subheadline)
                                HStack {
                                    Button("接受") { Task { await accept(l) } }
                                        .buttonStyle(.borderedProminent).disabled(linkBusy.contains(l.id))
                                    Button("拒绝", role: .destructive) { Task { await reject(l) } }
                                        .buttonStyle(.bordered).disabled(linkBusy.contains(l.id))
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }

                Section("绑定我的亲人") {
                    let accepted = pendingLinks.filter { !$0.isPending }
                    if accepted.isEmpty {
                        Text("还没有亲人绑定你。请让对方在 App 里按你的用户名添加你为亲友/协助者。")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(accepted) { l in
                            HStack {
                                Image(systemName: "person.crop.circle.fill").foregroundStyle(.secondary)
                                VStack(alignment: .leading) {
                                    Text(l.ownerName)
                                    Text("\(l.relation)\(l.isEmergency ? " · 紧急联系人" : "")")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("我的亲人")
            .refreshable { await loadLinks() }
        }
    }

    // MARK: 标签三：我的（账号）

    private var meTab: some View {
        NavigationStack {
            List {
                Section("账号") {
                    if let u = session.user {
                        LabeledContent("用户", value: u.displayName)
                        LabeledContent("角色", value: roleDisplayName(u.role))
                    }
                    NavigationLink("账号与安全") { LoginView() }
                    Button("切换角色") { onSwitchRole() }
                    Button("退出登录", role: .destructive) { session.logout() }
                }
                Section {
                    Text("「协助者」与「亲友」已合并：你既能在「帮助大家」里帮助陌生求助者，也能在「我的亲人」里接听绑定亲人的呼叫。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("我的")
        }
    }

    // MARK: 数据 / 轮询

    private func onAppear() async {
        await loadLinks()
        await refreshQueue()
        setOnline(online)            // 启动心跳 + 来电轮询（若在线）
        startQueuePolling()
    }

    private func loadAll() async { await loadLinks(); await refreshQueue() }

    private func loadLinks() async {
        guard let token = session.token else { return }
        if let links = try? await APIClient().incomingLinks(token: token) { pendingLinks = links }
    }

    private func refreshQueue() async {
        guard let token = session.token else { return }
        do { queue = try await APIClient().helpQueue(token: token); queueError = false }
        catch { queueError = true }
    }

    /// 在线开关：开 → 周期心跳(20s) + 轮询亲人来电(3s)；关 → 下线。
    private func setOnline(_ on: Bool) {
        hbTask?.cancel(); hbTask = nil
        pollIncomingTask?.cancel(); pollIncomingTask = nil
        guard let token = session.token else { return }
        if on {
            hbTask = Task {
                while !Task.isCancelled {
                    await APIClient().assistHeartbeat(token: token, available: true)
                    try? await Task.sleep(for: .seconds(20))
                }
            }
            pollIncomingTask = Task { await pollIncoming(token: token) }
        } else {
            Task { await APIClient().assistHeartbeat(token: token, available: false) }
        }
    }

    private func startQueuePolling() {
        pollQueueTask?.cancel()
        pollQueueTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                if answering == nil { await refreshQueue() }
            }
        }
    }

    /// 轮询亲人来电；仅当无通话呈现且该来电未被挂断过时弹出（见原 HelperHomeView 审查 #5/#9）。
    private func pollIncoming(token: String) async {
        while !Task.isCancelled {
            if answering == nil,
               let calls = try? await APIClient().incomingCalls(token: token),
               let first = calls.first(where: { !dismissedCallIds.contains($0.callId) }) {
                answering = AnsweringCall(callId: first.callId, title: "\(first.fromName) 的来电", isIncoming: true)
            }
            try? await Task.sleep(for: .seconds(3))
        }
    }

    private func stopTasks(goOffline: Bool) {
        hbTask?.cancel(); hbTask = nil
        pollIncomingTask?.cancel(); pollIncomingTask = nil
        pollQueueTask?.cancel(); pollQueueTask = nil
        if goOffline, online, let token = session.token {
            Task { await APIClient().assistHeartbeat(token: token, available: false) }
        }
    }

    // MARK: 动作

    private func claim(_ r: HelpRequestSummary) async {
        guard !busy, answering == nil, let token = session.token else { return }
        busy = true; defer { busy = false }
        do {
            let detail = try await APIClient().claimHelp(token: token, callId: r.callId)
            answering = AnsweringCall(callId: detail.callId, title: "正在帮助 \(detail.fromName)", isIncoming: false)
        } catch {
            statusText = "手慢了，这条求助已被其他志愿者接走。"
            await refreshQueue()
        }
    }

    private func matchRandom() async {
        guard !busy, answering == nil, matched == nil, let token = session.token else { return }
        busy = true; statusText = "正在为你匹配…"; defer { busy = false }
        do {
            let lang = preferredLanguage.isEmpty ? nil : preferredLanguage
            if let detail = try await APIClient().matchHelp(token: token, preferredLanguage: lang, requireLanguageMatch: requireLanguageMatch) {
                statusText = nil
                matched = detail // 先展示详情，由协助者决定是否帮助（匹配已原子认领，跳过会释放回队列）
            } else {
                statusText = requireLanguageMatch ? "暂时没有符合所选语言的求助。" : "暂时没有等待帮助的人。"
            }
        } catch {
            statusText = "匹配失败，请稍后再试。"
        }
    }

    /// 匹配到一位求助者后的确认卡：显示详情，选择「帮助 TA」或「跳过」（跳过释放回队列）。
    private func matchedSheet(_ detail: HelpRequestDetail) -> some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: BeeSpacing.md) {
                Text("为你匹配到一位需要帮助的人").font(.headline)
                BeeCard {
                    VStack(alignment: .leading, spacing: BeeSpacing.sm) {
                        HStack {
                            Image(systemName: "person.crop.circle.fill").font(.largeTitle).foregroundStyle(.secondary)
                            Text(detail.fromName).font(.title2.weight(.bold))
                        }
                        if let t = detail.topic, !t.isEmpty { BeeInfoRow(systemImage: "text.bubble", text: t) }
                        if let l = detail.locality, !l.isEmpty { BeeInfoRow(systemImage: "mappin.and.ellipse", text: l) }
                        if let lang = detail.language, !lang.isEmpty { BeeInfoRow(systemImage: "globe", text: languageName(lang)) }
                    }
                }
                BeeBigButton("帮助 TA", systemImage: "video.fill", tint: .beeSuccess, foreground: .white) {
                    let callId = detail.callId, name = detail.fromName
                    matched = nil
                    answering = AnsweringCall(callId: callId, title: "正在帮助 \(name)", isIncoming: false)
                }
                Button("跳过这一位", role: .cancel) {
                    let callId = detail.callId
                    matched = nil
                    if let token = session.token {
                        Task { await APIClient().cancelHelp(token: token, callId: callId); await refreshQueue() } // 释放回队列
                    }
                }
                .frame(maxWidth: .infinity)
                Spacer()
            }
            .padding()
            .navigationTitle("匹配结果")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium, .large])
    }

    private func accept(_ l: IncomingLinkInfo) async {
        guard let token = session.token, !linkBusy.contains(l.id) else { return }
        linkBusy.insert(l.id); defer { linkBusy.remove(l.id) }
        try? await APIClient().acceptFamilyLink(token: token, id: l.id)
        await loadLinks()
    }

    private func reject(_ l: IncomingLinkInfo) async {
        guard let token = session.token, !linkBusy.contains(l.id) else { return }
        linkBusy.insert(l.id); defer { linkBusy.remove(l.id) }
        try? await APIClient().deleteFamilyLink(token: token, id: l.id)
        await loadLinks()
    }

    // MARK: 工具

    private func waitText(_ seconds: Int) -> String {
        if seconds < 10 { return "刚刚" }
        if seconds < 60 { return "\(seconds) 秒" }
        return "\(seconds / 60) 分钟"
    }

    private func languageName(_ code: String) -> String {
        switch code {
        case "zh": return "中文"
        case "en": return "English"
        default: return code
        }
    }
}

/// 协助者正在接听/帮助的一通通话（统一承载：认领的陌生人 + 亲人来电）。
struct AnsweringCall: Identifiable {
    let id = UUID()
    let callId: String
    let title: String
    let isIncoming: Bool   // true=亲人来电会合（结束需登记到 dismissedCallIds 防反复弹出）
}
