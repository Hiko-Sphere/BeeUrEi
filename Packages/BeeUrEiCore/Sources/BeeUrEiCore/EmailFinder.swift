import Foundation

/// 从 OCR 文本抽取电子邮箱（纯逻辑，可单测）：名片/信笺/海报上的邮箱地址，盲人读不到也写不了。
/// 抽出来读给他、并可对唯一邮箱一键打开邮件撰写（与读电话同一取向：**只读不代发**——OCR 可能错位，
/// 由用户在邮件 App 复核收件人后再发）。标准邮箱样式匹配，按小写去重保序。
public enum EmailFinder {
    private static let regex: NSRegularExpression? =
        try? NSRegularExpression(pattern: "[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}")

    /// 返回识别到的邮箱（去重保序）；无返回空数组。
    public static func find(texts: [String]) -> [String] {
        guard let regex else { return [] }
        var out: [String] = []
        var seen = Set<String>()
        for raw in texts {
            let ns = raw as NSString
            for m in regex.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
                let email = ns.substring(with: m.range)
                let key = email.lowercased() // 邮箱大小写不敏感（尤其域名）→ 同址不同大小写视为一个
                if seen.insert(key).inserted { out.append(email) }
            }
        }
        return out
    }
}
