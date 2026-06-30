import XCTest
@testable import BeeUrEiCore

/// 红绿灯判别的**安全不变量**回归网（过街是本 App 最高危场景）。
/// 既有 testTrafficLightClassify 只验证典型红/绿/黄/暗/灰；这里专门锁死"绝不把红判绿"
/// 与"非绿一律保守提示等待"——这两条若破，盲人可能在红灯时被告知通行。
final class TrafficLightSafetyTests: XCTestCase {
    private let c = TrafficLightClassifier()

    /// 致命不变量：红主导（r 明显高于 g）的任何颜色都**绝不**判为绿灯。
    /// 逻辑上可证（绿需 g-r>0.10，r≥g 时不可能成立），这里用大范围扫描守护它不被改坏。
    func testRedDominantNeverClassifiedGreen() {
        var samples = 0
        for ri in 3...10 {            // r = 0.30…1.00
            for gi in 0...10 {        // g = 0.00…1.00
                for bi in 0...10 {    // b = 0.00…1.00
                    let r = Double(ri) / 10, g = Double(gi) / 10, b = Double(bi) / 10
                    guard r >= g else { continue } // 红不弱于绿
                    XCTAssertNotEqual(c.classify(r: r, g: g, b: b), .green,
                                      "r=\(r) g=\(g) b=\(b) 红不弱于绿却判成了绿灯——致命")
                    samples += 1
                }
            }
        }
        XCTAssertGreaterThan(samples, 100) // 确实跑了足够多样本
    }

    /// 典型红灯色（亮红、低绿低蓝）判为红，绝不为绿。
    func testTypicalRedLights() {
        for (r, g, b) in [(0.9, 0.1, 0.1), (0.7, 0.2, 0.15), (0.6, 0.25, 0.2), (1.0, 0.05, 0.05)] {
            let s = c.classify(r: r, g: g, b: b)
            XCTAssertNotEqual(s, .green)
            XCTAssertEqual(s, .red, "r=\(r) g=\(g) b=\(b) 应判红灯")
        }
    }

    /// 保守提示：红/黄都必须给出"提示语"（让盲人知道要等待），unknown 绝不给虚假放行。
    func testHintIsConservative() {
        XCTAssertNotNil(c.hint(.red), "红灯必须有提示")
        XCTAssertNotNil(c.hint(.yellow), "黄灯必须有提示")
        XCTAssertNotNil(c.hint(.green), "绿灯有通行提示")
        XCTAssertNil(c.hint(.unknown), "未知不可给任何放行/等待暗示，交还上层")
        // 绿灯提示与红灯提示不可相同（否则等于把红当绿）。
        XCTAssertNotEqual(c.hint(.green), c.hint(.red))
    }

    /// 暗场景（最大通道≤0.22）一律 unknown，不冒险给红或绿。
    func testTooDarkIsUnknown() {
        XCTAssertEqual(c.classify(r: 0.2, g: 0.2, b: 0.2), .unknown)
        XCTAssertEqual(c.classify(r: 0.0, g: 0.0, b: 0.0), .unknown)
    }
}
