import XCTest
@testable import BeeUrEi

/// 对抗复审（252-271 冲刺）修复的判别测试：每条都对应一个已确认的真缺陷。
final class SprintReviewFixTests: XCTestCase {

    // 复审 HIGH：unpin 成功回 204 空体——空体跑 JSONDecoder 恒抛，曾把每次成功取消都念成"失败"。
    func testPinResponseParsesEmptyBodyAsNoPin() {
        XCTAssertNil(APIClient.parsePinResponse(Data()))                       // 204 空体=成功、无置顶
        XCTAssertNil(APIClient.parsePinResponse(Data(#"{"pinned":null}"#.utf8)))
        let pin = APIClient.parsePinResponse(Data("""
        {"pinned":{"id":"m1","fromId":"a","toId":"b","kind":"text","text":"x","createdAt":1}}
        """.utf8))
        XCTAssertEqual(pin?.id, "m1")
    }

    // 复审 HIGH：服务端 z.number().int() 拒绝小数毫秒——曾让"暂停 7/30 天"每次 400。
    func testPauseTargetIsIntegerMilliseconds() {
        let t = DailyCheckinSection.pauseTarget(days: 7, nowMs: 1_784_479_729_880.5471)
        XCTAssertEqual(t, Int((1_784_479_729_880.5471 + 7 * 86_400_000).rounded()))
        XCTAssertEqual(DailyCheckinSection.pauseTarget(days: nil, nowMs: 123.9), 0) // 立即恢复
    }

    // 复审：fastify 限流插件回 "Too Many Requests"（非蛇形码）——归一化后仍须命中"稍等"文案。
    func testAiDescribe429NormalizesPluginDefault() {
        XCTAssertEqual(ChatStrings.aiDescribeErrorText("Too Many Requests", .zh),
                       ChatStrings.aiDescribeErrorText("too_many_requests", .zh))
        XCTAssertTrue(ChatStrings.aiDescribeErrorText("Too Many Requests", .zh).contains("频繁"))
    }

    // 复审：改名清旧须覆盖两种改名（全新名 + 撞已有名确认覆盖后）——只清前者会留重复围栏。
    func testCleanupLabelCoversBothRenameShapes() {
        XCTAssertEqual(PlaceSaveCheck.cleanupLabel(newLabel: "新医院", originalLabel: "医院"), "医院")  // 改成全新名
        XCTAssertEqual(PlaceSaveCheck.cleanupLabel(newLabel: "超市", originalLabel: "药店"), "药店")    // 改成撞已有名（确认覆盖后）
        XCTAssertNil(PlaceSaveCheck.cleanupLabel(newLabel: "医院", originalLabel: "医院"))              // 同名就地改址
        XCTAssertNil(PlaceSaveCheck.cleanupLabel(newLabel: "医院", originalLabel: nil))                // 新建
    }
}
