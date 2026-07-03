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

    func testFilterByKeyword() {
        let recs = [
            RecognitionRecord(id: UUID(), kind: "text", content: "快递单号 SF1234567890", date: Date()),
            RecognitionRecord(id: UUID(), kind: "text", content: "北京市朝阳区某路 12 号", date: Date()),
            RecognitionRecord(id: UUID(), kind: "barcode", content: "6901234567890", date: Date()),
        ]
        // 空词 → 全部
        XCTAssertEqual(RecognitionHistoryStore.filter(recs, query: "  ").count, 3)
        // 中文关键词
        XCTAssertEqual(RecognitionHistoryStore.filter(recs, query: "朝阳").count, 1)
        // 不区分大小写
        XCTAssertEqual(RecognitionHistoryStore.filter(recs, query: "sf123").count, 1)
        XCTAssertEqual(RecognitionHistoryStore.filter(recs, query: "SF123").count, 1)
        // 无匹配
        XCTAssertEqual(RecognitionHistoryStore.filter(recs, query: "不存在").count, 0)
        // 数字子串
        XCTAssertEqual(RecognitionHistoryStore.filter(recs, query: "690123").count, 1)
    }
}
