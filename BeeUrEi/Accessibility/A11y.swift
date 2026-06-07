import UIKit

/// 无障碍小工具。
/// 一次性事件（如「检测到障碍」）用这个交给 VoiceOver 播报，
/// 避免和 VoiceOver 自己的朗读抢话（见 docs/PLAN.md §7.2）。
enum A11y {
    static func announce(_ message: String) {
        UIAccessibility.post(notification: .announcement, argument: message)
    }
}
