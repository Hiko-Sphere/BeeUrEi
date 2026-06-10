import Foundation

/// 光线评估（纯逻辑，可单测）：盲人看不见环境明暗，暗处识别/OCR 易失败却不知原因。
/// 由 iOS 适配层算画面平均亮度(luminance 0...1)传入。
public struct LightMeter: Sendable {
    public enum Level: Sendable { case dark, dim, ok }

    public let darkThreshold: Double
    public let dimThreshold: Double

    public init(darkThreshold: Double = 0.15, dimThreshold: Double = 0.3) {
        self.darkThreshold = darkThreshold
        self.dimThreshold = dimThreshold
    }

    public func level(brightness: Double) -> Level {
        if brightness < darkThreshold { return .dark }
        if brightness < dimThreshold { return .dim }
        return .ok
    }

    public func warning(brightness: Double, language: Language = .zh) -> String? {
        SpokenStrings.lightWarning(level(brightness: brightness), language)
    }

    // MARK: 光线探测频道（Seeing AI Light 式：报明暗等级 + 亮源方向，帮找窗户/灯/出口）

    public enum Side: Sendable, Equatable { case left, right, even }

    /// 画面左/右半区亮度对比 → 亮源方向。差值小于 minDelta 视为均匀（避免噪声方向乱跳）。
    public static func brighterSide(left: Double, right: Double, minDelta: Double = 0.08) -> Side {
        if left - right >= minDelta { return .left }
        if right - left >= minDelta { return .right }
        return .even
    }

    /// 光线探测播报："光线充足" / "光线很暗，亮的方向在左边"。
    public func description(brightness: Double, brighterSide side: Side, language: Language = .zh) -> String {
        var text = SpokenStrings.lightLevel(level(brightness: brightness), language)
        switch side {
        case .left: text += SpokenStrings.lightBrighter(left: true, language)
        case .right: text += SpokenStrings.lightBrighter(left: false, language)
        case .even: break
        }
        return text
    }

    /// Rec.601 亮度。
    public static func luminance(r: Double, g: Double, b: Double) -> Double {
        0.299 * r + 0.587 * g + 0.114 * b
    }
}
