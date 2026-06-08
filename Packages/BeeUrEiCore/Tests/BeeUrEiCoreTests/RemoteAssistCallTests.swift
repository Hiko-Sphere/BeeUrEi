import XCTest
@testable import BeeUrEiCore

final class RemoteAssistCallTests: XCTestCase {

    private func contacts() -> [Helper] {
        [
            Helper(id: "1", name: "妈妈", language: "zh", isOnline: true),
            Helper(id: "2", name: "朋友A", language: "en", isOnline: true),
            Helper(id: "3", name: "爸爸", language: "zh", isOnline: false),
        ]
    }

    func testCallableFiltersOnlineAndLanguage() {
        let callable = RemoteAssistCall.callable(from: contacts(), language: "zh")
        XCTAssertEqual(callable.map(\.id), ["1"])  // 在线且中文
    }

    func testIncomingCallRingsThenAnswers() {
        var call = RemoteAssistCall()
        XCTAssertTrue(call.incoming(callerID: "9"))           // idle → ringing
        XCTAssertEqual(call.state, .ringing(helperID: "9"))
        call.answer()                                         // ringing → connected（修复前来电侧 answer 是 no-op）
        XCTAssertEqual(call.state, .connected(helperID: "9"))
        XCTAssertFalse(call.incoming(callerID: "x"))          // 非 idle 不再接受新来电
    }

    func testCallFlowRingingToConnectedToEnded() {
        var call = RemoteAssistCall()
        let mom = contacts()[0]
        XCTAssertTrue(call.call(mom))
        XCTAssertEqual(call.state, .ringing(helperID: "1"))
        call.answer()
        XCTAssertEqual(call.state, .connected(helperID: "1"))
        call.hangUp()
        XCTAssertEqual(call.state, .ended)
    }

    func testCallOfflineFails() {
        var call = RemoteAssistCall()
        let dad = contacts()[2]
        XCTAssertFalse(call.call(dad))
        XCTAssertEqual(call.state, .failed("对方不在线"))
    }

    func testCannotCallWhenNotIdle() {
        var call = RemoteAssistCall()
        let mom = contacts()[0]
        XCTAssertTrue(call.call(mom))
        XCTAssertFalse(call.call(mom))   // 振铃中不能再发起
    }

    func testResetReturnsToIdle() {
        var call = RemoteAssistCall()
        _ = call.call(contacts()[0])
        call.reset()
        XCTAssertEqual(call.state, .idle)
    }
}
