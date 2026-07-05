import Foundation

/// 条码/二维码内容类型（先说"这是什么"再读内容，对标 Seeing AI Products 频道的"扫码即知"体验）。
public enum BarcodePayloadKind: Equatable, Sendable {
    case productCode(chinaPrefix: Bool) // EAN/UPC 纯数字商品码；69 开头的 EAN-13 = 中国大陆厂商
    case wifi(ssid: String?)            // WIFI: 配置码
    case url(host: String?)             // http(s) 链接
    case phone(number: String)          // tel: 电话
    case email(address: String?)        // mailto: 电子邮箱
    case sms(number: String?, body: String?) // SMSTO:/sms: 发短信（number=收件号码，body=预填正文）
    case contact                        // vCard / MECARD 名片
    case text                           // 其余普通文本
}

/// WiFi 配置码解析出的完整凭据。盲人扫 WiFi 码看不到密码——密码是能否联网的关键。
public struct WifiCredential: Equatable, Sendable {
    public let ssid: String
    public let password: String?  // nil = 开放网络（nopass / 无密码）
    public let security: String?  // "WPA"/"WEP"/"nopass"… 原样（大小写不动）
    public let hidden: Bool
    public init(ssid: String, password: String?, security: String?, hidden: Bool) {
        self.ssid = ssid; self.password = password; self.security = security; self.hidden = hidden
    }
}

/// 条码 payload 分类（纯逻辑，可单测）。
public enum BarcodePayload {
    public static func classify(_ payload: String) -> BarcodePayloadKind {
        let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        let upper = trimmed.uppercased()
        if upper.hasPrefix("WIFI:") { return .wifi(ssid: wifiSSID(trimmed)) }
        if upper.hasPrefix("HTTP://") || upper.hasPrefix("HTTPS://") { return .url(host: host(of: trimmed)) }
        if upper.hasPrefix("TEL:") {
            let n = String(trimmed.dropFirst("TEL:".count)).trimmingCharacters(in: .whitespaces)
            return n.isEmpty ? .text : .phone(number: n) // 空 tel: 回落文本，不谎报"这是电话号码"却没号可拨（对抗复审 LOW，与 mailto/sms 同口径）
        }
        // 邮箱：`mailto:addr?subject=...` → addr（去掉 ? 之后的参数）。常见联系人 QR，读原始"mailto 冒号…"体验差。
        if upper.hasPrefix("MAILTO:") {
            let rest = trimmed.dropFirst("MAILTO:".count).prefix { $0 != "?" }
            let addr = rest.trimmingCharacters(in: .whitespaces)
            return .email(address: addr.isEmpty ? nil : addr)
        }
        // 短信：`SMSTO:number:message`（冒号后正文，原样）/ `sms:number?body=...`（查询参数，URL 编码）。
        // **正文一并解出**：盲人扫码只报号码、不报正文=不知会发出什么内容（订阅/付费短信可乘虚而入），须如实读全（与
        // 读邮箱/WiFi 密码/名片"读全内容供核对"同取向）。number 到首个 : 或 ? 为止；其后按分隔符取正文。
        if let pfx = ["SMSTO:", "SMS:"].first(where: { upper.hasPrefix($0) }) {
            let rest = String(trimmed.dropFirst(pfx.count))
            let sep = rest.firstIndex { $0 == ":" || $0 == "?" }
            let num = String(sep.map { rest[..<$0] } ?? Substring(rest)).trimmingCharacters(in: .whitespaces)
            var body: String? = nil
            if let e = sep {
                let after = String(rest[rest.index(after: e)...])
                if rest[e] == ":" { let b = after.trimmingCharacters(in: .whitespaces); body = b.isEmpty ? nil : b }
                else { body = smsBodyParam(after) } // '?' → 查询串里取 body=
            }
            return .sms(number: num.isEmpty ? nil : num, body: body)
        }
        if upper.hasPrefix("BEGIN:VCARD") || upper.hasPrefix("MECARD:") { return .contact }
        if !trimmed.isEmpty, trimmed.allSatisfy({ $0.isASCII && $0.isNumber }),
           [8, 12, 13, 14].contains(trimmed.count) { // EAN-8 / UPC-A / EAN-13 / ITF-14
            return .productCode(chinaPrefix: trimmed.count == 13 && trimmed.hasPrefix("69"))
        }
        return .text
    }

    /// `WIFI:T:WPA;S:MyHome;P:pass;;` → 完整凭据（含**密码**）。
    /// **正确处理转义**（`\;` `\,` `\:` `\\` `\"`——WiFi 密码常含分号/反斜杠等特殊字符，naive 按 ; 切会切错）。
    /// 键大小写不敏感（非标准生成器可能用 `s:`/`p:` 小写）；值保持原样大小写（SSID/密码区分大小写）。
    /// 非 WIFI: 或无 SSID 返回 nil。security=nopass 或无密码 → password 为 nil（开放网络）。
    public static func parseWifi(_ payload: String) -> WifiCredential? {
        let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.uppercased().hasPrefix("WIFI:") else { return nil }
        let body = String(trimmed.dropFirst("WIFI:".count))
        var ssid: String?, password: String?, security: String?, hidden = false
        for field in splitUnescaped(body, on: ";") {
            guard let colon = field.firstIndex(of: ":") else { continue }
            let key = String(field[field.startIndex..<colon]).uppercased()
            let value = unescapeWifi(String(field[field.index(after: colon)...]))
            switch key {
            case "S": ssid = value
            case "P": password = value
            case "T": security = value
            case "H": hidden = value.lowercased() == "true"
            default: break
            }
        }
        guard let s = ssid, !s.isEmpty else { return nil }
        let isOpen = (security ?? "").uppercased() == "NOPASS" || (password?.isEmpty ?? true)
        return WifiCredential(ssid: s,
                              password: isOpen ? nil : password,
                              security: (security?.isEmpty ?? true) ? nil : security,
                              hidden: hidden)
    }

    /// SSID 便捷取（分类用）：委托 parseWifi，与完整解析同口径（含转义处理）。
    static func wifiSSID(_ payload: String) -> String? { parseWifi(payload)?.ssid }

    /// `sms:number?body=...` 的查询串里取 `body`（大小写不敏感键；URL 百分号解码；`+`→空格，同 form 编码惯例）。无则 nil。
    static func smsBodyParam(_ query: String) -> String? {
        for pair in query.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1)
            guard kv.count == 2, kv[0].lowercased() == "body" else { continue }
            let raw = kv[1].replacingOccurrences(of: "+", with: " ")
            let decoded = raw.removingPercentEncoding ?? raw
            let t = decoded.trimmingCharacters(in: .whitespaces)
            return t.isEmpty ? nil : t
        }
        return nil
    }

    /// 按**未转义**的分隔符切分（`\<sep>` 不切）；反斜杠保留在片段里，交 unescapeWifi 展开。
    private static func splitUnescaped(_ s: String, on sep: Character) -> [String] {
        var out: [String] = [], cur = "", escaped = false
        for ch in s {
            if escaped { cur.append("\\"); cur.append(ch); escaped = false }
            else if ch == "\\" { escaped = true }
            else if ch == sep { out.append(cur); cur = "" }
            else { cur.append(ch) }
        }
        if escaped { cur.append("\\") } // 末尾孤立反斜杠
        out.append(cur)
        return out
    }

    /// 展开 WiFi 值转义：`\;`→`;` `\,`→`,` `\:`→`:` `\\`→`\` `\"`→`"`（未知转义原样保留其后字符）。
    private static func unescapeWifi(_ s: String) -> String {
        var out = "", escaped = false
        for ch in s {
            if escaped { out.append(ch); escaped = false }
            else if ch == "\\" { escaped = true }
            else { out.append(ch) }
        }
        if escaped { out.append("\\") }
        return out
    }

    /// `http(s)://[userinfo@]host[:port]/path` → host。正确剥离 userinfo（user:pass@）与 IPv6 字面量 [::1]
    /// （对抗复审 LOW：原实现遇 "user:pass@example.com" 停在第一个 ':' 把用户名当 host、遇 IPv6 把 "[2001" 当 host）。
    static func host(of url: String) -> String? {
        guard let schemeEnd = url.range(of: "://") else { return nil }
        let rest = url[schemeEnd.upperBound...]
        // authority = 到第一个 /?# 为止（其内为 [userinfo@]host[:port]）。
        let authEnd = rest.firstIndex { $0 == "/" || $0 == "?" || $0 == "#" } ?? rest.endIndex
        var authority = rest[..<authEnd]
        // 剥 userinfo：@ 之前（含）的都不是 host。
        if let at = authority.lastIndex(of: "@") { authority = authority[authority.index(after: at)...] }
        // IPv6 字面量 [2001:db8::1]：取方括号内为 host。
        if authority.first == "[" {
            guard let close = authority.firstIndex(of: "]") else { return nil }
            let inner = authority[authority.index(after: authority.startIndex)..<close]
            return inner.isEmpty ? nil : String(inner)
        }
        // 普通 host：到 :(端口) 为止。
        let hostEnd = authority.firstIndex(of: ":") ?? authority.endIndex
        let host = String(authority[..<hostEnd])
        return host.isEmpty ? nil : host
    }
}
