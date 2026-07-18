import XCTest
@testable import BeeUrEiCore

final class VisionImageEncodingTests: XCTestCase {
    typealias V = VisionImageEncoding

    func testFittedSizeCapsLongSideWithoutUpscaling() {
        // 横图超长边 → 长边压到 1024、等比。
        let land = V.fittedSize(width: 3000, height: 2000)
        XCTAssertEqual(land.width, 1024, accuracy: 0.01)
        XCTAssertEqual(land.height, 682.67, accuracy: 0.5) // 2000 * 1024/3000
        // 竖图（高为长边）→ 高压到 1024、宽等比。
        let port = V.fittedSize(width: 1500, height: 3000)
        XCTAssertEqual(port.height, 1024, accuracy: 0.01)
        XCTAssertEqual(port.width, 512, accuracy: 0.01)
        // 正方形。
        let sq = V.fittedSize(width: 2048, height: 2048)
        XCTAssertEqual(sq.width, 1024, accuracy: 0.01)
        XCTAssertEqual(sq.height, 1024, accuracy: 0.01)
    }

    func testFittedSizeNeverUpscalesSmallImages() {
        // 小图原样（绝不放大——放大只会糊且徒增体积）。
        let small = V.fittedSize(width: 800, height: 600)
        XCTAssertEqual(small.width, 800, accuracy: 0.01)
        XCTAssertEqual(small.height, 600, accuracy: 0.01)
        // 恰好等于上限：不变。
        let exact = V.fittedSize(width: 1024, height: 768)
        XCTAssertEqual(exact.width, 1024, accuracy: 0.01)
        XCTAssertEqual(exact.height, 768, accuracy: 0.01)
    }

    func testFittedSizeBadDimensionsYieldZeroNotCrash() {
        XCTAssertEqual(V.fittedSize(width: 0, height: 0).width, 0)
        XCTAssertEqual(V.fittedSize(width: -5, height: 100).width, 0)   // 负尺寸
        XCTAssertEqual(V.fittedSize(width: .nan, height: 100).width, 0) // 非有限
        XCTAssertEqual(V.fittedSize(width: 100, height: .infinity).height, 0)
    }

    func testJpegQualityFloorGuardsTextLegibility() {
        // 守住 detail=high 的读字目标：日后误把质量调回 0.6/0.7 会红（文字边缘伪影回潮）。
        XCTAssertGreaterThanOrEqual(V.jpegQuality, 0.8)
        XCTAssertLessThanOrEqual(V.jpegQuality, 1.0)
    }
}
