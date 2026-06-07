import XCTest
@testable import BeeUrEiCore

final class SpeechComposerTests: XCTestCase {

    private let composer = SpeechComposer()

    func testAnnounceWithDistance() {
        let o = Obstacle(label: "行人",
                         clock: ClockDirection(normalizedX: 1.0, horizontalFOVDegrees: 68),
                         distanceMeters: 1.2, confidence: 0.9)
        XCTAssertEqual(composer.announce(o), "1 点钟方向，行人，约 1.2 米")
    }

    func testAnnounceWithoutDistance() {
        let o = Obstacle(label: "柱子",
                         clock: ClockDirection(normalizedX: 0.5, horizontalFOVDegrees: 68),
                         distanceMeters: nil, confidence: 0.6)
        XCTAssertEqual(composer.announce(o), "12 点钟方向，柱子")
    }

    func testFormatSubMeter() {
        XCTAssertEqual(composer.formatMeters(0.6), "60 厘米")
        XCTAssertEqual(composer.formatMeters(1.27), "1.3 米")
        XCTAssertEqual(composer.formatMeters(1.24), "1.2 米")
        XCTAssertEqual(composer.formatMeters(0.04), "4 厘米")
    }

    // 回归：厘米/米边界——0.995…0.999 进位到 100cm 应升「米」，不得出现「100 厘米」。
    func testFormatMetersCentimeterToMeterBoundary() {
        XCTAssertEqual(composer.formatMeters(0.994), "99 厘米")
        XCTAssertEqual(composer.formatMeters(0.995), "1.0 米")
        XCTAssertEqual(composer.formatMeters(0.999), "1.0 米")
    }

    // 回归：非法/退化距离不得产出「0 厘米/负数/nan 米」。
    func testFormatMetersDegenerate() {
        XCTAssertFalse(composer.formatMeters(.nan).contains("nan"))
        XCTAssertFalse(composer.formatMeters(-1).contains("-"))
        XCTAssertNotEqual(composer.formatMeters(0.0), "0 厘米")
        XCTAssertEqual(composer.formatMeters(0.0), "非常近")
    }

    // 回归：announce 对非有限距离应省略距离短语，而非播报「约 nan 米」。
    func testAnnounceDropsNonFiniteDistance() {
        let o = Obstacle(label: "行人",
                         clock: ClockDirection(normalizedX: 0.5, horizontalFOVDegrees: 68),
                         distanceMeters: .nan, confidence: 0.9)
        XCTAssertEqual(composer.announce(o), "12 点钟方向，行人")
    }

    func testProximityPhrases() {
        XCTAssertNil(composer.announceProximity(.clear, nearestMeters: 5))
        XCTAssertEqual(composer.announceProximity(.danger, nearestMeters: 0.5), "正前方很近，请停下")
        XCTAssertEqual(composer.announceProximity(.caution, nearestMeters: 2.0), "前方约 2.0 米 有障碍")
        XCTAssertEqual(composer.announceProximity(.caution, nearestMeters: nil), "前方有障碍")
    }
}
