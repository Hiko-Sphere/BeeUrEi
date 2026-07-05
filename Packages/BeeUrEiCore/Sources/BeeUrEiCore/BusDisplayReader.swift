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
            // 即将到站类（无需数字）：中文"即将/进站"，英文 arriving/arrives/approaching/due（**动词**才算即将到站）。
            // ⚠️ 用 `arriv(?!al)` 而非裸子串 "arriv"：名词 arrival/arrivals 是站牌标准词（"Arrivals"表头、
            // "Next arrival 5 min"），裸子串会把它们误当"即将到站"，从而**压掉真实的"还有5分钟"读数**——
            // 站台上的盲人被告知"车到了"而其实还有 5 分钟，可能提前迈向路缘（安全攸关）。同本文件 min⊂Mint、
            // 站⊂站台 的整词门控口径。lower 已小写，正则大小写无碍。
            let hasArriveVerb = lower.range(of: "arriv(?!al)", options: .regularExpression) != nil
            if t.contains("即将") || t.contains("进站") || hasArriveVerb || lower.contains("approach") || lower.contains(" due") || lower == "due" {
                imminent = true
            }
            if minutes == nil, let n = firstNumber(minutesRegexes, in: lower) { minutes = n }
            if stops == nil, let n = firstNumber(stopsRegexes, in: lower) { stops = n }
        }
        // 倒计时读到 0（"0分钟"/"0 min"/"0站"）= 车已到站——必须当即将到站播报，绝不能因 ≥1 门槛回落成 nil
        // 让站台上的盲人对已进站的车毫无提示（会错过车/以为还早）。
        if imminent || minutes == 0 || stops == 0 { return zh ? "即将到站" : "arriving now" }
        if let m = minutes, m >= 1, m < 120 { return zh ? "还有约\(m)分钟" : "about \(m) min" }
        if let s = stops, s >= 1, s < 100 { return zh ? "还有\(s)站" : "\(s) stops away" }
        return nil
    }

    /// 到站单位正则（阿拉伯数字紧跟单位，捕获数字）。**整词/边界门控**是关键：
    /// - 英文 min/stop 是别的词的子串——`(?![a-z])` 保证只认整词，不把 "5 Mint St"/"8 Minster Rd"/
    ///   "3 Ministry Ave"/"stopover" 里的数字误当到站时间（此前 substring 匹配会误报"约5分钟"）。
    /// - 中文"站"用 `(?!台)` 排除"站台"(月台)——"2站台"(Platform 2) 不能被误读成"还有2站"。
    /// - 中文"分钟"无需边界（"分钟后/分钟内"不受影响）。大小写不敏感。
    /// 数字须紧邻单位（容零或多个空格），故 CJK 地名（火车站的"车"、分钟寺的"往"）前无数字自然不匹配。
    private static let minutesRegexes: [NSRegularExpression] = [
        "([0-9]+)\\s*分钟",
        "([0-9]+)\\s*(?:minutes?|mins?)(?![a-z])",
    ].compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    private static let stopsRegexes: [NSRegularExpression] = [
        "([0-9]+)\\s*站(?!台)",
        "([0-9]+)\\s*stops?(?![a-z])",
    ].compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }

    /// 返回首个匹配的「单位前阿拉伯数字」，如 "还有3分钟"→3、"5 min"→5。多处出现取最左（"2站台 还有3站"
    /// 会跳过月台、命中真的"3站"）。无匹配返回 nil。
    static func firstNumber(_ regexes: [NSRegularExpression], in text: String) -> Int? {
        let range = NSRange(text.startIndex..., in: text)
        for re in regexes {
            guard let m = re.firstMatch(in: text, range: range),
                  let r = Range(m.range(at: 1), in: text), let n = Int(text[r]) else { continue }
            return n
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
