import XCTest
@testable import BeeUrEiCore

/// 光线探测频道（等级+亮源方向+中英）与相机 FOV 计算。
final class LightAndFOVTests: XCTestCase {
    let m = LightMeter()

    func testBrighterSide() {
        XCTAssertEqual(LightMeter.brighterSide(left: 0.5, right: 0.3), .left)
        XCTAssertEqual(LightMeter.brighterSide(left: 0.2, right: 0.6), .right)
        XCTAssertEqual(LightMeter.brighterSide(left: 0.4, right: 0.45), .even) // 差值 < 0.08 视为均匀
    }

    func testDescriptionZh() {
        XCTAssertEqual(m.description(brightness: 0.6, brighterSide: .even), "光线充足")
        XCTAssertEqual(m.description(brightness: 0.1, brighterSide: .left), "光线很暗，亮的方向在左边")
        XCTAssertEqual(m.description(brightness: 0.2, brighterSide: .right), "光线较暗，亮的方向在右边")
    }

    func testDescriptionEn() {
        XCTAssertEqual(m.description(brightness: 0.6, brighterSide: .even, language: .en), "Light is good")
        XCTAssertEqual(m.description(brightness: 0.1, brighterSide: .left, language: .en),
                       "It's dark, brighter to the left")
    }

    func testWarningLocalized() {
        XCTAssertEqual(m.warning(brightness: 0.1), "光线太暗，可能看不清，请到亮一点的地方再试") // 中文与历史一致
        XCTAssertEqual(m.warning(brightness: 0.1, language: .en),
                       "Too dark to see well — try again in a brighter place")
        XCTAssertNil(m.warning(brightness: 0.6, language: .en))
    }

    func testCameraFOV() {
        // iPhone 后置广角典型内参：fx≈1450、宽 1920 → ≈67°
        let fov = CameraFOV.horizontalDegrees(fx: 1450, imageWidth: 1920)
        XCTAssertEqual(fov, 67.0, accuracy: 1.0)
        // 非法输入回退 68
        XCTAssertEqual(CameraFOV.horizontalDegrees(fx: 0, imageWidth: 1920), 68)
        XCTAssertEqual(CameraFOV.horizontalDegrees(fx: .nan, imageWidth: 1920), 68)
    }
}
