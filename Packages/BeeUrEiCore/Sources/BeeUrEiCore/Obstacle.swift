import Foundation

/// 检测器（如 YOLO）输出的一个目标（与具体框架解耦）。
public struct DetectedObject: Sendable, Equatable {
    public let label: String       // 是什么
    public let normalizedX: Double // 检测框中心横坐标 0...1
    public let confidence: Float

    public init(label: String, normalizedX: Double, confidence: Float) {
        self.label = label
        self.normalizedX = normalizedX
        self.confidence = confidence
    }
}

/// 融合后的障碍：是什么 + 几点钟方向 + 多远 + 置信度。
public struct Obstacle: Sendable, Equatable {
    public let label: String
    public let clock: ClockDirection
    public let distanceMeters: Double?
    public let confidence: Float

    public init(label: String, clock: ClockDirection, distanceMeters: Double?, confidence: Float) {
        self.label = label
        self.clock = clock
        self.distanceMeters = distanceMeters
        self.confidence = confidence
    }
}

/// 把「检测结果」与「深度距离」融合成障碍（见 docs/PLAN.md §5.2/§7.2）。
public struct ObstacleFusion: Sendable {
    public let horizontalFOVDegrees: Double

    public init(horizontalFOVDegrees: Double) {
        self.horizontalFOVDegrees = horizontalFOVDegrees
    }

    public func fuse(_ obj: DetectedObject, distanceMeters: Double?) -> Obstacle {
        // 源头净化：非有限/负距离归一为 nil，使下游统一走「无距离」分支。
        let validDistance = distanceMeters.flatMap { ($0.isFinite && $0 >= 0) ? $0 : nil }
        return Obstacle(
            label: obj.label,
            clock: ClockDirection(normalizedX: obj.normalizedX, horizontalFOVDegrees: horizontalFOVDegrees),
            distanceMeters: validDistance,
            confidence: obj.confidence
        )
    }
}
