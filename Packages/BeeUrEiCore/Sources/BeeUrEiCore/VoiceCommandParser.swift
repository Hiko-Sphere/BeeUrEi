import Foundation

/// 语音指令意图解析（纯逻辑）：把语音识别出的整句文本映射为 App 动作。
/// 设计原则：宽松匹配（口语多变）、危险动作不做（不解析"挂断"以防误识别切断求助）、
/// 不确定时返回 .unknown 由上层播报"没听懂"并复述可用指令。
public enum VoiceCommand: Equatable, Sendable {
    case help                       // 求助/呼叫亲友
    case whereAmI                   // 我在哪
    case around                     // 周围有什么
    case ahead                      // 前方有什么
    case weather                    // 天气
    case look                       // 打开识别（看一看）
    case navigate(String?)          // 导航（可带目的地）
    case goHome                     // 原路返回
    case readText                   // 朗读文字
    case banknote                   // 识别纸币
    case scanCode                   // 扫码
    case messages                   // 打开消息
    case sendMessage(to: String, text: String) // 给X发消息说Y
    case repeatLast                 // 重复刚才的播报
    case unknown
}

public enum VoiceCommandParser {

    /// 解析一句话（已识别文本）。匹配大小写不敏感；中英都认。
    public static func parse(_ raw: String) -> VoiceCommand {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return .unknown }
        let t = text.lowercased()

        // 发消息（含目标与内容）优先解析：「给妈妈发消息说我到了」/ "send a message to mom saying I arrived"
        if let m = parseSendMessage(text) { return m }

        func has(_ keys: [String]) -> Bool { keys.contains { t.contains($0) } }

        if has(["求助", "救命", "帮帮我", "呼叫", "打电话", "call for help", "get help", "help me", "call family"]) { return .help }
        if has(["我在哪", "我在哪里", "当前位置", "where am i", "my location"]) { return .whereAmI }
        if has(["周围有什么", "附近有什么", "周围", "what's around", "around me", "nearby"]) { return .around }
        if has(["前方有什么", "前面有什么", "前方", "what's ahead", "ahead of me", "in front"]) { return .ahead }
        if has(["天气", "下雨", "气温", "weather", "temperature", "rain"]) { return .weather }
        if has(["回家", "原路返回", "返回出发", "带我回去", "go back", "take me back", "backtrack"]) { return .goHome }
        if has(["读文字", "念文字", "朗读", "读一下", "read text", "read this", "read it"]) { return .readText }
        if has(["纸币", "钱", "钞票", "多少元", "banknote", "money", "currency", "bill"]) { return .banknote }
        if has(["扫码", "二维码", "条形码", "条码", "scan", "barcode", "qr"]) { return .scanCode }
        if has(["消息", "聊天", "信息", "message", "chat", "inbox"]) { return .messages }
        if has(["看一看", "识别", "这是什么", "拍一下", "look", "what is this", "identify", "recognize"]) { return .look }
        if has(["再说一遍", "重复", "刚才说什么", "repeat", "say again", "say that again"]) { return .repeatLast }
        // 导航意图（带目的地提取）：「带我去/导航去/去 北京西站」 / "navigate to / take me to X"
        if let dest = parseDestination(text) { return .navigate(dest) }
        if has(["导航", "navigate", "navigation", "directions"]) { return .navigate(nil) }
        return .unknown
    }

    /// 提取导航目的地；无导航意图返回 nil；有意图但没说去哪 → .navigate(nil) 由上面兜底。
    static func parseDestination(_ text: String) -> String? {
        let zhPrefixes = ["带我去", "导航去", "导航到", "我要去", "我想去"]
        for p in zhPrefixes {
            if let r = text.range(of: p) {
                let dest = String(text[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                return dest.isEmpty ? nil : dest
            }
        }
        let lower = text.lowercased()
        for p in ["navigate to ", "take me to ", "directions to "] {
            if let r = lower.range(of: p) {
                let dest = String(text[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                return dest.isEmpty ? nil : dest
            }
        }
        return nil
    }

    /// 「给X发消息(说)Y」/「发消息给X(说)Y」/ "send a message to X saying Y" / "tell X that Y"。
    static func parseSendMessage(_ text: String) -> VoiceCommand? {
        // 中文：给<名>发消息/发信息[说/讲]<内容>
        if let r = text.range(of: #"给(.{1,12}?)发(消息|信息)(说|讲)?(.*)"#, options: .regularExpression) {
            let s = String(text[r])
            if let m = firstMatch(in: s, pattern: #"给(.{1,12}?)发(?:消息|信息)(?:说|讲)?(.*)"#) {
                let body = m.1.trimmingCharacters(in: .whitespacesAndNewlines)
                if !body.isEmpty { return .sendMessage(to: m.0, text: body) }
                return .messages // 没带内容：打开消息界面让用户口述
            }
        }
        // 中文语序二：发消息给<名>[说]<内容>
        if let m = firstMatch(in: text, pattern: #"发(?:消息|信息)给(.{1,12}?)(?:说|讲)(.*)"#) {
            let body = m.1.trimmingCharacters(in: .whitespacesAndNewlines)
            if !body.isEmpty { return .sendMessage(to: m.0, text: body) }
        }
        // 英文："send a message to X saying Y" / "message X saying Y" / "tell X that Y"
        if let m = firstMatch(in: text, pattern: #"(?i)(?:send (?:a )?message to|message|tell)\s+(.{1,24}?)\s+(?:saying|that)\s+(.+)"#) {
            let body = m.1.trimmingCharacters(in: .whitespacesAndNewlines)
            if !body.isEmpty { return .sendMessage(to: m.0.trimmingCharacters(in: .whitespaces), text: body) }
        }
        return nil
    }

    /// 第一个正则匹配的两个捕获组。
    private static func firstMatch(in text: String, pattern: String) -> (String, String)? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let m = regex.firstMatch(in: text, range: range), m.numberOfRanges >= 3,
              let r1 = Range(m.range(at: 1), in: text), let r2 = Range(m.range(at: 2), in: text) else { return nil }
        return (String(text[r1]), String(text[r2]))
    }
}
