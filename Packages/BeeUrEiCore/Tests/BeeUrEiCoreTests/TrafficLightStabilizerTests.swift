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

    /// 安全不对称：默认(confirm 3 / leaveGreen 2)——**确认绿需 3 帧、离开绿只需 2 帧**，
    /// 缩短绿→红时"可通行"残留窗口，偏向"等待"。过街最高危场景的核心安全设计。
    func testLeavingGreenIsFasterThanConfirmingGreen() {
        let s = TrafficLightStabilizer() // 默认 confirmFrames=3, leaveGreenFrames=2
        // 确认绿仍需 3 帧（保守说"可通行"）。
        XCTAssertEqual(s.update(.green), .unknown) // 1
        XCTAssertEqual(s.update(.green), .unknown) // 2
        XCTAssertEqual(s.update(.green), .green)   // 3 → 确认绿
        // 离开绿只需 2 帧红（快速停）。
        XCTAssertEqual(s.update(.red), .green) // 1 帧红仍绿（抗单帧噪声）
        XCTAssertEqual(s.update(.red), .red)   // 2 帧红即离开绿（比确认绿的 3 帧更快）
    }

    /// 单帧非绿不误停（抗噪声）：绿确认后闪一帧 unknown 不该立刻丢绿。
    func testSingleNonGreenFrameKeepsGreen() {
        let s = TrafficLightStabilizer() // leaveGreenFrames=2
        _ = s.update(.green); _ = s.update(.green); _ = s.update(.green) // confirmed green
        XCTAssertEqual(s.update(.unknown), .green) // 1 帧 unknown（眩光）仍绿
        XCTAssertEqual(s.update(.green), .green)   // 回绿，候选清零
        XCTAssertEqual(s.update(.unknown), .green) // 再来 1 帧仍绿
    }

    /// leaveGreenFrames 被夹进 [1, confirmFrames]：不会比确认还慢，也不小于 1。
    func testLeaveGreenClamped() {
        XCTAssertEqual(TrafficLightStabilizer(confirmFrames: 2, leaveGreenFrames: 5).leaveGreenFrames, 2)
        XCTAssertEqual(TrafficLightStabilizer(confirmFrames: 3, leaveGreenFrames: 0).leaveGreenFrames, 1)
    }
}
