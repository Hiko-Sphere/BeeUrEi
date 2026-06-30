import XCTest
@testable import BeeUrEiCore

/// 语音总线仲裁 + 取景提示节流：修"避障/导航/查询同时出声"与"识别过于灵敏"的纯逻辑层。
final class SpeechArbitrationTests: XCTestCase {

    // MARK: SpeechGate

    func testSafetyHoldDropsHintsAndStashesRest() {
        // 避障播报期间：提示丢弃；导航/查询/来电积压待补播。
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: true, current: nil, safetyHold: true), .drop)
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: false, current: nil, safetyHold: true), .stash)
        XCTAssertEqual(SpeechGate.action(newChannel: .navigation, newDroppable: false, current: nil, safetyHold: true), .stash)
        XCTAssertEqual(SpeechGate.action(newChannel: .call, newDroppable: false, current: nil, safetyHold: true), .stash)
    }

    func testIdleSpeaksImmediately() {
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: false, current: nil, safetyHold: false), .speakInterrupt)
    }

    func testHigherChannelInterruptsLower() {
        // 导航指令正在播 → 来电播报立即打断；查询正在播 → 导航打断。
        XCTAssertEqual(SpeechGate.action(newChannel: .call, newDroppable: false,
                                         current: (.navigation, false), safetyHold: false), .speakInterrupt)
        XCTAssertEqual(SpeechGate.action(newChannel: .navigation, newDroppable: false,
                                         current: (.query, false), safetyHold: false), .speakInterrupt)
    }

    func testLowerChannelWaitsOrDrops() {
        // 导航正在播：查询结果积压（说完补播）、取景提示直接丢弃——不再同时出声。
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: false,
                                         current: (.navigation, false), safetyHold: false), .stash)
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: true,
                                         current: (.navigation, false), safetyHold: false), .drop)
    }

    func testNavigationQueuesOnItself() {
        // 路线预览逐行顺读依赖同通道排队。
        XCTAssertEqual(SpeechGate.action(newChannel: .navigation, newDroppable: false,
                                         current: (.navigation, false), safetyHold: false), .speakEnqueue)
    }

    func testHintNeverInterruptsResultButResultReplacesHint() {
        // 取景提示不打断"这是X"（识别灵敏度修复的总线侧保障）；反向结果可打断提示。
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: true,
                                         current: (.query, false), safetyHold: false), .drop)
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: false,
                                         current: (.query, true), safetyHold: false), .speakInterrupt)
        // 提示替换提示（方向变了就说最新的）。
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: true,
                                         current: (.query, true), safetyHold: false), .speakInterrupt)
        // 结果替换结果（同通道两个非可弃：重新取景再读/连续"这是X"→新结果打断旧结果，盲人不被陈旧长读卡住）。
        XCTAssertEqual(SpeechGate.action(newChannel: .query, newDroppable: false,
                                         current: (.query, false), safetyHold: false), .speakInterrupt)
    }

    // MARK: HintThrottle

    func testNewHintRequiresStability() {
        var t = HintThrottle(stableTicks: 2, minGap: 1.2, repeatGap: 2.5)
        // 第一帧出现新提示：不播（未达稳定帧数）——抖动帧不再立刻插话。
        XCTAssertFalse(t.shouldSpeak("往左移", at: 10.0))
        // 第二帧仍是它：稳定 → 播。
        XCTAssertTrue(t.shouldSpeak("往左移", at: 10.4))
    }

    func testJitterBetweenHintsNeverSpeaks() {
        var t = HintThrottle(stableTicks: 2, minGap: 1.2, repeatGap: 2.5)
        // 帧间提示来回跳（轻微移动）：稳定计数不断重置，一句都不播。
        XCTAssertFalse(t.shouldSpeak("往左移", at: 10.0))
        XCTAssertFalse(t.shouldSpeak("往右移", at: 10.4))
        XCTAssertFalse(t.shouldSpeak("往左移", at: 10.8))
        XCTAssertFalse(t.shouldSpeak("往右移", at: 11.2))
    }

    func testMinGapAfterResultSpeech() {
        var t = HintThrottle(stableTicks: 2, minGap: 1.2, repeatGap: 2.5)
        t.noteSpoke(at: 10.0) // 刚播完"这是水杯"
        XCTAssertFalse(t.shouldSpeak("往左移", at: 10.4))
        XCTAssertFalse(t.shouldSpeak("往左移", at: 10.8)) // 已稳定但距结果播报 <1.2s
        XCTAssertTrue(t.shouldSpeak("往左移", at: 11.3))  // 稳定且过了静默窗
    }

    func testSameHintRepeatsAtRepeatGap() {
        var t = HintThrottle(stableTicks: 2, minGap: 1.2, repeatGap: 2.5)
        _ = t.shouldSpeak("往左移", at: 10.0)
        XCTAssertTrue(t.shouldSpeak("往左移", at: 10.4))   // 稳定后首播
        XCTAssertFalse(t.shouldSpeak("往左移", at: 11.5))  // 同提示 2.5s 内不重复
        XCTAssertTrue(t.shouldSpeak("往左移", at: 13.0))   // 到点重复（持续指导）
    }
}
