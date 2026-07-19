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

    // MARK: pickSeatIndex（多把候选优先挑空着的那把）

    func testPicksFreeSeatOverHigherConfidenceOccupied() {
        // 座位0：置信度最高(0.9)但**被占**；座位1：置信度稍低(0.6)但**空着**——须指向 1（空的那把），
        // 而非最显眼但已占的 0（"找空座位"的全部意义）。
        let occupied = NormalizedBox(x: 0.1, y: 0.3, width: 0.2, height: 0.3)
        let sitter = NormalizedBox(x: 0.12, y: 0.25, width: 0.18, height: 0.5) // 压住 occupied
        let free = NormalizedBox(x: 0.7, y: 0.3, width: 0.2, height: 0.3)
        let idx = SeatOccupancy.pickSeatIndex(seats: [(occupied, 0.9), (free, 0.6)], persons: [sitter])
        XCTAssertEqual(idx, 1)
    }

    func testAllOccupiedFallsBackToHighestConfidence() {
        // 全部"可能有人"→ 退回置信度最高的那把（如实报"可能有人"，绝不谎报空、也不放弃指路）。
        let s0 = NormalizedBox(x: 0.1, y: 0.3, width: 0.2, height: 0.3)
        let s1 = NormalizedBox(x: 0.6, y: 0.3, width: 0.2, height: 0.3)
        let p0 = NormalizedBox(x: 0.12, y: 0.25, width: 0.18, height: 0.5)
        let p1 = NormalizedBox(x: 0.62, y: 0.25, width: 0.18, height: 0.5)
        XCTAssertEqual(SeatOccupancy.pickSeatIndex(seats: [(s0, 0.5), (s1, 0.8)], persons: [p0, p1]), 1)
    }

    func testPicksHighestConfidenceAmongMultipleFree() {
        // 多把都空着 → 取置信度最高的那把（最可信的检测，指路更准）。
        let a = NormalizedBox(x: 0.1, y: 0.3, width: 0.2, height: 0.3)
        let b = NormalizedBox(x: 0.7, y: 0.3, width: 0.2, height: 0.3)
        XCTAssertEqual(SeatOccupancy.pickSeatIndex(seats: [(a, 0.5), (b, 0.85)], persons: []), 1)
    }

    func testPickEmptyCandidatesIsNil() {
        XCTAssertNil(SeatOccupancy.pickSeatIndex(seats: [], persons: []))
    }

    func testPickNonFiniteConfidenceTreatedAsZero() {
        // 非有限置信度当 0：不因坏读数抢占；另一把有限置信度的空座应胜出。
        let a = NormalizedBox(x: 0.1, y: 0.3, width: 0.2, height: 0.3)
        let b = NormalizedBox(x: 0.7, y: 0.3, width: 0.2, height: 0.3)
        XCTAssertEqual(SeatOccupancy.pickSeatIndex(seats: [(a, .nan), (b, 0.3)], persons: []), 1)
    }
}
