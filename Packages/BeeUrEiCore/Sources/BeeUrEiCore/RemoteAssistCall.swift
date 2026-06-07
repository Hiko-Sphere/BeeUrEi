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
