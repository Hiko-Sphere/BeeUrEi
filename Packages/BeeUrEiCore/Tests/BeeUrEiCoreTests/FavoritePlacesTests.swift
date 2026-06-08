import XCTest
@testable import BeeUrEiCore

final class FavoritePlacesTests: XCTestCase {
    func testAddToEmpty() {
        XCTAssertEqual(FavoritePlaces.adding("超市", to: []), ["超市"])
    }

    func testAddDedupsAndMovesToFront() {
        XCTAssertEqual(FavoritePlaces.adding("A", to: ["B", "A", "C"]), ["A", "B", "C"])
    }

    func testCap() {
        let full = ["1", "2", "3"]
        XCTAssertEqual(FavoritePlaces.adding("4", to: full, cap: 3), ["4", "1", "2"])
    }

    func testEmptyNameIgnored() {
        XCTAssertEqual(FavoritePlaces.adding("  ", to: ["A"]), ["A"])
    }

    func testRemoving() {
        XCTAssertEqual(FavoritePlaces.removing("B", from: ["A", "B", "C"]), ["A", "C"])
    }
}
