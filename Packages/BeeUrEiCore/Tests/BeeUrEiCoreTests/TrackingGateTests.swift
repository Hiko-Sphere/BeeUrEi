import XCTest
@testable import BeeUrEiCore

final class TrackingGateTests: XCTestCase {

    private let gate = TrackingGate()

    func testModes() {
        XCTAssertEqual(gate.mode(for: .normal), .ranging)
        XCTAssertEqual(gate.mode(for: .limited(reason: .excessiveMotion)), .relative)
        XCTAssertEqual(gate.mode(for: .notAvailable), .suspended)
    }

    func testAdvisories() {
        XCTAssertNil(gate.advisory(for: .normal))
        XCTAssertEqual(gate.advisory(for: .limited(reason: .excessiveMotion)), "跟踪不稳，请放慢移动")
        XCTAssertEqual(gate.advisory(for: .limited(reason: .insufficientFeatures)), "环境特征不足，测距精度下降")
        XCTAssertEqual(gate.advisory(for: .notAvailable), "无法测距，避障已降级")
    }

    /// advisory 双语（修复前硬编码中文——这些是实时播报给行走中盲人的降级提示）。
    func testAdvisoriesBilingual() {
        func noChinese(_ s: String?) -> Bool {
            !(s ?? "").contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } })
        }
        for q: TrackingQuality in [.limited(reason: .excessiveMotion), .limited(reason: .insufficientFeatures),
                                   .limited(reason: .initializing), .limited(reason: .other), .notAvailable] {
            XCTAssertNotNil(gate.advisory(for: q, language: .en))
            XCTAssertTrue(noChinese(gate.advisory(for: q, language: .en)), "英文混中文：\(q)")
        }
        XCTAssertNil(gate.advisory(for: .normal, language: .en))
        // BeaconDirection 播报短语同口径双语（镜像 ClockDirection）。
        let b = BeaconDirection(headingDegrees: 0, bearingDegrees: 90)
        XCTAssertEqual(b.spokenPhrase, "3 点钟方向")               // 默认中文向后兼容
        XCTAssertEqual(b.spokenPhrase(in: .en), "3 o'clock")
    }
}
