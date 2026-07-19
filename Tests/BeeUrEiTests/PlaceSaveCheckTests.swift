import XCTest
@testable import BeeUrEi

/// 自定义地点保存前检查（与 web iter141 同语义）。判错的后果：
/// - 撞名不警 → 静默覆盖别的围栏（"医院"盖掉"女儿家"的地址，到达播报指向错误地点）；
/// - 改名不删旧 → 重复围栏（旧地址还在，到旧址仍播"你到家了"——假位置确认，导航攸关）。
final class PlaceSaveCheckTests: XCTestCase {

    /// 「回家/去公司」保存地点解析：步行与公交**共用**，未设置该地点时给清晰"未设置"（绝不退回字面词让 amap 报"找不到目的地"）。
    func testSavedPlaceRoutingResolve() {
        func place(_ label: String, _ address: String) -> APIClient.SavedPlace {
            APIClient.SavedPlace(ownerId: "me", label: label, address: address, lat: nil, lng: nil, updatedAt: 0)
        }
        let places = [place("home", "北京市朝阳区XX路5号"), place("work", "  "), place("医院", "协和医院")]
        // 存了地址 → .address（导航/公交用它）。
        XCTAssertEqual(SavedPlaceRouting.resolve(label: "home", places: places), .address("北京市朝阳区XX路5号"))
        // 地址为纯空白（未真正设置）→ .notSet（isHome=false，work）。
        XCTAssertEqual(SavedPlaceRouting.resolve(label: "work", places: places), .notSet(isHome: false))
        // 该 label 不存在（从没设过家）→ .notSet(isHome: true)——公交侧据此给"你还没设置家的地址"，绝不退回字面"家"。
        XCTAssertEqual(SavedPlaceRouting.resolve(label: "home", places: [place("work", "某地址")]), .notSet(isHome: true))
        // 空地点列表 → .notSet（按 label 判 isHome）。
        XCTAssertEqual(SavedPlaceRouting.resolve(label: "work", places: []), .notSet(isHome: false))
    }

    func testUnchangedLabelEditsInPlace() {
        // 同名编辑（就地改址）→ ok，无需任何确认。
        XCTAssertEqual(PlaceSaveCheck.check(newLabel: "医院", originalLabel: "医院", existing: ["医院", "home"]), .ok)
    }

    func testNewPlaceWithFreshNameIsOk() {
        XCTAssertEqual(PlaceSaveCheck.check(newLabel: "超市", originalLabel: nil, existing: ["医院", "home", "work"]), .ok)
    }

    func testDuplicateNameNeedsConfirm() {
        // 新建撞已有名（含内置 home/work——覆盖家的围栏更危险）→ 须二次确认。
        XCTAssertEqual(PlaceSaveCheck.check(newLabel: "医院", originalLabel: nil, existing: ["医院"]), .duplicateName)
        XCTAssertEqual(PlaceSaveCheck.check(newLabel: "home", originalLabel: nil, existing: ["home", "work"]), .duplicateName)
        // 编辑中把名字改成另一个已有名 → 同样撞名。
        XCTAssertEqual(PlaceSaveCheck.check(newLabel: "超市", originalLabel: "医院", existing: ["医院", "超市"]), .duplicateName)
    }

    func testRenameRequiresOldCleanup() {
        // 编辑中改成全新名字：(owner,label) 复合键=改名即新建 → 须删旧条防重复围栏。
        XCTAssertEqual(PlaceSaveCheck.check(newLabel: "新医院", originalLabel: "医院", existing: ["医院", "home"]),
                       .renames(from: "医院"))
    }

    func testStringsBilingual() {
        XCTAssertTrue(SettingsStrings.duplicateNameWarning("医院", .zh).contains("覆盖"))
        for s in [SettingsStrings.customPlacesHeader(.en), SettingsStrings.addPlace(.en), SettingsStrings.updatePlace(.en),
                  SettingsStrings.confirmOverwrite(.en), SettingsStrings.duplicateNameWarning("Hospital", .en)] {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
