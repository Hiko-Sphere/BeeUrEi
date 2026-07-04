import Foundation

/// 包装日期识别（纯逻辑，可单测）：从 OCR 行里挑出带**日期标签**（保质期/生产日期/有效期/EXP/best before…）
/// 且含**日期样式**的行，**原样surface**给盲人。盲人看不到食品/药品上的日期，这是高频刚需（对标 Seeing AI 产品频道）。
///
/// 安全红线：**绝不做日期运算、绝不判"是否过期"、绝不区分生产/保质谁是谁**——把印在包装上的日期文本连同其标签
/// 如实读出，判断交给用户（误判"没过期"会让盲人吃过期食品/药，代价太高）。始终附"请核对"。
/// **关键字门控**（行里既要有日期标签、又要有日期样式）保证高精度：流水号/条码等无标签的数字串不会被误读成日期。
public enum LabelDateReader {
    /// 日期标签关键字（中/英）。中文/多词/长英文词按子串匹配即可（够specific）。
    static let labels: [String] = [
        "保质期", "有效期", "到期", "保存期", "生产日期", "此日期前", "食用日期", "限期", "赏味期",
        "best before", "best by", "use by", "expiry", "expires", "manufactured", "sell by", "production date",
    ]

    /// 短英文缩写标签（exp/mfg）须**词边界**：它们是别的词的子串——exp ⊂ export/express/expo/expensive，
    /// 若按子串匹配，"Express delivery July 2026"/"Export lot 2026-01" 会被误当"有效期日期"读给盲人。
    /// 边界用 `(?<![a-z]) … (?![a-z])`：前后不许字母，但**允许数字/句点/空格**——喷码 "EXP20261130"、
    /// "EXP." 等真标签仍命中。大小写不敏感。
    private static let boundedLabelRegexes: [NSRegularExpression] = ["exp", "mfg"].compactMap {
        try? NSRegularExpression(pattern: "(?<![a-z])" + $0 + "(?![a-z])", options: [.caseInsensitive])
    }

    /// 行内是否含日期标签：长/中文/多词标签按子串；短缩写（exp/mfg）按词边界（防子串误配）。
    static func hasDateLabel(_ lower: String) -> Bool {
        if labels.contains(where: { lower.contains($0) }) { return true }
        let r = NSRange(lower.startIndex..., in: lower)
        return boundedLabelRegexes.contains { $0.firstMatch(in: lower, range: r) != nil }
    }

    /// 日期样式（ASCII 数字，避免 CJK 数字误配）：年(19/20xx)+分隔、d/m/yy(yy)、m/yyyy，
    /// 以及**无分隔/空格分隔的喷码**（食品药品包装最常见的批次喷码写法）。
    private static let dateRegexes: [NSRegularExpression] = {
        let numeric = [
            "(?:19|20)[0-9]{2}\\s*[.\\-/年]",                       // 2026./2026-/2026年（后接月日或止于年）
            "[0-9]{1,2}[./][0-9]{1,2}[./](?:19|20)?[0-9]{2}",       // 15/07/2026、15/07/26
            "[0-9]{1,2}[./](?:19|20)[0-9]{2}",                     // 07/2026
            // 紧凑无分隔 YYYYMMDD（如 20260731）：食品/药品喷码最常见却此前完全漏识。前后**数字边界**
            // (?<![0-9])/(?!​[0-9]) 防止把 13 位条码/长流水号里的一段误当日期；年份仍锁 19/20、月 01-1x、日 0-3x。
            "(?<![0-9])(?:19|20)[0-9]{2}[01][0-9][0-3][0-9](?![0-9])",
            // 空格分隔 2026 07 / 2026 07 31（喷码另一常见写法）：须年后紧跟 2 位月，"2026 出厂"类不误配。
            "(?<![0-9])(?:19|20)[0-9]{2}\\s+[01][0-9](?:\\s+[0-3][0-9])?(?![0-9])",
        ]
        // 英文月份名日期（进口食品/药品最常见：BEST BEFORE JUL 2026 / EXP DEC 2025 / 31 JUL 2026 /
        // July 31, 2026）——此前纯数字正则**完全漏识**。月份名是强信号，配合上面「同行须有日期标签」
        // 的门控，精度依旧高。全名在缩写前（交替优先匹配长者）；大小写不敏感。
        let month = "(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)"
        let monthNamed = [
            // 月[日]年：JUL 2026 / JUL 31 2026 / JUL 31, 2026 / December 2025
            "\\b" + month + "\\.?\\s+(?:[0-9]{1,2}(?:st|nd|rd|th)?,?\\s+)?(?:19|20)[0-9]{2}\\b",
            // 日月年：31 JUL 2026 / 31st July, 2026
            "\\b[0-9]{1,2}(?:st|nd|rd|th)?\\s+" + month + "\\.?,?\\s+(?:19|20)[0-9]{2}\\b",
        ]
        return numeric.compactMap { try? NSRegularExpression(pattern: $0) }
            + monthNamed.compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    }()

    static func lineHasDate(_ line: String) -> Bool {
        let r = NSRange(line.startIndex..., in: line)
        return dateRegexes.contains { $0.firstMatch(in: line, range: r) != nil }
    }

    /// 返回一句可播报的日期信息（原样文本 + "请核对"），无符合的行返回 nil（不猜）。
    public static func find(texts: [String], language: Language) -> String? {
        var seen = Set<String>()
        var hits: [String] = []
        for raw in texts {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty else { continue }
            let lower = line.lowercased()
            guard hasDateLabel(lower), lineHasDate(line) else { continue }
            guard seen.insert(line).inserted else { continue } // 去重（OCR 常重复同一行）
            hits.append(line)
            if hits.count >= 3 { break } // 至多 3 条，避免长包装刷屏
        }
        guard !hits.isEmpty else { return nil }
        let joined = hits.joined(separator: language == .zh ? "；" : "; ")
        return language == .zh ? "识别到日期信息，请核对：\(joined)" : "Detected date info, please verify: \(joined)"
    }
}
