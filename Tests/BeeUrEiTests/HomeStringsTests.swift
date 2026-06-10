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
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
