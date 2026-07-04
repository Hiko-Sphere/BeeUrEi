import XCTest
@testable import BeeUrEiCore

final class EmergencyPushAnnouncementTests: XCTestCase {
    func testAlertAckClearAreSpoken() {
        // 求助告警本身（家人收到）——盲人若互为紧急联系人，须听到"谁怎么了"，而非只有默认提示音。
        XCTAssertEqual(
            EmergencyPushAnnouncement.spokenText(kind: "emergency_alert", title: "紧急求助", body: "妈妈可能摔倒了，请查看位置", language: .zh),
            "紧急求助。妈妈可能摔倒了，请查看位置")
        // 已收到回执（发起 SOS 的盲人收到）。
        XCTAssertEqual(
            EmergencyPushAnnouncement.spokenText(kind: "emergency_ack", title: "妈妈已收到你的求助", body: "妈妈正在赶来", language: .zh),
            "妈妈已收到你的求助。妈妈正在赶来")
        // 报平安。
        XCTAssertEqual(
            EmergencyPushAnnouncement.spokenText(kind: "emergency_clear", title: "Alice is OK", body: "The alert is cleared", language: .en),
            "Alice is OK. The alert is cleared")
    }

    func testOtherKindsNotSpoken() {
        // 来电/普通消息/好友请求等不走这条（各有自己的呈现），返回 nil 不打扰、不误读。
        XCTAssertNil(EmergencyPushAnnouncement.spokenText(kind: "incoming_call", title: "x", body: "y", language: .zh))
        XCTAssertNil(EmergencyPushAnnouncement.spokenText(kind: "friend_request", title: "x", body: "y", language: .zh))
        XCTAssertNil(EmergencyPushAnnouncement.spokenText(kind: nil, title: "x", body: "y", language: .zh))
    }

    func testEmptyPartsHandled() {
        XCTAssertEqual(EmergencyPushAnnouncement.spokenText(kind: "emergency_ack", title: "妈妈已收到", body: "", language: .zh), "妈妈已收到")
        XCTAssertEqual(EmergencyPushAnnouncement.spokenText(kind: "emergency_ack", title: "  ", body: "已收到", language: .zh), "已收到")
        XCTAssertNil(EmergencyPushAnnouncement.spokenText(kind: "emergency_alert", title: "", body: "   ", language: .zh)) // 全空→nil
    }
}
