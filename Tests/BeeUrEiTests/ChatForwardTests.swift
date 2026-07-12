import XCTest
@testable import BeeUrEi

/// 转发消息：可转发判定（与 web isForwardableKind 同口径）+ 双语文案。
/// 判定错误的后果：视频（mediaId 按会话鉴权）被转发到无权会话 → 收件人看不到（悬垂）；
/// 或文本/语音不可转发 → 功能缺失。
final class ChatForwardTests: XCTestCase {

    func testSelfContainedKindsForwardable() {
        // 文本/位置/图片/语音都是内联内容（data: URL/内嵌坐标），收件人无需访问原会话。
        for k in ["text", "location", "image", "audio"] {
            XCTAssertTrue(ChatForward.isForwardableKind(k), "\(k) 应可转发")
        }
    }

    func testNonSelfContainedKindsNotForwardable() {
        // 视频=mediaId（按会话鉴权，转到无权会话看不到）；撤回/未知类型不转发。
        for k in ["video", "recalled", "sticker", ""] {
            XCTAssertFalse(ChatForward.isForwardableKind(k), "\(k) 不应可转发")
        }
    }

    func testStringsBilingual() {
        XCTAssertEqual(ChatStrings.forwardAction(.zh), "转发")
        XCTAssertEqual(ChatStrings.forwardedTo("小明", .zh), "已转发给 小明")
        for s in [ChatStrings.forwardAction(.en), ChatStrings.forwardTo(.en), ChatStrings.forwardedTo("Ann", .en),
                  ChatStrings.forwardFailed(.en), ChatStrings.forwardNoTargets(.en),
                  ChatStrings.forwardContactsHeader(.en), ChatStrings.forwardGroupsHeader(.en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
