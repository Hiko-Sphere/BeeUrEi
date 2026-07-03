import XCTest
@testable import BeeUrEi

/// 导航播报文案表（E5 第二批）：中文与历史一致、英文不串中文、组合短语正确。
final class NavStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        XCTAssertEqual(NavStrings.offRoute(.zh), "已偏离路线，正在重新规划")
        XCTAssertEqual(NavStrings.navStartedSpeak(5, "向东步行", .zh), "导航开始，共5步。向东步行")
        XCTAssertEqual(NavStrings.previewStep(2, "右转", meters: 30, .zh), "第2步，右转，前行约30米。")
        XCTAssertEqual(NavStrings.trailStartSpeak(.zh), "开始记路。走吧，我会记住来路。")
        XCTAssertEqual(NavStrings.enteringRoad("中山路", .zh), "进入中山路")
        XCTAssertEqual(NavStrings.passingBy("银行", .zh), "途经银行")
    }

    func testEnglishHasNoChinese() {
        let samples = [
            NavStrings.offRoute(.en), NavStrings.navStartedSpeak(5, "Head east", .en),
            NavStrings.previewStartSpeak(meters: 500, steps: 6, .en), NavStrings.backtrackStartSpeak(.en),
            NavStrings.trailStopStatus(8, .en), NavStrings.chinaRouteFailed(.en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }

    func testGeocodeLocaleFollowsLanguage() {
        XCTAssertEqual(NavStrings.geocodeLocale(.zh).identifier, "zh_CN")
        XCTAssertEqual(NavStrings.geocodeLocale(.en).identifier, "en_US")
    }

    // 离线降级播报（#8）：含"今天/N 天前"分支——复审点名的唯一带真实分支逻辑的新文案。
    func testOfflineFallbackSpeakBranches() {
        XCTAssertTrue(NavStrings.offlineRouteFallbackSpeak(0, .zh).contains("今天"))
        XCTAssertTrue(NavStrings.offlineRouteFallbackSpeak(3, .zh).contains("3 天前"))
        XCTAssertTrue(NavStrings.offlineRouteFallbackSpeak(0, .en).contains("today"))
        XCTAssertTrue(NavStrings.offlineRouteFallbackSpeak(1, .en).contains("1 day ago"))
        XCTAssertTrue(NavStrings.offlineRouteFallbackSpeak(3, .en).contains("3 days ago")) // 复数
        // 所有降级播报都须含"道路可能已变化/慢行"的安全提醒
        XCTAssertTrue(NavStrings.offlineRouteFallbackSpeak(2, .zh).contains("谨慎"))
        // 汇入/原路返回/离线路线文案：英文不混中文
        for s in [NavStrings.rejoinRoute(.en), NavStrings.offRouteReturnToPath(.en),
                  NavStrings.offlineRouteStatus(3, .en), NavStrings.customRouteStartSpeak("Home", .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(s)")
        }
    }
}
