import XCTest
@testable import BeeUrEiCore

final class HapticDesignTests: XCTestCase {
    func testPulseCountRisesWithDanger() {
        XCTAssertEqual(HapticDesign.pattern(for: .environment).count, 1)
        XCTAssertEqual(HapticDesign.pattern(for: .status).count, 1)
        XCTAssertEqual(HapticDesign.pattern(for: .turn).count, 2)
        XCTAssertEqual(HapticDesign.pattern(for: .obstacle).count, 3)
    }

    func testIntensityRisesWithDanger() {
        let env = HapticDesign.pattern(for: .environment)[0].intensity
        let obstacle = HapticDesign.pattern(for: .obstacle)[0].intensity
        XCTAssertGreaterThan(obstacle, env)
        XCTAssertEqual(obstacle, 1.0, accuracy: 0.001)
    }

    func testTimesAreMonotonicAndValid() {
        for p in [FeedbackPriority.environment, .status, .turn, .obstacle] {
            let pulses = HapticDesign.pattern(for: p)
            for i in pulses.indices {
                XCTAssertGreaterThanOrEqual(pulses[i].intensity, 0)
                XCTAssertLessThanOrEqual(pulses[i].intensity, 1)
                XCTAssertLessThanOrEqual(pulses[i].sharpness, 1)
                if i > 0 { XCTAssertGreaterThan(pulses[i].relativeTime, pulses[i - 1].relativeTime) }
            }
        }
    }
}
