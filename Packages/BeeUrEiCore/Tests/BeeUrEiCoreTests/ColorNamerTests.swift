import XCTest
@testable import BeeUrEiCore

final class ColorNamerTests: XCTestCase {
    let n = ColorNamer()

    func testPrimaries() {
        XCTAssertEqual(n.name(r: 1, g: 0, b: 0), "红色")
        XCTAssertEqual(n.name(r: 0, g: 1, b: 0), "绿色")
        XCTAssertEqual(n.name(r: 0, g: 0, b: 1), "蓝色")
        XCTAssertEqual(n.name(r: 1, g: 1, b: 0), "黄色")
    }

    func testNeutrals() {
        XCTAssertEqual(n.name(r: 1, g: 1, b: 1), "白色")
        XCTAssertEqual(n.name(r: 0, g: 0, b: 0), "黑色")
        XCTAssertEqual(n.name(r: 0.5, g: 0.5, b: 0.5), "灰色")
    }

    func testBrown() {
        // 暗橙 → 棕
        XCTAssertEqual(n.name(r: 0.5, g: 0.3, b: 0.1), "棕色")
    }

    /// 深浅描述（配衣服/比色刚需）：以参考色标定——navy/深红/墨绿→深；天蓝/浅绿→浅；纯色→原名。
    func testTonedDescribe() {
        // 深色（明度低）
        XCTAssertEqual(n.describe(r: 0, g: 0, b: 128/255.0), "深蓝色")            // navy #000080
        XCTAssertEqual(n.describe(r: 139/255.0, g: 0, b: 0), "深红色")            // dark red #8B0000
        XCTAssertEqual(n.describe(r: 0, g: 100/255.0, b: 0), "深绿色")            // dark green #006400
        // 浅色（明亮且不太饱和）
        XCTAssertEqual(n.describe(r: 144/255.0, g: 238/255.0, b: 144/255.0), "浅绿色") // light green #90EE90
        XCTAssertEqual(n.describe(r: 135/255.0, g: 206/255.0, b: 235/255.0, language: .zh).hasPrefix("浅"), true) // sky blue 偏浅
        // 纯色/普通 → 与 name 相同（无深浅前缀）
        XCTAssertEqual(n.describe(r: 1, g: 0, b: 0), "红色")
        XCTAssertEqual(n.describe(r: 0, g: 0, b: 1), "蓝色")
        // 中性色不加深浅前缀
        XCTAssertEqual(n.describe(r: 0, g: 0, b: 0), "黑色")
        XCTAssertEqual(n.describe(r: 0.5, g: 0.5, b: 0.5), "灰色")
        // 英文带空格
        XCTAssertEqual(n.describe(r: 0, g: 0, b: 128/255.0, language: .en), "dark blue")
        XCTAssertEqual(n.describe(r: 1, g: 0, b: 0, language: .en), "red")
    }

    func testToneEnum() {
        XCTAssertEqual(n.tone(r: 0, g: 0, b: 128/255.0), .dark)   // navy
        XCTAssertEqual(n.tone(r: 1, g: 0, b: 0), .normal)         // 纯红
        XCTAssertEqual(n.tone(r: 144/255.0, g: 238/255.0, b: 144/255.0), .light) // 浅绿
        XCTAssertEqual(n.tone(r: 0, g: 0, b: 0), .normal)        // 黑（中性不判深浅）
    }
}
