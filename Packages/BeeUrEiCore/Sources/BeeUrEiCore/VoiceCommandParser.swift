import Foundation

/// 语音指令意图解析（纯逻辑）：把语音识别出的整句文本映射为 App 动作。
/// 设计原则：宽松匹配（口语多变）、危险动作不做（不解析"挂断"以防误识别切断求助）、
/// 不确定时返回 .unknown 由上层播报"没听懂"并复述可用指令。
public enum VoiceCommand: Equatable, Sendable {
    case sos                        // 紧急求助（SOS 告警：倒计时→通知全部亲友+附位置；区别于 help 的协助通话）
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
    case adjustSpeech(SpeechRateAdjust) // 语音调语速：说快点/说慢点/正常语速（找滑块成本高，语速最常想即时调）
    case adjustVerbosity(VerbosityAdjust) // 语音调详略：说简短点/说详细点（赶路想精简/熟悉后嫌啰嗦）
    case commands                   // 自述能做什么（盲人无法浏览 UI 发现功能——语音能力必须能被语音发现）
    case repeatLast                 // 重复刚才的播报
    case time                       // 现在几点（盲人看不到时钟，最高频的语音查询）
    case battery                    // 电量还剩多少（手机没电=丢失导航/求助工具，盲人尤需随时确认）
    case date                       // 今天几号/星期几
    case openSettings               // 打开设置（语言/无障碍/摔倒检测等非语音可调项——语音直达免找按钮）
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

        // SOS 须在 help 之前：两者都含"求助"类词，但"救命/紧急求助"是生命攸关的告警广播（倒计时→
        // 通知全部亲友+附位置），不是"打视频电话等人接"。摔倒的盲人喊"救命"必须走告警而非拨号。
        if has(["救命", "紧急求助", "一键求救", "紧急呼救", "sos", "emergency"]) { return .sos }
        if has(["求助", "帮帮我", "呼叫", "打电话", "call for help", "get help", "help me", "call family"]) { return .help }
        if has(["我在哪", "我在哪里", "当前位置", "where am i", "my location"]) { return .whereAmI }
        if has(["周围有什么", "附近有什么", "周围", "what's around", "around me", "nearby"]) { return .around }
        if has(["前方有什么", "前面有什么", "前方", "what's ahead", "ahead of me", "in front"]) { return .ahead }
        // 周围的人：关键词避开「周围」（那属 .around）；只在明确问「人」时触发。
        if has(["有几个人", "有没有人", "有人吗", "多少人", "谁在", "描述人", "who is there", "who's there", "how many people", "anyone here", "anyone there", "describe people"]) { return .describePeople }
        if has(["公交", "几路车", "哪路车", "什么车", "几路公交", "公交车", "bus", "which bus", "what bus"]) { return .readBus }
        if has(["多亮", "光线", "亮不亮", "有没有光", "开灯了吗", "灯开着吗", "灯亮着吗", "how bright", "light level", "brightness", "is the light on", "lights on"]) { return .readLight }
        if has(["天气", "下雨", "气温", "weather", "temperature", "rain"]) { return .weather }
        // 日常信息（时间/电量/日期）：盲人看不到时钟/电量图标/日历，靠语音随时查——最高频的日常查询。
        // 置于具体命令之后、通用 look 之前：与现有触发词无子串冲突（"打电话"含"电话"非"电量"；readBus 的"几路"非"几点"）。
        if has(["几点", "报时", "报个时", "现在时间", "什么时间", "时间是", "what time", "the time", "tell me the time"]) { return .time }
        if has(["电量", "电池", "多少电", "还有多少电", "剩多少电", "还剩多少电", "battery", "battery level", "power left", "how much power"]) { return .battery }
        if has(["几号", "今天几号", "日期", "星期几", "礼拜几", "周几", "今天星期", "today's date", "what's the date", "what day", "what date"]) { return .date }
        if has(["回家", "原路返回", "返回出发", "带我回去", "go back", "take me back", "backtrack"]) { return .goHome }
        // 读整页须在「读文字」之前：否则「朗读整页」会被 readText 的「朗读」抢走。
        if has(["整页", "整个页面", "读文档", "读整", "读全文", "whole page", "entire page", "full page", "read the page", "read the document", "read document"]) { return .readFullPage }
        if has(["读文字", "念文字", "朗读", "读一下", "念一下", "念念", "念一念", "念给我听", "read text", "read this", "read it", "read aloud"]) { return .readText }
        if has(["纸币", "钱", "钞票", "多少元", "banknote", "money", "currency", "bill"]) { return .banknote }
        if has(["扫码", "二维码", "条形码", "条码", "scan", "barcode", "qr"]) { return .scanCode }
        if has(["消息", "聊天", "信息", "message", "chat", "inbox"]) { return .messages }
        // 打开设置：语言/无障碍/摔倒检测等非语音可调项，语音直达免盲人找按钮。"设置"无其它命令子串冲突。
        if has(["打开设置", "设置", "偏好设置", "settings", "open settings", "preferences"]) { return .openSettings }
        // 导盲/避障须在通用「看一看」之前匹配（"识别障碍/避障"含"识别"会被 look 抢走）。
        if has(["导盲", "避障", "开始导盲", "实时避障", "obstacle", "guide me", "start guide", "avoidance"]) { return .guideMe }
        // 颜色须在通用「看一看」之前：否则「这是什么颜色」(含"这是什么")、「识别颜色」(含"识别") 会被 look 抢走。
        if has(["颜色", "什么色", "识别颜色", "报颜色", "what color", "which color", "what colour", "which colour", "read color", "color of", "identify color"]) { return .readColor }
        if has(["看一看", "识别", "这是什么", "拍一下", "look", "what is this", "identify", "recognize"]) { return .look }
        // 自述：刻意不收裸"帮助/help"（那是 .help 求助的领地），只收明确问能力的说法。
        // 语速调节：正常/恢复须在 快/慢 之前（"恢复正常语速"含"语速"但意图是复位）。避免裸"快/慢"误伤。
        if has(["正常语速", "恢复语速", "语速正常", "normal speed", "default speed", "reset speed"]) { return .adjustSpeech(.normal) }
        if has(["说快点", "说快一点", "说话快", "快一点说", "语速快点", "语速快一点", "读快点", "念快点", "太慢了", "speak faster", "talk faster", "too slow", "faster please"]) { return .adjustSpeech(.faster) }
        if has(["说慢点", "说慢一点", "说话慢", "慢一点说", "语速慢点", "语速慢一点", "读慢点", "念慢点", "太快了", "太快听不清", "speak slower", "talk slower", "too fast", "slower please", "slow down"]) { return .adjustSpeech(.slower) }
        // 详略：简短须先于详细无所谓（词互斥）；避开"读整页/读文字"的领地——只收明确的详略说法。
        if has(["简短点", "说简短", "说简单点", "别啰嗦", "太啰嗦", "长话短说", "少说点", "concise", "less detail", "be brief", "keep it short"]) { return .adjustVerbosity(.terser) }
        if has(["详细点", "说详细", "详细一点", "多说点", "说清楚点", "说仔细点", "more detail", "be verbose", "tell me more", "more details"]) { return .adjustVerbosity(.moreDetail) }
        if has(["你会什么", "能做什么", "你能做什么", "有什么功能", "都能干什么", "what can you do", "what can i say", "voice commands", "list commands"]) { return .commands }
        if has(["再说一遍", "重复", "刚才说什么", "repeat", "say again", "say that again"]) { return .repeatLast }
        // 找具体物品：置于具体命令**之后**作兜底——否则"find my location"(含"find my")会抢掉 whereAmI、
        // "找一下路"等也会误当找物。到这里说明不是任何具体命令，"找X"/"find X" 才解析为找物（泛指"找东西"除外）。
        if let obj = parseFindTarget(text) { return .find(obj) }
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
        // 容忍插入词的口语变体（对抗复审揪出）："带我快一点去医院""我想现在去超市"——精确前缀未命中时，
        // 取意图词后**首个"去"**之后的目的地。仅兜底：标准说法与"带我回去"(→goHome，上游已拦)不受影响。
        // 防假阳性：意图词后须真有"去X"且 X 非空；"我想起来了""我要买东西"(无"去")自然不匹配。
        for intent in ["带我", "我要", "我想"] {
            guard let s0 = text.range(of: intent) else { continue }
            let rest = text[s0.upperBound...]
            if let g = rest.range(of: "去") {
                let dest = String(rest[g.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
                if !dest.isEmpty { return dest }
            }
        }
        // 英文同理："take me quickly to the hospital"——"take me" + 其后 " to " 之后为目的地。
        // 对原始子串大小写不敏感取范围（避免 lowercased 与原串索引错位）。
        if let s0 = text.range(of: "take me", options: .caseInsensitive) {
            let rest = text[s0.upperBound...]
            if let g = rest.range(of: " to ", options: .caseInsensitive) {
                let dest = String(rest[g.upperBound...]).trimmingCharacters(in: .whitespaces)
                if !dest.isEmpty { return dest }
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
                let x = normalizeFindTarget(String(text[r.upperBound...]))
                if x.isEmpty || generic.contains(x) { return nil }
                return x
            }
        }
        let lower = text.lowercased()
        for p in ["help me find my ", "help me find ", "find my ", "where is my ", "where's my ", "locate my ", "find ", "locate "] {
            if let r = lower.range(of: p) {
                let x = normalizeFindTarget(String(text[r.upperBound...]))
                if x.isEmpty || generic.contains(x.lowercased()) { return nil }
                return x
            }
        }
        return nil
    }

    /// 剥净"找<物品>"提取结果的首尾填充词：前缀残留（"一下/我的"——短前缀先命中时残留）+ 尾部客套
    /// （"在哪里/好吗/谢谢/please/at"）。否则 FindTargetResolver 拿"钥匙在哪里"去匹配已教物品必失败。
    /// 迭代剥除（多重填充如"我的手机在不在"→"手机"）；标点/空白一并清。
    static func normalizeFindTarget(_ raw: String) -> String {
        let punct = CharacterSet(charactersIn: "。，？！,.?!、").union(.whitespacesAndNewlines)
        let leads = ["一下我的", "一下", "我的", "找", "帮我", "me my ", "my ", "the "]
        // 尾部：长词先于短词（"在哪里"先于"在哪"，避免剥成"钥匙在"）。
        let trails = ["在哪里", "在哪儿", "在不在", "在哪呢", "在哪", "好不好", "好吗", "好嘛", "谢谢你", "谢谢",
                      "呗", "呢", "吗", "吧", "啊", "呀", "了",
                      " please", " for me", " thank you", " thanks", " at", " now"]
        var x = raw.trimmingCharacters(in: punct)
        var changed = true
        while changed {
            changed = false
            for l in leads where x.hasPrefix(l) && x.count > l.count {
                x = String(x.dropFirst(l.count)).trimmingCharacters(in: punct); changed = true; break
            }
            let xl = x.lowercased()
            for tr in trails where xl.hasSuffix(tr.lowercased()) && x.count > tr.count {
                x = String(x.dropLast(tr.count)).trimmingCharacters(in: punct); changed = true; break
            }
        }
        return x
    }

    /// 「给X发消息(说)Y」/「发消息给X(说)Y」/ "send a message to X saying Y" / "tell X that Y"。
    static func parseSendMessage(_ text: String) -> VoiceCommand? {
        // 中文：给<名>发消息/发信息[说/讲]<内容>
        if let r = text.range(of: #"给(.{1,12}?)发[个条]?(消息|信息)(说|讲)?(.*)"#, options: .regularExpression) {
            let s = String(text[r])
            if let m = firstMatch(in: s, pattern: #"给(.{1,12}?)发[个条]?(?:消息|信息)(?:说|讲)?(.*)"#) {
                let body = m.1.trimmingCharacters(in: .whitespacesAndNewlines)
                if !body.isEmpty { return .sendMessage(to: m.0, text: body) }
                return .messages // 没带内容：打开消息界面让用户口述
            }
        }
        // 中文语序二：发消息给<名>[说]<内容>
        if let m = firstMatch(in: text, pattern: #"发[个条]?(?:消息|信息)给(.{1,12}?)(?:说|讲)(.*)"#) {
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
