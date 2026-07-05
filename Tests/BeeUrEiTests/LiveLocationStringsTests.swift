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
}
