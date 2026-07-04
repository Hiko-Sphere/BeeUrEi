import XCTest
@testable import BeeUrEiCore

final class TransitPlanFormatterTests: XCTestCase {
    private func walk(_ m: Double) -> TransitLeg {
        TransitLeg(kind: .walk, line: nil, fromStop: nil, toStop: nil, stops: nil, distanceMeters: m, durationSeconds: m)
    }
    private func ride(_ kind: TransitLegKind, _ line: String, _ from: String, _ to: String, _ stops: Int) -> TransitLeg {
        TransitLeg(kind: kind, line: line, fromStop: from, toStop: to, stops: stops, distanceMeters: 5000, durationSeconds: 900)
    }

    func testWalkSubwayWalkChinese() {
        let plan = TransitPlan(durationSeconds: 1980, walkingDistanceMeters: 350,
                               legs: [walk(200), ride(.subway, "地铁1号线", "西单站", "国贸站", 6), walk(150)])
        let out = TransitPlanFormatter.summary(plan, language: .zh)
        XCTAssertEqual(out, "全程约33分钟，步行共350米。步行200米，乘坐地铁1号线，西单站上车，坐6站到国贸站下车，步行150米到达。")
    }

    func testTransferUsesHuanchengForSecondRide() {
        // 第二段乘车用"换乘"，第一段用"乘坐"。
        let plan = TransitPlan(durationSeconds: 2400, walkingDistanceMeters: 300,
                               legs: [walk(100), ride(.subway, "地铁1号线", "A站", "B站", 3),
                                      ride(.bus, "300路", "B站", "C站", 5), walk(50)])
        let out = TransitPlanFormatter.summary(plan, language: .zh)
        XCTAssertTrue(out.contains("乘坐地铁1号线，A站上车，坐3站到B站下车"))
        XCTAssertTrue(out.contains("换乘300路，B站上车，坐5站到C站下车"))
        XCTAssertTrue(out.hasSuffix("步行50米到达。"))
    }

    func testEnglish() {
        let plan = TransitPlan(durationSeconds: 600, walkingDistanceMeters: 100,
                               legs: [ride(.bus, "300路", "甲站", "乙站", 4), walk(100)])
        let out = TransitPlanFormatter.summary(plan, language: .en)
        XCTAssertEqual(out, "About 10 minutes total, 100 meters of walking. take 300路 from 甲站, ride 4 stops to 乙站, walk 100 meters to arrive.")
    }

    func testMissingStopNamesDegradeGracefully() {
        // 缺站名/站数时不崩、不留悬空标点，仍给出线路。
        let leg = TransitLeg(kind: .subway, line: "地铁2号线", fromStop: nil, toStop: nil, stops: nil, distanceMeters: 3000, durationSeconds: 600)
        let out = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 600, walkingDistanceMeters: 0, legs: [leg]), language: .zh)
        XCTAssertEqual(out, "全程约10分钟，步行共0米。乘坐地铁2号线。")
    }

    func testEmptyLineFallsBackToGenericMode() {
        let leg = TransitLeg(kind: .bus, line: "  ", fromStop: "甲", toStop: "乙", stops: 2, distanceMeters: 1000, durationSeconds: 300)
        let out = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 300, walkingDistanceMeters: 0, legs: [leg]), language: .zh)
        XCTAssertEqual(out, "全程约5分钟，步行共0米。乘坐公交，甲上车，坐2站到乙下车。")
    }

    func testDurationRoundsUpFromSeconds() {
        // 20 秒也至少报 1 分钟，不报"0 分钟"。
        let out = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 20, walkingDistanceMeters: 0, legs: [walk(20)]), language: .zh)
        XCTAssertTrue(out.hasPrefix("全程约1分钟"))
    }

    func testHugeFiniteValuesDoNotOverflowCrash() {
        // 巨大有限时长/距离（>Int.max）：原 Int() 溢出陷阱崩溃；safeRoundedInt 夹取到 1e6，不崩。
        let plan = TransitPlan(durationSeconds: 1e19, walkingDistanceMeters: 1e19,
                               legs: [TransitLeg(kind: .bus, line: "1路", fromStop: "甲", toStop: "乙", stops: 2,
                                                 distanceMeters: 1e19, durationSeconds: 1e19)])
        let out = TransitPlanFormatter.summary(plan, language: .zh)
        XCTAssertTrue(out.contains("1000000")) // 夹取有界，无崩溃
    }

    func testDecodesFromServerJSON() throws {
        // 与服务端 /api/nav/transit 的 JSON 契约：字段名一致，可直接解码。
        let json = """
        {"durationSeconds":1980,"walkingDistanceMeters":350,"legs":[
          {"kind":"walk","distanceMeters":200,"durationSeconds":170},
          {"kind":"subway","line":"地铁1号线","fromStop":"西单站","toStop":"国贸站","stops":6,"distanceMeters":6000,"durationSeconds":900}
        ]}
        """.data(using: .utf8)!
        let plan = try JSONDecoder().decode(TransitPlan.self, from: json)
        XCTAssertEqual(plan.legs.count, 2)
        XCTAssertEqual(plan.legs[1].kind, .subway)
        XCTAssertEqual(plan.legs[1].fromStop, "西单站")
        XCTAssertEqual(plan.legs[1].stops, 6)
    }
}
