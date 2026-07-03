import XCTest
@testable import BeeUrEiCore

final class VerbosityAdjustTests: XCTestCase {
    func testStepAndClamp() {
        XCTAssertEqual(FeedbackVerbosity.full.adjusted(.terser), .normal)
        XCTAssertEqual(FeedbackVerbosity.normal.adjusted(.terser), .quiet)
        XCTAssertEqual(FeedbackVerbosity.quiet.adjusted(.terser), .quiet)      // 夹底
        XCTAssertEqual(FeedbackVerbosity.quiet.adjusted(.moreDetail), .normal)
        XCTAssertEqual(FeedbackVerbosity.normal.adjusted(.moreDetail), .full)
        XCTAssertEqual(FeedbackVerbosity.full.adjusted(.moreDetail), .full)    // 夹顶
    }
    func testAtLimit() {
        XCTAssertTrue(FeedbackVerbosity.full.atLimit(.moreDetail))
        XCTAssertFalse(FeedbackVerbosity.full.atLimit(.terser))
        XCTAssertTrue(FeedbackVerbosity.quiet.atLimit(.terser))
        XCTAssertFalse(FeedbackVerbosity.quiet.atLimit(.moreDetail))
        XCTAssertFalse(FeedbackVerbosity.normal.atLimit(.terser))
        XCTAssertFalse(FeedbackVerbosity.normal.atLimit(.moreDetail))
    }
}
