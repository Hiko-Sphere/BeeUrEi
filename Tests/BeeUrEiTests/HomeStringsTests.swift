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
