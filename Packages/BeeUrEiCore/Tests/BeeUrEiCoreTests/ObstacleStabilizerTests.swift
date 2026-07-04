import XCTest
@testable import BeeUrEiCore

final class ObstacleStabilizerTests: XCTestCase {

    private func obstacle(_ label: String, hour: Int, dist: Double = 1.0) -> Obstacle {
        // 用一个固定 FOV 让 normalizedX 落到目标时钟点附近不重要——直接构造 ClockDirection。
        let normalizedX: Double
        switch hour {
        case 12: normalizedX = 0.5
        case 1: normalizedX = 1.0
        case 11: normalizedX = 0.0
        default: normalizedX = 0.5
        }
        return Obstacle(label: label,
                        clock: ClockDirection(normalizedX: normalizedX, horizontalFOVDegrees: 68),
                        distanceMeters: dist, confidence: 0.9)
    }

    func testFirstDetectionHeldImmediately() {
        let s = ObstacleStabilizer()
        XCTAssertEqual(s.update(obstacle("床", hour: 12))?.label, "床")
    }

    func testMissedFramesAreHeldThenReleased() {
        let s = ObstacleStabilizer(confirmFrames: 2, releaseFrames: 3)
        _ = s.update(obstacle("床", hour: 12))
        // 连续丢失 3 帧内仍保持（迟滞）。
        XCTAssertEqual(s.update(nil)?.label, "床")
        XCTAssertEqual(s.update(nil)?.label, "床")
        XCTAssertEqual(s.update(nil)?.label, "床")
        // 第 4 次丢失 → 清除。
        XCTAssertNil(s.update(nil))
    }

    func testTransientDifferentTargetDoesNotImmediatelySwitch() {
        let s = ObstacleStabilizer(confirmFrames: 2, releaseFrames: 3)
        _ = s.update(obstacle("床", hour: 12))
        // 来一帧不同目标 → 仍保持旧目标（防抖动误切）。
        XCTAssertEqual(s.update(obstacle("椅子", hour: 1))?.label, "床")
        // 再确认一帧 → 切换。
        XCTAssertEqual(s.update(obstacle("椅子", hour: 1))?.label, "椅子")
    }

    func testSameTargetRefreshesDistance() {
        let s = ObstacleStabilizer()
        _ = s.update(obstacle("床", hour: 12, dist: 2.0))
        let r = s.update(obstacle("床", hour: 12, dist: 1.2))
        XCTAssertEqual(r?.distanceMeters, 1.2)
    }

    func testHourDistanceWrap() {
        XCTAssertEqual(ObstacleStabilizer.hourDistance(12, 1), 1)
        XCTAssertEqual(ObstacleStabilizer.hourDistance(11, 1), 2)
        XCTAssertEqual(ObstacleStabilizer.hourDistance(3, 3), 0)
    }

    /// 回归：旧目标消失后，另有两个障碍逐帧**交替**出现时，不能永久卡在已消失的旧目标上。
    /// 旧实现里 `missCount = 0`（任意检测即清零）+ 交替候选凑不满 confirmFrames → held 永远是旧目标，
    /// 陈旧误报且漏报眼前真障碍（杂乱环境安全隐患）。修复后旧目标连续 >releaseFrames 帧未再现即被让位。
    func testStaleHeldReleasedWhenTwoOthersAlternate() {
        let s = ObstacleStabilizer(confirmFrames: 2, releaseFrames: 3)
        XCTAssertEqual(s.update(obstacle("床", hour: 12))?.label, "床") // 建立 held=床
        // 床从此消失；椅子(1点)与桌子(11点)逐帧交替，两者互不相同、也都不同于床。
        let alt = [obstacle("椅子", hour: 1), obstacle("桌子", hour: 11),
                   obstacle("椅子", hour: 1), obstacle("桌子", hour: 11)]
        // 前 releaseFrames(=3) 帧仍迟滞保留旧目标（防抖动误切，不激进）。
        XCTAssertEqual(s.update(alt[0])?.label, "床")
        XCTAssertEqual(s.update(alt[1])?.label, "床")
        XCTAssertEqual(s.update(alt[2])?.label, "床")
        // 第 4 帧：旧目标已连续 4 帧未再现 → 判定消失，采用眼前真实障碍（不再卡在"床"、也不是 nil 假畅通）。
        let out = s.update(alt[3])
        XCTAssertNotNil(out)
        XCTAssertEqual(out?.label, "桌子")
        XCTAssertNotEqual(out?.label, "床") // 关键：不再是已消失的旧目标
    }

    /// 交替期间若旧目标**中途再次出现**，迟滞计数应清零、继续稳定保持旧目标（不误让位）。
    func testHeldReappearingDuringAlternationStaysHeld() {
        let s = ObstacleStabilizer(confirmFrames: 2, releaseFrames: 3)
        _ = s.update(obstacle("床", hour: 12))
        XCTAssertEqual(s.update(obstacle("椅子", hour: 1))?.label, "床")  // miss 1
        XCTAssertEqual(s.update(obstacle("桌子", hour: 11))?.label, "床") // miss 2
        XCTAssertEqual(s.update(obstacle("床", hour: 12))?.label, "床")   // 旧目标再现 → 计数清零、刷新
        // 再来两帧不同目标：计数从头算，仍先保持旧目标。
        XCTAssertEqual(s.update(obstacle("椅子", hour: 1))?.label, "床")  // miss 1（重新计）
        XCTAssertEqual(s.update(obstacle("桌子", hour: 11))?.label, "床") // miss 2
    }
}

final class ROIMapperTests: XCTestCase {
    func testCenteredROIKeepsCenter() {
        let m = ROIMapper(originX: 0.15, width: 0.7)
        XCTAssertEqual(m.fullNormalizedX(0.5), 0.5, accuracy: 1e-9)
        XCTAssertEqual(m.fullNormalizedX(0.0), 0.15, accuracy: 1e-9)
        XCTAssertEqual(m.fullNormalizedX(1.0), 0.85, accuracy: 1e-9)
    }
}
