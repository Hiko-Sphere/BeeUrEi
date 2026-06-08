import Foundation

/// 颜色命名（纯逻辑，可单测）：RGB(0...1) → 中文颜色名。盲人常需知道衣物/物品颜色。
/// 用 HSV 分桶：低饱和→白/灰/黑；橙色相低明度→棕；其余按色相命名。
public struct ColorNamer: Sendable {
    public init() {}

    public func name(r: Double, g: Double, b: Double) -> String {
        let (h, s, v) = Self.rgbToHsv(r, g, b)
        if v < 0.2 { return "黑色" }
        if s < 0.15 { return v > 0.8 ? "白色" : "灰色" }
        if h >= 20 && h < 50 && v < 0.6 { return "棕色" }
        switch h {
        case 0..<15, 345..<360: return "红色"
        case 15..<50:  return "橙色"
        case 50..<70:  return "黄色"
        case 70..<160: return "绿色"
        case 160..<200: return "青色"
        case 200..<255: return "蓝色"
        case 255..<290: return "紫色"
        case 290..<345: return "粉色"
        default: return "未知颜色"
        }
    }

    static func rgbToHsv(_ r: Double, _ g: Double, _ b: Double) -> (h: Double, s: Double, v: Double) {
        let maxc = max(r, max(g, b))
        let minc = min(r, min(g, b))
        let delta = maxc - minc
        let v = maxc
        let s = maxc == 0 ? 0 : delta / maxc
        var h = 0.0
        if delta != 0 {
            if maxc == r { h = 60 * (((g - b) / delta).truncatingRemainder(dividingBy: 6)) }
            else if maxc == g { h = 60 * ((b - r) / delta + 2) }
            else { h = 60 * ((r - g) / delta + 4) }
        }
        if h < 0 { h += 360 }
        return (h, s, v)
    }
}
