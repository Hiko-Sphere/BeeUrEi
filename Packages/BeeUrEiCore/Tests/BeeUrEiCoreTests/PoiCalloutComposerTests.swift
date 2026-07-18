import XCTest
@testable import BeeUrEiCore

final class PoiCalloutComposerTests: XCTestCase {
    private func poi(_ name: String, _ dist: Double, _ rel: Double?) -> PoiObservation {
        PoiObservation(name: name, distanceMeters: dist, relativeBearingDegrees: rel)
    }
    private func poi(_ name: String, _ dist: Double, _ rel: Double?, cat: String?) -> PoiObservation {
        PoiObservation(name: name, distanceMeters: dist, relativeBearingDegrees: rel, category: cat)
    }

    func testCategoryAppendedForBrandNamesZhOnlyNotWhenRedundant() {
        // 品牌店（名字听不出类型）→ 补类别帮识别；名字已含类型词则不重复；只中文补（高德类别是中文）。
        let brand = PoiCalloutComposer.compose(
            pois: [poi("肯德基", 30, 0, cat: "快餐厅")],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh)
        XCTAssertEqual(brand, "周围：12点钟方向约30米，肯德基，快餐厅")
        // 名字已含类型（"全家便利店"含"便利店"）→ 不重复补。
        let redundant = PoiCalloutComposer.compose(
            pois: [poi("全家便利店", 30, 0, cat: "便利店")],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh)
        XCTAssertEqual(redundant, "周围：12点钟方向约30米，全家便利店")
        // 英文不补（高德类别是中文，英文嗓念中文=乱码）。
        let en = PoiCalloutComposer.compose(
            pois: [poi("KFC", 30, 0, cat: "快餐厅")],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .en)
        XCTAssertFalse(en.contains("快餐厅"))
        // 空类别（MapKit 源无类别）→ 不补、不崩。
        let none = PoiCalloutComposer.compose(
            pois: [poi("星巴克", 30, 0, cat: nil), poi("瑞幸", 40, 0, cat: "  ")],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh)
        XCTAssertTrue(none.contains("星巴克") && none.contains("瑞幸"))
        XCTAssertFalse(none.contains("，，")) // 空类别绝不拼出空段
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

    func testAheadDedupDoesNotLetFilteredSameNameStealSlot() {
        // 回归：更近的同名"全家"在正后方(170°,被 ahead 扇区过滤)，更远的"全家"在正前方(10°,该播)。
        // 去重名额若在过滤前就被后方那个占掉，前方这个会被误当"已见"丢弃——盲人正走向它却听不到。
        let out = PoiCalloutComposer.compose(
            pois: [poi("全家便利店", 30, 170), poi("全家便利店", 60, 10)],
            mode: .ahead, radiusMeters: 400, headingAvailable: true, language: .zh)
        XCTAssertTrue(out.contains("全家便利店"), "前方的同名 POI 不应被后方被过滤的同名占掉去重名额")
        XCTAssertTrue(out.contains("60米")) // 播的是前方那个(60m)，不是后方被过滤的(30m)
    }

    func testTooCloseSameNameDoesNotSuppressValidFarther() {
        // 同理：<5m 的同名(所在建筑)被距离过滤后，不应压掉稍远处该播的同名。
        let out = PoiCalloutComposer.compose(
            pois: [poi("星巴克", 3, 0), poi("星巴克", 40, 0)],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh)
        XCTAssertEqual(out, "周围：12点钟方向约40米，星巴克")
    }

    func testMaxCountLimitsSpokenEntries() {
        let many = (1...10).map { poi("店\($0)", Double($0 * 10), 0) }
        let out = PoiCalloutComposer.compose(
            pois: many, mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh, maxCount: 2)
        XCTAssertEqual(out.components(separatedBy: "。").count, 2) // 恰两条
        XCTAssertTrue(out.contains("店1") && out.contains("店2") && !out.contains("店3"))
    }

    func testNearestPicksClosestQualifyingWithDirection() {
        let out = PoiCalloutComposer.nearest(
            from: [poi("远药店", 300, 90), poi("近药店", 80, 0), poi("脚下药店", 2, 0)], // 2m 太近(所在建筑)剔除
            query: "药店", radiusMeters: 1000, language: .zh)
        XCTAssertEqual(out, "最近的药店：近药店，12点钟方向约80米")
    }

    func testNearestWithoutHeadingDistanceOnly() {
        let out = PoiCalloutComposer.nearest(
            from: [poi("公共卫生间", 120, nil)], query: "厕所", radiusMeters: 1000, language: .zh)
        XCTAssertEqual(out, "最近的厕所：公共卫生间，约120米") // 无方位只报距离，绝不编方向
    }

    func testNearestNoneFound() {
        // 公制半径 ≥1km 走 farDistance→"公里"（与上方 POI 距离 ≥1km→公里 同口径，比"1000米"更可听）。
        XCTAssertEqual(
            PoiCalloutComposer.nearest(from: [], query: "药店", radiusMeters: 1000, language: .zh),
            "附近1公里内没找到药店")
        XCTAssertEqual(
            PoiCalloutComposer.nearest(from: [poi("  ", 50, 0)], query: "pharmacy", radiusMeters: 800, language: .en),
            "No pharmacy found within 800 meters") // 公制 <1km 仍"米"（逐字不变）；只有空名/被过滤者=没找到
    }

    func testNearestIndexMatchesNearestSelection() {
        // nearestIndex 与 nearest 同选择：设备层据此下标取回被朗读那处的坐标（"带我去那里"精确导航），保证"报的"="去的"。
        let pois = [poi("远药店", 300, 90), poi("近药店", 80, 0), poi("脚下药店", 2, 0)] // 2m 太近(所在建筑)剔除
        XCTAssertEqual(PoiCalloutComposer.nearestIndex(from: pois), 1) // "近药店"（80m 最近且 >5m）
        // 无有效地点 → nil：空数组、空名、全 ≤5m。
        XCTAssertNil(PoiCalloutComposer.nearestIndex(from: []))
        XCTAssertNil(PoiCalloutComposer.nearestIndex(from: [poi("  ", 50, 0)]))
        XCTAssertNil(PoiCalloutComposer.nearestIndex(from: [poi("脚下", 2, 0), poi("也脚下", 4.9, 0)]))
        // 与 nearest 朗读的地点严格一致：nearest 报的名字＝nearestIndex 指向的那个 POI 的名字（防各自选、导错地点）。
        let idx = PoiCalloutComposer.nearestIndex(from: pois)!
        XCTAssertTrue(PoiCalloutComposer.nearest(from: pois, query: "药店", radiusMeters: 1000, language: .zh).contains(pois[idx].name))
    }

    /// sibling-gap 收口：英制用户听 POI 距离是英尺/英里，"没查到"兜底句的半径也须随单位（曾裸报"米"＝单位割裂）。
    func testEmptyRadiusRespectsImperialUnit() {
        // 250m → 820 英尺（<1000ft）。ahead + around 两分支都覆盖。
        XCTAssertEqual(
            PoiCalloutComposer.compose(pois: [], mode: .ahead, radiusMeters: 250, headingAvailable: true, language: .en, unit: .imperial),
            "No places found within 820 feet ahead")
        XCTAssertEqual(
            PoiCalloutComposer.compose(pois: [], mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh, unit: .imperial),
            "周围820英尺内没有查到地点")
        // 3000m → 1.9 英里（≥1000ft 用英里）。
        XCTAssertEqual(
            PoiCalloutComposer.compose(pois: [], mode: .around, radiusMeters: 3000, headingAvailable: true, language: .en, unit: .imperial),
            "No places found within 1.9 miles around you")
        // nearest 兜底同样随单位。
        XCTAssertEqual(
            PoiCalloutComposer.nearest(from: [], query: "restroom", radiusMeters: 250, language: .en, unit: .imperial),
            "No restroom found within 820 feet")
    }

    /// 公制默认（不传 unit）行为守卫：<1km 半径逐字仍"米"，不被单位改动波及。
    func testEmptyRadiusMetricUnchangedUnder1km() {
        XCTAssertEqual(
            PoiCalloutComposer.compose(pois: [], mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh),
            "周围250米内没有查到地点")
        XCTAssertEqual(
            PoiCalloutComposer.compose(pois: [], mode: .ahead, radiusMeters: 400, headingAvailable: true, language: .en),
            "No places found within 400 meters ahead")
    }

    func testNearestEnglish() {
        XCTAssertEqual(
            PoiCalloutComposer.nearest(from: [poi("Boots", 50, 90)], query: "pharmacy", radiusMeters: 1000, language: .en),
            "Nearest pharmacy: Boots, about 50 meters, 3 o'clock")
    }

    func testHugeFiniteDistanceDoesNotOverflowCrash() {
        // 上游脏数据给出巨大有限距离（>Int.max）：原 Int() 会溢出陷阱崩溃；safeRoundedInt 夹取到 1e6，不崩、有界。
        let out = PoiCalloutComposer.compose(
            pois: [poi("坏数据", 1e19, 0)],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .zh)
        XCTAssertEqual(out, "周围：12点钟方向约1000公里，坏数据") // 夹到 1e6 米=1000 公里（locationDistance 换算）
        let n = PoiCalloutComposer.nearest(from: [poi("坏数据", 1e19, 0)], query: "药店", radiusMeters: 1000, language: .zh)
        XCTAssertTrue(n.contains("1000公里"))
    }

    func testEnglishPhrasing() {
        let out = PoiCalloutComposer.compose(
            pois: [poi("Blue Bottle", 30, 0)],
            mode: .around, radiusMeters: 250, headingAvailable: true, language: .en)
        XCTAssertEqual(out, "Around you: Blue Bottle, about 30 meters, 12 o'clock")
    }

    func testFarPoiUsesKilometers() {
        // 周边检索半径可达 3km：远处 POI 用公里，读屏更易听懂量级（"约2.1公里"胜过"约2100米"）。
        let out = PoiCalloutComposer.compose(
            pois: [poi("郊区商场", 2100, 0)],
            mode: .around, radiusMeters: 3000, headingAvailable: true, language: .zh)
        XCTAssertEqual(out, "周围：12点钟方向约2.1公里，郊区商场")
        // 定向检索也用公里。
        let n = PoiCalloutComposer.nearest(from: [poi("Mall", 1500, 90)], query: "mall", radiusMeters: 3000, language: .en)
        XCTAssertEqual(n, "Nearest mall: Mall, about 1.5 kilometers, 3 o'clock")
    }
}
