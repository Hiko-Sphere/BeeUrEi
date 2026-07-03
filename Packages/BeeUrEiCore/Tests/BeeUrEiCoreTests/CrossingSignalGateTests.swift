import XCTest
@testable import BeeUrEiCore

final class CrossingSignalGateTests: XCTestCase {

    // MARK: 核心安全语义：新绿可起步、陈旧绿不可

    /// 见证 红 → 绿 跳变 = 新绿，整段相位在前方 → 可起步。
    func testFreshGreenAfterRedAllowsCrossing() {
        let g = CrossingSignalGate()
        XCTAssertEqual(g.update(confirmed: .red, at: 0), .wait)
        XCTAssertEqual(g.update(confirmed: .red, at: 1), .wait)
        XCTAssertEqual(g.update(confirmed: .green, at: 2), .crossNow) // 亲见 红→绿
    }

    /// 一上来就是绿（半路赶到，unknown → 绿）：无法保证剩余时间 → 等下一个绿灯。这是本门控的关键安全增益。
    func testStaleGreenArrivedMidCycleWaitsForNext() {
        let g = CrossingSignalGate()
        // 从未见过红/黄，第一帧确认就是绿。
        XCTAssertEqual(g.update(confirmed: .green, at: 0), .waitForNextGreen)
        XCTAssertEqual(g.update(confirmed: .green, at: 1), .waitForNextGreen) // 持续绿仍陈旧
    }

    /// 黄 → 绿 也算新绿（灯完整循环回绿）。
    func testGreenAfterYellowIsFresh() {
        let g = CrossingSignalGate()
        _ = g.update(confirmed: .yellow, at: 0)
        XCTAssertEqual(g.update(confirmed: .green, at: 1), .crossNow)
    }

    // MARK: 时间窗：新绿超窗降级

    /// 亲见新绿，但起步犹豫过久（超过 freshWindow）→ 可能已进入闪烁清空相位 → 降级等下一个绿灯。
    func testFreshGreenExpiresAfterWindow() {
        let g = CrossingSignalGate(freshWindow: 5)
        _ = g.update(confirmed: .red, at: 0)
        XCTAssertEqual(g.update(confirmed: .green, at: 10), .crossNow) // 刚变绿
        XCTAssertEqual(g.advice(at: 14), .crossNow)                    // 4s < 5s 窗内
        XCTAssertEqual(g.advice(at: 15), .crossNow)                    // 恰好 5s，边界含
        XCTAssertEqual(g.advice(at: 16), .waitForNextGreen)            // 6s 超窗 → 降级
    }

    /// 同一段绿的起始时刻不被后续 green 帧刷新（否则窗口永不到期，形同虚设）。
    func testWindowMeasuredFromGreenStartNotLatestFrame() {
        let g = CrossingSignalGate(freshWindow: 5)
        _ = g.update(confirmed: .red, at: 0)
        XCTAssertEqual(g.update(confirmed: .green, at: 1), .crossNow)  // 绿起始 = t1
        _ = g.update(confirmed: .green, at: 4)                        // 中途再喂绿，不应重置起始
        XCTAssertEqual(g.update(confirmed: .green, at: 7), .waitForNextGreen) // 距起始 6s > 5s
    }

    // MARK: 循环与重置

    /// 红→绿(fresh)→红→绿：第二段绿是新一轮跳变，重新变新绿可起步。
    func testNewGreenEpisodeAfterRedIsFreshAgain() {
        let g = CrossingSignalGate(freshWindow: 5)
        _ = g.update(confirmed: .red, at: 0)
        XCTAssertEqual(g.update(confirmed: .green, at: 1), .crossNow)
        XCTAssertEqual(g.advice(at: 10), .waitForNextGreen) // 首段绿已超窗
        _ = g.update(confirmed: .red, at: 11)               // 变红
        XCTAssertEqual(g.update(confirmed: .green, at: 12), .crossNow) // 新一段绿，又是新绿
    }

    func testResetClearsFreshness() {
        let g = CrossingSignalGate()
        _ = g.update(confirmed: .red, at: 0)
        XCTAssertEqual(g.update(confirmed: .green, at: 1), .crossNow)
        g.reset()
        // reset 后 lastConfirmed=unknown；再来绿 = 半路赶到 = 陈旧。
        XCTAssertEqual(g.update(confirmed: .green, at: 2), .waitForNextGreen)
    }

    /// 单调时间保护：即便查询时间戳早于起始，也不误判超窗（elapsed 夹到 ≥0）。
    func testNonIncreasingTimestampDoesNotFalselyExpire() {
        let g = CrossingSignalGate(freshWindow: 5)
        _ = g.update(confirmed: .red, at: 100)
        XCTAssertEqual(g.update(confirmed: .green, at: 101), .crossNow)
        XCTAssertEqual(g.advice(at: 100), .crossNow) // t < start → elapsed 夹 0，仍算窗内
    }

    // MARK: 播报语（双语 + 红/黄由分类器负责，本门控返回 nil 不重复）

    func testHintStringsBilingual() {
        let g = CrossingSignalGate()
        XCTAssertEqual(g.hint(.crossNow, language: .zh), "绿灯刚亮，可以起步过街，保持直行、注意车辆")
        XCTAssertEqual(g.hint(.crossNow, language: .en), "Walk signal just started, you can begin crossing, keep straight and watch for cars")
        XCTAssertEqual(g.hint(.waitForNextGreen, language: .zh), "已是绿灯但可能快结束，请等下一个绿灯再过街")
        XCTAssertEqual(g.hint(.waitForNextGreen, language: .en), "The light is green but may end soon, wait for the next green to cross")
        // 红/黄/未知交给 TrafficLightClassifier.hint，本门控不重复播报。
        XCTAssertNil(g.hint(.wait))
        XCTAssertNil(g.hint(.unknown))
    }

    func testDefaultLanguageIsChinese() {
        let g = CrossingSignalGate()
        XCTAssertEqual(g.hint(.crossNow), SpokenStrings.crossFreshGreen(.zh))
    }
}
