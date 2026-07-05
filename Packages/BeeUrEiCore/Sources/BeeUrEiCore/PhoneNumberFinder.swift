import Foundation

/// 从 OCR 文本里抽取电话号码（纯逻辑，可单测）：名片/海报/说明书上的号码，盲人读不到也拨不了。
/// 识别中国手机(1[3-9]+11位)/座机(区号0开头)/服务号(400/800)/国际(+)。手机分 3-4-4 便于 TTS 逐组念清。
///
/// 安全：**只如实读出号码、绝不自动拨号**——OCR 可能错一位，拨错号代价高（骚扰/费用/错过真号）。把号码读出来
/// 交给用户核对再拨（同 LabelDateReader "不判断只如实读"的取向）。精确前缀门控（手机 1[3-9]、座机 0、服务 400/800）
/// 保证不把价格/年份/条码等数字串误当电话。
public enum PhoneNumberFinder {
    /// 返回识别到的号码（去重，保序）；无返回空数组。
    public static func find(texts: [String]) -> [String] {
        var out: [String] = []
        var seen = Set<String>()
        for raw in texts {
            for span in candidateSpans(raw) {
                guard let formatted = validateAndFormat(span) else { continue }
                let key = formatted.filter(\.isNumber) // 去重按纯数字（同号不同印刷分隔视为一个）
                if seen.insert(key).inserted { out.append(formatted) }
            }
        }
        return out
    }

    /// 电话候选片段：连续的「数字/空格/-/+/()/.」串。地名/文字自然截断（"电话13812345678" 的"电话"非电话字符）。
    /// 含 **.**（点分隔）：名片/欧洲写法常用点分隔（138.1234.5678 / 01.42.34.56.78），此前会被点截断成碎片而漏识；
    /// 非电话的点分数字串（日期 2026.07.15、价格 13.50、IP 192.168.1.1）由后续长度+前缀门控照旧拒绝，不会误配。
    static func candidateSpans(_ s: String) -> [String] {
        var spans: [String] = []
        var cur = ""
        for ch in s {
            if ch.isASCII, ch.isNumber || "+-() .".contains(ch) { cur.append(ch) }
            else { if !cur.isEmpty { spans.append(cur); cur = "" } }
        }
        if !cur.isEmpty { spans.append(cur) }
        return spans
    }

    /// 11 位中国手机分 3-4-4（TTS 逐组念清，便于用户核对逐位）。入参须为 11 位纯数字。
    static func groupedMobile(_ digits: String) -> String {
        "\(digits.prefix(3)) \(digits.dropFirst(3).prefix(4)) \(digits.dropFirst(7))"
    }

    /// 400/800 客服号（10 位=3 前缀+3+4）分 3-3-4，TTS 逐组念清（同 groupedMobile 取向）。入参须为 10 位纯数字。
    static func groupedService(_ digits: String) -> String {
        "\(digits.prefix(3)) \(digits.dropFirst(3).prefix(3)) \(digits.dropFirst(6))"
    }

    /// 校验并格式化：命中电话样式返回可读串，否则 nil。
    static func validateAndFormat(_ span: String) -> String? {
        let hasPlus = span.contains("+")
        let digits = span.filter(\.isNumber)
        let d = Array(digits)
        // 中国手机：**无国家码**、11 位、1 开头、第二位 3-9 → 分 3-4-4（TTS 逐组念清）。
        // **必须 !hasPlus**：否则 "+1 305 555 0199"（美/加号，区号 3-9 开头）裸数字恰为 "13055550199"=11 位、
        // 1 开头、次位 3——会被丢掉 + 与国家码 1、误当中国 130 号段手机读出一个真实存在的**错号**（拨错人，对抗复审 HIGH）。
        if !hasPlus, d.count == 11, d[0] == "1", let sec = d[1].wholeNumberValue, (3...9).contains(sec) {
            return groupedMobile(digits)
        }
        // 带国家码 +86 的中国手机（+86 + 11 位手机）→ "+86 3-4-4"。否则会落到通用国际分支被 13 位连读，
        // 盲人 TTS 听不清；逐组念清对拨号核对至关重要。
        if hasPlus, digits.hasPrefix("86"), d.count == 13 {
            let rest = String(digits.dropFirst(2)), r = Array(rest)
            if r[0] == "1", let sec = r[1].wholeNumberValue, (3...9).contains(sec) {
                return "+86 \(groupedMobile(rest))"
            }
        }
        let trimmed = span.trimmingCharacters(in: .whitespaces)
        // 座机（区号 0 开头，10-12 位；欧洲点分写法照收）：保留印刷分隔，原样返回。
        if d.count >= 10, d.count <= 12, digits.hasPrefix("0") { return trimmed }
        // 服务号 400/800：真号恒为 **10 位**（400/800 + 7 位），且不写成 IP/坐标式的 **4+ 组点分**——
        // 否则 "400.820.88.20"（坐标/IP-like，数字恰 4008208820）会被误当客服号读给盲人（对抗复审 MED）。
        if d.count == 10, (digits.hasPrefix("400") || digits.hasPrefix("800")),
           span.filter({ $0 == "." }).count < 3 {
            // 印刷已带分隔（400-820-8820）→ 原样保留（读屏本就分组清晰、且是用户认得的形态）；无分隔的裸号
            // （4008208820）→ 补 3-3-4 分组，否则 TTS 把十位数连读成"四十亿…"、盲人听不清也记不住（同手机取向）。
            return trimmed.contains(where: { !$0.isNumber }) ? trimmed : groupedService(digits)
        }
        // 国际：带 + 且 8-15 位。
        if hasPlus, d.count >= 8, d.count <= 15 { return trimmed }
        return nil
    }
}
