import Foundation

/// 语音指令意图解析（纯逻辑）：把语音识别出的整句文本映射为 App 动作。
/// 设计原则：宽松匹配（口语多变）、危险动作不做（不解析"挂断"以防误识别切断求助）、
/// 不确定时返回 .unknown 由上层播报"没听懂"并复述可用指令。
public enum VoiceCommand: Equatable, Sendable {
    case sos                        // 紧急求助（SOS 告警：倒计时→通知全部亲友+附位置；区别于 help 的协助通话）
    case help                       // 求助/呼叫亲友（泛指：广播给在线亲友/志愿者）
    case callContact(String)        // 定向呼叫某位具体亲友（"给妈妈打电话"/"call my daughter"）——区别于 help 的泛广播
    case whereAmI                   // 我在哪
    case around                     // 周围有什么
    case ahead                      // 前方有什么
    case facing                     // 我正朝哪个方向（罗盘八方位——盲人看不到罗盘/太阳，建立方向感与找路的基础）
    case weather                    // 天气
    case look                       // 打开识别（看一看）
    case guideMe                    // 开始导盲/避障（进入实时避障模式）
    case navigate(String?)          // 步行导航（可带目的地）
    case transit(String)            // 公交/地铁出行到某地（"坐公交去X"/"take transit to X"）——过城刚需，区别于 navigate 的步行
    case goHome                     // 原路返回（面包屑折返回来路起点）——区别于 navigateHome（导航到已保存的家）
    case navigateHome               // 导航到已保存的"家"地址（"回家"）
    case navigateWork               // 导航到已保存的"公司"地址（"去公司/上班"）
    case readText                   // 朗读文字
    case readDates                  // 读包装日期（保质期/生产日期——盲人看不到食品/药品日期，高频刚需）
    case readPhone                  // 读电话号码（名片/海报上的号码——盲人读不到也拨不了；只读不自动拨）
    case readEmail                  // 读邮箱地址（名片/信笺上的邮箱——盲人读不到也写不了；只读不代发）
    case readFullPage               // 读整页文档（多页拼读）
    case banknote                   // 识别纸币
    case scanCode                   // 扫码
    case readBus                    // 识别公交（车号/路线）
    case describePeople             // 描述周围的人（人数/方位）
    case readLight                  // 光线/明暗（找窗户/灯）
    case readColor                  // 识别颜色（配衣服/比色）
    case matchColors                // 两件配色比对（扫两次判"搭不搭"——盲人配衣决策刚需；harmony 判定在核心已测）
    case readMessages               // 朗读未读消息（"读一下消息/有新消息吗"）——区别于 messages 只打开界面
    case messages                   // 打开消息
    case sendMessage(to: String, text: String) // 给X发消息说Y
    case sendLocation(to: String)   // 把我的位置发给X（"告诉妈妈我在哪"）——盲人免进聊天找按钮，一句话共享位置
    case find(String)               // 找某个具体物品（已教物品或可找类别，如"找我的钥匙"/"find my keys"）
    case findNearest(String)        // 就近找**公共地点类别**（"最近的厕所在哪"/"nearest pharmacy"）——区别于 find(个人物品)与 around(泛问周围)
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

        // SOS 须在**发位置/help 之前**：生命攸关最高优先——"救命，把我的位置发给妈妈"这种慌乱句仍先走告警广播
        // （复审：parseSendLocation 曾抢在 SOS 前，含"救命"的发位置句被劫走不再触发紧急）。
        // 含急救服务的呼救（"call an ambulance/911"/"叫救护车"/"报警"）走 SOS——绝不能被下面的 parseCallContact
        // 当成"拨给一个名叫 ambulance 的联系人"（查无此人、静默失败，慌乱中盲人以为已求助，对抗复审 HIGH）。
        if has(["救命", "紧急求助", "一键求救", "紧急呼救", "sos", "emergency",
                "叫救护车", "打120", "打110", "报警", "call an ambulance", "call ambulance",
                "call 911", "call the police", "call police", "call the fire"]) { return .sos }
        // 发位置（含目标）：须在 whereAmI 之前——"告诉妈妈我在哪"含"我在哪"，但意图是发位置给妈妈；
        // 裸"我在哪"/"告诉我我在哪"（收件人是代词，见 parseSendLocation 排除）返回 nil，仍走 whereAmI。
        if let m = parseSendLocation(text) { return m }
        // 定向呼叫具体亲友须在 .help 之前：两者都含"打电话/呼叫/call"，但"给妈妈打电话/call my daughter"是拨给
        // **某个人**，不是广播求助。提取到具体名字才走 callContact；泛指（"打电话/呼叫/call for help"无名字或名字是
        // "亲友/家人/help/family"等）返回 nil，落到下面的 .help 泛广播。
        if let name = parseCallContact(text) { return .callContact(name) }
        if has(["求助", "帮帮我", "呼叫", "打电话", "call for help", "get help", "help me", "call family"]) { return .help }
        // "where i am"/"where i'm"（陈述语序）与"where am i"（疑问语序）都收——"tell me where I am"（问自己在哪，
        // 收件人是代词、parseSendLocation 已返回 nil）此前因只匹配疑问语序而落到 unknown。
        // 补常见问法：外指的"这是哪里/这是什么地方"、含插入词的"我现在在哪/我在哪儿"（"我现在在哪"断了"我在哪"连续子串）。
        // 均带地点/第一人称锚点，不会误吃"钥匙在哪儿"（那不含"我在哪儿"）。
        if has(["我在哪", "我在哪里", "我在哪儿", "我现在在哪", "我这是在哪", "这是哪里", "这是哪儿", "这是什么地方",
                "当前位置", "where am i", "where i am", "where i'm", "my location"]) { return .whereAmI }
        // 周围的人：只在明确问「人」时触发。**须在 around 与 findNearest 之前**——否则"周围有没有人/附近有没有人"
        // 被 around 的裸"周围"或 findNearest 的"有没有X"抢走（对抗复审 F2：这是先前就被 around 遮蔽的潜在 bug）。
        // 关键词都是明确"人"的问法，不含裸"周围"，故不会误吃"周围有什么"（那仍归 around）。
        if has(["有几个人", "有没有人", "有人吗", "多少人", "谁在", "描述人", "who is there", "who's there", "how many people", "anyone here", "anyone there", "describe people"]) { return .describePeople }
        // 就近找地点（"最近的厕所在哪"/"nearest pharmacy"）须在 .around（"周围有什么"含裸"周围"）与 .find（"找X"）、
        // .navigate（"去X"）之前——否则"周围哪里有药店"被 around 抢、"找最近的厕所"被 find 抢、"去最近的厕所"被导航搜名字失败。
        if let cat = parseFindNearest(text) { return .findNearest(cat) }
        if has(["周围有什么", "附近有什么", "周围", "what's around", "around me", "nearby"]) { return .around }
        if has(["前方有什么", "前面有什么", "前面是什么", "前方是什么", "前边有什么", "前边是什么", "前方", "what's ahead", "ahead of me", "in front"]) { return .ahead }
        // 朝向（罗盘方位）：盲人看不到罗盘/太阳，"我正朝哪"是方向感的基础。置于此处、导航解析之前——用具体短语
        // （"朝哪个方向"/"面朝"/"which way am i facing"）避开与导航("哪个方向走"意图另说)/around 的关键字冲突。
        // 朝向须带**第一人称锚点**——去掉裸"哪个方向/什么方向/哪个方位"，否则"厕所在什么方向"（问某地点方位）
        // 会被误当成"我朝哪"报出自己的罗盘朝向，对盲人是危险误导（对抗复审 HIGH）。
        if has(["朝哪个方向", "朝哪个方位", "我朝哪个方向", "我朝什么方向", "面朝", "朝向", "我朝哪", "我面朝哪", "which way am i facing", "which way i'm facing", "which direction am i", "what direction am i", "which way am i", "my heading", "compass direction"]) { return .facing }
        // 公交/地铁出行须在 readBus（"公交/公交车"识别车辆）之前——都含"公交"，但带**乘坐位交通方式词+目的地**
        // （"坐公交去X"）走公交规划（过城刚需）；无目的地的"几路车/这是什么车"仍归 readBus（parseTransit 无 dest 返 nil）。
        if let dest = parseTransit(text) { return .transit(dest) }
        if has(["公交", "几路车", "哪路车", "什么车", "几路公交", "公交车", "bus", "which bus", "what bus"]) { return .readBus }
        if has(["多亮", "光线", "亮不亮", "有没有光线", "有没有光亮", "开灯了吗", "灯开着吗", "灯亮着吗", "how bright", "light level", "brightness", "is the light on", "lights on"]) { return .readLight }
        if has(["天气", "下雨", "气温", "weather", "temperature", "rain"]) { return .weather }
        // 日常信息（时间/电量/日期）：盲人看不到时钟/电量图标/日历，靠语音随时查——最高频的日常查询。
        // 置于具体命令之后、通用 look 之前：与现有触发词无子串冲突（"打电话"含"电话"非"电量"；readBus 的"几路"非"几点"）。
        if has(["几点", "报时", "报个时", "报一下时间", "报下时间", "告诉我时间", "现在时间", "什么时间", "时间是", "what time", "the time", "tell me the time"]) { return .time }
        if has(["电量", "电池", "多少电", "还有多少电", "剩多少电", "还剩多少电", "battery", "battery level", "power left", "how much power"]) { return .battery }
        // 包装日期（保质期/生产日期）须在 .date（今天几号）之前：这些短语含"日期"，会被 .date 的"日期"抢；
        // 但 .date 的裸"日期"/"几号"仍归 .date（这里的键都不含裸"日期"）。读的是包装印刷日期，非今天日期。
        if has(["保质期", "有效期", "生产日期", "保存期", "赏味期", "读日期", "看日期", "包装日期", "过期", "expir", "best before", "use by", "shelf life"]) { return .readDates }
        if has(["几号", "今天几号", "日期", "星期几", "礼拜几", "周几", "今天星期", "today's date", "what's the date", "what day", "what date"]) { return .date }
        // 原路返回（面包屑折返）须在回家/去公司之前：使"带我沿原路回家"走折返而非回家（复审 F2）。
        if has(["原路返回", "返回出发", "带我回去", "沿原路", "go back", "take me back", "backtrack"]) { return .goHome }
        // 回家/去公司：导航到**已保存的**家/公司地址。用**整句匹配**（去礼貌前后缀后恰好是这些短语），而非子串——
        // 否则"带我去公司附近的药店"（含"去公司"）会被误当"去公司"快捷、导去错地方（复审 F1）。须在步行导航之前
        // （否则"去公司"被 parseDestination 当搜"公司"这个名字）；transit（"坐公交去公司"）在更前，故仍走公交。
        if isWholeCommand(t, ["回家", "回家去", "回趟家", "take me home", "go home", "navigate home", "head home"]) { return .navigateHome }
        if isWholeCommand(t, ["去公司", "到公司", "去上班", "去单位", "到单位", "上班", "去办公室", "到办公室", "办公室", "take me to work", "go to work", "navigate to work", "head to work", "to the office", "go to the office"]) { return .navigateWork }
        // 读电话号码：名片/海报上的号码。用"电话号码/读电话/读号码"等明确说法，与 .help 的"打电话/呼叫"(拨号给人)
        // 区分开——这里是**读出**号码交用户核对，绝不自动拨。置于 look/find 之前。
        if has(["电话号码", "读电话", "读号码", "念电话", "念号码", "读一下电话", "看电话", "上面的电话", "名片电话", "phone number", "read the number", "read the phone", "read number"]) { return .readPhone }
        // 读邮箱地址：名片/信笺上的邮箱。用"邮箱/邮件地址"等明确说法，读出交用户核对再写信（绝不代发）。
        if has(["读邮箱", "邮箱地址", "念邮箱", "读邮件地址", "读一下邮箱", "看邮箱", "上面的邮箱", "read email", "read the email", "email address"]) { return .readEmail }
        // 读消息须在「读文字」(读一下/念一下) 与「打开消息」(消息) 之前：盲人不必进聊天界面逐条滑，一句"读一下
        // 消息/有新消息吗"直接听未读。用"读/念…消息""(有)新消息""未读消息"等明确说法，与"打开消息"(.messages)区分。
        if has(["读消息", "念消息", "读一下消息", "念一下消息", "读未读", "未读消息", "有新消息", "有没有新消息", "有没有消息",
                "read my message", "read messages", "read my messages", "read this message", "read the message", "any new message", "any unread", "unread messages"]) { return .readMessages }
        // 读整页须在「读文字」之前：否则「朗读整页」会被 readText 的「朗读」抢走。
        if has(["整页", "整个页面", "读文档", "读整", "读全文", "whole page", "entire page", "full page", "read the page", "read the document", "read document"]) { return .readFullPage }
        if has(["读文字", "念文字", "朗读", "读一下", "念一下", "念念", "念一念", "念给我听", "读给我听", "read text", "read this", "read it", "read aloud"]) { return .readText }
        // 识币：**不用裸"钱"**——"钱"是"钱包/花钱/有钱"的子串，会把"找我的钱包"劫走误当识币（对抗复审 HIGH）。
        // 改用带面值语义的说法（多少钱/多少元/面额/认钱）；"钱包"不含这些，落到下面 parseFindTarget 正确解析为找物。
        if has(["纸币", "钞票", "多少钱", "多少元", "面额", "认钱", "认一下钱", "banknote", "money", "currency", "bill"]) { return .banknote }
        if has(["扫码", "扫个码", "扫一下码", "扫描二维码", "二维码", "条形码", "条码", "scan", "barcode", "qr"]) { return .scanCode }
        // 打开消息：**去掉裸"聊天"/"信息"**——"聊天"是"聊聊天"子串（"陪我聊聊天"闲聊被误开消息）、"信息"吃掉
        // "航班信息/个人信息/车次信息"等一切含"信息"的句子（对抗复审 MED）。改用"打开聊天/聊天记录"等明确说法。
        if has(["消息", "打开聊天", "查看聊天", "聊天记录", "看消息", "message", "chat", "inbox"]) { return .messages }
        // 打开设置：语言/无障碍/摔倒检测等非语音可调项，语音直达免盲人找按钮。"设置"无其它命令子串冲突。
        if has(["打开设置", "设置", "偏好设置", "settings", "open settings", "preferences"]) { return .openSettings }
        // 导盲/避障须在通用「看一看」之前匹配（"识别障碍/避障"含"识别"会被 look 抢走）。
        if has(["导盲", "避障", "开始导盲", "实时避障", "obstacle", "guide me", "start guide", "avoidance"]) { return .guideMe }
        // 配色比对须在 readColor 之前（"颜色搭不搭"含"颜色"会被 readColor 抢）：明确的"搭/配"意图先走比对。
        if has(["搭配", "搭不搭", "配不配", "配色", "两件搭", "衣服搭", "颜色搭", "does this match", "do these match", "do these two match", "do they match", "colors match", "colours match", "color match", "go together"]) { return .matchColors }
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

    /// 去掉礼貌前缀/尾缀后，整句是否**恰好**是这些短语之一（而非子串）——用于"回家/去公司"这类无参数快捷指令，
    /// 避免"带我去公司附近的药店"被"去公司"子串抢（复审 F1）。入参为已 lowercased 的整句。
    static func isWholeCommand(_ lowered: String, _ phrases: [String]) -> Bool {
        let trimSet = CharacterSet(charactersIn: "。，？！,.?!、").union(.whitespacesAndNewlines)
        var x = lowered.trimmingCharacters(in: trimSet)
        let prefixes = ["带我", "请", "帮我", "我要", "我想", "现在", "导航", "i want to ", "i wanna ", "let's ", "can you ", "please "]
        let suffixes = ["吧", "呢", "啊", "呀", "一下", "了", " now", " please"]
        var changed = true
        while changed {
            changed = false
            for p in prefixes where x.hasPrefix(p) && x.count > p.count { x = String(x.dropFirst(p.count)).trimmingCharacters(in: trimSet); changed = true; break }
            for s in suffixes where x.hasSuffix(s) && x.count > s.count { x = String(x.dropLast(s.count)).trimmingCharacters(in: trimSet); changed = true; break }
        }
        return phrases.contains(x)
    }

    /// 「坐公交/地铁去X」「怎么坐车到X」/ "take transit/the bus to X"、"how do I get to X by subway"：
    /// 提取公交出行目的地。须明确带交通方式词（公交/地铁/坐车/by bus 等），否则不触发（泛"去X"归步行 navigate）。
    /// 目的地为空返回 nil。
    static func parseTransit(_ text: String) -> String? {
        let t = text.lowercased()
        // 交通方式词须在**乘坐位**——"坐{公交/地铁/车}"或"{公交/地铁}去/到"，而非出现在目的地名里（"去地铁站"的"地铁"不算）。
        let zhCue = ["坐公交", "坐地铁", "坐车", "坐公交车", "坐轻轨", "坐公共汽车", "公共交通", "换乘"].contains { text.contains($0) }
            || text.range(of: #"(?:公交|地铁|轻轨|公共汽车)(?:车)?(?:去|到)"#, options: .regularExpression) != nil
        let enCue = ["by bus", "by subway", "by metro", "by transit", "by train", "take transit", "take the bus",
                     "take the subway", "take the metro", "take a bus", "public transport", "public transit", "transit to"].contains { t.contains($0) }
        guard zhCue || enCue else { return nil }
        let punct = CharacterSet(charactersIn: "。，？！,.?!、").union(.whitespacesAndNewlines)
        // 目的地若本身就是交通方式词/泛站名（"坐地铁"/"公交站"/"站"）→ 非真实地点，让位步行导航（复审语音#2/#3）。
        let modeNouns: Set<String> = ["坐地铁", "坐公交", "坐车", "坐公交车", "坐轻轨", "公共交通", "地铁", "公交",
                                      "公交站", "地铁站", "车站", "站", "the subway", "the bus", "the metro",
                                      "transit", "a bus", "the train"]
        func tidy(_ s: Substring) -> String? {
            var x = String(s).trimmingCharacters(in: punct)
            // 连接词处截断（"…然后回家"/"…再去别处"）——只取第一个目的地（复审语音#1，与 parseFindNearest 同款）。
            for cut in ["然后", "再去", "再到", "再坐", " and ", " then "] {
                if let r = x.range(of: cut, options: cut.hasPrefix(" ") ? .caseInsensitive : []) {
                    x = String(x[..<r.lowerBound]).trimmingCharacters(in: punct)
                }
            }
            // 剥尾部交通方式词（"…by bus"/"…坐地铁"）、客套、以及**目的短语**（"…买东西/上厕所/吃饭"——去某地做某事，
            // 地点才是目的地，目的短语混进去会让地理编码搜不到，对抗复审 MED，与 parseFindNearest 同款）。迭代剥多重。
            var cut2 = true
            while cut2 {
                cut2 = false
                for tr in [" by bus", " by subway", " by metro", " by transit", " by train", " please", "怎么走", "怎么去",
                           "坐地铁", "坐公交", "坐车", "买东西", "买点东西", "上厕所", "吃饭", "看病", "办事", "歇脚", "充电"] {
                    if x.lowercased().hasSuffix(tr.lowercased()) && x.count > tr.count { x = String(x.dropLast(tr.count)).trimmingCharacters(in: punct); cut2 = true; break }
                }
            }
            if x.isEmpty || modeNouns.contains(x.lowercased()) || x.hasPrefix("坐") { return nil }
            return x
        }
        // 中文：取**最早**的"去/到"之后作目的地（多目的地取第一个；连接词已在 tidy 截断）。
        let goR = text.range(of: "去"), toR = text.range(of: "到")
        if let r = [goR, toR].compactMap({ $0 }).min(by: { $0.lowerBound < $1.lowerBound }) {
            if let d = tidy(text[r.upperBound...]) { return d }
        }
        // 英文：第一个" to X"（大小写不敏感），尾部" by bus"已在 tidy 里剥。
        if let r = text.range(of: " to ", options: .caseInsensitive) {
            if let d = tidy(text[r.upperBound...]) { return d }
        }
        return nil
    }

    /// 提取导航目的地；无导航意图返回 nil；有意图但没说去哪 → .navigate(nil) 由上面兜底。
    static func parseDestination(_ text: String) -> String? {
        // "带我去趟超市""导航到一趟医院"——口语量词"趟/一趟"混进目的地会让地理编码搜"趟超市"搜不到；剥掉。
        func strip(_ s: String) -> String {
            var x = s
            for m in ["一趟", "趟"] where x.hasPrefix(m) && x.count > m.count { x = String(x.dropFirst(m.count)).trimmingCharacters(in: .whitespacesAndNewlines); break }
            return x
        }
        let zhPrefixes = ["带我去", "导航去", "导航到", "我要去", "我想去"]
        for p in zhPrefixes {
            if let r = text.range(of: p) {
                let dest = strip(String(text[r.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines))
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
                let dest = strip(String(rest[g.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines))
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
        // "找不到/找不着/找不见"是"迷路/找不着东西"的**陈述**（"找不到路了"），不是"找X"命令——绝不切成物名
        // "不到路"去查（垃圾查询，对抗复审 MED）。用具体否定短语（非裸"找不"）避免误伤"帮我找不锈钢杯"。
        if text.contains("找不到") || text.contains("找不着") || text.contains("找不见") { return nil }
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

    /// 「最近的X在哪」「离我最近的X」「附近哪里有X」「哪里有X」「去最近的X」/ "nearest X"/"closest X"/
    /// "where can I find X"/"take me to the nearest X"：提取要**就近查找的公共地点类别**（如"厕所""药店""公交站"）。
    /// 区别于 .find（找个人物品）与 .around（泛问周围有什么）。
    /// **核心难点**：中文"最近"有时间义（"最近的消息"=近来的消息）——故仅在有**空间锚点**
    /// （"离我"/"哪里有"/位置疑问后缀"在哪|怎么走"/"去|到最近的"）或英文 nearest/closest 时才触发；
    /// 类别须非空且非时间类宾语（消息/新闻…），否则返回 nil 不误触。
    static func parseFindNearest(_ text: String) -> String? {
        // 提取到的"类别"其实属于别的意图/非地点 → findNearest 让位（返回 nil），交链上更具体的意图或落 unknown。
        // 精度守卫（对抗复审 F1/F2/F5）：宽松的"哪里有X/有没有X/where can I find X"会误抢读消息/描述人/找物品；
        // 过度匹配会误导盲人做错的事，比漏匹配（用户改说一次）更糟——故宁可拒。
        func notAPlaceCategory(_ x: String) -> Bool {
            if x.isEmpty { return true }
            let lower = x.lowercased()
            // 消息/资讯（时间义"最近"的常见宾语，或"哪里有新消息"）：子串匹配——"新消息"含"消息"也拒。
            if ["消息", "信息", "新闻", "动态", "短信", "message", "news", "text", "email", "notification"].contains(where: { lower.contains($0) }) { return true }
            // 人 → 让位 describePeople（"有没有人"/"哪里有认识的人"）。
            if x == "人" || x == "人吗" || x.hasSuffix("的人") || ["people", "anyone", "someone", "somebody"].contains(lower) { return true }
            // 泛 idiom / 非地点名词。
            if ["问题", "事", "事儿", "事情", "办法", "毛病", "peace", "problem", "trouble", "help"].contains(lower) { return true }
            // 个人物品占有格 → 让位 find（"where can I find my keys"/"我的钥匙"）。
            if lower.hasPrefix("my ") || lower.hasPrefix("our ") || x.hasPrefix("我的") { return true }
            return false
        }
        func clean(_ s: String) -> String? {
            let punct = CharacterSet(charactersIn: "。，？！,.?!、").union(.whitespacesAndNewlines)
            // 尾部：位置疑问/量词/客套 + 常见"目的短语"（…买东西/上厕所）+ 英文尾问词（…called/address）。
            let trails = ["在哪里", "在哪儿", "在哪呢", "在哪", "怎么走", "怎么去", "咋走", "远不远", "有多远",
                          "买东西", "买点东西", "上厕所", "吃饭", "歇脚", "休息", "充电", "坐地铁", "坐公交", "坐车",
                          "呢", "吗", "吧", "啊", "呀",
                          " called", " address", " located", " open", " nearby", " near me", " around here", " please", " to me"]
            let leads = ["一个", "一家", "一间", "一处", "个", "家", "间", "处",
                         "a ", "an ", "the ", "some ", "any "]
            var x = s.trimmingCharacters(in: punct)
            // 连接词处截断（"…然后带我去"/"…再去别处"/"X and Y"/"X then Y"）——只取地点本身。
            for cut in ["然后", "再去", "再到", " and ", " then "] {
                if let r = x.range(of: cut, options: cut.hasPrefix(" ") ? .caseInsensitive : []) {
                    x = String(x[..<r.lowerBound]).trimmingCharacters(in: punct)
                }
            }
            var changed = true
            while changed {
                changed = false
                let xl = x.lowercased()
                for tr in trails where xl.hasSuffix(tr.lowercased()) && x.count > tr.count {
                    x = String(x.dropLast(tr.count)).trimmingCharacters(in: punct); changed = true; break
                }
                for l in leads where x.lowercased().hasPrefix(l.lowercased()) && x.count > l.count {
                    x = String(x.dropFirst(l.count)).trimmingCharacters(in: punct); changed = true; break
                }
            }
            return notAPlaceCategory(x) ? nil : x
        }
        // 中文：均带明确空间语境，避开时间义"最近"。
        let zhPatterns = [
            #"离我最近的(.{1,12}?)$"#,                              // 离我最近的药店
            #"最近的(.{1,12}?)(?:在哪[里儿]?|怎么走|怎么去|有多远)"#,   // 最近的厕所在哪（须空间后缀）
            #"(?:去|到)最近的(.{1,12}?)$"#,                         // (带我)去最近的厕所
            #"(?:附近|周围|这附近|这周围)(?:哪里|哪儿|哪)有(.{1,12}?)$"#, // 附近哪里有便利店
            #"(?:哪里|哪儿)有(.{1,12}?)$"#,                         // 哪里有厕所
            #"(?:附近|周围)有没有(.{1,12}?)$"#,                      // 附近有没有药店
        ]
        for p in zhPatterns {
            if let m = firstMatchSingle(in: text, pattern: p), let c = clean(m) { return c }
        }
        // 英文：只在明确 nearest/closest 或 where-can-I-find / is-there…nearby 时触发（保守，不吃泛问）。
        let enPatterns = [
            #"(?i)(?:the\s+)?(?:nearest|closest)\s+(.{1,30}?)$"#,                       // (the) nearest pharmacy（也吃 "take me to the nearest X"）
            #"(?i)where\s+can\s+i\s+(?:find|get)\s+(?:the\s+|a\s+|an\s+)?(?:nearest\s+|closest\s+)?(.{1,30}?)$"#,
            #"(?i)find\s+(?:me\s+)?(?:the\s+|a\s+|an\s+)?(?:nearest|closest)\s+(.{1,30}?)$"#,
            #"(?i)is\s+there\s+(?:a\s+|an\s+)?(.{1,30}?)\s+(?:nearby|near me|around here)$"#,
        ]
        for p in enPatterns {
            if let m = firstMatchSingle(in: text, pattern: p), let c = clean(m) { return c }
        }
        return nil
    }

    /// 「给X打电话」/「打电话给X」/「呼叫X」/ "call [my] X"：提取要**定向拨打**的联系人名字。
    /// 返回 nil 表示这是泛指求助（无名字，或名字是"帮助/家人/别人/help/family/someone"等占位词），交上层 .help 广播。
    static func parseCallContact(_ text: String) -> String? {
        // 占位词：不是具体联系人，落到 .help（通用求助/呼叫亲友），绝不当成名叫"求助"的人去拨。
        let generic: Set<String> = ["帮助", "求助", "帮手", "帮忙", "亲友", "家人", "家里人", "朋友", "别人", "谁", "人",
                                    "我", "我自己", "自己", "me", "myself",  // "给我打电话/call me" 非拨给联系人，落 help
                                    "help", "for help", "family", "someone", "somebody", "anyone", "assistance", "emergency", "for assistance",
                                    // 急救服务/非人称呼叫目标：不是通讯录里的人，别捏造成 callContact（多数已在 SOS 拦下，这里兜底）。
                                    "救护车", "an ambulance", "ambulance", "911", "the police", "police", "paramedics",
                                    "a taxi", "an uber", "a cab", "a ride", "a doctor", "reception", "the front desk"]
        func clean(_ s: String) -> String? {
            var x = s.trimmingCharacters(in: CharacterSet(charactersIn: "。，？！,.?!、").union(.whitespacesAndNewlines))
            // 尾部客套/回拨语气词/线路限定词（"call mom back"/"on her cell"）——**迭代**剥除（可叠多个），否则会
            // 把"mom back"/"mom on her cell"整段当联系人名去查、必失败（对抗复审）。
            var trimmed = true
            while trimmed {
                trimmed = false
                for tr in [" please", " now", " for me", " back", " later", " on her cell", " on his cell",
                           " on speaker", " on the phone", " on her phone", " on his phone",
                           "一下", "吧", "呢", "吗", "啊", "呀"]
                    where x.lowercased().hasSuffix(tr.lowercased()) && x.count > tr.count {
                    x = String(x.dropLast(tr.count)).trimmingCharacters(in: .whitespacesAndNewlines); trimmed = true; break
                }
            }
            // 去首部物主词（"给我妈妈打电话"→妈妈；英文 my 已在正则里剥，这里兜中文）。
            for ld in ["我的", "我", "the "] where x.lowercased().hasPrefix(ld.lowercased()) && x.count > ld.count {
                x = String(x.dropFirst(ld.count)).trimmingCharacters(in: .whitespacesAndNewlines); break
            }
            if x.isEmpty || generic.contains(x.lowercased()) { return nil }
            return x
        }
        // 中文：给<名>打/拨/回[个]电话
        if let m = firstMatchSingle(in: text, pattern: #"给(.{1,12}?)(?:打|拨|回)[个]?电话"#) { return clean(m) }
        // 中文：打/拨[个电话]给<名> / 打给<名>
        if let m = firstMatchSingle(in: text, pattern: #"(?:打|拨)(?:[个]?电话)?给(.{1,12}?)$"#) { return clean(m) }
        // 中文：呼叫<名>（呼叫单独或"呼叫亲友"等占位由 generic 过滤）
        if let m = firstMatchSingle(in: text, pattern: #"呼叫(.{1,12}?)$"#) { return clean(m) }
        // 英文：[please] call [my] <名>
        if let m = firstMatchSingle(in: text, pattern: #"(?i)\bcall\s+(?:my\s+)?(.{1,24}?)$"#) { return clean(m) }
        return nil
    }

    /// 第一个正则匹配的**单个**捕获组（parseCallContact 用）。
    private static func firstMatchSingle(in text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let m = regex.firstMatch(in: text, range: range), m.numberOfRanges >= 2,
              let r1 = Range(m.range(at: 1), in: text) else { return nil }
        return String(text[r1])
    }

    /// 「把(我的)位置发给X」/「发(我的)位置给X」/「给X发(我的)位置」/「告诉X我在哪」/
    /// "send/share my location to/with X"：提取发位置的收件人。无收件人（裸"我在哪/发位置"）返回 nil。
    static func parseSendLocation(_ text: String) -> VoiceCommand? {
        // 代词占位：收件人若是"我/自己/me/myself"等，说明是问自己在哪（"告诉我我在哪"），而非发给某人——
        // 返回 nil 让上层落到 whereAmI（复审：曾把"告诉我我在哪"误吃成 sendLocation(to:"我")，回归 whereAmI）。
        let pronouns: Set<String> = ["我", "我现在", "自己", "我自己", "咱", "me", "myself"]
        func clean(_ s: String) -> String? {
            var x = s.trimmingCharacters(in: CharacterSet(charactersIn: "。，？！,.?!、").union(.whitespacesAndNewlines))
            // 剥尾部时态/客套（"现在/一下/please/now"），避免"我现在""me now"绕过代词判定。
            for tr in ["现在", "一下", " now", " please"] where x.lowercased().hasSuffix(tr) && x.count > tr.count {
                x = String(x.dropLast(tr.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            // 收件人前导物主词："发给我妈"→联系人"妈"（与 parseCallContact 一致）。仅当其后还有内容才剥，
            // 故裸"我"（发给我=自己）保持不变→落到 pronouns→nil（不给自己发位置，回归 whereAmI 语义）。
            for ld in ["我的", "我"] where x.hasPrefix(ld) && x.count > ld.count {
                x = String(x.dropFirst(ld.count)).trimmingCharacters(in: .whitespacesAndNewlines); break
            }
            if x.isEmpty || pronouns.contains(x.lowercased()) { return nil }
            return x
        }
        let zhPatterns = [
            #"把?我?的?位置发给(.{1,12}?)$"#,           // 把我的位置发给妈妈 / 位置发给妈妈
            #"发我?的?位置给(.{1,12}?)$"#,               // 发位置给妈妈 / 发我的位置给妈妈
            #"给(.{1,12}?)发一?下?我?的?位置$"#,          // 给妈妈发位置 / 给妈妈发一下我的位置
            #"告诉(.{1,12}?)我在哪[里儿]?$"#,             // 告诉妈妈我在哪（裸"我在哪"无收件人不匹配）
        ]
        for p in zhPatterns {
            if let m = firstMatchSingle(in: text, pattern: p), let name = clean(m) { return .sendLocation(to: name) }
        }
        if let m = firstMatchSingle(in: text, pattern: #"(?i)(?:send|share)\s+my\s+location\s+(?:to|with)\s+(.{1,24}?)$"#),
           let name = clean(m) { return .sendLocation(to: name) }
        if let m = firstMatchSingle(in: text, pattern: #"(?i)\btell\s+(.{1,24}?)\s+where\s+i\s+am\b"#),
           let name = clean(m) { return .sendLocation(to: name) }
        return nil
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
