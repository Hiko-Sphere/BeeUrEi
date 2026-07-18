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
            ("要带伞吗", .weather), ("今天冷不冷", .weather), ("外面热不热", .weather), ("do i need an umbrella", .weather),
            ("原路返回", .goHome), ("带我回去", .goHome), ("take me back", .goHome),
            ("retrace my steps", .goHome), ("retrace my route", .goHome), ("go back the way i came", .goHome),
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
            ("这俩搭吗", .matchColors), ("这个配吗", .matchColors),
            ("看一看这是什么", .look), ("识别一下", .look), ("what is this", .look),
            ("帮我看看", .look), ("看看这个", .look),
            // "看看X" 兜底守卫：具体意图仍走各自命令，不被 look 的"看看"抢。
            ("看看几点了", .time), ("看看周围有什么", .around), ("看看天气", .weather),
            ("再说一遍", .repeatLast), ("刚才说什么", .repeatLast), ("repeat that", .repeatLast),
            ("没听清", .repeatLast), ("没听清楚", .repeatLast), ("刚才说啥", .repeatLast), ("didn't catch that", .repeatLast), ("come again", .repeatLast),
            ("你会什么", .commands), ("你能做什么", .commands), ("what can you do", .commands),
            ("现在几点", .time), ("几点了", .time), ("报时", .time), ("what time is it", .time),
            ("还有多少电", .battery), ("电量多少", .battery), ("剩多少电", .battery), ("battery level", .battery),
            // 导航进度"还有多远/还要多久"（导航中按需查剩余里程+预计到达）：只匹配不含地名的裸进度问句。
            ("还有多远", .navRemaining), ("还要多久", .navRemaining), ("还有多久", .navRemaining), ("快到了吗", .navRemaining),
            ("还有多长时间", .navRemaining), ("快到了没", .navRemaining), ("how much farther", .navRemaining),
            ("how much longer", .navRemaining), ("how far to go", .navRemaining), ("are we there yet", .navRemaining),
            ("今天几号", .date), ("今天星期几", .date), ("what's the date", .date), ("what day is it", .date),
            ("打开设置", .openSettings), ("设置", .openSettings), ("open settings", .openSettings), ("preferences", .openSettings),
            ("说快点", .adjustSpeech(.faster)), ("太慢了", .adjustSpeech(.faster)), ("speak faster", .adjustSpeech(.faster)),
            ("说慢点", .adjustSpeech(.slower)), ("太快了", .adjustSpeech(.slower)), ("slow down", .adjustSpeech(.slower)),
            ("正常语速", .adjustSpeech(.normal)), ("normal speed", .adjustSpeech(.normal)),
            ("简短点", .adjustVerbosity(.terser)), ("别啰嗦", .adjustVerbosity(.terser)), ("less detail", .adjustVerbosity(.terser)),
            ("详细点", .adjustVerbosity(.moreDetail)), ("多说点", .adjustVerbosity(.moreDetail)), ("tell me more", .adjustVerbosity(.moreDetail)),
            ("找我的钥匙", .find("钥匙")), ("帮我找水杯", .find("水杯")), ("find my wallet", .find("wallet")),
            ("带我去北京西站", .navigate("北京西站")), ("导航到医院", .navigate("医院")),
            ("最近的厕所在哪", .findNearest("厕所")), ("离我最近的药店", .findNearest("药店")),
            ("附近哪里有便利店", .findNearest("便利店")), ("nearest pharmacy", .findNearest("pharmacy")),
            // 冲突守卫：含**地名**的"最近的X有多远"仍走 findNearest（问某地点距离），不被裸进度问句"还有多远"抢。
            ("最近的厕所有多远", .findNearest("厕所")), ("离我最近的药店有多远", .findNearest("药店")),
            ("where can i find a restroom", .findNearest("restroom")),
            ("坐地铁去西单", .transit("西单")), ("坐公交车去医院", .transit("医院")), ("take transit to the airport", .transit("the airport")),
            ("回家", .navigateHome), ("带我回家", .navigateHome), ("take me home", .navigateHome),
            ("去公司", .navigateWork), ("去上班", .navigateWork), ("take me to work", .navigateWork),
        ]
        for (phrase, expected) in cases {
            XCTAssertEqual(VoiceCommandParser.parse(phrase), expected, "『\(phrase)』应解析为 \(expected)")
        }
    }

    func testDescribeSceneAI() {
        // AI 详细描述画面（对标 Be My AI）——多种说法都路由到 .describeScene。
        for p in ["描述场景", "描述画面", "描述一下", "帮我描述", "描述眼前", "描述这个场景",
                  "describe the scene", "describe my surroundings", "what am I looking at",
                  "tell me what you see", "describe this scene"] {
            XCTAssertEqual(VoiceCommandParser.parse(p), .describeScene, "『\(p)』应解析为 describeScene")
        }
    }

    func testDescribeSceneDoesNotStealNeighbors() {
        // 新增 describeScene 不得误抢既有相邻命令（碰撞回归）：
        XCTAssertEqual(VoiceCommandParser.parse("看一看"), .look)          // 通用识别仍是 look
        XCTAssertEqual(VoiceCommandParser.parse("这是什么"), .look)         // "这是什么" 仍 look（未含"描述"）
        XCTAssertEqual(VoiceCommandParser.parse("周围有什么"), .around)     // around 不被"描述"关键字影响
        XCTAssertEqual(VoiceCommandParser.parse("前方有什么"), .ahead)      // ahead 同上
        XCTAssertEqual(VoiceCommandParser.parse("有几个人"), .describePeople) // 描述"人" 仍 describePeople
        XCTAssertEqual(VoiceCommandParser.parse("描述人"), .describePeople)   // "描述人" 归 describePeople（非 describeScene）
        XCTAssertEqual(VoiceCommandParser.parse("说详细点"), .adjustVerbosity(.moreDetail)) // "详细"仍走语速详略，不被 describeScene 吃
    }

    func testCountCashDistinctFromBanknoteAndPeopleAndWallet() {
        // 点钞（数一叠）用 cash 专属说法，均解析到 countCash。
        for p in ["数钱", "点钞", "数一叠钱", "数现金", "帮我数钱", "一共多少张", "count my cash", "count cash", "tally my cash"] {
            XCTAssertEqual(VoiceCommandParser.parse(p), .countCash, "『\(p)』应解析为 countCash")
        }
        // 识**单张**仍走 banknote（未被点钞劫持）——两者刻意区分。
        XCTAssertEqual(VoiceCommandParser.parse("这是多少钱"), .banknote)
        XCTAssertEqual(VoiceCommandParser.parse("认一下钱"), .banknote)
        XCTAssertEqual(VoiceCommandParser.parse("识别纸币"), .banknote)
        // "数一数有几个人"不被点钞劫持（未用裸"数一数"，且 describePeople 在前）。
        XCTAssertEqual(VoiceCommandParser.parse("数一数前面有几个人"), .describePeople)
        // "找我的钱包"仍是找物、绝不被 cash/识币劫持（"钱包"含"钱"但非面值/点钞 token）。
        XCTAssertNotEqual(VoiceCommandParser.parse("找我的钱包"), .countCash)
        XCTAssertNotEqual(VoiceCommandParser.parse("找我的钱包"), .banknote)
    }

    func testFindNearestSpatialVariants() {
        // 各种空间说法都提取到地点类别。
        XCTAssertEqual(VoiceCommandParser.parse("最近的厕所在哪"), .findNearest("厕所"))
        XCTAssertEqual(VoiceCommandParser.parse("离我最近的地铁站"), .findNearest("地铁站"))
        XCTAssertEqual(VoiceCommandParser.parse("带我去最近的医院"), .findNearest("医院"))     // "去最近的"路由到就近找，而非按名字搜"最近的医院"必失败
        XCTAssertEqual(VoiceCommandParser.parse("附近有没有超市"), .findNearest("超市"))
        XCTAssertEqual(VoiceCommandParser.parse("这附近哪里有卫生间"), .findNearest("卫生间"))
        XCTAssertEqual(VoiceCommandParser.parse("最近的公交站怎么走"), .findNearest("公交站"))
        XCTAssertEqual(VoiceCommandParser.parse("closest coffee shop"), .findNearest("coffee shop"))
        XCTAssertEqual(VoiceCommandParser.parse("take me to the nearest bathroom"), .findNearest("bathroom"))
        XCTAssertEqual(VoiceCommandParser.parse("is there a pharmacy nearby"), .findNearest("pharmacy"))
        XCTAssertEqual(VoiceCommandParser.parse("find me the closest restroom"), .findNearest("restroom"))
    }

    func testFindNearestDoesNotStealTemporalOrAround() {
        // 中文"最近"的时间义（近来）不该被当空间"最近"触发就近找地点（具体落到读文字/读消息是既有行为，此处只验不误触）。
        if case .findNearest = VoiceCommandParser.parse("读一下最近的消息") { XCTFail("时间义『最近的消息』不应触发就近找地点") }
        XCTAssertEqual(VoiceCommandParser.parse("最近的新闻"), .unknown)          // 无空间语境+时间宾语→不误触，落 unknown
        XCTAssertEqual(VoiceCommandParser.parse("最近怎么样"), .unknown)
        // 泛问周围仍归 around，不被就近找抢。
        XCTAssertEqual(VoiceCommandParser.parse("周围有什么"), .around)
        XCTAssertEqual(VoiceCommandParser.parse("附近有什么"), .around)
        // 找个人物品仍归 find，不被就近找抢。
        XCTAssertEqual(VoiceCommandParser.parse("找我的钥匙"), .find("钥匙"))
        XCTAssertEqual(VoiceCommandParser.parse("find my wallet"), .find("wallet"))
    }

    func testFindNearestPrecisionDoesNotStealOtherIntents() {
        // 对抗复审揪出的过度匹配（findNearest 排在前面，宽松"哪里有X/有没有X/where can I find X"会抢别的意图）。
        // 精度优先：过度匹配（误导盲人做错的事）比漏匹配（用户改说一次）更糟。
        // F1: "哪里有新消息" 属读消息，不是找地点（"新消息"含"消息"→拒）。
        if case .findNearest = VoiceCommandParser.parse("哪里有新消息") { XCTFail("『哪里有新消息』不应被就近找地点抢") }
        XCTAssertEqual(VoiceCommandParser.parse("哪里有新消息"), .readMessages)
        // F2: "周围/附近有没有人" 属描述周围的人（describePeople 已上移到 around/findNearest 之前）。
        XCTAssertEqual(VoiceCommandParser.parse("周围有没有人"), .describePeople)
        XCTAssertEqual(VoiceCommandParser.parse("附近有没有人"), .describePeople)
        XCTAssertEqual(VoiceCommandParser.parse("这附近有几个人"), .describePeople)
        // idiom："是不是哪里有问题" 不是找地点（"问题"→拒）。
        if case .findNearest = VoiceCommandParser.parse("是不是哪里有问题") { XCTFail("『哪里有问题』不应被就近找地点抢") }
        // F5: "where can I find my keys" 属找个人物品（占有格 my → 让位 find）。
        XCTAssertEqual(VoiceCommandParser.parse("where can i find my keys"), .find("keys"))
        // "哪里有认识的人" 让位（"的人"结尾→拒），不误当地点。
        if case .findNearest = VoiceCommandParser.parse("哪里有认识的人") { XCTFail("『认识的人』不应被就近找地点抢") }
    }

    func testFindNearestStripsTrailingFiller() {
        // F3/F4: 尾部目的短语/疑问词不该泄漏进发给高德的类别关键词。
        XCTAssertEqual(VoiceCommandParser.parse("去最近的便利店买东西"), .findNearest("便利店")) // 剥"买东西"
        XCTAssertEqual(VoiceCommandParser.parse("最近的厕所在哪然后带我去"), .findNearest("厕所"))  // "然后…"截断
        XCTAssertEqual(VoiceCommandParser.parse("what is the nearest coffee shop called"), .findNearest("coffee shop")) // 剥"called"
        XCTAssertEqual(VoiceCommandParser.parse("the nearest pharmacy address"), .findNearest("pharmacy")) // 剥"address"
        // 保留正常类别不误伤。
        XCTAssertEqual(VoiceCommandParser.parse("where can i find a restroom"), .findNearest("restroom"))
        XCTAssertEqual(VoiceCommandParser.parse("附近哪里有便利店"), .findNearest("便利店"))
    }

    func testTransitVsWalkingNavigate() {
        // 带交通方式词 → 公交规划；否则泛"去X"归步行 navigate。
        XCTAssertEqual(VoiceCommandParser.parse("坐公交去北京西站"), .transit("北京西站"))
        XCTAssertEqual(VoiceCommandParser.parse("坐地铁到国贸"), .transit("国贸"))
        XCTAssertEqual(VoiceCommandParser.parse("怎么坐车去机场"), .transit("机场"))
        XCTAssertEqual(VoiceCommandParser.parse("how do i get to the museum by bus"), .transit("the museum")) // 剥尾部"by bus"
        XCTAssertEqual(VoiceCommandParser.parse("take the subway to downtown"), .transit("downtown"))
        // 无交通方式词：仍是步行导航，不被公交抢。
        XCTAssertEqual(VoiceCommandParser.parse("带我去北京西站"), .navigate("北京西站"))
        XCTAssertEqual(VoiceCommandParser.parse("导航到医院"), .navigate("医院"))
        // "这是什么车"是识别公交（readBus），不是坐车出行。
        XCTAssertEqual(VoiceCommandParser.parse("这是什么车"), .readBus)
    }

    func testNavigateHomeWorkVsBacktrackVsTransit() {
        // "回家/去公司" = 导航到已存地址；"原路返回/带我回去" = 面包屑折返（不同意图，勿混）。
        XCTAssertEqual(VoiceCommandParser.parse("回家"), .navigateHome)
        XCTAssertEqual(VoiceCommandParser.parse("带我回家"), .navigateHome)
        XCTAssertEqual(VoiceCommandParser.parse("去公司"), .navigateWork)
        XCTAssertEqual(VoiceCommandParser.parse("带我去上班"), .navigateWork)
        XCTAssertEqual(VoiceCommandParser.parse("原路返回"), .goHome)
        XCTAssertEqual(VoiceCommandParser.parse("带我回去"), .goHome)      // 回去=折返，不是回家
        XCTAssertEqual(VoiceCommandParser.parse("take me back"), .goHome)
        // 带交通方式词仍走公交规划（cue 在更前），不被 navigateWork 抢。
        XCTAssertEqual(VoiceCommandParser.parse("坐公交去公司"), .transit("公司"))
        // 复审 F1：目的地名**包含**"去公司/回家"子串，不该被快捷指令抢——整句匹配才算。
        XCTAssertEqual(VoiceCommandParser.parse("带我去公司附近的药店"), .navigate("公司附近的药店"))
        XCTAssertEqual(VoiceCommandParser.parse("导航到回家路小学"), .navigate("回家路小学")) // 回家路=街名
        // 复审 F2：折返 cue（沿原路）+"回家" → 折返，不是导航回家。
        XCTAssertEqual(VoiceCommandParser.parse("带我沿原路回家"), .goHome)
    }

    func testTransitDestinationExtractionRobustness() {
        // 复审语音#1：连接词后的从句不该混进目的地（取第一个目的地）。
        XCTAssertEqual(VoiceCommandParser.parse("坐公交去公司然后回家"), .transit("公司"))
        XCTAssertEqual(VoiceCommandParser.parse("坐公交去机场再去酒店"), .transit("机场"))
        // 复审语音#2：目的地本身是交通方式词/泛站名 → 不当公交目的地（让位，绝不把"坐地铁"当地点去 geocode）。
        if case .transit = VoiceCommandParser.parse("带我去坐地铁") { XCTFail("『坐地铁』不是目的地") }
        if case .transit = VoiceCommandParser.parse("坐地铁到公交站") { XCTFail("泛站名『公交站』不当公交目的地") }
        // 真实车站名（非泛"站"）仍可作目的地。
        XCTAssertEqual(VoiceCommandParser.parse("坐公交到火车站"), .transit("火车站"))
        // 复审语音#4：findNearest 尾部"坐地铁"不泄漏进类别。
        XCTAssertEqual(VoiceCommandParser.parse("去最近的地铁站坐地铁"), .findNearest("地铁站"))
    }

    func testSavedPlaceLabelForTransitDestination() {
        // 「坐公交去公司/回家」的目的地词映射到已保存地点 label——用保存的地址规划公交，非把字面"公司"当地名 geocode
        // （否则命中随便一家公司/搜不到），补齐与步行 navigateWork 的口径缺口。
        XCTAssertEqual(VoiceCommandParser.savedPlaceLabel(forDestination: "公司"), "work")
        XCTAssertEqual(VoiceCommandParser.savedPlaceLabel(forDestination: "单位"), "work")
        XCTAssertEqual(VoiceCommandParser.savedPlaceLabel(forDestination: "办公室"), "work")
        XCTAssertEqual(VoiceCommandParser.savedPlaceLabel(forDestination: "work"), "work")
        XCTAssertEqual(VoiceCommandParser.savedPlaceLabel(forDestination: "The Office"), "work") // 去空白/大小写不敏感
        XCTAssertEqual(VoiceCommandParser.savedPlaceLabel(forDestination: "家"), "home")
        XCTAssertEqual(VoiceCommandParser.savedPlaceLabel(forDestination: "家里"), "home")
        XCTAssertEqual(VoiceCommandParser.savedPlaceLabel(forDestination: "home"), "home")
        // **精确整词**：真实公司/大厦名不误命中（照常按名 geocode）。
        XCTAssertNil(VoiceCommandParser.savedPlaceLabel(forDestination: "腾讯公司"))
        XCTAssertNil(VoiceCommandParser.savedPlaceLabel(forDestination: "国贸大厦"))
        XCTAssertNil(VoiceCommandParser.savedPlaceLabel(forDestination: "医院"))
        // 端到端：坐公交去公司 → transit("公司")，其 dest 再经 savedPlaceLabel 映射到 work（上层据此用保存地址规划）。
        XCTAssertEqual(VoiceCommandParser.parse("坐公交去公司"), .transit("公司"))
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
        // 消息内容含天气触发词（"带伞"）仍是 sendMessage：parseSendMessage 先行于 weather，内容不泄漏成天气查询
        // （补 weather 收"带伞/冷不冷/热不热"自然问法后的回归守卫）。
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发消息说记得带伞"), .sendMessage(to: "妈妈", text: "记得带伞"))
        // 救命最高优先：即便含"呼叫"也走 sos。
        XCTAssertEqual(VoiceCommandParser.parse("救命"), .sos)
    }

    func testSendLocationExtraction() {
        // 各语序都提取到收件人。
        XCTAssertEqual(VoiceCommandParser.parse("把我的位置发给妈妈"), .sendLocation(to: "妈妈"))
        XCTAssertEqual(VoiceCommandParser.parse("发位置给小明"), .sendLocation(to: "小明"))
        XCTAssertEqual(VoiceCommandParser.parse("给家人群发位置"), .sendLocation(to: "家人群"))     // 群也可
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发一下我的位置"), .sendLocation(to: "妈妈"))
        XCTAssertEqual(VoiceCommandParser.parse("告诉妈妈我在哪"), .sendLocation(to: "妈妈"))
        XCTAssertEqual(VoiceCommandParser.parse("告诉爸爸我在哪里"), .sendLocation(to: "爸爸"))
        XCTAssertEqual(VoiceCommandParser.parse("share my location with mom"), .sendLocation(to: "mom"))
        XCTAssertEqual(VoiceCommandParser.parse("send my location to my daughter"), .sendLocation(to: "my daughter"))
        XCTAssertEqual(VoiceCommandParser.parse("tell mom where I am"), .sendLocation(to: "mom"))
        // 裸"我在哪"（无收件人）仍是问位置，不被抢。
        XCTAssertEqual(VoiceCommandParser.parse("我在哪"), .whereAmI)
        XCTAssertEqual(VoiceCommandParser.parse("where am i"), .whereAmI)
        // 复审#6/#11：收件人是代词=问自己在哪，不当发位置 → 仍走 whereAmI。
        XCTAssertEqual(VoiceCommandParser.parse("告诉我我在哪"), .whereAmI)
        XCTAssertEqual(VoiceCommandParser.parse("告诉我我在哪里"), .whereAmI)
        XCTAssertEqual(VoiceCommandParser.parse("请告诉我现在我在哪里"), .whereAmI)
        XCTAssertEqual(VoiceCommandParser.parse("tell me where I am"), .whereAmI)
        // 复审#7：慌乱句含"救命"→ 生命攸关，SOS 压过发位置。
        XCTAssertEqual(VoiceCommandParser.parse("救命，把我的位置发给妈妈"), .sos)
        XCTAssertEqual(VoiceCommandParser.parse("emergency, send my location to mom"), .sos)
        // 发消息（含"说"）不被抢；"tell X that Y" 仍是发消息。
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发消息说我在哪"), .sendMessage(to: "妈妈", text: "我在哪"))
        XCTAssertEqual(VoiceCommandParser.parse("tell mom that I'm home"), .sendMessage(to: "mom", text: "I'm home"))
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
        // 裸"聊天"已移除（"陪我聊聊天"含"聊天"会误开消息界面，对抗复审 MED）——改用明确"打开聊天/查看聊天"。
        XCTAssertEqual(VoiceCommandParser.parse("打开聊天"), .messages)
        XCTAssertEqual(VoiceCommandParser.parse("查看聊天"), .messages)
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
        // 光线（亮/开方向）
        XCTAssertEqual(VoiceCommandParser.parse("光线怎么样"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("灯开着吗"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("how bright is it"), .readLight)
        // 光线（暗/关方向——盲人查"是不是黑了"/"灯是不是忘了关"同样刚需；此前整支缺失落 unknown）。
        XCTAssertEqual(VoiceCommandParser.parse("这里暗不暗"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("屋里太暗了"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("灯关了吗"), .readLight)      // 忘没忘关灯（省电/安全）
        XCTAssertEqual(VoiceCommandParser.parse("灯还开着吗"), .readLight)    // "还"插字断了"灯开着吗"连续子串
        XCTAssertEqual(VoiceCommandParser.parse("开着灯吗"), .readLight)      // 语序变体
        XCTAssertEqual(VoiceCommandParser.parse("有没有开灯"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("is it dark in here"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("how dark is it"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("is the light off"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("are the lights off"), .readLight)
        XCTAssertEqual(VoiceCommandParser.parse("is it bright in here"), .readLight)
        // 碰撞守卫：加"暗/关灯"方向后，真·颜色问句仍归 readColor（不被新键截走）。
        XCTAssertEqual(VoiceCommandParser.parse("这是什么颜色"), .readColor)
        XCTAssertEqual(VoiceCommandParser.parse("我这样穿漂亮吗"), .unknown)  // "漂亮吗"含"亮吗"——故意不收裸"亮吗"，避免误判
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

    /// 结束导航（双锚点：停止动词 + 导航词）；开始导航/带路/走路线/公交不被劫；绝不吃"挂断"。
    func testStopNavigation() {
        for p in ["结束导航", "停止导航", "取消导航", "退出导航", "关闭导航", "别导航了", "不导航了",
                  "stop navigation", "end navigation", "cancel navigation", "stop navigating", "exit navigation"] {
            XCTAssertEqual(VoiceCommandParser.parse(p), .stopNavigation, "『\(p)』应解析为 stopNavigation")
        }
        // 对抗：开始/打开导航不是停止。
        XCTAssertEqual(VoiceCommandParser.parse("开始导航"), .navigate(nil))
        XCTAssertEqual(VoiceCommandParser.parse("打开导航"), .navigate(nil))
        XCTAssertEqual(VoiceCommandParser.parse("带我去北京西站"), .navigate("北京西站"))
        XCTAssertEqual(VoiceCommandParser.parse("走家到菜场的路线"), .savedRoute("家到菜场"))
        XCTAssertEqual(VoiceCommandParser.parse("坐地铁去西单"), .transit("西单"))
        // 对抗（安全底线）：绝不把"挂断/停止通话"当成任何命令（危险动作不解析，防误切求助）。
        XCTAssertEqual(VoiceCommandParser.parse("挂断"), .unknown)
        XCTAssertEqual(VoiceCommandParser.parse("停止通话"), .unknown)
    }

    /// 走保存的路线（双锚点：路线/route 词 + 行走动词）；缺动词/缺名字不触发，导航/公交不被劫。
    func testSavedRoute() {
        XCTAssertEqual(VoiceCommandParser.parse("走家到菜场的路线"), .savedRoute("家到菜场"))
        XCTAssertEqual(VoiceCommandParser.parse("带我走家到菜场路线"), .savedRoute("家到菜场"))
        XCTAssertEqual(VoiceCommandParser.parse("按妈妈画的路线走"), .savedRoute("妈妈画"))   // "的"尾剥离
        XCTAssertEqual(VoiceCommandParser.parse("take the home to market route"), .savedRoute("home to market"))
        XCTAssertEqual(VoiceCommandParser.parse("follow route 2"), .savedRoute("2"))
        // 缺名字（裸"走路线"）→ 不触发（落 unknown，而非带空名开导航）。
        XCTAssertNotEqual(VoiceCommandParser.parse("走路线"), .savedRoute(""))
        // 缺行走动词（询问类）→ 不触发。
        if case .savedRoute = VoiceCommandParser.parse("这是什么路线") { XCTFail("询问类不应触发 savedRoute") }
        // 不含"路线"词的导航/公交照旧，不被劫。
        XCTAssertEqual(VoiceCommandParser.parse("带我去北京西站"), .navigate("北京西站"))
        XCTAssertEqual(VoiceCommandParser.parse("坐地铁去西单"), .transit("西单"))
    }

    /// 报平安（安全报到 complete）：陈述式锚点收音；疑问/导航/发消息不被劫。
    func testCheckinSafe() {
        // 正向：常见报平安说法（中/英）。
        for p in ["报平安", "帮我报个平安", "我平安到了", "我平安", "平安到达", "我到家了",
                  "i'm safe", "I am safe", "arrived safely", "I made it home", "mark me safe"] {
            XCTAssertEqual(VoiceCommandParser.parse(p), .checkinSafe, "『\(p)』应解析为 checkinSafe")
        }
        // 对抗：导航中的疑问「我到了吗/快到家了吗」是问是否到达，不是报平安（刻意不收裸"我到了/到家了"）。
        XCTAssertNotEqual(VoiceCommandParser.parse("我到了吗"), .checkinSafe)
        XCTAssertNotEqual(VoiceCommandParser.parse("快到家了吗"), .checkinSafe)
        // 对抗：目的地含"到家"子串的导航（"导航到家乐福"）仍是导航，不被报平安劫走。
        XCTAssertEqual(VoiceCommandParser.parse("导航到家乐福"), .navigate("家乐福"))
        // 对抗：「给妈妈发消息说我平安到了」是发消息（parseSendMessage 先行），内容含"我平安"不改判。
        XCTAssertEqual(VoiceCommandParser.parse("给妈妈发消息说我平安到了"), .sendMessage(to: "妈妈", text: "我平安到了"))
        // 对抗：「回家」仍是导航回家，与报平安互不遮蔽。
        XCTAssertEqual(VoiceCommandParser.parse("回家"), .navigateHome)
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

    /// 对抗审计（VoiceCommandParser 24 处误解析）回归网。盲人的第一交互面，每条都是真实说法误路由的证据。
    /// 断言修复后的**正确**路由；配合 testAuditRegressionsFailOnOldParser 证明这些在旧代码上会错。
    func testAuditMisparseRegressions() {
        func expect(_ text: String, _ want: VoiceCommand, _ why: String) {
            XCTAssertEqual(VoiceCommandParser.parse(text), want, "『\(text)』应为 \(want)（\(why)）")
        }
        // A. banknote 去掉裸"钱"：含"钱包/钱"的找物/其它句不再被误吞成识别纸币（旗舰 bug）。
        expect("找我的钱包", .find("钱包"), "钱包不再触发 banknote")
        expect("帮我找钱包", .find("钱包"), "钱包不再触发 banknote")
        expect("这是多少钱", .banknote, "真·认钱仍走 banknote（回归）")

        // B. SOS 补急救服务说法：打120/报警/叫救护车/call the police 等直达紧急广播，不误落 callContact。
        for p in ["打120", "打110", "报警", "叫救护车", "call an ambulance", "call the police", "call 911"] {
            expect(p, .sos, "急救服务短语→SOS")
        }

        // C. callContact 迭代剥回拨/线路限定 + 首部物主词。
        expect("call mom back", .callContact("mom"), "剥尾部 back")
        expect("给妈妈回个电话", .callContact("妈妈"), "回个电话仍是定向拨打")
        expect("给我妈打电话", .callContact("妈"), "剥首部物主词 我")
        expect("call dad on his cell", .callContact("dad"), "剥线路限定 on his cell")

        // D. facing 去裸"哪个方向/什么方向"：仍认第一人称问法，不再被无关"方向"句误触。
        expect("我朝哪个方向", .facing, "第一人称仍走 facing（回归）")
        expect("which way am i facing", .facing, "英文回归")

        // E. readLight 由"有没有光"收紧为"有没有光线"：不再吞"有没有光盘"这类含"光"的问句。
        expect("光线怎么样", .readLight, "真·问光线仍走 readLight（回归）")

        // F. messages 去裸"聊天/信息"：仍认明确"打开聊天/查看聊天"，不误吞"发信息给X说Y"。
        expect("打开消息", .messages, "明确说法仍走 messages（回归）")
        expect("查看聊天", .messages, "查看聊天仍走 messages")
        expect("发消息给妈妈说我到了", .sendMessage(to: "妈妈", text: "我到了"), "带内容→定向发消息，不落 messages")

        // G. parseFindTarget 否定守卫："找不到路"是迷路陈述，不切成物名去查。
        if case .find = VoiceCommandParser.parse("我找不到路了") { XCTFail("『我找不到路了』不应解析为 find") }
        if case .find = VoiceCommandParser.parse("怎么找不着门了") { XCTFail("『怎么找不着门了』不应解析为 find") }

        // H. parseTransit 剥目的短语："坐公交去超市买东西"→ transit(超市)，目的短语不混进地理编码。
        expect("坐公交去超市买东西", .transit("超市"), "剥尾部『买东西』")
        expect("坐地铁去医院看病", .transit("医院"), "剥尾部『看病』")

        // I. parseDestination 剥量词"趟"："带我去趟超市"→ navigate(超市)。
        expect("带我去趟超市", .navigate("超市"), "剥量词 趟")

        // J. parseSendLocation 剥收件人物主词："把位置发给我妈"→ sendLocation(妈)。
        expect("把位置发给我妈", .sendLocation(to: "妈"), "剥收件人首部 我")

        // K. parseFindNearest 剥目的短语："最近的超市买东西"类不把动作混进类别。
        expect("附近哪里有便利店", .findNearest("便利店"), "就近找类别（回归）")
    }

    /// 证伪网：把 4 处代表性修复**临时还原**到旧行为，断言旧解析器确实会错——证明这些回归测试真的在防 bug，
    /// 而非恒真。用独立的旧逻辑复刻（不动生产代码），逐条比对"旧结果≠新结果"。
    func testAuditRegressionsFailOnOldParser() {
        // 旧 banknote 含裸"钱"：任何含"钱"的句子（如"找我的钱包"）会被"钱"substring 命中，早于 find 拦下。
        // 复刻旧判定：含"钱"即 banknote。
        let oldBanknoteHitsQianbao = "找我的钱包".contains("钱")
        XCTAssertTrue(oldBanknoteHitsQianbao, "旧代码：含『钱』即误判 banknote，故『找我的钱包』被吞")
        // 新代码：已走 find。
        XCTAssertEqual(VoiceCommandParser.parse("找我的钱包"), .find("钱包"), "新代码：正确走 find")

        // 旧 readLight 含"有没有光"：会把"有没有光盘"substring 命中成 readLight。
        let oldLightHitsGuangpan = "有没有光盘".contains("有没有光")
        XCTAssertTrue(oldLightHitsGuangpan, "旧代码：『有没有光盘』含『有没有光』被误判 readLight")
        // 新代码：不再是 readLight（收紧为『有没有光线』）。
        if case .readLight = VoiceCommandParser.parse("有没有光盘") { XCTFail("新代码：『有没有光盘』不应为 readLight") }

        // 旧 parseFindTarget 无否定守卫：会对"找不到"取"找"后子串当物名。
        // 复刻旧提取：找不到路了 → 取"找"之后 → "不到路了" → normalize → 非空 → 误当 find。
        let oldFindExtract = VoiceCommandParser.normalizeFindTarget(String("我找不到路了".split(separator: "找").last ?? ""))
        XCTAssertFalse(oldFindExtract.isEmpty, "旧代码：『找不到路了』会切出非空垃圾物名『\(oldFindExtract)』")
        // 新代码：否定守卫直接 nil，不作 find。
        if case .find = VoiceCommandParser.parse("我找不到路了") { XCTFail("新代码：否定句不应为 find") }
    }
}
