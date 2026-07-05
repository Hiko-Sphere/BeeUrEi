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
}
