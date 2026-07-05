import XCTest
@testable import BeeUrEiCore

final class SharedLocationAccuracyTests: XCTestCase {
    func testValidAccuracyPhrase() {
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 20, language: .zh), "精确到约20米")
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 19.6, language: .zh), "精确到约20米") // 四舍五入
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 30, language: .en), "~30 m accuracy")
    }

    func testInvalidAccuracyReturnsNil() {
        XCTAssertNil(SharedLocationAccuracy.phrase(accuracyMeters: nil, language: .zh))   // 老客户端未上报
        XCTAssertNil(SharedLocationAccuracy.phrase(accuracyMeters: 0, language: .zh))     // 0=无信息
        XCTAssertNil(SharedLocationAccuracy.phrase(accuracyMeters: -5, language: .zh))    // 负=CoreLocation 无效精度
        XCTAssertNil(SharedLocationAccuracy.phrase(accuracyMeters: .nan, language: .zh))
        XCTAssertNil(SharedLocationAccuracy.phrase(accuracyMeters: .infinity, language: .zh))
    }

    func testLargeAccuracyUsesKilometers() {
        // ≥1km 改用公里（读屏可听度：约1.5公里 >> 约1500米），与 web geoAccuracy 同口径。
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 1000, language: .zh), "精确到约1公里") // 边界：整公里去尾零
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 1500, language: .zh), "精确到约1.5公里") // 0.1 精度
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 2000, language: .en), "~2 km accuracy") // 去尾零 2.0→2
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 999, language: .zh), "精确到约999米")   // <1km 仍用米
    }

    func testHugeAccuracyDoesNotOverflowCrash() {
        // accuracy 来自网络：巨大有限值裸 Int() 会陷阱崩溃；safeRoundedInt 夹取到 1e6（=1000 公里），不崩。
        let out = SharedLocationAccuracy.phrase(accuracyMeters: 1e19, language: .zh)
        XCTAssertEqual(out, "精确到约1000公里") // 夹取有界，且大值以公里呈现（1000000米→1000公里，更可听）
    }
}
