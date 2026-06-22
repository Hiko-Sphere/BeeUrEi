import UIKit

/// 屏幕常亮（防息屏）的引用计数控制器。
///
/// `UIApplication.isIdleTimerDisabled` 是全局单一开关，但盲人侧有多处会同时需要常亮：
/// 导盲会话（走路时屏不能灭）、求助/取景界面、来电与通话。若各处各自直接 `= false`，
/// 任一处收尾就会误关其它仍在用的场景——典型回归：来电到来时收起导盲全屏，导盲页
/// `onDisappear` 释放常亮，结果通话中途息屏。
///
/// 这里以「原因集合」聚合：只要还有任一原因在持有，就保持常亮；所有原因都释放后才允许息屏。
/// 每个原因可带可选定时器，到点自动释放该原因（替代旧的 keepAwakeSeconds 定时释放）。
/// 全部经 `@MainActor`，与 UIKit 主线程要求一致。
@MainActor
enum ScreenWake {
    private static var reasons: Set<String> = []
    private static var timers: [String: Task<Void, Never>] = [:]

    /// 申请常亮（按 reason 去重、幂等）。`seconds > 0` 时到点自动释放该 reason。
    static func acquire(_ reason: String, seconds: Int = 0) {
        timers[reason]?.cancel()
        timers[reason] = nil
        reasons.insert(reason)
        apply()
        guard seconds > 0 else { return }
        timers[reason] = Task { @MainActor in
            try? await Task.sleep(for: .seconds(Double(seconds)))
            guard !Task.isCancelled else { return }
            release(reason)
        }
    }

    /// 释放某原因的常亮；仅当再无其它原因持有时才真正允许息屏。
    static func release(_ reason: String) {
        timers[reason]?.cancel()
        timers[reason] = nil
        reasons.remove(reason)
        apply()
    }

    private static func apply() {
        UIApplication.shared.isIdleTimerDisabled = !reasons.isEmpty
    }
}
