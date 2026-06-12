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
}
