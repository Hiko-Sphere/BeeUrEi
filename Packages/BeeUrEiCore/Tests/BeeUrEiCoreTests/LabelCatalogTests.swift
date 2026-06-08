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
}
