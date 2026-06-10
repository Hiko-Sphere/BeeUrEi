import Foundation

/// 行走中路名变化播报判定（纯逻辑，可单测）。VoiceVista/Soundscape 的"路名 callout"：
/// 走到新路自动说"进入 X 路"，帮助保持方向感。反向地理编码由 App 侧节流调用；
/// 这里只负责"何时值得说"：路名非空、确实变了、且距上次播报 ≥ 最小间隔。
/// GPS 在路口漂移把 A↔B 来回跳时，最小间隔挡住连环播报；漂回已播路名不重复播。
public struct RoadAnnouncer: Sendable {
    public let minInterval: TimeInterval
    private var lastAnnounced: String?
    private var lastAnnounceAt: TimeInterval?

    public init(minInterval: TimeInterval = 20) {
        self.minInterval = minInterval
    }

    /// road：本次反向地理编码得到的路名（可空）。返回需要播报的路名；nil = 这次不播。
    /// 间隔内的变化只压制不记账——之后再次见到同一新路名仍会播（不会永久丢失）。
    public mutating func update(road: String?, now: TimeInterval) -> String? {
        guard let road, !road.isEmpty else { return nil }
        guard road != lastAnnounced else { return nil }
        if let t = lastAnnounceAt, now - t < minInterval { return nil }
        lastAnnounced = road
        lastAnnounceAt = now
        return road
    }
}
