import XCTest
@testable import BeeUrEiCore

/// 点钞累加器：面额→分换算、累加、撤销、清零。钱数错是真金白银，须精确（整数分、无浮点误差）。
final class CashCounterTests: XCTestCase {

    func testAccumulatesYuanAndJiaoInFen() {
        var c = CashCounter()
        XCTAssertTrue(c.isEmpty); XCTAssertEqual(c.totalFen, 0); XCTAssertEqual(c.count, 0)
        c.add(denomination: 100, jiao: false) // 100 元 = 10000 分
        c.add(denomination: 50, jiao: false)  // 50 元 = 5000 分
        c.add(denomination: 5, jiao: true)    // 5 角 = 50 分（**绝不当 5 元**——10 倍钱数错）
        XCTAssertEqual(c.count, 3)
        XCTAssertEqual(c.totalFen, 15050) // 150 元 5 角
        XCTAssertFalse(c.isEmpty)
    }

    func testUndoLastRemovesMostRecentOnly() {
        var c = CashCounter()
        c.add(denomination: 20, jiao: false)  // 2000
        c.add(denomination: 10, jiao: false)  // 1000
        XCTAssertEqual(c.undoLast(), 1000)    // 撤销最近的 10 元
        XCTAssertEqual(c.totalFen, 2000)
        XCTAssertEqual(c.count, 1)
        XCTAssertEqual(c.undoLast(), 2000)
        XCTAssertTrue(c.isEmpty)
        XCTAssertNil(c.undoLast())            // 空时撤销无操作、返回 nil、不崩
        XCTAssertEqual(c.totalFen, 0)
    }

    func testResetClearsAll() {
        var c = CashCounter()
        c.add(denomination: 100, jiao: false); c.add(denomination: 100, jiao: false)
        c.reset()
        XCTAssertTrue(c.isEmpty); XCTAssertEqual(c.totalFen, 0); XCTAssertEqual(c.count, 0)
    }

    func testNonPositiveDenominationIgnored() {
        var c = CashCounter()
        c.add(denomination: 0, jiao: false)
        c.add(denomination: -5, jiao: false)
        XCTAssertTrue(c.isEmpty) // 脏输入不入账（不污染总额）
    }
}
