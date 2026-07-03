import XCTest
@testable import BeeUrEiCore

/// 语音指令解析：中英口语变体、目的地/消息内容提取、不确定回退 unknown。
final class VoiceCommandParserTests: XCTestCase {

    func testCoreIntentsZh() {
        XCTAssertEqual(VoiceCommandParser.parse("救命，帮帮我"), .help)
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
}
