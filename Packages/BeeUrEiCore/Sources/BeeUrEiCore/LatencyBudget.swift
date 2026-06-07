import Foundation

/// 端到端延迟与「最小提前距离」判定（见 docs/PLAN.md §5.6）。
///
/// 目标：避障端到端（拍帧→推理→决策→开始播报/震动）≤ 目标值；并保证在用户撞上
/// 障碍前留出足够反应+减速距离。
public struct LatencyBudget: Sendable {
    public let targetSeconds: Double
    public let maxSeconds: Double

    public init(targetSeconds: Double = 0.8, maxSeconds: Double = 1.3) {
        self.targetSeconds = targetSeconds
        self.maxSeconds = maxSeconds
    }

    public enum Verdict: Sendable, Equatable {
        case good        // ≤ 目标
        case acceptable  // 目标 ~ 上限
        case fail        // > 上限
    }

    public func verdict(latencySeconds: Double) -> Verdict {
        if latencySeconds <= targetSeconds { return .good }
        if latencySeconds <= maxSeconds { return .acceptable }
        return .fail
    }

    /// 反应距离 = 步速 × 系统总延迟（用户在被提示前已走过的距离）。
    public func reactionDistance(speedMetersPerSecond: Double, latencySeconds: Double) -> Double {
        max(0, speedMetersPerSecond * latencySeconds)
    }

    /// 是否在撞上障碍前留出至少 `minLeadMeters` 的提前量。
    public func hasSufficientLead(detectionDistanceMeters: Double,
                                  speedMetersPerSecond: Double,
                                  latencySeconds: Double,
                                  minLeadMeters: Double = 2.0) -> Bool {
        let usable = detectionDistanceMeters - reactionDistance(speedMetersPerSecond: speedMetersPerSecond,
                                                                latencySeconds: latencySeconds)
        return usable >= minLeadMeters
    }
}
