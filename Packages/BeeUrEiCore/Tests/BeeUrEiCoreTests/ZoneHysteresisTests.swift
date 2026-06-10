import XCTest
@testable import BeeUrEiCore

final class ZoneHysteresisTests: XCTestCase {

    func testEnterAndStickInDangerAcrossBoundaryJitter() {
        var h = ZoneHysteresis()
        XCTAssertEqual(h.update(nearest: 0.9), .danger)   // 进 danger
        XCTAssertEqual(h.update(nearest: 1.1), .danger)   // 1.0–1.4 之间抖动：仍 danger（滞回生效）
        XCTAssertEqual(h.update(nearest: 1.3), .danger)
        XCTAssertEqual(h.update(nearest: 1.5), .caution)  // 越过出阈 1.4 → 降级 caution
    }

    func testCautionBoundaryJitterDoesNotFlap() {
        var h = ZoneHysteresis()
        XCTAssertEqual(h.update(nearest: 2.4), .caution)  // 进 caution
        XCTAssertEqual(h.update(nearest: 2.7), .caution)  // 2.5–2.9 间抖动：仍 caution
        XCTAssertEqual(h.update(nearest: 3.0), .clear)    // 越过出阈 2.9 → clear
    }

    func testNilReadingKeepsCurrentZone() {
        var h = ZoneHysteresis()
        XCTAssertEqual(h.update(nearest: 0.8), .danger)
        XCTAssertEqual(h.update(nearest: nil), .danger)   // 数据缺口不闪跳
    }

    func testDangerStraightToClearWhenFar() {
        var h = ZoneHysteresis()
        XCTAssertEqual(h.update(nearest: 0.8), .danger)
        XCTAssertEqual(h.update(nearest: 5.0), .clear)    // 一步走远直接 clear
    }
}
