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
}

final class ROIMapperTests: XCTestCase {
    func testCenteredROIKeepsCenter() {
        let m = ROIMapper(originX: 0.15, width: 0.7)
        XCTAssertEqual(m.fullNormalizedX(0.5), 0.5, accuracy: 1e-9)
        XCTAssertEqual(m.fullNormalizedX(0.0), 0.15, accuracy: 1e-9)
        XCTAssertEqual(m.fullNormalizedX(1.0), 0.85, accuracy: 1e-9)
    }
}
