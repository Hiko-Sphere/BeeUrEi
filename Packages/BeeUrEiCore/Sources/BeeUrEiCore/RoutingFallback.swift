import Foundation

/// 路由模式（见 docs/PLAN.md §5.6）。
public enum RoutingMode: Sendable, Equatable {
    case accessible            // 用无障碍/盲道路由
    case ordinaryWithAvoidance // 降级：普通步行路线 + 摄像头避障兜底
}

public struct RoutingFallbackDecision: Sendable, Equatable {
    public let mode: RoutingMode
    public let advisory: String?

    public init(mode: RoutingMode, advisory: String?) {
        self.mode = mode
        self.advisory = advisory
    }
}

/// 无障碍数据缺失降级判定：OSM/图商的盲道/人行道数据严重不全，
/// 不能默认「视障友好路由」一定可达；缺失时降级并语音告知。
public struct RoutingFallback: Sendable {
    public init() {}

    public func decide(hasAccessibleData: Bool) -> RoutingFallbackDecision {
        if hasAccessibleData {
            return RoutingFallbackDecision(mode: .accessible, advisory: nil)
        }
        return RoutingFallbackDecision(
            mode: .ordinaryWithAvoidance,
            advisory: "本段无盲道数据，已切换为普通步行 + 实时避障"
        )
    }
}
