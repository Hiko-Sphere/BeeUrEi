import XCTest
@testable import BeeUrEiCore

/// 八方位命名：各扇区中心/边界正确、环绕/负角归一、非有限不崩溃返回 nil。
final class CompassRoseTests: XCTestCase {
    func testEightSectorsCenters() {
        XCTAssertEqual(CompassRose.cardinal(degrees: 0, language: .zh), "正北")
        XCTAssertEqual(CompassRose.cardinal(degrees: 45, language: .zh), "东北")
        XCTAssertEqual(CompassRose.cardinal(degrees: 90, language: .zh), "正东")
        XCTAssertEqual(CompassRose.cardinal(degrees: 135, language: .zh), "东南")
        XCTAssertEqual(CompassRose.cardinal(degrees: 180, language: .zh), "正南")
        XCTAssertEqual(CompassRose.cardinal(degrees: 225, language: .zh), "西南")
        XCTAssertEqual(CompassRose.cardinal(degrees: 270, language: .zh), "正西")
        XCTAssertEqual(CompassRose.cardinal(degrees: 315, language: .zh), "西北")
    }

    func testSectorBoundariesAndWrap() {
        // 每 45° 扇区以正方位为中心：北 = [337.5, 22.5)。
        XCTAssertEqual(CompassRose.cardinal(degrees: 22, language: .zh), "正北")
        XCTAssertEqual(CompassRose.cardinal(degrees: 23, language: .zh), "东北")   // 越过 22.5 边界
        XCTAssertEqual(CompassRose.cardinal(degrees: 359, language: .zh), "正北")  // 环绕回北
        XCTAssertEqual(CompassRose.cardinal(degrees: 720, language: .zh), "正北")  // 多圈归一
        XCTAssertEqual(CompassRose.cardinal(degrees: -45, language: .zh), "西北")  // 负角 = 315°
    }

    func testEnglishNames() {
        XCTAssertEqual(CompassRose.cardinal(degrees: 0, language: .en), "north")
        XCTAssertEqual(CompassRose.cardinal(degrees: 135, language: .en), "south-east")
        XCTAssertEqual(CompassRose.cardinal(degrees: 315, language: .en), "north-west")
    }

    func testNonFiniteReturnsNilNotCrash() {
        // 关键：Int(Double.nan) 会陷阱崩溃——必须先 isFinite 守卫，返回 nil 让调用方降级。
        XCTAssertNil(CompassRose.cardinal(degrees: .nan, language: .zh))
        XCTAssertNil(CompassRose.cardinal(degrees: .infinity, language: .zh))
        XCTAssertNil(CompassRose.cardinal(degrees: -.infinity, language: .en))
    }
}
