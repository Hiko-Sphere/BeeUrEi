import XCTest
@testable import BeeUrEiCore

final class HazardCatalogTests: XCTestCase {
    func testHighRiskMembership() {
        let c = HazardCatalog()
        XCTAssertTrue(c.isHighRisk("台阶"))
        XCTAssertTrue(c.isHighRisk("路桩"))
        XCTAssertFalse(c.isHighRisk("行人"))
    }

    func testCustomCatalog() {
        let c = HazardCatalog(highRiskLabels: ["X"])
        XCTAssertTrue(c.isHighRisk("X"))
        XCTAssertFalse(c.isHighRisk("台阶"))
    }
}

final class ObstacleRankerTests: XCTestCase {

    private let ranker = ObstacleRanker()
    private let fov = 68.0

    private func obstacle(_ label: String, x: Double, dist: Double?) -> Obstacle {
        Obstacle(label: label,
                 clock: ClockDirection(normalizedX: x, horizontalFOVDegrees: fov),
                 distanceMeters: dist,
                 confidence: 0.9)
    }

    func testNearerIsMoreDangerous() {
        let near = obstacle("行人", x: 0.5, dist: 1.0)
        let far = obstacle("行人", x: 0.5, dist: 3.0)
        XCTAssertGreaterThan(ranker.dangerScore(near), ranker.dangerScore(far))
        XCTAssertEqual(ranker.mostDangerous([far, near]), near)
    }

    func testCentralIsMoreDangerous() {
        let central = obstacle("行人", x: 0.5, dist: 2.0)
        let peripheral = obstacle("行人", x: 1.0, dist: 2.0)
        XCTAssertGreaterThan(ranker.dangerScore(central), ranker.dangerScore(peripheral))
    }

    func testHighRiskBoost() {
        let hazard = obstacle("台阶", x: 0.5, dist: 2.0)
        let ordinary = obstacle("行人", x: 0.5, dist: 2.0)
        XCTAssertGreaterThan(ranker.dangerScore(hazard), ranker.dangerScore(ordinary))
    }

    func testMostDangerousEmptyIsNil() {
        XCTAssertNil(ranker.mostDangerous([]))
    }

    // 回归：最危险的近区(<0.1m)也要严格单调（修复前 1/d 被封顶为 10 导致同分）。
    func testStrictlyMonotonicInNearZone() {
        let near05 = obstacle("障碍", x: 0.5, dist: 0.05)
        let near10 = obstacle("障碍", x: 0.5, dist: 0.1)
        XCTAssertGreaterThan(ranker.dangerScore(near05), ranker.dangerScore(near10))
        let near02 = obstacle("障碍", x: 0.5, dist: 0.02)
        XCTAssertGreaterThan(ranker.dangerScore(near02), ranker.dangerScore(near05))
    }

    func testRankedOrder() {
        let a = obstacle("行人", x: 0.5, dist: 5.0)
        let b = obstacle("台阶", x: 0.5, dist: 1.0)
        let c = obstacle("行人", x: 1.0, dist: 3.0)
        let ranked = ranker.ranked([a, b, c])
        XCTAssertEqual(ranked.first, b)   // 近 + 高危 → 最危险
    }
}

final class AnnouncementThrottleTests: XCTestCase {

    func testFirstAllowedThenThrottledThenAllowed() {
        var t = AnnouncementThrottle()
        XCTAssertTrue(t.shouldAnnounce(key: "a", now: 0, minGap: 2))
        XCTAssertFalse(t.shouldAnnounce(key: "a", now: 1, minGap: 2))   // 间隔内
        XCTAssertTrue(t.shouldAnnounce(key: "a", now: 2.5, minGap: 2))  // 超过间隔
    }

    func testKeysAreIndependent() {
        var t = AnnouncementThrottle()
        XCTAssertTrue(t.shouldAnnounce(key: "a", now: 0, minGap: 2))
        XCTAssertTrue(t.shouldAnnounce(key: "b", now: 0, minGap: 2))
    }

    func testResetClears() {
        var t = AnnouncementThrottle()
        _ = t.shouldAnnounce(key: "a", now: 0, minGap: 5)
        t.reset()
        XCTAssertTrue(t.shouldAnnounce(key: "a", now: 1, minGap: 5))
    }
}
