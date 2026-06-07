import Foundation

/// 平台无关的跟踪质量（由 iOS 适配层从 ARKit `ARCamera.trackingState` 映射而来）。
public enum TrackingLimitedReason: Sendable, Equatable {
    case initializing, excessiveMotion, insufficientFeatures, relocalizing, other
}

public enum TrackingQuality: Sendable, Equatable {
    case normal
    case limited(reason: TrackingLimitedReason)
    case notAvailable
}

/// 避障模式。
public enum AvoidanceMode: Sendable, Equatable {
    case ranging    // 测距级（给真实米数）
    case relative   // 仅相对预警
    case suspended  // 暂停测距承诺
}

/// LiDAR 跟踪状态门控（见 docs/PLAN.md §5.2）：
/// 「有 LiDAR 就一定可靠」是错的——跟踪丢失/漂移时必须降级。
public struct TrackingGate: Sendable {
    public init() {}

    public func mode(for quality: TrackingQuality) -> AvoidanceMode {
        switch quality {
        case .normal:        return .ranging
        case .limited:       return .relative
        case .notAvailable:  return .suspended
        }
    }

    public func advisory(for quality: TrackingQuality) -> String? {
        switch quality {
        case .normal:
            return nil
        case .limited(let reason):
            switch reason {
            case .excessiveMotion:      return "跟踪不稳，请放慢移动"
            case .insufficientFeatures: return "环境特征不足，测距精度下降"
            case .initializing, .relocalizing: return "正在初始化跟踪，请稍候"
            case .other:                return "跟踪受限，测距精度下降"
            }
        case .notAvailable:
            return "无法测距，避障已降级"
        }
    }
}
