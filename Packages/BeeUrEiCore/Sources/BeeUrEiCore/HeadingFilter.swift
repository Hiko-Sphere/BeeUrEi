import Foundation

/// 航向平滑 + 磁干扰检测（见 docs/PLAN.md §5.3）。
///
/// 用单位向量做指数平滑以正确处理 359°→1° 的环绕；用 `headingAccuracy` 判断是否可信。
public struct HeadingFilter {
    /// 罗盘可信阈值（航向精度上限，度）：headingAccuracy 超过此值即视为磁干扰/未校准，不可用于定向。
    /// 信标(NavigationViewModel)与「我朝哪个方向」(LocationDescriber/CompassRose.reliableCardinal)共用同一阈值
    /// ——单一事实源，避免两处各写魔法数而漂移。八方位每档 45°，>20° 误差足以整档报错，故此门槛对定向播报尤重。
    public static let defaultMaxTrustedAccuracyDegrees: Double = 20

    /// 无实例的可信判定（供一次性罗盘读数场景，如「我朝哪个方向」，复用与信标同一阈值）。
    /// CLHeading 用负 `headingAccuracy` 表示无效/受干扰；上限外的大误差同样判不可信。
    public static func isReliable(accuracyDegrees: Double,
                                  maxTrusted: Double = HeadingFilter.defaultMaxTrustedAccuracyDegrees) -> Bool {
        accuracyDegrees >= 0 && accuracyDegrees <= maxTrusted
    }

    public let smoothingFactor: Double          // 新样本权重 0...1
    public let maxTrustedAccuracyDegrees: Double

    private var smoothed: Double?               // 0...360

    public init(smoothingFactor: Double = 0.3, maxTrustedAccuracyDegrees: Double = HeadingFilter.defaultMaxTrustedAccuracyDegrees) {
        self.smoothingFactor = smoothingFactor
        self.maxTrustedAccuracyDegrees = maxTrustedAccuracyDegrees
    }

    /// 喂入一个航向样本，返回平滑后的航向（度，0...360）。
    @discardableResult
    public mutating func update(headingDegrees: Double, accuracyDegrees: Double) -> Double {
        // 非有限航向（如上游把 headYaw 毛刺累加出 NaN/∞）：绝不并入——否则一旦存进 smoothed，
        // 之后每次 atan2(NaN,NaN) 都出 NaN，平滑值**永久被污染**直到重启。返回上个平滑值或 0(正北)。
        guard headingDegrees.isFinite else { return smoothed ?? 0 }
        // 不可信（含 CLHeading 用负值表示的无效/受磁干扰）样本：丢弃，不并入平滑值，
        // 也不作为首样本播种；返回上一个可信航向（若有）或本次原始值（不存储）。
        guard isReliable(accuracyDegrees: accuracyDegrees) else {
            return smoothed ?? normalize(headingDegrees)
        }
        let new = normalize(headingDegrees)
        guard let s = smoothed else {
            smoothed = new
            return new
        }
        let sr = s * .pi / 180
        let nr = new * .pi / 180
        let x = (1 - smoothingFactor) * cos(sr) + smoothingFactor * cos(nr)
        let y = (1 - smoothingFactor) * sin(sr) + smoothingFactor * sin(nr)
        var deg = atan2(y, x) * 180 / .pi
        if deg < 0 { deg += 360 }
        smoothed = deg
        return deg
    }

    /// 航向是否可信。CLHeading 用负 `headingAccuracy` 表示无效/受干扰。委托静态实现，用本实例自己的上限。
    public func isReliable(accuracyDegrees: Double) -> Bool {
        Self.isReliable(accuracyDegrees: accuracyDegrees, maxTrusted: maxTrustedAccuracyDegrees)
    }

    public var current: Double? { smoothed }

    private func normalize(_ d: Double) -> Double {
        let m = d.truncatingRemainder(dividingBy: 360)
        return m < 0 ? m + 360 : m
    }
}
