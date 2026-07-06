import XCTest
@testable import BeeUrEi

/// 实名被拒文案：标准理由码 + 管理员**具体说明**（rejectReasonNote）。
/// 盲人看不到自己的证件/自拍哪里不对——被拒时这段具体说明经 TTS 读出尤其关键（与 web 77aea1a 对齐）。
final class KYCStringsTests: XCTestCase {
    func testRejectedNoteAppendsReviewerNoteWhenPresent() {
        // 有具体说明：标准理由 + "审核说明：<note>"。
        let s = KYCStrings.rejectedNote("blurry", note: "身份证背面缺失，请补拍", .zh)
        XCTAssertTrue(s.contains("上次未通过"))
        XCTAssertTrue(s.contains("审核说明：身份证背面缺失，请补拍"), s)
        // 无说明（nil / 纯空白）：不加"审核说明"标签，只留标准理由（不留悬空标签）。
        XCTAssertFalse(KYCStrings.rejectedNote("blurry", note: nil, .zh).contains("审核说明"))
        XCTAssertFalse(KYCStrings.rejectedNote("blurry", note: "   ", .zh).contains("审核说明"))
        // 向后兼容：旧两参调用（无 note）行为不变。
        XCTAssertFalse(KYCStrings.rejectedNote("blurry", .zh).contains("审核说明"))
        // 英文同理，且不串中文。
        let en = KYCStrings.rejectedNote("blurry", note: "Back of ID missing", .en)
        XCTAssertTrue(en.contains("Reviewer note: Back of ID missing"), en)
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(en)")
    }

    func testSubmittingSpeakSetsExpectationForUpload() {
        // 提交开场语音：须点明"正在上传"+"请稍候"（证件各 ~8MB、弱网慢，盲人看不到进度须知道在上传、要等），
        // 且与终态"已提交"不同（否则听不出是刚开始还是已完成）。双语、英不串中。
        let zh = KYCStrings.submittingSpeak(.zh)
        XCTAssertTrue(zh.contains("上传") && zh.contains("请稍候"), "开场语音须点明正在上传+请稍候：\(zh)")
        XCTAssertNotEqual(zh, KYCStrings.submitted(.zh))
        let en = KYCStrings.submittingSpeak(.en)
        XCTAssertTrue(en.lowercased().contains("uploading") && en.lowercased().contains("wait"), en)
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(en)")
    }
}
