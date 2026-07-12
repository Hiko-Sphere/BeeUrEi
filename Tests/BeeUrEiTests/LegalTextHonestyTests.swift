import XCTest
@testable import BeeUrEi

/// 应内法律文本的**隐私如实性**回归护栏（iter304，承 iter302/303）：自加入云端「AI 描述」后，任何"所有视觉 AI
/// 均在本地""唯一/仅在远程协助时才传出画面"的绝对措辞都是**假声明**——GDPR 合规硬伤 + 违反"严禁不真实"。
/// 本护栏钉死：法律文本不得再出现这些过度承诺，且必须如实披露「AI 描述」的第三方云端数据流。
final class LegalTextHonestyTests: XCTestCase {

    private func allLegal(_ l: Language) -> String {
        LegalText.privacyPolicy(l) + "\n" + LegalText.termsOfService(l) + "\n" + LegalText.eula(l)
    }

    func testNoOnDeviceOverclaimsChinese() {
        let s = allLegal(.zh)
        for bad in ["所有视觉 AI 推理都在", "所有视觉 AI 推理均在", "全部视觉 AI 推理", "唯一的例外是远程协助", "唯一离开你设备的情形"] {
            XCTAssertFalse(s.contains(bad), "隐私文本仍含过度承诺：\(bad)")
        }
    }

    func testNoOnDeviceOverclaimsEnglish() {
        let s = allLegal(.en)
        for bad in ["All of the following vision AI inference runs locally", "All vision AI inference runs locally",
                    "all of the App's vision AI inference", "The only exception is remote assistance",
                    "The only time camera video leaves"] {
            XCTAssertFalse(s.contains(bad), "Privacy text still overclaims: \(bad)")
        }
    }

    func testAiDescribeCloudFlowDisclosed() {
        // 必须如实披露：「AI 描述」把图发往第三方视觉模型（中英文都要有）。
        let zh = LegalText.privacyPolicy(.zh)
        XCTAssertTrue(zh.contains("AI 描述"), "中文隐私政策未披露 AI 描述")
        XCTAssertTrue(zh.contains("第三方 AI 视觉模型"), "中文隐私政策未披露第三方视觉模型接收方")
        let en = LegalText.privacyPolicy(.en)
        XCTAssertTrue(en.contains("AI Describe"), "EN privacy policy doesn't disclose AI Describe")
        XCTAssertTrue(en.lowercased().contains("third-party ai vision"), "EN privacy policy doesn't disclose the third-party vision provider")
    }
}
