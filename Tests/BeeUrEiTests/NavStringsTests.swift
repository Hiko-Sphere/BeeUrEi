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

    /// 到达播报带目的地名：盲人据此确认到的是**对**的地方；名字空→回退通用"已接近目的地"。
    func testArrivedNearNamesDestination() {
        // 有名 → "已接近目的地：X"（异于通用，含目的地名）。
        XCTAssertEqual(NavStrings.arrivedNear(destinationName: "协和医院", .zh), "已接近目的地：协和医院")
        XCTAssertEqual(NavStrings.arrivedNear(destinationName: "  国贸  ", .zh), "已接近目的地：国贸") // 去首尾空白
        XCTAssertNotEqual(NavStrings.arrivedNear(destinationName: "协和医院", .zh), NavStrings.nearDestination(.zh))
        // 空/纯空白 → 回退通用（不出"已接近目的地："这种半句）。
        XCTAssertEqual(NavStrings.arrivedNear(destinationName: "", .zh), NavStrings.nearDestination(.zh))
        XCTAssertEqual(NavStrings.arrivedNear(destinationName: "   ", .zh), NavStrings.nearDestination(.zh))
        // 英文：含目的地名 + 不串中文。
        let en = NavStrings.arrivedNear(destinationName: "Union Hospital", .en)
        XCTAssertEqual(en, "You're near your destination: Union Hospital")
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testNavigateHereFromChatBilingual() {
        // 聊天位置卡的"用蜂之眼导航"入口：中文点名蜂之眼，英文不串中文（区别于跳 Apple 地图的通用引导）。
        XCTAssertTrue(NavStrings.navigateHereFromChat(.zh).contains("蜂之眼"))
        XCTAssertTrue(NavStrings.navigateHereFromChat(.zh).contains("导航"))
        let en = NavStrings.navigateHereFromChat(.en)
        XCTAssertTrue(en.contains("Navigate") && en.contains("BeeUrEi"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testPreciseLocationNeededIsActionable() {
        // 必须是"可操作"指引（指向设置里的精确位置），而非会自愈的"定位中/精度低"临时话。
        let zh = NavStrings.preciseLocationNeeded(.zh)
        XCTAssertTrue(zh.contains("精确位置") && zh.contains("设置"))
        let en = NavStrings.preciseLocationNeeded(.en)
        XCTAssertTrue(en.contains("Precise Location") && en.contains("Settings"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
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
        // 带到达时刻（途中"重听"）：有 core 内容时附「预计X到达」；比"还有4分钟"更省心算。
        XCTAssertEqual(NavStrings.statusRecap(instruction: "前方右转", remaining: "还有约200米，约3分钟", status: "导航中", arrivalClock: "下午3:25", .zh),
                       "前方右转。还有约200米，约3分钟。预计下午3:25到达")
        XCTAssertTrue(NavStrings.statusRecap(instruction: "Turn right", remaining: "", status: "Navigating", arrivalClock: "3:25 PM", .en).contains("Arriving around 3:25 PM"))
        // core 空（刚起步/定位中）：即便传了到达时刻也不附（不凭空报到达）。向后兼容：无 arrivalClock 参数时行为不变。
        XCTAssertEqual(NavStrings.statusRecap(instruction: "", remaining: "", status: "导航中", arrivalClock: "下午3:25", .zh), "导航中")
        XCTAssertFalse(NavStrings.statusRecap(instruction: "前方右转", remaining: "", status: "", .zh).contains("到达"))
    }

    func testJourneyOverviewIncludesArrivalTime() {
        // 出发前总览带"预计几点到达"（对标 Google/Apple 地图，盲人省心算）。有 arrivalClock 才附、且需有有效 ETA。
        let zh = NavStrings.journeyOverview(meters: 2000, etaSeconds: 1500, arrivalClock: "下午3:25", .zh)
        XCTAssertTrue(zh.contains("预计下午3:25到达"), "应附到达时刻：\(zh)")
        XCTAssertTrue(zh.contains("全程约") && zh.contains("公里"))
        let en = NavStrings.journeyOverview(meters: 2000, etaSeconds: 1500, arrivalClock: "3:25 PM", .en)
        XCTAssertTrue(en.contains("arriving around 3:25 PM"), "\(en)")
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        // 无 arrivalClock：不附到达时刻（向后兼容，旧调用不变）。
        XCTAssertFalse(NavStrings.journeyOverview(meters: 2000, etaSeconds: 1500, .zh).contains("到达"))
        // 无 ETA：连时长都没有，即便传了 arrivalClock 也不附（不能凭空报到达时刻）。
        XCTAssertFalse(NavStrings.journeyOverview(meters: 2000, etaSeconds: nil, arrivalClock: "下午3:25", .zh).contains("到达"))
    }

    func testRepeatStatusButtonLabelBilingual() {
        // 可见"重听"按钮（导航中显示）：Magic Tap 是 VoiceOver 手势、不用 VoiceOver 的盲人无从触发，故须有可见可点按钮。
        // 双语、非空、中文点明"重听"、英文含 repeat（不误当别的操作）。
        XCTAssertTrue(NavStrings.repeatStatus(.zh).contains("重听"), "中文按钮须点明重听：\(NavStrings.repeatStatus(.zh))")
        let en = NavStrings.repeatStatus(.en)
        XCTAssertTrue(en.lowercased().contains("repeat"), "英文按钮须含 repeat：\(en)")
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(en)")
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

    func testTransitQueryParamsPrefersCoordinateOverName() {
        // 给了精确坐标(destGcj)→发 destLat/destLon、**不发** destination（避免服务端按名重搜命中别处，同步行 destGcj 优先）。
        let withCoord = AMapTransitClient.queryParams(originLatGcj: 39.9, originLonGcj: 116.4, destination: "国贸", destGcj: (lat: 39.92, lon: 116.45))
        let dict = Dictionary(uniqueKeysWithValues: withCoord.map { ($0.name, $0.value) })
        XCTAssertEqual(dict["destLat"], "39.92"); XCTAssertEqual(dict["destLon"], "116.45")
        XCTAssertNil(dict["destination"], "有精确坐标就不发目的地名字，绝不按名重搜")
        XCTAssertEqual(dict["originLat"], "39.9"); XCTAssertEqual(dict["originLon"], "116.4")
        // 没坐标→发 destination 名字（服务端 geocode），不发 destLat/destLon。
        let withName = AMapTransitClient.queryParams(originLatGcj: 39.9, originLonGcj: 116.4, destination: "国贸", destGcj: nil)
        let d2 = Dictionary(uniqueKeysWithValues: withName.map { ($0.name, $0.value) })
        XCTAssertEqual(d2["destination"], "国贸")
        XCTAssertNil(d2["destLat"]); XCTAssertNil(d2["destLon"])
    }

    func testTransitHereFromChatBilingual() {
        XCTAssertTrue(NavStrings.transitHereFromChat(.zh).contains("公交"))
        let en = NavStrings.transitHereFromChat(.en)
        XCTAssertTrue(en.lowercased().contains("transit"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    // 目的地回读确认（按名字导航时）：出发前念高德规范化全称让盲人核对；无名字（精确坐标导航）→ 空、自然跳过。
    func testDestinationConfirmation() {
        XCTAssertEqual(NavStrings.destinationConfirmation("北京市东城区协和医院", .zh), "导航到北京市东城区协和医院。")
        let en = NavStrings.destinationConfirmation("Peking Union Hospital", .en)
        XCTAssertEqual(en, "Heading to Peking Union Hospital. ")
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        // 无/空/纯空白名字（精确坐标导航或旧后端）→ 空前缀（严格附加，绝不硬凑"导航到。"）。
        XCTAssertEqual(NavStrings.destinationConfirmation(nil, .zh), "")
        XCTAssertEqual(NavStrings.destinationConfirmation("", .zh), "")
        XCTAssertEqual(NavStrings.destinationConfirmation("   ", .en), "")
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

    /// 路线库副标题/无障碍名带里程 + 步行时间（补齐 web parity：盲人须知"这条多长/多久"）。
    func testRouteSubtitleShowsDistanceAndWalkTime() {
        let s = NavStrings.routeSubtitle(8, meters: 1200, by: "妈妈", unit: .metric, .zh)
        XCTAssertTrue(s.contains("1.2 公里"), s)           // 1200m → 1.2 公里
        XCTAssertTrue(s.contains("步行约 17 分钟"), s)      // 1200/1.2/60 → 17 分钟
        XCTAssertTrue(s.contains("由妈妈创建"), s)
        // 英制：里程用英里、步行时间不变（时间与单位无关）。
        let e = NavStrings.routeSubtitle(8, meters: 1200, by: nil, unit: .imperial, .en)
        XCTAssertTrue(e.contains("0.7 miles"), e)          // 1200m ≈ 0.7 mi
        XCTAssertTrue(e.contains("~17 min walk"), e)
        // 无 meters（默认 nil）→ 退回旧行为，既有调用零影响。
        XCTAssertFalse(NavStrings.routeSubtitle(8, by: "妈妈", .zh).contains("公里"))
        XCTAssertFalse(NavStrings.routeSubtitle(8, by: "妈妈", .zh).contains("步行"))
        // meters<=0 也不追加（<2 点路线 totalRouteMeters 返回 nil，或坏数据）。
        XCTAssertFalse(NavStrings.routeSubtitle(3, meters: 0, by: nil, .zh).contains("步行"))
        // 无障碍名同样带里程/步行。
        let a = NavStrings.routeItemA11y("家到菜场", 8, meters: 1200, by: "妈妈", unit: .metric, .zh)
        XCTAssertTrue(a.contains("1.2 公里") && a.contains("步行约 17 分钟"), a)
        XCTAssertTrue(a.hasSuffix("双击开始引导"), a)
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

    /// 公交规划失败文案（透传服务端错误码）。判错的后果：给盲人**误导性**的下一步。
    /// 关键安全点：no_transit_route 对**远处**目的地绝不建议"步行"（跨城/无覆盖也报此码，盲人真会试着走）。
    func testTransitFailureTextByCode() {
        // 目的地名嵌入 + 各错误码分派。
        XCTAssertTrue(TransitPlanner.failureText(code: "destination_not_found", dest: "协和医院", straightLineMeters: nil, .zh).contains("协和医院"))
        XCTAssertTrue(TransitPlanner.failureText(code: "city_unresolved", dest: "X", straightLineMeters: nil, .zh).contains("城市"))
        XCTAssertTrue(TransitPlanner.failureText(code: "amap_not_configured", dest: "X", straightLineMeters: nil, .zh).contains("暂未开通"))
        // 未知码 / nil 码（非服务端错误）→ 各自的通用重试文案，绝不空。
        XCTAssertFalse(TransitPlanner.failureText(code: "amap_error", dest: "X", straightLineMeters: nil, .zh).isEmpty)
        XCTAssertTrue(TransitPlanner.failureText(code: nil, dest: "X", straightLineMeters: nil, .zh).contains("请稍后再试"))
        // 英文侧不串中文。
        for code in ["no_transit_route", "destination_not_found", "city_unresolved", "amap_not_configured", "amap_error"] {
            let s = TransitPlanner.failureText(code: code, dest: "Union Hospital", straightLineMeters: 5000, .en)
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(s)")
        }
    }

    /// no_transit_route 的**距离感知**：远(≥2km)不提步行、近/未知才提步行。这条线错=对盲人的危险误导。
    func testTransitNoRouteWalkSuggestionGatedByDistance() {
        // 远处(3km) → 不建议步行。
        let farZh = TransitPlanner.failureText(code: "no_transit_route", dest: "国贸", straightLineMeters: 3000, .zh)
        XCTAssertTrue(farZh.contains("较远"))
        XCTAssertFalse(farZh.contains("步行"))
        let farEn = TransitPlanner.failureText(code: "no_transit_route", dest: "Guomao", straightLineMeters: 3000, .en)
        XCTAssertFalse(farEn.lowercased().contains("walk"))
        // 近处(500m) → 保留"可以步行"。
        let nearZh = TransitPlanner.failureText(code: "no_transit_route", dest: "国贸", straightLineMeters: 500, .zh)
        XCTAssertTrue(nearZh.contains("步行"))
        // 距离未知(名字规划，nil) → 保守保留步行提示（无从判断远近）。
        let unknownZh = TransitPlanner.failureText(code: "no_transit_route", dest: "国贸", straightLineMeters: nil, .zh)
        XCTAssertTrue(unknownZh.contains("步行"))
        // 非有限距离（脏数据）→ 当作未知，保留步行提示（不因 NaN 误判为远）。
        let nanZh = TransitPlanner.failureText(code: "no_transit_route", dest: "国贸", straightLineMeters: .nan, .zh)
        XCTAssertTrue(nanZh.contains("步行"))
    }
}
