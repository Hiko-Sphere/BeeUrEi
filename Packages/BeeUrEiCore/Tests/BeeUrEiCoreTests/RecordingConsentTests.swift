import XCTest
@testable import BeeUrEiCore

final class RecordingConsentTests: XCTestCase {
    private let consent = RecordingConsent()

    func testAllConsented() {
        XCTAssertTrue(consent.allConsented(parties: ["a", "b"], consented: ["a", "b"]))
    }

    func testMissingConsentBlocks() {
        XCTAssertFalse(consent.allConsented(parties: ["a", "b"], consented: ["a"]))
    }

    func testEmptyPartiesIsFalse() {
        XCTAssertFalse(consent.allConsented(parties: [], consented: ["a"]))
    }
}
