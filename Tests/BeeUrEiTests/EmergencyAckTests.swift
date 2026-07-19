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

    /// readinessNotice：以**实际告警扇出面 acceptedReachable** 判定，修"有非紧急联系人却误报无人会被通知"的假警报。
    func testReadinessNoticeUsesAcceptedFanoutNotJustEmergency() {
        typealias R = EmergencyReadinessInfo
        func hasCJK(_ s: String) -> Bool { s.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }
        // 完全没有联系人 → 危险"没人会被通知"。
        let none = R(hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 0, acceptedReachable: 0, contacts: [])
            .readinessNotice(.zh)
        XCTAssertEqual(none?.danger, true); XCTAssertTrue(none!.text.contains("还没有任何联系人"))
        // **假警报修复的核心**：有 2 位 accepted 非紧急联系人（都可达、会被告警）、无紧急联系人 →
        // 提示级（danger=false），说"都会收到告警"，绝不再说"无人可通知"。
        let nonEmerg = R(hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 2, acceptedReachable: 2, contacts: [])
            .readinessNotice(.zh)
        XCTAssertEqual(nonEmerg?.danger, false)                 // 非危险：确有人会被通知
        XCTAssertTrue(nonEmerg!.text.contains("都会收到告警"))   // 如实告知会被通知
        XCTAssertFalse(nonEmerg!.text.contains("无人"))         // 绝不误报"无人"
        // 有联系人但此刻都收不到即时推送 → 危险"都收不到，SOS 到不了任何人"。
        let unreach = R(hasEmergencyContact: true, total: 1, reachable: 0, acceptedTotal: 3, acceptedReachable: 0, contacts: nil)
            .readinessNotice(.zh)
        XCTAssertEqual(unreach?.danger, true); XCTAssertTrue(unreach!.text.contains("3位")); XCTAssertTrue(unreach!.text.contains("到不了任何人"))
        // 有可达紧急联系人（就绪）→ nil（个别不可达交给 unreachableEmergencyWarning）。
        XCTAssertNil(R(hasEmergencyContact: true, total: 2, reachable: 2, acceptedTotal: 2, acceptedReachable: 2, contacts: nil).readinessNotice(.zh))
        XCTAssertNil(R(hasEmergencyContact: true, total: 2, reachable: 1, acceptedTotal: 2, acceptedReachable: 1, contacts: nil).readinessNotice(.zh))
        // 旧服务端缺 acceptedTotal/Reachable → 回落 total/reachable：有紧急联系人可达 → nil；全不可达 → 危险。
        XCTAssertNil(R(hasEmergencyContact: true, total: 1, reachable: 1, acceptedTotal: nil, acceptedReachable: nil, contacts: nil).readinessNotice(.zh))
        XCTAssertEqual(R(hasEmergencyContact: true, total: 1, reachable: 0, acceptedTotal: nil, acceptedReachable: nil, contacts: nil).readinessNotice(.zh)?.danger, true)
        // 英文分支不串中文。
        let en = R(hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 2, acceptedReachable: 2, contacts: []).readinessNotice(.en)
        XCTAssertNotNil(en); XCTAssertFalse(hasCJK(en!.text)); XCTAssertTrue(en!.text.lowercased().contains("alerted"))
        // 英文单复数：恰 1 位联系人不再语病（"1 contacts"/"Your 1 contacts will all be"）。
        let one = R(hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 1, acceptedReachable: 1, contacts: []).readinessNotice(.en)!
        XCTAssertTrue(one.text.hasPrefix("Your contact will be alerted"), one.text)   // 非 "Your 1 contacts will all be"
        XCTAssertFalse(one.text.contains("1 contacts"), one.text)
        let oneUnreach = R(hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 1, acceptedReachable: 0, contacts: []).readinessNotice(.en)!
        XCTAssertTrue(oneUnreach.text.contains("You have 1 contact, but they can't"), oneUnreach.text) // 非 "1 contacts, but none can"
        // 2 位仍复数（回归）。
        let two = R(hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 2, acceptedReachable: 2, contacts: []).readinessNotice(.en)!
        XCTAssertTrue(two.text.contains("Your 2 contacts will all be"), two.text)
    }

    // MARK: 测试告警结果播报（验证"我的求助真能到人"）

    func testTestAlertResultMessages() {
        // 全部可达 → 就绪确认。
        XCTAssertTrue(AssistStrings.testAlertResult(.sent(notified: 2, contacts: 2), .zh).contains("就绪"))
        // 部分可达 → 报出几位收得到 + 催其余开通知。
        let partial = AssistStrings.testAlertResult(.sent(notified: 1, contacts: 3), .zh)
        XCTAssertTrue(partial.contains("3位") && partial.contains("1位") && partial.contains("开启通知"))
        // 都收不到 → 强警告。
        XCTAssertTrue(AssistStrings.testAlertResult(.sent(notified: 0, contacts: 2), .zh).contains("都收不到"))
        // 无联系人 → 提示先加。
        XCTAssertTrue(AssistStrings.testAlertResult(.sent(notified: 0, contacts: 0), .zh).contains("还没有联系人"))
        // 限流 → 明确"每小时最多"，非泛泛失败。
        XCTAssertTrue(AssistStrings.testAlertResult(.rateLimited, .zh).contains("每小时最多"))
        XCTAssertFalse(AssistStrings.testAlertResult(.rateLimited, .zh).contains("网络")) // 与失败区分
        // 失败 → 网络提示。
        XCTAssertTrue(AssistStrings.testAlertResult(.failed, .zh).contains("网络"))
        // 英文分支不串中文。
        for o: TestAlertOutcome in [.sent(notified: 1, contacts: 2), .rateLimited, .failed] {
            let en = AssistStrings.testAlertResult(o, .en)
            XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(en)")
        }
    }
}
