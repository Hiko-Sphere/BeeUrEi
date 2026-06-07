import Foundation

/// 安全免责告知策略（见 docs/PLAN.md §1.3）：
/// 首次/超期需完整免责 + 强制确认；平时每次开始只播一句简短提醒。
///
/// 设计成纯函数（注入「距上次确认天数」而非内部读时钟），便于确定性单测。
public struct DisclaimerPolicy: Sendable {
    public let reaffirmIntervalDays: Double

    public init(reaffirmIntervalDays: Double = 30) {
        self.reaffirmIntervalDays = reaffirmIntervalDays
    }

    public enum Requirement: Sendable, Equatable {
        case fullConsentRequired   // 首次或超期：完整免责全文 + 强制「我已理解」
        case briefReminder         // 每次开始：一句简短提醒（可在设置关闭语音）
    }

    public func requirement(hasEverAccepted: Bool, daysSinceLastAcceptance: Double) -> Requirement {
        if !hasEverAccepted { return .fullConsentRequired }
        if daysSinceLastAcceptance >= reaffirmIntervalDays { return .fullConsentRequired }
        return .briefReminder
    }

    public var briefReminderText: String { "避障已开启，仅作辅助，请配合盲杖" }
}
