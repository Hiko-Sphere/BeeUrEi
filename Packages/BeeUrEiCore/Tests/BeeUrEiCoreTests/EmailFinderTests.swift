import XCTest
@testable import BeeUrEiCore

/// 邮箱抽取：标准样式、多个、去重（大小写不敏感）、非邮箱不误配。
final class EmailFinderTests: XCTestCase {
    func testBasic() {
        XCTAssertEqual(EmailFinder.find(texts: ["联系邮箱 zhang@example.com"]), ["zhang@example.com"])
        XCTAssertEqual(EmailFinder.find(texts: ["Email: a.b+tag@sub.domain.co.uk 谢谢"]), ["a.b+tag@sub.domain.co.uk"])
    }

    func testMultipleAndDedupCaseInsensitive() {
        let r = EmailFinder.find(texts: ["sales@acme.com", "SALES@ACME.COM", "support@acme.com"])
        XCTAssertEqual(r.count, 2)               // sales 去重（大小写）
        XCTAssertEqual(r[0], "sales@acme.com")   // 保序取首见
        XCTAssertTrue(r.contains("support@acme.com"))
    }

    func testNonEmailRejected() {
        XCTAssertTrue(EmailFinder.find(texts: ["价格 12345", "@某人 转发", "http://a.com", "a@b"]).isEmpty) // a@b 无顶级域
        XCTAssertTrue(EmailFinder.find(texts: []).isEmpty)
    }
}
