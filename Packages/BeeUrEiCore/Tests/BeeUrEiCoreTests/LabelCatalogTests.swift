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

    func testUnknownFallsBackToOriginal() {
        XCTAssertEqual(catalog.localizedName("zebra"), "zebra")
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
