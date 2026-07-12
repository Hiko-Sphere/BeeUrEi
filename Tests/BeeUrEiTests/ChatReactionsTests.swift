import XCTest
@testable import BeeUrEi

/// 逐用户表情回应（reactions[]）：Codable 对齐 + 胶囊/我的表情纯逻辑 + 读屏标签。
/// 此前 ChatMessageInfo 只有旧单字段 reaction，服务端已发的 reactions 数组被 Codable **静默丢弃**——
/// 编译不报错、界面照跑，但永远只显"最新覆盖单角标"，看不到几人回应/谁回应（隐蔽缺口类）。
final class ChatReactionsTests: XCTestCase {

    private func decode(_ json: String) throws -> ChatMessageInfo {
        try JSONDecoder().decode(ChatMessageInfo.self, from: Data(json.utf8))
    }

    // MARK: Codable 对齐（服务端字段不再被丢弃）

    func testDecodesReactionsArray() throws {
        let m = try decode("""
        {"id":"m1","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1,
         "reaction":"👍",
         "reactions":[{"emoji":"👍","count":2,"mine":true,"names":["小明","你"]},
                      {"emoji":"❤️","count":1,"mine":false,"names":["小红"]}]}
        """)
        XCTAssertEqual(m.reactions?.count, 2)
        XCTAssertEqual(m.reactions?[0].emoji, "👍")
        XCTAssertEqual(m.reactions?[0].count, 2)
        XCTAssertEqual(m.reactions?[0].mine, true)
        XCTAssertEqual(m.reactions?[0].names, ["小明", "你"])
        XCTAssertEqual(m.reactions?[1].mine, false)
    }

    func testDecodesWithoutReactionsForOldServer() throws {
        // 老服务端无 reactions 字段 → nil（向后兼容，不崩不假造）。
        let m = try decode("""
        {"id":"m1","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1,"reaction":"👍"}
        """)
        XCTAssertNil(m.reactions)
    }

    // MARK: 胶囊数据（reactionChips）与我的表情（myReaction）

    func testChipsPreferServerAggregate() throws {
        let m = try decode("""
        {"id":"m1","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1,
         "reaction":"❤️","reactions":[{"emoji":"👍","count":3,"mine":false,"names":["A","B","C"]}]}
        """)
        // 有聚合数组时以它为准（旧单字段是"最新覆盖"，可能与聚合不一致）。
        XCTAssertEqual(m.reactionChips.map(\.emoji), ["👍"])
        XCTAssertEqual(m.reactionChips[0].count, 3)
    }

    func testChipsFallBackToLegacySingleField() throws {
        let m = try decode("""
        {"id":"m1","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1,"reaction":"👍"}
        """)
        // 老服务端兜底：合成一枚，mine 未知置 false、无名单。
        XCTAssertEqual(m.reactionChips, [MessageReactionInfo(emoji: "👍", count: 1, mine: false, names: [])])
        // 无任何回应 → 空。
        let bare = try decode("""
        {"id":"m2","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1}
        """)
        XCTAssertTrue(bare.reactionChips.isEmpty)
    }

    func testMyReactionFromAggregateMineFlag() throws {
        let m = try decode("""
        {"id":"m1","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1,
         "reaction":"❤️",
         "reactions":[{"emoji":"👍","count":1,"mine":false,"names":["A"]},
                      {"emoji":"😂","count":2,"mine":true,"names":["B","你"]}]}
        """)
        // 我的表情来自 mine 标志——旧单字段"最新覆盖"（❤️ 是别人后盖的）会误报，不可用。
        XCTAssertEqual(m.myReaction, "😂")
        // 数组在但我没回应 → nil（菜单不显"取消回应"）。
        let notMine = try decode("""
        {"id":"m1","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1,
         "reactions":[{"emoji":"👍","count":1,"mine":false,"names":["A"]}]}
        """)
        XCTAssertNil(notMine.myReaction)
    }

    // MARK: 读屏标签（与网页 aria-label 同措辞）

    func testChipA11yWithNames() {
        XCTAssertEqual(ChatStrings.reactionChipA11y(emoji: "👍", names: ["小明", "你"], count: 2, mine: true, .zh),
                       "👍，小明、你 回应（含你），点击取消")
        XCTAssertEqual(ChatStrings.reactionChipA11y(emoji: "👍", names: ["小明"], count: 1, mine: false, .zh),
                       "👍，小明 回应，点击也回应")
    }

    func testChipA11yCountFallbackAndEnglish() {
        // 无名单（老服务端兜底）退回计数措辞。
        XCTAssertEqual(ChatStrings.reactionChipA11y(emoji: "👍", names: [], count: 3, mine: false, .zh),
                       "👍，3 人回应，点击也回应")
        let en = ChatStrings.reactionChipA11y(emoji: "👍", names: ["Ann"], count: 1, mine: true, .en)
        XCTAssertEqual(en, "👍, reacted by Ann, tap to remove yours")
        for s in [en, ChatStrings.reactionsSummaryA11y([MessageReactionInfo(emoji: "👍", count: 2, mine: false, names: [])], .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
        }
    }
}
