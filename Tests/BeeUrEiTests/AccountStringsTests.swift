import XCTest
@testable import BeeUrEi

/// 账号链路文案表（E5 第八批）：中文与历史一致、英文不串中文、角色名映射。
final class AccountStringsTests: XCTestCase {

    func testChineseMatchesLegacyPhrases() {
        XCTAssertEqual(AccountStrings.tagline(.zh), "为视障人士而生的避障与远程协助")
        XCTAssertEqual(AccountStrings.codeSent(.zh), "如果该账号绑定了邮箱，验证码已发送。请查收后填写下方验证码。")
        XCTAssertEqual(AccountStrings.passwordChanged(.zh), "密码已修改，请用新密码重新登录。")
        XCTAssertEqual(AccountStrings.deleteConfirmMessage(.zh), "将永久删除你的账号、亲友绑定与登录信息，且不可恢复。")
        XCTAssertEqual(AccountStrings.nicknameUpdated("小蜂", .zh), "昵称已更新为 小蜂")
    }

    func testRoleNames() {
        XCTAssertEqual(AccountStrings.roleName("blind", .zh), "求助者（视障）")
        XCTAssertEqual(AccountStrings.roleName("helper", .en), "Helper / family")
        XCTAssertEqual(AccountStrings.roleName("admin", .zh), "admin") // 未知角色原样回显
    }

    func testEnglishHasNoChinese() {
        let samples = [
            AccountStrings.loginExplain(.en), AccountStrings.forgotFooter(.en),
            AccountStrings.codeSent(.en), AccountStrings.nicknameMessage(.en),
            AccountStrings.deleteConfirmMessage(.en), AccountStrings.noEmailYet(.en),
            AccountStrings.passwordChangeFailed(.en), AccountStrings.emailFooter(.en),
        ]
        for s in samples {
            XCTAssertFalse(s.contains(where: { $0.unicodeScalars.contains { $0.value >= 0x4E00 && $0.value <= 0x9FFF } }),
                           "英文文案混入中文：\(s)")
            XCTAssertFalse(s.isEmpty)
        }
    }
}
