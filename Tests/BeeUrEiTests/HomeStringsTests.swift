import XCTest
@testable import BeeUrEi

/// 主屏文案表（E5 第四批）：中文与历史一致、英文不串中文。
final class HomeStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        XCTAssertEqual(HomeStrings.helpTitle(.zh), "求助")
        XCTAssertEqual(HomeStrings.trafficGreen(.zh), "绿灯 · 可通行")
        XCTAssertEqual(HomeStrings.proximityMeters(1.5, .zh), "正前方约 1.5 米")
        XCTAssertEqual(HomeStrings.proximityClear(.zh), "正前方通畅")
        XCTAssertEqual(HomeStrings.permAnnounce(.zh), "相机权限被关闭，避障已停止。请到设置开启相机权限，或呼叫帮手。")
    }

    func testEnglishHasNoChinese() {
        let samples = [
            HomeStrings.helpSubtitle(.en), HomeStrings.hintAround(.en), HomeStrings.trafficYellow(.en),
            HomeStrings.proximityMeters(2.0, .en), HomeStrings.permBody(.en),
            HomeStrings.unsupportedAnnounce("No LiDAR.", .en), HomeStrings.noLiDARMessage(.en),
            HomeStrings.batterySpeak(percent: 80, charging: false, .en), HomeStrings.timeSpeak("3:25 PM", .en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }

    func testLowBatterySpeakConveysStakes() {
        // 必须点明"手机没电=同时失去导盲/导航/求助"（盲人看不到电量图标，不知严重性）。
        let low = HomeStrings.lowBatterySpeak(percent: 20, critical: false, .zh)
        XCTAssertTrue(low.contains("百分之20"))
        XCTAssertTrue(low.contains("导盲") && low.contains("求助"))
        let crit = HomeStrings.lowBatterySpeak(percent: 9, critical: true, .zh)
        XCTAssertTrue(crit.contains("立即") || crit.contains("即将关机")) // 紧急档措辞更急
        let en = HomeStrings.lowBatterySpeak(percent: 20, critical: false, .en)
        XCTAssertTrue(en.lowercased().contains("obstacle") && en.lowercased().contains("sos"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        // 越界百分比夹取，不崩不越 0–100。
        XCTAssertTrue(HomeStrings.lowBatterySpeak(percent: 150, critical: false, .zh).contains("百分之100"))
    }

    func testResolveVoiceRecipientAcrossContactsAndGroups() {
        let contacts = [(id: "u1", name: "妈妈"), (id: "u2", name: "小明")]
        let groups = [(id: "g1", name: "家人群"), (id: "g2", name: "同事群")]
        // 联系人唯一命中。
        XCTAssertEqual(HomeStrings.resolveVoiceRecipient(name: "妈妈", contacts: contacts, groups: groups),
                       HomeStrings.VoiceRecipient(id: "u1", name: "妈妈", isGroup: false))
        // 群唯一命中（能读群就该能发群）。
        XCTAssertEqual(HomeStrings.resolveVoiceRecipient(name: "家人群", contacts: contacts, groups: groups),
                       HomeStrings.VoiceRecipient(id: "g1", name: "家人群", isGroup: true))
        // 子串命中群。
        XCTAssertEqual(HomeStrings.resolveVoiceRecipient(name: "同事", contacts: contacts, groups: groups)?.id, "g2")
        // 精确整名优先：说"妈妈"即便有"妈妈的朋友"也直取"妈妈"（否则子串双命中→歧义）。
        let withOverlap = contacts + [(id: "u3", name: "妈妈的朋友")]
        XCTAssertEqual(HomeStrings.resolveVoiceRecipient(name: "妈妈", contacts: withOverlap, groups: [])?.id, "u1")
        // 歧义（同时子串命中一个联系人和一个群，均非精确）→ nil，交 UI 让用户选。
        XCTAssertNil(HomeStrings.resolveVoiceRecipient(name: "群", contacts: [(id: "x", name: "群主")], groups: groups))
        // 无匹配 / 空名 → nil。
        XCTAssertNil(HomeStrings.resolveVoiceRecipient(name: "查无此人", contacts: contacts, groups: groups))
        XCTAssertNil(HomeStrings.resolveVoiceRecipient(name: "  ", contacts: contacts, groups: groups))
    }

    func testUnreadReadout() {
        typealias C = HomeStrings.UnreadConversation
        // 无未读 → 明确告知，不静默。
        XCTAssertEqual(HomeStrings.unreadReadout([], .zh), "没有未读消息。")
        XCTAssertEqual(HomeStrings.unreadReadout([C(name: "妈妈", kind: "text", text: "到了吗", unread: 0)], .zh), "没有未读消息。")
        // 文本原样读；非文本报类型；多条附计数；已读会话不计入；群聊点名"群「X」"。
        let r = HomeStrings.unreadReadout([
            C(name: "妈妈", kind: "text", text: "到家了吗", unread: 1),
            C(name: "小明", kind: "audio", text: "data:audio/m4a;base64,AAAA", unread: 3),
            C(name: "家人群", kind: "text", text: "晚上吃饭", unread: 2, isGroup: true),
            C(name: "已读的人", kind: "text", text: "旧消息", unread: 0),
        ], .zh)
        XCTAssertTrue(r.contains("你有 3 个会话有未读消息")) // 单聊+群聊都计入
        XCTAssertTrue(r.contains("妈妈：到家了吗"))
        XCTAssertTrue(r.contains("小明：语音消息（等 3 条）"))
        XCTAssertTrue(r.contains("群「家人群」：晚上吃饭（等 2 条）")) // 群聊点名"群"
        XCTAssertFalse(r.contains("已读的人")) // unread=0 不读
        // 超过 cap 提示"等"；英文不串中文。
        let many = (1...7).map { C(name: "P\($0)", kind: "text", text: "hi", unread: 1) }
        XCTAssertTrue(HomeStrings.unreadReadout(many, cap: 5, .zh).contains("等"))
        let en = HomeStrings.unreadReadout([C(name: "Mom", kind: "image", text: "data:image/png;base64,AA", unread: 1)], .en)
        XCTAssertTrue(en.contains("Mom: a photo"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
        // Apple 地图链接文本按位置读（与列表预览一致）。
        XCTAssertTrue(HomeStrings.unreadReadout([C(name: "爸", kind: "text", text: "https://maps.apple.com/?ll=39.9,116.4", unread: 1)], .zh).contains("一个位置"))
    }

    func testVoiceCommandsHelpAdvertisesCallByName() {
        // 语音能力必须能被语音发现：自述里要提"给某人打电话"，否则加了 callContact 盲人也无从得知。
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.zh).contains("给某人打电话"))
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.en).lowercased().contains("call a family member"))
        // 发消息 + 发位置 + 读消息能力都在（别改串了），且英文自述不混中文。
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.zh).contains("给某人发消息"))
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.zh).contains("把位置发给某人"))
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.en).lowercased().contains("share my location"))
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.zh).contains("读一下消息"))
        XCTAssertTrue(HomeStrings.voiceCommandsHelp(.en).lowercased().contains("read my messages"))
        XCTAssertFalse(HomeStrings.voiceCommandsHelp(.en).contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testVoiceHelpAdvertisesIdentifyCommandsAndTheyRoundTripParse() {
        // 盲人只能靠这段自述发现语音能力：识别纸币/扫码/识别公交/描述人/光线/前方/读整页此前**能用却没被念出来**＝隐藏功能
        // （识别纸币是旗舰能力，盲人却无从得知）。不变量：凡自述里"念给盲人听"的具体短语，说出来必须真能解析到对应命令
        // ——否则自述在骗人（听到→照说→没反应）。故对每条同时断言：① 出现在中英自述里；② 解析回目标命令（防子串劫持/漏接线）。
        let zh = HomeStrings.voiceCommandsHelp(.zh)
        let en = HomeStrings.voiceCommandsHelp(.en).lowercased()
        let cases: [(zh: String, en: String, cmd: VoiceCommand)] = [
            ("认一下钱", "identify money", .banknote),
            ("扫个码", "scan a code", .scanCode),
            ("这是几路车", "which bus is this", .readBus),
            ("有没有人", "who's there", .describePeople),
            ("光线怎么样", "how bright is it", .readLight),
            ("前方有什么", "what's ahead", .ahead),
            ("读整页", "read the whole page", .readFullPage),
        ]
        for c in cases {
            XCTAssertTrue(zh.contains(c.zh), "中文自述缺『\(c.zh)』——盲人无从发现该能力")
            XCTAssertTrue(en.contains(c.en), "英文自述缺『\(c.en)』")
            // 念出来能真用：中英短语都要解析回目标命令（不是被前面的命令抢走、也不是没接线）。
            XCTAssertEqual(VoiceCommandParser.parse(c.zh), c.cmd, "自述里的『\(c.zh)』解析不到 \(c.cmd)")
            XCTAssertEqual(VoiceCommandParser.parse(c.en), c.cmd, "self-help phrase『\(c.en)』did not parse to \(c.cmd)")
        }
    }

    func testFallCancelHintTeachesMagicTapUnderVoiceOver() {
        // VoiceOver 开：教 Magic Tap（双指双击全屏任意处）——摔倒/撞击后手机常够不到，"找我没事按钮"极不可靠。
        let voZh = HomeStrings.fallCancelHint(voiceOver: true, .zh)
        XCTAssertTrue(voZh.contains("双指") && voZh.contains("双击"), "VoiceOver 中文提示应教双指双击：\(voZh)")
        XCTAssertFalse(voZh.contains("按钮"), "VoiceOver 提示不该再叫用户找按钮：\(voZh)")
        XCTAssertTrue(HomeStrings.fallCancelHint(voiceOver: true, .en).lowercased().contains("two-finger"))
        // VoiceOver 关（低视力/明眼）：仍指向「我没事」大按钮。
        XCTAssertTrue(HomeStrings.fallCancelHint(voiceOver: false, .zh).contains("我没事"))
        XCTAssertTrue(HomeStrings.fallCancelHint(voiceOver: false, .en).contains("I'm OK"))
        // 三条倒计时播报都按 voiceOver 带上对应提示（完整版为"双指在屏幕上双击"，故分别查两个词元）。
        let spoken = HomeStrings.fallAlertSpeak(kind: "fall", voiceOver: true, .zh)
        XCTAssertTrue(spoken.contains("双指") && spoken.contains("双击"), "摔倒播报应含双指双击提示：\(spoken)")
        XCTAssertTrue(HomeStrings.fallAlertSpeak(kind: "crash", voiceOver: false, .zh).contains("按钮"))
        XCTAssertTrue(HomeStrings.manualSosSpeak(voiceOver: true, .en).lowercased().contains("two-finger"))
        XCTAssertTrue(HomeStrings.fallAlertReminder(15, voiceOver: true, .zh).contains("双指双击屏幕可取消"))
        // 英文变体不串中文。
        for s in [HomeStrings.fallAlertSpeak(kind: "fall", voiceOver: true, .en),
                  HomeStrings.manualSosSpeak(voiceOver: false, .en),
                  HomeStrings.fallAlertReminder(15, voiceOver: true, .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(s)")
        }
    }

    func testBatterySpeakLevelsAndCharging() {
        // 充电中：报百分比 + 充电，不给"偏低"提示。
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 15, charging: true, .zh).contains("正在充电"))
        XCTAssertFalse(HomeStrings.batterySpeak(percent: 15, charging: true, .zh).contains("偏低"))
        // 未充电且 ≤20%（>10%）：追加"偏低，建议充电"（手机没电=盲人丢失导航/求助工具）。
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 15, charging: false, .zh).contains("偏低"))
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 12, charging: false, .en).lowercased().contains("running low"))
        // 未充电且 ≤10%：**危急**档，措辞比"偏低"更急（与主动告警 lowBatterySpeak 同 10% 阈值同调性），不混同。
        let crit = HomeStrings.batterySpeak(percent: 8, charging: false, .zh)
        XCTAssertTrue(crit.contains("很低") && crit.contains("立即充电"))
        XCTAssertFalse(crit.contains("偏低")) // 危急档不用"偏低"的温和措辞
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 5, charging: false, .en).lowercased().contains("critically low"))
        XCTAssertFalse(HomeStrings.batterySpeak(percent: 12, charging: false, .zh).contains("很低")) // 12%>10% 不误升危急
        // 充电中即便 ≤10% 也不告警（正在解决）。
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 8, charging: true, .zh).contains("正在充电"))
        XCTAssertFalse(HomeStrings.batterySpeak(percent: 8, charging: true, .zh).contains("很低"))
        // 未充电且 >20%：只报百分比，不误报偏低。
        XCTAssertFalse(HomeStrings.batterySpeak(percent: 80, charging: false, .zh).contains("偏低"))
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 80, charging: false, .zh).contains("百分之80"))
        // 越界夹取（异常读数不崩、不越 0–100）。
        XCTAssertTrue(HomeStrings.batterySpeak(percent: 150, charging: false, .zh).contains("百分之100"))
        XCTAssertTrue(HomeStrings.batterySpeak(percent: -5, charging: false, .zh).contains("百分之0"))
    }
}
