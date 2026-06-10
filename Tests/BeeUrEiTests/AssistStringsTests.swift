import XCTest
@testable import BeeUrEi

/// 求助屏文案表（E5 第五批）：中文与历史一致、英文不串中文、主题数量对齐。
final class AssistStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        XCTAssertEqual(AssistStrings.callVolunteerTitle(.zh), "向志愿者求助")
        XCTAssertEqual(AssistStrings.helpSent(.zh), "已发出求助，正在等待志愿者接入…")
        XCTAssertEqual(AssistStrings.noCallableFamily(.zh), "还没有可呼叫的亲友/协助者，请先添加并绑定，或改用「向志愿者求助」。")
        XCTAssertEqual(AssistStrings.callingListPrefix(anyOnline: true, .zh), "正在呼叫：")
        XCTAssertEqual(AssistStrings.callingListPrefix(anyOnline: false, .zh), "暂无在线，仍尝试呼叫：")
        XCTAssertEqual(AssistStrings.callOneFailed("妈妈", .zh), "呼叫 妈妈 未送达，请重试或改用电话联系。")
        XCTAssertEqual(AssistStrings.onlineCount(0, .zh), "暂无协助者/亲友在线")
        XCTAssertEqual(AssistStrings.onlineCount(3, .zh), "3 位协助者/亲友在线")
    }

    func testTopicsSameCountBothLanguages() {
        XCTAssertEqual(AssistStrings.topics(.zh).count, AssistStrings.topics(.en).count)
        XCTAssertFalse(AssistStrings.topics(.en).contains(where: { $0.isEmpty }))
    }

    func testEnglishHasNoChinese() {
        let samples = [
            AssistStrings.callVolunteerSubtitle(.en), AssistStrings.helpFailed(.en),
            AssistStrings.noFamilyMessage(.en), AssistStrings.topicMessage(.en),
            AssistStrings.waitingVolunteer(.en), AssistStrings.callMemberA11y("Mom", emergency: true, .en),
        ] + AssistStrings.topics(.en)
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
        }
    }
}
