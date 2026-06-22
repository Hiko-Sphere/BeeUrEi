import SwiftUI
import UIKit

/// 安全遮罩窗口：用独立的高层级 `UIWindow` 承载「锁屏」或「隐私遮罩」，确保盖在**一切**之上——
/// 包括任何已弹出的 sheet / fullScreenCover（SwiftUI 同层 ZStack 盖不住 UIKit 弹层，这是锁屏被绕过的根因），
/// 以及切到后台 / App 切换器时系统拍下的快照（隐私遮罩防敏感内容泄露）。
///
/// 由 `RootView` 根据 (场景状态 / 是否锁定 / 是否登录 / 是否有来电 / 是否在摔倒警报) 计算出 `Mode` 后驱动。
@MainActor
final class SecurityScreen {
    static let shared = SecurityScreen()
    private init() {}

    enum Mode: Equatable {
        case hidden     // 不遮挡
        case privacy    // 仅遮挡（无验证 UI）：App 不活跃时防快照泄露
        case lock       // 锁屏（带验证 UI）：回到前台需验证本人
    }

    private var window: UIWindow?
    private(set) var mode: Mode = .hidden

    func update(_ newMode: Mode) {
        guard newMode != mode else { return }
        mode = newMode
        switch newMode {
        case .hidden:
            window?.isHidden = true
            window = nil
            Self.restoreMainKeyWindow()   // 锁屏窗曾抢 key，撤掉后把 key 还给主窗口，避免键盘/输入失灵
        case .privacy:
            present(AnyView(PrivacyCoverView()), interactive: false)
        case .lock:
            present(AnyView(LockScreenView(lock: AppLock.shared)), interactive: true)
        }
    }

    private func present(_ root: AnyView, interactive: Bool) {
        guard let scene = Self.activeScene() else { return }
        let host = UIHostingController(rootView: root)
        host.view.backgroundColor = UIColor(Color.beeInk)   // 不透明：彻底遮挡其下内容
        let w = window ?? UIWindow(windowScene: scene)
        w.windowLevel = .alert + 1                           // 高于 sheet / alert
        w.rootViewController = host
        w.isUserInteractionEnabled = interactive             // 隐私遮罩只遮挡、不接管交互
        if interactive {
            w.makeKeyAndVisible()                            // 锁屏需接收「解锁」点按
        } else {
            w.isHidden = false
        }
        window = w
    }

    private static func activeScene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive }
            ?? scenes.first { $0.activationState == .foregroundInactive }
            ?? scenes.first
    }

    /// 把 key 还给主（.normal 层级）窗口。
    private static func restoreMainKeyWindow() {
        guard let scene = activeScene() else { return }
        scene.windows.first { $0.windowLevel == .normal && !$0.isHidden }?.makeKey()
    }
}

/// 隐私遮罩（无验证 UI，仅品牌遮挡）：App 不活跃时盖住内容，避免 App 切换器快照泄露敏感信息。
private struct PrivacyCoverView: View {
    var body: some View {
        ZStack {
            Color.beeInk.ignoresSafeArea()
            VStack(spacing: BeeSpacing.md) {
                Image(systemName: "lock.fill").font(.system(size: 48, weight: .bold)).foregroundStyle(Color.beeHoney)
                Text("BeeUrEi").font(.title2.bold()).foregroundStyle(.white.opacity(0.85))
            }
        }
        .accessibilityHidden(true)   // 仅遮挡，无需 VoiceOver 焦点
    }
}
