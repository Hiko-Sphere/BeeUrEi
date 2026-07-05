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
        for ext in ["allergens.plist", "traces.plist", "nutri.plist", "nova.plist"] {
            try? FileManager.default.removeItem(at: fileURL.deletingPathExtension().appendingPathExtension(ext))
        }
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

    func testTracesRoundTripSeparateFromAllergensAndRenamePreserves() {
        let store = ProductMemoryStore(fileURL: fileURL)
        // allergens=确定含、traces=可能含微量，分开存取（语义不同）。
        store.save(barcode: "690", name: "巧克力", allergens: ["milk"], traces: ["peanuts", "nuts"])
        XCTAssertEqual(store.allergens(for: "690"), ["milk"])
        XCTAssertEqual(store.traces(for: "690"), ["peanuts", "nuts"])
        // 手动改名（默认空）不得抹掉已存的微量标注。
        store.save(barcode: "690", name: "我的巧克力")
        XCTAssertEqual(store.traces(for: "690"), ["peanuts", "nuts"])
        // 落盘重载后微量标注仍在；删除连带清。
        let reloaded = ProductMemoryStore(fileURL: fileURL)
        XCTAssertEqual(reloaded.traces(for: "690"), ["peanuts", "nuts"])
        reloaded.delete(barcode: "690")
        XCTAssertEqual(reloaded.traces(for: "690"), [])
        XCTAssertEqual(store.traces(for: "unknown"), []) // 无数据=空（缺数据≠不含）
    }

    func testNutritionRoundTripAndRenamePreserves() {
        let store = ProductMemoryStore(fileURL: fileURL)
        // Nutri-Score + NOVA 随名字存（供离线复扫也能报营养质量）。
        store.save(barcode: "690", name: "薯片", allergens: [], traces: [], nutriScore: "d", novaGroup: 4)
        XCTAssertEqual(store.nutriScore(for: "690"), "d")
        XCTAssertEqual(store.novaGroup(for: "690"), 4)
        // 用户手动改名（默认 nil 营养）不得抹掉已存的营养数据。
        store.save(barcode: "690", name: "我的薯片")
        XCTAssertEqual(store.nutriScore(for: "690"), "d")
        XCTAssertEqual(store.novaGroup(for: "690"), 4)
        // 落盘重载后仍在；删除连带清。
        let reloaded = ProductMemoryStore(fileURL: fileURL)
        XCTAssertEqual(reloaded.nutriScore(for: "690"), "d")
        XCTAssertEqual(reloaded.novaGroup(for: "690"), 4)
        reloaded.delete(barcode: "690")
        XCTAssertNil(reloaded.nutriScore(for: "690"))
        XCTAssertNil(reloaded.novaGroup(for: "690"))
        // 无数据 = nil（不猜、不硬凑）。
        XCTAssertNil(store.nutriScore(for: "unknown"))
        XCTAssertNil(store.novaGroup(for: "unknown"))
    }

    func testDietaryLabelsRoundTripAndRenamePreserves() {
        let store = ProductMemoryStore(fileURL: fileURL)
        // 膳食/宗教认证标注随名字存（供离线复扫也能报"无麸质/纯素/清真"）。
        store.save(barcode: "690", name: "无麸质饼干", dietaryLabels: ["gluten-free", "vegan"])
        XCTAssertEqual(store.dietaryLabels(for: "690"), ["gluten-free", "vegan"])
        // 用户手动改名（默认空膳食标注）不得抹掉已存的标注。
        store.save(barcode: "690", name: "我的饼干")
        XCTAssertEqual(store.dietaryLabels(for: "690"), ["gluten-free", "vegan"])
        // 落盘重载后仍在（独立旁路 plist）；删除连带清。
        let reloaded = ProductMemoryStore(fileURL: fileURL)
        XCTAssertEqual(reloaded.dietaryLabels(for: "690"), ["gluten-free", "vegan"])
        reloaded.delete(barcode: "690")
        XCTAssertEqual(reloaded.dietaryLabels(for: "690"), [])
        // 无数据 = 空数组（缺数据≠不符/不含）。
        XCTAssertEqual(store.dietaryLabels(for: "unknown"), [])
    }

    func testQuantityRoundTripAndRenamePreserves() {
        let store = ProductMemoryStore(fileURL: fileURL)
        // 净含量随名字存（供离线复扫也能报规格）。
        store.save(barcode: "690", name: "牛奶", quantity: "500 ml")
        XCTAssertEqual(store.quantity(for: "690"), "500 ml")
        // 用户手动改名（默认空净含量）不得抹掉已存的规格。
        store.save(barcode: "690", name: "我的牛奶")
        XCTAssertEqual(store.quantity(for: "690"), "500 ml")
        // 落盘重载后仍在；删除连带清。
        let reloaded = ProductMemoryStore(fileURL: fileURL)
        XCTAssertEqual(reloaded.quantity(for: "690"), "500 ml")
        reloaded.delete(barcode: "690")
        XCTAssertNil(reloaded.quantity(for: "690"))
        XCTAssertNil(store.quantity(for: "unknown")) // 无数据=nil（不猜）
    }

    func testLegacyNameOnlyFileStillLoads() {
        // 老版本只有名字 plist（无 allergens/traces/dietary 旁路文件）：名字照常、过敏原/微量/膳食标注为空——零迁移。
        let legacy = ["123": "酱油"]
        try? PropertyListEncoder().encode(legacy).write(to: fileURL)
        let store = ProductMemoryStore(fileURL: fileURL)
        XCTAssertEqual(store.name(for: "123"), "酱油")
        XCTAssertEqual(store.allergens(for: "123"), [])
        XCTAssertEqual(store.traces(for: "123"), [])
        XCTAssertNil(store.nutriScore(for: "123"))
        XCTAssertNil(store.novaGroup(for: "123"))
        XCTAssertEqual(store.dietaryLabels(for: "123"), [])
        XCTAssertNil(store.quantity(for: "123"))
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
