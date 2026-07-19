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
        public let address: String? // 地址（ADR，公司/家庭住址）——盲人扫名片能听到地址、据此赴约或导航前往（本 App 有全程导航）
        public init(name: String?, phones: [String], emails: [String], org: String?, title: String? = nil, url: String? = nil, address: String? = nil) {
            self.name = name; self.phones = phones; self.emails = emails; self.org = org; self.title = title; self.url = url; self.address = address
        }
        public var isEmpty: Bool {
            name == nil && phones.isEmpty && emails.isEmpty && org == nil && title == nil && url == nil && address == nil
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
        var fn: String?, n: String?, org: String?, title: String?, url: String?, address: String?
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
            else if key == "ADR", address == nil, let a = formatVCardAddress(value) { address = a } // 首个非空 ADR（名片常 WORK/HOME 多条）
        }
        return Contact(name: fn ?? n, phones: dedup(phones), emails: dedup(emails), org: org, title: title, url: url, address: address)
    }

    /// vCard ADR 结构化地址 → 可听串：按**未转义** ; 切 7 组件（PO;EXT;街道;城市;省;邮编;国家，多为空占位），
    /// 跳空、其余以 ", " 连接。处理 vCard 转义（\n/\N→空格、\, \; \\ →字面）。全空→nil。
    /// 盲人扫名片能听到地址（"123 Main St, Springfield, IL, 62704"），据此赴约或让本 App 导航前往。
    static func formatVCardAddress(_ v: String) -> String? {
        var comps: [String] = [], cur = "", esc = false
        for ch in v {
            if esc {
                if ch == "n" || ch == "N" { cur += " " } else { cur.append(ch) } // \n=组件内换行→空格；\, \; \\ 等→字面
                esc = false
            } else if ch == "\\" { esc = true }
            else if ch == ";" { comps.append(cur); cur = "" }
            else { cur.append(ch) }
        }
        comps.append(cur)
        let parts = comps.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    /// MECARD:`MECARD:N:名;TEL:号;EMAIL:邮;;`——按 ; 切字段，每段 `KEY:VALUE`。
    private static func parseMECARD(_ text: String) -> Contact {
        let body = String(text.dropFirst("MECARD:".count))
        var name: String?, org: String?, url: String?, address: String?
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
            case "ADR": // MECARD ADR 逗号分组：切分去空、以 ", " 连接（避免裸逗号/多空格，更好念）
                if address == nil {
                    let a = value.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: ", ")
                    address = a.isEmpty ? nil : a
                }
            default: break
            }
        }
        return Contact(name: name, phones: dedup(phones), emails: dedup(emails), org: org, url: url, address: address)
    }

    private static func dedup(_ arr: [String]) -> [String] {
        var seen = Set<String>(); return arr.filter { seen.insert($0).inserted }
    }
}
