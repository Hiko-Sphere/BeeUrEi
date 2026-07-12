import XCTest
@testable import BeeUrEi

/// 亲友请求共享位置（location_request）接收侧：门控纯函数 + 双语文案。
/// 门控错误的后果：对回执类通知（location_share_started）误显"开始共享"按钮会造成语义混乱；
/// 对无 fromId 的行渲染无对象按钮。
final class LocationRequestTests: XCTestCase {

    // MARK: 门控

    func testOffersOnLocationRequestWithSender() {
        XCTAssertTrue(LocationRequestStrings.shouldOffer(kind: "location_request", fromId: "u1"))
    }

    func testDoesNotOfferOnOtherKinds() {
        // 回执类（对方已开始共享）与其他 kind 一律不显示。
        XCTAssertFalse(LocationRequestStrings.shouldOffer(kind: "location_share_started", fromId: "u1"))
        XCTAssertFalse(LocationRequestStrings.shouldOffer(kind: "emergency_alert", fromId: "u1"))
        XCTAssertFalse(LocationRequestStrings.shouldOffer(kind: "report_resolved", fromId: "u1"))
    }

    func testDoesNotOfferWithoutSender() {
        XCTAssertFalse(LocationRequestStrings.shouldOffer(kind: "location_request", fromId: nil))
        XCTAssertFalse(LocationRequestStrings.shouldOffer(kind: "location_request", fromId: ""))
    }

    // MARK: 文案

    func testChinesePhrases() {
        XCTAssertEqual(LocationRequestStrings.share(.zh), "开始共享位置")
        XCTAssertEqual(LocationRequestStrings.started(.zh), "已开始共享，对方会收到通知")
        XCTAssertEqual(LocationRequestStrings.shareA11y("小明", .zh), "开始共享位置给 小明")
        // 无名请求者：a11y 退化为按钮基础文案，不留悬垂的"给 "。
        XCTAssertEqual(LocationRequestStrings.shareA11y("", .zh), "开始共享位置")
    }

    func testEnglishHasNoChinese() {
        let samples = [
            LocationRequestStrings.share(.en), LocationRequestStrings.alreadySharing(.en),
            LocationRequestStrings.started(.en), LocationRequestStrings.shareA11y("Ann", .en),
            LocationRequestStrings.shareA11y("", .en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
