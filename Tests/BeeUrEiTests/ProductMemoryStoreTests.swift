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
        super.tearDown()
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
