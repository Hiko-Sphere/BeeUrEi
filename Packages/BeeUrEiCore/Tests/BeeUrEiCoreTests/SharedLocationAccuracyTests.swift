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

    func testMatchesWebRoundingAtBoundaries() {
        // 跨端一致（兑现"与 web geoAccuracy 同口径"）：旧版先把 accuracy 取整成米再判档/算公里，与 web
        // （对**原始值**判档、round(a/100)/10）在边界分叉。现对夹取后原始值计算，单位与 0.1km 舍入均对齐。
        // 999.6m：web 归"米"档（a<1000→1000 米）；旧 iOS 因 round→1000 误归"公里"档报"1公里"。
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 999.6, language: .zh), "精确到约1000米")
        // 1449.6m：web=round(14.496)/10=1.4；旧 iOS 先 round→1450 再 round(14.5)=15→1.5，整整差 0.1km。
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 1449.6, language: .zh), "精确到约1.4公里")
        XCTAssertEqual(SharedLocationAccuracy.phrase(accuracyMeters: 1449.6, language: .en), "~1.4 km accuracy")
    }

    func testHugeAccuracyDoesNotOverflowCrash() {
        // accuracy 来自网络：巨大有限值裸 Int() 会陷阱崩溃；safeRoundedInt 夹取到 1e6（=1000 公里），不崩。
        let out = SharedLocationAccuracy.phrase(accuracyMeters: 1e19, language: .zh)
        XCTAssertEqual(out, "精确到约1000公里") // 夹取有界，且大值以公里呈现（1000000米→1000公里，更可听）
    }
}
