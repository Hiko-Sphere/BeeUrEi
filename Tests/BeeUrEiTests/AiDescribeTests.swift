import XCTest
@testable import BeeUrEi

/// AI 描述照片：错误码映射（盲人能听懂、不徒劳重试）+ 配额提醒门控。
/// 映射错的后果：配额用尽被念成"请重试"——盲人反复重试永远失败还以为是网络问题。
final class AiDescribeTests: XCTestCase {

    func testErrorCodesMapToActionableMessages() {
        // 每个已知码都有专属可执行原因，绝不落笼统"重试"。
        XCTAssertTrue(ChatStrings.aiDescribeErrorText("ai_daily_quota_exceeded", .zh).contains("用完"))
        XCTAssertTrue(ChatStrings.aiDescribeErrorText("ai_not_configured", .zh).contains("未配置"))
        XCTAssertTrue(ChatStrings.aiDescribeErrorText("image_too_large", .zh).contains("太大"))
        XCTAssertTrue(ChatStrings.aiDescribeErrorText("feature_disabled", .zh).contains("关闭"))
        XCTAssertTrue(ChatStrings.aiDescribeErrorText("too_many_requests", .zh).contains("频繁"))
        // 已知码绝不等于兜底文案（映射被拔掉时此断言变红）。
        let fallback = ChatStrings.aiDescribeErrorText("some_unknown_code", .zh)
        for code in ["ai_daily_quota_exceeded", "ai_not_configured", "image_too_large", "feature_disabled", "too_many_requests"] {
            XCTAssertNotEqual(ChatStrings.aiDescribeErrorText(code, .zh), fallback, "\(code) 落到了笼统兜底")
        }
    }

    func testQuotaNoteOnlyNearLimit() {
        // 付费额度：临近上限（≤3）才提醒——每次都念"还剩 N 次"是噪声。
        XCTAssertNil(ChatStrings.quotaRemainingNote(remaining: nil, .zh))   // 服务端未回带
        XCTAssertNil(ChatStrings.quotaRemainingNote(remaining: 10, .zh))    // 充裕：不打扰
        XCTAssertNil(ChatStrings.quotaRemainingNote(remaining: 4, .zh))
        XCTAssertEqual(ChatStrings.quotaRemainingNote(remaining: 3, .zh), "今日 AI 描述还剩 3 次")
        XCTAssertEqual(ChatStrings.quotaRemainingNote(remaining: 0, .zh), "今日 AI 描述还剩 0 次")
        XCTAssertNil(ChatStrings.quotaRemainingNote(remaining: -1, .zh))    // 坏值不念
    }

    func testEnglishHasNoChinese() {
        var samples = [ChatStrings.describePhoto(.en), ChatStrings.describingPhoto(.en),
                       ChatStrings.quotaRemainingNote(remaining: 1, .en)!,
                       ChatStrings.quotaRemainingNote(remaining: 2, .en)!]
        for code in ["ai_daily_quota_exceeded", "ai_not_configured", "image_too_large", "unknown"] {
            samples.append(ChatStrings.aiDescribeErrorText(code, .en))
        }
        XCTAssertEqual(ChatStrings.quotaRemainingNote(remaining: 1, .en), "1 AI description left today") // 单复数
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
