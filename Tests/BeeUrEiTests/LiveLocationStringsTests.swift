import XCTest
@testable import BeeUrEi

/// 实时位置文案：对端电量段（未知不显示不猜、低电量点明"偏低"——VoiceOver 听不到红色，语义必须在文字里）。
final class LiveLocationStringsTests: XCTestCase {
    func testBatteryTextPresenceRules() {
        XCTAssertEqual(LiveLocationStrings.batteryText(85, .zh), "电量 85%")
        XCTAssertEqual(LiveLocationStrings.batteryText(20, .zh), "电量 20%，偏低")   // 边界 20 含"偏低"
        XCTAssertEqual(LiveLocationStrings.batteryText(21, .zh), "电量 21%")
        XCTAssertEqual(LiveLocationStrings.batteryText(5, .en), "battery 5%, low")
        // 未知/越界（老客户端不上报）→ nil：不显示、绝不猜。
        XCTAssertNil(LiveLocationStrings.batteryText(nil, .zh))
        XCTAssertNil(LiveLocationStrings.batteryText(-1, .zh))
        XCTAssertNil(LiveLocationStrings.batteryText(150, .zh))
    }

    func testContactA11yIncludesBatteryOnlyWhenPresent(){
        let with = LiveLocationStrings.contactA11y(name: "妈妈", role: "亲友", distance: "300米", updated: "1分钟前",
                                                   battery: "电量 15%，偏低", .zh)
        XCTAssertTrue(with.contains("电量 15%，偏低"))
        let without = LiveLocationStrings.contactA11y(name: "妈妈", role: "亲友", distance: "300米", updated: "1分钟前", .zh)
        XCTAssertFalse(without.contains("电量"))
        // 英文不串中文。
        let en = LiveLocationStrings.contactA11y(name: "Mom", role: "family", distance: "300 m", updated: "1 min ago",
                                                 battery: "battery 15%, low", .en)
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testRelativeMovementClassification() {
        // 对端在正北（本人→对端 bearing=0）：对端朝南(180)走=朝本人来=靠近；朝北(0)走=越走越远；朝东(90)=横向。
        XCTAssertEqual(LiveLocationStrings.relativeMovement(headingDegrees: 180, bearingToContactDegrees: 0), .approaching)
        XCTAssertEqual(LiveLocationStrings.relativeMovement(headingDegrees: 0, bearingToContactDegrees: 0), .movingAway)
        XCTAssertEqual(LiveLocationStrings.relativeMovement(headingDegrees: 90, bearingToContactDegrees: 0), .crossing)
        // 环绕正确：对端在东南（bearing=135），朝西北(315)走=朝本人来=靠近。
        XCTAssertEqual(LiveLocationStrings.relativeMovement(headingDegrees: 315, bearingToContactDegrees: 135), .approaching)
        // 60°/120° 边界带：偏 45° 仍算靠近（<=60）；偏 90° 落横向带。
        XCTAssertEqual(LiveLocationStrings.relativeMovement(headingDegrees: 180 + 45, bearingToContactDegrees: 0), .approaching)
        XCTAssertEqual(LiveLocationStrings.relativeMovement(headingDegrees: 180 + 90, bearingToContactDegrees: 0), .crossing)
        // 非有限（坏 heading/坏 bearing）→ crossing（不误报趋势，且不播）。
        XCTAssertEqual(LiveLocationStrings.relativeMovement(headingDegrees: .nan, bearingToContactDegrees: 0), .crossing)
        XCTAssertEqual(LiveLocationStrings.relativeMovement(headingDegrees: 180, bearingToContactDegrees: .infinity), .crossing)
    }

    func testArrivedAtPlaceBilingualUsesLabel() {
        // 到达围栏自播报用地点 label（家/公司/自定义），双语，英文不串中文。
        XCTAssertEqual(LiveLocationStrings.arrivedAtPlace("家", .zh), "你到家了")
        XCTAssertEqual(LiveLocationStrings.arrivedAtPlace("公司", .zh), "你到公司了")
        let en = LiveLocationStrings.arrivedAtPlace("Work", .en)
        XCTAssertTrue(en.contains("Work") && en.lowercased().contains("arrived"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testSavedPlaceDecodesLatLngForGeofence() throws {
        // 服务端 /api/places 下发 lat/lng（保存时 geocode 缓存），iOS 须解码供到达围栏——此前丢弃这两字段。
        let json = #"{"ownerId":"u1","label":"家","address":"XX路1号","lat":39.9,"lng":116.4,"updatedAt":1700000000000}"#
        let p = try JSONDecoder().decode(APIClient.SavedPlace.self, from: Data(json.utf8))
        XCTAssertEqual(p.lat, 39.9); XCTAssertEqual(p.lng, 116.4); XCTAssertEqual(p.label, "家")
        // geocode 失败/境外：坐标缺失 → nil（围栏跳过该地点，不崩）。
        let noCoord = #"{"ownerId":"u1","label":"公司","address":"海外","updatedAt":1700000000000}"#
        let p2 = try JSONDecoder().decode(APIClient.SavedPlace.self, from: Data(noCoord.utf8))
        XCTAssertNil(p2.lat); XCTAssertNil(p2.lng)
    }

    func testMovementPhraseBilingualCrossingSilent() {
        XCTAssertEqual(LiveLocationStrings.movementPhrase(.approaching, .zh), "，正朝你靠近")
        XCTAssertEqual(LiveLocationStrings.movementPhrase(.movingAway, .zh), "，正在远离")
        XCTAssertNil(LiveLocationStrings.movementPhrase(.crossing, .zh)) // 横向不播（信息量低、易误导）
        // 英文不串中文。
        for m in [LiveLocationStrings.RelativeMovement.approaching, .movingAway] {
            let en = LiveLocationStrings.movementPhrase(m, .en)!
            XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        }
    }

    func testContactAddressTextComposition() {
        // address 优先；带 AOI 附"（在X一带）"大方位锚点（盲人看不到地图，靠这句听到家人在哪片）。
        XCTAssertEqual(LiveLocationStrings.contactAddressText(address: "北京市朝阳区呼家楼街道景华南街5号", township: "呼家楼街道", aoiName: "华贸中心", .zh),
                       "北京市朝阳区呼家楼街道景华南街5号（在华贸中心一带）")
        // address 空 → 退回 township；无 AOI → 只报基址。
        XCTAssertEqual(LiveLocationStrings.contactAddressText(address: "", township: "望京街道", aoiName: nil, .zh), "望京街道")
        // AOI 名已含在基址里 → 不重复附。
        XCTAssertEqual(LiveLocationStrings.contactAddressText(address: "华贸中心南门", township: "", aoiName: "华贸中心", .zh), "华贸中心南门")
        // address 与 township 皆空 → nil（无地址，绝不硬凑"（在X一带）"这种半句）。
        XCTAssertNil(LiveLocationStrings.contactAddressText(address: "   ", township: "", aoiName: "某AOI", .zh))
        // 英文分支不串中文。
        let en = LiveLocationStrings.contactAddressText(address: "5 Jinghua St", township: "", aoiName: "Guomao", .en)!
        XCTAssertEqual(en, "5 Jinghua St (near Guomao)")
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testAddressStillFreshInvalidatesOnMove() {
        // 缓存地址仅当仍对应联系人当前位置（updatedAt 一致）才复用/显示——对方移动后旧地址过时，须重查、不复述旧位置。
        XCTAssertTrue(LiveLocationStrings.addressStillFresh(cachedUpdatedAt: 1_700_000_000_000, currentUpdatedAt: 1_700_000_000_000)) // 未移动→仍新鲜
        XCTAssertFalse(LiveLocationStrings.addressStillFresh(cachedUpdatedAt: 1_700_000_000_000, currentUpdatedAt: 1_700_000_005_000)) // 已移动(updatedAt 前进)→过时
        XCTAssertFalse(LiveLocationStrings.addressStillFresh(cachedUpdatedAt: nil, currentUpdatedAt: 1_700_000_000_000)) // 无缓存→不新鲜
    }

    func testContactA11yIncludesAddressOnlyWhenPresent() {
        // 取到地址 → 合并 a11y 标签含"所在地址：X"（VoiceOver 复读也念）；未取到（nil）→ 不含该段（严格附加）。
        let withAddr = LiveLocationStrings.contactA11y(name: "妈妈", role: "亲友", distance: "约 200 米，在你的东北", updated: "刚刚更新", address: "朝阳区XX路", .zh)
        XCTAssertTrue(withAddr.contains("所在地址：朝阳区XX路"), withAddr)
        let noAddr = LiveLocationStrings.contactA11y(name: "妈妈", role: "亲友", distance: "约 200 米", updated: "刚刚更新", .zh)
        XCTAssertFalse(noAddr.contains("所在地址"), noAddr)
    }
}
