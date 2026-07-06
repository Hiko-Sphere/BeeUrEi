import Foundation

/// 一套省电降级方案。
public struct PowerPlan: Sendable, Equatable {
    public let targetFPS: Int
    public let advisory: String?

    public init(targetFPS: Int, advisory: String?) {
        self.targetFPS = targetFPS
        self.advisory = advisory
    }
}

/// 低电量 / 省电模式降级策略（见 docs/PLAN.md §5.4「低电量同样降级」）。
public struct PowerPolicy: Sendable {
    public let lowBatteryThreshold: Double
    public let criticalBatteryThreshold: Double

    public init(lowBatteryThreshold: Double = 0.2, criticalBatteryThreshold: Double = 0.1) {
        self.lowBatteryThreshold = lowBatteryThreshold
        self.criticalBatteryThreshold = criticalBatteryThreshold
    }

    /// - Parameters:
    ///   - batteryLevel: 0...1；负值表示未知（如模拟器）→ 视为正常。
    ///   - lowPowerMode: 系统省电模式是否开启。
    /// advisory 按 language 出双语文案（修复前硬编码中文——安全相关降级提示必须双语）。
    public func plan(batteryLevel: Double, lowPowerMode: Bool, language: Language = .zh) -> PowerPlan {
        if batteryLevel >= 0, batteryLevel <= criticalBatteryThreshold {
            return PowerPlan(targetFPS: 5, advisory: SpokenStrings.powerCriticalLow(language))
        }
        if lowPowerMode || (batteryLevel >= 0 && batteryLevel <= lowBatteryThreshold) {
            return PowerPlan(targetFPS: 8, advisory: SpokenStrings.powerSaverSlowdown(language))
        }
        return PowerPlan(targetFPS: 15, advisory: nil)
    }
}

/// 低电量**主动语音告警**的去抖状态机（纯逻辑，可单测）。盲人看不到电量图标，而手机没电=同时失去导盲、
/// 导航与紧急求助——必须在跌破关键档时**主动出声**（而非等用户开口查）。三档：20% 提醒、10% 紧急、5% 濒临关机
/// **再紧急一次**（即便 10% 那次被安全播报打断/用户在通话中错过，濒断电前仍再提醒——生命线设备多一次值得）。
/// 每档只播一次，充电或电量回升到该档之上才重新武装（防 1% 抖动连播刷屏）。未知电量（负值/模拟器）不猜不播。
public struct LowBatteryWarner: Sendable {
    public enum Alert: Equatable, Sendable { case low, critical }   // 20% 档→.low；10% 与 5% 档→.critical（后者百分数更小、文案自然更急）
    public let lowPercent: Int
    public let criticalPercent: Int
    public let emptyPercent: Int
    private var armedLow = true
    private var armedCritical = true
    private var armedEmpty = true

    public init(lowPercent: Int = 20, criticalPercent: Int = 10, emptyPercent: Int = 5) {
        self.lowPercent = lowPercent
        self.criticalPercent = criticalPercent
        self.emptyPercent = emptyPercent
    }

    /// 喂入一次电量读数（0–100 整数百分比；<0 视为未知）。返回本次应播的告警档，nil = 不播。
    public mutating func update(percent: Int, charging: Bool) -> Alert? {
        if charging { armedLow = true; armedCritical = true; armedEmpty = true; return nil } // 充电中：全部重新武装、不打扰
        guard percent >= 0 else { return nil }                            // 未知电量不猜不播
        if percent > lowPercent { armedLow = true }                       // 回升到 20% 之上 → 重新武装 low
        if percent > criticalPercent { armedCritical = true }             // 回升到 10% 之上 → 重新武装 critical
        if percent > emptyPercent { armedEmpty = true }                   // 回升到 5% 之上 → 重新武装 empty
        // 濒临关机（≤emptyPercent，默认5%）：**须先于** critical 档判（5≤10 也满足下条）。复用 .critical 文案，"只剩5%"自然更急。
        if percent <= emptyPercent, armedEmpty {                          // 抑制同次下探的低两档，濒断电只报这一句最急的
            armedEmpty = false; armedCritical = false; armedLow = false
            return .critical
        }
        if percent <= criticalPercent, armedCritical {                    // 危险档优先，且抑制同次下探的 low
            armedCritical = false; armedLow = false
            return .critical
        }
        if percent <= lowPercent, armedLow {
            armedLow = false
            return .low
        }
        return nil
    }
}
