import XCTest
@testable import BeeUrEiCore

final class WhereAmIComposerTests: XCTestCase {
    private func lm(_ name: String, _ dir: String, _ dist: Double) -> ReverseGeocode.Landmark {
        ReverseGeocode.Landmark(name: name, direction: dir, distanceMeters: dist)
    }

    func testAddressPlusLandmarkZh() {
        let g = ReverseGeocode(address: "北京市朝阳区呼家楼街道景华南街5号", township: "呼家楼街道",
                               landmark: lm("银泰中心", "东", 50))
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .zh),
                       "你大概在：北京市朝阳区呼家楼街道景华南街5号。最近的地标：银泰中心，东约50米")
    }

    func testAddressPlusLandmarkEnTranslatesDirectionKeepsChineseAddress() {
        // 英文界面：框架语与方位翻译，但中文街道原文保留（要念给出租车司机）。
        let g = ReverseGeocode(address: "北京市朝阳区景华南街5号", township: "呼家楼街道",
                               landmark: lm("银泰中心", "东北", 120))
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .en),
                       "You're near: 北京市朝阳区景华南街5号. Nearest landmark: 银泰中心, northeast about 120 meters")
    }

    func testFallsBackToTownshipWhenNoFormattedAddress() {
        let g = ReverseGeocode(address: "", township: "呼家楼街道", landmark: nil)
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .zh), "你大概在：呼家楼街道")
    }

    func testUnknownDirectionOmittedNotSpoken() {
        // 方位为空/异常：省略方位词，不外泄脏数据（英文侧尤其不能念中文原文）。
        let gEmpty = ReverseGeocode(address: "某地", township: "", landmark: lm("地标A", "", 30))
        XCTAssertEqual(WhereAmIComposer.compose(gEmpty, language: .zh), "你大概在：某地。最近的地标：地标A，约30米")
        let gWeird = ReverseGeocode(address: "somewhere", township: "", landmark: lm("Mall", "偏北", 30))
        XCTAssertEqual(WhereAmIComposer.compose(gWeird, language: .en),
                       "You're near: somewhere. Nearest landmark: Mall, about 30 meters")
    }

    func testLandmarkOnlyNoAddress() {
        // 只有地标、无地址：直接起句不带"。"前缀。
        let g = ReverseGeocode(address: "", township: "", landmark: lm("人民广场", "南", 80))
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .zh), "最近的地标：人民广场，南约80米")
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .en), "Nearest landmark: 人民广场, south about 80 meters")
    }

    func testEmptyEverythingSaysCannotDetermine() {
        let g = ReverseGeocode(address: "", township: "", landmark: nil)
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .zh), "无法确定当前位置")
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .en), "Can't determine your location")
    }

    func testNormalizesZhengPrefixDirection() {
        let g = ReverseGeocode(address: "某地", township: "", landmark: lm("塔", "正东", 15))
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .zh), "你大概在：某地。最近的地标：塔，东约15米")
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .en), "You're near: 某地. Nearest landmark: 塔, east about 15 meters")
    }

    func testFarLandmarkUsesKilometers() {
        // ≥1km 的地标（rural/sparse）用公里表达，读屏更易听懂量级（"约1.5公里"胜过"约1500米"）。
        let g = ReverseGeocode(address: "某镇", township: "", landmark: lm("加油站", "西", 1500))
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .zh), "你大概在：某镇。最近的地标：加油站，西约1.5公里")
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .en), "You're near: 某镇. Nearest landmark: 加油站, west about 1.5 kilometers")
        // 整公里去尾零：2000m → 2公里（非 2.0）。
        let g2 = ReverseGeocode(address: "某镇", township: "", landmark: lm("水塔", "北", 2000))
        XCTAssertEqual(WhereAmIComposer.compose(g2, language: .zh), "你大概在：某镇。最近的地标：水塔，北约2公里")
    }

    func testHugeDistanceDoesNotCrash() {
        // 距离来自网络：巨值不得让 Int(Double) 陷阱崩溃（safeRoundedInt 夹紧）。
        let g = ReverseGeocode(address: "某地", township: "", landmark: lm("远处", "东", 1e19))
        XCTAssertNoThrow(WhereAmIComposer.compose(g, language: .zh))
        // 夹到上限 1_000_000 米 = 1000 公里（locationDistance 换算）。
        XCTAssertEqual(WhereAmIComposer.compose(g, language: .zh), "你大概在：某地。最近的地标：远处，东约1000公里")
    }

    func testDecodableMatchesServerContract() throws {
        // 服务端 /api/nav/whereami 的 JSON（landmark 可缺省）能被 Decodable 正确解出。
        let json = """
        {"address":"北京市朝阳区景华南街5号","township":"呼家楼街道",
         "landmark":{"name":"银泰中心","direction":"东","distanceMeters":50}}
        """.data(using: .utf8)!
        let g = try JSONDecoder().decode(ReverseGeocode.self, from: json)
        XCTAssertEqual(g.address, "北京市朝阳区景华南街5号")
        XCTAssertEqual(g.landmark?.name, "银泰中心")
        XCTAssertEqual(g.landmark?.distanceMeters, 50)
        // landmark 缺省也能解。
        let json2 = #"{"address":"x","township":"y"}"#.data(using: .utf8)!
        let g2 = try JSONDecoder().decode(ReverseGeocode.self, from: json2)
        XCTAssertNil(g2.landmark)
    }
}
