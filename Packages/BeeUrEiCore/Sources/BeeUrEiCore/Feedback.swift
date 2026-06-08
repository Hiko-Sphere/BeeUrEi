import Foundation

/// 反馈优先级（见 docs/PLAN.md §3.1 / §7.2）。数值越大优先级越高。
public enum FeedbackPriority: Int, Comparable, Sendable {
    case environment = 0   // P3 环境描述
    case status      = 1   // P2 状态 / 确认
    case turn        = 2   // P1 转向指令
    case obstacle    = 3   // P0 安全 / 避障
    case critical    = 4   // 最高：落差/坠落、正前方极近——不可被普通障碍打断（见审查 #6/#9）

    public static func < (lhs: Self, rhs: Self) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// 一条待反馈事件。
public struct FeedbackEvent: Equatable, Sendable {
    public let priority: FeedbackPriority
    public let speech: String?
    /// 是否要求立即打断当前播报（危险骤升/极近时透传到反馈层，VoiceOver 用高优先级公告抢占，见审查 #2）。
    public let interrupt: Bool

    public init(priority: FeedbackPriority, speech: String?, interrupt: Bool = false) {
        self.priority = priority
        self.speech = speech
        self.interrupt = interrupt
    }
}

/// 反馈仲裁（纯逻辑）：决定新事件是否应抢占当前正在播报的事件，避免互相打断与信息过载。
public struct FeedbackArbiter {
    public private(set) var current: FeedbackEvent?

    public init() {}

    /// 提交一个新事件，返回是否应当（开始）播报它。
    /// 规则：
    /// - 空闲 → 播报。
    /// - 新事件优先级 ≥ 当前 → 抢占播报（同优先级也用更新的覆盖，如更近的障碍）。
    /// - 新事件优先级 < 当前 → 丢弃（不打断更高优先级）。
    public mutating func shouldPlay(_ event: FeedbackEvent) -> Bool {
        if let cur = current, event.priority < cur.priority {
            return false
        }
        current = event
        return true
    }

    /// 当前播报结束时调用，释放通道。
    public mutating func finish() {
        current = nil
    }
}
