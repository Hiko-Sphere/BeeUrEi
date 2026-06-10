import XCTest
@testable import BeeUrEi

/// 头像编码（上传前压缩）回归：尺寸上限、格式前缀、可被 AvatarView 解析回来。
final class AvatarEncoderTests: XCTestCase {

    private func solidImage(width: Int, height: Int) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1
        return UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: fmt).image { ctx in
            UIColor.systemOrange.setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
    }

    func testEncodesAsJpegDataURLAndDownscales() throws {
        let big = solidImage(width: 2000, height: 1000)
        let dataURL = try XCTUnwrap(AvatarEncoder.dataURL(from: big))
        XCTAssertTrue(dataURL.hasPrefix("data:image/jpeg;base64,"))
        let decoded = try XCTUnwrap(AvatarView.image(from: dataURL))
        XCTAssertLessThanOrEqual(max(decoded.size.width, decoded.size.height), 256 + 1) // 下采样到 ≤256
        // 宽高比保持 2:1。
        XCTAssertEqual(decoded.size.width / decoded.size.height, 2.0, accuracy: 0.05)
    }

    func testSmallImageNotUpscaled() throws {
        let small = solidImage(width: 100, height: 80)
        let dataURL = try XCTUnwrap(AvatarEncoder.dataURL(from: small))
        let decoded = try XCTUnwrap(AvatarView.image(from: dataURL))
        XCTAssertEqual(decoded.size.width, 100, accuracy: 1)
    }

    func testAvatarViewRejectsGarbage() {
        XCTAssertNil(AvatarView.image(from: nil))
        XCTAssertNil(AvatarView.image(from: "not a data url"))
        XCTAssertNil(AvatarView.image(from: "data:image/jpeg;base64,!!!!"))
    }
}
