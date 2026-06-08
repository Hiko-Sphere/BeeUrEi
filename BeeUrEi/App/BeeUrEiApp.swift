import SwiftUI

/// App 入口。先过免责知情同意门（首次/超期需完整同意），再进首屏。
@main
struct BeeUrEiApp: App {
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
        // 退出登录后回到登录页，并清掉已选角色，避免下次登录沿用旧角色。
        .onChange(of: session.isLoggedIn) { _, loggedIn in
            if !loggedIn { enteredRole = nil }
        }
    }

    private var needsFullConsent: Bool {
        policy.requirement(hasEverAccepted: store.hasEverAccepted,
                           daysSinceLastAcceptance: store.daysSinceLastAcceptance) == .fullConsentRequired
    }
}
