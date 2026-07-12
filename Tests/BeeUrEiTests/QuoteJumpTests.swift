import XCTest
@testable import BeeUrEi

/// 引用回复点击跳转：判定纯逻辑 + 双语文案。此前引用预览不可点（静默死区），
/// 回复较早消息时用户无法回看原文。
final class QuoteJumpTests: XCTestCase {

    func testJumpWhenQuotedLoaded() {
        XCTAssertEqual(QuoteJump.outcome(replyTo: "m1", loadedIds: ["m1", "m2"]), .jump("m1"))
    }

    func testNotLoadedWhenQuotedOutsideWindow() {
        // 原消息在更早未加载窗口 → 语音引导（绝不静默无反应）。
        XCTAssertEqual(QuoteJump.outcome(replyTo: "m0", loadedIds: ["m1", "m2"]), .notLoaded)
        XCTAssertEqual(QuoteJump.outcome(replyTo: "m0", loadedIds: []), .notLoaded)
    }

    func testNoneForNonReply() {
        // 非引用消息（nil/空 replyTo）→ 无操作。
        XCTAssertEqual(QuoteJump.outcome(replyTo: nil, loadedIds: ["m1"]), QuoteJump.none)
        XCTAssertEqual(QuoteJump.outcome(replyTo: "", loadedIds: ["m1"]), QuoteJump.none)
    }

    func testStringsBilingual() {
        XCTAssertEqual(ChatStrings.jumpToQuotedAction(.zh), "跳到被引用的消息") // 与 web aria 同措辞
        XCTAssertEqual(ChatStrings.quotedSpeak("小明", "药在抽屉", .zh), "被引用的消息，小明：药在抽屉")
        for s in [ChatStrings.jumpToQuotedAction(.en), ChatStrings.quotedSpeak("Ann", "x", .en), ChatStrings.quotedNotLoaded(.en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
