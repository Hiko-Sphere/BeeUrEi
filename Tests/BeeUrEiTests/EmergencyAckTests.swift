import XCTest
@testable import BeeUrEi

/// 响应者回执 SOS（「我在赶来」/「我已看到」）：门控纯函数 + 双语文案。
/// 门控是安全关键——显示错了会让响应者对着"报平安/有人在响应"等协调通知误发回执，
/// 或对无 fromId 的关系事件渲染空目标按钮。
final class EmergencyAckTests: XCTestCase {

    // MARK: 门控

    func testOffersOnReceivedAlertWithSender() {
        // 收到的 SOS 告警（升级重呼复用同 kind，天然同样显示）。
        XCTAssertTrue(EmergencyAckStrings.shouldOffer(kind: "emergency_alert", fromId: "u1"))
    }

    func testDoesNotOfferOnFollowupCoordinationKinds() {
        // 后续协调通知：报平安/有人在响应/有人已看到——不是可回执的告警本体。
        XCTAssertFalse(EmergencyAckStrings.shouldOffer(kind: "emergency_clear", fromId: "u1"))
        XCTAssertFalse(EmergencyAckStrings.shouldOffer(kind: "emergency_responding", fromId: "u1"))
        XCTAssertFalse(EmergencyAckStrings.shouldOffer(kind: "emergency_ack", fromId: "u1"))
        // 关系事件（如 emergency_contact_set）与非紧急 kind 一律不显示。
        XCTAssertFalse(EmergencyAckStrings.shouldOffer(kind: "emergency_contact_set", fromId: "u1"))
        XCTAssertFalse(EmergencyAckStrings.shouldOffer(kind: "report_resolved", fromId: "u1"))
    }

    func testDoesNotOfferWithoutSender() {
        // 无回执对象（fromId 缺/空）绝不显示——按钮点了也没有语义。
        XCTAssertFalse(EmergencyAckStrings.shouldOffer(kind: "emergency_alert", fromId: nil))
        XCTAssertFalse(EmergencyAckStrings.shouldOffer(kind: "emergency_alert", fromId: ""))
    }

    // MARK: 文案

    func testChineseMatchesWebPhrases() {
        // 与网页端同语义文案（跨端一致，用户在两端看到同一措辞）。
        XCTAssertEqual(EmergencyAckStrings.onMyWay(.zh), "我在赶来")
        XCTAssertEqual(EmergencyAckStrings.seen(.zh), "我已看到")
        XCTAssertEqual(EmergencyAckStrings.ackedOnMyWay(.zh), "已告知对方你正在赶来")
        XCTAssertEqual(EmergencyAckStrings.ackedSeen(.zh), "已回执，对方会看到你在响应")
        XCTAssertEqual(EmergencyAckStrings.onMyWayA11y("小明", .zh), "我正赶去帮 小明")
    }

    func testEnglishHasNoChinese() {
        let samples = [
            EmergencyAckStrings.onMyWay(.en), EmergencyAckStrings.seen(.en),
            EmergencyAckStrings.ackedOnMyWay(.en), EmergencyAckStrings.ackedSeen(.en),
            EmergencyAckStrings.failed(.en),
            EmergencyAckStrings.onMyWayA11y("Ann", .en), EmergencyAckStrings.seenA11y("Ann", .en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }

    // MARK: 紧急就绪度——紧急联系人可否被推送触达（补 hasUsableEmergencyContact 的"收不收得到"缺口）

    func testUnreachableEmergencyWarningFiresOnlyWhenSomeUnreachable() {
        typealias R = EmergencyReadinessInfo
        // 全部可达 → 无警告（就绪）。
        XCTAssertNil(R(hasEmergencyContact: true, total: 2, reachable: 2, acceptedTotal: 2, acceptedReachable: 2,
                       contacts: [.init(name: "小红", relation: "女儿", reachable: true), .init(name: "小明", relation: "儿子", reachable: true)])
                       .unreachableEmergencyWarning(.zh))
        // 无紧急联系人 → nil（由本地 hasUsableEmergencyContact 另报，不在此重复）。
        XCTAssertNil(R(hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 0, acceptedReachable: 0, contacts: [])
                       .unreachableEmergencyWarning(.zh))
        // 有紧急联系人但一位不可达 → 警告并**点名**那位（更可行动）。
        let warn = R(hasEmergencyContact: true, total: 2, reachable: 1, acceptedTotal: 2, acceptedReachable: 1,
                     contacts: [.init(name: "小红", relation: "女儿", reachable: true), .init(name: "小明", relation: "儿子", reachable: false)])
                     .unreachableEmergencyWarning(.zh)
        XCTAssertNotNil(warn)
        XCTAssertTrue(warn!.contains("小明"))       // 点名不可达者
        XCTAssertFalse(warn!.contains("小红"))      // 可达者不点名
        XCTAssertTrue(warn!.contains("开启通知"))   // 给出可行动建议
        // 缺 contacts 明细（老服务端）→ 退回按**数量**报，仍不静默。
        let byCount = R(hasEmergencyContact: true, total: 3, reachable: 1, acceptedTotal: 3, acceptedReachable: 1, contacts: nil)
                        .unreachableEmergencyWarning(.zh)
        XCTAssertNotNil(byCount); XCTAssertTrue(byCount!.contains("2位"))
        // 英文分支不串中文。
        let en = R(hasEmergencyContact: true, total: 1, reachable: 0, acceptedTotal: 1, acceptedReachable: 0,
                   contacts: [.init(name: "Ann", relation: "daughter", reachable: false)]).unreachableEmergencyWarning(.en)!
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        XCTAssertTrue(en.lowercased().contains("notifications"))
    }
}
