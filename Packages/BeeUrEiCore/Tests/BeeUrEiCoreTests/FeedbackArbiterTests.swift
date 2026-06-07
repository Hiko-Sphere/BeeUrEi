import XCTest
@testable import BeeUrEiCore

final class FeedbackArbiterTests: XCTestCase {

    func testPlaysWhenIdle() {
        var a = FeedbackArbiter()
        XCTAssertTrue(a.shouldPlay(FeedbackEvent(priority: .status, speech: "x")))
        XCTAssertEqual(a.current?.priority, .status)
    }

    func testObstaclePreemptsTurn() {
        var a = FeedbackArbiter()
        _ = a.shouldPlay(FeedbackEvent(priority: .turn, speech: "前方右转"))
        XCTAssertTrue(a.shouldPlay(FeedbackEvent(priority: .obstacle, speech: "障碍")))
        XCTAssertEqual(a.current?.speech, "障碍")
    }

    func testLowerPriorityDoesNotPreempt() {
        var a = FeedbackArbiter()
        _ = a.shouldPlay(FeedbackEvent(priority: .obstacle, speech: "障碍"))
        XCTAssertFalse(a.shouldPlay(FeedbackEvent(priority: .environment, speech: "环境")))
        XCTAssertEqual(a.current?.speech, "障碍")
    }

    func testEqualPriorityPreemptsWithNewer() {
        var a = FeedbackArbiter()
        _ = a.shouldPlay(FeedbackEvent(priority: .obstacle, speech: "旧"))
        XCTAssertTrue(a.shouldPlay(FeedbackEvent(priority: .obstacle, speech: "新")))
        XCTAssertEqual(a.current?.speech, "新")
    }

    func testFinishReleasesChannel() {
        var a = FeedbackArbiter()
        _ = a.shouldPlay(FeedbackEvent(priority: .obstacle, speech: "障碍"))
        a.finish()
        XCTAssertNil(a.current)
        XCTAssertTrue(a.shouldPlay(FeedbackEvent(priority: .environment, speech: "环境")))
    }

    func testPriorityOrdering() {
        XCTAssertTrue(FeedbackPriority.environment < .status)
        XCTAssertTrue(FeedbackPriority.turn < .obstacle)
    }
}
