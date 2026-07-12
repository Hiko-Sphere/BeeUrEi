import XCTest
@testable import BeeUrEi

/// 日期分隔（ChatDay）+ 会话草稿（ChatDrafts）：纯逻辑真值表。
/// 分隔判错=跨天历史混成一片；草稿键错=串读他人草稿（隐私）或列表标示失灵。
final class ChatDayDraftTests: XCTestCase {

    private var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return c
    }()
    /// 2026-07-12 12:00 +08:00（固定 now，测试不随运行日期漂移）。
    private let noonMs = 1_783_915_200_000

    func testNeedsSeparatorOnDayChange() {
        // 首条前必有；同日不重复；跨本地日插入。
        XCTAssertTrue(ChatDay.needsSeparator(ts: noonMs, prevTs: nil, calendar: cal))
        XCTAssertFalse(ChatDay.needsSeparator(ts: noonMs, prevTs: noonMs - 3_600_000, calendar: cal))      // 同日 11:00
        XCTAssertTrue(ChatDay.needsSeparator(ts: noonMs, prevTs: noonMs - 24 * 3_600_000, calendar: cal))  // 昨天此刻
        // 边界：昨晚 23:59 → 今天 00:01 虽只差 2 分钟也须分隔（本地日变了）。
        let lateYesterday = noonMs - 12 * 3_600_000 - 60_000   // 昨天 23:59
        let earlyToday = noonMs - 12 * 3_600_000 + 60_000      // 今天 00:01
        XCTAssertTrue(ChatDay.needsSeparator(ts: earlyToday, prevTs: lateYesterday, calendar: cal))
    }

    func testLabelTodayYesterdayOlder() {
        XCTAssertEqual(ChatDay.label(ts: noonMs - 3_600_000, nowMs: noonMs, .zh, calendar: cal), "今天")
        XCTAssertEqual(ChatDay.label(ts: noonMs - 24 * 3_600_000, nowMs: noonMs, .zh, calendar: cal), "昨天")
        XCTAssertEqual(ChatDay.label(ts: noonMs - 3_600_000, nowMs: noonMs, .en, calendar: cal), "Today")
        // 更早：本地化长日期（含年月日即可，不锁具体格式）。
        let older = ChatDay.label(ts: noonMs - 10 * 24 * 3_600_000, nowMs: noonMs, .zh, calendar: cal)
        XCTAssertTrue(older.contains("7") && older.contains("2"), "更早应显日期：\(older)")
    }

    func testDraftRoundTripAndTrimClear() {
        let d = UserDefaults(suiteName: "test-chat-drafts")!
        d.removePersistentDomain(forName: "test-chat-drafts")
        // 存→取回；trim 后为空=清除（发送后/删光后列表不再标）。
        ChatDrafts.save("还没写完的话", userId: "u1", peerId: "p1", groupId: nil, defaults: d)
        XCTAssertEqual(ChatDrafts.preview(userId: "u1", peerId: "p1", groupId: nil, defaults: d), "还没写完的话")
        ChatDrafts.save("   ", userId: "u1", peerId: "p1", groupId: nil, defaults: d)
        XCTAssertNil(ChatDrafts.preview(userId: "u1", peerId: "p1", groupId: nil, defaults: d))
        XCTAssertNil(d.string(forKey: ChatDrafts.key(userId: "u1", peerId: "p1", groupId: nil))) // 真删了键
    }

    func testDraftNamespaceIsolation() {
        let d = UserDefaults(suiteName: "test-chat-drafts2")!
        d.removePersistentDomain(forName: "test-chat-drafts2")
        ChatDrafts.save("A 的草稿", userId: "uA", peerId: "p1", groupId: nil, defaults: d)
        // 换账号/换会话/单聊 vs 群 互不串读（与 web 键格式一致：beeurei:draft:<user>:<kind>:<id>）。
        XCTAssertNil(ChatDrafts.preview(userId: "uB", peerId: "p1", groupId: nil, defaults: d))
        XCTAssertNil(ChatDrafts.preview(userId: "uA", peerId: "p2", groupId: nil, defaults: d))
        XCTAssertNil(ChatDrafts.preview(userId: "uA", peerId: nil, groupId: "p1", defaults: d))
        XCTAssertEqual(ChatDrafts.key(userId: "uA", peerId: "p1", groupId: nil), "beeurei:draft:uA:peer:p1")
        XCTAssertEqual(ChatDrafts.key(userId: nil, peerId: nil, groupId: "g1"), "beeurei:draft:anon:group:g1")
    }
}
