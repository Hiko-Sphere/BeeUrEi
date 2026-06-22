import SwiftUI

/// App 入口。先过免责知情同意门（首次/超期需完整同意），再进首屏。
@main
struct BeeUrEiApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate // 普通 APNs 提醒推送（软件外通知）

    init() {
        // 尽早配置音频会话：危险警告音须无视静音开关发声、压低背景音、来电后能恢复（见反馈输出深审 #1）。
        AudioSessionManager.configure()
        // 启动 CallKit/PushKit 服务（A1 后台来电）：单例存活后 PushKit 即注册 VoIP token。
        RemoteAssistService.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// 入口路由：安全须知同意 → 登录 → 恢复账号 → 确认角色 → 进入该角色主界面。
private struct RootView: View {
    private let store = ConsentStore()
    private let policy = DisclaimerPolicy()
    @State private var accepted = false
    @State private var session = AuthSession()
    @State private var enteredRole: String? = RoleEntryStore().lastRole // 老用户重启直接进主界面，跳过"进入"确认页
    @State private var incoming = IncomingCallCenter.shared // CallKit 接听后由它驱动来电界面
    @State private var appLock = AppLock.shared            // 应用锁（生物识别/设备密码）
    @State private var emergency = EmergencyAlertCenter.shared // 摔倒警报：锁屏须为其让位（盲人能取消误报）
    @Environment(\.scenePhase) private var scenePhase
    private var lang: Language { FeatureSettings().language }

    /// 安全遮罩应处模式：App 不活跃→隐私遮罩（防 App 切换器快照泄露）；
    /// 已锁定且已登录、无来电、无摔倒警报→锁屏；否则不遮挡。由独立高层级窗口承载（盖在 sheet/快照之上）。
    private var securityMode: SecurityScreen.Mode {
        if appLock.enabled && scenePhase != .active { return .privacy }
        if appLock.isLocked && session.isLoggedIn && !incoming.hasIncoming && emergency.phase == .idle { return .lock }
        return .hidden
    }

    var body: some View {
        Group {
            if needsFullConsent && !accepted {
                OnboardingView {
                    store.recordAcceptance()
                    accepted = true
                }
            } else if !session.isLoggedIn {
                AuthGateView(session: session)
            } else if session.user == nil {
                // 有 token 但未恢复账号 → 拉 /api/me 恢复角色。
                if session.restoreFailed {
                    // 网络/后端暂不可用：给出重试与退出出口，而非永久卡在转圈（见审查 #15）。
                    VStack(spacing: 20) {
                        Image(systemName: "wifi.exclamationmark").font(.system(size: 44)).foregroundStyle(.secondary)
                        Text(AccountStrings.restoreFailedTitle(lang)).font(.title2).bold()
                        Text(AccountStrings.restoreFailedBody(lang)).foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                        Button(AccountStrings.retry(lang)) { Task { await session.restore() } }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                        Button(AccountStrings.logout(lang)) { session.logout() }
                            .foregroundStyle(Color.beeDanger)
                    }
                    .padding()
                    // 安全/可用性：卡在登录恢复失败对盲人是"无声死局"——主动朗读原因与出口。
                    .onAppear { A11y.announce(AccountStrings.restoreFailedTitle(lang) + "。" + AccountStrings.restoreFailedBody(lang)) }
                } else {
                    ProgressView(AccountStrings.signingIn(lang))
                        .task { await session.restore() }
                }
            } else if session.needsAccountSetup {
                // 新登录方式后：引导自定义唯一 userid + 绑定验证邮箱（完成后才进入 App）。
                AccountSetupView(session: session)
            } else if enteredRole == nil {
                RoleEntryView(account: session.user!, session: session) { role in
                    enteredRole = role
                    RoleEntryStore().lastRole = role // 记住选择：下次打开 App 直接进主界面
                }
            } else {
                RoleHomeView(role: enteredRole!, session: session) {
                    enteredRole = nil
                    RoleEntryStore().lastRole = nil // 切换角色：清除记忆，回到角色确认页
                }
            }
        }
        // 共享同一个 AuthSession 给所有子视图(含 sheet 里的 LoginView)，避免出现第二个独立会话实例
        // 导致登出/删号/改密后内存态不同步（见审查 #5）。
        .environment(session)
        .tint(.beeAccent) // 全局强调色：浅色墨蓝/深色蜂蜜，两端皆高对比、无障碍友好
        // 切到后台即锁（若已开启）：回前台必须重新验证本人。仅 .background（避免 .inactive 瞬态误锁；隐私遮罩另由 securityMode 处理）。
        .onChange(of: scenePhase) { _, phase in if phase == .background { appLock.lockOnBackground() } }
        // 安全遮罩（锁屏 / 隐私遮罩）：用独立高层级窗口，盖在任何 sheet/快照之上——模式变化即驱动。
        .onChange(of: securityMode) { _, m in SecurityScreen.shared.update(m) }
        .onAppear { SecurityScreen.shared.update(securityMode) }
        // 退出登录后回到登录页，并清掉已选角色，避免下次登录沿用旧角色；登录后绑定 VoIP token（A1）。
        .onChange(of: session.isLoggedIn) { _, loggedIn in
            if loggedIn {
                RemoteAssistService.shared.refreshRegistration()
                Task { await PushAlerts.shared.uploadIfPossible(); await NotificationsCenter.shared.refresh() }
            } else { enteredRole = nil; RoleEntryStore().lastRole = nil } // 登出：清除记住的角色
        }
        // 账号恢复后纠正记忆：若服务端角色已变（非开发者），更新已记住的角色，避免老用户进错界面。
        .onChange(of: session.user?.role) { _, role in
            guard let role, let entered = enteredRole, entered != role, role != "developer" else { return }
            enteredRole = role
            RoleEntryStore().lastRole = role
        }
        // 来电统一在此顶层呈现（CallKit 接听 + 协助端轮询都经 IncomingCallCenter，单一通路，见复审 #2）。
        .fullScreenCover(item: Binding(get: { incoming.pending }, set: { incoming.pending = $0 })) { call in
            // 接收方的通话角色由"自己的账号角色"决定：盲人接到协助者来电 → 自己仍是画面分享方(.blind)；
            // 协助者接到盲人来电 → 自己是观看方(.helper)。这样双向呼叫的视频方向都正确。
            CallView(role: session.user?.role == "blind" ? .blind : .helper, callId: call.callId) {
                // 结束：取消后端会合登记（防 TTL 内被轮询重新弹出）+ 结束对应 CallKit 通话。
                if let token = KeychainStore.read() {
                    let id = call.callId
                    Task { await APIClient().cancelCall(token: token, callId: id) }
                }
                RemoteAssistService.shared.endCall()
                incoming.clear()
            }
            // 打开来电界面即视为"接听"（首接抢占）：群呼没抢到则告知并退出，不加入已满的房间。
            .task {
                guard let token = KeychainStore.read() else { return }
                let won = await APIClient().markAnswered(token: token, callId: call.callId)
                if !won {
                    A11y.announce(CallStrings.answeredElsewhere(lang))
                    RemoteAssistService.shared.endCall()
                    incoming.clear()
                }
            }
        }
        // 前台来电铃（应用内手动接听，参照 WhatsApp）。CallKit(后台)接听走上面的 pending → 直接进通话。
        .fullScreenCover(item: Binding(get: { incoming.ringing }, set: { incoming.ringing = $0 })) { ring in
            IncomingCallView(ring: ring, role: session.user?.role == "blind" ? .blind : .helper) {
                incoming.ringing = nil
            }
        }
    }

    private var needsFullConsent: Bool {
        policy.requirement(hasEverAccepted: store.hasEverAccepted,
                           daysSinceLastAcceptance: store.daysSinceLastAcceptance) == .fullConsentRequired
    }
}
