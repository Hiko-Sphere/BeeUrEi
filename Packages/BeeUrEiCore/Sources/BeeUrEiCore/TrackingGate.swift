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

    /// 按 language 出双语提示（修复前硬编码中文——这些是实时播报的降级提示，英文用户须听得懂）。
    public func advisory(for quality: TrackingQuality, language: Language = .zh) -> String? {
        switch quality {
        case .normal:
            return nil
        case .limited(let reason):
            switch reason {
            case .excessiveMotion:      return SpokenStrings.trackingUnstable(language)
            case .insufficientFeatures: return SpokenStrings.trackingLowFeatures(language)
            case .initializing, .relocalizing: return SpokenStrings.trackingInitializing(language)
            case .other:                return SpokenStrings.trackingLimited(language)
            }
        case .notAvailable:
            return SpokenStrings.trackingUnavailable(language)
        }
    }
}
