import XCTest
@testable import BeeUrEiCore

final class LabelCatalogTests: XCTestCase {

    private let catalog = LabelCatalog()

    func testKnownLabelsTranslate() {
        XCTAssertEqual(catalog.localizedName("person"), "行人")
        XCTAssertEqual(catalog.localizedName("car"), "车辆")
        XCTAssertEqual(catalog.localizedName("fire hydrant"), "消火栓")
    }

    func testCaseInsensitive() {
        XCTAssertEqual(catalog.localizedName("Person"), "行人")
        XCTAssertEqual(catalog.localizedName("CAR"), "车辆")
    }

    func testFullCocoCovered() {
        // COCO-80 应全覆盖，不再漏 keyboard 等导致英文混入播报。
        XCTAssertEqual(catalog.localizedName("keyboard"), "键盘")
        XCTAssertEqual(catalog.localizedName("laptop"), "笔记本电脑")
        XCTAssertEqual(catalog.localizedName("zebra"), "斑马")
        XCTAssertEqual(catalog.localizedName("cell phone"), "手机")
    }

    func testUnknownFallsBackToChineseGeneric() {
        // 非 COCO 未知标签回退中文通用词，绝不返回英文。
        XCTAssertEqual(catalog.localizedName("xyzunknown"), "障碍物")
        XCTAssertFalse(catalog.localizedName("randomthing").contains { $0.isLetter && $0.isASCII })
    }

    func testTranslatedHazardsTriggerBoost() {
        // 翻译后的中文名应命中 HazardCatalog 的高危加成。
        let hazard = HazardCatalog()
        XCTAssertTrue(hazard.isHighRisk(catalog.localizedName("car")))        // 车辆
        XCTAssertTrue(hazard.isHighRisk(catalog.localizedName("motorcycle"))) // 摩托车
        XCTAssertTrue(hazard.isHighRisk(catalog.localizedName("bus")))        // 公交车
        XCTAssertFalse(hazard.isHighRisk(catalog.localizedName("cat")))       // 猫（非高危）
    }

    func testUnknownObstacleIsHighRiskInBothLanguages() {
        // 未识别障碍（中文回退"障碍物"/英文"obstacle"）两种语言都应命中高危加成——否则中文用户
        // 漏掉"不认识但挡路"的危险（修复前 HazardCatalog 中文侧是"障碍"≠LabelCatalog 的"障碍物"）。
        let zhLabel = LabelCatalog(language: .zh), zhHazard = HazardCatalog(language: .zh)
        XCTAssertTrue(zhHazard.isHighRisk(zhLabel.localizedName("xyzunknown"))) // 障碍物
        let enLabel = LabelCatalog(language: .en), enHazard = HazardCatalog(language: .en)
        XCTAssertTrue(enHazard.isHighRisk(enLabel.localizedName("xyzunknown"))) // obstacle
    }

    func testDoorAndCurbHighRiskInBothLanguages() {
        // 门(door)/路沿(curb)在两语言都应命中高危——修复前中文侧只有"玻璃门"、且缺"路沿"，
        // 检测到的门/路沿在中文侧漏高危加成，而英文侧("door"/"curb")命中。
        let zhL = LabelCatalog(language: .zh), zhH = HazardCatalog(language: .zh)
        XCTAssertTrue(zhH.isHighRisk(zhL.localizedName("door")))  // 门
        XCTAssertTrue(zhH.isHighRisk(zhL.localizedName("curb")))  // 路沿
        let enL = LabelCatalog(language: .en), enH = HazardCatalog(language: .en)
        XCTAssertTrue(enH.isHighRisk(enL.localizedName("door")))  // door
        XCTAssertTrue(enH.isHighRisk(enL.localizedName("curb")))  // curb
    }
}
