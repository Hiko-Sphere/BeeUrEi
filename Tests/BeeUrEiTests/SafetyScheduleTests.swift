import XCTest
@testable import BeeUrEi

/// 每日报到日程 + 实时倒计时纯逻辑（与网页 safetyCheckin.ts 同口径，跨端一致）。
/// 这些是 dead-man's switch 的显示层根基：算错=用户对安全网状态的错误认知。
final class SafetyScheduleTests: XCTestCase {

    // MARK: 实时剩余秒（liveRemainingSec）

    func testLiveRemainingComputesFromAbsoluteDue() {
        // 90 秒后到期 → 90；到期时刻 → 0；已过期 → 0（绝不显负数）。
        XCTAssertEqual(SafetyTimerFormat.liveRemainingSec(dueAtMs: 100_000, nowMs: 10_000), 90)
        XCTAssertEqual(SafetyTimerFormat.liveRemainingSec(dueAtMs: 100_000, nowMs: 100_000), 0)
        XCTAssertEqual(SafetyTimerFormat.liveRemainingSec(dueAtMs: 100_000, nowMs: 200_000), 0)
    }

    func testLiveRemainingBadInputsYieldZero() {
        // 坏输入（NaN/∞）→ 0，绝不显 NaN。
        XCTAssertEqual(SafetyTimerFormat.liveRemainingSec(dueAtMs: .nan, nowMs: 0), 0)
        XCTAssertEqual(SafetyTimerFormat.liveRemainingSec(dueAtMs: .infinity, nowMs: 0), 0)
        XCTAssertEqual(SafetyTimerFormat.liveRemainingSec(dueAtMs: 100_000, nowMs: .nan), 0)
    }

    // MARK: 下次报到标签（nextCheckinLabel）

    func testNextCheckinTodayWhenBeforeStart() {
        // 现在 08:30（510），报到 09:00（540）→ 今天 09:00。
        XCTAssertEqual(SafetyTimerFormat.nextCheckinLabel(startMinute: 540, nowMinuteOfDay: 510, .zh), "今天 09:00")
        XCTAssertEqual(SafetyTimerFormat.nextCheckinLabel(startMinute: 540, nowMinuteOfDay: 510, .en), "today at 09:00")
    }

    func testNextCheckinTomorrowWhenAtOrAfterStart() {
        // 边界：恰为报到时刻本身 → 明天（本分钟的扫描已经/即将开启今天那次）；之后 → 明天。
        XCTAssertEqual(SafetyTimerFormat.nextCheckinLabel(startMinute: 540, nowMinuteOfDay: 540, .zh), "明天 09:00")
        XCTAssertEqual(SafetyTimerFormat.nextCheckinLabel(startMinute: 540, nowMinuteOfDay: 900, .zh), "明天 09:00")
        XCTAssertEqual(SafetyTimerFormat.nextCheckinLabel(startMinute: 540, nowMinuteOfDay: 900, .en), "tomorrow at 09:00")
    }

    func testNextCheckinZeroPadsHHMM() {
        // 07:05（425）零填充；00:00（0）也合法。
        XCTAssertEqual(SafetyTimerFormat.nextCheckinLabel(startMinute: 425, nowMinuteOfDay: 0, .zh), "今天 07:05")
        XCTAssertEqual(SafetyTimerFormat.nextCheckinLabel(startMinute: 0, nowMinuteOfDay: 100, .zh), "明天 00:00")
    }

    // MARK: 暂停判定（isPaused）

    func testIsPausedOnlyForFuturePausedUntil() {
        let now: Double = 1_000_000
        let paused = DailyCheckinSchedule(enabled: true, startMinute: 540, durationMinutes: 60, tz: "Asia/Shanghai", note: nil, pausedUntil: now + 1)
        let expired = DailyCheckinSchedule(enabled: true, startMinute: 540, durationMinutes: 60, tz: "Asia/Shanghai", note: nil, pausedUntil: now - 1)
        let never = DailyCheckinSchedule(enabled: true, startMinute: 540, durationMinutes: 60, tz: "Asia/Shanghai", note: nil, pausedUntil: nil)
        XCTAssertTrue(paused.isPaused(nowMs: now))
        XCTAssertFalse(expired.isPaused(nowMs: now))  // 过期的暂停=已自动恢复
        XCTAssertFalse(never.isPaused(nowMs: now))
    }

    // MARK: 文案双语纯净

    func testDailyStringsEnglishHasNoChinese() {
        let samples = [
            SafetyStrings.dailyHeader(.en), SafetyStrings.dailyExplain(.en), SafetyStrings.dailyEnable(.en),
            SafetyStrings.dailyTimeLabel(.en), SafetyStrings.dailySave(.en), SafetyStrings.dailySaved(.en),
            SafetyStrings.nextCheckin("today at 09:00", .en), SafetyStrings.pause7(.en), SafetyStrings.pause30(.en),
            SafetyStrings.pausedUntil("Jan 8", .en), SafetyStrings.resumeNow(.en),
            SafetyStrings.paused(.en), SafetyStrings.resumed(.en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
