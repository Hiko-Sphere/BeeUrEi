import XCTest
@testable import BeeUrEiCore

/// 头/胸高悬空障碍分类：盲杖探不到的离地障碍要预警，盲杖够得着/头顶上方/太远的不报；护头措辞。
final class OverheadHazardTests: XCTestCase {
    let det = OverheadHazardDetector() // caneReach 0.3, userHeight 1.7, headBottom 1.4, warn 2.5

    func testHeadHeightBranchWarns() {
        // 树枝/招牌 1.6–2.5m，2m 远：离地、顶部够到头部带 → 护头预警。
        let h = det.classify(minHeightMeters: 1.6, maxHeightMeters: 2.5, distanceMeters: 2.0)
        XCTAssertEqual(h, .overhead(distanceMeters: 2.0, zone: .head))
        XCTAssertEqual(det.hint(h, language: .zh), "当心头部，前方约2米有高处障碍")
        XCTAssertTrue(det.hint(h, language: .en)!.contains("head-height"))
    }

    func testChestHeightShelfWarnsTorso() {
        // 突出的架子/半开车门 0.5–1.0m，1.5m：离地、顶部未及头部带 → 齐胸预警。
        let h = det.classify(minHeightMeters: 0.5, maxHeightMeters: 1.0, distanceMeters: 1.5)
        XCTAssertEqual(h, .overhead(distanceMeters: 1.5, zone: .torso))
        XCTAssertEqual(det.hint(h, language: .zh), "当心，前方约2米有齐胸障碍") // groundMeters 四舍五入 1.5→2
    }

    func testTopReachingHeadIsHeadZoneEvenIfBottomLow() {
        // 底部 1.0m 但顶部 1.6m 够到头部带：按**顶部**判为护头（更保守/更紧急），而非按底部判齐胸。
        let h = det.classify(minHeightMeters: 1.0, maxHeightMeters: 1.6, distanceMeters: 2.0)
        XCTAssertEqual(h, .overhead(distanceMeters: 2.0, zone: .head))
    }

    func testCaneReachableNotWarned() {
        // 椅子/杆子落地（0–0.9m 或 0–1.8m）：底部贴地，盲杖能发现 → 不重复预警（none）。
        XCTAssertEqual(det.classify(minHeightMeters: 0.0, maxHeightMeters: 0.9, distanceMeters: 1.5), .none)
        XCTAssertEqual(det.classify(minHeightMeters: 0.0, maxHeightMeters: 1.8, distanceMeters: 1.5), .none) // 落地长杆
        XCTAssertNil(det.hint(.none))
    }

    func testAboveHeadWalksUnder() {
        // 整体高过头顶（2.0–2.5m）：从下方穿过、不会撞 → none。
        XCTAssertEqual(det.classify(minHeightMeters: 2.0, maxHeightMeters: 2.5, distanceMeters: 1.5), .none)
    }

    func testTooFarNotWarned() {
        // 超警戒距离（>2.5m）不打扰。
        XCTAssertEqual(det.classify(minHeightMeters: 1.6, maxHeightMeters: 2.2, distanceMeters: 3.0), .none)
    }

    func testBoundaryCaneReachAndUserHeight() {
        // 底部恰在盲杖可达上沿(0.3) → 归盲杖(none)；底部略高于头顶(1.71) → 穿过(none)；恰在头顶(1.7) → 保守预警。
        XCTAssertEqual(det.classify(minHeightMeters: 0.3, maxHeightMeters: 1.5, distanceMeters: 2.0), .none)
        XCTAssertEqual(det.classify(minHeightMeters: 1.71, maxHeightMeters: 2.2, distanceMeters: 2.0), .none)
        if case .overhead = det.classify(minHeightMeters: 1.7, maxHeightMeters: 2.0, distanceMeters: 2.0) {} else {
            XCTFail("底部恰在头顶应保守预警")
        }
    }

    func testInvalidInputsAreConservativeNone() {
        // 非有限 / max≤min / 距离≤0 → none（绝不据坏几何误报「悬空」使盲人惊吓僵立）。
        XCTAssertEqual(det.classify(minHeightMeters: .nan, maxHeightMeters: 1.6, distanceMeters: 2.0), .none)
        XCTAssertEqual(det.classify(minHeightMeters: 1.0, maxHeightMeters: .infinity, distanceMeters: 2.0), .none)
        XCTAssertEqual(det.classify(minHeightMeters: 1.6, maxHeightMeters: 1.0, distanceMeters: 2.0), .none) // max<min
        XCTAssertEqual(det.classify(minHeightMeters: 1.6, maxHeightMeters: 2.0, distanceMeters: 0), .none)
        XCTAssertEqual(det.classify(minHeightMeters: 1.6, maxHeightMeters: 2.0, distanceMeters: -1), .none)
    }

    func testEnglishHasNoChinese() {
        for s in [SpokenStrings.overheadHead(metersStr: "2m", .en), SpokenStrings.overheadTorso(metersStr: "1m", .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }), "英文混中文：\(s)")
        }
    }
}
