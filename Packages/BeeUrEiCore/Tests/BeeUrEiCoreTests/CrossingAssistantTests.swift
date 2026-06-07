import XCTest
@testable import BeeUrEiCore

final class CrossingAssistantTests: XCTestCase {
    private let assistant = CrossingAssistant()

    func testHintWhenTrafficLightPresent() {
        XCTAssertEqual(assistant.hint(forLabels: ["红绿灯", "行人"]), "前方有红绿灯，请确认信号后再过街")
    }

    func testNoHintWithoutTrafficLight() {
        XCTAssertNil(assistant.hint(forLabels: ["行人", "车辆"]))
        XCTAssertNil(assistant.hint(forLabels: []))
    }
}
