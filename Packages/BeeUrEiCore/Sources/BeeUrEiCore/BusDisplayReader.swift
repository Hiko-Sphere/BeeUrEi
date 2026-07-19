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
        let routes = unique.filter { $0.count <= 8 && $0.contains(where: isAsciiDigit) } // 短数字行=线路号，最优先
        let destinations = unique.filter { !$0.contains(where: isAsciiDigit) }
            .sorted { $0.count > $1.count }
        // 含数字的**长行**（路线+方向印在同一行，如"103路开往火车站"/"Route 103 to Downtown"）：既 >8 字非纯线路号、
        // 又因含数字被终点站过滤排除——此前落入两 filter 之间**整行丢弃**，盲人对这班车零信息（scan 到最有用的那行反而没读出）。
        // 已过电话/序列号过滤(longestDigitRun<8)故非杂讯。作**兜底 tier**：仅在纯线路号/终点站填不满 maxItems 时补上，
        // 正常"线路号+终点各一行"时不触及（不加噪）。三谓词互斥（≤8∧digit / no-digit / >8∧digit），仍是无重叠划分。
        let mixed = unique.filter { $0.count > 8 && $0.contains(where: isAsciiDigit) }
        return Array((routes + destinations + mixed).prefix(maxItems))
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
            // 中文即将到站：即将 / 进站 / **已到站**（车已抵达）。"已到站"补齐与英文动词 arrived 对称的"已抵达"信号——
            // 此前中文只认"即将/进站"，漏了直白的"已到站"。**只收带"已"的形式**：裸"到站"是名词歧义
            // （"距到站还有3分钟"/"到站时间"里 到站=名词，误判会把"还有3分钟"压成假"车到了"、让盲人提前迈向路缘，安全攸关），
            // 而"已到站"里"已"恒为完成体动词标记、不构成名词头（无"已到站时间"这类词），故高精度零误报。
            // 繁体变体（台港澳/进口牌，OCRLanguagePolicy 已加 zh-Hant，Vision 会如实产出繁体字）：即將(將≠将)、
            // 進站(進≠进) 与简体不同码点，不补则繁体 LED"即將進站"匹配不到、当地盲人漏判到站。已到站(已到站简繁同形)已覆盖。
            if t.contains("即将") || t.contains("即將") || t.contains("进站") || t.contains("進站") || t.contains("已到站") || hasArriveVerb || lower.contains("approach") || lower.contains(" due") || lower == "due" {
                imminent = true
            }
            if minutes == nil, let n = firstNumber(minutesRegexes, in: lower) { minutes = n }
            if stops == nil, let n = firstNumber(stopsRegexes, in: lower) { stops = n }
        }
        // 倒计时读到 0（"0分钟"/"0 min"/"0站"）= 车已到站——必须当即将到站播报，绝不能因 ≥1 门槛回落成 nil
        // 让站台上的盲人对已进站的车毫无提示（会错过车/以为还早）。
        if imminent || minutes == 0 || stops == 0 { return zh ? "即将到站" : "arriving now" }
        if let m = minutes, m >= 1, m < 120 { return zh ? "还有约\(m)分钟" : "about \(m) min" }
        if let s = stops, s >= 1, s < 100 { return zh ? "还有\(s)站" : "\(s) stop\(s == 1 ? "" : "s") away" } // 1 站用单数 stop（"1 stops away" 语病）
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
        "([0-9]+)\\s*分鐘",   // 繁体：鐘≠钟，繁体牌"5分鐘"不补则漏（台港澳/进口，OCR 已产繁体字）
        "([0-9]+)\\s*(?:minutes?|mins?)(?![a-z])",
    ].compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    private static let stopsRegexes: [NSRegularExpression] = [
        "([0-9]+)\\s*站(?![台臺])",   // (?![台臺])：排除站台/月台(简)与站臺(繁 臺≠台)——"2站臺"(Platform 2)不得误读成"还有2站"
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
