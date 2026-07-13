import XCTest
@testable import BeeUrEiCore

/// 路名播报判定：首报/重复/间隔压制/漂移防抖/空路名。
final class RoadAnnouncerTests: XCTestCase {

    func testFirstRoadAnnounces() {
        var a = RoadAnnouncer(minInterval: 20)
        XCTAssertEqual(a.update(road: "中山路", now: 0), "中山路")
    }

    func testSameRoadSuppressed() {
        var a = RoadAnnouncer(minInterval: 20)
        _ = a.update(road: "中山路", now: 0)
        XCTAssertNil(a.update(road: "中山路", now: 100))
    }

    func testEmptyOrNilIgnored() {
        var a = RoadAnnouncer(minInterval: 20)
        XCTAssertNil(a.update(road: nil, now: 0))
        XCTAssertNil(a.update(road: "", now: 0))
        // 空读数不应吃掉后续真实路名
        XCTAssertEqual(a.update(road: "中山路", now: 1), "中山路")
    }

    func testChangeWithinIntervalSuppressedThenAnnouncedLater() {
        var a = RoadAnnouncer(minInterval: 20)
        _ = a.update(road: "中山路", now: 0)
        XCTAssertNil(a.update(road: "人民路", now: 5))            // 间隔内压制
        XCTAssertEqual(a.update(road: "人民路", now: 25), "人民路") // 间隔后仍能播（不丢）
    }

    func testIntersectionFlappingDoesNotChatter() {
        var a = RoadAnnouncer(minInterval: 20)
        XCTAssertEqual(a.update(road: "中山路", now: 0), "中山路")
        XCTAssertNil(a.update(road: "人民路", now: 6))   // 路口漂到 B：间隔内压制
        XCTAssertNil(a.update(road: "中山路", now: 12))  // 漂回 A：与已播相同，不重复
        XCTAssertEqual(a.update(road: "人民路", now: 30), "人民路") // 真正走上 B 后照常播
    }

    func testNilDoesNotResetLastRoad() {
        var a = RoadAnnouncer(minInterval: 20)
        _ = a.update(road: "中山路", now: 0)
        XCTAssertNil(a.update(road: nil, now: 30))
        XCTAssertNil(a.update(road: "中山路", now: 40)) // 仍记得已播过中山路
    }

    /// 纯空白路名当作无效（不播"进入 ⟨空⟩"），且不吃掉后续真实路名。
    func testWhitespaceOnlyRoadIgnored() {
        var a = RoadAnnouncer(minInterval: 20)
        XCTAssertNil(a.update(road: "   ", now: 0))
        XCTAssertNil(a.update(road: "\t\n", now: 0))
        XCTAssertEqual(a.update(road: "中山路", now: 1), "中山路") // 空白读数没吃掉真路名
    }

    /// 播报的路名去首尾空白（读起来干净），且带空白变体不被当作换路而重复播报。
    func testRoadTrimmedAndPaddedVariantNotReannounced() {
        var a = RoadAnnouncer(minInterval: 20)
        XCTAssertEqual(a.update(road: "  中山路  ", now: 0), "中山路") // 返回已 trim
        XCTAssertNil(a.update(road: "中山路", now: 100))              // 同一路（去空白后相同）不重复
        XCTAssertNil(a.update(road: " 中山路 ", now: 200))            // 另一种带空白变体同样不重复
    }
}
