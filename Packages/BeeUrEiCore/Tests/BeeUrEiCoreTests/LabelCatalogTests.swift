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

    func testSidewalkFurnitureHighRiskBothLanguages() {
        // 椅子(chair)/盆栽(potted plant)：与 bench 同类的人行道齐腰高固定障碍，两语言都应命中高危加成
        // （经 localizedName 真流程：chair→椅子/chair、potted plant→盆栽/potted plant）。此前唯独漏此二类高危加成。
        let zhL = LabelCatalog(language: .zh), zhH = HazardCatalog(language: .zh)
        XCTAssertTrue(zhH.isHighRisk(zhL.localizedName("chair")))          // 椅子
        XCTAssertTrue(zhH.isHighRisk(zhL.localizedName("potted plant")))   // 盆栽
        XCTAssertTrue(zhH.isHighRisk(zhL.localizedName("dining table")))   // 餐桌（硬边齐腰，比椅子更易撞伤）
        let enL = LabelCatalog(language: .en), enH = HazardCatalog(language: .en)
        XCTAssertTrue(enH.isHighRisk(enL.localizedName("chair")))
        XCTAssertTrue(enH.isHighRisk(enL.localizedName("potted plant")))
        XCTAssertTrue(enH.isHighRisk(enL.localizedName("dining table")))   // → "table"
        // 回归：非障碍（猫）仍非高危，确认没把"所有物体"误升为高危。
        XCTAssertFalse(zhH.isHighRisk(zhL.localizedName("cat")))
        XCTAssertFalse(enH.isHighRisk(enL.localizedName("cat")))
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

    /// 跟踪分组：车辆/卡车/公交车/摩托车（中英名）互为同组，别的不跨组——供 ObstacleTracker 关联门
    /// 吸收 YOLO 类别抖动，避免逼近车辆被碎成多轨（距离低估的假安心）。
    func testSameTrackingGroupForMotorVehicles() {
        XCTAssertTrue(LabelCatalog.sameTrackingGroup("车辆", "卡车"))
        XCTAssertTrue(LabelCatalog.sameTrackingGroup("公交车", "摩托车"))
        XCTAssertTrue(LabelCatalog.sameTrackingGroup("vehicle", "bus"))   // 英文名同样成组
        XCTAssertTrue(LabelCatalog.sameTrackingGroup("行人", "行人"))      // 相等恒同组
        XCTAssertFalse(LabelCatalog.sameTrackingGroup("车辆", "行人"))     // 车 vs 人：不同组，不合并
        XCTAssertFalse(LabelCatalog.sameTrackingGroup("椅子", "卡车"))     // 椅子 vs 车：不同组
    }
}
