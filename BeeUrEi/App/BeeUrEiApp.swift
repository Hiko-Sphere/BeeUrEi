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

/// 同意门：用核心 `DisclaimerPolicy`（已测）判定是否需要完整同意。
private struct RootView: View {
    private let store = ConsentStore()
    private let policy = DisclaimerPolicy()
    @State private var accepted = false

    var body: some View {
        if needsFullConsent && !accepted {
            OnboardingView {
                store.recordAcceptance()
                accepted = true
            }
        } else {
            HomeView()
        }
    }

    private var needsFullConsent: Bool {
        policy.requirement(hasEverAccepted: store.hasEverAccepted,
                           daysSinceLastAcceptance: store.daysSinceLastAcceptance) == .fullConsentRequired
    }
}
