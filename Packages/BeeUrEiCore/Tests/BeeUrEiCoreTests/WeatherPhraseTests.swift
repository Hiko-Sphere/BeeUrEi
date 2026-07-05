import XCTest
@testable import BeeUrEiCore

/// 天气播报文案：WMO 码映射、播报组装、盲人出行建议、双语不串语种。
final class WeatherPhraseTests: XCTestCase {

    func testConditionMapping() {
        XCTAssertEqual(WeatherPhrase.condition(code: 0, language: .zh), "晴")
        XCTAssertEqual(WeatherPhrase.condition(code: 63, language: .zh), "中雨")
        XCTAssertEqual(WeatherPhrase.condition(code: 95, language: .en), "thunderstorm")
        XCTAssertEqual(WeatherPhrase.condition(code: 999, language: .zh), "天气未知") // 未知码不崩、不瞎说
    }

    func testSummaryComposition() {
        let zh = WeatherPhrase.summary(temperature: 23.6, code: 2,
                                       todayMax: 27.2, todayMin: 18.8,
                                       precipProbability: 10, language: .zh)
        XCTAssertEqual(zh, "现在多云，气温24度，今天最高27度，最低19度。")
        // 低降水概率(<20)不播、无建议；温度四舍五入。
        XCTAssertFalse(zh.contains("降水"))
    }

    func testRainAddsUmbrellaAdvice() {
        let zh = WeatherPhrase.summary(temperature: 20, code: 61, language: .zh)
        XCTAssertTrue(zh.contains("带伞"))
        XCTAssertTrue(zh.contains("湿滑")) // 盲杖用户路滑提示
        // 高降水概率即使当前没下雨也提醒带伞——但**不谎称地面已湿滑**（晴/多云此刻路面是干的）。
        let pre = WeatherPhrase.summary(temperature: 20, code: 2, precipProbability: 60, language: .zh)
        XCTAssertTrue(pre.contains("带伞"))
        XCTAssertTrue(pre.contains("降水概率百分之60"))
        XCTAssertFalse(pre.contains("湿滑")) // 现在没下雨：不说"地面湿滑"（准确性修正）
        // 正在下雨(wet code)才说地面湿滑。
        XCTAssertTrue(WeatherPhrase.advice(code: 63, todayMax: 20, todayMin: 12, precipProbability: nil, language: .zh)!.contains("湿滑"))
        XCTAssertTrue(WeatherPhrase.advice(code: 2, todayMax: 20, todayMin: 12, precipProbability: 70, language: .en)!.lowercased().contains("rain is likely"))
    }

    func testFreezingAdvice() {
        let zh = WeatherPhrase.summary(temperature: 2, code: 0, todayMax: 5, todayMin: -3, language: .zh)
        XCTAssertTrue(zh.contains("结冰"))
        // 雨雪建议优先于温度建议（湿滑比冷更危险）。
        let snow = WeatherPhrase.summary(temperature: -1, code: 73, todayMin: -5, language: .zh)
        XCTAssertTrue(snow.contains("带伞"))
    }

    /// 冻雨（WMO 56/57/66/67）＝黑冰：必须给专门强警告（避免外出/找人陪同），不能混进通用"带伞湿滑"。
    /// 黑冰视觉上与湿路无异、盲杖也探不出滑，是盲人步行最危险的天气。
    func testFreezingRainGetsDedicatedBlackIceWarning() {
        for code in [56, 57, 66, 67] {
            let zh = WeatherPhrase.summary(temperature: -1, code: code, language: .zh)
            XCTAssertTrue(zh.contains("冻雨"), "code \(code) 应含冻雨")
            XCTAssertTrue(zh.contains("避免外出"), "code \(code) 应强警告避免外出")
            XCTAssertTrue(zh.contains("陪同"), "code \(code) 应建议找人陪同")
            XCTAssertFalse(zh.contains("带伞"), "code \(code) 不应退化成通用带伞提示")
            let en = WeatherPhrase.summary(temperature: -1, code: code, language: .en)
            XCTAssertTrue(en.lowercased().contains("freezing rain"))
            XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(en)")
        }
        // 普通小雨仍是通用带伞（不受冻雨分支影响）。
        XCTAssertTrue(WeatherPhrase.summary(temperature: 20, code: 61, language: .zh).contains("带伞"))
    }

    /// 雷暴（WMO 95/96/99）：不是普通"带伞湿滑"——有雷击/冰雹风险，须专门强警告（尽快入室、避开空旷/树/金属）。
    func testThunderstormGetsDedicatedShelterWarning() {
        for code in [95, 96, 99] {
            let zh = WeatherPhrase.summary(temperature: 22, code: code, language: .zh)
            XCTAssertTrue(zh.contains("雷暴"), "code \(code) 应含雷暴")
            XCTAssertTrue(zh.contains("室内") || zh.contains("避雨"), "code \(code) 应建议尽快入室")
            XCTAssertFalse(zh.contains("请带伞"), "code \(code) 不应退化成普通带伞提示")
            let en = WeatherPhrase.summary(temperature: 22, code: code, language: .en)
            XCTAssertTrue(en.lowercased().contains("thunderstorm") && en.lowercased().contains("indoors"))
            XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(en)")
        }
    }

    func testEnglishHasNoChinese() {
        let samples = [
            WeatherPhrase.summary(temperature: 23.6, code: 61, windSpeedKmh: 35,
                                  todayMax: 27, todayMin: 19, precipProbability: 80, language: .en),
            WeatherPhrase.fetching(.en), WeatherPhrase.failed(.en), WeatherPhrase.needLocation(.en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
        }
    }

    // 回归：异常 API 响应的 NaN/∞/巨大有限温度不得崩溃（修复前 Int(温度) 会陷阱崩溃）。
    func testSummarySurvivesNonFiniteTemperatures() {
        for bad in [Double.nan, .infinity, -.infinity, 1e300, -1e300] {
            for lang in [Language.zh, .en] {
                _ = WeatherPhrase.summary(temperature: bad, code: 2, todayMax: bad, todayMin: bad, language: lang)
            }
        }
        // 负温仍正确保留（signed，不被夹成 0）。
        XCTAssertEqual(WeatherPhrase.safeTemp(-7), -7)
        XCTAssertEqual(WeatherPhrase.safeTemp(.nan), 0) // 非有限退化为 0，不崩溃
    }

    // 回归：主温度非有限时如实说"气温未知"，绝不把 safeTemp(NaN)=0 报成真温"气温0度"（会误导盲人穿衣/出行）。
    func testNonFiniteTemperatureReportedAsUnknownNotZero() {
        let zh = WeatherPhrase.summary(temperature: .nan, code: 2, language: .zh)
        XCTAssertTrue(zh.contains("气温未知"), zh)
        XCTAssertFalse(zh.contains("气温0度"), zh) // 绝不谎报 0 度
        let en = WeatherPhrase.summary(temperature: .infinity, code: 2, language: .en)
        XCTAssertTrue(en.contains("temperature unknown"), en)
        XCTAssertFalse(en.contains("0 degrees"), en)
        // 非有限的日最高/最低不报假的"0度"（整段省略）。
        let hilo = WeatherPhrase.summary(temperature: 22, code: 2, todayMax: .nan, todayMin: .nan, language: .zh)
        XCTAssertTrue(hilo.contains("气温22度"), hilo)   // 有效主温仍如常
        XCTAssertFalse(hilo.contains("最高0度"), hilo)   // 坏的高低温整段省略
        XCTAssertFalse(hilo.contains("最低0度"), hilo)
    }
}

// 盲人步行特有的天气安全建议：雾（司机看不清行人）+ 大风（盖过车流声）——2026-07 补。
extension WeatherPhraseTests {
    func testFogAdviceForDriverVisibility() {
        // 雾 45/48：不是让盲人看路（他本不靠视觉），而是提醒司机可能看不清他。
        let zh = WeatherPhrase.advice(code: 45, todayMax: 20, todayMin: 10, precipProbability: 0, language: .zh)
        XCTAssertNotNil(zh); XCTAssertTrue(zh!.contains("看不清你"))
        XCTAssertTrue(zh!.contains("信号灯"))
        XCTAssertTrue(WeatherPhrase.advice(code: 48, todayMax: nil, todayMin: nil, precipProbability: nil, language: .en)!.contains("Foggy"))
        // 雾优先于带伞（可见性安全 > 湿滑舒适）：若同时湿路码……雾码 45/48 本身非 wet，故独立验证雾走雾路径。
    }

    func testStrongWindMasksTraffic() {
        // ≥40km/h：晴天也追加大风提示（盲人过街靠听车声）。
        let clear = WeatherPhrase.advice(code: 0, todayMax: 22, todayMin: 15, precipProbability: 0, windSpeedKmh: 45, language: .zh)
        XCTAssertNotNil(clear); XCTAssertTrue(clear!.contains("盖过车流声"))
        // 风不够大（39）无提示，晴天无其它建议 → nil。
        XCTAssertNil(WeatherPhrase.advice(code: 0, todayMax: 22, todayMin: 15, precipProbability: 0, windSpeedKmh: 39, language: .zh))
        // 雨 + 大风：带伞 + 大风提示都在。
        let rainy = WeatherPhrase.advice(code: 61, todayMax: 18, todayMin: 12, precipProbability: 80, windSpeedKmh: 50, language: .zh)!
        XCTAssertTrue(rainy.contains("带伞")); XCTAssertTrue(rainy.contains("盖过车流声"))
    }

    func testFreezingRainStaysHighestAndNotDilutedByWind() {
        // 冻雨 + 大风：仍只给冻雨的最高级警告，不追加大风（避免过长、已是"避免外出"）。
        let z = WeatherPhrase.advice(code: 66, todayMax: 1, todayMin: -3, precipProbability: 90, windSpeedKmh: 60, language: .zh)!
        XCTAssertTrue(z.contains("冻雨"))
        XCTAssertFalse(z.contains("盖过车流声")) // 不叠加
    }

    func testSummaryPipesWindIntoAdvice() {
        // 端到端：summary 把风速透传给 advice（否则大风建议永远不触发）。
        let out = WeatherPhrase.summary(temperature: 20, code: 0, windSpeedKmh: 50, todayMax: 22, todayMin: 15, precipProbability: 0, language: .zh)
        XCTAssertTrue(out.contains("盖过车流声"))
    }

    func testHighUVGetsSunProtectionAdvice() {
        // 晴天高 UV(≥6)：盲人看不到日照强弱，主动提示防晒。
        let zh = WeatherPhrase.advice(code: 0, todayMax: 26, todayMin: 18, precipProbability: 0, uvIndex: 8, language: .zh)
        XCTAssertNotNil(zh); XCTAssertTrue(zh!.contains("防晒"))
        XCTAssertTrue(WeatherPhrase.advice(code: 0, todayMax: 26, todayMin: 18, precipProbability: 0, uvIndex: 8, language: .en)!.lowercased().contains("uv"))
        // UV 不够高(5) + 晴天无其它建议 → nil（不啰嗦）。
        XCTAssertNil(WeatherPhrase.advice(code: 0, todayMax: 26, todayMin: 18, precipProbability: 0, uvIndex: 5, language: .zh))
    }

    func testHotAndHighUVCombinedIntoOneTip() {
        // 高温(≥35)+高 UV：合并"防暑+防晒"一句；高温但低 UV(阴热)只防暑。
        let both = WeatherPhrase.advice(code: 0, todayMax: 37, todayMin: 26, precipProbability: 0, uvIndex: 9, language: .zh)!
        XCTAssertTrue(both.contains("防暑")); XCTAssertTrue(both.contains("防晒"))
        let hotOnly = WeatherPhrase.advice(code: 3, todayMax: 37, todayMin: 26, precipProbability: 0, uvIndex: 2, language: .zh)!
        XCTAssertTrue(hotOnly.contains("防暑")); XCTAssertFalse(hotOnly.contains("防晒"))
    }

    func testBelowFreezingIceBeatsUVSafetyPriority() {
        // 冷晴天：todayMin≤0（结冰风险）+ 高 UV(≥6)。盲人看不到冰，滑倒是直接跌伤——
        // 结冰警告必须压过防晒（安全>舒适），不能只提防晒而漏掉冰。
        let icy = WeatherPhrase.advice(code: 0, todayMax: 8, todayMin: -2, precipProbability: 0, uvIndex: 7, language: .zh)!
        XCTAssertTrue(icy.contains("结冰"))
        XCTAssertFalse(icy.contains("防晒"))
        let icyEn = WeatherPhrase.advice(code: 0, todayMax: 8, todayMin: -2, precipProbability: 0, uvIndex: 7, language: .en)!
        XCTAssertTrue(icyEn.lowercased().contains("ice"))
        // 极端热天(≥35)即便 min≤0（沙漠/高原罕见）仍以防暑为先（结冰排在高温之后）。
        XCTAssertTrue(WeatherPhrase.advice(code: 0, todayMax: 36, todayMin: -1, precipProbability: 0, uvIndex: 2, language: .zh)!.contains("防暑"))
    }

    func testUVYieldsToWetAndFogSafety() {
        // 阴雨/雾天：能见度/湿滑安全优先，先返回，绝不给 UV 提示（那些码本就 UV 低）。
        let rainy = WeatherPhrase.advice(code: 61, todayMax: 20, todayMin: 14, precipProbability: 80, uvIndex: 7, language: .zh)!
        XCTAssertTrue(rainy.contains("带伞")); XCTAssertFalse(rainy.contains("防晒"))
        let foggy = WeatherPhrase.advice(code: 45, todayMax: 20, todayMin: 14, precipProbability: 0, uvIndex: 7, language: .zh)!
        XCTAssertTrue(foggy.contains("看不清你")); XCTAssertFalse(foggy.contains("防晒"))
    }

    func testSummaryPipesUVIntoAdvice() {
        // 端到端：summary 把 uvIndex 透传给 advice（否则 UV 建议永远不触发）。
        let out = WeatherPhrase.summary(temperature: 28, code: 0, todayMax: 30, todayMin: 20, precipProbability: 0, uvIndex: 8, language: .zh)
        XCTAssertTrue(out.contains("防晒"))
    }

    func testApparentTemperature() {
        // 体感与实测差 ≥3° 才报（风寒/湿热）。
        XCTAssertTrue(WeatherPhrase.summary(temperature: 5, code: 0, apparentTemp: 0, language: .zh).contains("体感0度"))  // 风寒 -5°
        XCTAssertTrue(WeatherPhrase.summary(temperature: 30, code: 0, apparentTemp: 36, language: .en).contains("feels like 36")) // 湿热 +6°
        // 差 <3°：不赘述；无体感：不提。
        XCTAssertFalse(WeatherPhrase.summary(temperature: 20, code: 0, apparentTemp: 21, language: .zh).contains("体感"))
        XCTAssertFalse(WeatherPhrase.summary(temperature: 20, code: 0, language: .zh).contains("体感"))
        // 非有限体感（异常读数）跳过，绝不报"体感0度"假数。
        XCTAssertFalse(WeatherPhrase.summary(temperature: 20, code: 0, apparentTemp: .nan, language: .zh).contains("体感"))
    }

    func testHoursUntilLikelyRain() {
        let probs: [Int?] = [10,10,10,10,10,10,10,10,10,10, 20, 30, 70, 80, 10] // 索引12(=当前+2h)首达 70
        XCTAssertEqual(WeatherPhrase.hoursUntilLikelyRain(probabilities: probs, startIndex: 10), 2)
        XCTAssertEqual(WeatherPhrase.hoursUntilLikelyRain(probabilities: Array(repeating: 60, count: 15), startIndex: 10), 0) // 当前小时就高
        var far = [Int?](repeating: 10, count: 20); far[16] = 90                 // +6h 超默认 lookahead 4
        XCTAssertNil(WeatherPhrase.hoursUntilLikelyRain(probabilities: far, startIndex: 10))
        XCTAssertNil(WeatherPhrase.hoursUntilLikelyRain(probabilities: probs, startIndex: 99))  // 越界不崩
        XCTAssertNil(WeatherPhrase.hoursUntilLikelyRain(probabilities: probs, startIndex: -1))
        XCTAssertNil(WeatherPhrase.hoursUntilLikelyRain(probabilities: [nil,nil,nil], startIndex: 0)) // nil 当 0
    }

    func testNearTermRainAdvicePrefersTiming() {
        // 有逐小时时点：给"约 N 小时后"而非笼统"今天"，且不谎称湿滑。
        let z = WeatherPhrase.advice(code: 2, todayMax: 24, todayMin: 16, precipProbability: 60, rainInHours: 2, language: .zh)!
        XCTAssertTrue(z.contains("约2小时后")); XCTAssertTrue(z.contains("带伞")); XCTAssertFalse(z.contains("湿滑"))
        XCTAssertTrue(WeatherPhrase.advice(code: 2, todayMax: 24, todayMin: 16, precipProbability: nil, rainInHours: 0, language: .zh)!.contains("接下来一小时内"))
        // 无逐小时但日概率高 → 退回"今天很可能"。
        XCTAssertTrue(WeatherPhrase.advice(code: 2, todayMax: 24, todayMin: 16, precipProbability: 60, rainInHours: nil, language: .zh)!.contains("今天很可能"))
        // 正在下雨(wet code)优先"地面湿滑"，不被近期雨时点覆盖。
        XCTAssertTrue(WeatherPhrase.advice(code: 63, todayMax: 20, todayMin: 12, precipProbability: nil, rainInHours: 1, language: .zh)!.contains("湿滑"))
        // 英文单复数。
        XCTAssertTrue(WeatherPhrase.advice(code: 2, todayMax: 24, todayMin: 16, precipProbability: nil, rainInHours: 3, language: .en)!.contains("3 hours"))
        XCTAssertTrue(WeatherPhrase.advice(code: 2, todayMax: 24, todayMin: 16, precipProbability: nil, rainInHours: 1, language: .en)!.contains("1 hour;"))
    }

    func testFeelsLikeThresholdUsesRawNotRoundedDiff() {
        // 20.4 / 22.6：真实差 2.2°（<3），不该因各自四舍五入成 20/23 的"整 3 度"假差而误报（自审 #2）。
        XCTAssertFalse(WeatherPhrase.summary(temperature: 20.4, code: 0, apparentTemp: 22.6, language: .zh).contains("体感"))
        // 20.6 / 23.4：真实差 2.8°（<3），同样不提。
        XCTAssertFalse(WeatherPhrase.summary(temperature: 20.6, code: 0, apparentTemp: 23.4, language: .zh).contains("体感"))
        // 真实差 ≥3 仍提（20.0 / 23.1 = 3.1°）：取整播报 20/23。
        let s = WeatherPhrase.summary(temperature: 20.0, code: 0, apparentTemp: 23.1, language: .zh)
        XCTAssertTrue(s.contains("体感23度"))
    }

    func testMinuteOfDayParsing() {
        XCTAssertEqual(WeatherPhrase.minuteOfDay(fromISO: "2026-07-04T19:45"), 19 * 60 + 45)
        XCTAssertEqual(WeatherPhrase.minuteOfDay(fromISO: "2026-07-04T05:12:00"), 5 * 60 + 12) // 带秒
        XCTAssertEqual(WeatherPhrase.minuteOfDay(fromISO: "2026-01-01T00:00"), 0)
        XCTAssertNil(WeatherPhrase.minuteOfDay(fromISO: "2026-07-04"))     // 无 T
        XCTAssertNil(WeatherPhrase.minuteOfDay(fromISO: "garbage"))
        XCTAssertNil(WeatherPhrase.minuteOfDay(fromISO: "2026-07-04T25:99")) // 越界
    }

    func testTwilightSafety() {
        let sunset = 19 * 60 + 45  // 19:45
        // 日落前 15 分钟：天快黑了。
        let before = WeatherPhrase.twilightSafety(nowMinuteOfDay: sunset - 15, sunsetMinuteOfDay: sunset, language: .zh)
        XCTAssertNotNil(before); XCTAssertTrue(before!.contains("天快黑了")); XCTAssertTrue(before!.contains("信号灯"))
        // 日落后 15 分钟：天刚黑。
        let after = WeatherPhrase.twilightSafety(nowMinuteOfDay: sunset + 15, sunsetMinuteOfDay: sunset, language: .zh)
        XCTAssertNotNil(after); XCTAssertTrue(after!.contains("天刚黑"))
        // 窗口外（日落前 45 分钟、日落后 46 分钟）：不提醒（免打扰 + 深夜低可行动性）。
        XCTAssertNil(WeatherPhrase.twilightSafety(nowMinuteOfDay: sunset - 45, sunsetMinuteOfDay: sunset, language: .zh))
        XCTAssertNil(WeatherPhrase.twilightSafety(nowMinuteOfDay: sunset + 46, sunsetMinuteOfDay: sunset, language: .zh))
        XCTAssertNil(WeatherPhrase.twilightSafety(nowMinuteOfDay: 12 * 60, sunsetMinuteOfDay: sunset, language: .zh)) // 大白天
        // sunset 缺失 / 时刻非法：不瞎报。
        XCTAssertNil(WeatherPhrase.twilightSafety(nowMinuteOfDay: sunset, sunsetMinuteOfDay: nil, language: .zh))
        XCTAssertNil(WeatherPhrase.twilightSafety(nowMinuteOfDay: 5000, sunsetMinuteOfDay: sunset, language: .zh))
        // 英文。
        XCTAssertTrue(WeatherPhrase.twilightSafety(nowMinuteOfDay: sunset - 10, sunsetMinuteOfDay: sunset, language: .en)!.contains("getting dark"))
        XCTAssertTrue(WeatherPhrase.twilightSafety(nowMinuteOfDay: sunset + 20, sunsetMinuteOfDay: sunset, language: .en)!.contains("just got dark"))
    }

    func testAirQualityAdvice() {
        // 优/良（<75）：不打扰。
        XCTAssertNil(WeatherPhrase.airQualityAdvice(pm25: 20, language: .zh))
        XCTAssertNil(WeatherPhrase.airQualityAdvice(pm25: 74.9, language: .zh))
        // 轻度污染（75~115）：敏感人群戴口罩。
        XCTAssertEqual(WeatherPhrase.airQualityAdvice(pm25: 90, language: .zh), "空气轻度污染，对呼吸道敏感的人建议戴口罩。")
        // 中度（115~150）。
        XCTAssertTrue(WeatherPhrase.airQualityAdvice(pm25: 130, language: .zh)!.contains("中度污染"))
        // 重度（150~250）。
        XCTAssertTrue(WeatherPhrase.airQualityAdvice(pm25: 200, language: .zh)!.contains("重度污染"))
        // 严重（≥250）：尽量别出门。
        XCTAssertTrue(WeatherPhrase.airQualityAdvice(pm25: 300, language: .zh)!.contains("严重污染"))
        XCTAssertTrue(WeatherPhrase.airQualityAdvice(pm25: 300, language: .zh)!.contains("尽量别出门"))
        // 边界：恰 75 进入轻度、恰 250 进入严重。
        XCTAssertTrue(WeatherPhrase.airQualityAdvice(pm25: 75, language: .zh)!.contains("轻度污染"))
        XCTAssertTrue(WeatherPhrase.airQualityAdvice(pm25: 250, language: .zh)!.contains("严重污染"))
        // 非有限/负值：绝不瞎报（异常响应）。
        XCTAssertNil(WeatherPhrase.airQualityAdvice(pm25: .nan, language: .zh))
        XCTAssertNil(WeatherPhrase.airQualityAdvice(pm25: -5, language: .zh))
        XCTAssertNil(WeatherPhrase.airQualityAdvice(pm25: nil, language: .zh))
        // 英文。
        XCTAssertTrue(WeatherPhrase.airQualityAdvice(pm25: 130, language: .en)!.contains("mask"))
    }
}
