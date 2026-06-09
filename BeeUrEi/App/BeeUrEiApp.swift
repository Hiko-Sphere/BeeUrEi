import SwiftUI

/// App 入口。先过免责知情同意门（首次/超期需完整同意），再进首屏。
@main
struct BeeUrEiApp: App {
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
    @State private var enteredRole: String?
    @State private var incoming = IncomingCallCenter.shared // CallKit 接听后由它驱动来电界面

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
                        Text("连接服务器失败").font(.title2).bold()
                        Text("请检查网络后重试。").foregroundStyle(.secondary)
                        Button("重试") { Task { await session.restore() } }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                        Button("退出登录") { session.logout() }
                            .foregroundStyle(.red)
                    }
                    .padding()
                } else {
                    ProgressView("正在登录…")
                        .task { await session.restore() }
                }
            } else if enteredRole == nil {
                RoleEntryView(account: session.user!, session: session) { enteredRole = $0 }
            } else {
                RoleHomeView(role: enteredRole!, session: session) { enteredRole = nil }
            }
        }
        // 共享同一个 AuthSession 给所有子视图(含 sheet 里的 LoginView)，避免出现第二个独立会话实例
        // 导致登出/删号/改密后内存态不同步（见审查 #5）。
        .environment(session)
        .tint(.beeInk) // 全局品牌强调色，统一按钮/开关/链接观感（墨蓝高对比，无障碍友好）
        // 退出登录后回到登录页，并清掉已选角色，避免下次登录沿用旧角色；登录后绑定 VoIP token（A1）。
        .onChange(of: session.isLoggedIn) { _, loggedIn in
            if loggedIn { RemoteAssistService.shared.refreshRegistration() }
            else { enteredRole = nil }
        }
        // 来电统一在此顶层呈现（CallKit 接听 + 协助端轮询都经 IncomingCallCenter，单一通路，见复审 #2）。
        .fullScreenCover(item: Binding(get: { incoming.pending }, set: { incoming.pending = $0 })) { call in
            CallView(role: .helper, callId: call.callId) {
                // 结束：取消后端会合登记（防 TTL 内被轮询重新弹出）+ 结束对应 CallKit 通话。
                if let token = KeychainStore.read() {
                    let id = call.callId
                    Task { await APIClient().cancelCall(token: token, callId: id) }
                }
                RemoteAssistService.shared.endCall()
                incoming.clear()
            }
        }
    }

    private var needsFullConsent: Bool {
        policy.requirement(hasEverAccepted: store.hasEverAccepted,
                           daysSinceLastAcceptance: store.daysSinceLastAcceptance) == .fullConsentRequired
    }
}
