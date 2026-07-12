import XCTest
@testable import BeeUrEi

/// 通知深链（与 web notifDestination 同判定顺序 + iOS 诚实适配）。
/// 判定错误的后果：账号安全告警被送去亲友页（撤销入口在账户页）；或点了没反应的死链接。
final class NotifDestinationTests: XCTestCase {

    private func dest(_ kind: String, _ data: [String: String]? = nil) -> NotifDestination {
        NotifDestination.destination(kind: kind, data: data)
    }

    func testSecurityBeforeLinkTrap() {
        // security_apple_linked 含子串 "link"——须归账户页（绑/解绑复核撤销都在那），不能被 friend/link 抢去亲友页。
        XCTAssertEqual(dest("security_apple_linked"), .account)
        XCTAssertEqual(dest("kyc_verified"), .account)
        XCTAssertEqual(dest("medical_viewed"), .account)
    }

    func testRelationAndSafetyKindsGoFamily() {
        XCTAssertEqual(dest("emergency_contact_set"), .family)  // 关系事件（非 SOS）→ 亲友页管理
        XCTAssertEqual(dest("checkin_due"), .family)            // 报到操作卡就在亲友页
        XCTAssertEqual(dest("friend_request_accepted"), .family)
    }

    func testConversationKindsDeepLinkWithData() {
        // 群类/置顶带 groupId → 直达群聊；单聊置顶带 fromId → 直达会话；两者都无 → 不深链。
        XCTAssertEqual(dest("group_member_added", ["groupId": "g1"]), .groupChat(groupId: "g1"))
        XCTAssertEqual(dest("message_pinned", ["groupId": "g1"]), .groupChat(groupId: "g1"))
        XCTAssertEqual(dest("message_pinned", ["fromId": "u1"]), .directChat(peerId: "u1"))
        XCTAssertEqual(dest("message_pinned", nil), .none)
        // 你已进不去的群（被移出/解散）不深链——点进去只会 403/空（iOS 诚实适配）。
        XCTAssertEqual(dest("group_removed", ["groupId": "g1"]), .none)
        XCTAssertEqual(dest("group_dissolved", ["groupId": "g1"]), .none)
    }

    func testLocationKindsAndHonestNones() {
        XCTAssertEqual(dest("location_request"), .locations)
        XCTAssertEqual(dest("location_share_started"), .locations)
        XCTAssertEqual(dest("place_arrival"), .locations)
        XCTAssertEqual(dest("battery_low"), .locations)
        // iOS 无独立路线库页 → route 类不深链（诚实 none，胜过跳错地方）。
        XCTAssertEqual(dest("route_added"), .none)
        // 真 SOS 告警有专属行内按钮（回执/医疗/地图），故意不整行深链。
        XCTAssertEqual(dest("emergency_alert"), .none)
        // 举报处理结果：web notifDestination 亦无去处（null）——结果已在通知正文里说尽，无后续操作页。
        XCTAssertEqual(dest("report_resolved"), .none)
    }

    func testLabelsBilingual() {
        XCTAssertEqual(NotifDestination.directChat(peerId: "x").label(.zh), "打开会话")
        XCTAssertEqual(NotifDestination.locations.label(.zh), "打开位置页")
        for d in [NotifDestination.account, .family, .directChat(peerId: "x"), .groupChat(groupId: "g"), .locations] {
            let s = d.label(.en)
            XCTAssertFalse(s.isEmpty)
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
        }
    }
}
