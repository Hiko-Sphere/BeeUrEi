import XCTest
@testable import BeeUrEiCore

/// 障碍逼近紧迫度：即将碰上时加"小心！"前导。误报（对静态障碍喊"小心"）会钝化警觉，
/// 漏报（快速逼近却平淡）更危险——故 TTC 边界与无效值从严测试。
final class ObstacleApproachTests: XCTestCase {

    func testImminentBelowThreshold() {
        // TTC 1.0s < 1.5s → imminent（快到了）。
        XCTAssertEqual(ObstacleApproach.classify(timeToCollisionSeconds: 1.0), .imminent)
        XCTAssertEqual(ObstacleApproach.classify(timeToCollisionSeconds: 0.2), .imminent)
    }

    func testNormalAtOrAboveThreshold() {
        // 恰 1.5s（不含）与更远 → normal（不制造紧迫感）。
        XCTAssertEqual(ObstacleApproach.classify(timeToCollisionSeconds: 1.5), .normal)
        XCTAssertEqual(ObstacleApproach.classify(timeToCollisionSeconds: 5.0), .normal)
    }

    func testInvalidTtcNeverImminent() {
        // 无 TTC（未在逼近/相对速度≤0）、负值、非有限 → 绝不 imminent（不凭空报警）。
        XCTAssertEqual(ObstacleApproach.classify(timeToCollisionSeconds: nil), .normal)
        XCTAssertEqual(ObstacleApproach.classify(timeToCollisionSeconds: -1), .normal)
        XCTAssertEqual(ObstacleApproach.classify(timeToCollisionSeconds: .nan), .normal)
        XCTAssertEqual(ObstacleApproach.classify(timeToCollisionSeconds: .infinity), .normal)
    }

    func testCustomThresholdScalesWithSpeed() {
        // 阈值可调（真机标定）：更激进阈值 0.8s 下，1.0s TTC 归 normal。
        XCTAssertEqual(ObstacleApproach.classify(timeToCollisionSeconds: 1.0, imminentBelow: 0.8), .normal)
    }

    func testLeadAndPrependingBilingual() {
        XCTAssertEqual(ObstacleApproach.imminent.lead(.zh), "小心！")
        XCTAssertNil(ObstacleApproach.normal.lead(.zh))
        // prepending：imminent 前置、normal 原样。
        XCTAssertEqual(ObstacleApproach.imminent.prepending("两点钟方向 椅子 约1.5米", language: .zh), "小心！两点钟方向 椅子 约1.5米")
        XCTAssertEqual(ObstacleApproach.normal.prepending("椅子", language: .zh), "椅子")
        let en = ObstacleApproach.imminent.prepending("chair", language: .en)
        XCTAssertEqual(en, "Careful — chair")
        XCTAssertFalse(en.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }))
    }
}
