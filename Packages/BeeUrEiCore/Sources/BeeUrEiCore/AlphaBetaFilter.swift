import Foundation

/// α-β 滤波（常速模型）：平滑标量观测并估计其变化率。
/// 用于跟踪中 距离/方位 的平滑与闭合速度估计（→ TTC）。比完整卡尔曼轻、端侧友好。
public struct AlphaBetaFilter: Sendable {
    public let alpha: Double
    public let beta: Double
    public private(set) var position: Double
    public private(set) var velocity: Double
    private var initialized: Bool

    public init(alpha: Double = 0.5, beta: Double = 0.1) {
        self.alpha = alpha
        self.beta = beta
        self.position = 0
        self.velocity = 0
        self.initialized = false
    }

    public mutating func update(measurement z: Double, dt: Double) {
        guard z.isFinite else { return }
        if !initialized {
            position = z; velocity = 0; initialized = true
            return
        }
        // 非有限 dt(坏帧时序)当 0 处理：仍并入本次观测做平滑、只是不做时间预测/不更新速度。
        // 否则 predicted = position + velocity*NaN = NaN → position 被**永久污染**（与 z 守卫同口径）。
        let d = dt.isFinite ? dt : 0
        let predicted = position + velocity * d
        let residual = z - predicted
        position = predicted + alpha * residual
        if d > 0 { velocity += beta * residual / d }
    }

    public var isInitialized: Bool { initialized }
}
