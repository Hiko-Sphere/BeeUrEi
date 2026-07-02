import Foundation

/// 全局语音通道（避障通道之外的所有出声口）：查询 < 导航 < 来电。
/// 避障(SpeechFeedback)不在此枚举内——它是独立安全通道，开播时本总线整体让位。
public enum SpeechChannel: Int, Comparable, Sendable, CaseIterable {
    case query = 0       // 识别/环境感知（"这是X"/"我在哪"/"前方有什么"…）
    case navigation = 1  // 导航转向/回程指令
    case call = 2        // 来电播报（"XX 来电"/"未接来电"）
    public static func < (l: Self, r: Self) -> Bool { l.rawValue < r.rawValue }
}

/// 语音总线仲裁决策（纯逻辑）：一条新播报相对总线当前状态该怎么处理。
/// 解决"避障语音与导航/查询语音同时出声"：
/// - 避障播报期间（safetyHold）：提示类丢弃；其余积压（每通道仅留最新一条），避障说完按优先级补播；
/// - 高优先级正在播：低优先级提示丢弃、非提示积压；
/// - 低优先级正在播：新的高优先级立即打断；
/// - 同通道：导航排队顺读（路线预览逐行依赖）；提示不打断非提示（识别结果保护）；其余替换。
public enum SpeechGate {
    public enum Action: Equatable, Sendable {
        case speakInterrupt   // 掐断当前，立即播
        case speakEnqueue     // 排在当前之后（合成器自动队列）
        case stash            // 积压为该通道最新一条，待当前/避障结束后补播
        case drop             // 丢弃（提示类过期即弃）
    }

    public static func action(newChannel: SpeechChannel, newDroppable: Bool,
                              current: (channel: SpeechChannel, droppable: Bool)?,
                              safetyHold: Bool) -> Action {
        if safetyHold { return newDroppable ? .drop : .stash }
        guard let current else { return .speakInterrupt } // 空闲：直接播
        if newChannel > current.channel { return .speakInterrupt }
        if newChannel < current.channel { return newDroppable ? .drop : .stash }
        // 同通道：
        // navigation：路线预览逐行顺读依赖排队。
        // call：通话文字（RTT）连发时逐条排队顺读——若互相掐断，前一条内容永久听不到（复审 HIGH）；
        //       来电/挂断类播报同通道排队只是稍晚几秒，不丢信息。
        if newChannel == .navigation || newChannel == .call { return .speakEnqueue }
        if newDroppable && !current.droppable { return .drop } // 取景提示不打断"这是X"
        return .speakInterrupt
    }
}

/// 取景提示节流（纯逻辑）：修"识别过于灵敏——稍动一下，正在播的内容立刻被下一帧提示掐断"。
/// 新提示需**连续 stableTicks 个处理帧保持一致**、且距上次开口 ≥ minGap 秒才播；
/// 相同提示按 repeatGap 秒重复（持续取景指导不被砍掉）。
public struct HintThrottle: Sendable {
    public let stableTicks: Int
    public let minGap: TimeInterval
    public let repeatGap: TimeInterval

    private var lastHint = ""
    private var lastSpoke: TimeInterval = 0
    private var pendingHint = ""
    private var pendingCount = 0

    public init(stableTicks: Int = 2, minGap: TimeInterval = 1.2, repeatGap: TimeInterval = 2.5) {
        self.stableTicks = stableTicks
        self.minGap = minGap
        self.repeatGap = repeatGap
    }

    /// 总线刚播了一条非提示内容（识别结果等）：提示从该时刻起同样受 minGap 约束，
    /// 且稳定计数清零（结果播完后须重新观察到稳定提示才开口）。
    public mutating func noteSpoke(at t: TimeInterval) {
        lastSpoke = t
        pendingHint = ""
        pendingCount = 0
    }

    /// 每个处理帧调用；返回 true 表示此刻应播报该提示。
    public mutating func shouldSpeak(_ hint: String, at t: TimeInterval) -> Bool {
        if hint == lastHint {
            pendingHint = ""
            pendingCount = 0
            if t - lastSpoke >= repeatGap { lastSpoke = t; return true }
            return false
        }
        if hint == pendingHint { pendingCount += 1 } else { pendingHint = hint; pendingCount = 1 }
        if pendingCount >= stableTicks, t - lastSpoke >= minGap {
            lastHint = hint
            lastSpoke = t
            pendingHint = ""
            pendingCount = 0
            return true
        }
        return false
    }
}
