import XCTest
@testable import BeeUrEiCore

/// 语音指令解析：中英口语变体、目的地/消息内容提取、不确定回退 unknown。
final class VoiceCommandParserTests: XCTestCase {

    /// 全命令"金句"回归网：解析器已长到 20 个命令、含微妙顺序依赖（多命令共享关键字/前缀）。
    /// 用每个命令的多种真实说法断言正确路由，一次性锁死行为、防新增命令引入碰撞。
    func testGoldenPhrasesRouteCorrectly() {
        let cases: [(String, VoiceCommand)] = [
            ("救命", .sos), ("紧急求助", .sos), ("SOS", .sos), ("emergency", .sos), ("一键求救", .sos),
            ("求助", .help), ("帮帮我", .help), ("call for help", .help),
            ("我在哪", .whereAmI), ("我在哪里", .whereAmI), ("where am i", .whereAmI), ("find my location", .whereAmI),
            ("周围有什么", .around), ("附近有什么", .around), ("what's around me", .around),
            ("前方有什么", .ahead), ("前面有什么", .ahead), ("what's ahead", .ahead),
            ("我朝哪个方向", .facing), ("我现在面朝哪", .facing), ("which way am i facing", .facing), ("what direction am i facing", .facing),
            ("这里有几个人", .describePeople), ("有没有人", .describePeople), ("who's there", .describePeople),
            ("几路车", .readBus), ("这是什么车", .readBus), ("which bus is this", .readBus),
            ("光线怎么样", .readLight), ("灯开着吗", .readLight), ("how bright is it", .readLight),
            ("今天天气怎么样", .weather), ("会下雨吗", .weather), ("what's the weather", .weather),
            ("原路返回", .goHome), ("带我回去", .goHome), ("take me back", .goHome),
            ("读整页", .readFullPage), ("读一下整页文档", .readFullPage), ("read the whole page", .readFullPage),
            ("读一下这段文字", .readText), ("念一下", .readText), ("read this text", .readText),
            ("看看保质期", .readDates), ("这个生产日期是多少", .readDates), ("best before when", .readDates), ("has this expired", .readDates),
            ("读一下电话号码", .readPhone), ("念一下电话号码", .readPhone), ("read the phone number", .readPhone),
            ("读一下邮箱地址", .readEmail), ("上面的邮箱是多少", .readEmail), ("read the email", .readEmail),
            ("这是多少钱", .banknote), ("识别纸币", .banknote), ("what banknote", .banknote),
            ("扫一下二维码", .scanCode), ("扫码", .scanCode), ("scan this barcode", .scanCode),
            ("打开消息", .messages), ("查看聊天", .messages), ("open chat", .messages),
            ("开始导盲", .guideMe), ("帮我避障", .guideMe), ("start obstacle avoidance", .guideMe),
            ("这是什么颜色", .readColor), ("什么色", .readColor), ("what color is this", .readColor),
            ("这两件搭配吗", .matchColors), ("颜色搭不搭", .matchColors), ("does this match", .matchColors), ("do these two match", .matchColors),
            ("看一看这是什么", .look), ("识别一下", .look), ("what is this", .look),
            ("再说一遍", .repeatLast), ("刚才说什么", .repeatLast), ("repeat that", .repeatLast),
            ("你会什么", .commands), ("你能做什么", .commands), ("what can you do", .commands),
            ("现在几点", .time), ("几点了", .time), ("报时", .time), ("what time is it", .time),
            ("还有多少电", .battery), ("电量多少", .battery), ("剩多少电", .battery), ("battery level", .battery),
            ("今天几号", .date), ("今天星期几", .date), ("what's the date", .date), ("what day is it", .date),
            ("打开设置", .openSettings), ("设置", .openSettings), ("open settings", .openSettings), ("preferences", .openSettings),
            ("说快点", .adjustSpeech(.faster)), ("太慢了", .adjustSpeech(.faster)), ("speak faster", .adjustSpeech(.faster)),
            ("说慢点", .adjustSpeech(.slower)), ("太快了", .adjustSpeech(.slower)), ("slow down", .adjustSpeech(.slower)),
            ("正常语速", .adjustSpeech(.normal)), ("normal speed", .adjustSpeech(.normal)),
            ("简短点", .adjustVerbosity(.terser)), ("别啰嗦", .adjustVerbosity(.terser)), ("less detail", .adjustVerbosity(.terser)),
            ("详细点", .adjustVerbosity(.moreDetail)), ("多说点", .adjustVerbosity(.moreDetail)), ("tell me more", .adjustVerbosity(.moreDetail)),
            ("找我的钥匙", .find("钥匙")), ("帮我找水杯", .find("水杯")), ("find my wallet", .find("wallet")),
            ("带我去北京西站", .navigate("北京西站")), ("导航到医院", .navigate("医院")),
        ]
        for (phrase, expected) in cases {
            XCTAssertEqual(VoiceCommandParser.parse(phrase), expected, "『\(phrase)』应解析为 \(expected)")
        }
    }

    func testReadPhoneVsCallPerson() {
        // "读电话号码" = 读出号码；"打电话/呼叫" = 拨号给人（help），互不抢。
        XCTAssertEqual(VoiceCommandParser.parse("读一下上面的电话"), .readPhone)
        XCTAssertEqual(VoiceCommandParser.parse("电话号码是多少"), .readPhone)
        XCTAssertEqual(VoiceCommandParser.parse("打电话求助"), .help)      // 泛指拨号给人仍是 help
        XCTAssertEqual(VoiceCommandParser.parse("呼叫亲友"), .help)
    }

    func testCallContactByName() {
        // 定向呼叫具体亲友：提取名字 → callContact；泛指（无名字/占位词）仍落 help。
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈打电话"), .callContact("妈妈"))
        XCTAssertEqual(VoiceCommandParser.parse("给我女儿打个电话"), .callContact("女儿"))   // 剥"我"物主
        XCTAssertEqual(VoiceCommandParser.parse("打电话给小明"), .callContact("小明"))
        XCTAssertEqual(VoiceCommandParser.parse("给张医生回个电话"), .callContact("张医生"))  // 回电话也认
        XCTAssertEqual(VoiceCommandParser.parse("呼叫李阿姨"), .callContact("李阿姨"))
        XCTAssertEqual(VoiceCommandParser.parse("call mom"), .callContact("mom"))
        XCTAssertEqual(VoiceCommandParser.parse("please call my daughter"), .callContact("daughter")) // 剥 my
        // 泛指/占位词绝不当人名去拨——落到 .help 广播（保命：这些是求助意图）。
        XCTAssertEqual(VoiceCommandParser.parse("打电话"), .help)
        XCTAssertEqual(VoiceCommandParser.parse("呼叫"), .help)
        XCTAssertEqual(VoiceCommandParser.parse("给我打电话"), .help) // "我"被剥成空 → 泛指 help
        XCTAssertEqual(VoiceCommandParser.parse("call for help"), .help)
        XCTAssertEqual(VoiceCommandParser.parse("call family"), .help)
        XCTAssertEqual(VoiceCommandParser.parse("呼叫家人"), .help)
        // 发消息给具体人仍是 sendMessage（parseSendMessage 先行），不被 callContact 抢。
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发消息说我到了"), .sendMessage(to: "妈妈", text: "我到了"))
        // 救命最高优先：即便含"呼叫"也走 sos。
        XCTAssertEqual(VoiceCommandParser.parse("救命"), .sos)
    }

    func testReadMessagesVsOpenMessages() {
        // "读/念消息""有新消息吗" → 朗读未读；"打开消息/聊天" → 只开界面（互不抢，且不被 readText 的"读一下"抢）。
        XCTAssertEqual(VoiceCommandParser.parse("读一下消息"), .readMessages)
        XCTAssertEqual(VoiceCommandParser.parse("念消息"), .readMessages)
        XCTAssertEqual(VoiceCommandParser.parse("有新消息吗"), .readMessages)
        XCTAssertEqual(VoiceCommandParser.parse("有没有未读消息"), .readMessages)
        XCTAssertEqual(VoiceCommandParser.parse("read my messages"), .readMessages)
        XCTAssertEqual(VoiceCommandParser.parse("any new messages"), .readMessages)
        XCTAssertEqual(VoiceCommandParser.parse("打开消息"), .messages)
        XCTAssertEqual(VoiceCommandParser.parse("聊天"), .messages)
        XCTAssertEqual(VoiceCommandParser.parse("open messages"), .messages)
        // "读一下"(无"消息") 仍是读文字，不被误抢。
        XCTAssertEqual(VoiceCommandParser.parse("读一下"), .readText)
        // 给某人发消息仍是 sendMessage（parseSendMessage 先行）。
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发消息说我到了"), .sendMessage(to: "妈妈", text: "我到了"))
    }

    func testReadDatesVsTodayDateVsReadText() {
        // 包装日期意图 → readDates；今天几号 → date；读文字 → readText（互不抢）。
        XCTAssertEqual(VoiceCommandParser.parse("看看保质期"), .readDates)
        XCTAssertEqual(VoiceCommandParser.parse("生产日期是哪天"), .readDates) // 含"日期"但先被 readDates 捕获
        XCTAssertEqual(VoiceCommandParser.parse("has this expired"), .readDates)
        XCTAssertEqual(VoiceCommandParser.parse("今天几号"), .date)           // 裸"几号/日期"仍归今天日期
        XCTAssertEqual(VoiceCommandParser.parse("今天日期"), .date)
        XCTAssertEqual(VoiceCommandParser.parse("读一下文字"), .readText)
    }

    func testMatchColorsBeatsReadColorOnMatchIntent() {
        // "搭/配"意图走配色比对，纯问色仍走 readColor。
        XCTAssertEqual(VoiceCommandParser.parse("这两件颜色搭不搭"), .matchColors)
        XCTAssertEqual(VoiceCommandParser.parse("搭配吗"), .matchColors)
        XCTAssertEqual(VoiceCommandParser.parse("does this match my shirt"), .matchColors)
        XCTAssertEqual(VoiceCommandParser.parse("这是什么颜色"), .readColor)   // 纯问色不被抢
        XCTAssertEqual(VoiceCommandParser.parse("what color is this"), .readColor)
    }

    func testFacingDoesNotStealNeighbors() {
        // 朝向命令用具体短语，不误伤 around/ahead/导航。
        XCTAssertEqual(VoiceCommandParser.parse("我朝哪个方向"), .facing)
        XCTAssertEqual(VoiceCommandParser.parse("面朝哪边"), .facing)
        XCTAssertEqual(VoiceCommandParser.parse("which way am I facing"), .facing)
        XCTAssertEqual(VoiceCommandParser.parse("周围有什么"), .around)      // 不被朝向抢
        XCTAssertEqual(VoiceCommandParser.parse("前方有什么"), .ahead)
        XCTAssertEqual(VoiceCommandParser.parse("带我去医院"), .navigate("医院")) // 导航仍正常
    }

    func testCoreIntentsZh() {
        XCTAssertEqual(VoiceCommandParser.parse("救命，帮帮我"), .sos) // 混合语句 SOS 优先：生命攸关压倒协助通话
        XCTAssertEqual(VoiceCommandParser.parse("我在哪里"), .whereAmI)
        XCTAssertEqual(VoiceCommandParser.parse("周围有什么"), .around)
        XCTAssertEqual(VoiceCommandParser.parse("前方有什么"), .ahead)
        XCTAssertEqual(VoiceCommandParser.parse("今天天气怎么样"), .weather)
        XCTAssertEqual(VoiceCommandParser.parse("原路返回"), .goHome)
        XCTAssertEqual(VoiceCommandParser.parse("帮我读一下文字"), .readText)
        XCTAssertEqual(VoiceCommandParser.parse("这张钞票是多少元"), .banknote)
        XCTAssertEqual(VoiceCommandParser.parse("扫一下二维码"), .scanCode)
        XCTAssertEqual(VoiceCommandParser.parse("再说一遍"), .repeatLast)
    }

    func testCoreIntentsEn() {
        XCTAssertEqual(VoiceCommandParser.parse("Call for help"), .help)
        XCTAssertEqual(VoiceCommandParser.parse("Where am I"), .whereAmI)
        XCTAssertEqual(VoiceCommandParser.parse("What's around me"), .around)
        XCTAssertEqual(VoiceCommandParser.parse("How's the weather today"), .weather)
        XCTAssertEqual(VoiceCommandParser.parse("Take me back"), .goHome)
    }

    func testNavigateWithDestination() {
        XCTAssertEqual(VoiceCommandParser.parse("带我去北京西站"), .navigate("北京西站"))
        XCTAssertEqual(VoiceCommandParser.parse("导航到人民医院"), .navigate("人民医院"))
        XCTAssertEqual(VoiceCommandParser.parse("Navigate to Central Park"), .navigate("Central Park"))
        XCTAssertEqual(VoiceCommandParser.parse("开始导航"), .navigate(nil)) // 有意图没目的地
    }

    func testSendMessageExtraction() {
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发消息说我到家了"), .sendMessage(to: "妈妈", text: "我到家了"))
        XCTAssertEqual(VoiceCommandParser.parse("发消息给小明说十点见"), .sendMessage(to: "小明", text: "十点见"))
        XCTAssertEqual(VoiceCommandParser.parse("Send a message to Mom saying I arrived"),
                       .sendMessage(to: "Mom", text: "I arrived"))
        // 没说内容：进入消息界面口述。
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发消息"), .messages)
    }

    func testUnknownFallsBack() {
        XCTAssertEqual(VoiceCommandParser.parse("呃今天吃什么"), .unknown)
        XCTAssertEqual(VoiceCommandParser.parse(""), .unknown)
        // 危险动作刻意不解析（误识别"挂断"可能切断求助）。
        XCTAssertEqual(VoiceCommandParser.parse("挂断电话"), .unknown)
    }

    /// 导盲(避障) vs 看一看(识别) 的关键词顺序不变式：避障须先于通用识别匹配，
    /// 否则同时含"避障"与"识别"的句子会被 look 抢走（安全攸关——"开始避障"绝不能误成普通识别）。
    func testGuideMeBeatsLookOnOverlap() {
        XCTAssertEqual(VoiceCommandParser.parse("开始导盲"), .guideMe)
        XCTAssertEqual(VoiceCommandParser.parse("避障"), .guideMe)
        XCTAssertEqual(VoiceCommandParser.parse("Start guide"), .guideMe)
        XCTAssertEqual(VoiceCommandParser.parse("识别一下"), .look)
        XCTAssertEqual(VoiceCommandParser.parse("看一看这是什么"), .look)
        // 同时含"避障"(导盲)与"识别"(看一看) → 必须判为导盲（顺序不变式）。
        XCTAssertEqual(VoiceCommandParser.parse("避障识别"), .guideMe)
        XCTAssertEqual(VoiceCommandParser.parse("打开消息"), .messages)
        XCTAssertEqual(VoiceCommandParser.parse("open chat"), .messages)
    }

    /// 新增 4 个映射到既有识别功能的语音命令（原先只有 Siri 快捷指令/屏上按钮能触发）。
    func testNewlyVoiceAccessibleFeatures() {
        // 读整页（须先于「读文字」，否则「朗读整页」被 readText 的「朗读」抢走）。
        XCTAssertEqual(VoiceCommandParser.parse("读整页"), .readFullPage)
        XCTAssertEqual(VoiceCommandParser.parse("朗读整页"), .readFullPage)
        XCTAssertEqual(VoiceCommandParser.parse("read the whole page"), .readFullPage)
        XCTAssertEqual(VoiceCommandParser.parse("读文字"), .readText) // 「读文字」仍是逐段读文字，不被整页抢
        // 公交
        XCTAssertEqual(VoiceCommandParser.parse("几路车"), .readBus)
        XCTAssertEqual(VoiceCommandParser.parse("这是什么车"), .readBus)
        XCTAssertEqual(VoiceCommandParser.parse("which bus is this"), .readBus)
        // 周围的人（关键词避开「周围」——那属 around）
        XCTAssertEqual(VoiceCommandParser.parse("这里有几个人"), .describePeople)
        XCTAssertEqual(VoiceCommandParser.parse("有没有人"), .describePeople)
        XCTAssertEqual(VoiceCommandParser.parse("who's there"), .describePeople)
        XCTAssertEqual(VoiceCommandParser.parse("周围有什么"), .around) // 「周围」仍归 around，不被 people 抢
        // 光线
        XCTAssertEqual(VoiceCommandParser.parse("光线怎么样"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("灯开着吗"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("how bright is it"), .readLight)
    }

    /// 找具体物品：提取物名；泛指"找东西"不作为具体 find（交 UI 菜单）。
    func testFindSpecificObject() {
        XCTAssertEqual(VoiceCommandParser.parse("找我的钥匙"), .find("钥匙"))
        XCTAssertEqual(VoiceCommandParser.parse("帮我找水杯"), .find("水杯"))
        XCTAssertEqual(VoiceCommandParser.parse("找钥匙"), .find("钥匙"))
        XCTAssertEqual(VoiceCommandParser.parse("find my keys"), .find("keys"))
        XCTAssertEqual(VoiceCommandParser.parse("where's my wallet"), .find("wallet"))
        // 泛指"找东西"/空 → 不是具体 find（不返回 .find）。
        XCTAssertNotEqual(VoiceCommandParser.parse("找东西"), .find("东西"))
        XCTAssertNotEqual(VoiceCommandParser.parse("找我的东西"), .find("我的东西"))
        // 碰撞守卫：find 置于具体命令之后作兜底——"find my location"归 whereAmI（含"my location"），不被 find 抢。
        XCTAssertEqual(VoiceCommandParser.parse("find my location"), .whereAmI)
        XCTAssertEqual(VoiceCommandParser.parse("我在哪里"), .whereAmI)
    }

    /// 颜色识别（配衣服/比色刚需）须先于通用「看一看」匹配。
    func testReadColorBeatsLookOnOverlap() {
        XCTAssertEqual(VoiceCommandParser.parse("这是什么颜色"), .readColor) // 含"这是什么"，不得被 look 抢
        XCTAssertEqual(VoiceCommandParser.parse("识别颜色"), .readColor)       // 含"识别"，不得被 look 抢
        XCTAssertEqual(VoiceCommandParser.parse("什么颜色"), .readColor)
        XCTAssertEqual(VoiceCommandParser.parse("what color is this"), .readColor)
        // 不含颜色词的通用识别仍归 look。
        XCTAssertEqual(VoiceCommandParser.parse("这是什么"), .look)
        XCTAssertEqual(VoiceCommandParser.parse("识别一下"), .look)
    }

    /// SOS vs help 的边界（安全攸关）：救命/紧急求助=告警广播；求助/帮帮我=协助通话。
    /// 摔倒的盲人喊"救命"必须走告警（倒计时→通知全部亲友+附位置），不是拨一通可能没人接的视频电话。
    /// 语速指令边界：正常/恢复须在 快/慢 之前（"恢复正常语速"含"语速"）；不误伤读文字/念一下。
    /// 详略指令不误伤朗读：裸"读整页/读文字"仍是读文档，只有明确详略说法才 adjustVerbosity。
    /// 发消息容忍量词"发个/发条消息"（对抗复审揪出：极自然口语此前解析失败→误当"打开消息"）。
    func testSendMessageTolerantOfMeasureWord() {
        XCTAssertEqual(VoiceCommandParser.parse("帮我给张医生发个消息说我晚点到"), .sendMessage(to: "张医生", text: "我晚点到"))
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发条信息说我到了"), .sendMessage(to: "妈妈", text: "我到了"))
        XCTAssertEqual(VoiceCommandParser.parse("发个消息给老王说钥匙在门口"), .sendMessage(to: "老王", text: "钥匙在门口"))
        // 无量词的原路径不回归。
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发消息说我到了"), .sendMessage(to: "妈妈", text: "我到了"))
        // 消息正文的客套**不剥**（可能是发给收件人的，与找物不同）。
        XCTAssertEqual(VoiceCommandParser.parse("给老王发消息说钥匙在门口谢谢"), .sendMessage(to: "老王", text: "钥匙在门口谢谢"))
    }

    /// 找物提取剥净首尾填充词（对抗复审揪出）：否则 FindTargetResolver 拿"钥匙在哪里"匹配已教物品必失败。
    func testFindTargetStripsFiller() {
        XCTAssertEqual(VoiceCommandParser.parse("找我的钥匙在哪里"), .find("钥匙"))
        XCTAssertEqual(VoiceCommandParser.parse("找我的钥匙好吗"), .find("钥匙"))
        XCTAssertEqual(VoiceCommandParser.parse("帮我找一下钥匙"), .find("钥匙"))   // 残留前缀"一下"剥掉
        XCTAssertEqual(VoiceCommandParser.parse("找钥匙呢"), .find("钥匙"))
        XCTAssertEqual(VoiceCommandParser.parse("帮我找找我的手机在不在"), .find("手机")) // 多重：前"我的"+尾"在不在"
        XCTAssertEqual(VoiceCommandParser.parse("找一下我的水杯谢谢"), .find("水杯"))
        XCTAssertEqual(VoiceCommandParser.parse("find my keys please"), .find("keys"))
        XCTAssertEqual(VoiceCommandParser.parse("where is my wallet at"), .find("wallet"))
        // 干净输入不被误剥：物名本身不含填充词时原样返回。
        XCTAssertEqual(VoiceCommandParser.parse("找我的钥匙"), .find("钥匙"))
        XCTAssertEqual(VoiceCommandParser.parse("find my wallet"), .find("wallet"))
        // 泛指词"东西"→ generic → nil（不当具体物品）→ 退回 UI 菜单（unknown）。
        XCTAssertEqual(VoiceCommandParser.parse("找一下东西"), .unknown)
        XCTAssertEqual(VoiceCommandParser.parse("找东西"), .unknown)
    }

    /// 目的地解析容忍插入词（对抗复审揪出的真 bug）：赶时间的口语"带我快一点去医院"应 navigate。
    func testDestinationTolerantOfInterjections() {
        XCTAssertEqual(VoiceCommandParser.parse("带我快一点去医院"), .navigate("医院"))
        XCTAssertEqual(VoiceCommandParser.parse("我想现在就去超市"), .navigate("超市"))
        XCTAssertEqual(VoiceCommandParser.parse("我想知道怎么去地铁站"), .navigate("地铁站")) // "怎么去X"也算导航意图
        XCTAssertEqual(VoiceCommandParser.parse("take me quickly to the hospital"), .navigate("the hospital"))
        // 假阳性防护：意图词后无"去X"不误判。
        XCTAssertEqual(VoiceCommandParser.parse("我想起来了"), .unknown)
        XCTAssertEqual(VoiceCommandParser.parse("我要买东西"), .unknown)
        // 标准说法与"带我回去"(goHome)不受影响。
        XCTAssertEqual(VoiceCommandParser.parse("带我去北京西站"), .navigate("北京西站"))
        XCTAssertEqual(VoiceCommandParser.parse("带我回去"), .goHome)
    }

    /// 对抗复审固化：语速/详略的语境词不越界偷走导航/环境/朗读（"详细点"非"详细"的设计经受验证）。
    func testAdjustCommandsDoNotStealNeighbors() {
        XCTAssertEqual(VoiceCommandParser.parse("详细导航到医院"), .navigate("医院"))      // 详细导航≠调详略
        XCTAssertEqual(VoiceCommandParser.parse("简短介绍一下周围"), .around)              // 简短介绍≠调详略
        XCTAssertEqual(VoiceCommandParser.parse("慢一点走"), .unknown)                     // 走慢点≠调语速（无该命令）
        XCTAssertEqual(VoiceCommandParser.parse("公交车太慢了"), .readBus)                 // 公交(早)胜过语速
    }

    func testVerbosityBoundary() {
        XCTAssertEqual(VoiceCommandParser.parse("说详细点"), .adjustVerbosity(.moreDetail))
        XCTAssertEqual(VoiceCommandParser.parse("太啰嗦了，简短点"), .adjustVerbosity(.terser))
        XCTAssertEqual(VoiceCommandParser.parse("读整页文档"), .readFullPage)
        XCTAssertEqual(VoiceCommandParser.parse("读一下这段文字"), .readText)
    }

    func testSpeechRateBoundary() {
        XCTAssertEqual(VoiceCommandParser.parse("恢复正常语速"), .adjustSpeech(.normal))
        XCTAssertEqual(VoiceCommandParser.parse("语速慢一点"), .adjustSpeech(.slower))
        XCTAssertEqual(VoiceCommandParser.parse("说话快一点"), .adjustSpeech(.faster)) // 含"说...快"
        // 不误伤朗读命令：裸"读一下/念一下"仍是 readText。
        XCTAssertEqual(VoiceCommandParser.parse("读一下这段文字"), .readText)
        XCTAssertEqual(VoiceCommandParser.parse("念一下"), .readText)
    }

    func testSosVersusHelpBoundary() {
        // SOS 系：大小写不敏感、中英都认。
        for phrase in ["救命", "救命啊", "紧急求助", "一键求救", "紧急呼救", "sos", "SOS", "Emergency", "this is an emergency"] {
            XCTAssertEqual(VoiceCommandParser.parse(phrase), .sos, "『\(phrase)』应为 .sos")
        }
        // help 系不受影响（回归）。
        for phrase in ["求助", "帮帮我", "呼叫亲友", "打电话给家人", "call for help", "get help", "help me", "call family"] {
            XCTAssertEqual(VoiceCommandParser.parse(phrase), .help, "『\(phrase)』应为 .help")
        }
        // 自述不吃求助的领地：裸 help/帮帮我 仍是 .help（能力自述只认明确问法）。
        XCTAssertEqual(VoiceCommandParser.parse("help me"), .help)
        XCTAssertEqual(VoiceCommandParser.parse("帮帮我"), .help)
        // "紧急求助"含"求助"——顺序保证 SOS 先命中；这条防未来把 sos 检查挪到 help 之后。
        XCTAssertEqual(VoiceCommandParser.parse("紧急求助"), .sos)
    }
}
