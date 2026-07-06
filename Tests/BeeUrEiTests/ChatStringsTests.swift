import XCTest
@testable import BeeUrEi

/// 聊天发送错误文案（sendErrorText）：与 web chatErrorText 跨端一致——"重试同一操作也没用"的状态须点明，
/// 不落笼统"发送失败，请重试"（否则盲人对着注定失败的发送反复重试）。
final class ChatStringsTests: XCTestCase {

    func testSendErrorTextMapsActionableCodesLikeWeb() {
        let generic = ChatStrings.sendFailed(.zh)
        // 本次补齐此前 iOS 漏映射、真实可达的码：视频发送(sendVideo→uploadMedia)会触达媒体三档；限流触达 too_many_requests。
        for code in ["too_many_requests", "media_too_large", "media_quota_exceeded", "unsupported_media_type"] {
            let zh = ChatStrings.sendErrorText(APIError.server(code), .zh)
            XCTAssertNotEqual(zh, generic, "码 \(code) 应有专属中文文案，而非落笼统 sendFailed")
            let en = ChatStrings.sendErrorText(APIError.server(code), .en)
            XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(en)")
        }
        // 具体内容抽查（媒体太大须点明可行动的"选短一点的"）。
        XCTAssertEqual(ChatStrings.sendErrorText(APIError.server("media_too_large"), .zh), "视频太大（上限 50MB），请选短一点的。")
        // 既有已映射码仍在（回归）。
        XCTAssertEqual(ChatStrings.sendErrorText(APIError.server("blocked"), .zh), "你们之间存在拉黑，无法发送")
        // 未知码 / 非 APIError.server：仍落笼统 sendFailed（不误报）。
        XCTAssertEqual(ChatStrings.sendErrorText(APIError.server("nope"), .zh), generic)
        XCTAssertEqual(ChatStrings.sendErrorText(NSError(domain: "x", code: 1), .zh), generic)
    }

    func testRecallErrorTextDistinguishesReason() {
        let windowMsg = ChatStrings.recallFailed(.zh) // "撤回失败（仅发出 2 分钟内可撤回）"
        // 时限过 / 未知 / 非 APIError → 常态时限文案。
        XCTAssertEqual(ChatStrings.recallErrorText(APIError.server("recall_window_passed"), .zh), windowMsg)
        XCTAssertEqual(ChatStrings.recallErrorText(APIError.server("nope"), .zh), windowMsg)
        XCTAssertEqual(ChatStrings.recallErrorText(NSError(domain: "x", code: 1), .zh), windowMsg)
        // 功能关停/维护/限流 → 点明真因，**不**误显时限（否则盲人以为"是不是超时"反复重试）。
        for code in ["feature_disabled", "maintenance", "too_many_requests"] {
            let zh = ChatStrings.recallErrorText(APIError.server(code), .zh)
            XCTAssertNotEqual(zh, windowMsg, "码 \(code) 应点明真因而非落时限文案")
            XCTAssertFalse(zh.contains("2 分钟"), "码 \(code) 不该误显时限：\(zh)")
            let en = ChatStrings.recallErrorText(APIError.server(code), .en)
            XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(en)")
        }
        XCTAssertTrue(ChatStrings.recallErrorText(APIError.server("feature_disabled"), .zh).contains("关闭"))
    }

    func testReactionFeedbackStringsBilingualAndDistinct() {
        // 盲人回应表情的语音反馈：加上/取消/失败三态各不相同、双语，且"加上"带 emoji 便于复核。
        XCTAssertTrue(ChatStrings.reactionAdded("👍", .zh).contains("👍"))
        XCTAssertTrue(ChatStrings.reactionAdded("👍", .zh).contains("已回应"))
        XCTAssertNotEqual(ChatStrings.reactionAdded("👍", .zh), ChatStrings.reactionRemoved(.zh))
        XCTAssertNotEqual(ChatStrings.reactionRemoved(.zh), ChatStrings.reactionFailed(.zh))
        // 英文三态不串中文。
        for s in [ChatStrings.reactionAdded("❤️", .en), ChatStrings.reactionRemoved(.en), ChatStrings.reactionFailed(.en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
    }

    func testReadPhotoTextStringsBilingual() {
        // 读图/复制图中文字（盲人收图看不见内容→端侧 OCR）：各态非空、双语、英文不串中文；读与复制是**不同**操作名。
        for l in [Language.zh, .en] {
            for s in [ChatStrings.readPhotoText(l), ChatStrings.readingPhoto(l), ChatStrings.noTextInPhoto(l),
                      ChatStrings.copyPhotoText(l), ChatStrings.photoTextCopied(l)] {
                XCTAssertFalse(s.isEmpty)
            }
        }
        XCTAssertTrue(ChatStrings.readPhotoText(.zh).contains("文字")) // 操作名点明"文字"（区别于"全屏查看"）
        XCTAssertNotEqual(ChatStrings.readPhotoText(.zh), ChatStrings.copyPhotoText(.zh)) // 读≠复制，两个独立转子操作
        XCTAssertNotEqual(ChatStrings.readPhotoText(.en), ChatStrings.copyPhotoText(.en))
        for s in [ChatStrings.readPhotoText(.en), ChatStrings.readingPhoto(.en), ChatStrings.noTextInPhoto(.en),
                  ChatStrings.copyPhotoText(.en), ChatStrings.photoTextCopied(.en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
    }

    func testSendConfirmationStringsBilingualAndDistinct() {
        // 盲人看不到"已送达"的气泡出现，媒体/位置又是异步操作——成功须**朗读**确认（此前只报进度/失败、成功静默）。
        // 三态各不相同、双语、英文不串中文，且都点明"已发送/sent"。
        // 图片/视频/位置/**语音**四类异步发送成功确认（语音是盲人最自然的输入，尤须确认）。
        let zhs = [ChatStrings.photoSent(.zh), ChatStrings.videoSent(.zh), ChatStrings.locationSent(.zh), ChatStrings.voiceSent(.zh)]
        for s in zhs { XCTAssertTrue(s.contains("已发送"), "中文确认应点明已发送：\(s)") }
        XCTAssertEqual(Set(zhs).count, 4, "照片/视频/位置/语音四态文案须各不相同")
        for s in [ChatStrings.photoSent(.en), ChatStrings.videoSent(.en), ChatStrings.locationSent(.en), ChatStrings.voiceSent(.en)] {
            XCTAssertTrue(s.lowercased().contains("sent"), "英文确认应含 sent：\(s)")
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
        // 与失败文案明确不同（不能把成功念成像失败）。
        XCTAssertNotEqual(ChatStrings.photoSent(.zh), ChatStrings.sendFailed(.zh))
        XCTAssertNotEqual(ChatStrings.videoSent(.zh), ChatStrings.sendFailed(.zh))
        XCTAssertNotEqual(ChatStrings.voiceSent(.zh), ChatStrings.sendFailed(.zh))
    }

    func testUploadingVideoStillReassuranceBilingualAndDistinct() {
        // 大视频/弱网上传>8秒的周期安慰："还在上传"须与初始"正在上传"不同（否则听不出是"仍在进行"还是卡在原地）、双语、英不串中。
        XCTAssertNotEqual(ChatStrings.uploadingVideoStill(.zh), ChatStrings.uploadingVideo(.zh))
        XCTAssertTrue(ChatStrings.uploadingVideoStill(.zh).contains("还在上传"))
        let en = ChatStrings.uploadingVideoStill(.en)
        XCTAssertTrue(en.lowercased().contains("still") && en.lowercased().contains("upload"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(en)")
    }

    func testForwardedEditedTagsBilingual() {
        XCTAssertEqual(ChatStrings.forwardedTag(.zh), "已转发")
        XCTAssertEqual(ChatStrings.forwardedTag(.en), "Forwarded")
        XCTAssertEqual(ChatStrings.editedTag(.zh), "已编辑")
        XCTAssertEqual(ChatStrings.editedTag(.en), "Edited")
    }

    func testForwardedEditedA11ySuffixComposition() {
        // 盲人靠此后缀听到"已转发/已编辑"（视觉标签 accessibilityHidden）。空/单/双组合都对。
        XCTAssertEqual(ChatStrings.forwardedEditedA11y(forwarded: false, edited: false, .zh), "")
        XCTAssertEqual(ChatStrings.forwardedEditedA11y(forwarded: true, edited: false, .zh), "，已转发")
        XCTAssertEqual(ChatStrings.forwardedEditedA11y(forwarded: false, edited: true, .en), "，Edited")
        XCTAssertEqual(ChatStrings.forwardedEditedA11y(forwarded: true, edited: true, .zh), "，已转发，已编辑")
    }

    func testGroupReceiptStrings() {
        // 视觉"已读 N/总"（WhatsApp 式）。
        XCTAssertEqual(ChatStrings.groupReceipt(3, 5, .zh), "已读 3/5")
        XCTAssertEqual(ChatStrings.groupReceipt(3, 5, .en), "Read 3/5")
        // a11y 用可读措辞（避免 VoiceOver 念"斜杠"）——盲人靠此听到自己群消息被几人读了。
        XCTAssertEqual(ChatStrings.groupReceiptA11y(3, 5, .zh), "已读 3 人，共 5 人")
        XCTAssertEqual(ChatStrings.groupReceiptA11y(3, 5, .en), "read by 3 of 5")
    }

    func testChatMessageDecodesForwardedEditedAndGroupReceipt() throws {
        // 服务端下发 forwarded/editedAt/readBy/readTotal，iOS 须解码——此前缺这些字段，盲人听不到"已转发/已编辑/群已读"。
        let json = #"{"id":"m1","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1000,"forwarded":true,"editedAt":2000,"readBy":3,"readTotal":5}"#
        let m = try JSONDecoder().decode(ChatMessageInfo.self, from: Data(json.utf8))
        XCTAssertEqual(m.forwarded, true)
        XCTAssertEqual(m.editedAt, 2000)
        XCTAssertEqual(m.readBy, 3)
        XCTAssertEqual(m.readTotal, 5)
        // 缺这些字段的普通消息（向后兼容 + 绝大多数单聊消息）→ nil，不崩。
        let plain = #"{"id":"m2","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1000}"#
        let m2 = try JSONDecoder().decode(ChatMessageInfo.self, from: Data(plain.utf8))
        XCTAssertNil(m2.forwarded)
        XCTAssertNil(m2.editedAt)
        XCTAssertNil(m2.readBy)
        XCTAssertNil(m2.readTotal)
    }

    func testConversationDecodesMutedField() throws {
        // 服务端会话/群列表下发 muted（我是否静音），iOS 须解码——此前缺该字段，静音状态与静音入口都无从谈起（死字段）。
        let dm = #"{"peer":{"id":"p1","username":"amy","displayName":"阿明","avatar":null},"last":{"id":"m","fromId":"p1","toId":"me","kind":"text","text":"hi","createdAt":1000},"unread":0,"muted":true}"#
        XCTAssertEqual(try JSONDecoder().decode(ConversationInfo.self, from: Data(dm.utf8)).muted, true)
        let grp = #"{"group":{"id":"g1","name":"家人群","ownerId":"me","memberIds":["me","p1"],"createdAt":1000},"members":[],"last":null,"unread":0,"muted":true}"#
        XCTAssertEqual(try JSONDecoder().decode(GroupConversationInfo.self, from: Data(grp.utf8)).muted, true)
        // 缺 muted 的旧/兼容负载 → nil（视图按未静音处理，不崩、不误显🔕）。
        let legacy = #"{"peer":{"id":"p2","username":"bob","displayName":"Bob","avatar":null},"last":{"id":"m","fromId":"p2","toId":"me","kind":"text","text":"hi","createdAt":1000},"unread":0}"#
        XCTAssertNil(try JSONDecoder().decode(ConversationInfo.self, from: Data(legacy.utf8)).muted)
    }

    func testMuteStringsBilingualAndDistinct() {
        XCTAssertNotEqual(ChatStrings.muteAction(.zh), ChatStrings.unmuteAction(.zh))
        XCTAssertNotEqual(ChatStrings.mutedConfirm(.zh), ChatStrings.unmutedConfirm(.zh))
        for s in [ChatStrings.mutedBadge(.en), ChatStrings.muteAction(.en), ChatStrings.unmuteAction(.en),
                  ChatStrings.mutedConfirm(.en), ChatStrings.unmutedConfirm(.en), ChatStrings.muteFailed(.en)] {
            XCTAssertFalse(s.isEmpty)
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文串中文：\(s)")
        }
    }

    private func mkMsg(_ id: String, from: String, reaction: String? = nil) -> ChatMessageInfo {
        let rx = reaction.map { ",\"reaction\":\"\($0)\"" } ?? ""
        let json = "{\"id\":\"\(id)\",\"fromId\":\"\(from)\",\"toId\":\"x\",\"kind\":\"text\",\"text\":\"hi\",\"createdAt\":1000\(rx)}"
        return try! JSONDecoder().decode(ChatMessageInfo.self, from: Data(json.utf8))
    }

    func testReactionAnnouncerReportsOnlyChangedReactionsOnMyMessages() {
        let me = "me"
        // 对方给"我发的消息"新贴表情 → 报（盲人靠此语音得知被回应）。
        XCTAssertEqual(ChatReactionAnnouncer.newReactionsOnMyMessages(
            old: [mkMsg("m1", from: me)], new: [mkMsg("m1", from: me, reaction: "👍")], myId: me), ["👍"])
        // 换了表情（👍→❤️）→ 报新表情。
        XCTAssertEqual(ChatReactionAnnouncer.newReactionsOnMyMessages(
            old: [mkMsg("m1", from: me, reaction: "👍")], new: [mkMsg("m1", from: me, reaction: "❤️")], myId: me), ["❤️"])
        // 无变化 → 不报（我自反应即时写入 messages，故轮询时 old 已含、天然不重报）。
        XCTAssertEqual(ChatReactionAnnouncer.newReactionsOnMyMessages(
            old: [mkMsg("m1", from: me, reaction: "👍")], new: [mkMsg("m1", from: me, reaction: "👍")], myId: me), [])
        // 移除表情 → 不报。
        XCTAssertEqual(ChatReactionAnnouncer.newReactionsOnMyMessages(
            old: [mkMsg("m1", from: me, reaction: "👍")], new: [mkMsg("m1", from: me)], myId: me), [])
        // 对方**自己**消息上的表情变化 → 不报（只关心我发的消息被回应）。
        XCTAssertEqual(ChatReactionAnnouncer.newReactionsOnMyMessages(
            old: [mkMsg("p1", from: "peer")], new: [mkMsg("p1", from: "peer", reaction: "👍")], myId: me), [])
        // 首见的消息（old 里没有）→ 不报（避免首载把历史表情全轰炸；由新消息分支处理）。
        XCTAssertEqual(ChatReactionAnnouncer.newReactionsOnMyMessages(
            old: [], new: [mkMsg("m1", from: me, reaction: "👍")], myId: me), [])
    }

    func testReactionReceivedSpeakBilingual() {
        XCTAssertTrue(ChatStrings.reactionReceivedSpeak("👍", .zh).contains("👍"))
        XCTAssertTrue(ChatStrings.reactionReceivedSpeak("👍", .zh).contains("收到回应"))
        let en = ChatStrings.reactionReceivedSpeak("❤️", .en)
        XCTAssertTrue(en.contains("❤️"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    private func mkEdit(_ id: String, from: String, text: String = "hi", editedAt: Int? = nil, kind: String = "text") -> ChatMessageInfo {
        let e = editedAt.map { ",\"editedAt\":\($0)" } ?? ""
        let json = "{\"id\":\"\(id)\",\"fromId\":\"\(from)\",\"toId\":\"x\",\"kind\":\"\(kind)\",\"text\":\"\(text)\",\"createdAt\":1000\(e)}"
        return try! JSONDecoder().decode(ChatMessageInfo.self, from: Data(json.utf8))
    }

    func testEditAnnouncerReportsOnlyPeerEditsOfSeenMessages() {
        let me = "me"
        // 对方把已见过的消息改了（editedAt 从无到有）→ 报（盲人得知修正后的内容）。
        XCTAssertEqual(ChatEditAnnouncer.peerEditsToAnnounce(
            old: [mkEdit("m1", from: "peer")],
            new: [mkEdit("m1", from: "peer", text: "4点见", editedAt: 2000)], myId: me).map(\.id), ["m1"])
        // editedAt 无变化 → 不报。
        XCTAssertTrue(ChatEditAnnouncer.peerEditsToAnnounce(
            old: [mkEdit("m1", from: "peer", editedAt: 2000)],
            new: [mkEdit("m1", from: "peer", editedAt: 2000)], myId: me).isEmpty)
        // **我自己**发的消息被编辑 → 不报（本人自己知道）。
        XCTAssertTrue(ChatEditAnnouncer.peerEditsToAnnounce(
            old: [mkEdit("m1", from: me)],
            new: [mkEdit("m1", from: me, editedAt: 2000)], myId: me).isEmpty)
        // 撤回（kind=recalled，文本空）→ 不报（撤回另论，不当"改成空"念）。
        XCTAssertTrue(ChatEditAnnouncer.peerEditsToAnnounce(
            old: [mkEdit("m1", from: "peer")],
            new: [mkEdit("m1", from: "peer", text: "", editedAt: 2000, kind: "recalled")], myId: me).isEmpty)
        // 首见的消息（old 里没有）→ 不报（由新消息分支念现文，避免重复/首载轰炸）。
        XCTAssertTrue(ChatEditAnnouncer.peerEditsToAnnounce(
            old: [], new: [mkEdit("m1", from: "peer", editedAt: 2000)], myId: me).isEmpty)
    }

    func testMessageEditedSpeakBilingual() {
        XCTAssertTrue(ChatStrings.messageEditedSpeak("小明", "4点见", .zh).contains("4点见"))
        XCTAssertTrue(ChatStrings.messageEditedSpeak("小明", "4点见", .zh).contains("改成"))
        let en = ChatStrings.messageEditedSpeak("Sam", "see you at 4", .en)
        XCTAssertTrue(en.contains("see you at 4") && en.lowercased().contains("edited"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }

    func testRecallAnnouncerReportsOnlyPeerRecallsOfSeenMessages() {
        let me = "me"
        // 对方把已见过的消息撤回（text→"" kind→recalled）→ 报（盲人得知那条作废）。
        XCTAssertEqual(ChatRecallAnnouncer.peerRecalls(
            old: [mkEdit("m1", from: "peer", text: "在星巴克等你")],
            new: [mkEdit("m1", from: "peer", text: "", kind: "recalled")], myId: me).map(\.id), ["m1"])
        // 一直是撤回（无变化）→ 不报。
        XCTAssertTrue(ChatRecallAnnouncer.peerRecalls(
            old: [mkEdit("m1", from: "peer", text: "", kind: "recalled")],
            new: [mkEdit("m1", from: "peer", text: "", kind: "recalled")], myId: me).isEmpty)
        // **我自己**撤回自己的消息 → 不报（本人自己知道）。
        XCTAssertTrue(ChatRecallAnnouncer.peerRecalls(
            old: [mkEdit("m1", from: me, text: "hi")],
            new: [mkEdit("m1", from: me, text: "", kind: "recalled")], myId: me).isEmpty)
        // 首见即已撤回（old 里没有）→ 不报（新消息分支已跳过撤回，避免进来念一堆）。
        XCTAssertTrue(ChatRecallAnnouncer.peerRecalls(
            old: [], new: [mkEdit("m1", from: "peer", text: "", kind: "recalled")], myId: me).isEmpty)
    }

    func testMessageRecalledSpeakBilingual() {
        XCTAssertTrue(ChatStrings.messageRecalledSpeak("小明", .zh).contains("撤回"))
        let en = ChatStrings.messageRecalledSpeak("Sam", .en)
        XCTAssertTrue(en.contains("Sam") && en.lowercased().contains("unsent"))
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }
}
