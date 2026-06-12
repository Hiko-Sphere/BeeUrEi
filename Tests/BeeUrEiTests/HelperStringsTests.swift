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
