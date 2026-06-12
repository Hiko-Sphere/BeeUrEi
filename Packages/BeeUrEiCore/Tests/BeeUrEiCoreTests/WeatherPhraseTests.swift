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
}
