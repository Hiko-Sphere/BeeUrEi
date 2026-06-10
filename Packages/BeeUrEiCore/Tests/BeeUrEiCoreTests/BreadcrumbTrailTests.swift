import XCTest
@testable import BeeUrEiCore

final class BreadcrumbTrailTests: XCTestCase {

    /// 北纬约 31°，纬度每 0.0001° ≈ 11m。
    private func walk(_ trail: inout BreadcrumbTrail, steps: Int) {
        for i in 0...steps { trail.record(lat: 31.0 + Double(i) * 0.0001, lon: 121.0) }
    }

    func testRecordDeduplicatesJitter() {
        var t = BreadcrumbTrail(minStepMeters: 8)
        XCTAssertTrue(t.record(lat: 31.0, lon: 121.0))
        XCTAssertFalse(t.record(lat: 31.00001, lon: 121.0)) // ~1m 抖动：不记
        XCTAssertTrue(t.record(lat: 31.0001, lon: 121.0))   // ~11m：记
        XCTAssertEqual(t.count, 2)
    }

    func testBacktrackReversesAndEndsAtOrigin() {
        var t = BreadcrumbTrail(minStepMeters: 8)
        walk(&t, steps: 10) // 31.0000 → 31.0010
        let back = t.backtrackWaypoints(minSpacingMeters: 25)
        // 回程第一个航点在“现在的位置”附近（轨迹末端），最后一个是原始起点。
        XCTAssertEqual(back.first?.lat ?? 0, 31.0010, accuracy: 1e-9)
        XCTAssertEqual(back.last?.lat ?? 0, 31.0, accuracy: 1e-9)
    }

    func testBacktrackThinsBySpacing() {
        var t = BreadcrumbTrail(minStepMeters: 8)
        walk(&t, steps: 10) // 11 点，每点 ~11m
        let back = t.backtrackWaypoints(minSpacingMeters: 25)
        XCTAssertLessThan(back.count, t.count) // 抽稀生效
        XCTAssertGreaterThanOrEqual(back.count, 2)
    }

    func testCapStopsRecording() {
        var t = BreadcrumbTrail(minStepMeters: 8, maxPoints: 3)
        walk(&t, steps: 10)
        XCTAssertEqual(t.count, 3)
    }

    func testResetClears() {
        var t = BreadcrumbTrail()
        t.record(lat: 31, lon: 121)
        t.reset()
        XCTAssertEqual(t.count, 0)
        XCTAssertNil(t.start)
    }
}
