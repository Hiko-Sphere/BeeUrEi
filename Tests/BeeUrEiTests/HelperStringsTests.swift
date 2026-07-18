import XCTest
@testable import BeeUrEi

/// 协助端文案表（E5 第九批）：中文与历史一致、英文不串中文、合并朗读文案结构。
final class HelperStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        XCTAssertEqual(HelperStrings.matchRandom(.zh), "随机匹配一位需要帮助的人")
        XCTAssertEqual(HelperStrings.claimedByOther(.zh), "手慢了，这条求助已被其他志愿者接走。")
        XCTAssertEqual(HelperStrings.wantsToLink(owner: "小明", relation: "儿子", emergency: true, .zh),
                       "小明 想把你加为儿子（紧急联系人）")
        XCTAssertEqual(HelperStrings.requestSentTo("xiaoming", .zh), "已向 xiaoming 发送请求，待对方确认")
        XCTAssertEqual(HelperStrings.waitText(5, .zh), "刚刚")
        XCTAssertEqual(HelperStrings.waitText(45, .zh), "45 秒")
        XCTAssertEqual(HelperStrings.waitText(180, .zh), "3 分钟")
    }

    /// 协助端假安心自查：我是紧急联系人却关了通知 → 警告去开；有责任且通知开着/无责任 → nil（不打扰）。
    func testEmergencyContactPushWarning() {
        func hasCJK(_ s: String) -> Bool { s.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }
        // 是 3 人的紧急联系人 + 通知关 → 警告，含人数、"通知没开"、可行动"系统设置"。
        let warn = HelperStrings.emergencyContactPushWarning(emergencyFor: 3, notificationsOn: false, .zh)
        XCTAssertNotNil(warn)
        XCTAssertTrue(warn!.contains("3 位")); XCTAssertTrue(warn!.contains("通知没开")); XCTAssertTrue(warn!.contains("系统设置"))
        // 通知开着 → nil（有责任但可达，不打扰）。
        XCTAssertNil(HelperStrings.emergencyContactPushWarning(emergencyFor: 3, notificationsOn: true, .zh))
        // 不是任何人的紧急联系人 → nil（即便通知关也无此责任警告）。
        XCTAssertNil(HelperStrings.emergencyContactPushWarning(emergencyFor: 0, notificationsOn: false, .zh))
        // 英文：单复数 + 不串中文 + 含 "notifications are off"。
        let en1 = HelperStrings.emergencyContactPushWarning(emergencyFor: 1, notificationsOn: false, .en)!
        XCTAssertTrue(en1.contains("1 person")); XCTAssertFalse(hasCJK(en1)); XCTAssertTrue(en1.contains("notifications are off"))
        XCTAssertTrue(HelperStrings.emergencyContactPushWarning(emergencyFor: 2, notificationsOn: false, .en)!.contains("2 people"))
    }

    func testWaitTextLongWaitsReadInHours() {
        // ≥1h 按"H 小时 M 分钟"读（公开求助最长滞留 4h TTL，原只到分钟一档→"240 分钟"难读）；与 web formatWaited 同口径。
        XCTAssertEqual(HelperStrings.waitText(3599, .zh), "59 分钟")       // <1h 仍分钟
        XCTAssertEqual(HelperStrings.waitText(3600, .zh), "1 小时")         // 整点小时无分钟后缀
        XCTAssertEqual(HelperStrings.waitText(5400, .zh), "1 小时 30 分钟")
        XCTAssertEqual(HelperStrings.waitText(4 * 3600, .zh), "4 小时")     // 4h TTL 满：不再"240 分钟"
        XCTAssertEqual(HelperStrings.waitText(3600, .en), "1 h")
        XCTAssertEqual(HelperStrings.waitText(5400, .en), "1 h 30 min")
        XCTAssertEqual(HelperStrings.waitText(-5, .zh), "刚刚")             // 负值兜底为 0→"刚刚"
    }

    func testMatchedLabelComposition() {
        let zh = HelperStrings.matchedLabel(name: "小李", topic: "读标签", locality: "北京", languageName: "中文", .zh)
        XCTAssertEqual(zh, "求助者 小李。事项 读标签。地点 北京。语言 中文。")
        let en = HelperStrings.matchedLabel(name: "Li", topic: nil, locality: nil, languageName: nil, .en)
        XCTAssertEqual(en, "Requester Li. ")
    }

    func testEnglishHasNoChinese() {
        let samples = [
            HelperStrings.alwaysOnlineFooter(.en), HelperStrings.queueEmptyMessage(.en),
            HelperStrings.requireSameLanguageFooter(.en), HelperStrings.noRelationsYet(.en),
            HelperStrings.mergedExplain(.en), HelperStrings.claimedByOther(.en),
            HelperStrings.wantsToLink(owner: "Ming", relation: "son", emergency: false, .en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
        }
    }
}
