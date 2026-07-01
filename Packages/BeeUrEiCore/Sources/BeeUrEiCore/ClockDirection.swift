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
        self.hour = ClockDirection.hour(fromAngle: angle)
    }

    /// 从（已平滑的）水平角直接构造，用于平滑后的方位。
    public init(angleDegrees: Double) {
        guard angleDegrees.isFinite else {
            self.angleDegrees = 0
            self.hour = 12
            return
        }
        self.angleDegrees = angleDegrees
        self.hour = ClockDirection.hour(fromAngle: angleDegrees)
    }

    /// 由水平角求钟点(1...12)。**先对 360 取余**：`Int(...)` 对巨大有限角（如异常相机 FOV 或平滑
    /// 毛刺）会因超出 Int 范围而**溢出陷阱崩溃**，而 `.isFinite` 只挡 NaN/∞、挡不住量级。
    /// 钟点本就周期性，取余等价且安全。每个钟点 = 30°；0°→12 点，+30°→1 点，-30°→11 点。
    private static func hour(fromAngle angle: Double) -> Int {
        let periodic = angle.truncatingRemainder(dividingBy: 360) // ∈ (-360, 360) → offset ∈ [-12, 12]，不溢出
        let offset = Int((periodic / 30).rounded())
        return ((12 + offset - 1) % 12 + 12) % 12 + 1
    }

    /// 中文播报用的方向短语，如「12 点钟方向」（默认中文，向后兼容）。
    public var spokenPhrase: String { spokenPhrase(in: .zh) }

    /// 方向短语（语言可选），如「12 点钟方向」/「12 o'clock」。
    public func spokenPhrase(in language: Language) -> String {
        SpokenStrings.clockDirection(hour: hour, language)
    }

    /// 简短方向词（默认中文，向后兼容）：前方扇区用左前/正前/右前，两侧用左/右。
    public var coarsePhrase: String { coarsePhrase(in: .zh) }

    /// 简短方向词（语言可选）。
    public func coarsePhrase(in language: Language) -> String {
        SpokenStrings.coarseDirection(hour: hour, language)
    }
}
