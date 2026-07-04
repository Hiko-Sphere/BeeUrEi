import Foundation

/// 通话信号档位（对应 App 层 `MediaEngine.CallQuality`：unknown/weak/fair/good）。App 侧一次映射即可，
/// 判定逻辑放在核心以便单测。两者刻意保持同样的四档，若 App 侧改动需同步这里。
public enum CallSignalLevel: Sendable, Equatable {
    case unknown, weak, fair, good
}

/// 通话信号变化"该不该向盲人播报"的判定（纯逻辑，可单测）。
///
/// 背景：协助者（web/iOS）看得到信号格（QualityBars / NetworkStatusBar），但盲人看不到——通话卡顿时
/// 最需要知道"该挪个位置"的恰恰是盲人。可 WebRTC 实测 RTT 会抖动，逐读数播报会刷屏。故本判定：
/// - 只播报**进入弱信号**（带可行动建议：换位置/靠近路由器）与**从弱恢复**；fair↔good 之间不表态（不可行动、只会成噪音）。
/// - 状态翻转需**连续确认**若干次（默认 3）才播——抵御 RTT 抖动导致的"弱/好/弱"刷屏。
/// - `unknown`（本 tick 无数据）不表态、也不清空正在累积的确认（视作中性），避免瞬时空读打断判定。
/// - 同一已播状态不重复播。
public struct CallQualityAnnouncer: Sendable {
    private var announcedWeak = false     // 当前是否已向用户播报过"信号弱"
    private var pendingWeak: Bool? = nil  // 正在累积确认的目标（true=转弱，false=恢复）
    private var pendingCount = 0
    private let confirmations: Int

    /// confirmations：状态翻转需连续多少次相同读数才确认（默认 3，抵御 RTT 抖动）。
    public init(confirmations: Int = 3) {
        self.confirmations = max(1, confirmations)
    }

    /// 输入最新实测信号档，返回需要播报的文案（nil = 无需播报）。
    public mutating func update(_ level: CallSignalLevel, language: Language) -> String? {
        guard level != .unknown else { return nil } // 无数据：中性，保留正在累积的确认
        let isWeak = (level == .weak)
        if isWeak == announcedWeak {                 // 与已播状态一致：稳定，清掉未决累积
            pendingWeak = nil; pendingCount = 0
            return nil
        }
        if pendingWeak == isWeak { pendingCount += 1 } else { pendingWeak = isWeak; pendingCount = 1 }
        guard pendingCount >= confirmations else { return nil }
        announcedWeak = isWeak; pendingWeak = nil; pendingCount = 0
        if language == .zh {
            return isWeak
                ? "通话信号弱，可能会卡顿或听不清；换个位置、靠近路由器可能会好一些。"
                : "通话信号恢复了。"
        } else {
            return isWeak
                ? "Call signal is weak — audio may stutter; moving or getting closer to your router may help."
                : "Call signal is back to normal."
        }
    }
}
