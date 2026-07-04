import Foundation

/// 包装日期识别（纯逻辑，可单测）：从 OCR 行里挑出带**日期标签**（保质期/生产日期/有效期/EXP/best before…）
/// 且含**日期样式**的行，**原样surface**给盲人。盲人看不到食品/药品上的日期，这是高频刚需（对标 Seeing AI 产品频道）。
///
/// 安全红线：**绝不做日期运算、绝不判"是否过期"、绝不区分生产/保质谁是谁**——把印在包装上的日期文本连同其标签
/// 如实读出，判断交给用户（误判"没过期"会让盲人吃过期食品/药，代价太高）。始终附"请核对"。
/// **关键字门控**（行里既要有日期标签、又要有日期样式）保证高精度：流水号/条码等无标签的数字串不会被误读成日期。
public enum LabelDateReader {
    /// 日期标签关键字（中/英）。短英文词（exp/mfg）靠"同一行还须有日期样式"的门控兜住精度。
    static let labels: [String] = [
        "保质期", "有效期", "到期", "保存期", "生产日期", "此日期前", "食用日期", "限期", "赏味期",
        "best before", "best by", "use by", "expiry", "expires", "exp", "mfg", "manufactured", "sell by", "production date",
    ]

    /// 日期样式（ASCII 数字，避免 CJK 数字误配）：年(19/20xx)+分隔、d/m/yy(yy)、m/yyyy。
    private static let dateRegexes: [NSRegularExpression] = {
        let pats = [
            "(?:19|20)[0-9]{2}\\s*[.\\-/年]",                       // 2026./2026-/2026年（后接月日或止于年）
            "[0-9]{1,2}[./][0-9]{1,2}[./](?:19|20)?[0-9]{2}",       // 15/07/2026、15/07/26
            "[0-9]{1,2}[./](?:19|20)[0-9]{2}",                     // 07/2026
        ]
        return pats.compactMap { try? NSRegularExpression(pattern: $0) }
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
            guard labels.contains(where: { lower.contains($0) }), lineHasDate(line) else { continue }
            guard seen.insert(line).inserted else { continue } // 去重（OCR 常重复同一行）
            hits.append(line)
            if hits.count >= 3 { break } // 至多 3 条，避免长包装刷屏
        }
        guard !hits.isEmpty else { return nil }
        let joined = hits.joined(separator: language == .zh ? "；" : "; ")
        return language == .zh ? "识别到日期信息，请核对：\(joined)" : "Detected date info, please verify: \(joined)"
    }
}
