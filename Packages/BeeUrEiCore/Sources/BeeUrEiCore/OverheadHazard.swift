import Foundation

/// 头/胸高（离地、盲杖探不到）障碍分类。
///
/// 盲杖只扫近地面：分支、招牌、开着的柜门/窗、卡车后视镜、脚手架横杆、半开的车门等
/// **底部离地、却在上身或头部高度**的障碍，盲杖给不出预警——这正是盲杖用户被撞伤的主因，
/// 也是 biped.ai / WeWALK 等避障产品的核心卖点。CollisionCorridor 把「地面→头高」当**一个**
/// 盒子、GroundHazardDetector 只管**地面**落差/台阶，两者都不把这类「悬空障碍」单独分出来。
///
/// 本模块把悬空障碍从普通障碍里识别出来，触发更紧急、明确护头/上身的播报（见 hint）。
/// 纯几何分类，可单测。输入是障碍相对地面的**垂直范围** minHeight..maxHeight（米）与水平距离——
/// 由 iOS 适配层复用 CollisionCorridor 同一套 (origin=脚下, up=重力反向) 机制从 LiDAR/AR 点云
/// 计算得到（非本包职责；离地判定阈值真机可调）。保守原则：几何拿不准时绝不误报「悬空」。
public enum OverheadHazard: Equatable, Sendable {
    case none
    /// 障碍触及的高度带（决定播报措辞：头部最危险、明确护头）。
    public enum Zone: Sendable, Equatable { case head, torso }
    case overhead(distanceMeters: Double, zone: Zone)
}

public struct OverheadHazardDetector: Sendable {
    /// 盲杖可靠探测的近地高度：障碍**底部**低于此即认为盲杖能发现，交给地面/常规障碍系统，不重复预警。
    public let caneReachMeters: Double
    /// 用户身高（头顶）。障碍**整体**高于此 → 从头顶上方穿过、不会撞到 → 不预警。
    public let userHeightMeters: Double
    /// 头部带下沿：障碍**顶部**达到此高度即视为触及头部（最危险，护头），否则归「上身」。
    public let headZoneBottomMeters: Double
    /// 预警距离（米）：超出则不打扰。
    public let warnDistanceMeters: Double

    public init(caneReachMeters: Double = 0.3, userHeightMeters: Double = 1.7,
                headZoneBottomMeters: Double = 1.4, warnDistanceMeters: Double = 2.5) {
        self.caneReachMeters = caneReachMeters
        self.userHeightMeters = userHeightMeters
        self.headZoneBottomMeters = headZoneBottomMeters
        self.warnDistanceMeters = warnDistanceMeters
    }

    /// 分类。minHeight/maxHeight 为障碍最低/最高点相对地面高度（米）；distance 为水平距离（米）。
    /// 任一无效（非有限、max≤min、距离≤0 或超警戒距离）→ .none（保守：拿不准不误报「悬空」）。
    public func classify(minHeightMeters minH: Double, maxHeightMeters maxH: Double,
                         distanceMeters dist: Double) -> OverheadHazard {
        guard minH.isFinite, maxH.isFinite, dist.isFinite,
              maxH > minH, dist > 0, dist <= warnDistanceMeters else { return .none }
        // 盲杖够得着（底部贴近地面）→ 常规系统已覆盖，不作为「悬空」重复预警。
        if minH <= caneReachMeters { return .none }
        // 整体高过头顶 → 从下方穿过、不会撞。
        if minH > userHeightMeters { return .none }
        // 至此：障碍底部离地（> caneReach）且不高过头顶 → 会走进去、盲杖探不到 = 悬空障碍。
        // 用**顶部**是否达到头部带来判头/胸：顶部够到头 = 护头（更紧急），否则齐胸。
        let zone: OverheadHazard.Zone = (maxH >= headZoneBottomMeters) ? .head : .torso
        return .overhead(distanceMeters: dist, zone: zone)
    }

    /// 保守、简短的播报语（复用地面高危的距离档 groundMeters；语言可选，默认中文）。
    public func hint(_ hazard: OverheadHazard, language: Language = .zh) -> String? {
        switch hazard {
        case .none: return nil
        case .overhead(let d, let zone):
            let m = SpokenStrings.groundMeters(d, language)
            switch zone {
            case .head:  return SpokenStrings.overheadHead(metersStr: m, language)
            case .torso: return SpokenStrings.overheadTorso(metersStr: m, language)
            }
        }
    }
}
