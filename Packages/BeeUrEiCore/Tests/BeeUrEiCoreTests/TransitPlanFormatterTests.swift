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
        XCTAssertEqual(out, "全程约33分钟，步行共350米。步行200米，乘坐地铁1号线，西单站上车，坐6站到国贸站下车，约15分钟，步行150米到达。")
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

    func testHeaderReportsTransferCount() {
        // 换乘次数=乘车段数−1，开头先报（盲人换乘最费神，需心理准备）。
        let twoRides = TransitPlan(durationSeconds: 2400, walkingDistanceMeters: 300,
                                   legs: [walk(100), ride(.subway, "地铁1号线", "A站", "B站", 3),
                                          ride(.bus, "300路", "B站", "C站", 5), walk(50)])
        XCTAssertTrue(TransitPlanFormatter.summary(twoRides, language: .zh).hasPrefix("全程约40分钟，步行共300米，需换乘1次。"))
        // 三段乘车=换乘2次；英文复数 transfers。
        let threeRides = TransitPlan(durationSeconds: 3600, walkingDistanceMeters: 200,
                                     legs: [ride(.subway, "1号线", "A", "B", 2), ride(.subway, "2号线", "B", "C", 3),
                                            ride(.bus, "5路", "C", "D", 4)])
        XCTAssertTrue(TransitPlanFormatter.summary(threeRides, language: .en).hasPrefix("About 60 minutes total, 200 meters of walking, 2 transfers. "))
        // 直达（单段乘车）不报"换乘0次"，也不出现换乘措辞。
        let direct = TransitPlan(durationSeconds: 600, walkingDistanceMeters: 100,
                                 legs: [ride(.bus, "300路", "甲", "乙", 4), walk(100)])
        XCTAssertFalse(TransitPlanFormatter.summary(direct, language: .zh).contains("换乘"))
        XCTAssertFalse(TransitPlanFormatter.summary(direct, language: .en).lowercased().contains("transfer"))
    }

    func testRailwayMidJourneyUsesTransferVerbConsistentWithHeader() {
        // 跨城行程 公交→火车→地铁：开头报"换乘2次"，narration 的"换乘"次数必须与之一致（火车段此前恒用
        // "乘坐"→只出现1次换乘、与开头矛盾）。修复后火车段作为非首段乘车也用"换乘火车"。
        let plan = TransitPlan(durationSeconds: 3600, walkingDistanceMeters: 200,
                               legs: [ride(.bus, "300路", "甲", "乙", 4), ride(.railway, "G101次", "乙站", "丙站", 0),
                                      ride(.subway, "2号线", "丙", "丁", 3)])
        let out = TransitPlanFormatter.summary(plan, language: .zh)
        XCTAssertTrue(out.hasPrefix("全程约60分钟，步行共200米，需换乘2次。"))
        XCTAssertTrue(out.contains("乘坐300路"))       // 首段乘车：乘坐
        XCTAssertTrue(out.contains("换乘G101次"))       // 火车作为第二段乘车：换乘（修复前是"乘坐G101次"）
        XCTAssertTrue(out.contains("换乘2号线"))         // 第三段：换乘
        // narration 里"换乘"出现次数 == 开头报的换乘次数（2）。
        XCTAssertEqual(out.components(separatedBy: "换乘").count - 1, 3) // 开头"需换乘"1 + 两段乘车"换乘"2 = 3 处
    }

    func testRailwayFirstRideStillUsesTakeVerb() {
        // 火车作为**首段**乘车仍用"乘坐"（英文 take）；不误升"换乘"。
        let plan = TransitPlan(durationSeconds: 1800, walkingDistanceMeters: 100,
                               legs: [walk(100), ride(.railway, "D5次", "北京南", "天津", 0)])
        XCTAssertTrue(TransitPlanFormatter.summary(plan, language: .zh).contains("乘坐D5次，北京南上车到天津下车"))
        XCTAssertTrue(TransitPlanFormatter.summary(plan, language: .en).contains("take D5次 from 北京南 to 天津"))
        // 单段火车直达不报换乘。
        XCTAssertFalse(TransitPlanFormatter.summary(plan, language: .zh).contains("换乘"))
    }

    func testEnglish() {
        let plan = TransitPlan(durationSeconds: 600, walkingDistanceMeters: 100,
                               legs: [ride(.bus, "300路", "甲站", "乙站", 4), walk(100)])
        let out = TransitPlanFormatter.summary(plan, language: .en)
        XCTAssertEqual(out, "About 10 minutes total, 100 meters of walking. take 300路 from 甲站, ride 4 stops to 乙站, about 15 min, walk 100 meters to arrive.")
    }

    func testMissingStopNamesDegradeGracefully() {
        // 缺站名/站数时不崩、不留悬空标点，仍给出线路。
        let leg = TransitLeg(kind: .subway, line: "地铁2号线", fromStop: nil, toStop: nil, stops: nil, distanceMeters: 3000, durationSeconds: 600)
        let out = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 600, walkingDistanceMeters: 0, legs: [leg]), language: .zh)
        XCTAssertEqual(out, "全程约10分钟，步行共0米。乘坐地铁2号线，约10分钟。")
    }

    func testEmptyLineFallsBackToGenericMode() {
        let leg = TransitLeg(kind: .bus, line: "  ", fromStop: "甲", toStop: "乙", stops: 2, distanceMeters: 1000, durationSeconds: 300)
        let out = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 300, walkingDistanceMeters: 0, legs: [leg]), language: .zh)
        XCTAssertEqual(out, "全程约5分钟，步行共0米。乘坐公交，甲上车，坐2站到乙下车，约5分钟。")
    }

    func testPerLegRideDurationSpokenButNotForWalk() {
        // 逐段乘车时长（比数站更直观感知这程要坐多久，同 Google 地图/Citymapper）；步行段不补（与其距离冗余）。
        let plan = TransitPlan(durationSeconds: 2000, walkingDistanceMeters: 300,
                               legs: [walk(200), // 步行 200s：**不**补时长
                                      TransitLeg(kind: .subway, line: "1号线", fromStop: "A", toStop: "B", stops: 10,
                                                 distanceMeters: 8000, durationSeconds: 1500)]) // 25 分钟
        let out = TransitPlanFormatter.summary(plan, language: .zh)
        XCTAssertTrue(out.contains("坐10站到B下车，约25分钟"))   // 乘车段补"约25分钟"
        XCTAssertFalse(out.contains("步行200米，约"))            // 步行段不补时长
        // 英文同理；且无时长数据(0)不硬凑"约0分钟"。
        let noDur = TransitPlan(durationSeconds: 600, walkingDistanceMeters: 0,
                                legs: [TransitLeg(kind: .bus, line: "5路", fromStop: "甲", toStop: "乙", stops: 3,
                                                  distanceMeters: 2000, durationSeconds: 0)])
        XCTAssertFalse(TransitPlanFormatter.summary(noDur, language: .zh).contains("约0分钟")) // 无数据不补
        XCTAssertTrue(TransitPlanFormatter.summary(noDur, language: .zh).hasSuffix("坐3站到乙下车。")) // 乘车段末尾无时长后缀
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
