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

    func testCallErrorTextMapsActionableCodesLikeWeb() {
        // 跨端一致：与 web callErrorText 同集——这些"重试也没用/已结束"码须给专属文案，不落笼统 fallback，
        // 否则盲人会对着注定失败的操作反复重试（本次补齐此前 iOS 仅 feature_disabled/maintenance 的缺口）。
        let fb = "呼叫失败"
        for code in ["too_many_requests", "not_linked", "already_claimed_or_gone"] {
            let zh = AssistStrings.callErrorText(APIError.server(code), fallback: fb, .zh)
            XCTAssertNotEqual(zh, fb, "码 \(code) 应有专属中文文案，而非落 fallback")
            let en = AssistStrings.callErrorText(APIError.server(code), fallback: "call failed", .en)
            XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(en)")
        }
        XCTAssertEqual(AssistStrings.callErrorText(APIError.server("already_claimed_or_gone"), fallback: fb, .zh),
                       "这条求助已被其他人接手或已结束。")
        // 未知码 / 非 APIError.server：仍落 fallback（不误报）。
        XCTAssertEqual(AssistStrings.callErrorText(APIError.server("nope"), fallback: fb, .zh), fb)
        XCTAssertEqual(AssistStrings.callErrorText(NSError(domain: "x", code: 1), fallback: fb, .zh), fb)
    }

    func testOnlineSuffixBilingualAndDistinct() {
        // 在线待命后缀：双语、非空、英文不串中文，且与紧急/待确认后缀各不相同（同一 caption 里可能并列出现）。
        XCTAssertEqual(AssistStrings.onlineSuffix(.zh), " · 在线待命")
        XCTAssertEqual(AssistStrings.onlineSuffix(.en), " · online")
        XCTAssertNotEqual(AssistStrings.onlineSuffix(.zh), AssistStrings.emergencySuffix(.zh))
        XCTAssertNotEqual(AssistStrings.onlineSuffix(.zh), AssistStrings.pendingSuffix(.zh))
        XCTAssertFalse(AssistStrings.onlineSuffix(.en).contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    private func mkLink(emergency: Bool, status: String? = "accepted") -> FamilyLinkInfo {
        let st = status.map { ",\"status\":\"\($0)\"" } ?? ""
        let json = "{\"id\":\"l\",\"memberId\":\"m\",\"memberName\":\"X\",\"relation\":\"亲友\",\"isEmergency\":\(emergency)\(st)}"
        return try! JSONDecoder().decode(FamilyLinkInfo.self, from: Data(json.utf8))
    }

    func testHasUsableEmergencyContact() {
        // 已接受 ∧ 紧急 → 有可用紧急联系人（SOS/摔倒告警扇出只走这类）。
        XCTAssertTrue(FamilyLinkInfo.hasUsableEmergencyContact(in: [mkLink(emergency: true)]))
        // 已接受但**非紧急** → 无（非紧急联系人不进 SOS 扇出）。
        XCTAssertFalse(FamilyLinkInfo.hasUsableEmergencyContact(in: [mkLink(emergency: false)]))
        // 紧急但**未接受**(pending) → 无（服务端只对 accepted 扇出，pending 收不到）。
        XCTAssertFalse(FamilyLinkInfo.hasUsableEmergencyContact(in: [mkLink(emergency: true, status: "pending")]))
        XCTAssertFalse(FamilyLinkInfo.hasUsableEmergencyContact(in: [])) // 空 → 无
        // 混合中有一个已接受+紧急 → 有。
        XCTAssertTrue(FamilyLinkInfo.hasUsableEmergencyContact(in: [mkLink(emergency: false), mkLink(emergency: true, status: "pending"), mkLink(emergency: true)]))
    }

    func testNoEmergencyContactWarningBilingual() {
        XCTAssertTrue(AssistStrings.noEmergencyContactWarning(.zh).contains("紧急联系人"))
        XCTAssertTrue(AssistStrings.noEmergencyContactWarning(.zh).contains("无人可通知"))
        let en = AssistStrings.noEmergencyContactWarning(.en)
        XCTAssertTrue(en.lowercased().contains("no emergency contact") && en.lowercased().contains("no one"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testFamilyLinkInfoDecodesOnlinePresence() throws {
        // 服务端 viewLink 下发 online（对方此刻在线/待命）；iOS 须解码——此前缺此字段，盲人在亲友屏看不到谁接得通。
        let json = #"{"id":"l1","memberId":"m1","memberName":"妈妈","relation":"母亲","isEmergency":true,"status":"accepted","online":true}"#
        let link = try JSONDecoder().decode(FamilyLinkInfo.self, from: Data(json.utf8))
        XCTAssertEqual(link.online, true)
        XCTAssertEqual(link.memberName, "妈妈")
        // 缺 online 的旧/兼容负载 → nil（视图按离线处理，不崩、不误显在线）。
        let legacy = #"{"id":"l2","memberId":"m2","memberName":"Bob","relation":"friend","isEmergency":false}"#
        let l2 = try JSONDecoder().decode(FamilyLinkInfo.self, from: Data(legacy.utf8))
        XCTAssertNil(l2.online)
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
