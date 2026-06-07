import Foundation

/// 距离提示音参数（类似倒车雷达）：越近，蜂鸣越密、音高越高。
public struct ProximityCue: Sendable, Equatable {
    public let beepIntervalSeconds: Double
    public let pitchHz: Double

    public init(beepIntervalSeconds: Double, pitchHz: Double) {
        self.beepIntervalSeconds = beepIntervalSeconds
        self.pitchHz = pitchHz
    }
}

/// 把障碍距离映射成提示音节奏/音高（见 docs/PLAN.md §7.2 多模态反馈）。
public struct ProximityCueMapper: Sendable {
    public let maxDistance: Double
    public let nearInterval: Double
    public let farInterval: Double
    public let nearPitch: Double
    public let farPitch: Double

    public init(maxDistance: Double = 4,
                nearInterval: Double = 0.1, farInterval: Double = 1.0,
                nearPitch: Double = 1200, farPitch: Double = 600) {
        self.maxDistance = maxDistance
        self.nearInterval = nearInterval
        self.farInterval = farInterval
        self.nearPitch = nearPitch
        self.farPitch = farPitch
    }

    /// 超过 maxDistance 或无效距离返回 nil（不发提示音）。
    public func cue(distanceMeters: Double) -> ProximityCue? {
        guard distanceMeters >= 0, distanceMeters <= maxDistance else { return nil }
        let t = distanceMeters / maxDistance   // 0(近)...1(远)
        let interval = nearInterval + t * (farInterval - nearInterval)
        let pitch = nearPitch - t * (nearPitch - farPitch)
        return ProximityCue(beepIntervalSeconds: interval, pitchHz: pitch)
    }
}
