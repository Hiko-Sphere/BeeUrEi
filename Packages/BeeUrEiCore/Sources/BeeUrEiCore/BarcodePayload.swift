import Foundation

/// 条码/二维码内容类型（先说"这是什么"再读内容，对标 Seeing AI Products 频道的"扫码即知"体验）。
public enum BarcodePayloadKind: Equatable, Sendable {
    case productCode(chinaPrefix: Bool) // EAN/UPC 纯数字商品码；69 开头的 EAN-13 = 中国大陆厂商
    case wifi(ssid: String?)            // WIFI: 配置码
    case url(host: String?)             // http(s) 链接
    case phone(number: String)          // tel: 电话
    case email(address: String?)        // mailto: 电子邮箱
    case sms(number: String?)           // SMSTO:/sms: 发短信
    case contact                        // vCard / MECARD 名片
    case text                           // 其余普通文本
}

/// 条码 payload 分类（纯逻辑，可单测）。
public enum BarcodePayload {
    public static func classify(_ payload: String) -> BarcodePayloadKind {
        let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        let upper = trimmed.uppercased()
        if upper.hasPrefix("WIFI:") { return .wifi(ssid: wifiSSID(trimmed)) }
        if upper.hasPrefix("HTTP://") || upper.hasPrefix("HTTPS://") { return .url(host: host(of: trimmed)) }
        if upper.hasPrefix("TEL:") {
            return .phone(number: String(trimmed.dropFirst("TEL:".count)).trimmingCharacters(in: .whitespaces))
        }
        // 邮箱：`mailto:addr?subject=...` → addr（去掉 ? 之后的参数）。常见联系人 QR，读原始"mailto 冒号…"体验差。
        if upper.hasPrefix("MAILTO:") {
            let rest = trimmed.dropFirst("MAILTO:".count).prefix { $0 != "?" }
            let addr = rest.trimmingCharacters(in: .whitespaces)
            return .email(address: addr.isEmpty ? nil : addr)
        }
        // 短信：`SMSTO:number:message` / `sms:number?body=...` → number（到 : 或 ? 为止）。
        if let pfx = ["SMSTO:", "SMS:"].first(where: { upper.hasPrefix($0) }) {
            let num = trimmed.dropFirst(pfx.count).prefix { $0 != ":" && $0 != "?" }.trimmingCharacters(in: .whitespaces)
            return .sms(number: num.isEmpty ? nil : num)
        }
        if upper.hasPrefix("BEGIN:VCARD") || upper.hasPrefix("MECARD:") { return .contact }
        if !trimmed.isEmpty, trimmed.allSatisfy({ $0.isASCII && $0.isNumber }),
           [8, 12, 13, 14].contains(trimmed.count) { // EAN-8 / UPC-A / EAN-13 / ITF-14
            return .productCode(chinaPrefix: trimmed.count == 13 && trimmed.hasPrefix("69"))
        }
        return .text
    }

    /// `WIFI:T:WPA;S:MyHome;P:pass;;` → "MyHome"。S 字段带转义的罕见情况不展开（原样读出已可用）。
    static func wifiSSID(_ payload: String) -> String? {
        let body = payload.dropFirst("WIFI:".count)
        // 字段**键**大小写不敏感（与 classify 的 upper.hasPrefix("WIFI:") 同口径）——否则非标准
        // 生成器的 `s:` 小写键会漏读 SSID；但**值**保持原样大小写（网络名区分大小写）。
        for field in body.split(separator: ";") where field.uppercased().hasPrefix("S:") {
            let v = String(field.dropFirst(2)) // 从原始 field 去掉 2 字符键，保留值大小写
            return v.isEmpty ? nil : v
        }
        return nil
    }

    /// `http(s)://host[:port]/path` → host。
    static func host(of url: String) -> String? {
        guard let schemeEnd = url.range(of: "://") else { return nil }
        let rest = url[schemeEnd.upperBound...]
        let end = rest.firstIndex { $0 == "/" || $0 == ":" || $0 == "?" || $0 == "#" } ?? rest.endIndex
        let host = String(rest[..<end])
        return host.isEmpty ? nil : host
    }
}
