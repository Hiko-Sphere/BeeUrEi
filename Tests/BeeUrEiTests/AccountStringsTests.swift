import XCTest
@testable import BeeUrEi

/// 账号链路文案表（E5 第八批）：中文与历史一致、英文不串中文、角色名映射。
final class AccountStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        XCTAssertEqual(AccountStrings.tagline(.zh), "为视障人士而生的避障与远程协助")
        XCTAssertEqual(AccountStrings.codeSent(.zh), "如果该账号绑定了邮箱，验证码已发送。请查收后填写下方验证码。")
        XCTAssertEqual(AccountStrings.passwordChanged(.zh), "密码已修改，请用新密码重新登录。")
        XCTAssertEqual(AccountStrings.deleteConfirmMessage(.zh), "将永久删除你的账号、亲友绑定与登录信息，且不可恢复。")
        XCTAssertEqual(AccountStrings.nicknameUpdated("小蜂", .zh), "昵称已更新为 小蜂")
    }

    func testRoleNames() {
        XCTAssertEqual(AccountStrings.roleName("blind", .zh), "求助者（视障）")
        XCTAssertEqual(AccountStrings.roleName("helper", .en), "Helper / family")
        XCTAssertEqual(AccountStrings.roleName("admin", .zh), "admin") // 未知角色原样回显
    }

    func testQuietHoursTimeRoundTripsMinuteOfDay() {
        // DatePicker 绑 Date、服务端存分钟-of-day：两向转换必须无损往返，否则用户设 22:30、存下来变成别的时刻。
        // 用无 DST 的 UTC 日历 + 固定参考日，round-trip 对任意分钟稳定成立（生产用 Calendar.current；中国无 DST）。
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        let ref = Date(timeIntervalSince1970: 1_700_000_000)
        for m in [0, 1, 59, 60, 7 * 60, 22 * 60 + 30, 1439] {
            let d = QuietHoursTime.date(fromMinuteOfDay: m, calendar: cal, reference: ref)
            XCTAssertEqual(QuietHoursTime.minuteOfDay(from: d, calendar: cal), m, "分钟 \(m) 往返丢失")
        }
        // 具体时分正确（22:30）。
        let d = QuietHoursTime.date(fromMinuteOfDay: 22 * 60 + 30, calendar: cal, reference: ref)
        let c = cal.dateComponents([.hour, .minute], from: d)
        XCTAssertEqual(c.hour, 22); XCTAssertEqual(c.minute, 30)
        // 越界脏值夹取到 [0,1439]（不炸 DatePicker）。
        XCTAssertEqual(QuietHoursTime.minuteOfDay(from: QuietHoursTime.date(fromMinuteOfDay: 5000, calendar: cal, reference: ref), calendar: cal), 1439)
        XCTAssertEqual(QuietHoursTime.minuteOfDay(from: QuietHoursTime.date(fromMinuteOfDay: -10, calendar: cal, reference: ref), calendar: cal), 0)
    }

    func testQuietHoursDecodesServerShape() throws {
        // 服务端 /api/notifications/quiet-hours 形状（enabled + 分钟-of-day + IANA tz），iOS 须解码对齐 web/server。
        let json = #"{"enabled":true,"startMinute":1320,"endMinute":420,"tz":"Asia/Shanghai"}"#
        let q = try JSONDecoder().decode(APIClient.QuietHours.self, from: Data(json.utf8))
        XCTAssertEqual(q.enabled, true)
        XCTAssertEqual(q.startMinute, 1320) // 22:00
        XCTAssertEqual(q.endMinute, 420)    // 07:00
        XCTAssertEqual(q.tz, "Asia/Shanghai")
    }

    func testContactMedicalDecodesServerShape() throws {
        // 服务端 /api/family/:id/medical 形状（自由文本 + updatedAt）。iOS 施救者据此看遇险者血型/过敏/用药。
        let json = #"{"medicalInfo":"O型血，青霉素过敏，服用华法林","updatedAt":1700000000000}"#
        let m = try JSONDecoder().decode(APIClient.ContactMedical.self, from: Data(json.utf8))
        XCTAssertEqual(m.medicalInfo, "O型血，青霉素过敏，服用华法林")
        XCTAssertEqual(m.updatedAt, 1_700_000_000_000)
        // updatedAt 可空（旧数据/未记时间戳）→ nil，不崩。
        XCTAssertNil(try JSONDecoder().decode(APIClient.ContactMedical.self, from: Data(#"{"medicalInfo":"糖尿病","updatedAt":null}"#.utf8)).updatedAt)
    }

    func testEmergencyMedicalStringsBilingual() {
        for s in [EmergencyMedicalStrings.viewButton(.en), EmergencyMedicalStrings.viewButtonEmphasized(.en),
                  EmergencyMedicalStrings.heading(.en), EmergencyMedicalStrings.noneProvided(.en),
                  EmergencyMedicalStrings.denied(.en), EmergencyMedicalStrings.updated("2h ago", .en), EmergencyMedicalStrings.failed(.en)] {
            XCTAssertFalse(s.isEmpty)
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
        // denied 须点明授权边界"仅紧急联系人"（GDPR Art.9 健康数据，别被漏改成泛化措辞）。
        XCTAssertTrue(EmergencyMedicalStrings.denied(.zh).contains("紧急联系人"))
        XCTAssertTrue(EmergencyMedicalStrings.denied(.en).lowercased().contains("emergency contact"))
    }

    func testMedicalInfoFillStringsBilingualAndPrivacyPromise() {
        for s in [MedicalInfoStrings.navTitle(.en), MedicalInfoStrings.explain(.en), MedicalInfoStrings.placeholder(.en),
                  MedicalInfoStrings.save(.en), MedicalInfoStrings.saved(.en), MedicalInfoStrings.cleared(.en), MedicalInfoStrings.saveFailed(.en)] {
            XCTAssertFalse(s.isEmpty)
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
        // 说明须点明"加密"+"仅紧急联系人可见"（隐私承诺，用户据此才敢录入健康 PII，别被漏改）。
        XCTAssertTrue(MedicalInfoStrings.explain(.zh).contains("加密"))
        XCTAssertTrue(MedicalInfoStrings.explain(.zh).contains("紧急联系人"))
        XCTAssertTrue(MedicalInfoStrings.explain(.en).lowercased().contains("encrypted"))
        XCTAssertTrue(MedicalInfoStrings.explain(.en).lowercased().contains("emergency contact"))
        XCTAssertEqual(MedicalInfoStrings.charCount(123, .zh), "123/4000") // 上限与服务端 putSchema.max(4000) 对齐
        // 上次更新（本人提醒别让医疗信息过期）：双语、含传入的时刻串、英文不串中文。
        XCTAssertEqual(MedicalInfoStrings.lastUpdated("1月3日", .zh), "上次更新：1月3日")
        let lu = MedicalInfoStrings.lastUpdated("Jan 3", .en)
        XCTAssertTrue(lu.contains("Jan 3") && lu.lowercased().contains("last updated"))
        XCTAssertFalse(lu.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testQuietHoursStringsBilingual() {
        for s in [QuietHoursStrings.navTitle(.en), QuietHoursStrings.enableLabel(.en), QuietHoursStrings.explain(.en),
                  QuietHoursStrings.overnightHint(.en), QuietHoursStrings.saveFailed(.en)] {
            XCTAssertFalse(s.isEmpty)
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
        // 说明须点明紧急/来电不受影响（安全承诺，别被漏改）。
        XCTAssertTrue(QuietHoursStrings.explain(.zh).contains("紧急"))
        XCTAssertTrue(QuietHoursStrings.explain(.en).lowercased().contains("emergency"))
    }

    func testOpenChatHintBilingual() {
        XCTAssertEqual(AccountStrings.openChatHint(.zh), "轻点打开聊天")
        XCTAssertEqual(AccountStrings.openChatHint(.en), "Tap to open chat")
        XCTAssertFalse(AccountStrings.openChatHint(.en).contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testCallRecordDecodesPeerIdForTapThrough() throws {
        // 服务端 /api/calls 下发 peerId（对端 userId），iOS 据此让通话记录整行点进聊天——此前缺解码，
        // 通话记录是死列表（未接来电无法一键回访）。对端仍在→有 peerId；已注销→字段缺失/为 null→nil→不可点。
        let json = #"{"id":"r1","callId":"c1","direction":"incoming","status":"missed","peerId":"u9","peerName":"妈妈","createdAt":1700000000000}"#
        let rec = try JSONDecoder().decode(CallRecordInfo.self, from: Data(json.utf8))
        XCTAssertEqual(rec.peerId, "u9")
        XCTAssertTrue(rec.isMissed)
        // 已注销用户：服务端 peerId 为 null / 或旧负载缺该键 → nil（视图渲染成不可点行，无死链）。
        let gone = #"{"id":"r2","callId":"c2","direction":"outgoing","status":"answered","peerId":null,"peerName":"已注销用户","createdAt":1700000000000}"#
        XCTAssertNil(try JSONDecoder().decode(CallRecordInfo.self, from: Data(gone.utf8)).peerId)
        let legacy = #"{"id":"r3","callId":"c3","direction":"outgoing","status":"answered","peerName":"Bob","createdAt":1700000000000}"#
        XCTAssertNil(try JSONDecoder().decode(CallRecordInfo.self, from: Data(legacy.utf8)).peerId)
    }

    func testSessionSignedInAbsoluteAndBilingual() {
        // 登录设备「首次登录时刻」死字段修复（服务端一直下发 createdAt、iOS 解了却从未展示；web 已展示）：
        // createdAt 缺省 → nil（不展示空行/不误报）；有值 → 绝对时刻串（安全审查线索"这台设备我几时登录的"）。
        XCTAssertNil(SessionStrings.signedIn(nil, .zh))
        let ms = 1_700_000_000_000.0
        let zh = SessionStrings.signedIn(ms, .zh)
        XCTAssertNotNil(zh)
        XCTAssertTrue(zh!.hasPrefix("首次登录："), "中文须前缀『首次登录：』：\(zh ?? "nil")")
        XCTAssertTrue(zh!.count > "首次登录：".count, "须含格式化后的时刻、非空前缀：\(zh ?? "nil")")
        let en = SessionStrings.signedIn(ms, .en)
        XCTAssertNotNil(en)
        XCTAssertTrue(en!.hasPrefix("Signed in "), "英文须前缀『Signed in』：\(en ?? "nil")")
        XCTAssertFalse(en!.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(en ?? "nil")")
    }

    func testEnglishHasNoChinese() {
        let samples = [
            AccountStrings.loginExplain(.en), AccountStrings.forgotFooter(.en),
            AccountStrings.codeSent(.en), AccountStrings.nicknameMessage(.en),
            AccountStrings.deleteConfirmMessage(.en), AccountStrings.noEmailYet(.en),
            AccountStrings.passwordChangeFailed(.en), AccountStrings.emailFooter(.en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}

/// 服务端错误码→人话映射（跨端对齐审计回归，主题式组织；置于本文件避免新增测试文件需重生成 Xcode 工程）。
/// 不变量：这些文案会被读屏/端侧 TTS 朗读给盲人——任何路径都不得把原始 snake_case 码返回给用户。
final class ServerErrorMappingTests: XCTestCase {

    func testAccountErrorTextKnownCodes() {
        XCTAssertEqual(AccountStrings.accountErrorText("content_blocked", .zh), "该内容不被允许，请换一个")
        XCTAssertFalse(AccountStrings.accountErrorText("content_blocked", .en).contains("content_blocked"))
    }

    func testServerErrorTextKnownCodes() {
        XCTAssertEqual(AccountStrings.serverErrorText("registration_disabled", .zh), "注册暂时关闭")
        XCTAssertEqual(AccountStrings.serverErrorText("content_blocked", .zh), "该内容不被允许，请换一个")
        // two_factor_link_required 须指引"先密码+验证码登录、再绑 Apple"，不能只报失败
        XCTAssertTrue(AccountStrings.serverErrorText("two_factor_link_required", .zh).contains("两步验证"))
        XCTAssertTrue(AccountStrings.serverErrorText("two_factor_link_required", .en).lowercased().contains("2fa"))
    }

    func testUnknownCodeNeverEchoedRaw() {
        // 曾经 default: return code——读屏把英文码原样念给盲人（审计 CROSS-CLIENT-ERR）。锁死不回退。
        let weird = "some_unknown_future_code"
        for l in [Language.zh, .en] {
            XCTAssertFalse(AccountStrings.accountErrorText(weird, l).contains(weird))
            XCTAssertFalse(AccountStrings.serverErrorText(weird, l).contains(weird))
        }
    }

    func testCreateGroupErrorTextDistinguishesCauses() {
        XCTAssertEqual(ChatStrings.createGroupErrorText(APIError.server("content_blocked"), .zh),
                       "群名含被禁止的内容，请换一个")
        XCTAssertTrue(ChatStrings.createGroupErrorText(APIError.server("feature_disabled"), .zh).contains("关闭"))
        XCTAssertTrue(ChatStrings.createGroupErrorText(APIError.server("maintenance"), .en).lowercased().contains("maintenance"))
        XCTAssertTrue(ChatStrings.createGroupErrorText(APIError.server("not_linked"), .zh).contains("联系人"))
        // 未知码/非服务端错误回退到通用建群失败文案（不外泄原始码）
        XCTAssertEqual(ChatStrings.createGroupErrorText(APIError.server("whatever_else"), .zh),
                       ChatStrings.createGroupFailed(.zh))
        XCTAssertEqual(ChatStrings.createGroupErrorText(APIError.network, .en), ChatStrings.createGroupFailed(.en))
    }

    func testRecordingDeletedConfirmationDistinctAndBilingual() {
        // 删录音成功语音确认：盲人看不到那行从列表消失，须听到"已删除"；与失败文案明确不同（不能把成功念成像失败）。
        XCTAssertTrue(RecordingStrings.deleted(.zh).contains("删除"))
        XCTAssertNotEqual(RecordingStrings.deleted(.zh), RecordingStrings.deleteFailed(.zh))
        let en = RecordingStrings.deleted(.en)
        XCTAssertFalse(en.isEmpty)
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(en)")
    }
}
