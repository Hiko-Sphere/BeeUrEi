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

    func testImperialUnitFormatsWalkingDistances() {
        // 英制 sibling-gap 收口：英制用户全程听英尺/英里，步行距离曾裸报"米"＝单位割裂。
        // 350m→0.2英里（≥1000ft 用英里）；单段 200m→656英尺、150m→492英尺。走 DistanceUnit.farDistance 同一换算源。
        let plan = TransitPlan(durationSeconds: 1980, walkingDistanceMeters: 350,
                               legs: [walk(200), ride(.subway, "地铁1号线", "西单站", "国贸站", 6), walk(150)])
        let zh = TransitPlanFormatter.summary(plan, language: .zh, unit: .imperial)
        XCTAssertTrue(zh.hasPrefix("全程约33分钟，步行共0.2英里。"), zh)
        XCTAssertTrue(zh.contains("步行656英尺，"), zh)        // walk(200)
        XCTAssertTrue(zh.hasSuffix("步行492英尺到达。"), zh)    // walk(150)
        let en = TransitPlanFormatter.summary(plan, language: .en, unit: .imperial)
        XCTAssertTrue(en.contains("0.2 miles of walking"), en)
        XCTAssertTrue(en.contains("walk 656 feet,"), en)
        XCTAssertTrue(en.hasSuffix("walk 492 feet to arrive."), en)
    }

    func testMetricWalkingOver1kmUsesKilometers() {
        // 公制 ≥1km 步行改"公里"（与全库 ≥1km→公里 口径一致，比"1500米"可听）；<1km 仍"米"（既有测试守卫）。
        let plan = TransitPlan(durationSeconds: 1200, walkingDistanceMeters: 1500, legs: [walk(1500)])
        XCTAssertTrue(TransitPlanFormatter.summary(plan, language: .zh).hasPrefix("全程约20分钟，步行共1.5公里。"))
        XCTAssertTrue(TransitPlanFormatter.summary(plan, language: .en).contains("1.5 kilometers of walking"))
    }

    func testTaxiLegNarratedNotDropped() {
        // 出租车段（首末公里/无公交覆盖时高德给的一段打车）：如实报"打车约X"，**绝不静默丢弃整段**（否则路线漏一截）。
        let plan = TransitPlan(durationSeconds: 1200, walkingDistanceMeters: 100,
                               legs: [walk(100),
                                      TransitLeg(kind: .taxi, line: nil, fromStop: nil, toStop: nil, stops: nil,
                                                 distanceMeters: 3000, durationSeconds: 600)])
        let zh = TransitPlanFormatter.summary(plan, language: .zh)
        XCTAssertTrue(zh.contains("打车约3公里"), zh)      // 3000m→3公里
        XCTAssertTrue(zh.contains("约10分钟"), zh)         // 600s→10分钟
        // 英制：里程用英里。
        let en = TransitPlanFormatter.summary(plan, language: .en, unit: .imperial)
        XCTAssertTrue(en.contains("take a taxi ~1.9 miles"), en)   // 3000m≈1.9mi
        // 无距离数据时至少报"打车"，绝不臆造"打车约0米"。
        let noDist = TransitPlan(durationSeconds: 300, walkingDistanceMeters: 0,
                                 legs: [TransitLeg(kind: .taxi, line: nil, fromStop: nil, toStop: nil, stops: nil,
                                                   distanceMeters: 0, durationSeconds: 0)])
        let nd = TransitPlanFormatter.summary(noDist, language: .zh)
        XCTAssertTrue(nd.contains("打车"), nd)
        XCTAssertFalse(nd.contains("打车约"), nd) // 无距离不带"约X"
    }

    func testMissingStopNamesDegradeGracefully() {
        // 缺站名/站数时不崩、不留悬空标点，仍给出线路。
        let leg = TransitLeg(kind: .subway, line: "地铁2号线", fromStop: nil, toStop: nil, stops: nil, distanceMeters: 3000, durationSeconds: 600)
        let out = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 600, walkingDistanceMeters: 0, legs: [leg]), language: .zh)
        XCTAssertEqual(out, "全程约10分钟，步行共0米。乘坐地铁2号线，约10分钟。")
    }

    func testSubwayEntranceExitNarratedInActionOrder() {
        // 地铁进/出站口（盲人从哪个口进/出站——站口相距远、走错极难折返，是过城落地关键指令，此前整段被服务端丢弃）。
        // 按乘客动作顺序：进站→上车→坐N站→下车→出站。
        let leg = TransitLeg(kind: .subway, line: "地铁1号线", fromStop: "人民广场", toStop: "徐家汇",
                             stops: 3, entrance: "A口", exit: "D口", distanceMeters: 5000, durationSeconds: 600)
        let plan = TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, legs: [leg])
        let zh = TransitPlanFormatter.summary(plan, language: .zh)
        XCTAssertTrue(zh.contains("从A口进站") && zh.contains("从D口出站"), "须报进/出站口：\(zh)")
        // 顺序：进站在上车之前、出站在下车之后。
        let ent = zh.range(of: "从A口进站")!.lowerBound
        let board = zh.range(of: "人民广场上车")!.lowerBound
        let alight = zh.range(of: "徐家汇下车")!.lowerBound
        let ext = zh.range(of: "从D口出站")!.lowerBound
        XCTAssertTrue(ent < board, "进站应在上车之前：\(zh)")
        XCTAssertTrue(alight < ext, "出站应在下车之后：\(zh)")
        // 英文同样含进/出站口。
        let en = TransitPlanFormatter.summary(plan, language: .en)
        XCTAssertTrue(en.contains("enter at A口") && en.contains("exit at D口"), "en：\(en)")
        // 缺站口（旧数据/公交段 entrance/exit 恒 nil）→ 不硬凑"进站/出站"半句。
        let noExits = TransitLeg(kind: .subway, line: "2号线", fromStop: "X", toStop: "Y", stops: 2,
                                 entrance: nil, exit: nil, distanceMeters: 3000, durationSeconds: 300)
        let zh2 = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 300, walkingDistanceMeters: 0, legs: [noExits]), language: .zh)
        XCTAssertFalse(zh2.contains("进站") || zh2.contains("出站"), "无站口不该出现进/出站字样：\(zh2)")
    }

    func testDirectionAnnouncedForBoarding() {
        // 行车方向/终点：盲人在站台须知开往哪个方向才能上对侧站台/对方向的车（上错难折返）。高德给两端"苹果园--四惠东"，
        // 分隔符归一为枚举"、"、括进"（…方向）"，在线路名之后、上车之前。
        let leg = TransitLeg(kind: .subway, line: "地铁1号线", direction: "苹果园--四惠东",
                             fromStop: "王府井", toStop: "四惠", stops: 4, distanceMeters: 6000, durationSeconds: 720)
        let zh = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 100, legs: [leg]), language: .zh)
        XCTAssertTrue(zh.contains("（苹果园、四惠东方向）"), "须报方向且'--'归一为'、'：\(zh)")
        XCTAssertTrue(zh.range(of: "方向）")!.lowerBound < zh.range(of: "王府井上车")!.lowerBound, "方向应在上车之前：\(zh)")
        let en = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 100, legs: [leg]), language: .en)
        XCTAssertTrue(en.contains("(苹果园 / 四惠东 direction)"), "en 方向且分隔归一为 /：\(en)")
        // 单终点（高德有时只给一个方向）：直接括出，不硬拼分隔。
        let single = TransitLeg(kind: .bus, line: "300路", direction: "内环", fromStop: "A", toStop: "B", stops: 3, distanceMeters: 4000, durationSeconds: 600)
        let z2 = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 600, walkingDistanceMeters: 0, legs: [single]), language: .zh)
        XCTAssertTrue(z2.contains("（内环方向）"), "单终点方向：\(z2)")
        // 无方向（旧数据/服务端未提取）→ 不出现"方向"字样，与旧 narration 一致（严格附加、不硬凑）。
        let noDir = TransitLeg(kind: .subway, line: "5号线", direction: nil, fromStop: "P", toStop: "Q", stops: 2, distanceMeters: 3000, durationSeconds: 300)
        let z3 = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 300, walkingDistanceMeters: 0, legs: [noDir]), language: .zh)
        XCTAssertFalse(z3.contains("方向"), "无方向数据不该出现'方向'：\(z3)")
    }

    func testFareAnnouncedInHeader() {
        // 票价：盲人扫不到票价牌，须提前备零钱/知道花费（与 Citymapper/Google 一致）。整数去尾零；缺/0→不报。
        let leg = TransitLeg(kind: .subway, line: "地铁1号线", fromStop: "A", toStop: "B", stops: 3, distanceMeters: 5000, durationSeconds: 600)
        let zh = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, fareYuan: 6, legs: [leg]), language: .zh)
        XCTAssertTrue(zh.contains("票价约6元"), "须报整数票价、去尾零：\(zh)")
        let en = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, fareYuan: 6, legs: [leg]), language: .en)
        XCTAssertTrue(en.contains("fare about 6 yuan"), "en 票价：\(en)")
        // 小数票价保留 1 位。
        let z2 = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, fareYuan: 6.5, legs: [leg]), language: .zh)
        XCTAssertTrue(z2.contains("票价约6.5元"), "小数票价 1 位：\(z2)")
        // 缺票价/0（步行方案或高德未给）→ 不出现"票价"字样（严格附加，不硬报）。
        XCTAssertFalse(TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, fareYuan: nil, legs: [leg]), language: .zh).contains("票价"))
        XCTAssertFalse(TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, fareYuan: 0, legs: [leg]), language: .zh).contains("票价"))
    }

    func testArrivalClockAppendedToHeader() {
        // 预计到达时刻（与步行导航同措辞"预计X到达"/"arriving around X"）：盲人据此判断能否赶上约定，省心算。
        // 拼在时长/步行/换乘/票价之后、句号之前；缺/空 → 不报（严格附加，不凭空报）。
        let leg = TransitLeg(kind: .subway, line: "地铁1号线", fromStop: "A", toStop: "B", stops: 3, distanceMeters: 5000, durationSeconds: 600)
        let plan = TransitPlan(durationSeconds: 1980, walkingDistanceMeters: 350, legs: [leg])
        let zh = TransitPlanFormatter.summary(plan, language: .zh, arrivalClock: "下午3:25")
        XCTAssertTrue(zh.contains("预计下午3:25到达"), "须报到达时刻：\(zh)")
        // en 到达措辞为英文（整段 summary 仍会含中文线路/站名——原样保留供对照站牌，故不整串查 CJK）。
        let en = TransitPlanFormatter.summary(plan, language: .en, arrivalClock: "3:25 PM")
        XCTAssertTrue(en.contains("arriving around 3:25 PM"), "en 到达时刻：\(en)")
        // 缺（默认 nil）/空白 arrivalClock → 不出现"预计…到达"（与旧 narration 逐字一致，向后兼容）。
        XCTAssertFalse(TransitPlanFormatter.summary(plan, language: .zh).contains("预计"))
        XCTAssertFalse(TransitPlanFormatter.summary(plan, language: .zh, arrivalClock: "   ").contains("预计"))
    }

    func testResolvedDestinationConfirmationLeadsSummary() {
        // 目的地回读确认（按名字规划时）：坐公交前一听高德规范化全称即核对——高德可能匹配到别区同名地点。
        // 放在最前（先确认"去哪"再讲怎么走）；无 resolvedName（精确坐标规划）→ 不出现、与旧 narration 一致。
        let leg = TransitLeg(kind: .subway, line: "地铁1号线", fromStop: "A", toStop: "B", stops: 3, distanceMeters: 5000, durationSeconds: 600)
        let zh = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, resolvedName: "北京市朝阳区国贸", legs: [leg]), language: .zh)
        XCTAssertTrue(zh.hasPrefix("去北京市朝阳区国贸。"), "确认须领起整段：\(zh)")
        let en = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, resolvedName: "Guomao, Beijing", legs: [leg]), language: .en)
        XCTAssertTrue(en.hasPrefix("To Guomao, Beijing. "), "en 确认领起：\(en)")
        // 无/空名（精确坐标规划或服务端未回传）→ 不出现"去…"确认前缀（严格附加，不硬凑）。
        let noName = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, resolvedName: nil, legs: [leg]), language: .zh)
        XCTAssertTrue(noName.hasPrefix("全程约"), "无名字应直接以行程概览起句：\(noName)")
        let blank = TransitPlanFormatter.summary(TransitPlan(durationSeconds: 900, walkingDistanceMeters: 200, resolvedName: "  ", legs: [leg]), language: .zh)
        XCTAssertTrue(blank.hasPrefix("全程约"), "空白名字按无名字处理：\(blank)")
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
