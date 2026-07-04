import XCTest
@testable import BeeUrEiCore

final class EmergencyReplyAnnouncementTests: XCTestCase {
    func testAckAndClearAreSpoken() {
        XCTAssertEqual(
            EmergencyReplyAnnouncement.spokenText(kind: "emergency_ack", title: "妈妈已收到你的求助", body: "妈妈正在赶来", language: .zh),
            "妈妈已收到你的求助。妈妈正在赶来")
        XCTAssertEqual(
            EmergencyReplyAnnouncement.spokenText(kind: "emergency_clear", title: "Alice is OK", body: "The alert is cleared", language: .en),
            "Alice is OK. The alert is cleared")
    }

    func testOtherKindsNotSpoken() {
        // 来电/普通消息/告警本身等不走这条（各有自己的呈现），返回 nil 不打扰。
        XCTAssertNil(EmergencyReplyAnnouncement.spokenText(kind: "emergency_alert", title: "x", body: "y", language: .zh))
        XCTAssertNil(EmergencyReplyAnnouncement.spokenText(kind: "incoming_call", title: "x", body: "y", language: .zh))
        XCTAssertNil(EmergencyReplyAnnouncement.spokenText(kind: nil, title: "x", body: "y", language: .zh))
    }

    func testEmptyPartsHandled() {
        XCTAssertEqual(EmergencyReplyAnnouncement.spokenText(kind: "emergency_ack", title: "妈妈已收到", body: "", language: .zh), "妈妈已收到")
        XCTAssertEqual(EmergencyReplyAnnouncement.spokenText(kind: "emergency_ack", title: "  ", body: "已收到", language: .zh), "已收到")
        XCTAssertNil(EmergencyReplyAnnouncement.spokenText(kind: "emergency_ack", title: "", body: "   ", language: .zh)) // 全空→nil
    }
}
