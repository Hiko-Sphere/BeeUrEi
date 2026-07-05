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
        // 非标准小写字段键 `s:` 也应读出 SSID，且值大小写保留（网络名区分大小写）。
        XCTAssertEqual(BarcodePayload.classify("WIFI:t:wpa;s:CoffeeShop;p:pass;;"), .wifi(ssid: "CoffeeShop"))
    }

    func testWifiCredentialFull() {
        // 完整凭据含**密码**（盲人扫码看不到密码，这是能否联网的关键）。
        let c = BarcodePayload.parseWifi("WIFI:T:WPA;S:MyHome;P:secret;;")
        XCTAssertEqual(c, WifiCredential(ssid: "MyHome", password: "secret", security: "WPA", hidden: false))
        // 小写键 + 隐藏网络。
        let h = BarcodePayload.parseWifi("wifi:t:WPA2;s:Hid;p:pw;h:true;;")
        XCTAssertEqual(h?.ssid, "Hid"); XCTAssertEqual(h?.password, "pw"); XCTAssertEqual(h?.hidden, true)
    }

    func testWifiCredentialEscaping() {
        // 密码常含特殊字符：`\;` `\\` `\:` `\,` 必须正确展开，否则 naive 按 ; 切会把密码切断/读错。
        let c = BarcodePayload.parseWifi(#"WIFI:T:WPA;S:Cafe;P:pa\;ss\\wo\:rd;;"#)
        XCTAssertEqual(c?.ssid, "Cafe")
        XCTAssertEqual(c?.password, #"pa;ss\wo:rd"#) // \; → ; ; \\ → \ ; \: → :
        // SSID 本身带转义分号也不被切断。
        XCTAssertEqual(BarcodePayload.parseWifi(#"WIFI:S:My\;Net;P:x;;"#)?.ssid, "My;Net")
    }

    func testWifiCredentialOpenAndInvalid() {
        // 开放网络：nopass 或无密码 → password 为 nil。
        XCTAssertNil(BarcodePayload.parseWifi("WIFI:T:nopass;S:Free;;")?.password)
        XCTAssertNil(BarcodePayload.parseWifi("WIFI:S:Open;;")?.password)
        XCTAssertEqual(BarcodePayload.parseWifi("WIFI:T:nopass;S:Free;;")?.ssid, "Free")
        // 无 SSID / 非 WIFI → nil。
        XCTAssertNil(BarcodePayload.parseWifi("WIFI:T:WPA;P:secret;;"))
        XCTAssertNil(BarcodePayload.parseWifi("https://example.com"))
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

    /// 对抗复审 LOW：空/纯空白 tel: 回落文本，不谎报"电话号码"却无号可拨（与 mailto/sms 同口径）。
    func testEmptyTelFallsBackToText() {
        XCTAssertEqual(BarcodePayload.classify("tel:"), .text)
        XCTAssertEqual(BarcodePayload.classify("tel:   "), .text)
        XCTAssertEqual(BarcodePayload.classify("tel:13812345678"), .phone(number: "13812345678")) // 正常仍识别
    }

    /// 对抗复审 LOW：URL 含 userinfo(user:pass@) / IPv6 时正确取 host，不把用户名/"[段"当 host。
    func testUrlHostWithUserinfoAndIPv6() {
        XCTAssertEqual(BarcodePayload.classify("http://user:pass@example.com/x"), .url(host: "example.com"))
        XCTAssertEqual(BarcodePayload.classify("http://[2001:db8::1]:8080/x"), .url(host: "2001:db8::1"))
    }

    func testEmail() {
        XCTAssertEqual(BarcodePayload.classify("mailto:hi@example.com"), .email(address: "hi@example.com"))
        XCTAssertEqual(BarcodePayload.classify("MAILTO:a@b.cn?subject=Hello"), .email(address: "a@b.cn")) // 去 ?参数
        XCTAssertEqual(BarcodePayload.classify("mailto:"), .email(address: nil))                            // 空地址
    }

    func testSMS() {
        // 号码 + **预填正文**都解出（正文此前被丢弃，盲人不知会发出什么内容）。
        XCTAssertEqual(BarcodePayload.classify("SMSTO:13800138000:你好"), .sms(number: "13800138000", body: "你好"))     // 冒号后正文
        XCTAssertEqual(BarcodePayload.classify("sms:+8613912345678?body=hi"), .sms(number: "+8613912345678", body: "hi")) // 查询参数正文
        // 正文的 URL 编码 / '+' 当空格 正确解码。
        XCTAssertEqual(BarcodePayload.classify("sms:10086?body=%E4%BD%A0%E5%A5%BD+world"), .sms(number: "10086", body: "你好 world"))
        // SMSTO 正文含冒号：号码只到首个冒号，其余全是正文（含冒号）。
        XCTAssertEqual(BarcodePayload.classify("SMSTO:10086:code:ABC"), .sms(number: "10086", body: "code:ABC"))
        // 无正文 / 空：body 为 nil，不瞎报。
        XCTAssertEqual(BarcodePayload.classify("SMSTO:13800138000"), .sms(number: "13800138000", body: nil))
        XCTAssertEqual(BarcodePayload.classify("SMSTO:13800138000:"), .sms(number: "13800138000", body: nil)) // 空正文
        XCTAssertEqual(BarcodePayload.classify("SMSTO:"), .sms(number: nil, body: nil))
    }

    func testPlainText() {
        XCTAssertEqual(BarcodePayload.classify("你好，世界"), .text)
        XCTAssertEqual(BarcodePayload.classify(""), .text)
        // 纯 12 位数字仍是商品码，不被 sms/email 误吞（前缀不匹配）。
        XCTAssertEqual(BarcodePayload.classify("036000291452"), .productCode(chinaPrefix: false))
    }

    /// 从 classify 结果里取 geo 三元组（Double 用 accuracy 比，避免字面量/解析细微差）。
    private func geoOf(_ s: String) -> (lat: Double, lng: Double, label: String?)? {
        if case let .geo(lat, lng, label) = BarcodePayload.classify(s) { return (lat, lng, label) }
        return nil
    }

    func testGeoLocation() {
        // 基础 geo:lat,lng（RFC 5870）——盲人扫位置码可听到并一键导航。
        let a = geoOf("geo:39.9042,116.4074")
        XCTAssertNotNil(a); XCTAssertEqual(a!.lat, 39.9042, accuracy: 1e-6); XCTAssertEqual(a!.lng, 116.4074, accuracy: 1e-6); XCTAssertNil(a!.label)
        // 带地名 q（path 是真坐标，q 是地名）。
        let b = geoOf("geo:31.2304,121.4737?q=外滩")
        XCTAssertNotNil(b); XCTAssertEqual(b!.lat, 31.2304, accuracy: 1e-6); XCTAssertEqual(b!.label, "外滩")
        // 地图分享形 geo:0,0?q=lat,lng(名)：q 里的真坐标覆盖 0,0 占位，括号里是地名（不导航到 Null Island）。
        let c = geoOf("geo:0,0?q=22.5431,114.0579(深圳市民中心)")
        XCTAssertNotNil(c); XCTAssertEqual(c!.lat, 22.5431, accuracy: 1e-6); XCTAssertEqual(c!.lng, 114.0579, accuracy: 1e-6); XCTAssertEqual(c!.label, "深圳市民中心")
        // 海拔/参数忽略：geo:lat,lng,alt 与 ;u= 都不影响坐标。
        XCTAssertEqual(geoOf("geo:30.5928,114.3055,25")!.lat, 30.5928, accuracy: 1e-6)
        XCTAssertEqual(geoOf("geo:30.5928,114.3055;u=35")!.lng, 114.3055, accuracy: 1e-6)
        // q 的地名 URL 编码可解（%2C 等不误当分隔）。
        XCTAssertEqual(geoOf("geo:39.9,116.4?q=%E5%A4%A9%E5%AE%89%E9%97%A8")?.label, "天安门")
    }

    func testGeoInvalidFallsBackToText() {
        // Null Island (0,0) 占位、q 非坐标：无真实目的地 → 回落文本，绝不导航到大西洋。
        XCTAssertEqual(BarcodePayload.classify("geo:0,0"), .text)
        XCTAssertEqual(BarcodePayload.classify("geo:0,0?q=某个只有名字的地方"), .text)
        // 缺经度 / 非数字 / 越界：均非法 → 文本。
        XCTAssertEqual(BarcodePayload.classify("geo:39.9"), .text)
        XCTAssertEqual(BarcodePayload.classify("geo:abc,def"), .text)
        XCTAssertEqual(BarcodePayload.classify("geo:100,200"), .text)   // 纬>90 经>180
        XCTAssertEqual(BarcodePayload.classify("geo:"), .text)          // 空
    }
}
