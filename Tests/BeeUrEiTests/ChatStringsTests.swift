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
}
