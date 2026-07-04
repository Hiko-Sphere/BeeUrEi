import XCTest
@testable import BeeUrEiCore

/// OCR 阅读顺序重排：从上到下、行内从左到右、并排块合一行、坏块剔除。
final class ReadingOrderTests: XCTestCase {
    typealias B = ReadingOrder.Block

    func testSortsTopToBottomRegardlessOfInputOrder() {
        // Vision 常乱序返回；无论输入顺序，都按顶边 y 从上到下。
        let blocks = [
            B(text: "第三行", x: 0.1, y: 0.50, height: 0.05),
            B(text: "标题",   x: 0.1, y: 0.10, height: 0.06),
            B(text: "第二行", x: 0.1, y: 0.30, height: 0.05),
        ]
        XCTAssertEqual(ReadingOrder.lines(blocks), ["标题", "第二行", "第三行"])
    }

    func testSameRowJoinedLeftToRight() {
        // 同一视觉行的"标签 + 值"两块（中心 y 接近）合成一行，按 x 从左到右。
        let blocks = [
            B(text: "张三",   x: 0.55, y: 0.205, height: 0.04), // 值在右
            B(text: "姓名:", x: 0.10, y: 0.200, height: 0.04), // 标签在左
        ]
        XCTAssertEqual(ReadingOrder.lines(blocks), ["姓名: 张三"])
    }

    func testMultiRowWithSideBySide() {
        let blocks = [
            B(text: "B", x: 0.60, y: 0.10, height: 0.05), // 第一行右
            B(text: "C", x: 0.10, y: 0.30, height: 0.05), // 第二行
            B(text: "A", x: 0.10, y: 0.10, height: 0.05), // 第一行左
        ]
        XCTAssertEqual(ReadingOrder.lines(blocks), ["A B", "C"])
        XCTAssertEqual(ReadingOrder.text(blocks), "A B\nC") // 便捷整段：行间换行
    }

    func testTightlySpacedLinesStaySeparate() {
        // 行距较紧（中心相距约 1 个行高）仍应判为两行，不被并成一行。
        let blocks = [
            B(text: "上行", x: 0.1, y: 0.100, height: 0.05), // center 0.125
            B(text: "下行", x: 0.1, y: 0.160, height: 0.05), // center 0.185，差 0.06 > 0.6*0.05=0.03
        ]
        XCTAssertEqual(ReadingOrder.lines(blocks), ["上行", "下行"])
    }

    func testInvalidBlocksDropped() {
        let blocks = [
            B(text: "  ", x: 0.1, y: 0.1, height: 0.05),                       // 空白文本
            B(text: "有效", x: 0.1, y: 0.2, height: 0.05),
            B(text: "坏坐标", x: .nan, y: 0.3, height: 0.05),                  // 非有限
            B(text: "零高", x: 0.1, y: 0.4, height: 0),                        // 高度非正
        ]
        XCTAssertEqual(ReadingOrder.lines(blocks), ["有效"])
    }

    func testEmpty() {
        XCTAssertEqual(ReadingOrder.lines([]), [])
        XCTAssertEqual(ReadingOrder.text([]), "")
    }
}
