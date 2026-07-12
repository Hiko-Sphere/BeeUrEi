import XCTest
@testable import BeeUrEi

/// 过街起步门控接线（安全攸关）：绿灯播报改走 CrossingSignalGate 裁决。
/// 此前任何绿都念"可通行"——陈旧绿（半路赶到）走一半变红踩进车流，是典型假安心。
/// 本接线只会比原行为**更保守**：非绿逐字不变；绿从"一律可通行"降为按新鲜度裁决。
final class TrafficAnnouncementGateTests: XCTestCase {

    func testStaleGreenIsDowngradedNotReassured() {
        // 陈旧绿：绝不能出现"可通行/可以起步"字样——必须是"等下一个绿灯"。
        let a = HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .waitForNextGreen, lang: .zh)
        XCTAssertEqual(a?.text, SpokenStrings.crossWaitNextGreen(.zh))
        XCTAssertEqual(a?.key, "trafficlight:green:stale")
        XCTAssertFalse(a!.text.contains("可通行"))
        XCTAssertFalse(a!.text.contains("可以起步"))
    }

    func testFreshGreenAnnouncesCrossNowWithDistinctKey() {
        let a = HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .crossNow, lang: .zh)
        XCTAssertEqual(a?.text, SpokenStrings.crossFreshGreen(.zh))
        // key 与陈旧绿不同：新绿 5s 超窗降级为"等下一轮"须能即刻播出，不被 fresh 的 minGap 吞掉。
        XCTAssertNotEqual(a?.key, "trafficlight:green:stale")
    }

    func testNonGreenIdenticalToClassifierHint() {
        // 红/黄与原判色播报逐字一致（本接线绝不动非绿路径）。
        for s in [TrafficLightState.red, .yellow] {
            let a = HomeViewModel.trafficAnnouncement(effective: s, gateAdvice: .wait, lang: .zh)
            XCTAssertEqual(a?.text, TrafficLightClassifier().hint(s))
            XCTAssertEqual(a?.key, "trafficlight:\(s.rawValue)")
        }
        XCTAssertNil(HomeViewModel.trafficAnnouncement(effective: .unknown, gateAdvice: .unknown, lang: .zh))
    }

    func testGreenWithInconsistentGateStaysSilent() {
        // 门控视角与 effective 不一致（理论不达的防御分支）：宁静默不误导。
        XCTAssertNil(HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .wait, lang: .zh))
        XCTAssertNil(HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .unknown, lang: .zh))
    }

    func testEndToEndSequencesThroughRealGate() {
        // 集成契约：按接线同款喂法（confirmed 状态+单调秒）驱动真实门控，再经播报选择。
        // ① 半路赶到（unknown→green）＝陈旧绿 → 等下一轮。
        let stale = CrossingSignalGate()
        let a1 = HomeViewModel.trafficAnnouncement(effective: .green,
                                                   gateAdvice: stale.update(confirmed: .green, at: 10), lang: .zh)
        XCTAssertEqual(a1?.text, SpokenStrings.crossWaitNextGreen(.zh))
        // ② 亲见红相 4s → 变绿＝新绿 → 可起步；同一段绿 6s 后（超 5s 窗）→ 降级等下一轮。
        let fresh = CrossingSignalGate()
        fresh.update(confirmed: .red, at: 0)
        let onGreen = fresh.update(confirmed: .green, at: 4)
        XCTAssertEqual(HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: onGreen, lang: .zh)?.text,
                       SpokenStrings.crossFreshGreen(.zh))
        let later = fresh.update(confirmed: .green, at: 10.5)
        XCTAssertEqual(HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: later, lang: .zh)?.text,
                       SpokenStrings.crossWaitNextGreen(.zh))
    }
}
