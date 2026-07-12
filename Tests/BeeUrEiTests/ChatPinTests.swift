import XCTest
@testable import BeeUrEi

/// 置顶消息（会话顶部横幅）：线程响应 pinned 解码 + 读屏文案。
/// 此前 iOS 只解线程的 messages、pinned 被 Codable 静默丢弃——置顶横幅无从渲染，
/// 亲友把关键信息（地址/医嘱）钉顶后 iOS 盲人用户完全不知道。
final class ChatPinTests: XCTestCase {

    func testThreadDecodesPinnedWithAttribution() throws {
        let t = try JSONDecoder().decode(ChatThreadInfo.self, from: Data("""
        {"messages":[{"id":"m1","fromId":"a","toId":"b","kind":"text","text":"hi","createdAt":1}],
         "pinned":{"id":"m9","fromId":"a","toId":"b","kind":"text","text":"急救药在抽屉第二层",
                   "createdAt":5,"pinnedBy":"a","pinnedByName":"小明"}}
        """.utf8))
        XCTAssertEqual(t.messages.count, 1)
        XCTAssertEqual(t.pinned?.id, "m9")
        XCTAssertEqual(t.pinned?.text, "急救药在抽屉第二层")
        XCTAssertEqual(t.pinned?.pinnedByName, "小明")
    }

    func testThreadDecodesWithoutPinned() throws {
        // 无置顶（null）与旧服务端（字段缺失）都 → nil，不崩。
        for json in [
            #"{"messages":[],"pinned":null}"#,
            #"{"messages":[]}"#,
        ] {
            let t = try JSONDecoder().decode(ChatThreadInfo.self, from: Data(json.utf8))
            XCTAssertNil(t.pinned, "输入 \(json) 应解出 pinned=nil")
        }
    }

    func testBannerA11yMatchesWebWording() {
        // 与网页 aria-label 同措辞："置顶消息（X 置顶）：预览，点击跳转"。
        XCTAssertEqual(ChatStrings.pinnedBannerA11y(pinnedByName: "小明", preview: "药在抽屉", .zh),
                       "置顶消息（小明 置顶）：药在抽屉，点击跳转")
        // 置顶者名缺失（已注销 '—' 之外的空值防御）→ 不留空括号。
        XCTAssertEqual(ChatStrings.pinnedBannerA11y(pinnedByName: nil, preview: "药在抽屉", .zh),
                       "置顶消息：药在抽屉，点击跳转")
        XCTAssertEqual(ChatStrings.pinnedBannerA11y(pinnedByName: "Ann", preview: "meds in drawer", .en),
                       "Pinned message (pinned by Ann): meds in drawer, tap to jump")
    }

    func testSpeakFallbackAndConfirmStrings() {
        // 点横幅但消息不在已加载窗口 → 直接朗读内容（盲人要的是随时可听）。
        XCTAssertEqual(ChatStrings.pinnedSpeakFallback(pinnedByName: "小明", preview: "药在抽屉", .zh), "小明 置顶：药在抽屉")
        XCTAssertEqual(ChatStrings.pinnedSpeakFallback(pinnedByName: nil, preview: "药在抽屉", .zh), "置顶消息：药在抽屉")
        for s in [ChatStrings.pinAction(.en), ChatStrings.unpinAction(.en), ChatStrings.pinnedConfirm(.en),
                  ChatStrings.unpinnedConfirm(.en), ChatStrings.pinFailed(.en),
                  ChatStrings.pinnedSpeakFallback(pinnedByName: "Ann", preview: "x", .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
