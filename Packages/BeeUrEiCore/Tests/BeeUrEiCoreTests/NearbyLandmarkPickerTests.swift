import XCTest
@testable import BeeUrEiCore

/// 沿途地标选择：取最近合格候选 / 半径外排除 / 去重去空白 / 坏数据不选。
final class NearbyLandmarkPickerTests: XCTestCase {
    typealias C = NearbyLandmarkPicker.Candidate

    func testPicksNearestNotFirstListed() {
        // 首个（相关性排序）是远处大 POI，后面有更近的——应选最近的那个。
        let name = NearbyLandmarkPicker.pick([
            C(name: "远处大商场", distanceMeters: 55),
            C(name: "路口便利店", distanceMeters: 12),
            C(name: "小公园", distanceMeters: 30),
        ], lastAnnounced: nil)
        XCTAssertEqual(name, "路口便利店")
    }

    func testFirstNamedOutOfRangeDoesNotHideCloserCandidate() {
        // 首个有名候选在半径外（旧写法会因它整帧放弃）；列表后面有半径内的更近候选，应被选中。
        let name = NearbyLandmarkPicker.pick([
            C(name: "范围外地标", distanceMeters: 75),   // > 60，旧代码选中它再判距离→整帧 return
            C(name: "范围内地标", distanceMeters: 40),
        ], lastAnnounced: nil, maxMeters: 60)
        XCTAssertEqual(name, "范围内地标")
    }

    func testExcludesLastAnnouncedAndPicksNextNearest() {
        let name = NearbyLandmarkPicker.pick([
            C(name: "已播地标", distanceMeters: 10),   // 与上次相同，跳过（即便最近）
            C(name: "新地标", distanceMeters: 25),
        ], lastAnnounced: "已播地标")
        XCTAssertEqual(name, "新地标")
    }

    func testTrimsWhitespaceAndDedupesPaddedVariant() {
        XCTAssertEqual(NearbyLandmarkPicker.pick([C(name: "  中心广场  ", distanceMeters: 20)], lastAnnounced: nil), "中心广场")
        // 带空白变体与上次去空白后相同 → 不重复选。
        XCTAssertNil(NearbyLandmarkPicker.pick([C(name: " 中心广场 ", distanceMeters: 20)], lastAnnounced: "中心广场"))
    }

    func testIgnoresBadCandidates() {
        // 纯空白名 / nil 名 / 非有限或负距离 / 超半径 一律不选。
        XCTAssertNil(NearbyLandmarkPicker.pick([
            C(name: "   ", distanceMeters: 5),
            C(name: nil, distanceMeters: 5),
            C(name: "无穷远", distanceMeters: .infinity),
            C(name: "负距离", distanceMeters: -3),
            C(name: "太远", distanceMeters: 200),
        ], lastAnnounced: nil, maxMeters: 60))
    }

    func testEmptyCandidatesReturnsNil() {
        XCTAssertNil(NearbyLandmarkPicker.pick([], lastAnnounced: nil))
    }

    func testBadMaxMetersReturnsNil() {
        XCTAssertNil(NearbyLandmarkPicker.pick([C(name: "地标", distanceMeters: 10)], lastAnnounced: nil, maxMeters: .nan))
    }
}
