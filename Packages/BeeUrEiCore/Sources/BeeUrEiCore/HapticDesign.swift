import Foundation

/// 一个震动脉冲（强度/锐度 0...1，相对起播时间秒）。
public struct HapticPulse: Equatable, Sendable {
    public let relativeTime: Double
    public let intensity: Double
    public let sharpness: Double
    public init(relativeTime: Double, intensity: Double, sharpness: Double) {
        self.relativeTime = relativeTime
        self.intensity = intensity
        self.sharpness = sharpness
    }
}

/// 触觉模式设计（纯逻辑，可单测）：按优先级给出**可区分**的震动节奏。
/// 设计意图：脉冲数量 + 强度 + 锐度随危险升高，让盲人不靠语音、仅凭手感即可分辨
/// "环境信息 / 状态 / 转向 / 危险"。嘈杂或不便听语音时的冗余安全通道。
public enum HapticDesign {
    public static func pattern(for priority: FeedbackPriority) -> [HapticPulse] {
        switch priority {
        case .environment:
            return [HapticPulse(relativeTime: 0, intensity: 0.3, sharpness: 0.3)] // 1 下轻柔
        case .status:
            return [HapticPulse(relativeTime: 0, intensity: 0.5, sharpness: 0.4)] // 1 下中等
        case .turn:
            return [ // 2 下：转向
                HapticPulse(relativeTime: 0, intensity: 0.7, sharpness: 0.6),
                HapticPulse(relativeTime: 0.15, intensity: 0.7, sharpness: 0.6),
            ]
        case .obstacle:
            return [ // 3 下强而锐：危险，可在嘈杂中辨识
                HapticPulse(relativeTime: 0, intensity: 1.0, sharpness: 0.9),
                HapticPulse(relativeTime: 0.12, intensity: 1.0, sharpness: 0.9),
                HapticPulse(relativeTime: 0.24, intensity: 1.0, sharpness: 0.9),
            ]
        case .critical:
            return [ // 4 下急促满强：落差/极近——最高危险，与普通障碍可区分
                HapticPulse(relativeTime: 0, intensity: 1.0, sharpness: 1.0),
                HapticPulse(relativeTime: 0.08, intensity: 1.0, sharpness: 1.0),
                HapticPulse(relativeTime: 0.16, intensity: 1.0, sharpness: 1.0),
                HapticPulse(relativeTime: 0.24, intensity: 1.0, sharpness: 1.0),
            ]
        }
    }
}
