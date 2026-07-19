import Foundation

/// 通话信号档位（对应 App 层 `MediaEngine.CallQuality`：unknown/weak/fair/good）。App 侧一次映射即可，
/// 判定逻辑放在核心以便单测。两者刻意保持同样的四档，若 App 侧改动需同步这里。
public enum CallSignalLevel: Sendable, Equatable {
    case unknown, weak, fair, good
}

public extension CallSignalLevel {
    /// 由实测**往返时延(秒)**判定信号档：<150ms good / <400ms fair / 否则 weak。nil=无数据→unknown；
    /// 非有限(NaN/∞)保守当 weak（不虚报好信号）。与协助端 web `qualityFromRtt` 同阈值同语义。
    static func fromRtt(_ rttSeconds: Double?) -> CallSignalLevel {
        guard let r = rttSeconds else { return .unknown }
        guard r.isFinite else { return .weak }
        return r < 0.15 ? .good : (r < 0.4 ? .fair : .weak)
    }

    /// 由**区间丢包率(0..1)**判定信号档：<3% good / <8% fair / 否则 weak。nil/非有限→unknown（不降级）；
    /// 负值夹 0（防累计计数器差分抖动虚报差信号）。与协助端 web `qualityFromLoss` 同阈值同语义。
    static func fromLoss(_ lossFraction: Double?) -> CallSignalLevel {
        guard let f = lossFraction, f.isFinite else { return .unknown }
        let x = Swift.max(0, f)
        return x < 0.03 ? .good : (x < 0.08 ? .fair : .weak)
    }

    /// 由**抖动(秒)**（RFC3550 到达间隔抖动）判定信号档：<30ms good/<60ms fair/否则 weak。nil/非有限→unknown
    /// （不降级）；负值夹 0。与 web `qualityFromJitter` 同阈值同语义。抖动大=到达忽快忽慢、语音断续，
    /// 即便丢包与 RTT 都不高也会卡（MOS 三要素独立一维）。
    static func fromJitter(_ jitterSeconds: Double?) -> CallSignalLevel {
        guard let j = jitterSeconds, j.isFinite else { return .unknown }
        let x = Swift.max(0, j)
        return x < 0.03 ? .good : (x < 0.06 ? .fair : .weak)
    }

    /// 综合信号档：**取 RTT / 丢包 / 抖动三档中最差的一档**（行业通例——MOS 同时受时延、丢包、抖动拖累，
    /// 任一变差都直接影响可听度）。任一信号缺失(unknown)时以其余有信息者为准；全缺→unknown。与 web
    /// `qualityFromStats` 同语义（跨端一致）。jitterSeconds 默认 nil，向后兼容既有仅传 RTT+丢包的调用。
    static func fromMetrics(rttSeconds: Double?, lossFraction: Double?, jitterSeconds: Double? = nil) -> CallSignalLevel {
        func rank(_ q: CallSignalLevel) -> Int {
            switch q { case .unknown: return -1; case .good: return 0; case .fair: return 1; case .weak: return 2 }
        }
        // 取最差；unknown(-1) 天然让位于任何已知档。
        return [fromRtt(rttSeconds), fromLoss(lossFraction), fromJitter(jitterSeconds)]
            .max(by: { rank($0) < rank($1) }) ?? .unknown
    }
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
        // 恢复时按恢复到的档区分：恢复到 good=彻底好了；只到 fair=好转但仍不稳（如从死角挪到"能用但一般"的位置）。
        // 后者若也说"恢复了"会让盲人误以为可停止找位置、随后仍遇卡顿而困惑——如实说"好些了但仍可能卡顿"更可行动。
        let fullyRecovered = (level == .good)
        if language == .zh {
            if isWeak { return "通话信号弱，可能会卡顿或听不清；换个位置、靠近路由器可能会好一些。" }
            return fullyRecovered ? "通话信号恢复了。" : "通话信号好一些了，但可能仍有卡顿。"
        } else {
            if isWeak { return "Call signal is weak — audio may stutter; moving or getting closer to your router may help." }
            return fullyRecovered ? "Call signal is back to normal." : "Call signal improved but may still stutter."
        }
    }
}
