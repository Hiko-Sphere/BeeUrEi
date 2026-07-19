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

    func testVqaConversationMultiTurnAndResetOnImageChange() {
        var convo = APIClient.VqaConversation()
        // 首轮（图 A 泛描述）：无历史（单轮）。
        XCTAssertEqual(convo.historyForNewQuestion(imageKey: "A"), [])
        convo.record(question: nil, answer: "一盒饼干", defaultQuestion: "请描述这张照片")
        // 追问（同图 A）：历史含首轮，泛描述记为默认问句（供上下文）。
        let h1 = convo.historyForNewQuestion(imageKey: "A")
        XCTAssertEqual(h1, [APIClient.VqaTurn(q: "请描述这张照片", a: "一盒饼干")])
        convo.record(question: "多少钱", answer: "15 元", defaultQuestion: "请描述这张照片")
        // 再追问（同图 A）：历史累积两轮，用户问句原样。
        let h2 = convo.historyForNewQuestion(imageKey: "A")
        XCTAssertEqual(h2, [APIClient.VqaTurn(q: "请描述这张照片", a: "一盒饼干"), APIClient.VqaTurn(q: "多少钱", a: "15 元")])
        // 换到图 B（不同 key）：对话**重置**，历史清空（不把图 A 的上下文误带给图 B）。
        XCTAssertEqual(convo.historyForNewQuestion(imageKey: "B"), [])
        convo.record(question: "这是什么", answer: "一只猫", defaultQuestion: "请描述这张照片")
        XCTAssertEqual(convo.historyForNewQuestion(imageKey: "B"), [APIClient.VqaTurn(q: "这是什么", a: "一只猫")])
        // 空白问句按泛描述处理（记默认问句，不记空 q 污染上下文）。
        var c2 = APIClient.VqaConversation()
        _ = c2.historyForNewQuestion(imageKey: "X")
        c2.record(question: "   ", answer: "答", defaultQuestion: "请描述这张照片")
        XCTAssertEqual(c2.historyForNewQuestion(imageKey: "X"), [APIClient.VqaTurn(q: "请描述这张照片", a: "答")])
    }

    /// 深度追问历史滑动窗口：历史最多带 maxHistory(8) 轮——否则第 9+ 次追问带 >8 轮被服务端 400 拒、连续追问断。
    func testVqaHistoryCappedToMaxForServerLimit() {
        var convo = APIClient.VqaConversation()
        _ = convo.historyForNewQuestion(imageKey: "A")
        // 记 12 轮（同一张图深度追问）。
        for i in 1...12 { convo.record(question: "q\(i)", answer: "a\(i)", defaultQuestion: "请描述这张照片") }
        let h = convo.historyForNewQuestion(imageKey: "A")
        XCTAssertEqual(h.count, APIClient.VqaConversation.maxHistory)          // 至多 8 轮，永不超服务端上限
        XCTAssertEqual(h.first, APIClient.VqaTurn(q: "q5", a: "a5"))            // 保留**最近** 8 轮（q5…q12），丢最旧
        XCTAssertEqual(h.last, APIClient.VqaTurn(q: "q12", a: "a12"))
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
