import XCTest
@testable import BeeUrEi

/// 通话屏文案表（E5 第六批）：中文与历史一致、英文不串中文、举报原因数量对齐。
final class CallStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        XCTAssertEqual(CallStrings.peerHungUp(.zh), "对方已挂断")
        XCTAssertEqual(CallStrings.unansweredAnnounce(.zh), "暂时无人接听。可以挂断，或改为向志愿者求助。")
        XCTAssertEqual(CallStrings.videoStatus(sending: false, front: false, .zh), "画面未发送（隐私保护）")
        XCTAssertEqual(CallStrings.videoStatus(sending: true, front: true, .zh), "正在显示前置摄像头（你的面部）给对方")
        XCTAssertEqual(CallStrings.connectedWith("小明", .zh), "已连接 · 与小明")
        XCTAssertEqual(CallStrings.connectedWith(nil, .zh), "已连接")
        XCTAssertEqual(CallStrings.announceRemoteTorch(on: true, .zh), "协助者帮你打开了手电筒")
        XCTAssertEqual(CallStrings.answeredElsewhere(.zh), "已被其他亲友接听")
    }

    func testReportReasonsSameCount() {
        XCTAssertEqual(CallStrings.reportReasons(.zh).count, CallStrings.reportReasons(.en).count)
    }

    // 通话内文字（RTT）：拒绝原因映射绝不把原始码念给盲人（与 AccountStrings 同不变量）。
    func testCallTextRejectedNeverSpeaksRawCode() {
        for reason in ["content_blocked", "rate_limited", "invalid_text", "some_future_code"] {
            for lang in [Language.zh, .en] {
                let s = CallStrings.callTextRejected(reason, lang)
                XCTAssertFalse(s.contains(reason), "拒绝原因原始码被念出：\(s)")
                XCTAssertFalse(s.isEmpty)
            }
        }
        // 收到文字的播报包含文字本体（盲人靠这句听到内容）
        XCTAssertTrue(CallStrings.incomingCallText("前方左转", .zh).contains("前方左转"))
        XCTAssertTrue(CallStrings.incomingCallText("turn left", .en).contains("turn left"))
    }

    func testEnglishHasNoChinese() {
        let samples = [
            CallStrings.muteConfirmMessage(.en), CallStrings.mediaFailedHint(.en),
            CallStrings.unansweredAnnounce(.en), CallStrings.showVideoHint(.en),
            CallStrings.videoStatus(sending: true, front: false, .en), CallStrings.blockedOk(.en),
            CallStrings.fallbackSubtitle(.en), CallStrings.cameraPickerA11y(.en),
        ] + CallStrings.reportReasons(.en)
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
        }
    }
}
