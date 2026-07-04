import Foundation

/// 人民币纸币面额判定（纯逻辑，可单测）：OCR 文本 + 票面主色 → 面额 + 置信度。
/// Seeing AI / Lookout 均有"识币"频道；这里用端侧 OCR（角号数字/中文大写）+ 第五套人民币票面主色
/// 双信号实现，零云端。对标 P2 痛点"少说但说对"：双信号一致才报确定，单信号或冲突只报"可能"，无信号不猜。
public struct CurrencyClassifier: Sendable {
    public struct Result: Equatable, Sendable {
        public let denomination: Int   // 面额（数值）
        public let jiao: Bool          // true=角（0.x 元），false=元——防"5角"被误报成"5元"（10 倍钱数错误）
        public let confident: Bool     // false → 播报应带"可能"
        public init(denomination: Int, jiao: Bool = false, confident: Bool) {
            self.denomination = denomination
            self.jiao = jiao
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

    /// 中文大写"角"面额（第四套：伍角/贰角/壹角）。与元分开——防把 0.5 元的 5 角误当 5 元。
    static let capitalJiaoTokens: [(token: String, value: Int)] = [
        ("伍角", 5), ("贰角", 2), ("壹角", 1),
    ]

    /// 合法"角"面额白名单：只有 1/2/5 角。**必须与元支路的 hueRanges.keys 白名单对称**——否则 OCR 把
    /// 任意数字后误插一个"角"（相邻文字/水印）就会以 jiao 支路无门槛投票，把"100 角/20 角/3 角"这类**不存在
    /// 的面额**当确定结果播出（如把 100 元钞误报成"100 角"=10 元，正是本模块要防的 10 倍钱数错，见对抗复审 HIGH）。
    static let jiaoDenoms: Set<Int> = [1, 2, 5]

    /// texts：OCR 识别行；rgb：票面中央平均色（0...1，可为 nil）。无任何面额文字时返回 nil（纯颜色不猜——红衣服≠一百元）。
    /// 面额键：数值 + 单位（角/元分开，杜绝"5角"投给"5元"的 10 倍误报）。
    struct Denom: Hashable, Comparable {
        let value: Int; let jiao: Bool
        static func < (a: Denom, b: Denom) -> Bool {  // 元 > 角；同单位按数值——排序确定，平票取大面额侧
            a.jiao == b.jiao ? a.value < b.value : (a.jiao && !b.jiao)
        }
    }

    public func classify(texts: [String], rgb: (r: Double, g: Double, b: Double)?) -> Result? {
        var votes: [Denom: Int] = [:]
        for raw in texts {
            if let cap = Self.capitalDenomination(in: raw) { votes[Denom(value: cap, jiao: false), default: 0] += 1 }
            if let cj = Self.capitalJiao(in: raw) { votes[Denom(value: cj, jiao: true), default: 0] += 1 }
            for (v, isJiao) in Self.standaloneAmounts(in: raw) {
                if isJiao { if Self.jiaoDenoms.contains(v) { votes[Denom(value: v, jiao: true), default: 0] += 1 } } // 只认 1/2/5 角，堵住"100角"这类假面额
                else if Self.hueRanges.keys.contains(v) { votes[Denom(value: v, jiao: false), default: 0] += 1 }
            }
        }
        guard !votes.isEmpty else { return nil }

        // 票面主色信号：低饱和/过暗视为无颜色信号（白纸、灰桌面）。仅用于**元**面额确认，角无色相表。
        var hue: Double?
        if let rgb {
            let (h, s, v) = ColorNamer.rgbToHsv(rgb.r, rgb.g, rgb.b)
            if s >= 0.15, v >= 0.2 { hue = h }
        }
        func hueMatches(_ d: Denom) -> Bool {
            guard !d.jiao, let hue, let ranges = Self.hueRanges[d.value] else { return false }
            return ranges.contains { $0.contains(hue) }
        }

        let top = votes.values.max()!
        let leaders = votes.filter { $0.value == top }.keys.sorted()
        if leaders.count > 1 {
            // 平票冲突（如同帧扫到 100 和 50）：仅当主色恰好只支持其一时取它，且只敢说"可能"；否则放弃。
            let byHue = leaders.filter(hueMatches)
            guard byHue.count == 1 else { return nil }
            return Result(denomination: byHue[0].value, jiao: byHue[0].jiao, confident: false)
        }
        let leader = leaders[0]
        if hue != nil, !leader.jiao {
            return Result(denomination: leader.value, jiao: false, confident: hueMatches(leader))
        }
        // 无颜色信号（或角面额）：票面多处印同一面额，≥2 处一致已较可靠。
        return Result(denomination: leader.value, jiao: leader.jiao, confident: top >= 2)
    }

    /// 文本中的中文大写面额（按大面额优先，每段文本只取一个，防"伍拾圆"同时命中"拾圆"）。
    static func capitalDenomination(in text: String) -> Int? {
        for (token, value) in capitalTokens where text.contains(token) { return value }
        return nil
    }

    /// 文本中的中文大写"角"面额（伍角/贰角/壹角）。
    static func capitalJiao(in text: String) -> Int? {
        for (token, value) in capitalJiaoTokens where text.contains(token) { return value }
        return nil
    }

    /// 提取"独立"ASCII 数字串（两侧非数字），并标记其后是否跟"角"——防止 100 里的 10、年号 2015、
    /// 序列号误配，且**"5角"标记为 jiao、绝不投给 5 元**（10 倍钱数错误对盲人是严重误导）。
    static func standaloneAmounts(in text: String) -> [(value: Int, jiao: Bool)] {
        var result: [(value: Int, jiao: Bool)] = []
        let chars = Array(text)
        var i = 0
        while i < chars.count {
            guard chars[i].isASCII, chars[i].isNumber else { i += 1; continue }
            let runStart = i
            var current = ""
            while i < chars.count, chars[i].isASCII, chars[i].isNumber {
                current.append(chars[i]); i += 1
            }
            guard let v = Int(current) else { continue } // 溢出等：跳过（i 已越过该串，不会死循环）
            // 小数位（形如 "0.5" 的 "5"、"12.50" 的 "50"）：前面是"数字+."，是"零点几元"的小数部分而非独立面额。
            // 绝不当"元"投票（否则 "0.5" 被读成 "5 元"——10 倍钱数错误）；也不瞎猜角/分，直接跳过（无信号不猜）。
            // 只在"点前是数字"时才判小数——避免误伤冠字号 "No.100"（那个点前是字母，100 仍要投票）。
            if runStart >= 2, chars[runStart - 1] == ".", chars[runStart - 2].isASCII, chars[runStart - 2].isNumber {
                continue
            }
            // 其后是否跟"角"单位：**只**跳过 OCR 可能误插的空格，取第一个非空白字符判断——真钞把"5角"排得紧，
            // 但 OCR 常拆成 "5 角"，紧邻判据会把 5 角漏成 5 元。故跳空格；但**不跨越标点/符号**（见自审 #4）。
            let followedByJiao = (Self.firstNonSpace(chars, from: i) == "角")
            result.append((value: v, jiao: followedByJiao))
        }
        return result
    }

    /// 从 index 起**只跳过空白**，返回第一个非空白字符；无则 nil。
    /// 只跳空白（OCR 常在数字与"角"间插空格 "5 角"），**不跨越标点/符号**——否则 "5" 与很远处的一个"角"会被错配成
    /// 5 角（把 5 元误报成 5 角，同样是钱数错误、只是反向）。有界扫描，杜绝"隔着一串标点吸附远处的角"。
    static func firstNonSpace(_ chars: [Character], from index: Int) -> Character? {
        var j = index
        while j < chars.count {
            if !chars[j].isWhitespace { return chars[j] }
            j += 1
        }
        return nil
    }
}
