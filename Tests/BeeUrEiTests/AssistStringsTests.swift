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
        XCTAssertNotEqual(AssistStrings.onlineSuffix(.zh), AssistStrings.emergencySuffix(.zh, isEmergency: true, amOwner: true))
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

    func testFamilyLinkInfoDecodesAmOwner() throws {
        // 服务端 viewLink 下发 amOwner（我是否为链 owner）；iOS 须解码——此前缺此字段=死字段，
        // 导致紧急联系人徽标无法区分方向（谁遇险时叫谁）。
        let owned = #"{"id":"l1","memberId":"m1","memberName":"妈妈","relation":"母亲","isEmergency":true,"status":"accepted","amOwner":true}"#
        XCTAssertEqual(try JSONDecoder().decode(FamilyLinkInfo.self, from: Data(owned.utf8)).amOwner, true)
        let notOwned = #"{"id":"l2","memberId":"m2","memberName":"小明","relation":"邻居","isEmergency":true,"status":"accepted","amOwner":false}"#
        XCTAssertEqual(try JSONDecoder().decode(FamilyLinkInfo.self, from: Data(notOwned.utf8)).amOwner, false)
        // 缺 amOwner 的旧负载 → nil（徽标回退到"紧急联系人"通用向，不做方向断言、不崩）。
        let legacy = #"{"id":"l3","memberId":"m3","memberName":"Bob","relation":"friend","isEmergency":true}"#
        XCTAssertNil(try JSONDecoder().decode(FamilyLinkInfo.self, from: Data(legacy.utf8)).amOwner)
    }

    func testEmergencySuffixDirection() {
        // 安全责任方向：amOwner==false（对方是 owner）=我是 TA 的紧急联系人（TA 遇险叫我）；否则=对方是我的。
        // 此前两向都显示"紧急联系人"，让人误读方向。isEmergency=false → 空串。
        XCTAssertEqual(AssistStrings.emergencySuffix(.zh, isEmergency: false, amOwner: true), "")
        XCTAssertEqual(AssistStrings.emergencySuffix(.zh, isEmergency: false, amOwner: false), "")
        // 我是 owner → 对方是我的紧急联系人（通用向）
        XCTAssertEqual(AssistStrings.emergencySuffix(.zh, isEmergency: true, amOwner: true), " · 紧急联系人")
        XCTAssertEqual(AssistStrings.emergencySuffix(.zh, isEmergency: true, amOwner: nil), " · 紧急联系人") // 缺字段回退通用向
        // 对方是 owner → 我是 TA 的紧急联系人（我对 TA 负责），文案须区别于通用向
        let mine = AssistStrings.emergencySuffix(.zh, isEmergency: true, amOwner: false)
        XCTAssertTrue(mine.contains("你是") && mine.contains("紧急联系人"), "反向须点明我是对方的：\(mine)")
        XCTAssertNotEqual(mine, AssistStrings.emergencySuffix(.zh, isEmergency: true, amOwner: true))
        // 英文双向：非空、不串中文、两向不同
        let enTheirs = AssistStrings.emergencySuffix(.en, isEmergency: true, amOwner: false)
        let enMine = AssistStrings.emergencySuffix(.en, isEmergency: true, amOwner: true)
        XCTAssertNotEqual(enTheirs, enMine)
        XCTAssertFalse(enTheirs.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        // HelperStrings 同口径（两个角色 UI 都用同款方向逻辑）
        XCTAssertEqual(HelperStrings.emergencySuffix(.zh, isEmergency: true, amOwner: true), " · 紧急联系人")
        XCTAssertTrue(HelperStrings.emergencySuffix(.zh, isEmergency: true, amOwner: false).contains("你是"))
    }

    func testContactAddedConfirmsRelationAndEmergency() {
        // 加联系人成功确认：点明名字+关系；紧急联系人**必须**额外确认（安全攸关，静默成功会让盲人不确定设上没）。
        let emerg = AssistStrings.contactAdded(name: "小红", relation: "女儿", isEmergency: true, .zh)
        XCTAssertTrue(emerg.contains("小红") && emerg.contains("女儿"))
        XCTAssertTrue(emerg.contains("紧急联系人"), "设紧急联系人须在确认里点明：\(emerg)")
        // 非紧急：不谎称设了紧急联系人。
        let plain = AssistStrings.contactAdded(name: "小红", relation: "女儿", isEmergency: false, .zh)
        XCTAssertFalse(plain.contains("紧急联系人"))
        XCTAssertNotEqual(emerg, plain)
        // 关系留空：仍给出通顺确认（"添加为联系人"），不落半句。
        XCTAssertTrue(AssistStrings.contactAdded(name: "Bob", relation: "  ", isEmergency: false, .zh).contains("联系人"))
        // 英文不串中文，紧急/非紧急分明。
        let en = AssistStrings.contactAdded(name: "Amy", relation: "daughter", isEmergency: true, .en)
        XCTAssertTrue(en.lowercased().contains("emergency") && en.contains("Amy"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(en)")
    }

    func testContactRemovedWarnsWhenLastEmergencyContactGone() {
        // 删联系人成功确认：点明删了谁；删的是紧急联系人且删后已无可用紧急联系人时，**追加安全提醒**（否则遇险无人可通知）。
        let base = AssistStrings.contactRemoved(name: "小红", noEmergencyLeft: false, .zh)
        XCTAssertTrue(base.contains("小红") && base.contains("已删除"))
        XCTAssertFalse(base.contains("紧急联系人"), "非最后紧急联系人不该追加提醒：\(base)")
        let warn = AssistStrings.contactRemoved(name: "小红", noEmergencyLeft: true, .zh)
        XCTAssertTrue(warn.contains("没有紧急联系人"), "删掉最后一位紧急联系人须提醒：\(warn)")
        XCTAssertNotEqual(base, warn)
        // 英文两态不串中文。
        for s in [AssistStrings.contactRemoved(name: "Amy", noEmergencyLeft: false, .en),
                  AssistStrings.contactRemoved(name: "Amy", noEmergencyLeft: true, .en)] {
            XCTAssertTrue(s.contains("Amy"))
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
        XCTAssertTrue(AssistStrings.contactRemoved(name: "Amy", noEmergencyLeft: true, .en).lowercased().contains("emergency"))
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

    func testSafetyTimerDecodesServerShape() throws {
        // 服务端 /api/safety/checkin 形状（id/note/status/startedAt/dueAt/remainingSec）。iOS 须解码以显剩余+态。
        let json = #"{"id":"t1","note":"去菜市场","status":"active","startedAt":1700000000000,"dueAt":1700003600000,"remainingSec":1800}"#
        let t = try JSONDecoder().decode(SafetyTimer.self, from: Data(json.utf8))
        XCTAssertEqual(t.status, "active"); XCTAssertTrue(t.isActive)
        XCTAssertEqual(t.remainingSec, 1800); XCTAssertEqual(t.note, "去菜市场")
        // 无 note（可选）+ 非 active → nil / isActive=false，不崩。
        let t2 = try JSONDecoder().decode(SafetyTimer.self, from: Data(#"{"id":"t2","status":"completed","startedAt":1,"dueAt":2,"remainingSec":0}"#.utf8))
        XCTAssertNil(t2.note); XCTAssertFalse(t2.isActive)
    }

    func testSafetyRemainingTextAndDurationName() {
        XCTAssertEqual(SafetyTimerFormat.remainingText(sec: 1800, .zh), "还有约 30 分钟")
        XCTAssertEqual(SafetyTimerFormat.remainingText(sec: 5400, .zh), "还有约 1 小时 30 分钟")
        XCTAssertTrue(SafetyTimerFormat.remainingText(sec: 3660, .en).contains("1h"))
        // 整点小时不拖"0 分钟"（"2 小时"而非"2 小时 0 分钟"；与 durationName / web remainingText 同口径，24h 窗口每小时经过整点）。
        XCTAssertEqual(SafetyTimerFormat.remainingText(sec: 7200, .zh), "还有约 2 小时")
        XCTAssertEqual(SafetyTimerFormat.remainingText(sec: 3600, .zh), "还有约 1 小时")
        XCTAssertEqual(SafetyTimerFormat.remainingText(sec: 7200, .en), "About 2h left")
        XCTAssertEqual(SafetyTimerFormat.remainingText(sec: 24 * 3600, .zh), "还有约 24 小时") // 最长报到窗口
        XCTAssertEqual(SafetyTimerFormat.remainingText(sec: -50, .zh), "还有约 0 分钟") // 负值夹到 0，不崩
        XCTAssertEqual(SafetyTimerFormat.durationName(30, .zh), "30 分钟")
        XCTAssertEqual(SafetyTimerFormat.durationName(120, .zh), "2 小时")
        XCTAssertEqual(SafetyTimerFormat.durationName(120, .en), "2h")
    }

    func testSafetyStringsBilingualAndValuePromise() {
        for s in [SafetyStrings.navTitle(.en), SafetyStrings.explain(.en), SafetyStrings.start(.en), SafetyStrings.imSafe(.en),
                  SafetyStrings.safeConfirm(.en), SafetyStrings.extend1h(.en), SafetyStrings.canceled(.en), SafetyStrings.failed(.en), SafetyStrings.entry(.en)] {
            XCTAssertFalse(s.isEmpty)
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
        // 说明须点明"自动告警亲友/紧急联系人"（用户据此理解 dead-man's switch 的价值，别被漏改成泛化措辞）。
        XCTAssertTrue(SafetyStrings.explain(.zh).contains("紧急联系人"))
        XCTAssertTrue(SafetyStrings.explain(.en).lowercased().contains("emergency contact"))
    }

    /// 开始报到播报：无任何联系人时**防假安心**——明确"无人会被通知"，别让盲人 arming 一个静默失效的 dead-man's switch。
    func testCheckinStartedNoticeWarnsWhenNoContact() {
        func hasCJK(_ s: String) -> Bool { s.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }
        // 有联系人 → 与普通"已开始"确认一致，绝不含"无人"。
        XCTAssertEqual(SafetyStrings.startedNotice(hasAnyContact: true, .zh), SafetyStrings.started(.zh))
        XCTAssertFalse(SafetyStrings.startedNotice(hasAnyContact: true, .zh).contains("无人"))
        // 无任何 accepted 联系人 → 防假安心警告：明确"无人会被通知"+可行动"添加联系人"，且不同于普通确认。
        let warn = SafetyStrings.startedNotice(hasAnyContact: false, .zh)
        XCTAssertTrue(warn.contains("无人会被通知"))
        XCTAssertTrue(warn.contains("添加联系人"))
        XCTAssertNotEqual(warn, SafetyStrings.started(.zh))
        // 英文不串中文，含 "no one" + "contact"。
        let en = SafetyStrings.startedNotice(hasAnyContact: false, .en)
        XCTAssertFalse(hasCJK(en))
        XCTAssertTrue(en.lowercased().contains("no one"))
        XCTAssertTrue(en.lowercased().contains("contact"))
    }

    /// 每日报到保存播报：开启但无任何联系人时**防假安心**（与一次性报到同族 bug、与网页端同口径）。
    func testDailyCheckinSavedNoticeWarnsWhenEnabledWithoutContact() {
        func hasCJK(_ s: String) -> Bool { s.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }
        // 关闭 → "已关闭"，与联系人有无无关、绝不含"无人"（关了本就不会告警）。
        XCTAssertTrue(SafetyStrings.dailySavedNotice(enabled: false, hasAnyContact: false, .zh).contains("已关闭"))
        XCTAssertFalse(SafetyStrings.dailySavedNotice(enabled: false, hasAnyContact: false, .zh).contains("无人"))
        // 开启 + 有联系人 → 正常确认（自动开始），不含"无人"。
        let ok = SafetyStrings.dailySavedNotice(enabled: true, hasAnyContact: true, .zh)
        XCTAssertTrue(ok.contains("已开启")); XCTAssertFalse(ok.contains("无人"))
        // 开启 + 无任何 accepted 联系人 → 防假安心警告：明确"无人会被通知"+可行动"添加联系人"。
        let warn = SafetyStrings.dailySavedNotice(enabled: true, hasAnyContact: false, .zh)
        XCTAssertTrue(warn.contains("无人会被通知"))
        XCTAssertTrue(warn.contains("添加联系人"))
        // 英文分支不串中文，无联系人时含 "no one"。
        let en = SafetyStrings.dailySavedNotice(enabled: true, hasAnyContact: false, .en)
        XCTAssertFalse(hasCJK(en)); XCTAssertTrue(en.lowercased().contains("no one"))
    }
}
