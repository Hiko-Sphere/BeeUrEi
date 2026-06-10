import XCTest
@testable import BeeUrEi

/// 识别历史库：最近优先、空内容忽略、封顶丢最旧、删除/清空、落盘重载。
final class RecognitionHistoryStoreTests: XCTestCase {
    private var fileURL: URL!

    override func setUp() {
        super.setUp()
        fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("recognition-history-test-\(UUID().uuidString).plist")
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: fileURL)
        super.tearDown()
    }

    func testAddNewestFirstAndTrims() {
        let store = RecognitionHistoryStore(fileURL: fileURL)
        store.add(kind: "text", content: "  第一段  ")
        store.add(kind: "barcode", content: "6901234567892")
        XCTAssertEqual(store.records.map(\.content), ["6901234567892", "第一段"]) // 最近优先 + 去首尾空白
        XCTAssertEqual(store.records[0].kind, "barcode")
    }

    func testEmptyContentIgnored() {
        let store = RecognitionHistoryStore(fileURL: fileURL)
        store.add(kind: "text", content: "   ")
        XCTAssertTrue(store.records.isEmpty)
    }

    func testCapDropsOldest() {
        let store = RecognitionHistoryStore(fileURL: fileURL, maxRecords: 3)
        for i in 1...5 { store.add(kind: "text", content: "第\(i)条") }
        XCTAssertEqual(store.records.map(\.content), ["第5条", "第4条", "第3条"])
    }

    func testDeleteAndClear() {
        let store = RecognitionHistoryStore(fileURL: fileURL)
        store.add(kind: "text", content: "甲")
        store.add(kind: "page", content: "乙")
        store.delete(id: store.records[0].id)
        XCTAssertEqual(store.records.map(\.content), ["甲"])
        store.clear()
        XCTAssertTrue(store.records.isEmpty)
    }

    func testPersistsAcrossReload() {
        RecognitionHistoryStore(fileURL: fileURL).add(kind: "banknote", content: "一百元")
        let reloaded = RecognitionHistoryStore(fileURL: fileURL)
        XCTAssertEqual(reloaded.records.first?.content, "一百元")
        XCTAssertEqual(reloaded.records.first?.kind, "banknote")
    }
}
