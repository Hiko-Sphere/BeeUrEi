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
        // 高降水概率即使当前没下雨也提醒。
        let pre = WeatherPhrase.summary(temperature: 20, code: 2, precipProbability: 60, language: .zh)
        XCTAssertTrue(pre.contains("带伞"))
        XCTAssertTrue(pre.contains("降水概率百分之60"))
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
}
