import XCTest
@testable import BeeUrEiCore

final class TrafficLightStabilizerTests: XCTestCase {
    func testConfirmsAfterNConsistentFrames() {
        let s = TrafficLightStabilizer(confirmFrames: 3)
        XCTAssertEqual(s.update(.red), .unknown) // 1
        XCTAssertEqual(s.update(.red), .unknown) // 2
        XCTAssertEqual(s.update(.red), .red)     // 3 → 确认
    }

    func testFlickerDoesNotConfirm() {
        let s = TrafficLightStabilizer(confirmFrames: 3)
        _ = s.update(.red); _ = s.update(.red); _ = s.update(.red) // confirmed red
        XCTAssertEqual(s.update(.green), .red) // 闪一帧绿不改判
        XCTAssertEqual(s.update(.red), .red)   // 回红，绿候选清零
        XCTAssertEqual(s.update(.green), .red)
        XCTAssertEqual(s.update(.green), .red)
        XCTAssertEqual(s.update(.green), .green) // 连续 3 帧绿才改判
    }

    func testStaysUntilNewStateConfirmed() {
        let s = TrafficLightStabilizer(confirmFrames: 2)
        _ = s.update(.green); _ = s.update(.green) // confirmed green
        XCTAssertEqual(s.confirmed, .green)
        XCTAssertEqual(s.update(.red), .green) // 仅 1 帧红，仍绿
        XCTAssertEqual(s.update(.red), .red)   // 2 帧红 → 改判
    }
}
