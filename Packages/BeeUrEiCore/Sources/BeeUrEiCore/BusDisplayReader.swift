import Foundation

/// 公交/电车车头牌 OCR 行挑选（纯逻辑，可单测）。OKO 的"公交识别"场景：多辆车同时进站，
/// 盲人需要确认"来的是不是我要坐的那班"。OCR 会混入车身广告/电话等杂讯，这里挑出最像
/// "线路号/终点站"的行：线路号 = 含**阿拉伯数字**的短行（"103"、"B12"、"103路"）优先；
/// 终点站 = 不含阿拉伯数字的行按长度取最长；含长数字串（≥8 连续数字）的行视为电话/编号，整行丢弃。
///
/// ⚠️ "数字"一律指**阿拉伯数字**（ch.isASCII && ch.isNumber），不含中文数字一二三…百。
/// Swift 的 `Character.isNumber` 对中文数字也为 true——若用它当"含数字"判据，含中文数字的
/// 中文终点站（"开往二七广场火车站"、"二环"、"三里屯"极常见）会被踢出终点站列表：>8 字被整行
/// 丢弃、盲人只听到杂字，短的则被误塞进线路号列表打乱顺序。两个 filter 必须用**同一**谓词以保持
/// 互补划分（只改一个会让含中文数字的行既进 routes 又进 destinations，被重复播报）。
public enum BusDisplayReader {
    public static func pick(texts: [String], maxItems: Int = 2) -> [String] {
        let cleaned = texts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && longestDigitRun(in: $0) < 8 }
        var seen = Set<String>()
        let unique = cleaned.filter { seen.insert($0).inserted }
        let routes = unique.filter { $0.count <= 8 && $0.contains(where: isAsciiDigit) }
        let destinations = unique.filter { !$0.contains(where: isAsciiDigit) }
            .sorted { $0.count > $1.count }
        return Array((routes + destinations).prefix(maxItems))
    }

    /// 到站信息（LED 报站牌）：盲人在站台最想知道"我的车还有多久到"。从 OCR 行提取到站提示——
    /// **即将到站 / 还有约 N 分钟 / 还有 N 站**（即将 > 分钟 > 站 优先）。仅认阿拉伯数字（与 pick 同口径；
    /// 中文数字属地名）。多线路牌只取最显著的一条（关联到具体线路留待后续）；无任何到站信号返回 nil。
    public static func arrivalHint(texts: [String], language: Language) -> String? {
        let zh = language == .zh
        var minutes: Int?
        var stops: Int?
        var imminent = false
        for raw in texts {
            let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            let lower = t.lowercased()
            // 即将到站类（无需数字）：中文"即将/进站"，英文 arriving/approaching/due。
            if t.contains("即将") || t.contains("进站") || lower.contains("arriv") || lower.contains("approach") || lower.contains(" due") || lower == "due" {
                imminent = true
            }
            if minutes == nil, let n = numberBefore(units: ["分钟", "min"], in: lower) { minutes = n }
            if stops == nil, let n = numberBefore(units: ["站", "stop"], in: lower) { stops = n }
        }
        // 倒计时读到 0（"0分钟"/"0 min"/"0站"）= 车已到站——必须当即将到站播报，绝不能因 ≥1 门槛回落成 nil
        // 让站台上的盲人对已进站的车毫无提示（会错过车/以为还早）。
        if imminent || minutes == 0 || stops == 0 { return zh ? "即将到站" : "arriving now" }
        if let m = minutes, m >= 1, m < 120 { return zh ? "还有约\(m)分钟" : "about \(m) min" }
        if let s = stops, s >= 1, s < 100 { return zh ? "还有\(s)站" : "\(s) stops away" }
        return nil
    }

    /// 找到紧跟在某单位（分钟/站/min/stop…，允许中间一个空格）之前的阿拉伯数字，如 "3分钟"→3、"5 min"→5。
    /// 从单位处**向前**读连续 ascii 数字——单位前非数字（如"火车站"的"车"）自然不匹配，故 CJK 地名不会误触。
    static func numberBefore(units: [String], in lower: String) -> Int? {
        for unit in units {
            var range = lower.startIndex..<lower.endIndex
            while let r = lower.range(of: unit, range: range) {
                var idx = r.lowerBound
                if idx > lower.startIndex, lower[lower.index(before: idx)] == " " { idx = lower.index(before: idx) } // 容一个空格
                var digits = ""
                while idx > lower.startIndex {
                    let p = lower.index(before: idx)
                    let c = lower[p]
                    guard c.isASCII, c.isNumber else { break }
                    digits.insert(c, at: digits.startIndex); idx = p
                }
                if let n = Int(digits) { return n }
                range = r.upperBound..<lower.endIndex
            }
        }
        return nil
    }

    /// 阿拉伯数字判定。**不含**中文数字（一二三…十百）——中文数字是地名/终点站文本的一部分，
    /// 不是线路号信号。与 longestDigitRun 的电话号识别口径一致。
    static func isAsciiDigit(_ ch: Character) -> Bool { ch.isASCII && ch.isNumber }

    /// 最长连续阿拉伯数字串长度（≥8 视为电话/序列号杂讯）。
    static func longestDigitRun(in text: String) -> Int {
        var best = 0, current = 0
        for ch in text {
            if isAsciiDigit(ch) {
                current += 1
                best = max(best, current)
            } else {
                current = 0
            }
        }
        return best
    }
}
