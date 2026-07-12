import XCTest
@testable import BeeUrEi

/// 通知逐 kind 图标（与 web notifIconKind 同键集、同判定顺序）。此前 iOS 所有通知同款渲染，
/// SOS 告警与普通提醒在通知流里无法一眼区分。排序陷阱直接取自 web 的回归教训。
final class NotifIconTests: XCTestCase {

    func testEmergencyOrderingTraps() {
        // 关系事件须在 emergency→闪电之前：善意的"你被设为紧急联系人"绝不能渲染成危险红闪电。
        XCTAssertEqual(NotifIcon.kind("emergency_contact_set"), "users")
        // 报平安=绿勾（最不该报警）；有人响应/已看到=电话（协调好消息）；真 SOS=红闪电。
        XCTAssertEqual(NotifIcon.kind("emergency_clear"), "check")
        XCTAssertEqual(NotifIcon.kind("emergency_responding"), "phone")
        XCTAssertEqual(NotifIcon.kind("emergency_ack"), "phone")
        XCTAssertEqual(NotifIcon.kind("emergency_alert"), "flash")
    }

    func testSecurityBeforeLinkTrap() {
        // security_apple_linked 含子串 "link"——须配盾牌（账号安全），不能被 friend/link 抢成人形。
        XCTAssertEqual(NotifIcon.kind("security_apple_linked"), "shield")
        XCTAssertEqual(NotifIcon.kind("security_password_changed"), "shield")
        XCTAssertEqual(NotifIcon.kind("kyc_verified"), "shield")
        XCTAssertEqual(NotifIcon.kind("report_resolved"), "shield")
        XCTAssertEqual(NotifIcon.kind("medical_viewed"), "shield")
    }

    func testSafetyLocationAndPinKinds() {
        XCTAssertEqual(NotifIcon.kind("checkin_due"), "shield")        // 安全报到=personal-safety 盾牌
        XCTAssertEqual(NotifIcon.kind("location_request"), "pin")      // web 曾漏配的回归点
        XCTAssertEqual(NotifIcon.kind("location_share_started"), "pin")
        XCTAssertEqual(NotifIcon.kind("route_added"), "pin")
        XCTAssertEqual(NotifIcon.kind("place_arrival"), "pin")
        XCTAssertEqual(NotifIcon.kind("message_pinned"), "pin")        // 置顶消息通知
    }

    func testSocialCallRecordBatteryAndDefault() {
        XCTAssertEqual(NotifIcon.kind("friend_request"), "users")
        XCTAssertEqual(NotifIcon.kind("group_member_added"), "users")
        XCTAssertEqual(NotifIcon.kind("missed_call"), "phone")
        XCTAssertEqual(NotifIcon.kind("recording_ready"), "film")
        XCTAssertEqual(NotifIcon.kind("battery_low"), "battery")
        XCTAssertEqual(NotifIcon.kind("something_unknown"), "bell")    // 未知 kind 兜底铃铛
    }

    func testEveryKeyHasSymbol() {
        // 每个键都有确定的 SF Symbol（漏配会静默落铃铛，视觉语义丢失）。
        for key in ["users", "flash", "battery", "phone", "shield", "pin", "film", "check", "bell"] {
            XCTAssertFalse(NotifIcon.symbol(forKey: key).isEmpty)
        }
        XCTAssertEqual(NotifIcon.symbol(forKey: "flash"), "bolt.fill")
        XCTAssertEqual(NotifIcon.symbol(forKey: "check"), "checkmark.circle.fill")
        XCTAssertEqual(NotifIcon.symbol(forKey: "nonsense"), "bell.fill") // 未知键兜底
    }
}
