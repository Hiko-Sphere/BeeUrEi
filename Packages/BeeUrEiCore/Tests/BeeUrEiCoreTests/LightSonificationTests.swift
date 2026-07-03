import XCTest
@testable import BeeUrEiCore

/// 连续光探测音调映射：越亮音越高越密，边界与坏输入安全。
final class LightSonificationTests: XCTestCase {
    func testBrighterIsHigherPitchAndDenser() {
        let dark = LightSonification.cue(brightness: 0.1)
        let bright = LightSonification.cue(brightness: 0.9)
        XCTAssertGreaterThan(bright.pitchHz, dark.pitchHz)                 // 越亮音越高
        XCTAssertLessThan(bright.beepIntervalSeconds, dark.beepIntervalSeconds) // 越亮越密
    }

    func testEndpoints() {
        let d = LightSonification.cue(brightness: 0)
        XCTAssertEqual(d.pitchHz, 300, accuracy: 0.001)
        XCTAssertEqual(d.beepIntervalSeconds, 0.5, accuracy: 0.001)
        let b = LightSonification.cue(brightness: 1)
        XCTAssertEqual(b.pitchHz, 1600, accuracy: 0.001)
        XCTAssertEqual(b.beepIntervalSeconds, 0.06, accuracy: 0.001)
    }

    func testMonotonicOverRange() {
        var lastPitch = -1.0
        for i in 0...10 {
            let c = LightSonification.cue(brightness: Double(i) / 10)
            XCTAssertGreaterThan(c.pitchHz, lastPitch) // 单调升，扫动时音高平滑变化无回跳
            lastPitch = c.pitchHz
        }
    }

    func testClampsOutOfRangeAndNonFinite() {
        // 越界夹到端点
        XCTAssertEqual(LightSonification.cue(brightness: -0.5).pitchHz, LightSonification.cue(brightness: 0).pitchHz)
        XCTAssertEqual(LightSonification.cue(brightness: 2).pitchHz, LightSonification.cue(brightness: 1).pitchHz)
        // 非有限（坏采样）当全黑处理，不产生 NaN 音高（否则 AVAudio 会炸/静默）
        for bad in [Double.nan, .infinity, -.infinity] {
            let c = LightSonification.cue(brightness: bad)
            XCTAssertTrue(c.pitchHz.isFinite && c.beepIntervalSeconds.isFinite)
            XCTAssertEqual(c.pitchHz, 300, accuracy: 0.001) // 当 0 处理
        }
    }
}
