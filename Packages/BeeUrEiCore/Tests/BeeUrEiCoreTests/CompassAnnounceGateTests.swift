import XCTest
@testable import BeeUrEiCore

/// 指南针可信度播报去抖：只播持续 ≥ sustain 的变化，罗盘抖动不刷屏。
final class CompassAnnounceGateTests: XCTestCase {

    func testSustainedUnreliableTriggersCalibrateOnce() {
        var g = CompassAnnounceGate(sustainSeconds: 3)
        XCTAssertEqual(g.update(reliable: false, at: 0), .none)   // 刚变不可信，未持续够久
        XCTAssertEqual(g.update(reliable: false, at: 2), .none)   // 2s，仍不够
        XCTAssertEqual(g.update(reliable: false, at: 3), .calibrate) // 满 3s → 提示校准
        XCTAssertEqual(g.update(reliable: false, at: 5), .none)   // 已提示，持续不可信不重复
    }

    func testSustainedRecoveryTriggersRestoredOnlyAfterCalibrate() {
        var g = CompassAnnounceGate(sustainSeconds: 3)
        _ = g.update(reliable: false, at: 0)
        XCTAssertEqual(g.update(reliable: false, at: 3), .calibrate) // 先进入已提示的不可信态
        XCTAssertEqual(g.update(reliable: true, at: 4), .none)       // 刚恢复，未持续够久
        XCTAssertEqual(g.update(reliable: true, at: 7), .restored)   // 满 3s → 告知恢复
        XCTAssertEqual(g.update(reliable: true, at: 20), .none)      // 稳定可信不重复
    }

    func testFlappingNeverAnnounces() {
        var g = CompassAnnounceGate(sustainSeconds: 3)
        // 在阈值附近来回抖动，每次都在 sustain 内翻转 → 从不满足持续条件 → 从不播报（防刷屏）。
        var cues: [CompassAnnounceGate.Cue] = []
        for i in 0..<10 { cues.append(g.update(reliable: i % 2 == 0, at: Double(i))) } // 每 1s 翻转，sustain=3
        XCTAssertTrue(cues.allSatisfy { $0 == .none })
    }

    func testAlwaysReliableNeverAnnouncesRestoredOutOfNowhere() {
        var g = CompassAnnounceGate(sustainSeconds: 3)
        // 一直可信（与初始已播态相同）→ 绝不平白播"已恢复"。
        for t in stride(from: 0.0, through: 30, by: 3) { XCTAssertEqual(g.update(reliable: true, at: t), .none) }
    }
}
