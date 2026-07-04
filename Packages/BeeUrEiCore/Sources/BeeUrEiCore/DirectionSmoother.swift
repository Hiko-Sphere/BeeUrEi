import Foundation

/// 方位/距离平滑（消除手抖导致的方向跳变）。
/// 方位用**单位向量指数平滑**(EMA)正确处理环绕；距离用标量 EMA。
/// alpha 越小越平滑（越抗抖，但越滞后）。
public final class DirectionSmoother {
    public let alpha: Double
    private var vx: Double?
    private var vy: Double?
    private var dist: Double?

    public init(alpha: Double = 0.25) {
        self.alpha = min(max(alpha, 0), 1)
    }

    /// 喂入一帧的（角度°，距离米?），返回平滑后的（角度°，距离米?）。
    @discardableResult
    public func update(angleDegrees: Double, distanceMeters: Double?) -> (angle: Double, distance: Double?) {
        if angleDegrees.isFinite {
            let r = angleDegrees * .pi / 180
            let nx = cos(r), ny = sin(r)
            if let px = vx, let py = vy {
                vx = (1 - alpha) * px + alpha * nx
                vy = (1 - alpha) * py + alpha * ny
            } else {
                vx = nx; vy = ny
            }
        }
        if let d = distanceMeters, d.isFinite {
            dist = dist.map { (1 - alpha) * $0 + alpha * d } ?? d
        }
        // 未初始化且本帧角度非有限（坏帧）：返回 0=正前方而非把 NaN/Inf 透传给上层（见审查 #2）。
        return (smoothedAngle ?? (angleDegrees.isFinite ? angleDegrees : 0), dist)
    }

    public var smoothedAngle: Double? {
        guard let vx, let vy else { return nil }
        // 相反方向平滑相消 → 合向量趋近 0，atan2 的角度只是数值噪声（毫无意义却会被当"确定方向"）。
        // 幅值过小时判为**方向不定**返回 nil（调用方回退到当前帧原始角，见 update 兜底）——对抗复审 MEDIUM。
        let mag = (vx * vx + vy * vy).squareRoot()
        guard mag >= 1e-3 else { return nil }
        return atan2(vy, vx) * 180 / .pi
    }

    public func reset() {
        vx = nil; vy = nil; dist = nil
    }
}
