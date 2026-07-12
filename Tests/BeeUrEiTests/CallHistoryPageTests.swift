import XCTest
@testable import BeeUrEi

/// 通话记录游标翻页：页解码（hasMore 此前被丢弃）+ 下一页游标纯逻辑。
/// 此前 iOS 只解 {calls}——只能看到头 100 条，更早的历史无入口。
final class CallHistoryPageTests: XCTestCase {

    private func page(_ json: String) throws -> APIClient.CallHistoryPage {
        try JSONDecoder().decode(APIClient.CallHistoryPage.self, from: Data(json.utf8))
    }
    private let rec = #"{"id":"%ID%","callId":"c1","direction":"outgoing","status":"answered","peerId":"u2","peerName":"小明","createdAt":%TS%}"#
    private func recJSON(id: String, ts: Double) -> String {
        rec.replacingOccurrences(of: "%ID%", with: id).replacingOccurrences(of: "%TS%", with: String(ts))
    }

    func testDecodesHasMore() throws {
        let p = try page(#"{"calls":[\#(recJSON(id: "r1", ts: 1000))],"hasMore":true}"#)
        XCTAssertEqual(p.calls.count, 1)
        XCTAssertTrue(p.more)                    // 显"加载更早"
        // 旧服务端无 hasMore → 不显（绝不显死按钮）；显式 false 同。
        XCTAssertFalse(try page(#"{"calls":[]}"#).more)
        XCTAssertFalse(try page(#"{"calls":[],"hasMore":false}"#).more)
    }

    func testNextCursorFromOldestLoaded() throws {
        // 服务端倒序：末尾=最旧 → 游标取它。
        let p = try page(#"{"calls":[\#(recJSON(id: "new", ts: 2000)),\#(recJSON(id: "old", ts: 1000))],"hasMore":true}"#)
        let c = APIClient.CallHistoryPage.nextCursor(after: p.calls)
        XCTAssertEqual(c?.before, 1000)
        XCTAssertEqual(c?.beforeId, "old")
        // before 必须是整数毫秒（服务端 ^\d+$ 校验；Double 带小数点会被拒 → 翻页静默失效）。
        let frac = try page(#"{"calls":[\#(recJSON(id: "x", ts: 1234.9))]}"#)
        XCTAssertEqual(APIClient.CallHistoryPage.nextCursor(after: frac.calls)?.before, 1234)
    }

    func testNextCursorNilWhenEmpty() {
        // 空列表无从翻页（loadMore 早退，不发无意义请求）。
        XCTAssertNil(APIClient.CallHistoryPage.nextCursor(after: []))
    }

    func testStringsBilingual() {
        XCTAssertEqual(AccountStrings.loadEarlierCalls(.zh), "加载更早的通话")
        XCTAssertEqual(AccountStrings.loadedEarlierCalls(1, .en), "Loaded 1 earlier call")
        XCTAssertEqual(AccountStrings.loadedEarlierCalls(5, .en), "Loaded 5 earlier calls")
        for s in [AccountStrings.loadEarlierCalls(.en), AccountStrings.loadedEarlierCalls(2, .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        }
    }
}
