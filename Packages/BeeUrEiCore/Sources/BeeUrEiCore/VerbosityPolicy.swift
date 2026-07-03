import Foundation

/// 播报详略（解决"信息过载"——竞品反复出现的抱怨；见 docs/COMPETITIVE_STRATEGY §4）。
/// quiet=只在危险时出声、normal=转向+危险、full=全部。纯逻辑，可单测。
public enum FeedbackVerbosity: Int, Sendable, CaseIterable {
    case quiet = 0
    case normal = 1
    case full = 2
}

public struct VerbosityPolicy: Sendable {
    public init() {}

    public func shouldSpeak(priority: FeedbackPriority, verbosity: FeedbackVerbosity) -> Bool {
        switch verbosity {
        case .quiet:  return priority.rawValue >= FeedbackPriority.obstacle.rawValue // 仅安全/避障(含更高的 critical)
        case .normal: return priority.rawValue >= FeedbackPriority.turn.rawValue // 转向 + 危险
        case .full:   return true
        }
    }
}

/// 播报详略的语音调节方向（"说简短点/说详细点"解析结果）。
public enum VerbosityAdjust: Sendable, Equatable {
    case terser      // 更简短（向 quiet 降一档）
    case moreDetail  // 更详细（向 full 升一档）
}

public extension FeedbackVerbosity {
    /// 按语音"简短点/详细点"步进一档，夹在 [quiet, full]（纯逻辑可单测；盲人赶路想精简、
    /// 熟悉环境后嫌啰嗦，语速之外的第二个最常即时调项）。
    func adjusted(_ direction: VerbosityAdjust) -> FeedbackVerbosity {
        let next = rawValue + (direction == .moreDetail ? 1 : -1)
        return FeedbackVerbosity(rawValue: min(max(next, FeedbackVerbosity.quiet.rawValue), FeedbackVerbosity.full.rawValue)) ?? self
    }

    /// 该方向是否已到边界（用于"已经最简/最详了"提示，不做无声调节）。
    func atLimit(_ direction: VerbosityAdjust) -> Bool {
        direction == .moreDetail ? self == .full : self == .quiet
    }
}
