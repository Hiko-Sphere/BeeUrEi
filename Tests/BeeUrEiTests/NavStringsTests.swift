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

    func testStatusRecapForMagicTap() {
        // 有转向+剩余 → 拼接（走路时"下一步 + 还有多远"一手势听全）。
        XCTAssertEqual(NavStrings.statusRecap(instruction: "前方右转", remaining: "还有约200米，约3分钟", status: "导航中", .zh),
                       "前方右转。还有约200米，约3分钟")
        // 缺一取另一。
        XCTAssertEqual(NavStrings.statusRecap(instruction: "", remaining: "还有约50米", status: "导航中", .zh), "还有约50米")
        XCTAssertEqual(NavStrings.statusRecap(instruction: "Turn right", remaining: "", status: "Navigating", .en), "Turn right")
        // 转向/剩余都空 → 回落状态行；全空 → "正在定位…"（Magic Tap 永不静默，静默会让盲人以为没生效）。
        XCTAssertEqual(NavStrings.statusRecap(instruction: "", remaining: "", status: "导航中", .zh), "导航中")
        XCTAssertEqual(NavStrings.statusRecap(instruction: "", remaining: "", status: "", .zh), NavStrings.locating(.zh))
        XCTAssertEqual(NavStrings.statusRecap(instruction: "", remaining: "", status: "", .en), "Locating…")
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

    // 路线副标题/无障碍名：创建者透明（亲友画的→"由 X"；自存→无创建者）。
    func testRouteCreatorTransparency() {
        XCTAssertTrue(NavStrings.routeSubtitle(3, by: "女儿", .zh).contains("由女儿创建"))
        XCTAssertTrue(NavStrings.routeSubtitle(3, by: nil, .zh).contains("自存"))
        XCTAssertTrue(NavStrings.routeSubtitle(3, by: "", .zh).contains("自存")) // 空名当自存
        XCTAssertTrue(NavStrings.routeItemA11y("家到菜场", 3, by: "女儿", .zh).contains("由女儿创建"))
        XCTAssertFalse(NavStrings.routeItemA11y("Home", 3, by: nil, .zh).contains("由")) // 自存不念创建者
        XCTAssertTrue(NavStrings.routeSubtitle(3, by: "Daughter", .en).contains("by Daughter"))
        XCTAssertFalse(NavStrings.routeSubtitle(3, by: "Daughter", .en).contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    // 剩余路程 + ETA 播报：距离档（公里/米）+ ETA 档（分钟/不到 1 分钟/缺测省略）三向组合正确、英文不混中文。
    func testRemainingDistanceFormatting() {
        // ≥1km → 公里一位小数（1234m=1.2km）；ETA 正常分钟（240s=4min）。
        XCTAssertEqual(NavStrings.remainingDistance(meters: 1234, etaSeconds: 240, .zh), "还有约1.2 公里，预计 4 分钟")
        // <1km → 取整到 10 米。487 → 490。
        XCTAssertEqual(NavStrings.remainingDistance(meters: 487, etaSeconds: 200, .zh), "还有约490 米，预计 3 分钟")
        // 末段 <10 米报精确值，绝不抹成"0 米"（临门一脚 1–4 米最要紧；≤30 加"快到了"前缀）。
        XCTAssertEqual(NavStrings.remainingDistance(meters: 4, etaSeconds: nil, .zh), "快到了，还有约4 米")
        XCTAssertFalse(NavStrings.remainingDistance(meters: 3, etaSeconds: nil, .zh).contains("0 米")) // 不再报 0 米
        XCTAssertEqual(NavStrings.remainingDistance(meters: 7, etaSeconds: nil, .en), "Almost there — about 7 m to go")
        // ETA <60s → "不到 1 分钟"。
        XCTAssertTrue(NavStrings.remainingDistance(meters: 30, etaSeconds: 25, .zh).contains("不到 1 分钟"))
        // ETA 缺测(nil) → 省略 ETA，只报距离。
        XCTAssertEqual(NavStrings.remainingDistance(meters: 200, etaSeconds: nil, .zh), "还有约200 米")
        XCTAssertFalse(NavStrings.remainingDistance(meters: 200, etaSeconds: nil, .zh).contains("分钟"))
        // 英文档不混中文。
        for s in [NavStrings.remainingDistance(meters: 1234, etaSeconds: 240, .en),
                  NavStrings.remainingDistance(meters: 487, etaSeconds: 25, .en),
                  NavStrings.remainingDistance(meters: 200, etaSeconds: nil, .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(s)")
        }
    }

    // 出发全程概览："全程约 X，预计 Y"（距离/ETA 档与 remainingDistance 共用同一格式化）。
    func testJourneyOverviewFormatting() {
        XCTAssertEqual(NavStrings.journeyOverview(meters: 1234, etaSeconds: 900, .zh), "全程约1.2 公里，预计 15 分钟")
        XCTAssertEqual(NavStrings.journeyOverview(meters: 320, etaSeconds: nil, .zh), "全程约320 米")
        XCTAssertFalse(NavStrings.journeyOverview(meters: 320, etaSeconds: nil, .zh).contains("分钟"))
        // 英文不混中文。
        for s in [NavStrings.journeyOverview(meters: 1234, etaSeconds: 900, .en),
                  NavStrings.journeyOverview(meters: 320, etaSeconds: nil, .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(s)")
            XCTAssertTrue(s.hasPrefix("Route is about"))
        }
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
