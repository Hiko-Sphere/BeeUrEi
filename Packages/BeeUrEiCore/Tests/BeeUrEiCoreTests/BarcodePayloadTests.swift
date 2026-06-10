import XCTest
@testable import BeeUrEiCore

/// 条码内容分类：商品码/WiFi/网址/电话/名片/文本 + 字段提取。
final class BarcodePayloadTests: XCTestCase {

    func testProductCodes() {
        XCTAssertEqual(BarcodePayload.classify("6901234567892"), .productCode(chinaPrefix: true))  // EAN-13 国货
        XCTAssertEqual(BarcodePayload.classify("4006381333931"), .productCode(chinaPrefix: false)) // EAN-13 进口
        XCTAssertEqual(BarcodePayload.classify("12345670"), .productCode(chinaPrefix: false))      // EAN-8
        XCTAssertEqual(BarcodePayload.classify("036000291452"), .productCode(chinaPrefix: false))  // UPC-A
        XCTAssertEqual(BarcodePayload.classify(" 6901234567892 "), .productCode(chinaPrefix: true)) // 容忍空白
    }

    func testNonProductDigitsFallToText() {
        XCTAssertEqual(BarcodePayload.classify("1234567890"), .text)   // 10 位不是商品码长度
        XCTAssertEqual(BarcodePayload.classify("69012A4567892"), .text) // 混入字母
    }

    func testWifi() {
        XCTAssertEqual(BarcodePayload.classify("WIFI:T:WPA;S:MyHome;P:secret;;"), .wifi(ssid: "MyHome"))
        XCTAssertEqual(BarcodePayload.classify("wifi:S:家里的网;P:p;;"), .wifi(ssid: "家里的网"))
        XCTAssertEqual(BarcodePayload.classify("WIFI:T:WPA;P:secret;;"), .wifi(ssid: nil))
    }

    func testUrl() {
        XCTAssertEqual(BarcodePayload.classify("https://example.com/path?q=1"), .url(host: "example.com"))
        XCTAssertEqual(BarcodePayload.classify("http://shop.taobao.com"), .url(host: "shop.taobao.com"))
        XCTAssertEqual(BarcodePayload.classify("HTTPS://A.B:8080/x"), .url(host: "A.B"))
    }

    func testPhoneAndContact() {
        XCTAssertEqual(BarcodePayload.classify("tel:+8613800138000"), .phone(number: "+8613800138000"))
        XCTAssertEqual(BarcodePayload.classify("BEGIN:VCARD\nFN:张三\nEND:VCARD"), .contact)
        XCTAssertEqual(BarcodePayload.classify("MECARD:N:李四;;"), .contact)
    }

    func testPlainText() {
        XCTAssertEqual(BarcodePayload.classify("你好，世界"), .text)
        XCTAssertEqual(BarcodePayload.classify(""), .text)
    }
}
