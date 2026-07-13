import Foundation

/// 名片二维码解析（纯逻辑，可单测）：vCard(BEGIN:VCARD…) 与 MECARD(MECARD:…) → 姓名/电话/邮箱/单位。
/// 盲人扫到名片码此前只听到"这是一张名片"、拿不到里面的信息；解析出来读给他，并可对唯一电话一键拨打。
public enum VCardParser {
    public struct Contact: Equatable, Sendable {
        public let name: String?
        public let phones: [String]
        public let emails: [String]
        public let org: String?
        public let title: String?  // 职务（TITLE，如"销售经理"）——名片上最常见、盲人靠它知道对方是谁/什么角色
        public let url: String?    // 网址（URL，公司/个人主页）
        public init(name: String?, phones: [String], emails: [String], org: String?, title: String? = nil, url: String? = nil) {
            self.name = name; self.phones = phones; self.emails = emails; self.org = org; self.title = title; self.url = url
        }
        public var isEmpty: Bool {
            name == nil && phones.isEmpty && emails.isEmpty && org == nil && title == nil && url == nil
        }
    }

    public static func parse(_ payload: String) -> Contact? {
        let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        let upper = trimmed.uppercased()
        let c: Contact?
        if upper.hasPrefix("BEGIN:VCARD") { c = parseVCard(trimmed) }
        else if upper.hasPrefix("MECARD:") { c = parseMECARD(trimmed) }
        else { return nil }
        return (c?.isEmpty == false) ? c : nil
    }

    /// vCard：逐行 `KEY[;参数]:VALUE`。FN 优先作姓名（N 为结构化姓名兜底）；TEL/EMAIL 可多条。
    private static func parseVCard(_ text: String) -> Contact {
        var fn: String?, n: String?, org: String?, title: String?, url: String?
        var phones: [String] = [], emails: [String] = []
        for rawLine in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" || $0 == "\r\n" }) {
            let line = String(rawLine)
            guard let colon = line.firstIndex(of: ":") else { continue }
            let rawKey = line[line.startIndex..<colon].uppercased()
            // **基础键**：剥参数（`FN;CHARSET=UTF-8`→FN——中文名片常带 CHARSET，精确匹配 FN 会丢姓名）
            // 与 Apple 分组前缀（`item1.TEL`→TEL）。剥完再精确比对：N 不能用 hasPrefix（会吞 NICKNAME/NOTE）。
            var key = String(rawKey.prefix(while: { $0 != ";" }))
            if let dot = key.lastIndex(of: ".") { key = String(key[key.index(after: dot)...]) }
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            guard !value.isEmpty else { continue }
            if key == "FN" { fn = value }
            else if key == "N" { n = value.replacingOccurrences(of: ";", with: " ").trimmingCharacters(in: .whitespaces) }
            else if key == "TEL" { phones.append(value) }
            else if key == "EMAIL" { emails.append(value) }
            else if key == "ORG" { org = value.replacingOccurrences(of: ";", with: " ").trimmingCharacters(in: .whitespaces) }
            else if key == "TITLE" { title = value }  // 职务（名片核心信息之一）
            else if key == "URL" { url = value }       // 主页/网址
        }
        return Contact(name: fn ?? n, phones: dedup(phones), emails: dedup(emails), org: org, title: title, url: url)
    }

    /// MECARD:`MECARD:N:名;TEL:号;EMAIL:邮;;`——按 ; 切字段，每段 `KEY:VALUE`。
    private static func parseMECARD(_ text: String) -> Contact {
        let body = String(text.dropFirst("MECARD:".count))
        var name: String?, org: String?, url: String?
        var phones: [String] = [], emails: [String] = []
        for field in body.split(separator: ";") {
            let f = String(field)
            guard let colon = f.firstIndex(of: ":") else { continue }
            let key = f[f.startIndex..<colon].uppercased()
            let value = String(f[f.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            guard !value.isEmpty else { continue }
            switch key {
            case "N": name = value.replacingOccurrences(of: ",", with: " ").trimmingCharacters(in: .whitespaces)
            case "TEL": phones.append(value)
            case "EMAIL": emails.append(value)
            case "ORG": org = value
            case "URL": url = value  // MECARD 有 URL（无 TITLE 字段）
            default: break
            }
        }
        return Contact(name: name, phones: dedup(phones), emails: dedup(emails), org: org, url: url)
    }

    private static func dedup(_ arr: [String]) -> [String] {
        var seen = Set<String>(); return arr.filter { seen.insert($0).inserted }
    }
}
