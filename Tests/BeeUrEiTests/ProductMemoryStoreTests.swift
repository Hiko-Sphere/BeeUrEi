import XCTest
@testable import BeeUrEi

/// 本地商品库（扫码认商品）：存取/覆盖/删除/落盘重载。
final class ProductMemoryStoreTests: XCTestCase {
    private var fileURL: URL!

    override func setUp() {
        super.setUp()
        fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("product-memory-test-\(UUID().uuidString).plist")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: fileURL)
        try? FileManager.default.removeItem(at: fileURL.deletingPathExtension().appendingPathExtension("allergens.plist"))
        super.tearDown()
    }

    func testAllergensRoundTripAndRenamePreserves() {
        let store = ProductMemoryStore(fileURL: fileURL)
        store.save(barcode: "690", name: "饼干", allergens: ["wheat", "milk"])
        XCTAssertEqual(store.allergens(for: "690"), ["wheat", "milk"])
        // 用户手动改名（默认空 allergens）不得抹掉已存的过敏原标注。
        store.save(barcode: "690", name: "我的饼干")
        XCTAssertEqual(store.name(for: "690"), "我的饼干")
        XCTAssertEqual(store.allergens(for: "690"), ["wheat", "milk"])
        // 落盘重载后过敏原仍在；删除连带清。
        let reloaded = ProductMemoryStore(fileURL: fileURL)
        XCTAssertEqual(reloaded.allergens(for: "690"), ["wheat", "milk"])
        reloaded.delete(barcode: "690")
        XCTAssertEqual(reloaded.allergens(for: "690"), [])
        // 无数据 = 空数组（缺数据≠不含，上层只在非空时播）。
        XCTAssertEqual(store.allergens(for: "unknown"), [])
    }

    func testLegacyNameOnlyFileStillLoads() {
        // 老版本只有名字 plist（无 allergens 旁路文件）：名字照常、过敏原为空——零迁移。
        let legacy = ["123": "酱油"]
        try? PropertyListEncoder().encode(legacy).write(to: fileURL)
        let store = ProductMemoryStore(fileURL: fileURL)
        XCTAssertEqual(store.name(for: "123"), "酱油")
        XCTAssertEqual(store.allergens(for: "123"), [])
    }

    func testSaveAndLookup() {
        let store = ProductMemoryStore(fileURL: fileURL)
        store.save(barcode: "6901234567892", name: "  牛奶  ")
        XCTAssertEqual(store.name(for: "6901234567892"), "牛奶") // 名字去首尾空白
        XCTAssertNil(store.name(for: "0000000000000"))
    }

    func testEmptyNameOrBarcodeIgnored() {
        let store = ProductMemoryStore(fileURL: fileURL)
        store.save(barcode: "123", name: "   ")
        store.save(barcode: "", name: "酱油")
        XCTAssertEqual(store.count, 0)
    }

    func testOverwriteAndDelete() {
        let store = ProductMemoryStore(fileURL: fileURL)
        store.save(barcode: "123", name: "旧名")
        store.save(barcode: "123", name: "新名")
        XCTAssertEqual(store.name(for: "123"), "新名")
        store.delete(barcode: "123")
        XCTAssertNil(store.name(for: "123"))
    }

    func testPersistsAcrossReload() {
        ProductMemoryStore(fileURL: fileURL).save(barcode: "6901234567892", name: "牛奶")
        let reloaded = ProductMemoryStore(fileURL: fileURL)
        XCTAssertEqual(reloaded.name(for: "6901234567892"), "牛奶")
    }
}
