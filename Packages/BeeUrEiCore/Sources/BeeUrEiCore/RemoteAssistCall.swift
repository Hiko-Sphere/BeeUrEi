import Foundation

/// 一位可呼叫的明眼帮手（MVP：亲友名单，见 docs/PLAN.md §8.7）。
public struct Helper: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let language: String
    public let isOnline: Bool

    public init(id: String, name: String, language: String, isOnline: Bool) {
        self.id = id
        self.name = name
        self.language = language
        self.isOnline = isOnline
    }
}

/// 呼叫状态。
public enum CallState: Sendable, Equatable {
    case idle
    case ringing(helperID: String)
    case connected(helperID: String)
    case ended
    case failed(String)
}

/// 远程协助呼叫状态机 + 亲友筛选（纯逻辑；实际媒体由 RTC SDK 适配层负责）。
public struct RemoteAssistCall {
    public private(set) var state: CallState = .idle

    public init() {}

    /// 从名单筛出「在线 + 语言匹配」的可呼叫帮手。
    public static func callable(from contacts: [Helper], language: String) -> [Helper] {
        contacts.filter { $0.isOnline && $0.language == language }
    }

    /// 发起呼叫。仅在 idle 且对方在线时成功。
    @discardableResult
    public mutating func call(_ helper: Helper) -> Bool {
        guard case .idle = state else { return false }
        guard helper.isOnline else {
            state = .failed("对方不在线")
            return false
        }
        state = .ringing(helperID: helper.id)
        return true
    }

    /// 收到来电（callee 侧）：从 idle 进入振铃，使随后的 answer() 能转入 connected。
    @discardableResult
    public mutating func incoming(callerID: String) -> Bool {
        guard case .idle = state else { return false }
        state = .ringing(helperID: callerID)
        return true
    }

    /// 对方接听。
    public mutating func answer() {
        if case .ringing(let id) = state {
            state = .connected(helperID: id)
        }
    }

    /// 挂断（振铃中或已接通）。
    public mutating func hangUp() {
        switch state {
        case .ringing, .connected: state = .ended
        default: break
        }
    }

    public mutating func reset() { state = .idle }
}

/// 求助队列"新到"判定（纯逻辑，可单测；与 web 端 pickNewHelpRequests 同口径）：
/// 与已提示集合比对取新到 id；下一轮集合=当前队列全量 id——离队自动剪掉（有界），同 id 再回队会再次提示
/// （它确实又在等人）。志愿者感知层用：新求助进队要出声，否则盲人在队列里干等而志愿者毫无察觉。
public enum HelpQueueArrivals {
    public static func diff(current: [String], alerted: Set<String>) -> (fresh: [String], next: Set<String>) {
        (current.filter { !alerted.contains($0) }, Set(current))
    }
}
