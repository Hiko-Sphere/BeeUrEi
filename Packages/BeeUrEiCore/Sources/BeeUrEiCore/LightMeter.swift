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
        // 坏亮度读数（NaN/∞——空像素缓冲/相机启停瞬间等算出的非有限值）：保守判「暗」，绝不落到 .ok 谎报
        // "光线充足"。本模块的职责就是在光线不足时提醒——坏读数应促使用户"到亮处重试"（无害且有用），
        // 而非放行去扫却失败。同 CompassRose(非有限→nil)/WeatherPhrase(→"未知")/brighterSide(→.even) 的坏数据守卫，
        // 唯 level 曾漏。（.ok 时 warning 返回 nil＝不提醒，正是最不该给坏读数的结果。）
        guard brightness.isFinite else { return .dark }
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

    /// 光线探测播报："光线充足" / "光线很暗，亮的方向在左边" / "光线很暗，没有明显更亮的方向"。
    public func description(brightness: Double, brighterSide side: Side, language: Language = .zh) -> String {
        let lvl = level(brightness: brightness)
        var text = SpokenStrings.lightLevel(lvl, language)
        switch side {
        case .left: text += SpokenStrings.lightBrighter(left: true, language)
        case .right: text += SpokenStrings.lightBrighter(left: false, language)
        case .even:
            // 四周很暗且左右均衡（无明显更亮一侧）：找光模式下明确告知"没有更亮的方向"，用户据此换个地方找，而非
            // 干等一个不会来的方向指引。**仅 .dark 才说**——.dark(均值 <暗阈)意味四周确实都很暗（真有明显光源均值不会
            // 这么低，断言安全）；.dim 可能是正前方小光源使左右均衡、误报"没方向"，故不加；.ok 本身已足够、无需。
            if lvl == .dark { text += SpokenStrings.lightNoBrighterDirection(language) }
        }
        return text
    }

    /// Rec.601 亮度。
    public static func luminance(r: Double, g: Double, b: Double) -> Double {
        0.299 * r + 0.587 * g + 0.114 * b
    }
}
