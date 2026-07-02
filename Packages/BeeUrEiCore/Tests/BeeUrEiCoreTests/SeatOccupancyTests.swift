import XCTest
@testable import BeeUrEiCore

/// 找空座位的占用判定：保守原则——误报"有人"可接受，误报"空着"不可接受。
final class SeatOccupancyTests: XCTestCase {
    private let chair = NormalizedBox(x: 0.4, y: 0.3, width: 0.2, height: 0.3)

    func testEmptySceneIsFree() {
        XCTAssertEqual(SeatOccupancy.judge(seat: chair, persons: []), .free)
    }

    func testPersonSittingOnChairIsOccupied() {
        // 坐着的人：人框横向与椅框大体对齐、纵向向上延伸（头/躯干在椅框上方）——交叠占椅面积大。
        let sitting = NormalizedBox(x: 0.42, y: 0.25, width: 0.18, height: 0.5)
        XCTAssertEqual(SeatOccupancy.judge(seat: chair, persons: [sitting]), .maybeOccupied)
    }

    func testPersonBesideChairIsFree() {
        // 站在椅子旁边：无交叠。
        let beside = NormalizedBox(x: 0.7, y: 0.2, width: 0.15, height: 0.6)
        XCTAssertEqual(SeatOccupancy.judge(seat: chair, persons: [beside]), .free)
    }

    func testSlightEdgeOverlapStaysFree() {
        // 擦边路过（交叠 < 阈值）：不误报有人。交叠区 0.02×0.3 / 椅面积 0.06 = 10% < 22%。
        let brushing = NormalizedBox(x: 0.58, y: 0.3, width: 0.2, height: 0.3)
        XCTAssertEqual(SeatOccupancy.judge(seat: chair, persons: [brushing]), .free)
    }

    func testAnyOnePersonOccupies() {
        let beside = NormalizedBox(x: 0.7, y: 0.2, width: 0.15, height: 0.6)
        let sitting = NormalizedBox(x: 0.45, y: 0.3, width: 0.15, height: 0.4)
        XCTAssertEqual(SeatOccupancy.judge(seat: chair, persons: [beside, sitting]), .maybeOccupied)
    }

    func testIoUWouldMissButOverlapRatioCatches() {
        // 人框远大于椅框（站/坐姿全身框）：IoU 被人框面积稀释到很小，但交叠已盖满椅面 → 必须报有人。
        let fullBody = NormalizedBox(x: 0.3, y: 0.0, width: 0.4, height: 1.0)
        XCTAssertEqual(SeatOccupancy.judge(seat: chair, persons: [fullBody]), .maybeOccupied)
    }

    func testDegenerateSeatNeverClaimsFree() {
        // 退化/非有限座位框：绝不声称"空着"（保守）。
        for bad in [NormalizedBox(x: 0.1, y: 0.1, width: 0, height: 0.2),
                    NormalizedBox(x: .nan, y: 0.1, width: 0.2, height: 0.2),
                    NormalizedBox(x: 0.1, y: 0.1, width: .infinity, height: 0.2)] {
            XCTAssertEqual(SeatOccupancy.judge(seat: bad, persons: []), .maybeOccupied)
        }
    }

    func testGarbagePersonBoxDoesNotPoisonJudgement() {
        // 坏人框（NaN）跳过：不崩、不把空椅误报成有人；同帧其余合法人框照常判定。
        let garbage = NormalizedBox(x: .nan, y: .nan, width: .nan, height: .nan)
        XCTAssertEqual(SeatOccupancy.judge(seat: chair, persons: [garbage]), .free)
        let sitting = NormalizedBox(x: 0.42, y: 0.25, width: 0.18, height: 0.5)
        XCTAssertEqual(SeatOccupancy.judge(seat: chair, persons: [garbage, sitting]), .maybeOccupied)
    }
}
