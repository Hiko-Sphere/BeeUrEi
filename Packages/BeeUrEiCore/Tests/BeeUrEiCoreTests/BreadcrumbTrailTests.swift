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

    /// 容量满：抽稀旧轨迹继续记录（有界），而非静默停录——起点（回程终点）与最近点（回程起步）都永不丢。
    func testCapDecimatesInsteadOfSilentlyStopping() {
        var t = BreadcrumbTrail(minStepMeters: 8, maxPoints: 3)
        walk(&t, steps: 10) // 尝试 11 个点（每点 ~11m）
        XCTAssertLessThanOrEqual(t.count, 3)                                // 容量始终有界
        XCTAssertEqual(t.start?.lat ?? 0, 31.0, accuracy: 1e-9)             // 起点永不丢（回程的终点）
        XCTAssertEqual(t.points.last?.lat ?? 0, 31.0010, accuracy: 1e-9)    // 最近点永不丢（继续记录，修复前会停在 31.0002）
    }

    /// 超容量长程后回程仍完整：第一个航点在当前位置附近、最后一个是原始起点。
    func testBacktrackStillWorksAfterCapDecimation() {
        var t = BreadcrumbTrail(minStepMeters: 8, maxPoints: 8)
        walk(&t, steps: 30) // 31 点 >> 8 容量，触发多次抽稀
        let back = t.backtrackWaypoints(minSpacingMeters: 25)
        XCTAssertEqual(back.first?.lat ?? 0, 31.0030, accuracy: 1e-9) // 回程从"现在的位置"出发
        XCTAssertEqual(back.last?.lat ?? 0, 31.0, accuracy: 1e-9)     // 终点仍是原始起点
    }

    func testResetClears() {
        var t = BreadcrumbTrail()
        t.record(lat: 31, lon: 121)
        t.reset()
        XCTAssertEqual(t.count, 0)
        XCTAssertNil(t.start)
    }
}
