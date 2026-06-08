import XCTest
@testable import BeeUrEiCore

final class SceneSummarizerTests: XCTestCase {
    let s = SceneSummarizer()

    func testEmpty() {
        XCTAssertEqual(s.summary(objects: []), "前方没有识别到明显物体")
    }

    func testSingleCenter() {
        XCTAssertEqual(s.summary(objects: [("行人", 0.5)]), "前方：中间有行人")
    }

    func testThreeZones() {
        let out = s.summary(objects: [("椅子", 0.1), ("行人", 0.5), ("桌子", 0.9)])
        XCTAssertEqual(out, "前方：中间有行人，左边有椅子，右边有桌子")
    }

    func testCounts() {
        XCTAssertEqual(s.summary(objects: [("行人", 0.5), ("行人", 0.55)]), "前方：中间有2个行人")
    }
}
