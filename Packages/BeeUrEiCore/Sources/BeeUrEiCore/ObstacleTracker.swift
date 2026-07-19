import Foundation

/// 一帧里对单个目标的观测（方位°[右为正]、距离米?、标签）。
public struct TrackObservation: Sendable, Equatable {
    public let label: String
    public let bearingDegrees: Double
    public let distanceMeters: Double?
    public let isHazard: Bool
    public init(label: String, bearingDegrees: Double, distanceMeters: Double?, isHazard: Bool = false) {
        self.label = label
        self.bearingDegrees = bearingDegrees
        self.distanceMeters = distanceMeters
        self.isHazard = isHazard
    }
}

/// 跟踪轨迹：稳定 ID + 平滑方位/距离 + 闭合速度 + 生命周期。
public final class ObstacleTrack: Identifiable {
    public let id: Int
    public private(set) var label: String
    public private(set) var bearingDegrees: Double
    public private(set) var isHazard: Bool
    public private(set) var hits: Int = 1
    public private(set) var misses: Int = 0
    public private(set) var confirmed: Bool = false
    private var range = AlphaBetaFilter(alpha: 0.5, beta: 0.15)
    private let bearingAlpha: Double
    /// 连续漏检累计的时长（秒）。再命中时把它并入本帧 dt 交给 α-β 滤波——否则滤波以为距上次测量只过了
    /// 一帧，会把"漏检期间目标真实移动的位移"当成单帧位移，闭合速度**暴涨约 ×(漏检帧数+1)**（TTC 被
    /// 严重低估、误触急迫告警）。命中即清零。安全攸关：闭合速度→TTC→避障急迫度。
    private var missedDt: Double = 0

    init(id: Int, obs: TrackObservation, bearingAlpha: Double, confirmHits: Int) {
        self.id = id
        self.label = obs.label
        self.bearingDegrees = obs.bearingDegrees
        self.isHazard = obs.isHazard
        self.bearingAlpha = bearingAlpha
        self.confirmed = 1 >= confirmHits // confirmHits<=1 时首帧即确认
        if let d = obs.distanceMeters { range.update(measurement: d, dt: 0) }
    }

    /// 平滑后的距离（米）。无观测过则 nil。
    public var distanceMeters: Double? { range.isInitialized ? range.position : nil }
    /// 闭合速度（米/秒，靠近为正）。
    public var closingSpeed: Double { -range.velocity }
    /// 碰撞时间（秒）。不接近/未知 → nil。
    public var timeToCollision: Double? {
        guard let d = distanceMeters else { return nil }
        return TimeToCollision.seconds(distanceMeters: d, closingSpeed: closingSpeed)
    }

    func matched(_ obs: TrackObservation, dt: Double, confirmHits: Int) {
        hits += 1
        misses = 0
        // 刻意**不**用 obs.label 覆盖 label：关联门是"同组"，组内标签逐帧抖动（车辆/卡车/公交车）不应
        // 让本轨迹显示名跟着抖（否则播报与 announcePolicy 的 targetKey 每帧变、连珠重播）。保留首次确立的
        // 标签，稳定播报。默认精确关联时 obs.label 恒等于 label，此处本就是 no-op（对既有行为零影响）。
        isHazard = obs.isHazard
        bearingDegrees = ObstacleTracker.emaAngle(bearingDegrees, obs.bearingDegrees, alpha: bearingAlpha)
        // 并入漏检累计时长：再命中时按"距上次测量的真实间隔"更新滤波，闭合速度不因漏检而暴涨。
        if let d = obs.distanceMeters { range.update(measurement: d, dt: dt + missedDt) }
        missedDt = 0
        if hits >= confirmHits { confirmed = true }
    }

    func missed(dt: Double) { misses += 1; missedDt += dt.isFinite ? dt : 0 }
}

/// 轻量多目标跟踪（ByteTrack 思路简化）：贪心方位关联 + tentative/confirmed/lost 生命周期。
/// 消除逐帧闪烁、保 ID、容忍短暂漏检。纯逻辑，可单测。
public final class ObstacleTracker {
    public let confirmHits: Int
    public let maxMisses: Int
    public let gateDegrees: Double
    public let bearingAlpha: Double
    /// 关联"同组"判定：默认精确相等。上层可注入更宽的分组（如把车辆/卡车/公交车视为同组，见
    /// LabelCatalog.sameTrackingGroup），以吸收 YOLO 逐帧类别抖动、避免同一逼近目标被碎成多条轨迹
    /// （距离低估、确认延迟——安全攸关，见安全复审）。
    private let sameGroup: @Sendable (String, String) -> Bool

    private var tracks: [ObstacleTrack] = []
    private var nextId = 1

    public init(confirmHits: Int = 2, maxMisses: Int = 5, gateDegrees: Double = 18, bearingAlpha: Double = 0.5,
                sameGroup: @escaping @Sendable (String, String) -> Bool = { $0 == $1 }) {
        self.confirmHits = confirmHits
        self.maxMisses = maxMisses
        self.gateDegrees = gateDegrees
        self.bearingAlpha = bearingAlpha
        self.sameGroup = sameGroup
    }

    /// 喂入一帧观测，更新所有轨迹，返回当前 confirmed 轨迹。
    @discardableResult
    public func update(_ observations: [TrackObservation], dt: Double) -> [ObstacleTrack] {
        var used = Set<Int>()
        // 已确认的优先关联，避免新目标抢占。
        for track in tracks.sorted(by: { ($0.confirmed ? 0 : 1, $0.id) < ($1.confirmed ? 0 : 1, $1.id) }) {
            var best: Int?
            var bestDiff = gateDegrees
            for (j, obs) in observations.enumerated() where !used.contains(j) && sameGroup(obs.label, track.label) {
                let diff = Self.angularDistance(track.bearingDegrees, obs.bearingDegrees)
                if diff <= bestDiff { bestDiff = diff; best = j }
            }
            if let j = best {
                used.insert(j)
                track.matched(observations[j], dt: dt, confirmHits: confirmHits)
            } else {
                track.missed(dt: dt)
            }
        }
        // 未匹配观测 → 新轨迹。
        for (j, obs) in observations.enumerated() where !used.contains(j) {
            tracks.append(ObstacleTrack(id: nextId, obs: obs, bearingAlpha: bearingAlpha, confirmHits: confirmHits))
            nextId += 1
        }
        // 丢失过久的轨迹移除。
        tracks.removeAll { $0.misses > maxMisses }
        return confirmedTracks
    }

    public var confirmedTracks: [ObstacleTrack] { tracks.filter { $0.confirmed } }
    public var allTracks: [ObstacleTrack] { tracks }

    public func reset() { tracks.removeAll(); nextId = 1 }

    /// 角度环绕距离（度）。
    static func angularDistance(_ a: Double, _ b: Double) -> Double {
        let d = abs(a - b).truncatingRemainder(dividingBy: 360)
        return min(d, 360 - d)
    }

    /// 角度圆形 EMA（处理环绕）。
    static func emaAngle(_ current: Double, _ new: Double, alpha: Double) -> Double {
        let cr = current * .pi / 180, nr = new * .pi / 180
        let x = (1 - alpha) * cos(cr) + alpha * cos(nr)
        let y = (1 - alpha) * sin(cr) + alpha * sin(nr)
        return atan2(y, x) * 180 / .pi
    }
}
