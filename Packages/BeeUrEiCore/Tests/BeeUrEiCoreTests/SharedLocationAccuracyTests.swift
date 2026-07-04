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

    func testHugeAccuracyDoesNotOverflowCrash() {
        // accuracy 来自网络：巨大有限值裸 Int() 会陷阱崩溃；safeRoundedInt 夹取到 1e6，不崩。
        let out = SharedLocationAccuracy.phrase(accuracyMeters: 1e19, language: .zh)
        XCTAssertEqual(out, "精确到约1000000米")
    }
}
