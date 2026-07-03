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
