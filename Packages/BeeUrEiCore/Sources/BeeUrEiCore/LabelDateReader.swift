import Foundation

/// 包装日期识别（纯逻辑，可单测）：从 OCR 行里挑出带**日期标签**（保质期/生产日期/有效期/EXP/best before…）
/// 且含**日期样式或保质时长**（"12个月"/"18 months"）的行，**原样surface**给盲人。盲人看不到食品/药品上的
/// 日期与保质期，这是高频刚需（对标 Seeing AI 产品频道）。
///
/// 安全红线：**绝不做日期运算、绝不判"是否过期"、绝不区分生产/保质谁是谁**——把印在包装上的日期文本连同其标签
/// 如实读出，判断交给用户（误判"没过期"会让盲人吃过期食品/药，代价太高）。始终附"请核对"。
/// **关键字门控**（行里既要有日期标签、又要有日期样式）保证高精度：流水号/条码等无标签的数字串不会被误读成日期。
public enum LabelDateReader {
    /// 日期标签关键字（中/英）。中文/多词/长英文词按子串匹配即可（够specific）。
    static let labels: [String] = [
        "保质期", "有效期", "到期", "保存期", "生产日期", "此日期前", "食用日期", "限期", "赏味期",
        // 有效日期/失效日期：药品/化妆品/食品极常见，但"有效期"**不是**"有效日期"的子串（有效**日**期断开连续），
        // 故须单列，否则整行被丢、盲人扫药盒读不出有效期（安全攸关）。
        "有效日期", "失效日期",
        // 出厂/包装/灌装日期：电子产品、包装食品（肉/菜）、瓶装饮料酒油极常见的生产类日期，与"生产日期"并列而非其子串，
        // 此前整行被丢——盲人扫这些包装拿不到出厂/包装/灌装日期（判新鲜度的安全刚需）。双门控（须同行有日期样式）故精度不降。
        "出厂日期", "包装日期", "灌装日期",
        // 保鲜期：生鲜/冷藏食品主流保质标注（"保鲜期7天"），与"保存期"并列**非其子串**（保鲜≠保存）；
        // 限用日期：化妆品（台湾/进口）标准"使用期限"写法，与"有效日期"并列**非其子串**（限用日期不含"限期"/"有效日期"）。
        // 盲人看不到化妆品/生鲜包装的期限，此前整行被丢——新鲜度/安全刚需。双门控（同行须有日期样式/时长）故精度不降。
        "保鲜期", "限用日期",
        // "manufacture"（非 "manufactured"）：兼收正式写法 "date of manufacture" 与 "manufactured"（后者含前者子串），
        // 此前只认 "manufactured"、漏了 "date of manufacture"。enjoy by：美式食品（乳制品/预制食品）常见"最佳食用"写法。
        "best before", "best by", "use by", "enjoy by", "expiry", "expires", "expiration", "manufacture", "sell by",
        "production date", "shelf life", "shelf-life", // shelf life=保质期、expiration(date)=美式常见有效期，此前完全不识
    ]

    /// 短英文缩写标签（exp/mfg/mfd/bb/bbe/bbd）须**词边界**：它们是别的词的子串——exp ⊂ export/express/expo，
    /// bb ⊂ rubber/hobby——若按子串匹配会误配。mfd = manufactured date（与 mfg=manufacturing 并列，进口食品药品常见）。
    /// bb/bbe/bbd = best before / best before end / best before date，
    /// 英国/欧盟/进口食品最主流的保质期缩写写法（"BB 15/03/2026"/"BBE JUL 2026"），此前只认全拼 "best before"、
    /// 缩写全漏。边界 `(?<![a-z]) … (?![a-z])`：前后不许字母，但允许数字/句点/空格——喷码 "EXP20261130"、
    /// "BB2026"、"BB." 仍命中。**同行须另有日期样式**的双重门控使 2 字母的 bb 也安全（无日期的 "BB 霜" 不会误报）。
    /// 大小写不敏感。
    private static let boundedLabelRegexes: [NSRegularExpression] = ["exp", "mfg", "mfd", "bbe", "bbd", "bb"].compactMap {
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
            "[0-9]{1,2}[.\\-/][0-9]{1,2}[.\\-/](?:19|20)?[0-9]{2}", // 15/07/2026、15-07-2026、31-07-26（分隔含连字符——药品/进口包装常用）
            "[0-9]{1,2}[.\\-/](?:19|20)[0-9]{2}",                  // 07/2026、07-2026
            // 月/2位年 MM/YY（药品/化妆品有效期的全球主流写法：EXP 07/26 / BB 12-26 / 07.26）：此前只认 4 位年
            // 的 MM/YYYY，2 位年全漏——而药盒读不出有效期是安全红线（见 testHyphenSeparatedDates 注）。安全约束：
            // **月锁 01-12**（防 50/50、24/7、16/9 等比例/分数误配）、年恰 2 位、前后**数字边界**（不吃 07/2026 的一段、
            // 不吃 15/07/26 里嵌套段——那些已被三段式/四位年正则命中，整行照样surface）。分隔含点/连字符/斜杠。
            "(?<![0-9])(?:0[1-9]|1[0-2])[.\\-/][0-9]{2}(?![0-9])",
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
        // 分隔符含**连字符**：药品/进口包装的月份名喷码极常见 JUL-2026 / 31-JUL-2026 / DEC-2025 / JUL-31-2026，
        // 此前只认空格分隔 → 连字符写法全漏（盲人扫药盒读不出有效期，安全攸关）。`[\s-]+` 兼收空格与连字符。
        let monthNamed = [
            // 月[日]年：JUL 2026 / JUL-2026 / JUL 31 2026 / JUL-31-2026 / JUL 31, 2026 / December 2025
            "\\b" + month + "\\.?[\\s-]+(?:[0-9]{1,2}(?:st|nd|rd|th)?,?[\\s-]+)?(?:19|20)[0-9]{2}\\b",
            // 日月年：31 JUL 2026 / 31-JUL-2026 / 31st July, 2026
            "\\b[0-9]{1,2}(?:st|nd|rd|th)?[\\s-]+" + month + "\\.?,?[\\s-]+(?:19|20)[0-9]{2}\\b",
        ]
        return numeric.compactMap { try? NSRegularExpression(pattern: $0) }
            + monthNamed.compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    }()

    static func lineHasDate(_ line: String) -> Bool {
        let r = NSRange(line.startIndex..., in: line)
        return dateRegexes.contains { $0.firstMatch(in: line, range: r) != nil }
    }

    /// 保质期/有效期在中文食品药品包装上**主流写成时长而非日期**（"保质期12个月"/"有效期24个月"/
    /// "shelf life 18 months"），且常只印时长+另一处印生产日期，需两者合读才知新鲜度。此前这类行因"无日期样式"
    /// 被整支丢弃——盲人拿到生产日期却听不到保质时长，无法判断能否食用/服用（安全攸关）。**原样surface**时长文本
    /// 与本模块红线不冲突：不做任何日期运算、不推算到期、仍附"请核对"，只是把印着的字读出来。ASCII 数字 + 时间单位
    /// （沿用本模块"避免 CJK 数字误配"原则）；门控同样要求同行有日期标签，故精度不降（无标签的"12个月"不会被读出）。
    private static let durationRegexes: [NSRegularExpression] = {
        let patterns = [
            "[0-9]{1,4}\\s*(?:个月|个星期|周|天|年)",                 // 12个月 / 360天 / 3年 / 2周
            "\\b[0-9]{1,4}\\s*(?:months?|days?|years?|weeks?)\\b",    // 18 months / 720 days / 2 years
        ]
        return patterns.compactMap { try? NSRegularExpression(pattern: $0, options: [.caseInsensitive]) }
    }()

    static func lineHasDuration(_ line: String) -> Bool {
        let r = NSRange(line.startIndex..., in: line)
        return durationRegexes.contains { $0.firstMatch(in: line, range: r) != nil }
    }

    /// 返回一句可播报的日期信息（原样文本 + "请核对"），无符合的行返回 nil（不猜）。
    public static func find(texts: [String], language: Language) -> String? {
        var seen = Set<String>()
        var hits: [String] = []
        for raw in texts {
            let line = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty else { continue }
            let lower = line.lowercased()
            guard hasDateLabel(lower), lineHasDate(line) || lineHasDuration(line) else { continue }
            guard seen.insert(line).inserted else { continue } // 去重（OCR 常重复同一行）
            hits.append(line)
            if hits.count >= 3 { break } // 至多 3 条，避免长包装刷屏
        }
        guard !hits.isEmpty else { return nil }
        let joined = hits.joined(separator: language == .zh ? "；" : "; ")
        return language == .zh ? "识别到日期信息，请核对：\(joined)" : "Detected date info, please verify: \(joined)"
    }
}
