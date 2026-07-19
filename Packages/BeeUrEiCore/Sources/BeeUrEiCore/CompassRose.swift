import Foundation

/// 罗盘方位（纯逻辑，可单测）：方位角（度，0=正北，顺时针）→ 八方位名称（双语）。
/// 盲人看不到罗盘/太阳，"我正朝哪个方向"是建立心理地图与找路的基础（对标 BlindSquare / Soundscape 的朝向播报）。
public enum CompassRose {
    /// 八方位名称。**非有限（NaN/∞，坏罗盘或坏坐标算出的方位）返回 nil**——绝不 `Int(非有限 Double)` 崩溃
    /// （历史坑：`Int(Double.nan)` 会陷阱崩溃；本仓在温度/时钟等处均先 isFinite 守卫，唯方位命名曾漏）。
    public static func cardinal(degrees: Double, language: Language) -> String? {
        guard degrees.isFinite else { return nil }
        let names = language == .zh
            ? ["正北", "东北", "正东", "东南", "正南", "西南", "正西", "西北"]
            : ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
        // 归一到 [0,360) 后 +22.5 偏移，使每 45° 扇区以正方位为中心（如 [337.5,22.5)→正北）。
        let normalized = (degrees.truncatingRemainder(dividingBy: 360) + 360 + 22.5).truncatingRemainder(dividingBy: 360)
        let idx = min(Int(normalized / 45), 7) // 归一后必 <8；min 兜底浮点边界
        return names[idx]
    }

    /// 「我朝哪个方向」的**可信**播报：仅当罗盘精度可信（`accuracyDegrees` 在 HeadingFilter 阈值内，默认 ≤20°）
    /// 且航向有限时返回八方位名；否则返回 nil。八方位每档 45°，>20° 误差足以整档报错——对盲人是危险的方向误导，
    /// 故不可信时宁可不报（调用方据 nil 继续等可信读数，久无则播"画 8 字校准"指引），与导航信标同一门槛（单一事实源）。
    public static func reliableCardinal(degrees: Double, accuracyDegrees: Double, language: Language) -> String? {
        guard HeadingFilter.isReliable(accuracyDegrees: accuracyDegrees) else { return nil }
        return cardinal(degrees: degrees, language: language)
    }
}
