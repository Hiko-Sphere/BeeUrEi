import XCTest
@testable import BeeUrEiCore

final class DisclaimerPolicyTests: XCTestCase {

    private let policy = DisclaimerPolicy(reaffirmIntervalDays: 30)

    func testNeverAcceptedRequiresFullConsent() {
        XCTAssertEqual(policy.requirement(hasEverAccepted: false, daysSinceLastAcceptance: 0),
                       .fullConsentRequired)
    }

    func testRecentlyAcceptedShowsBriefReminder() {
        XCTAssertEqual(policy.requirement(hasEverAccepted: true, daysSinceLastAcceptance: 5),
                       .briefReminder)
    }

    func testExpiredRequiresFullConsentAgain() {
        XCTAssertEqual(policy.requirement(hasEverAccepted: true, daysSinceLastAcceptance: 31),
                       .fullConsentRequired)
    }

    func testBoundaryAtIntervalRequiresFull() {
        XCTAssertEqual(policy.requirement(hasEverAccepted: true, daysSinceLastAcceptance: 30),
                       .fullConsentRequired)
    }
}
