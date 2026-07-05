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
}
