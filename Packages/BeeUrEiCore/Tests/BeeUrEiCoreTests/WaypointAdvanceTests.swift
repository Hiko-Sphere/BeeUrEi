import XCTest
@testable import BeeUrEiCore

final class WaypointAdvanceTests: XCTestCase {

    /// 接近后明显走过 → 连续 2 帧确认才推进。
    func testAdvancesAfterPassingWaypoint() {
        var w = WaypointAdvance() // approach<=20, recede>+4, confirm 2
        // 接近（距离递减）：不应推进。
        for d in [18.0, 12, 8, 5, 3] { XCTAssertFalse(w.update(distanceMeters: d)) }
        // 走过最近点(3m)后距离回升：第一帧 >3+4=7 起算，需连续 2 帧确认。
        XCTAssertFalse(w.update(distanceMeters: 8))   // streak 1
        XCTAssertTrue(w.update(distanceMeters: 11))   // streak 2 → 推进
    }

    /// 从未接近到阈值内（一直 >20m）→ 永不推进（不是要去的点 / 在很远处掠过）。
    func testNoAdvanceIfNeverApproached() {
        var w = WaypointAdvance()
        for d in [40.0, 30, 25, 22, 28, 35, 50] { XCTAssertFalse(w.update(distanceMeters: d)) }
    }

    /// 仅单帧抖动尖峰（随后又靠近）不应误推进。
    func testSingleFrameJitterDoesNotAdvance() {
        var w = WaypointAdvance()
        XCTAssertFalse(w.update(distanceMeters: 15))
        XCTAssertFalse(w.update(distanceMeters: 9))    // minDist=9
        XCTAssertFalse(w.update(distanceMeters: 14))   // 14>9+4 → streak 1（疑似走过）
        XCTAssertFalse(w.update(distanceMeters: 7))    // 又靠近：minDist=7，streak 归 0
        XCTAssertFalse(w.update(distanceMeters: 5))    // 继续靠近
        // 真正走过才推进：
        XCTAssertFalse(w.update(distanceMeters: 10))   // 10>5+4 streak 1
        XCTAssertTrue(w.update(distanceMeters: 12))    // streak 2 → 推进
    }

    /// 推进后内部自动复位：可连续判定下一个转向点，互不串扰。
    func testResetsAfterAdvanceForNextWaypoint() {
        var w = WaypointAdvance()
        for d in [6.0, 3] { _ = w.update(distanceMeters: d) }
        XCTAssertFalse(w.update(distanceMeters: 8))
        XCTAssertTrue(w.update(distanceMeters: 9))     // 推进点1
        // 下一个点：远处的旧 minDist 不应残留（否则第一帧就误判走过）。
        XCTAssertFalse(w.update(distanceMeters: 30))   // 新点接近中
        XCTAssertFalse(w.update(distanceMeters: 18))
    }

    /// 非有限 / 负距离输入被安全忽略，不推进、不污染状态。
    func testIgnoresInvalidDistances() {
        var w = WaypointAdvance()
        XCTAssertFalse(w.update(distanceMeters: .nan))
        XCTAssertFalse(w.update(distanceMeters: .infinity))
        XCTAssertFalse(w.update(distanceMeters: -5))
        for d in [6.0, 3] { _ = w.update(distanceMeters: d) }
        XCTAssertFalse(w.update(distanceMeters: 8))
        XCTAssertTrue(w.update(distanceMeters: 9))
    }

    /// 缓慢经过（距离回升不足 recedeMargin）不会过早推进；超过后才推进。
    func testRequiresClearReceding() {
        var w = WaypointAdvance(approachWithinMeters: 20, recedeMarginMeters: 4, confirmFrames: 2)
        for d in [10.0, 4] { XCTAssertFalse(w.update(distanceMeters: d)) } // minDist=4
        // 距离仅微升到 7（<4+4=8）：不算走过。
        XCTAssertFalse(w.update(distanceMeters: 7))
        XCTAssertFalse(w.update(distanceMeters: 7))
        // 升过 8 才开始计 streak。
        XCTAssertFalse(w.update(distanceMeters: 9))  // streak 1
        XCTAssertTrue(w.update(distanceMeters: 10))  // streak 2 → 推进
    }
}
