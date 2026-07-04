import XCTest
@testable import BeeUrEiCore

/// 剩余路程 + ETA + 里程碑播报判定。
final class RouteRemainingTests: XCTestCase {

    // MARK: - 剩余里程累距

    func testRemainingSumsCurrentThroughManeuversToDest() {
        // 沿赤道一条直线：当前(0,0) → 转向点(0,0.001) → 终点(0,0.002)。每 0.001° 经度 ≈ 111.32m。
        let remaining = RouteRemaining.distanceMeters(
            currentLat: 0, currentLon: 0,
            remainingManeuvers: [Coordinate(lat: 0, lon: 0.001)],
            destination: Coordinate(lat: 0, lon: 0.002))
        XCTAssertNotNil(remaining)
        XCTAssertEqual(remaining!, 222.64, accuracy: 2)   // 两段各 ~111.32m
    }

    func testRemainingNoManeuversIsDirectToDest() {
        // 已过完全部转向、直奔终点：只剩当前→终点一段。
        let remaining = RouteRemaining.distanceMeters(
            currentLat: 0, currentLon: 0, remainingManeuvers: [],
            destination: Coordinate(lat: 0, lon: 0.001))
        XCTAssertEqual(remaining!, 111.32, accuracy: 2)
    }

    func testRemainingNonFiniteReturnsNil() {
        // 坏 GPS 帧："未知不动作"，不给出可能误导的数字（与全库 isFinite 不变量一致）。
        XCTAssertNil(RouteRemaining.distanceMeters(currentLat: .nan, currentLon: 0,
            remainingManeuvers: [], destination: Coordinate(lat: 0, lon: 0.001)))
        XCTAssertNil(RouteRemaining.distanceMeters(currentLat: 0, currentLon: .infinity,
            remainingManeuvers: [], destination: Coordinate(lat: 0, lon: 0.001)))
        // 中途某转向点坐标坏 → 整体 nil。
        XCTAssertNil(RouteRemaining.distanceMeters(currentLat: 0, currentLon: 0,
            remainingManeuvers: [Coordinate(lat: .nan, lon: 0.001)],
            destination: Coordinate(lat: 0, lon: 0.002)))
    }

    // MARK: - 步速夹取 + ETA

    func testEffectiveSpeedUsesMeasuredWhenValid() {
        XCTAssertEqual(RouteRemaining.effectiveWalkingSpeed(rawMps: 1.4), 1.4, accuracy: 0.001)
    }

    func testEffectiveSpeedClampsAndFallsBack() {
        // 无效（CLLocation.speed 无效时为负）/缺测 → 默认步速。
        XCTAssertEqual(RouteRemaining.effectiveWalkingSpeed(rawMps: -1), 1.2, accuracy: 0.001)
        XCTAssertEqual(RouteRemaining.effectiveWalkingSpeed(rawMps: nil), 1.2, accuracy: 0.001)
        XCTAssertEqual(RouteRemaining.effectiveWalkingSpeed(rawMps: .nan), 1.2, accuracy: 0.001)
        // 上车级高速夹到 2.5；驻足级近 0 夹到 0.5。
        XCTAssertEqual(RouteRemaining.effectiveWalkingSpeed(rawMps: 15), 2.5, accuracy: 0.001)
        XCTAssertEqual(RouteRemaining.effectiveWalkingSpeed(rawMps: 0.1), 0.5, accuracy: 0.001)
    }

    func testEtaSeconds() {
        XCTAssertEqual(RouteRemaining.etaSeconds(remainingMeters: 240, speedMps: 1.2)!, 200, accuracy: 0.01)
        XCTAssertNil(RouteRemaining.etaSeconds(remainingMeters: .nan, speedMps: 1.2))
        XCTAssertNil(RouteRemaining.etaSeconds(remainingMeters: 100, speedMps: 0))
    }

    // MARK: - 里程碑播报

    func testAnnouncerFirstFrameOnlyBaselines() {
        var a = RemainingDistanceAnnouncer()
        XCTAssertNil(a.update(remainingMeters: 620))   // 首帧只立基线，不报
    }

    func testAnnouncerFiresOnDownwardCrossing() {
        var a = RemainingDistanceAnnouncer()
        _ = a.update(remainingMeters: 620)             // 基线
        XCTAssertNil(a.update(remainingMeters: 560))   // 还在 500 之上
        XCTAssertEqual(a.update(remainingMeters: 480), 500)  // 跨过 500 → 报 500
        XCTAssertNil(a.update(remainingMeters: 300))   // 500 与 200 间无里程碑
        XCTAssertEqual(a.update(remainingMeters: 190), 200)  // 跨过 200 → 报 200
    }

    func testAnnouncerEachMilestoneOnce_JitterNoRepeat() {
        var a = RemainingDistanceAnnouncer()
        _ = a.update(remainingMeters: 220)
        XCTAssertEqual(a.update(remainingMeters: 190), 200)  // 报 200
        XCTAssertNil(a.update(remainingMeters: 205))         // 抖回 200 之上
        XCTAssertNil(a.update(remainingMeters: 195))         // 再抖下——不重复报 200
    }

    func testAnnouncerSkipsMilestonesStartedBelow() {
        // 全程仅 300 米：1km/500 从未"路过"，绝不误报。
        var a = RemainingDistanceAnnouncer()
        _ = a.update(remainingMeters: 300)             // 基线（已在 500、1000 之下）
        XCTAssertNil(a.update(remainingMeters: 260))   // 不报 500/1000
        XCTAssertEqual(a.update(remainingMeters: 190), 200)  // 只报真正跨过的 200
    }

    func testAnnouncerBigJumpReportsSmallestCrossed() {
        // 一帧大跳（如汇入/GPS 跳）跨过 500 和 200：只报最贴近现实的 200，且 500 不再补报。
        var a = RemainingDistanceAnnouncer()
        _ = a.update(remainingMeters: 620)
        XCTAssertEqual(a.update(remainingMeters: 150), 200)
        XCTAssertNil(a.update(remainingMeters: 140))         // 500 已被标记，不补报
        XCTAssertEqual(a.update(remainingMeters: 90), 100)   // 后续里程碑照常
    }

    func testAnnouncerResetClearsState() {
        var a = RemainingDistanceAnnouncer()
        _ = a.update(remainingMeters: 220)
        XCTAssertEqual(a.update(remainingMeters: 190), 200)
        a.reset()
        _ = a.update(remainingMeters: 220)             // 新目的地：基线重立
        XCTAssertEqual(a.update(remainingMeters: 190), 200)  // 可再次报 200
    }

    func testAnnouncerIgnoresNonFinite() {
        var a = RemainingDistanceAnnouncer()
        _ = a.update(remainingMeters: 220)
        XCTAssertNil(a.update(remainingMeters: .nan))
        XCTAssertNil(a.update(remainingMeters: .infinity))
    }
}
