import XCTest
@testable import BeeUrEi

/// 过街起步门控接线（安全攸关）：绿灯播报走 CrossingSignalGate 裁决 + **每段绿的播报边沿语义**
///（对抗复审修复：①4s 节流 < 5s 起步窗 → 窗尾会重播"刚亮可起步"诱导迟起步；②起步后 5s 降级播
/// "等下一轮"会把盲人叫停在斑马线中央——门控自述"只裁决起步，不管途中"）。
final class TrafficAnnouncementGateTests: XCTestCase {

    func testStaleGreenIsDowngradedNotReassured() {
        // 陈旧绿（本段绿尚未播过 fresh）：必须是"等下一个绿灯"，绝无"可通行/可以起步"。
        let a = HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .waitForNextGreen,
                                                  freshAlreadyAnnounced: false, lang: .zh)
        XCTAssertEqual(a?.text, SpokenStrings.crossWaitNextGreen(.zh))
        XCTAssertEqual(a?.key, "trafficlight:green:stale")
        XCTAssertFalse(a!.text.contains("可通行"))
        XCTAssertFalse(a!.text.contains("可以起步"))
    }

    func testFreshGreenAnnouncesOncePerGreenSegment() {
        // 首帧：播"刚亮可起步"并标记本段已播。
        let first = HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .crossNow,
                                                      freshAlreadyAnnounced: false, lang: .zh)
        XCTAssertEqual(first?.text, SpokenStrings.crossFreshGreen(.zh))
        XCTAssertEqual(first?.marksFresh, true)
        // 复审①：同段绿再判 crossNow（4s 节流放行的窗尾帧）→ 必须静默——重播"刚亮"会诱导在相位末尾起步。
        XCTAssertNil(HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .crossNow,
                                                       freshAlreadyAnnounced: true, lang: .zh))
    }

    func testDowngradeAfterCrossNowIsSilentMidCrossing() {
        // 复审②：已播"可以起步"的同段绿超窗降级 → 静默（用户多半已在斑马线上，喊"等下一轮"会叫停在车道中央）。
        XCTAssertNil(HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .waitForNextGreen,
                                                       freshAlreadyAnnounced: true, lang: .zh))
    }

    func testNonGreenIdenticalToClassifierHint() {
        for s in [TrafficLightState.red, .yellow] {
            let a = HomeViewModel.trafficAnnouncement(effective: s, gateAdvice: .wait,
                                                      freshAlreadyAnnounced: false, lang: .zh)
            XCTAssertEqual(a?.text, TrafficLightClassifier().hint(s))
            XCTAssertEqual(a?.marksFresh, false)
        }
        XCTAssertNil(HomeViewModel.trafficAnnouncement(effective: .unknown, gateAdvice: .unknown,
                                                       freshAlreadyAnnounced: false, lang: .zh))
    }

    func testGreenWithInconsistentGateStaysSilent() {
        XCTAssertNil(HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .wait,
                                                       freshAlreadyAnnounced: false, lang: .zh))
        XCTAssertNil(HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: .unknown,
                                                       freshAlreadyAnnounced: false, lang: .zh))
    }

    func testEndToEndSequencesThroughRealGate() {
        // ① 半路赶到（unknown→green）＝陈旧绿 → 等下一轮。
        let stale = CrossingSignalGate()
        XCTAssertEqual(HomeViewModel.trafficAnnouncement(effective: .green,
                                                         gateAdvice: stale.update(confirmed: .green, at: 10),
                                                         freshAlreadyAnnounced: false, lang: .zh)?.text,
                       SpokenStrings.crossWaitNextGreen(.zh))
        // ② 亲见红相 4s → 新绿播一次；超窗降级对已播段静默（不叫停途中用户）。
        let fresh = CrossingSignalGate()
        fresh.update(confirmed: .red, at: 0)
        let onGreen = fresh.update(confirmed: .green, at: 4)
        let a = HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: onGreen,
                                                  freshAlreadyAnnounced: false, lang: .zh)
        XCTAssertEqual(a?.text, SpokenStrings.crossFreshGreen(.zh))
        let later = fresh.update(confirmed: .green, at: 10.5)
        XCTAssertEqual(later, .waitForNextGreen)
        XCTAssertNil(HomeViewModel.trafficAnnouncement(effective: .green, gateAdvice: later,
                                                       freshAlreadyAnnounced: true, lang: .zh))
    }

    func testPauseResetScenarioStaysConservative() {
        // 复审 HIGH 场景（中断清零后）：恢复帧流，短暂红（0.2s < 3s 驻留）→ 绿：门控判陈旧绿，不判新绿。
        let g = CrossingSignalGate()
        g.reset() // 等价 pause/interruption 后的状态
        g.update(confirmed: .red, at: 100.0)
        let advice = g.update(confirmed: .green, at: 100.2) // 驻留仅 0.2s
        XCTAssertEqual(advice, .waitForNextGreen, "中断恢复后的短驻留红→绿绝不能判亲见新绿")
    }
}
