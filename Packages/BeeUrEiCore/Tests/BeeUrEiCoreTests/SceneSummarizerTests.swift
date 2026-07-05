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
}
