import XCTest
@testable import BeeUrEi

/// 设置页/导航屏/亲友屏文案表（E5 第七批）：中文与历史一致、英文不串中文。
final class SettingsStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        XCTAssertEqual(SettingsStrings.briefReminderToggle(.zh), "开始避障时播报安全提醒")
        XCTAssertEqual(SettingsStrings.keepAwakeForever(.zh), "永久不息屏（避障持续，最费电）")
        XCTAssertEqual(SettingsStrings.keepAwakeAfter(300, .zh), "5 分钟后允许息屏")
        XCTAssertEqual(SettingsStrings.keepAwakeAfter(30, .zh), "30 秒后允许息屏")
        XCTAssertEqual(SettingsStrings.verbosityQuiet(.zh), "安静（只危险）")
        XCTAssertEqual(NavStrings.previewRoute(.zh), "预览路线（出门前试听）")
        XCTAssertEqual(AssistStrings.emergencyCallingPrefix(anyOnline: true, .zh), "正在呼叫在线联系人：")
        XCTAssertEqual(AssistStrings.pendingSuffix(.zh), " · 待对方接受")
    }

    func testEnglishHasNoChinese() {
        let samples = [
            SettingsStrings.reminderFooter(.en), SettingsStrings.speechFooter(.en),
            SettingsStrings.screenFooter(.en), SettingsStrings.a11yFooter(.en),
            SettingsStrings.devFooter(.en), SettingsStrings.keepAwakeAfter(120, .en),
            NavStrings.previewHint(.en), NavStrings.backtrackFooter(.en),
            AssistStrings.noEmergencyTargets(.en), AssistStrings.phonePlaceholder(.en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
