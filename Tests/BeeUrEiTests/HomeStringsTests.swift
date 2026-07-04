import XCTest
@testable import BeeUrEi

/// 主屏文案表（E5 第四批）：中文与历史一致、英文不串中文。
final class HomeStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        XCTAssertEqual(HomeStrings.helpTitle(.zh), "求助")
        XCTAssertEqual(HomeStrings.trafficGreen(.zh), "绿灯 · 可通行")
        XCTAssertEqual(HomeStrings.proximityMeters(1.5, .zh), "正前方约 1.5 米")
        XCTAssertEqual(HomeStrings.proximityClear(.zh), "正前方通畅")
        XCTAssertEqual(HomeStrings.permAnnounce(.zh), "相机权限被关闭，避障已停止。请到设置开启相机权限，或呼叫帮手。")
    }

    func testEnglishHasNoChinese() {
        let samples = [
            HomeStrings.helpSubtitle(.en), HomeStrings.hintAround(.en), HomeStrings.trafficYellow(.en),
            HomeStrings.proximityMeters(2.0, .en), HomeStrings.permBody(.en),
            HomeStrings.unsupportedAnnounce("No LiDAR.", .en), HomeStrings.noLiDARMessage(.en),
            HomeStrings.batterySpeak(percent: 80, charging: false, .en), HomeStrings.timeSpeak("3:25 PM", .en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }

    func testVoiceCommandsHelpAdvertisesCallByName() {
        // 语音能力必须能被语音发现：自述里要提"给某人打电话"，否则加了 callContact 盲人也无从得知。
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.zh).contains("给某人打电话"))
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.en).lowercased().contains("call a family member"))
        // 发消息能力仍在（别改串了），且英文自述不混中文。
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.zh).contains("给某人发消息"))
        XCTAssertFalse(HomeStrings.voiceCommandsHelp(.en).contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testFallCancelHintTeachesMagicTapUnderVoiceOver() {
        // VoiceOver 开：教 Magic Tap（双指双击全屏任意处）——摔倒/撞击后手机常够不到，"找我没事按钮"极不可靠。
        let voZh = HomeStrings.fallCancelHint(voiceOver: true, .zh)
        XCTAssertTrue(voZh.contains("双指") && voZh.contains("双击"), "VoiceOver 中文提示应教双指双击：\(voZh)")
        XCTAssertFalse(voZh.contains("按钮"), "VoiceOver 提示不该再叫用户找按钮：\(voZh)")
        XCTAssertTrue(HomeStrings.fallCancelHint(voiceOver: true, .en).lowercased().contains("two-finger"))
        // VoiceOver 关（低视力/明眼）：仍指向「我没事」大按钮。
        XCTAssertTrue(HomeStrings.fallCancelHint(voiceOver: false, .zh).contains("我没事"))
        XCTAssertTrue(HomeStrings.fallCancelHint(voiceOver: false, .en).contains("I'm OK"))
        // 三条倒计时播报都按 voiceOver 带上对应提示（完整版为"双指在屏幕上双击"，故分别查两个词元）。
        let spoken = HomeStrings.fallAlertSpeak(kind: "fall", voiceOver: true, .zh)
        XCTAssertTrue(spoken.contains("双指") && spoken.contains("双击"), "摔倒播报应含双指双击提示：\(spoken)")
        XCTAssertTrue(HomeStrings.fallAlertSpeak(kind: "crash", voiceOver: false, .zh).contains("按钮"))
        XCTAssertTrue(HomeStrings.manualSosSpeak(voiceOver: true, .en).lowercased().contains("two-finger"))
        XCTAssertTrue(HomeStrings.fallAlertReminder(15, voiceOver: true, .zh).contains("双指双击屏幕可取消"))
        // 英文变体不串中文。
        for s in [HomeStrings.fallAlertSpeak(kind: "fall", voiceOver: true, .en),
                  HomeStrings.manualSosSpeak(voiceOver: false, .en),
                  HomeStrings.fallAlertReminder(15, voiceOver: true, .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(s)")
        }
    }

    func testBatterySpeakLevelsAndCharging() {
        // 充电中：报百分比 + 充电，不给"偏低"提示。
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 15, charging: true, .zh).contains("正在充电"))
        XCTAssertFalse(HomeStrings.batterySpeak(percent: 15, charging: true, .zh).contains("偏低"))
        // 未充电且 ≤20%：追加"偏低，建议充电"（手机没电=盲人丢失导航/求助工具）。
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 15, charging: false, .zh).contains("偏低"))
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 12, charging: false, .en).lowercased().contains("running low"))
        // 未充电且 >20%：只报百分比，不误报偏低。
        XCTAssertFalse(HomeStrings.batterySpeak(percent: 80, charging: false, .zh).contains("偏低"))
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 80, charging: false, .zh).contains("百分之80"))
        // 越界夹取（异常读数不崩、不越 0–100）。
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 150, charging: false, .zh).contains("百分之100"))
        XCTAssertTrue(HomeStrings.batterySpeak(percent: -5, charging: false, .zh).contains("百分之0"))
    }
}
