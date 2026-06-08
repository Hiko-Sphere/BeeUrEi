import XCTest
@testable import BeeUrEiCore

final class VerbosityPolicyTests: XCTestCase {
    let p = VerbosityPolicy()

    func testQuietOnlyDanger() {
        XCTAssertTrue(p.shouldSpeak(priority: .obstacle, verbosity: .quiet))
        XCTAssertFalse(p.shouldSpeak(priority: .turn, verbosity: .quiet))
        XCTAssertFalse(p.shouldSpeak(priority: .status, verbosity: .quiet))
        XCTAssertFalse(p.shouldSpeak(priority: .environment, verbosity: .quiet))
    }

    func testNormalTurnAndDanger() {
        XCTAssertTrue(p.shouldSpeak(priority: .obstacle, verbosity: .normal))
        XCTAssertTrue(p.shouldSpeak(priority: .turn, verbosity: .normal))
        XCTAssertFalse(p.shouldSpeak(priority: .status, verbosity: .normal))
        XCTAssertFalse(p.shouldSpeak(priority: .environment, verbosity: .normal))
    }

    func testFullAll() {
        for pr in [FeedbackPriority.environment, .status, .turn, .obstacle] {
            XCTAssertTrue(p.shouldSpeak(priority: pr, verbosity: .full))
        }
    }
}
