import XCTest
@testable import BeeUrEiCore

final class SceneSummarizerTests: XCTestCase {
    let s = SceneSummarizer()

    func testEmpty() {
        XCTAssertEqual(s.summary(objects: []), "前方没有识别到明显物体")
    }

    func testSingleCenter() {
        XCTAssertEqual(s.summary(objects: [("行人", 0.5)]), "前方：中间有行人")
    }

    func testThreeZones() {
        let out = s.summary(objects: [("椅子", 0.1), ("行人", 0.5), ("桌子", 0.9)])
        XCTAssertEqual(out, "前方：中间有行人，左边有椅子，右边有桌子")
    }

    func testCounts() {
        XCTAssertEqual(s.summary(objects: [("行人", 0.5), ("行人", 0.55)]), "前方：中间有2个行人")
    }

    func testNonFinitePositionSkippedNotMisplaced() {
        // 坏检测帧的非有限横坐标：位置未知，绝不谎报方位（与全库"非有限未知不动作"一致）。
        // NaN 的物体不落进"中间"、+inf 不落进"右边"——只报位置可信的那些。
        XCTAssertEqual(s.summary(objects: [("行人", .nan), ("椅子", 0.1)]), "前方：左边有椅子")
        XCTAssertEqual(s.summary(objects: [("行人", .infinity), ("椅子", 0.1)]), "前方：左边有椅子")
        // 唯一物体位置就坏（整帧不可信）→ 如实"没有明显物体"，而非谎报一个方位。
        XCTAssertEqual(s.summary(objects: [("桌子", .nan)]), "前方没有识别到明显物体")
        // 正常有限位置不受影响。
        XCTAssertEqual(s.summary(objects: [("椅子", 0.5)]), "前方：中间有椅子")
    }

    func testSalienceOrderMostFrequentFirst() {
        // 显著度排序：同一区里出现次数多的物体先报（一堆椅子比一个杯子更该先说），即便杯子先被检测到。
        // 输入次序 杯子 在前，但椅子×3 更显著 → 椅子先。
        let out = s.summary(objects: [("杯子", 0.5), ("椅子", 0.5), ("椅子", 0.5), ("椅子", 0.5)])
        XCTAssertEqual(out, "前方：中间有3个椅子、杯子")
    }

    func testPerZoneCapAddsEtc() {
        // 每区至多 3 种（默认），超出以"等"带过——盲人听觉不宜被长清单淹没。4 种 → 报前 3 种 + 等。
        let out = s.summary(objects: [("椅子", 0.5), ("桌子", 0.5), ("行人", 0.5), ("杯子", 0.5)])
        XCTAssertEqual(out, "前方：中间有椅子、桌子、行人等")
    }

    func testMaxPerZoneOverrideAndMostSalientKept() {
        // 显式收紧到每区 1 种：只留最显著者（椅子×2）+ 等；杯子被"等"带过而非丢失语义。
        let out = s.summary(objects: [("杯子", 0.5), ("椅子", 0.5), ("椅子", 0.5)], maxPerZone: 1)
        XCTAssertEqual(out, "前方：中间有2个椅子等")
    }

    func testEnglishAndMoreSuffix() {
        // 英文超上限后缀 "and more"。
        let out = s.summary(objects: [("apple", 0.5), ("book", 0.5), ("cup", 0.5), ("desk", 0.5)], language: .en)
        XCTAssertTrue(out.contains("and more"), out)
        XCTAssertTrue(out.hasPrefix("Ahead:"), out)
    }

    /// 英文方向映射回归（安全攸关）：左框(0.1)必须说 on the left、右框(0.9)必须说 on the right——
    /// 若日后误把 sceneZone 的英文数组顺序或 zone 阈值调反，英文盲人用户会被指向**相反方向**。
    /// 断言「物体+方向」连续子串（如 "chair on the left"），换向即命中失败。中文由 testThreeZones 守。
    func testEnglishDirectionMapping() {
        let out = s.summary(objects: [("chair", 0.1), ("person", 0.5), ("table", 0.9)], language: .en)
        XCTAssertTrue(out.contains("chair on the left"), out)      // 0.1 → 左
        XCTAssertTrue(out.contains("table on the right"), out)     // 0.9 → 右
        XCTAssertTrue(out.contains("person in the center"), out)   // 0.5 → 中
        XCTAssertTrue(out.hasPrefix("Ahead:"), out)
    }

    /// 英文复数正确性（此前朴素 +s：3 buss / 3 persons / 3 wine glasss / 3 benchs 皆语病）。
    func testEnglishPluralization() {
        // 不规则词。
        XCTAssertEqual(SpokenStrings.pluralizeEn("person"), "people")
        XCTAssertEqual(SpokenStrings.pluralizeEn("mouse"), "mice")
        XCTAssertEqual(SpokenStrings.pluralizeEn("knife"), "knives")
        // 不变 / 本已复数。
        XCTAssertEqual(SpokenStrings.pluralizeEn("sheep"), "sheep")
        XCTAssertEqual(SpokenStrings.pluralizeEn("scissors"), "scissors")
        XCTAssertEqual(SpokenStrings.pluralizeEn("skis"), "skis")
        // 咝音词尾 → +es。
        XCTAssertEqual(SpokenStrings.pluralizeEn("bus"), "buses")
        XCTAssertEqual(SpokenStrings.pluralizeEn("wine glass"), "wine glasses")
        XCTAssertEqual(SpokenStrings.pluralizeEn("toothbrush"), "toothbrushes")
        XCTAssertEqual(SpokenStrings.pluralizeEn("bench"), "benches")
        // 常规 +s（多词只影响末词，仍整体 +s）。
        XCTAssertEqual(SpokenStrings.pluralizeEn("chair"), "chairs")
        XCTAssertEqual(SpokenStrings.pluralizeEn("cell phone"), "cell phones")
        XCTAssertEqual(SpokenStrings.pluralizeEn("cake"), "cakes")
        // 端到端：场景概述里读出正确复数（此前会说 "3 buss"）。
        let out = s.summary(objects: [("bus", 0.5), ("bus", 0.52), ("bus", 0.55)], language: .en)
        XCTAssertTrue(out.contains("3 buses"), out)
        XCTAssertFalse(out.contains("buss"), out)
        let ppl = s.summary(objects: [("person", 0.5), ("person", 0.52)], language: .en)
        XCTAssertTrue(ppl.contains("2 people"), ppl)
        // 中文不受影响：仍"个"通用量词。
        let zh = s.summary(objects: [("公交车", 0.5), ("公交车", 0.52)], language: .zh)
        XCTAssertTrue(zh.contains("2个公交车"), zh)
    }
}
