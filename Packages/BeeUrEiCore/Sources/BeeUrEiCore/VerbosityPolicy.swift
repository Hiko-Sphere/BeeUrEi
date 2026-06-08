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
