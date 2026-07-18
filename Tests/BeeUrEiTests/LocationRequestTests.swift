import XCTest
import MapKit
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

    // MARK: MapKit POI 类别名（境外「周围有什么」类别 parity）

    func testMapKitPoiCategoryNameMapsCommonTypes() {
        // 境外 MapKit POI 类别 → 简短本地化类别名，补齐与境内高德"报类型"的 parity（盲人在国外一听即知是药店/超市/餐厅）。
        XCTAssertEqual(LocationDescriber.poiCategoryName(.pharmacy, .zh), "药店")
        XCTAssertEqual(LocationDescriber.poiCategoryName(.foodMarket, .zh), "超市")
        XCTAssertEqual(LocationDescriber.poiCategoryName(.restaurant, .zh), "餐厅")
        XCTAssertEqual(LocationDescriber.poiCategoryName(.atm, .zh), "取款机")
        XCTAssertEqual(LocationDescriber.poiCategoryName(.publicTransport, .zh), "公交站")
        // 英文按语言给（英文嗓念中文类别会乱；composer 只在中文模式追加，但映射本身如实按语言）。
        XCTAssertEqual(LocationDescriber.poiCategoryName(.pharmacy, .en), "pharmacy")
        XCTAssertEqual(LocationDescriber.poiCategoryName(.restaurant, .en), "restaurant")
        // nil 类别 / 未映射类别 → nil（不硬凑，composer 自然不追加、回退原行为）。
        XCTAssertNil(LocationDescriber.poiCategoryName(nil, .zh))
        XCTAssertNil(LocationDescriber.poiCategoryName(.aquarium, .zh)) // 未映射的小众类别
    }
}
