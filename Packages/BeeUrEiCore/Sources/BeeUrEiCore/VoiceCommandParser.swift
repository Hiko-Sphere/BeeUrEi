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
    case guideMe                    // 开始导盲/避障（进入实时避障模式）
    case navigate(String?)          // 导航（可带目的地）
    case goHome                     // 原路返回
    case readText                   // 朗读文字
    case readFullPage               // 读整页文档（多页拼读）
    case banknote                   // 识别纸币
    case scanCode                   // 扫码
    case readBus                    // 识别公交（车号/路线）
    case describePeople             // 描述周围的人（人数/方位）
    case readLight                  // 光线/明暗（找窗户/灯）
    case readColor                  // 识别颜色（配衣服/比色）
    case messages                   // 打开消息
    case sendMessage(to: String, text: String) // 给X发消息说Y
    case find(String)               // 找某个具体物品（已教物品或可找类别，如"找我的钥匙"/"find my keys"）
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

        // 找具体物品：「找我的钥匙」/「帮我找水杯」/ "find my keys"（泛指"找东西"不算，交由 UI 菜单）。
        if let obj = parseFindTarget(text) { return .find(obj) }

        func has(_ keys: [String]) -> Bool { keys.contains { t.contains($0) } }

        if has(["求助", "救命", "帮帮我", "呼叫", "打电话", "call for help", "get help", "help me", "call family"]) { return .help }
        if has(["我在哪", "我在哪里", "当前位置", "where am i", "my location"]) { return .whereAmI }
        if has(["周围有什么", "附近有什么", "周围", "what's around", "around me", "nearby"]) { return .around }
        if has(["前方有什么", "前面有什么", "前方", "what's ahead", "ahead of me", "in front"]) { return .ahead }
        // 周围的人：关键词避开「周围」（那属 .around）；只在明确问「人」时触发。
        if has(["有几个人", "有没有人", "有人吗", "多少人", "谁在", "描述人", "who is there", "who's there", "how many people", "anyone here", "anyone there", "describe people"]) { return .describePeople }
        if has(["公交", "几路车", "哪路车", "什么车", "几路公交", "公交车", "bus", "which bus", "what bus"]) { return .readBus }
        if has(["多亮", "光线", "亮不亮", "有没有光", "开灯了吗", "灯开着吗", "灯亮着吗", "how bright", "light level", "brightness", "is the light on", "lights on"]) { return .readLight }
        if has(["天气", "下雨", "气温", "weather", "temperature", "rain"]) { return .weather }
        if has(["回家", "原路返回", "返回出发", "带我回去", "go back", "take me back", "backtrack"]) { return .goHome }
        // 读整页须在「读文字」之前：否则「朗读整页」会被 readText 的「朗读」抢走。
        if has(["整页", "整个页面", "读文档", "读整", "读全文", "whole page", "entire page", "full page", "read the page", "read the document", "read document"]) { return .readFullPage }
        if has(["读文字", "念文字", "朗读", "读一下", "read text", "read this", "read it"]) { return .readText }
        if has(["纸币", "钱", "钞票", "多少元", "banknote", "money", "currency", "bill"]) { return .banknote }
        if has(["扫码", "二维码", "条形码", "条码", "scan", "barcode", "qr"]) { return .scanCode }
        if has(["消息", "聊天", "信息", "message", "chat", "inbox"]) { return .messages }
        // 导盲/避障须在通用「看一看」之前匹配（"识别障碍/避障"含"识别"会被 look 抢走）。
        if has(["导盲", "避障", "开始导盲", "实时避障", "obstacle", "guide me", "start guide", "avoidance"]) { return .guideMe }
        // 颜色须在通用「看一看」之前：否则「这是什么颜色」(含"这是什么")、「识别颜色」(含"识别") 会被 look 抢走。
        if has(["颜色", "什么色", "识别颜色", "报颜色", "what color", "which color", "what colour", "which colour", "read color", "color of", "identify color"]) { return .readColor }
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

    /// 提取"找<物品>"的物品名；泛指（东西/物品/things）或空则返回 nil（不作为具体 find，交 UI 菜单）。
    /// 中文长前缀先匹配（"找我的X"取 X 而非"我的X"）；避免把"找东西"当具体物品。
    static func parseFindTarget(_ text: String) -> String? {
        let generic: Set<String> = ["东西", "我的东西", "物品", "东西们", "things", "something", "stuff", "my stuff", "my things", "my belongings"]
        for p in ["帮我找找", "帮我找", "找一下我的", "找一下", "找找我的", "找找", "找我的", "找"] {
            if let r = text.range(of: p) {
                let x = String(text[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                if x.isEmpty || generic.contains(x) { return nil }
                return x
            }
        }
        let lower = text.lowercased()
        for p in ["help me find my ", "help me find ", "find my ", "where is my ", "where's my ", "locate my ", "find ", "locate "] {
            if let r = lower.range(of: p) {
                let x = String(text[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                if x.isEmpty || generic.contains(x.lowercased()) { return nil }
                return x
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
