import Foundation

/// 人民币纸币面额判定（纯逻辑，可单测）：OCR 文本 + 票面主色 → 面额 + 置信度。
/// Seeing AI / Lookout 均有"识币"频道；这里用端侧 OCR（角号数字/中文大写）+ 第五套人民币票面主色
/// 双信号实现，零云端。对标 P2 痛点"少说但说对"：双信号一致才报确定，单信号或冲突只报"可能"，无信号不猜。
public struct CurrencyClassifier: Sendable {
    public struct Result: Equatable, Sendable {
        public let denomination: Int   // 面额（元）
        public let confident: Bool     // false → 播报应带"可能"
        public init(denomination: Int, confident: Bool) {
            self.denomination = denomination
            self.confident = confident
        }
    }

    public init() {}

    /// 第五套人民币票面主色（HSV 色相区间，度）：100 红、50 绿、20 棕黄、10 蓝、5 紫、1 黄绿。
    static let hueRanges: [Int: [ClosedRange<Double>]] = [
        100: [0.0...25.0, 330.0...360.0],
        50:  [70.0...165.0],
        20:  [15.0...55.0],
        10:  [195.0...255.0],
        5:   [255.0...315.0],
        1:   [60.0...165.0],
    ]

    /// 中文大写面额（票面"壹佰圆"等冠字）。按大面额优先匹配——"伍拾圆"含子串"拾圆"，不能误判 10。
    static let capitalTokens: [(token: String, value: Int)] = [
        ("壹佰", 100), ("伍拾", 50), ("贰拾", 20),
        ("拾圆", 10), ("拾元", 10), ("伍圆", 5), ("伍元", 5), ("壹圆", 1), ("壹元", 1),
    ]

    /// texts：OCR 识别行；rgb：票面中央平均色（0...1，可为 nil）。无任何面额文字时返回 nil（纯颜色不猜——红衣服≠一百元）。
    public func classify(texts: [String], rgb: (r: Double, g: Double, b: Double)?) -> Result? {
        var votes: [Int: Int] = [:]
        for raw in texts {
            if let cap = Self.capitalDenomination(in: raw) { votes[cap, default: 0] += 1 }
            for v in Self.standaloneNumbers(in: raw) where Self.hueRanges.keys.contains(v) {
                votes[v, default: 0] += 1
            }
        }
        guard !votes.isEmpty else { return nil }

        // 票面主色信号：低饱和/过暗视为无颜色信号（白纸、灰桌面）。
        var hue: Double?
        if let rgb {
            let (h, s, v) = ColorNamer.rgbToHsv(rgb.r, rgb.g, rgb.b)
            if s >= 0.15, v >= 0.2 { hue = h }
        }
        func hueMatches(_ denom: Int) -> Bool {
            guard let hue, let ranges = Self.hueRanges[denom] else { return false }
            return ranges.contains { $0.contains(hue) }
        }

        let top = votes.values.max()!
        let leaders = votes.filter { $0.value == top }.keys.sorted()
        if leaders.count > 1 {
            // 平票冲突（如同帧扫到 100 和 50）：仅当主色恰好只支持其一时取它，且只敢说"可能"；否则放弃。
            let byHue = leaders.filter(hueMatches)
            guard byHue.count == 1 else { return nil }
            return Result(denomination: byHue[0], confident: false)
        }
        let leader = leaders[0]
        if hue != nil {
            return Result(denomination: leader, confident: hueMatches(leader))
        }
        // 无颜色信号：票面角号多处印同一面额，≥2 处一致已较可靠。
        return Result(denomination: leader, confident: top >= 2)
    }

    /// 文本中的中文大写面额（按大面额优先，每段文本只取一个，防"伍拾圆"同时命中"拾圆"）。
    static func capitalDenomination(in text: String) -> Int? {
        for (token, value) in capitalTokens where text.contains(token) { return value }
        return nil
    }

    /// 提取"独立"ASCII 数字串（两侧非数字），防止 100 里的 10、年号 2015、序列号误配。
    static func standaloneNumbers(in text: String) -> [Int] {
        var result: [Int] = []
        var current = ""
        for ch in text + " " { // 尾部哨兵冲洗最后一段
            if ch.isASCII && ch.isNumber {
                current.append(ch)
            } else {
                if !current.isEmpty, let v = Int(current) { result.append(v) }
                current = ""
            }
        }
        return result
    }
}
