import Foundation

/// 名片二维码解析（纯逻辑，可单测）：vCard(BEGIN:VCARD…) 与 MECARD(MECARD:…) → 姓名/电话/邮箱/单位。
/// 盲人扫到名片码此前只听到"这是一张名片"、拿不到里面的信息；解析出来读给他，并可对唯一电话一键拨打。
public enum VCardParser {
    public struct Contact: Equatable, Sendable {
        public let name: String?
        public let phones: [String]
        public let emails: [String]
        public let org: String?
        public init(name: String?, phones: [String], emails: [String], org: String?) {
            self.name = name; self.phones = phones; self.emails = emails; self.org = org
        }
        public var isEmpty: Bool { name == nil && phones.isEmpty && emails.isEmpty && org == nil }
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
        var fn: String?, n: String?, org: String?
        var phones: [String] = [], emails: [String] = []
        for rawLine in text.split(whereSeparator: { $0 == "\n" || $0 == "\r" }) {
            let line = String(rawLine)
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[line.startIndex..<colon].uppercased()
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            guard !value.isEmpty else { continue }
            if key == "FN" { fn = value }
            else if key == "N" { n = value.replacingOccurrences(of: ";", with: " ").trimmingCharacters(in: .whitespaces) }
            else if key.hasPrefix("TEL") { phones.append(value) }
            else if key.hasPrefix("EMAIL") { emails.append(value) }
            else if key.hasPrefix("ORG") { org = value.replacingOccurrences(of: ";", with: " ").trimmingCharacters(in: .whitespaces) }
        }
        return Contact(name: fn ?? n, phones: dedup(phones), emails: dedup(emails), org: org)
    }

    /// MECARD:`MECARD:N:名;TEL:号;EMAIL:邮;;`——按 ; 切字段，每段 `KEY:VALUE`。
    private static func parseMECARD(_ text: String) -> Contact {
        let body = String(text.dropFirst("MECARD:".count))
        var name: String?, org: String?
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
            default: break
            }
        }
        return Contact(name: name, phones: dedup(phones), emails: dedup(emails), org: org)
    }

    private static func dedup(_ arr: [String]) -> [String] {
        var seen = Set<String>(); return arr.filter { seen.insert($0).inserted }
    }
}
