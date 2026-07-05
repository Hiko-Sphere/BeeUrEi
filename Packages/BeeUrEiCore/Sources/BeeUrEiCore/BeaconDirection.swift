import Foundation

/// 导航空间音「信标」方向（见 docs/PLAN.md §7.2 / 参考 Soundscape）。
/// 由「用户航向」与「到目的地/下一点的方位」算出相对方位角，驱动空间音把方向「挂」到该方位。
public struct BeaconDirection: Sendable, Equatable {
    /// 相对用户正前方的方位角，右为正，范围 -180...180。
    public let relativeAzimuthDegrees: Double
    /// 时钟点 1...12。
    public let clockHour: Int

    public init(headingDegrees: Double, bearingDegrees: Double) {
        // 防护：CLHeading 在未校准/磁干扰时可能为非有限值；非有限输入退化为「正前方/12 点」。
        // 调用方仍应优先用 HeadingFilter.isReliable 在罗盘不可信时直接抑制信标。
        guard headingDegrees.isFinite, bearingDegrees.isFinite else {
            self.relativeAzimuthDegrees = 0
            self.clockHour = 12
            return
        }
        var rel = (bearingDegrees - headingDegrees).truncatingRemainder(dividingBy: 360)
        if rel > 180 { rel -= 360 }
        if rel < -180 { rel += 360 }
        self.relativeAzimuthDegrees = rel

        let offset = Int((rel / 30).rounded())
        self.clockHour = ((12 + offset - 1) % 12 + 12) % 12 + 1
    }

    /// 中文播报短语（默认中文，向后兼容）。
    public var spokenPhrase: String { spokenPhrase(in: .zh) }

    /// 播报短语（语言可选），与 ClockDirection 同口径：「3 点钟方向」/「3 o'clock」。
    public func spokenPhrase(in language: Language) -> String {
        SpokenStrings.clockDirection(hour: clockHour, language)
    }

    /// 用「身体航向 + 头部偏航」作为朝向计算信标相对方位（AirPods 头追踪增强，见 PLAN §14 Q8）。
    /// 无头追踪时传 headYawDegrees=0 即退化为纯身体航向。
    public static func relative(headingDegrees: Double, headYawDegrees: Double, bearingDegrees: Double) -> BeaconDirection {
        // 头部偏航非有限（AirPods 追踪掉帧/未校准）绝不能污染整体朝向：`heading + NaN = NaN` 会被 init 兜成
        // 「正前方/12 点」，把本来有效的身体航向方向丢掉、信标错指正前方。坏 yaw 退化为 0（纯身体航向）才对。
        let yaw = headYawDegrees.isFinite ? headYawDegrees : 0
        return BeaconDirection(headingDegrees: headingDegrees + yaw, bearingDegrees: bearingDegrees)
    }
}
