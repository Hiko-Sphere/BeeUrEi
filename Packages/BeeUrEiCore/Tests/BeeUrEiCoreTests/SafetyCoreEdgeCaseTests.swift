import XCTest
@testable import BeeUrEiCore

/// 安全攸关核心模块的**边界用例补强**（主路径已在 PerceptionAlgorithmTests / SmoothingAndPolicyTests 覆盖）：
/// 跟踪关联门控、TTC 非法输入、最危险目标空集、播报承诺撤销等，给危险判定逻辑更强的回归保护。
final class SafetyCoreEdgeCaseTests: XCTestCase {

    // MARK: ObstacleTracker 关联门控 / 生命周期边界

    func testLabelMismatchDoesNotAssociate() {
        let t = ObstacleTracker()
        t.update([TrackObservation(label: "car", bearingDegrees: 0, distanceMeters: 5)], dt: 0.5)
        t.update([TrackObservation(label: "person", bearingDegrees: 0, distanceMeters: 5)], dt: 0.5) // 同方位不同标签
        XCTAssertEqual(t.allTracks.count, 2) // 不关联，各自成轨
    }

    func testBeyondBearingGateCreatesNewTrack() {
        let t = ObstacleTracker(gateDegrees: 18)
        t.update([TrackObservation(label: "car", bearingDegrees: 0, distanceMeters: 5)], dt: 0.5)
        t.update([TrackObservation(label: "car", bearingDegrees: 40, distanceMeters: 5)], dt: 0.5) // 超门限
        XCTAssertEqual(t.allTracks.count, 2)
    }

    func testStableIdWithinGate() {
        let t = ObstacleTracker()
        t.update([TrackObservation(label: "car", bearingDegrees: 10, distanceMeters: 8)], dt: 0.5)
        let id1 = t.allTracks.first!.id
        t.update([TrackObservation(label: "car", bearingDegrees: 14, distanceMeters: 7)], dt: 0.5) // 门限内 → 同轨
        XCTAssertEqual(t.allTracks.count, 1)
        XCTAssertEqual(t.allTracks.first!.id, id1)
    }

    func testMissResetsOnRematch() {
        let t = ObstacleTracker(confirmHits: 1, maxMisses: 3)
        let o = TrackObservation(label: "car", bearingDegrees: 0, distanceMeters: 5)
        t.update([o], dt: 0.5)
        t.update([], dt: 0.5)   // miss 1
        t.update([o], dt: 0.5)  // 重新匹配
        XCTAssertEqual(t.allTracks.first!.misses, 0)
    }

    func testDistanceAndTTCNilWithoutRangeObservation() {
        let t = ObstacleTracker(confirmHits: 1)
        t.update([TrackObservation(label: "car", bearingDegrees: 0, distanceMeters: nil)], dt: 0.5)
        XCTAssertNil(t.allTracks.first!.distanceMeters)
        XCTAssertNil(t.allTracks.first!.timeToCollision)
    }

    func testResetClearsTracksAndIds() {
        let t = ObstacleTracker()
        t.update([TrackObservation(label: "car", bearingDegrees: 0, distanceMeters: 5)], dt: 0.5)
        t.reset()
        XCTAssertTrue(t.allTracks.isEmpty)
    }

    // MARK: TimeToCollision 非法/边界输入

    func testTTCRejectsInvalidInputs() {
        XCTAssertEqual(TimeToCollision.seconds(distanceMeters: 10, closingSpeed: 2), 5)
        XCTAssertNil(TimeToCollision.seconds(distanceMeters: 10, closingSpeed: 0))    // 不接近
        XCTAssertNil(TimeToCollision.seconds(distanceMeters: 10, closingSpeed: -1))   // 远离
        XCTAssertNil(TimeToCollision.seconds(distanceMeters: 10, closingSpeed: 0.04)) // 低于噪声阈值
        XCTAssertNil(TimeToCollision.seconds(distanceMeters: .nan, closingSpeed: 2))  // 非有限
        XCTAssertNil(TimeToCollision.seconds(distanceMeters: -1, closingSpeed: 2))    // 负距离
    }

    // MARK: RiskScore 加分项与空集

    func testHazardClassAndCentralityRaiseScore() {
        let r = RiskScore()
        XCTAssertGreaterThan(
            r.score(ttc: 5, distanceMeters: 5, bearingDegrees: 0, isHazard: true),
            r.score(ttc: 5, distanceMeters: 5, bearingDegrees: 0, isHazard: false)) // 高危类别加分
        XCTAssertGreaterThan(
            r.score(ttc: nil, distanceMeters: 5, bearingDegrees: 0, isHazard: false),
            r.score(ttc: nil, distanceMeters: 5, bearingDegrees: 55, isHazard: false)) // 居中比偏侧危险
    }

    func testScoreWithNilTTCAndDistanceDoesNotCrash() {
        XCTAssertGreaterThan(RiskScore().score(ttc: nil, distanceMeters: nil, bearingDegrees: 0, isHazard: true), 0)
    }

    func testMostDangerousEmptyIsNil() {
        XCTAssertNil(RiskScore().mostDangerous([]))
    }

    func testScoreAlwaysFiniteOnNonFiniteInputs() {
        // 安全关键：坏传感器/坏几何(NaN/±inf)绝不能污染分数——否则 mostDangerous 的 `<` 比较会错选/漏选最危险目标。
        // bearing 尤其可达：tracker 直接拷 obs.bearingDegrees、未像距离那样在 α-β 处过滤非有限。
        let r = RiskScore()
        for bad in [Double.nan, .infinity, -.infinity] {
            XCTAssertTrue(r.score(ttc: bad, distanceMeters: 1, bearingDegrees: 0, isHazard: true).isFinite)
            XCTAssertTrue(r.score(ttc: 2, distanceMeters: bad, bearingDegrees: 0, isHazard: true).isFinite)
            XCTAssertTrue(r.score(ttc: 2, distanceMeters: 1, bearingDegrees: bad, isHazard: true).isFinite)
            XCTAssertTrue(r.score(ttc: bad, distanceMeters: bad, bearingDegrees: bad, isHazard: false).isFinite)
        }
        // 有限输入行为不变：非有限 bearing 等价于「居中度 0」，故真·居中(0°)仍严格更危险。
        XCTAssertGreaterThan(r.score(ttc: 2, distanceMeters: 1, bearingDegrees: 0, isHazard: true),
                             r.score(ttc: 2, distanceMeters: 1, bearingDegrees: .nan, isHazard: true))
    }

    // MARK: AnnouncementPolicy 承诺撤销

    func testResetAllowsImmediateReannounce() {
        let p = AnnouncementPolicy()
        _ = p.decide(targetKey: "1|car", urgency: 1, isSpeaking: false, now: 0)
        p.reset() // 被更高优先级吞掉时撤销承诺
        XCTAssertTrue(p.decide(targetKey: "1|car", urgency: 1, isSpeaking: false, now: 0.1).announce)
    }
}
