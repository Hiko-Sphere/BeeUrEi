import Foundation

/// 颜色命名（纯逻辑，可单测）：RGB(0...1) → 颜色名。盲人常需知道衣物/物品颜色。
/// 用 HSV 分桶：低饱和→白/灰/黑；橙色相低明度→棕；其余按色相命名。语言可选（默认中文）。
public struct ColorNamer: Sendable {
    public init() {}

    public func name(r: Double, g: Double, b: Double, language: Language = .zh) -> String {
        SpokenStrings.color(key(r: r, g: g, b: b), language)
    }

    /// 颜色深浅。仅对**彩色**生效；黑/白/灰/棕/未知恒 normal（它们本身已含明暗信息）。
    public enum ColorTone: Sendable, Equatable { case dark, normal, light }

    /// 判定深浅（配衣服/比色刚需：海军蓝 vs 天蓝天差地别）。阈值以参考色标定：
    /// dark = 明度低（navy/深红/墨绿）；light = 明亮且不太饱和（天蓝/浅绿/浅黄）；其余 normal（纯色）。
    public func tone(r: Double, g: Double, b: Double) -> ColorTone {
        switch key(r: r, g: g, b: b) {
        case .black, .white, .gray, .brown, .unknown: return .normal // 已含明暗信息，不再加深/浅
        default: break
        }
        let (_, s, v) = Self.rgbToHsv(r, g, b)
        if v < 0.55 { return .dark }               // navy 0.50 / 深红 0.545 / 墨绿 0.39 皆入此
        if v >= 0.85, s < 0.5 { return .light }     // 天蓝(v.92,s.43)/浅绿(v.93,s.40)/浅黄；纯色 s 高不入
        return .normal
    }

    /// 带深浅的颜色名（如"深蓝色"/"浅绿色"；normal 时与 name 相同）。颜色功能应优先用它。
    public func describe(r: Double, g: Double, b: Double, language: Language = .zh) -> String {
        let base = name(r: r, g: g, b: b, language: language)
        switch tone(r: r, g: g, b: b) {
        case .normal: return base
        case .dark:   return SpokenStrings.tonePrefix(dark: true, language) + base
        case .light:  return SpokenStrings.tonePrefix(dark: false, language) + base
        }
    }

    /// 配色和谐度（盲人配衣服的**决策**需求：扫两件衣物，想知道"搭不搭"而不只是色名）。
    public enum ColorHarmony: Sendable, Equatable {
        case neutral   // 含中性色（黑/白/灰/棕）：百搭
        case similar   // 同色系/邻近色：协调
        case contrast  // 对比/互补色：撞色，醒目（看穿着意图）
        case caution   // 两个鲜艳色相隔尴尬角度：差异大，拿不准
    }

    /// 判定两色是否搭配（纯色彩理论，不做主观时尚裁断——措辞保守，caution 只建议"可问人"）。
    /// 规则：任一中性→百搭；否则按色相夹角——≤35°同/邻近系(协调)、≥150°近互补(撞色)、
    /// 中间角度**仅两个都鲜艳(s≥0.5)时**才判需谨慎（柔和/低饱和色相互包容，降级为协调）。
    public func harmony(r1: Double, g1: Double, b1: Double,
                        r2: Double, g2: Double, b2: Double) -> ColorHarmony {
        let neutrals: Set<SpokenStrings.ColorKey> = [.black, .white, .gray, .brown, .unknown]
        if neutrals.contains(key(r: r1, g: g1, b: b1)) || neutrals.contains(key(r: r2, g: g2, b: b2)) {
            return .neutral
        }
        let (h1, s1, _) = Self.rgbToHsv(r1, g1, b1)
        let (h2, s2, _) = Self.rgbToHsv(r2, g2, b2)
        let raw = abs(h1 - h2)
        let d = min(raw, 360 - raw) // 色相夹角 0…180
        if d <= 35 { return .similar }
        if d >= 150 { return .contrast }
        return (s1 >= 0.5 && s2 >= 0.5) ? .caution : .similar
    }

    /// 语言无关的颜色分桶键（供本地化与测试）。
    func key(r: Double, g: Double, b: Double) -> SpokenStrings.ColorKey {
        let (h, s, v) = Self.rgbToHsv(r, g, b)
        if v < 0.2 { return .black }
        if s < 0.15 { return v > 0.8 ? .white : .gray }
        if h >= 20 && h < 50 && v < 0.6 { return .brown }
        switch h {
        case 0..<15, 345..<360: return .red
        case 15..<50:  return .orange
        case 50..<70:  return .yellow
        case 70..<160: return .green
        case 160..<200: return .cyan
        case 200..<255: return .blue
        case 255..<290: return .purple
        case 290..<345: return .pink
        default: return .unknown
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
