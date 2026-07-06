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

    func testSavedPlaceStatusStringsDistinctAndBilingual() {
        // 家/公司保存结果会被主动朗读（导航攸关：保存悄悄失败时盲人须听到，否则以为设好了、日后"回家"失败）。
        // 保存/失败/清除三态各不相同，失败尤须点明"请稍后再试"（可行动）、绝不与"已保存"混淆。
        let saved = SettingsStrings.placeSaved(.zh)
        let failed = SettingsStrings.placeSaveFailed(.zh)
        let cleared = SettingsStrings.placeCleared(.zh)
        XCTAssertEqual(Set([saved, failed, cleared]).count, 3, "保存/失败/清除三态须各不相同")
        XCTAssertTrue(failed.contains("失败"), "失败态须点明失败，不能被误当成功：\(failed)")
        for s in [SettingsStrings.placeSaved(.en), SettingsStrings.placeSaveFailed(.en), SettingsStrings.placeCleared(.en)] {
            XCTAssertFalse(s.isEmpty)
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
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
