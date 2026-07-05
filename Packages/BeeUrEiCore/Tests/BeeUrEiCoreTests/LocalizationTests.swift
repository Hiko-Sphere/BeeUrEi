import XCTest
@testable import BeeUrEiCore

/// 多语言播报（E5 i18n）单测：验证英文输出正确，且中文输出与历史完全一致（防回归）。
/// 覆盖盲人实际听到的全部实时引导：方向/距离/障碍/落差/场景/颜色/转向/过街/取景/免责 + 标签/高危表。
final class LocalizationTests: XCTestCase {

    // MARK: Language 解析

    func testLanguageFromCode() {
        XCTAssertEqual(Language.from(code: "zh-Hans-CN"), .zh)
        XCTAssertEqual(Language.from(code: "ZH"), .zh)
        XCTAssertEqual(Language.from(code: "en-US"), .en)
        XCTAssertEqual(Language.from(code: "fr-FR"), .en)   // 未翻译语言回退英文
        XCTAssertEqual(Language.from(code: nil), .zh)
    }

    func testLanguageResolvePreference() {
        XCTAssertEqual(Language.resolve(preference: "zh", systemCode: "en-US"), .zh)   // 显式覆盖系统
        XCTAssertEqual(Language.resolve(preference: "en", systemCode: "zh-CN"), .en)
        XCTAssertEqual(Language.resolve(preference: "system", systemCode: "zh-CN"), .zh)
        XCTAssertEqual(Language.resolve(preference: "system", systemCode: "en-GB"), .en)
        XCTAssertEqual(Language.resolve(preference: nil, systemCode: "ja-JP"), .en)    // 未知系统语言→英文
    }

    func testVoiceCode() {
        XCTAssertEqual(Language.zh.voiceCode, "zh-CN")
        XCTAssertEqual(Language.en.voiceCode, "en-US")
    }

    // MARK: ClockDirection

    func testClockDirectionBothLanguages() {
        let c = ClockDirection(angleDegrees: 0)   // 12 点
        XCTAssertEqual(c.spokenPhrase, "12 点钟方向")            // 默认中文，向后兼容
        XCTAssertEqual(c.spokenPhrase(in: .zh), "12 点钟方向")
        XCTAssertEqual(c.spokenPhrase(in: .en), "12 o'clock")
        XCTAssertEqual(c.coarsePhrase, "正前方")
        XCTAssertEqual(c.coarsePhrase(in: .en), "ahead")

        let right = ClockDirection(angleDegrees: 60)   // 2 点
        XCTAssertEqual(right.coarsePhrase(in: .en), "ahead right")
        let left = ClockDirection(angleDegrees: -60)   // 10 点
        XCTAssertEqual(left.coarsePhrase(in: .en), "ahead left")
    }

    // MARK: SpeechComposer

    func testAnnounceEnglish() {
        let c = SpeechComposer()
        let o = Obstacle(label: "person", clock: ClockDirection(angleDegrees: 0), distanceMeters: 1.2, confidence: 0.9)
        XCTAssertEqual(c.announce(o, language: .en), "12 o'clock, person, about 1.2 m")
        // 中文用中文分隔/前缀；label 原样（调用方负责传已本地化的 label，见 LabelCatalog）。
        let zhObstacle = Obstacle(label: "行人", clock: ClockDirection(angleDegrees: 0), distanceMeters: 1.2, confidence: 0.9)
        XCTAssertEqual(c.announce(zhObstacle, language: .zh), "12 点钟方向，行人，约 1.2 米")
    }

    func testConciseAnnounceEnglish() {
        let c = SpeechComposer()
        let o = Obstacle(label: "vehicle", clock: ClockDirection(angleDegrees: 60), distanceMeters: 3, confidence: 0.8)
        XCTAssertEqual(c.conciseAnnounce(o, language: .en), "ahead right vehicle 3m")
    }

    func testDistanceFormattingEnglish() {
        let c = SpeechComposer()
        XCTAssertEqual(c.formatMeters(0.3, language: .en), "30 cm")
        XCTAssertEqual(c.formatMeters(1.25, language: .en), "1.2 m")
        XCTAssertEqual(c.formatMeters(0, language: .en), "very close")
        XCTAssertEqual(c.formatMeters(.nan, language: .en), "very close")
        XCTAssertEqual(c.conciseMeters(0.3, language: .en), "very close")
        XCTAssertEqual(c.conciseMeters(0.7, language: .en), "half a meter")
        XCTAssertEqual(c.conciseMeters(2.4, language: .en), "2m")
    }

    // 回归：距离格式化对**异常帧**的 NaN/∞/巨大有限值不得崩溃（安全播报路径）。修复前
    // conciseMeters/groundMeters 无 isFinite 守卫、meters 有量级缺口 → Int(NaN)/Int(巨值) 陷阱崩溃。
    func testDistanceFormattingSurvivesNonFiniteAndHuge() {
        for lang in [Language.zh, .en] {
            for bad in [Double.nan, .infinity, -.infinity, 1e300, -1e300] {
                _ = SpokenStrings.meters(bad, lang)
                _ = SpokenStrings.conciseMeters(bad, lang)
                _ = SpokenStrings.groundMeters(bad, lang)
            }
        }
        // NaN 距离保守退化：conciseMeters→很近/very close，groundMeters→半米/half a meter。
        XCTAssertEqual(SpokenStrings.conciseMeters(.nan, .en), "very close")
        XCTAssertEqual(SpokenStrings.groundMeters(.nan, .zh), "半米")
        XCTAssertFalse(SpokenStrings.conciseMeters(1e300, .en).isEmpty) // 巨值不崩溃、仍出合法字符串
    }

    func testProximityEnglish() {
        let c = SpeechComposer()
        XCTAssertNil(c.announceProximity(.clear, nearestMeters: nil, language: .en))
        XCTAssertEqual(c.announceProximity(.caution, nearestMeters: 1.5, language: .en), "Obstacle about 1.5 m ahead")
        XCTAssertEqual(c.announceProximity(.caution, nearestMeters: nil, language: .en), "Obstacle ahead")
        XCTAssertEqual(c.announceProximity(.danger, nearestMeters: nil, language: .en), "Very close ahead, please stop")
    }

    // 测距暂停/恢复须成对存在、双语非空且彼此不同（盲人据此判断避障是否仍在工作）。
    func testRangingPausedResumedDistinctBilingual() {
        for l in [Language.zh, .en] {
            XCTAssertFalse(SpokenStrings.rangingPaused(l).isEmpty)
            XCTAssertFalse(SpokenStrings.rangingResumed(l).isEmpty)
            XCTAssertNotEqual(SpokenStrings.rangingPaused(l), SpokenStrings.rangingResumed(l))
        }
    }

    // MARK: GroundHazardDetector

    func testGroundHazardHintEnglish() {
        let d = GroundHazardDetector()
        XCTAssertEqual(d.hint(.dropOff(distanceMeters: 0.4), language: .en), "Caution, drop-off or step down about half a meter ahead")
        XCTAssertEqual(d.hint(.stepUp(distanceMeters: 2), language: .en), "Caution, step up about 2m ahead")
        XCTAssertNil(d.hint(.none, language: .en))
        // 中文回归
        XCTAssertEqual(d.hint(.dropOff(distanceMeters: 0.4)), "注意，前方约半米有落差或下台阶")
    }

    // MARK: SceneSummarizer

    func testSceneSummaryEnglish() {
        let s = SceneSummarizer()
        XCTAssertEqual(s.summary(objects: [], language: .en), "No notable objects detected ahead")
        let objs: [(label: String, normalizedX: Double)] = [
            ("person", 0.5), ("person", 0.5), ("vehicle", 0.8), ("pole", 0.1),
        ]
        // 顺序：先中间(2 person)，再左(pole)，再右(vehicle)。
        XCTAssertEqual(s.summary(objects: objs, language: .en), "Ahead: 2 persons in the center; pole on the left; vehicle on the right")
    }

    // MARK: RouteProgress

    func testRouteProgressEnglish() {
        let r = RouteProgress()
        XCTAssertEqual(r.decide(distanceToManeuverMeters: 3, instruction: "turn left", level: .precise, language: .en).text, "Now turn left")
        XCTAssertEqual(r.decide(distanceToManeuverMeters: 3, instruction: "turn left", level: .beacon, language: .en).text, "Soon: turn left")
        XCTAssertEqual(r.decide(distanceToManeuverMeters: 15, instruction: "turn right", level: .precise, language: .en).text, "In about 15 m, turn right")
        // 安全红线在英文下同样成立：低精度不下「现在」。
        XCTAssertFalse(r.decide(distanceToManeuverMeters: 3, instruction: "x", level: .beacon, language: .en).isHighCertainty)
    }

    // MARK: ColorNamer

    func testColorNamerEnglish() {
        let n = ColorNamer()
        XCTAssertEqual(n.name(r: 1, g: 0, b: 0, language: .en), "red")
        XCTAssertEqual(n.name(r: 0, g: 1, b: 0, language: .en), "green")
        XCTAssertEqual(n.name(r: 0, g: 0, b: 0, language: .en), "black")
        XCTAssertEqual(n.name(r: 1, g: 1, b: 1, language: .en), "white")
        // 同一输入中英分桶一致（仅命名不同）。
        XCTAssertEqual(n.name(r: 1, g: 0, b: 0, language: .zh), "红色")
    }

    // MARK: Crossing / TrafficLight

    func testCrossingAndTrafficEnglish() {
        let crossing = CrossingAssistant()
        XCTAssertEqual(crossing.hint(forLabels: ["红绿灯"], language: .en), "Traffic light ahead, confirm the signal before crossing")
        XCTAssertNil(crossing.hint(forLabels: ["行人"], language: .en))

        let tl = TrafficLightClassifier()
        XCTAssertEqual(tl.hint(.green, language: .en), "Green light ahead, you may cross, stay cautious")
        XCTAssertEqual(tl.hint(.red, language: .en), "Red light ahead, please wait")
        XCTAssertEqual(tl.hint(.yellow, language: .en), "Yellow light ahead, do not cross")
        XCTAssertNil(tl.hint(.unknown, language: .en))
    }

    // MARK: FramingGuide

    func testFramingHintEnglish() {
        let f = FramingGuide()
        XCTAssertEqual(f.hint(.searching, language: .en), "Looking for the target, move the phone slowly")
        XCTAssertEqual(f.hint(.moveLeft, language: .en), "Move left")
        XCTAssertEqual(f.hint(.centered, language: .en), "Centered, hold still")
        XCTAssertEqual(f.hint(.moveLeft), "向左移动")   // 中文回归
    }

    // MARK: DisclaimerPolicy

    func testDisclaimerBriefEnglish() {
        let p = DisclaimerPolicy()
        XCTAssertEqual(p.briefReminderText(in: .en), "Obstacle alerts on. This is an aid only — keep using your cane")
        XCTAssertEqual(p.briefReminderText, "避障已开启，仅作辅助，请配合盲杖")   // 默认中文向后兼容
    }

    // MARK: LabelCatalog / HazardCatalog

    func testLabelCatalogEnglish() {
        let en = LabelCatalog(language: .en)
        XCTAssertEqual(en.localizedName("car"), "vehicle")
        XCTAssertEqual(en.localizedName("PERSON"), "person")        // 大小写不敏感
        XCTAssertEqual(en.localizedName("nonexistent"), "obstacle") // 未知回退
        let zh = LabelCatalog(language: .zh)
        XCTAssertEqual(zh.localizedName("car"), "车辆")
    }

    func testHazardCatalogEnglishMatchesLocalizedLabels() {
        // 关键：英文高危表必须命中英文本地化名，否则高危加成在英文下失效。
        let en = HazardCatalog(language: .en)
        XCTAssertTrue(en.isHighRisk("vehicle"))   // car→vehicle
        XCTAssertTrue(en.isHighRisk("stairs"))
        XCTAssertTrue(en.isHighRisk("pole"))
        XCTAssertFalse(en.isHighRisk("apple"))
        let zh = HazardCatalog(language: .zh)
        XCTAssertTrue(zh.isHighRisk("车辆"))
    }

    func testStreetFurnitureBenchAndMeterAreHighRisk() {
        // 长椅/停车计时器是人行道齐腰高实体固定物，与已收录的 消火栓/路桩 同类危险——检出即须享高危加成。
        // 走完整管线 LabelCatalog(命名)→HazardCatalog(加成)，确保 COCO 名→本地化名→高危 三段贯通。
        let zhLabels = LabelCatalog(language: .zh), zhHaz = HazardCatalog(language: .zh)
        let enLabels = LabelCatalog(language: .en), enHaz = HazardCatalog(language: .en)
        for coco in ["bench", "parking meter"] {
            XCTAssertTrue(zhHaz.isHighRisk(zhLabels.localizedName(coco)), "zh \(coco) 应高危")
            XCTAssertTrue(enHaz.isHighRisk(enLabels.localizedName(coco)), "en \(coco) 应高危")
        }
        // 扩表不误伤非障碍类（食物/宠物仍非高危）。
        XCTAssertFalse(zhHaz.isHighRisk("苹果"))
        XCTAssertFalse(enHaz.isHighRisk("dog"))
    }

    func testHazardHighRiskConsistentAcrossLanguagesForEveryLabel() {
        // 安全不变量（穷举，非点检）：LabelCatalog 能产出的**每一个**标签，其高危状态在中/英必须一致——
        // 否则某语言的盲人对同一障碍拿不到高危加成（静默安全回退）。此前仅少数标签被点检；本测遍历全表 +
        // 未知回退，锁死"已对齐英文高危集"承诺，防未来单侧增/漏高危。
        let zhL = LabelCatalog(language: .zh), enL = LabelCatalog(language: .en)
        let zhH = HazardCatalog(language: .zh), enH = HazardCatalog(language: .en)
        for coco in LabelCatalog.cocoToEnglish.keys {
            let zhRisk = zhH.isHighRisk(zhL.localizedName(coco))
            let enRisk = enH.isHighRisk(enL.localizedName(coco))
            XCTAssertEqual(zhRisk, enRisk,
                "标签 \(coco) 高危状态中英不一致：zh=\(zhRisk)(\(zhL.localizedName(coco))) en=\(enRisk)(\(enL.localizedName(coco)))")
        }
        // 未识别标签（两端各回退 障碍物/obstacle）也须一致高危——"挡路但不认识"绝不能一语言漏警。
        XCTAssertEqual(zhH.isHighRisk(zhL.localizedName("qwerty_unknown")),
                       enH.isHighRisk(enL.localizedName("qwerty_unknown")))
    }
}
