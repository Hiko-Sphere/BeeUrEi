import XCTest
@testable import BeeUrEi

/// Codable 静默丢弃收尾两项：联系人实名徽标（verified）+ 未看未接来电（missedCalls）。
/// 服务端两字段都一直在返，iOS 未声明即被丢弃——徽标/角标永远不显示，且编译不报错。
final class VerifiedMissedCallsTests: XCTestCase {

    // MARK: 实名徽标（FamilyLinkInfo / IncomingLinkInfo.verified）

    func testDecodesLinkVerifiedAndGatesBadge() throws {
        let link = try JSONDecoder().decode(FamilyLinkInfo.self, from: Data("""
        {"id":"l1","memberId":"u2","memberName":"小明","relation":"家人","isEmergency":true,
         "phone":null,"status":"accepted","verified":true}
        """.utf8))
        XCTAssertEqual(link.verified, true)
        XCTAssertTrue(link.showsVerifiedBadge)   // 视图用同一门控——中子它=拔掉徽标接线
        // 旧服务端无字段 → nil → 不显徽标（绝不把未核验显示成已核验）。
        let old = try JSONDecoder().decode(FamilyLinkInfo.self, from: Data("""
        {"id":"l1","memberId":"u2","memberName":"小明","relation":"家人","isEmergency":false,"phone":null,"status":"accepted"}
        """.utf8))
        XCTAssertNil(old.verified)
        XCTAssertFalse(old.showsVerifiedBadge)
        // 显式 false 同样不显。
        XCTAssertFalse(FamilyLinkInfo(id: "x", memberId: "y", memberName: "n", memberAvatar: nil, relation: "r",
                                      isEmergency: false, phone: nil, status: "accepted", outgoing: nil,
                                      online: nil, amOwner: nil, verified: false).showsVerifiedBadge)
    }

    func testDecodesIncomingRequestVerified() throws {
        // 待确认请求也带 verified——决定是否接受一段安全关系时该看到。
        let inc = try JSONDecoder().decode(IncomingLinkInfo.self, from: Data("""
        {"id":"l2","ownerId":"u9","ownerName":"王叔","relation":"邻居","isEmergency":false,
         "status":"pending","verified":true}
        """.utf8))
        XCTAssertTrue(inc.showsVerifiedBadge)
        XCTAssertTrue(inc.isPending)
    }

    // MARK: 未接来电角标（UnreadSummary.missedCalls）

    func testDecodesMissedCallsAndBadgeCount() throws {
        let s = try JSONDecoder().decode(APIClient.UnreadSummary.self, from: Data("""
        {"messages":2,"notifications":1,"missedCalls":3,"total":6}
        """.utf8))
        XCTAssertEqual(s.missedCalls, 3)
        XCTAssertEqual(s.missedCallBadgeCount, 3)  // 视图用同一门控
        // 旧服务端无字段 → 0（不显角标，不崩）。
        let old = try JSONDecoder().decode(APIClient.UnreadSummary.self, from: Data("""
        {"messages":2,"notifications":1,"total":3}
        """.utf8))
        XCTAssertNil(old.missedCalls)
        XCTAssertEqual(old.missedCallBadgeCount, 0)
        // 负值防御（上游 bug）→ 0。
        let bad = try JSONDecoder().decode(APIClient.UnreadSummary.self, from: Data("""
        {"messages":0,"notifications":0,"missedCalls":-2,"total":0}
        """.utf8))
        XCTAssertEqual(bad.missedCallBadgeCount, 0)
    }

    // MARK: 文案

    func testBadgeStringsBilingual() {
        XCTAssertEqual(AssistStrings.verifiedA11y(.zh), "已通过实名认证")
        XCTAssertEqual(AccountStrings.missedCallsBadgeA11y(3, .zh), "有 3 个未看的未接来电")
        XCTAssertEqual(AccountStrings.missedCallsBadgeA11y(1, .en), "1 unseen missed call")
        XCTAssertEqual(AccountStrings.missedCallsBadgeA11y(2, .en), "2 unseen missed calls")
        for s in [AssistStrings.verifiedA11y(.en), AccountStrings.missedCallsBadgeA11y(2, .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        }
    }
}
