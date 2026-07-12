import XCTest
@testable import BeeUrEi

/// 全局搜索作用域与命中路由。路由错的后果：点自己发的命中会"打开与自己的会话"（死页面）；
/// 作用域拼错会把全局搜索静默降级成空 with=（依赖服务端对空串的宽容）。
final class ChatSearchTests: XCTestCase {

    private func msg(from: String, to: String, group: String? = nil) -> ChatMessageInfo {
        ChatMessageInfo(id: "m1", fromId: from, toId: to, kind: "text", text: "hi", createdAt: 1, groupId: group)
    }

    func testScopeQueryThreeModes() {
        XCTAssertEqual(ChatSearch.scopeQuery(peerId: nil, groupId: "g1"), "group=g1")
        XCTAssertEqual(ChatSearch.scopeQuery(peerId: "p1", groupId: nil), "with=p1")
        XCTAssertNil(ChatSearch.scopeQuery(peerId: nil, groupId: nil))          // 全局：不带参
        XCTAssertEqual(ChatSearch.scopeQuery(peerId: "p1", groupId: "g1"), "group=g1") // 群优先（与旧行为一致）
    }

    func testTargetRoutesGroupHitsToGroup() {
        let t = ChatSearch.target(for: msg(from: "a", to: "", group: "g9"), selfId: "me")
        XCTAssertEqual(t.groupId, "g9")
        XCTAssertNil(t.peerId)
    }

    func testTargetRoutesDirectHitsToOtherParty() {
        // 收到的：对方=fromId。
        let incoming = ChatSearch.target(for: msg(from: "them", to: "me"), selfId: "me")
        XCTAssertEqual(incoming.peerId, "them")
        // 自己发的：对方=toId——取错会"打开与自己的会话"。
        let outgoing = ChatSearch.target(for: msg(from: "me", to: "them"), selfId: "me")
        XCTAssertEqual(outgoing.peerId, "them")
    }

    func testStringsBilingual() {
        XCTAssertEqual(ChatStrings.searchAllTitle(.zh), "搜索全部消息")
        for s in [ChatStrings.searchAllTitle(.en), ChatStrings.searchJumpHint(.en),
                  ChatStrings.searchLocatedSpeak("x", .en), ChatStrings.messageNotLoaded(.en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
