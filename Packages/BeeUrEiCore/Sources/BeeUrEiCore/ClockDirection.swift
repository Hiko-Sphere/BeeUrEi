import Foundation

/// 「几点钟方向」计算（见 docs/PLAN.md §7.2）。
///
/// 定义：相对「手机背面摄像头朝向」的水平角。12 点=正前方（画面中央），
/// 3 点=正右，9 点=正左。仅用相机视野内的横向位置计算，不用 CLHeading。
public struct ClockDirection: Equatable, Sendable {
    /// 相对正前方的水平角（度），右为正。
    public let angleDegrees: Double
    /// 时钟点：1...12。
    public let hour: Int

    /// - Parameters:
    ///   - normalizedX: 检测框中心的归一化横坐标，0=最左，0.5=中央，1=最右。
    ///   - horizontalFOVDegrees: 相机水平视场角（后置广角约 60–70°）。
    public init(normalizedX: Double, horizontalFOVDegrees: Double) {
        // 防护：视觉模型异常帧可能产生 NaN/∞；min/max 不会消除 NaN，
        // 后面的 Int(...) 对非有限值会崩溃。非有限输入退化为「正前方/12 点」。
        guard normalizedX.isFinite, horizontalFOVDegrees.isFinite else {
            self.angleDegrees = 0
            self.hour = 12
            return
        }
        let clampedX = min(max(normalizedX, 0), 1)
        let angle = (clampedX - 0.5) * horizontalFOVDegrees
        self.angleDegrees = angle

        // 每个钟点 = 30°；0°→12 点，+30°→1 点，-30°→11 点。
        let offset = Int((angle / 30).rounded())
        self.hour = ((12 + offset - 1) % 12 + 12) % 12 + 1
    }

    /// 中文播报用的方向短语，如「12 点钟方向」。
    public var spokenPhrase: String { "\(hour) 点钟方向" }
}
