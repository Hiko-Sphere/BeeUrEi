import XCTest
@testable import BeeUrEiCore

/// 关联分组（安全复审 HIGH）：YOLO 在 car/truck/bus 间逐帧抖动时，逼近车辆必须关联成**一条**轨迹，
/// 而非被标签严格相等的关联门碎成多条（各拿 1/N 样本 → 距离低估、确认延迟 → 假安心）。
final class ObstacleTrackerGroupingTests: XCTestCase {

    private func obs(_ label: String, bearing: Double = 25, dist: Double) -> TrackObservation {
        TrackObservation(label: label, bearingDegrees: bearing, distanceMeters: dist, isHazard: true)
    }

    /// 注入 sameTrackingGroup 后：车辆标签抖动（车辆→卡车）关联到同一轨迹，2 帧即确认（confirmHits=2）。
    func testVehicleLabelJitterFormsSingleTrackAndConfirmsFast() {
        let t = ObstacleTracker(sameGroup: LabelCatalog.sameTrackingGroup)
        _ = t.update([obs("车辆", dist: 1.0)], dt: 0.1) // 帧1：tentative
        let confirmed = t.update([obs("卡车", dist: 0.9)], dt: 0.1) // 帧2：同组关联 → hits=2 → confirmed
        XCTAssertEqual(confirmed.count, 1, "抖动车辆应关联成一条轨迹")
        XCTAssertEqual(t.allTracks.count, 1, "不应碎成多条")
        // 再抖到公交车，仍是同一条（不新建）。
        _ = t.update([obs("公交车", dist: 0.7)], dt: 0.1)
        XCTAssertEqual(t.allTracks.count, 1)
        XCTAssertEqual(t.confirmedTracks.first?.distanceMeters ?? 99, 0.7, accuracy: 0.25) // 单一滤波器持续吸收样本
    }

    /// 对照：默认精确关联（无分组）——同样输入被碎成 2 条 tentative，2 帧后**一条都没确认**（确认延迟）。
    func testDefaultExactMatchFragmentsAndDelaysConfirm() {
        let t = ObstacleTracker() // 默认 sameGroup = ==
        _ = t.update([obs("车辆", dist: 1.0)], dt: 0.1)
        let confirmed = t.update([obs("卡车", dist: 0.9)], dt: 0.1)
        XCTAssertEqual(confirmed.count, 0, "车辆/卡车被当两个目标，各 1 帧 → 都未达 confirmHits，逼近车确认被延迟")
        XCTAssertEqual(t.allTracks.count, 2, "碎成两条轨迹")
    }

    /// 分组只合并同组：车 vs 人即便同方位也绝不合并（避免跨物体污染距离）。
    func testDifferentGroupsNeverMerge() {
        let t = ObstacleTracker(sameGroup: LabelCatalog.sameTrackingGroup)
        _ = t.update([obs("车辆", bearing: 25, dist: 1.0)], dt: 0.1)
        _ = t.update([obs("行人", bearing: 25, dist: 1.0)], dt: 0.1) // 同方位但不同组
        XCTAssertEqual(t.allTracks.count, 2, "车与人不同组，即便同方位也各自成轨")
    }
}
