import Foundation

/// 沿途地标 callout 的候选选择（纯逻辑，可单测；参考 Soundscape 的「beacon/callout」）。
///
/// 盲人沿路走时报「途经 X」帮助建立心理地图。此前 App 侧写法是
/// `items.first { 有名 && 名≠上次 }`，选中后再单独判 `distance <= 60`——两处真实缺陷：
/// - **漏报**：若首个「有名且不同」的候选恰在半径外，整帧直接放弃，即便列表后面有更近的合格候选（被跳过）；
/// - **选错**：MKLocalSearch 的结果是**相关性**排序（首个可能是远处的大 POI/连锁店），而盲人定向最需要的是**最近**的地标。
///
/// 本选择器改为：在所有「有有效名、与上次不同、在半径内」的候选里取**距离最近**的那个。
/// 并对名字做首尾去空白归一化（同 RoadAnnouncer：纯空白不算有效名、带空白变体不误当新地标）。
public enum NearbyLandmarkPicker {
    /// 单个候选 POI：名字（可空/未定）+ 到用户的距离（米）。App 侧由 MKMapItem 映射得到。
    public struct Candidate: Sendable {
        public let name: String?
        public let distanceMeters: Double
        public init(name: String?, distanceMeters: Double) {
            self.name = name
            self.distanceMeters = distanceMeters
        }
    }

    /// 选出应播报的地标名；nil = 没有合格候选（本帧不播）。
    /// 合格 = 名字去空白后非空、≠ lastAnnounced、距离有限且在 [0, maxMeters]；多个合格时取**最近**。
    /// 返回值已 trim（读起来干净、也作为下次的 lastAnnounced 基线，避免带空白变体重复播）。
    public static func pick(_ candidates: [Candidate], lastAnnounced: String?, maxMeters: Double = 60) -> String? {
        guard maxMeters.isFinite, maxMeters >= 0 else { return nil }
        var best: (name: String, dist: Double)?
        for c in candidates {
            guard let raw = c.name else { continue }
            let name = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, name != lastAnnounced else { continue }
            guard c.distanceMeters.isFinite, c.distanceMeters >= 0, c.distanceMeters <= maxMeters else { continue }
            if best == nil || c.distanceMeters < best!.dist { best = (name, c.distanceMeters) }
        }
        return best?.name
    }
}
