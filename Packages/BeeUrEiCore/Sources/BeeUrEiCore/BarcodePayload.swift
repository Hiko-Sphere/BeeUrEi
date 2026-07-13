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
    case geo(latitude: Double, longitude: Double, label: String?) // geo: 地理坐标（RFC 5870/地图分享）——可导航前往
    case calendarEvent(title: String?, start: String?) // iCalendar 日程（BEGIN:VEVENT/VCALENDAR，活动海报/票据/会议牌常见）——盲人扫码该听到"这是日程：标题+时间"，而非一堆 iCal 原文
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
        // iCalendar 日程（标准 BEGIN:VCALENDAR 包 VEVENT，或极简的裸 BEGIN:VEVENT）：活动海报/门票/会议牌常见的"加入日历"码。
        // 盲人扫到该听"这是日程：标题+时间"，而非一整段 iCal 原文（此前落 .text=念天书）。解出 SUMMARY/DTSTART 供播报核对。
        if upper.hasPrefix("BEGIN:VCALENDAR") || upper.hasPrefix("BEGIN:VEVENT") {
            let e = parseCalendarEvent(trimmed)
            return .calendarEvent(title: e.title, start: e.start)
        }
        // 地理位置码（RFC 5870 `geo:lat,lng`，及地图分享变体 `geo:0,0?q=lat,lng(名)`/`geo:lat,lng?q=地名`）：
        // 盲人看不到地图，扫到"位置码"该能听到这是位置/地名并**一键导航过去**（本 App 有全程导航）。解析失败/占位坐标
        // 回落 .text（不谎报一个没法导航的"位置"）。
        if upper.hasPrefix("GEO:"), let g = parseGeo(trimmed) {
            return .geo(latitude: g.latitude, longitude: g.longitude, label: g.label)
        }
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

    /// `geo:lat,lng[,alt][;u=...]`（RFC 5870）及地图分享常见变体 `geo:0,0?q=lat,lng(Label)` / `geo:lat,lng?q=地名`
    /// → 结构化坐标 + 可选地名。坐标基准 WGS-84（geo: URI 默认；交 Apple 地图 ?ll= 境内会自动纠偏，见坐标系约定）。
    /// 无有效坐标返回 nil——含 **Null Island (0,0)** 占位（`geo:0,0?q=纯地名` 这类 q 非坐标的分享，无坐标可导航），
    /// 绝不把大西洋当目的地。alt/;参数 一律忽略。
    public static func parseGeo(_ payload: String) -> (latitude: Double, longitude: Double, label: String?)? {
        let trimmed = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.uppercased().hasPrefix("GEO:") else { return nil }
        let body = trimmed.dropFirst("GEO:".count)
        let qSplit = body.firstIndex(of: "?")
        var coord = geoLatLng(String(qSplit.map { body[..<$0] } ?? Substring(body)))
        var label: String?
        if let qSplit {
            let query = String(body[body.index(after: qSplit)...])
            if let q = geoQueryValue(query, key: "q"), !q.isEmpty {
                // q 可为 "lat,lng(Label)" / "lat,lng" / "地名"。先剥括号地名，其余能解析成坐标就覆盖 path 占位坐标，
                // 否则整体当地名（path 坐标保留）。
                if let open = q.firstIndex(of: "("), q.last == ")" {
                    let inner = String(q[q.index(after: open)..<q.index(before: q.endIndex)]).trimmingCharacters(in: .whitespaces)
                    if !inner.isEmpty { label = inner }
                    if let c = geoLatLng(String(q[..<open])) { coord = c }
                } else if let c = geoLatLng(q) {
                    coord = c
                } else {
                    label = q
                }
            }
        }
        guard let (lat, lng) = coord else { return nil }
        if lat == 0, lng == 0 { return nil } // Null Island 占位，非真实目的地（与服务端 nav 拒 0,0 同口径）
        return (lat, lng, label)
    }

    /// iCalendar 事件解析：取 SUMMARY(标题) 与 DTSTART(开始时刻)。iCal 每行 `KEY[;参数]:VALUE`；
    /// DTSTART 可带参数（`DTSTART;TZID=...:20260720T140000`），值在**首个冒号之后**。日期轻格式化成可听的
    /// "YYYY-MM-DD[ HH:MM]"（无法解析则原样）。两者都缺 → (nil,nil)（上层仍报"这是日程事件"）。绝不做时区换算/判断过没过。
    public static func parseCalendarEvent(_ payload: String) -> (title: String?, start: String?) {
        var title: String?, start: String?
        // 注意：Swift 里 "\r\n"(CRLF) 是**单个**字素簇 Character——须显式作分隔符，否则 iCal 标准的 CRLF 换行不被切开，整段成一行。
        for rawLine in payload.split(whereSeparator: { $0 == "\n" || $0 == "\r" || $0 == "\r\n" }) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            guard let colon = line.firstIndex(of: ":") else { continue }
            // key = 冒号前、到首个 ; (参数分隔) 为止，大写归一
            let key = String(line[line.startIndex..<colon].prefix { $0 != ";" }).uppercased()
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            guard !value.isEmpty else { continue }
            if key == "SUMMARY", title == nil { title = unescapeICal(value) }
            else if key == "DTSTART", start == nil { start = formatICalDate(value) }
        }
        return (title, start)
    }

    /// iCal 文本值转义展开（`\,`→`,` `\;`→`;` `\\`→`\` `\n`/`\N`→空格便于朗读）。未知转义原样保留其后字符。
    private static func unescapeICal(_ s: String) -> String {
        var out = "", escaped = false
        for ch in s {
            if escaped {
                if ch == "n" || ch == "N" { out.append(" ") } else { out.append(ch) }
                escaped = false
            } else if ch == "\\" { escaped = true }
            else { out.append(ch) }
        }
        if escaped { out.append("\\") }
        return out
    }

    /// iCal DTSTART 值 → 可听日期。识别 `YYYYMMDD` 与 `YYYYMMDDTHHMMSS[Z]`（取到分钟）；其余原样返回（不臆造）。
    private static func formatICalDate(_ v: String) -> String {
        let digits = v.prefix { $0.isNumber }      // 前导数字（遇 T 停）
        guard digits.count >= 8 else { return v }   // 非 YYYYMMDD 形态 → 原样
        let y = digits.prefix(4), mo = digits.dropFirst(4).prefix(2), d = digits.dropFirst(6).prefix(2)
        var out = "\(y)-\(mo)-\(d)"
        if let tIdx = v.firstIndex(where: { $0 == "T" || $0 == "t" }) {
            let time = v[v.index(after: tIdx)...].prefix { $0.isNumber }
            if time.count >= 4 {
                out += " \(time.prefix(2)):\(time.dropFirst(2).prefix(2))"
            }
        }
        return out
    }

    /// "lat,lng[,alt][;params]" → (lat,lng)，校验有限且经纬度在界内；否则 nil。
    private static func geoLatLng(_ s: String) -> (Double, Double)? {
        let coordPart = s.prefix { $0 != ";" } // 去掉 ;u= ;crs= 等 RFC 5870 参数
        let parts = coordPart.split(separator: ",")
        guard parts.count >= 2,
              let lat = Double(parts[0].trimmingCharacters(in: .whitespaces)),
              let lng = Double(parts[1].trimmingCharacters(in: .whitespaces)),
              lat.isFinite, lng.isFinite, (-90...90).contains(lat), (-180...180).contains(lng) else { return nil }
        return (lat, lng)
    }

    /// 从 `key=value&...` 查询串取某键值（键大小写不敏感；URL 百分号解码；`+`→空格，同 form 编码）。无则 nil。
    private static func geoQueryValue(_ query: String, key: String) -> String? {
        for pair in query.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1)
            guard kv.count == 2, kv[0].lowercased() == key.lowercased() else { continue }
            let raw = kv[1].replacingOccurrences(of: "+", with: " ")
            return (raw.removingPercentEncoding ?? raw).trimmingCharacters(in: .whitespaces)
        }
        return nil
    }

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
