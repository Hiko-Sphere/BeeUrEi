import SwiftUI
import AudioToolbox // 新求助进队短提示音（系统短音，不占语音总线/来电铃）

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

    @State private var queue: [HelpRequestSummary] = []
    @State private var queueError = false
    @State private var alertedQueueIds: Set<String> = [] // 已声音提示过的求助 id（HelpQueueArrivals.diff 维护）
    @State private var queueGeneration = 0               // refreshQueue 代际号：丢弃多入口并发的陈旧响应（复审#4）
    @State private var pendingLinks: [IncomingLinkInfo] = []   // 待我确认的请求
    @State private var myLinks: [FamilyLinkInfo] = []           // 我的关系（已建立 + 我发出的待确认）
    @State private var linkBusy: Set<String> = []
    @State private var showAddFamily = false
    @State private var newFamilyUsername = ""
    @State private var addFamilyMsg: String?
    @State private var incomingCenter = IncomingCallCenter.shared // 监听来电以关闭冲突模态
    @State private var answering: AnsweringCall?    // 正在接听/帮助（认领的陌生人 + 亲人来电统一走这里）
    @State private var matched: HelpRequestDetail?  // 随机匹配到、待确认是否帮助
    @State private var pendingAnswer: AnsweringCall? // 「帮助 TA」选定、待 matched sheet 关闭后再呈现通话（避免同一 tick 切换两个模态，见审查 #3）
    @State private var dismissedCallIds: Set<String> = []
    @State private var statusText: String?
    @State private var prefsShown = false
    // 协助守则一次性确认卡（Aira 范式）：首次接单（认领/随机匹配）前展示；确认经服务端留痕。
    @State private var guidelineShown = false
    @State private var afterGuideline: (() -> Void)?
    @State private var busy = false
    @State private var showLogoutConfirm = false
    @Environment(\.scenePhase) private var scenePhase

    @State private var hbTask: Task<Void, Never>?
    @State private var pollIncomingTask: Task<Void, Never>?
    @State private var pollQueueTask: Task<Void, Never>?

    @AppStorage("match.preferredLanguage") private var preferredLanguage = "" // "" = 不限
    @AppStorage("match.requireLanguage") private var requireLanguageMatch = false

    /// 协助端文案语言（E5）：协助者也可能是英文用户（海外亲友）。
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        TabView {
            queueTab.tabItem { Label(HelperStrings.tabQueue(lang), systemImage: "hand.raised.fill") }
                .badge(queue.count) // 视觉兜底（复审#12）：明眼且未开 VoiceOver 的志愿者停在别的标签页时，队列数徽标提示有人在等
            familyTab.tabItem { Label(HelperStrings.tabFamily(lang), systemImage: "person.2.fill") }
            ConversationsView(session: session)
                .tabItem { Label(ChatStrings.navTitle(lang), systemImage: "bubble.left.and.bubble.right.fill") }
            meTab.tabItem { Label(HelperStrings.tabMe(lang), systemImage: "person.crop.circle") }
        }
        .tint(.beeAccent)
        .task { await onAppear() }
        // 匹配/认领状态变化主动朗读——盲人/低视力协助者点完按钮才有语音反馈（见无障碍审计）。
        .onChange(of: statusText) { _, new in if let new, !new.isEmpty { A11y.announce(new) } }
        // 来电(铃响或已接入)时，关掉本页可能占用的模态(匹配卡/偏好/添加/守则卡)，否则根层来电界面会被吞（见来电链路深审 #3）。
        // 守则卡必须一并关闭：否则它占着 sheet 使来电被吞，而来电 callId 已被 pollIncoming 标记 dismissed → 永不再弹（复审 HIGH）。
        .onChange(of: incomingCenter.hasIncoming) { _, inCall in
            if inCall { matched = nil; prefsShown = false; showAddFamily = false; afterGuideline = nil; guidelineShown = false }
        }
        .onDisappear { stopTasks(goOffline: true) }
        // 打开 App 即在线（无手动待命开关）：回到前台立即恢复心跳；退后台停发心跳，
        // 服务端 45s TTL 自然过期离线——短暂切走（看通知）无感，不会闪断。
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { goOnline() } else if phase == .background { pauseHeartbeat() }
        }
        .sheet(item: $matched, onDismiss: {
            // sheet 真正关闭后再呈现通话，避免同一 tick「关 sheet + 开 fullScreenCover」被吞（见审查 #3）。
            if let p = pendingAnswer { pendingAnswer = nil; answering = p }
        }) { detail in matchedSheet(detail) }
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
                    NetworkStatusBar() // 当前网络类型（WiFi/移动数据/有线链接）

                    // 状态卡：打开 App 即在线（无手动待命开关）+ 匹配偏好。
                    BeeCard {
                        HStack {
                            BeeStatusPill(text: HelperStrings.onlineNow(lang))
                                .accessibilityLabel(HelperStrings.onlinePillA11y(lang))
                            Spacer()
                            Button { prefsShown = true } label: {
                                Label(HelperStrings.matchPrefs(lang), systemImage: "slider.horizontal.3").font(.subheadline)
                            }
                            .accessibilityHint(HelperStrings.matchPrefsHint(lang))
                        }
                    }

                    BeeBigButton(HelperStrings.matchRandom(lang),
                                 systemImage: "shuffle",
                                 subtitle: prefsSubtitle,
                                 tint: .beeHoney) {
                        Task { await matchRandom() }
                    }
                    .opacity(session.features.helpRequests ? 1 : 0.5)
                    .disabled(busy || !session.features.helpRequests)
                    .accessibilityHint(session.features.helpRequests ? "" : HomeStrings.featureOff(lang))

                    if let statusText {
                        Text(statusText).font(.footnote).foregroundStyle(.secondary)
                    }

                    BeeSectionHeader(HelperStrings.queueHeader(lang), systemImage: "person.2.wave.2.fill").padding(.top, BeeSpacing.sm)

                    if queue.isEmpty {
                        BeeEmptyState(systemImage: queueError ? "wifi.exclamationmark" : "checkmark.circle",
                                      title: queueError ? HelperStrings.queueLoadFailedTitle(lang) : HelperStrings.queueEmptyTitle(lang),
                                      message: queueError ? HelperStrings.queueLoadFailedMessage(lang) : HelperStrings.queueEmptyMessage(lang))
                    } else {
                        ForEach(queue) { req in queueCard(req) }
                    }
                }
                .padding()
            }
            .navigationTitle(HelperStrings.tabQueue(lang))
            .toolbar { ToolbarItem(placement: .primaryAction) { NotificationsBell() } }
            .refreshable { await refreshQueue() }
        }
        .sheet(isPresented: $prefsShown) { prefsSheet }
        .sheet(isPresented: $guidelineShown, onDismiss: {
            let go = afterGuideline; afterGuideline = nil
            // 只有真的确认过（内存态已标记）才续跑原动作；滑掉/暂不=放弃本次，下次接单再问。
            if session.user?.helperGuidelineAckAt != nil { go?() }
        }) { guidelineSheet }
    }

    private func queueCard(_ r: HelpRequestSummary) -> some View {
        // 求助者语言与本协助者界面语言一致 → 语言行追加"你的语言"（视觉+VoiceOver 都标出，帮志愿者认出能沟通的对象）。
        let langMatch = (r.language?.lowercased() == lang.rawValue)
        let langLabel = r.language.flatMap { $0.isEmpty ? nil : languageName($0) + (langMatch ? " · " + HelperStrings.yourLanguage(lang) : "") }
        return Button { Task { await claim(r) } } label: {
            BeeCard {
                VStack(alignment: .leading, spacing: BeeSpacing.sm) {
                    HStack {
                        AvatarView(dataURL: r.fromAvatar, name: r.fromName, size: 36)
                        Text(r.fromName).font(.headline)
                        Spacer()
                        Text(waitText(r.waitedSeconds)).font(.caption).foregroundStyle(.secondary)
                    }
                    if let topic = r.topic, !topic.isEmpty { BeeInfoRow(systemImage: "text.bubble", text: topic) }
                    if let loc = r.locality, !loc.isEmpty { BeeInfoRow(systemImage: "mappin.and.ellipse", text: loc) }
                    if let langLabel { BeeInfoRow(systemImage: "globe", text: langLabel) }
                    HStack {
                        Spacer()
                        Label(HelperStrings.helpThem(lang), systemImage: "video.fill")
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
        .accessibilityLabel(HelperStrings.queueCardA11y(name: r.fromName, topic: r.topic, locality: r.locality,
                                                       languageName: langLabel,
                                                       waited: waitText(r.waitedSeconds), lang))
        .accessibilityHint(HelperStrings.queueCardHint(lang))
        .accessibilityAddTraits(.isButton)
    }

    private var prefsSubtitle: String {
        var parts: [String] = []
        parts.append(preferredLanguage.isEmpty ? HelperStrings.anyLanguage(lang)
                                               : HelperStrings.prefer(languageName(preferredLanguage), lang))
        if requireLanguageMatch && !preferredLanguage.isEmpty { parts.append(HelperStrings.sameLanguageOnly(lang)) }
        return parts.joined(separator: " · ")
    }

    /// 协助守则一次性确认卡（Aira 范式）：三条守则 + 确认（服务端留痕）。
    /// 确认后先标记内存态再收卡——onDismiss 据此续跑被闸下的接单动作。
    private var guidelineSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: BeeSpacing.lg) {
                Text(HelperStrings.guidelineTitle(lang)).font(.title3.weight(.semibold))
                ForEach([HelperStrings.guidelineRule1(lang), HelperStrings.guidelineRule2(lang), HelperStrings.guidelineRule3(lang)], id: \.self) { rule in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.beeHoney).padding(.top, 2)
                            .accessibilityHidden(true)
                        Text(rule).font(.subheadline)
                    }
                }
                Spacer()
                BeeBigButton(HelperStrings.guidelineConfirm(lang), systemImage: "hand.raised.fill", tint: .beeHoney) {
                    confirmGuideline()
                }
                Button(HelperStrings.guidelineLater(lang)) { afterGuideline = nil; guidelineShown = false }
                    .frame(maxWidth: .infinity).font(.subheadline).foregroundStyle(.secondary)
            }
            .padding()
        }
        .presentationDetents([.medium, .large])
    }

    /// 确认守则：**先同步标记内存态**再收卡——若先 await 留痕，用户在网络在途时下滑关卡会让 onDismiss
    /// 读到未标记态而丢弃续跑动作（复审 LOW）。留痕在后台进行，失败不阻塞（下次会话仍会展示，keep-first 幂等）。
    private func confirmGuideline() {
        session.markGuidelineAcked()
        guidelineShown = false
        if let token = session.token {
            Task { try? await APIClient().ackHelperGuideline(token: token) }
        }
    }

    private var prefsSheet: some View {
        NavigationStack {
            Form {
                Section(HelperStrings.preferredLanguageHeader(lang)) {
                    Picker(HelperStrings.preferredLanguageHeader(lang), selection: $preferredLanguage) {
                        Text(HelperStrings.anyOption(lang)).tag("")
                        Text("中文").tag("zh")
                        Text("English").tag("en")
                    }
                    .pickerStyle(.inline)
                }
                Section {
                    Toggle(HelperStrings.requireSameLanguage(lang), isOn: $requireLanguageMatch)
                        .disabled(preferredLanguage.isEmpty)
                } footer: {
                    Text(HelperStrings.requireSameLanguageFooter(lang))
                }
            }
            .navigationTitle(HelperStrings.matchPrefs(lang))
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(HelperStrings.done(lang)) { prefsShown = false } } }
        }
    }

    // MARK: 标签二：我的亲人

    private var familyTab: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        BeeStatusPill(text: HelperStrings.onlineNow(lang))
                        Spacer()
                    }
                    Text(HelperStrings.alwaysOnlineFooter(lang))
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(HelperStrings.alwaysOnlineFooter(lang))

                if session.features.locationSharing {
                    Section {
                        NavigationLink {
                            LiveLocationView(isBlind: false)
                        } label: {
                            Label {
                                VStack(alignment: .leading) {
                                    Text(LiveLocationStrings.entryTitle(lang))
                                    Text(LiveLocationStrings.entrySubtitle(lang)).font(.caption).foregroundStyle(.secondary)
                                }
                            } icon: { Image(systemName: "location.fill.viewfinder").foregroundStyle(Color.beeHoney) }
                        }
                    }
                }

                if pendingLinks.contains(where: { $0.isPending }) {
                    Section(HelperStrings.pendingHeader(lang)) {
                        ForEach(pendingLinks.filter { $0.isPending }) { l in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(HelperStrings.wantsToLink(owner: l.ownerName, relation: l.relation,
                                                               emergency: l.isEmergency, lang))
                                    .font(.subheadline)
                                HStack {
                                    Button(HelperStrings.accept(lang)) { Task { await accept(l) } }
                                        .buttonStyle(.borderedProminent).disabled(linkBusy.contains(l.id))
                                    Button(HelperStrings.reject(lang), role: .destructive) { Task { await reject(l) } }
                                        .buttonStyle(.bordered).disabled(linkBusy.contains(l.id))
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }

                let outgoing = myLinks.filter { $0.outgoing == true }
                if !outgoing.isEmpty {
                    Section(HelperStrings.outgoingHeader(lang)) {
                        ForEach(outgoing) { l in
                            HStack {
                                Text(l.memberName)
                                Spacer()
                                Text(HelperStrings.pendingBadge(lang)).font(.caption).foregroundStyle(Color.beeWarn)
                                Button(HelperStrings.withdraw(lang), role: .destructive) { Task { await cancelOutgoing(l) } }
                                    .buttonStyle(.bordered)
                                    .disabled(linkBusy.contains(l.id))
                                    .accessibilityLabel(HelperStrings.withdrawA11y(l.memberName, lang))
                            }
                        }
                    }
                }

                Section(HelperStrings.familyHeader(lang)) {
                    let accepted = myLinks.filter { $0.isAccepted }
                    if accepted.isEmpty {
                        Text(HelperStrings.noRelationsYet(lang))
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(accepted) { l in
                            HStack {
                                AvatarView(dataURL: l.memberAvatar, name: l.memberName, size: 36)
                                VStack(alignment: .leading) {
                                    Text(l.memberName)
                                    Text(l.relation + (l.isEmergency ? HelperStrings.emergencySuffix(lang) : ""))
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Button { Task { await callBound(l) } } label: {
                                    Image(systemName: "phone.fill").foregroundStyle(Color.beeSuccess)
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel(HelperStrings.callA11y(l.memberName, lang))
                            }
                        }
                    }
                }

                if let addFamilyMsg { Section { Text(addFamilyMsg).foregroundStyle(.secondary) } }
            }
            .navigationTitle(HelperStrings.familyNavTitle(lang))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { showAddFamily = true } label: { Image(systemName: "plus") }
                        .accessibilityLabel(HelperStrings.addFamilyA11y(lang))
                }
            }
            .alert(HelperStrings.addFamilyTitle(lang), isPresented: $showAddFamily) {
                TextField(HelperStrings.usernamePlaceholder(lang), text: $newFamilyUsername)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                Button(HelperStrings.sendRequest(lang)) { Task { await addFamily() } }
                Button(HelperStrings.cancel(lang), role: .cancel) { newFamilyUsername = "" }
            } message: {
                Text(HelperStrings.addFamilyMessage(lang))
            }
            .refreshable { await loadLinks() }
            .onChange(of: addFamilyMsg) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
        }
    }

    /// 协助者/亲友主动呼叫已绑定的对方（多为呼叫盲人）。后端双向放行。
    private func callBound(_ l: FamilyLinkInfo) async {
        guard answering == nil, matched == nil, pendingAnswer == nil,
              !IncomingCallCenter.shared.hasIncoming, let token = session.token else { return }
        // 主动呼叫也是"实地协助"的一种，与认领/匹配同门控：首次须过协助守则闸门（与 web 呼出路径一致）。
        if session.user?.helperGuidelineAckAt == nil {
            afterGuideline = { Task { await callBound(l) } }
            guidelineShown = true
            return
        }
        let callId = UUID().uuidString
        do {
            try await APIClient().startEmergencyCall(token: token, callId: callId, targetUserIds: [l.memberId])
            answering = AnsweringCall(callId: callId, title: HelperStrings.callingTitle(l.memberName, lang), isIncoming: false)
        } catch let APIError.server(msg) {
            addFamilyMsg = msg == "not_linked" ? HelperStrings.notLinkedYet(lang) : HelperStrings.callFailed(lang)
        } catch { addFamilyMsg = HelperStrings.callFailed(lang) }
    }

    private func addFamily() async {
        let u = newFamilyUsername.trimmingCharacters(in: .whitespacesAndNewlines); newFamilyUsername = ""
        guard !u.isEmpty, let token = session.token else { return }
        do {
            // 用户名 / 邮箱 / 手机号均可：先精确查人，再发起请求。
            let target = try await APIClient().lookupUser(token: token, query: u)
            try await APIClient().addFamilyLink(token: token, userId: target.id)
            addFamilyMsg = HelperStrings.requestSentTo(target.displayName, lang)
            await loadLinks()
        } catch let APIError.server(msg) {
            addFamilyMsg = msg == "member_not_found" ? HelperStrings.memberNotFound(lang)
                : (msg == "already_linked" ? HelperStrings.alreadyLinked(lang)
                   : (msg == "blocked" ? HelperStrings.blockedRelation(lang) : HelperStrings.sendFailed(lang)))
        } catch { addFamilyMsg = HelperStrings.sendFailedRetry(lang) }
    }

    // MARK: 标签三：我的（账号）

    private var meTab: some View {
        NavigationStack {
            List {
                Section(HelperStrings.accountHeader(lang)) {
                    if let u = session.user {
                        HStack(spacing: BeeSpacing.md) {
                            AvatarView(dataURL: u.avatar, name: u.displayName, size: 52)
                            VStack(alignment: .leading) {
                                Text(u.displayName).font(.headline)
                                Text("@\(u.username) · \(AccountStrings.roleName(u.role, lang))")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .combine)
                    }
                    // 统一设置页（账号与安全、语言与外观、匹配偏好、法律与帮助都在内）。
                    NavigationLink {
                        HelperSettingsView(session: session)
                    } label: {
                        Label(HelperStrings.settingsTitle(lang), systemImage: "gearshape")
                    }
                    Button(HelperStrings.switchRole(lang)) { onSwitchRole() }
                    Button(HelperStrings.logout(lang), role: .destructive) { showLogoutConfirm = true }
                }
            }
            .navigationTitle(HelperStrings.meNavTitle(lang))
            // 退出登录是破坏性操作（误触即掉线）——先确认（与各账号入口一致，见审计 P1）。
            .confirmationDialog(AccountStrings.logout(lang), isPresented: $showLogoutConfirm, titleVisibility: .visible) {
                Button(AccountStrings.logoutConfirmAction(lang), role: .destructive) { session.logout() }
                Button(AccountStrings.cancel(lang), role: .cancel) {}
            } message: {
                Text(AccountStrings.logoutConfirmMessage(lang))
            }
        }
    }

    // MARK: 数据 / 轮询

    private func onAppear() async {
        await loadLinks()
        await refreshQueue()
        goOnline()                   // 打开 App 即在线：启动心跳 + 来电轮询
        startQueuePolling()
    }

    private func loadLinks() async {
        guard let token = session.token else { return }
        if let inc = try? await APIClient().incomingLinks(token: token) { pendingLinks = inc }   // 待我确认
        if let mine = try? await APIClient().familyLinks(token: token) { myLinks = mine }         // 我的关系
    }

    private func refreshQueue() async {
        guard let token = session.token else { return }
        queueGeneration += 1
        let gen = queueGeneration
        do {
            let q = try await APIClient().helpQueue(token: token)
            // 陈旧响应丢弃：多入口（5s 轮询 / 下拉刷新 / claim 失败 / cancelHelp）可并发，慢响应恢复后
            // 绝不能覆盖新会话的 queue 与 alertedQueueIds（复审#4：否则队列回退闪烁 + 对同一求助重复提示）。
            guard gen == queueGeneration else { return }
            // **通话中只更新列表、不动 alertedQueueIds、不出声**（复审#3）：否则在途请求恢复时新求助被标记已提示，
            // 通话结束后该求助永不再声音提示——公开求助又无推送兜底，正是本功能要解决的场景失效。
            if answering == nil {
                let (fresh, next) = HelpQueueArrivals.diff(current: q.map(\.callId), alerted: alertedQueueIds)
                alertedQueueIds = next
                if !fresh.isEmpty { notifyNewHelpInQueue(count: fresh.count) }
            }
            queue = q; queueError = false
        }
        catch { guard gen == queueGeneration else { return }; queueError = true }
    }

    /// 新求助进队的多感知层提示（复审#12：单一系统音会被静音开关吞、A11y.announce 在 VO 关时静默）：
    /// ①系统提示音（有声时）②震动（静音开关下仍能察觉）③VoiceOver 公告（盲人志愿者）。
    /// 视觉兜底=队列标签徽标（.badge(queue.count)，明眼且未开 VO 者停在别的标签页也看得到）。
    private func notifyNewHelpInQueue(count: Int) {
        AudioServicesPlaySystemSound(1007)                        // 系统"收到消息"三连音（区别于来电铃/紧急）
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)      // 触觉：静音开关吞掉系统音时仍震动提醒
        A11y.announce(AssistStrings.newHelpInQueue(count, lang))  // VoiceOver 用户
    }

    /// 打开 App 即在线：周期心跳(20s，立即先发一次) + 轮询亲人来电(3s)。可重复调用（先撤旧任务）。
    private func goOnline() {
        hbTask?.cancel(); hbTask = nil
        pollIncomingTask?.cancel(); pollIncomingTask = nil
        guard let token = session.token else { return }
        hbTask = Task {
            while !Task.isCancelled {
                await APIClient().assistHeartbeat(token: token, available: true)
                try? await Task.sleep(for: .seconds(20))
            }
        }
        pollIncomingTask = Task { await pollIncoming(token: token) }
    }

    /// 退后台：停发心跳与来电轮询（不显式下线——服务端 45s TTL 自然过期，短暂切走不闪断）。
    private func pauseHeartbeat() {
        hbTask?.cancel(); hbTask = nil
        pollIncomingTask?.cancel(); pollIncomingTask = nil
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
            // 来电统一经 IncomingCallCenter 由 RootView 顶层呈现——与 CallKit 接听同一通路，
            // 避免「轮询」与「CallKit 桥接」对同一 callId 各弹一个 CallView 的双呈现竞态（见复审 #2）。
            // 守卫：本页无模态/确认卡/待呈现通话，且当前没有正在桥接的来电。
            if answering == nil, matched == nil, pendingAnswer == nil, !prefsShown,
               !IncomingCallCenter.shared.hasIncoming,
               let calls = try? await APIClient().incomingCalls(token: token),
               let first = calls.first(where: { !dismissedCallIds.contains($0.callId) }) {
                dismissedCallIds.insert(first.callId) // 标记已处理，结束后不再反复弹回
                // 前台：应用内来电铃，手动接听（参照 WhatsApp）。
                IncomingCallCenter.shared.ring(callId: first.callId, callerName: first.fromName, callerAvatar: first.fromAvatar)
            }
            try? await Task.sleep(for: .seconds(3))
        }
    }

    private func stopTasks(goOffline: Bool) {
        hbTask?.cancel(); hbTask = nil
        pollIncomingTask?.cancel(); pollIncomingTask = nil
        pollQueueTask?.cancel(); pollQueueTask = nil
        // 离开协助端界面（切角色/退出登录）才显式下线；其余情况靠服务端 TTL。
        if goOffline, let token = session.token {
            Task { await APIClient().assistHeartbeat(token: token, available: false) }
        }
    }

    // MARK: 动作

    private func claim(_ r: HelpRequestSummary) async {
        guard !busy, answering == nil, matched == nil, pendingAnswer == nil,
              !IncomingCallCenter.shared.hasIncoming, let token = session.token else { return }
        if session.user?.helperGuidelineAckAt == nil {
            afterGuideline = { Task { await claim(r) } }
            guidelineShown = true
            return
        }
        busy = true; defer { busy = false }
        do {
            let detail = try await APIClient().claimHelp(token: token, callId: r.callId)
            answering = AnsweringCall(callId: detail.callId, title: HelperStrings.helpingTitle(detail.fromName, lang), isIncoming: false)
        } catch {
            statusText = HelperStrings.claimedByOther(lang)
            await refreshQueue()
        }
    }

    private func matchRandom() async {
        guard !busy, answering == nil, matched == nil, pendingAnswer == nil,
              !IncomingCallCenter.shared.hasIncoming, let token = session.token else { return }
        if session.user?.helperGuidelineAckAt == nil {
            afterGuideline = { Task { await matchRandom() } }
            guidelineShown = true
            return
        }
        busy = true; statusText = HelperStrings.matching(lang); defer { busy = false }
        do {
            let preferred = preferredLanguage.isEmpty ? nil : preferredLanguage
            if let detail = try await APIClient().matchHelp(token: token, preferredLanguage: preferred, requireLanguageMatch: requireLanguageMatch) {
                statusText = nil
                matched = detail // 先展示详情，由协助者决定是否帮助（匹配已原子认领，跳过会释放回队列）
            } else {
                statusText = requireLanguageMatch ? HelperStrings.noSameLanguageRequest(lang) : HelperStrings.nobodyWaiting(lang)
            }
        } catch {
            statusText = HelperStrings.matchFailed(lang)
        }
    }

    /// 匹配到一位求助者后的确认卡：显示详情，选择「帮助 TA」或「跳过」（跳过释放回队列）。
    private func matchedSheet(_ detail: HelpRequestDetail) -> some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: BeeSpacing.md) {
                Text(HelperStrings.matchedTitle(lang)).font(.headline)
                BeeCard {
                    VStack(alignment: .leading, spacing: BeeSpacing.sm) {
                        HStack {
                            AvatarView(dataURL: detail.fromAvatar, name: detail.fromName, size: 48)
                            Text(detail.fromName).font(.title2.weight(.bold))
                        }
                        if let t = detail.topic, !t.isEmpty { BeeInfoRow(systemImage: "text.bubble", text: t) }
                        if let l = detail.locality, !l.isEmpty { BeeInfoRow(systemImage: "mappin.and.ellipse", text: l) }
                        if let lang = detail.language, !lang.isEmpty { BeeInfoRow(systemImage: "globe", text: languageName(lang)) }
                    }
                }
                // 合并为单一可读元素，与首屏求助卡片措辞一致，避免逐条右滑（见无障碍审计）。
                .accessibilityElement(children: .combine)
                .accessibilityLabel(matchedLabel(detail))
                BeeBigButton(HelperStrings.helpThem(lang), systemImage: "video.fill", tint: .beeSuccess, foreground: .white) {
                    // 暂存待呈现的通话，关掉 sheet；待 onDismiss 触发后再开 fullScreenCover（见审查 #3）。
                    pendingAnswer = AnsweringCall(callId: detail.callId, title: HelperStrings.helpingTitle(detail.fromName, lang), isIncoming: false)
                    matched = nil
                }
                Button(HelperStrings.skipThisOne(lang), role: .cancel) {
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
            .navigationTitle(HelperStrings.matchResultTitle(lang))
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { A11y.announce(HelperStrings.matchedAnnounce(matchedLabel(detail), lang)) }
        }
        .presentationDetents([.medium, .large])
    }

    private func accept(_ l: IncomingLinkInfo) async {
        guard let token = session.token, !linkBusy.contains(l.id) else { return }
        linkBusy.insert(l.id); defer { linkBusy.remove(l.id) }
        do {
            try await APIClient().acceptFamilyLink(token: token, id: l.id)
            statusText = HelperStrings.acceptedAnnounce(l.ownerName, lang) // 成功正向确认（列表变化看不到）
        } catch {
            statusText = HelperStrings.acceptFailed(lang) // 失败必须反馈，否则以为没生效反复点
        }
        await loadLinks()
    }

    private func reject(_ l: IncomingLinkInfo) async {
        guard let token = session.token, !linkBusy.contains(l.id) else { return }
        linkBusy.insert(l.id); defer { linkBusy.remove(l.id) }
        do { try await APIClient().deleteFamilyLink(token: token, id: l.id) }
        catch { statusText = HelperStrings.rejectFailed(lang) }
        await loadLinks()
    }

    /// 撤回我发出的、对方还没确认的绑定请求（后端 DELETE 双方均可操作）。
    private func cancelOutgoing(_ l: FamilyLinkInfo) async {
        guard let token = session.token, !linkBusy.contains(l.id) else { return }
        linkBusy.insert(l.id); defer { linkBusy.remove(l.id) }
        do { try await APIClient().deleteFamilyLink(token: token, id: l.id) }
        catch { statusText = HelperStrings.cancelRequestFailed(lang) }
        await loadLinks()
    }

    // MARK: 工具

    private func waitText(_ seconds: Int) -> String {
        HelperStrings.waitText(seconds, lang)
    }

    /// 匹配详情的统一合并朗读文案（与首屏求助卡片措辞一致）。
    private func matchedLabel(_ d: HelpRequestDetail) -> String {
        HelperStrings.matchedLabel(name: d.fromName, topic: d.topic, locality: d.locality,
                                   languageName: d.language.map { languageName($0) }, lang)
    }

    private func languageName(_ code: String) -> String {
        HelperStrings.languageName(code, lang)
    }
}

/// 协助者正在接听/帮助的一通通话（统一承载：认领的陌生人 + 亲人来电）。
struct AnsweringCall: Identifiable {
    let id = UUID()
    let callId: String
    let title: String
    let isIncoming: Bool   // true=亲人来电会合（结束需登记到 dismissedCallIds 防反复弹出）
}
