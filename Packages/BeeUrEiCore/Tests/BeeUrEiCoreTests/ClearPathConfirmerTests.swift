import XCTest
@testable import BeeUrEiCore

final class ClearPathConfirmerTests: XCTestCase {
    func testNotClearNeverConfirms() {
        let c = ClearPathConfirmer(intervalSeconds: 8)
        XCTAssertFalse(c.update(isClear: false, now: 0))
        XCTAssertFalse(c.update(isClear: false, now: 100))
    }

    func testConfirmsPeriodicallyWhileClear() {
        let c = ClearPathConfirmer(intervalSeconds: 8)
        XCTAssertFalse(c.update(isClear: true, now: 0))   // 刚变通畅，不立刻报
        XCTAssertFalse(c.update(isClear: true, now: 5))
        XCTAssertTrue(c.update(isClear: true, now: 8))    // 8s → 报
        XCTAssertFalse(c.update(isClear: true, now: 10))
        XCTAssertTrue(c.update(isClear: true, now: 16))   // 再 8s → 报
    }

    func testObstacleResets() {
        let c = ClearPathConfirmer(intervalSeconds: 8)
        _ = c.update(isClear: true, now: 0)
        XCTAssertTrue(c.update(isClear: true, now: 8))
        XCTAssertFalse(c.update(isClear: false, now: 9)) // 遇障重置
        XCTAssertFalse(c.update(isClear: true, now: 10)) // 重新计时
        XCTAssertTrue(c.update(isClear: true, now: 18))
    }
}
