import XCTest
@testable import BeeUrEiCore

final class PoiCalloutComposerTests: XCTestCase {
    private func poi(_ name: String, _ dist: Double, _ rel: Double?) -> PoiObservation {
        PoiObservation(name: name, distanceMeters: dist, relativeBearingDegrees: rel)
    }

    func testAroundSortsByDistanceAndPicksClockDirections() {
        let out = PoiCalloutComposer.compose(
            pois: [poi("远处超市", 200, 90), poi("近处便利店", 30, 0)],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh)
        // 近的先播；0°=12 点、90°=3 点。
        XCTAssertEqual(out, "周围：12点钟方向约30米，近处便利店。3点钟方向约200米，远处超市")
    }

    func testAheadKeepsOnlyForwardSector() {
        // 朝向 ±50° 内保留（前方 20°），扇区外剔除（正后方 170°）。
        let out = PoiCalloutComposer.compose(
            pois: [poi("前面的咖啡馆", 40, 20), poi("身后的药店", 40, 170)],
            mode: .ahead, radiusMeters: 400, headingAvailable: true, language: .zh)
        XCTAssertTrue(out.contains("前面的咖啡馆"))
        XCTAssertFalse(out.contains("身后的药店"))
        XCTAssertTrue(out.hasPrefix("前方："))
    }

    func testNoHeadingAroundFallsBackToDistanceOnly() {
        let out = PoiCalloutComposer.compose(
            pois: [poi("公园", 60, nil)],
            mode: .around, radiusMeters: 250, headingAvailable: false, language: .zh)
        XCTAssertEqual(out, "周围：约60米，公园") // 无方位只报距离，绝不编方向
    }

    func testAheadWithoutHeadingGivesCalibrationHint() {
        // 没有可信朝向时，前方模式给"确定不了朝向"，而非误导的"前方没有地点"。
        let out = PoiCalloutComposer.compose(
            pois: [poi("咖啡馆", 40, nil)],
            mode: .ahead, radiusMeters: 400, headingAvailable: false, language: .zh)
        XCTAssertEqual(out, "无法确定你的朝向，请稍后再试")
    }

    func testEmptyAroundReportsRadius() {
        XCTAssertEqual(
            PoiCalloutComposer.compose(pois: [], mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh),
            "周围250米内没有查到地点")
        XCTAssertEqual(
            PoiCalloutComposer.compose(pois: [], mode: .ahead, radiusMeters: 400, headingAvailable: true, language: .en),
            "No places found within 400 meters ahead")
    }

    func testDropsTooCloseAndNonFiniteAndBlankNames() {
        let out = PoiCalloutComposer.compose(
            pois: [poi("脚下的楼", 3, 0),            // <5m：多半是所在建筑本身
                   poi("坏定位", .nan, 0),           // 非有限距离
                   poi("   ", 50, 0),                // 空名
                   poi("真地点", 50, 60)],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh)
        XCTAssertEqual(out, "周围：2点钟方向约50米，真地点") // 60°=2 点钟；只剩这一条
    }

    func testDedupesSameNameKeepingNearest() {
        let out = PoiCalloutComposer.compose(
            pois: [poi("全家便利店", 120, 90), poi("全家便利店", 40, 0), poi("全家便利店", 200, 180)],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh)
        // 同名只播最近一个（40 米），不重复念。
        XCTAssertEqual(out, "周围：12点钟方向约40米，全家便利店")
    }

    func testMaxCountLimitsSpokenEntries() {
        let many = (1...10).map { poi("店\($0)", Double($0 * 10), 0) }
        let out = PoiCalloutComposer.compose(
            pois: many, mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh, maxCount: 2)
        XCTAssertEqual(out.components(separatedBy: "。").count, 2) // 恰两条
        XCTAssertTrue(out.contains("店1") && out.contains("店2") && !out.contains("店3"))
    }

    func testEnglishPhrasing() {
        let out = PoiCalloutComposer.compose(
            pois: [poi("Blue Bottle", 30, 0)],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .en)
        XCTAssertEqual(out, "Around you: Blue Bottle, about 30 meters, 12 o'clock")
    }
}
