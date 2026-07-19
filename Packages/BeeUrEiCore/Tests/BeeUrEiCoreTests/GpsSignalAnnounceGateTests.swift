import XCTest
@testable import BeeUrEiCore

/// 定位信号可用度播报去抖：GPS 信号弱致方向信标静默停时，只播持续 ≥ sustain 的变化，精度抖动不刷屏。
final class GpsSignalAnnounceGateTests: XCTestCase {

    func testSustainedUnusableTriggersWeakOnce() {
        var g = GpsSignalAnnounceGate(sustainSeconds: 4)
        XCTAssertEqual(g.update(usable: false, at: 0), .none)   // 刚变不可用，未持续够久
        XCTAssertEqual(g.update(usable: false, at: 3), .none)   // 3s，仍不够
        XCTAssertEqual(g.update(usable: false, at: 4), .weak)   // 满 4s → 提示信号弱
        XCTAssertEqual(g.update(usable: false, at: 9), .none)   // 已提示，持续不可用不重复
    }

    func testSustainedRecoveryTriggersRestoredOnlyAfterWeak() {
        var g = GpsSignalAnnounceGate(sustainSeconds: 4)
        _ = g.update(usable: false, at: 0)
        XCTAssertEqual(g.update(usable: false, at: 4), .weak)      // 先进入已提示的不可用态
        XCTAssertEqual(g.update(usable: true, at: 6), .none)       // 刚恢复，未持续够久
        XCTAssertEqual(g.update(usable: true, at: 10), .restored)  // 恢复满 4s（6→10）→ 告知恢复继续引导
        XCTAssertEqual(g.update(usable: true, at: 30), .none)      // 稳定可用不重复
    }

    func testFlappingNeverAnnounces() {
        var g = GpsSignalAnnounceGate(sustainSeconds: 4)
        // 精度在阈值附近来回抖动（如反复走过遮蔽物），每次都在 sustain 内翻转 → 从不满足持续条件 → 从不播报。
        var cues: [GpsSignalAnnounceGate.Cue] = []
        for i in 0..<12 { cues.append(g.update(usable: i % 2 == 0, at: Double(i))) } // 每 1s 翻转，sustain=4
        XCTAssertTrue(cues.allSatisfy { $0 == .none })
    }

    func testAlwaysUsableNeverAnnouncesRestoredOutOfNowhere() {
        var g = GpsSignalAnnounceGate(sustainSeconds: 4)
        // 一直可用（与初始已播态相同）→ 绝不平白播"已恢复"。
        for t in stride(from: 0.0, through: 40, by: 4) { XCTAssertEqual(g.update(usable: true, at: t), .none) }
    }

    func testBriefDipWithinSustainStaysSilentThenRecoveryIsNoOp() {
        var g = GpsSignalAnnounceGate(sustainSeconds: 4)
        // 短暂不可用（<4s）后恢复：从未播"弱"，恢复也不该平白播"已恢复"（回到从未离开的已播可用态）。
        XCTAssertEqual(g.update(usable: false, at: 0), .none)
        XCTAssertEqual(g.update(usable: false, at: 2), .none)   // 只弱了 2s
        XCTAssertEqual(g.update(usable: true, at: 3), .none)    // 恢复，候选态取消
        XCTAssertEqual(g.update(usable: true, at: 10), .none)   // 稳定可用，绝不平白播恢复
    }
}
