import Foundation

/// 已规划路线的缓存条目（断网降级，Waymap 全离线导航对标）。
/// 引导执行本就全端侧（GPS+罗盘+本地折线）；断网断的只是「规划」这一步——规划成功即缓存，
/// 失败时同目的地同地区的缓存可直接顶上。
/// ⚠️ 坐标系随地区：regionRaw=="china" 的条目坐标是 GCJ-02（高德规划产物），"overseas" 是 WGS-84；
/// 执行时必须还原为**同一地区语义**（china 条目仍走 GPS→GCJ 纠偏路径），跨地区匹配是坐标系错配，禁止。
public struct CachedPlannedRoute: Codable, Equatable, Sendable {
    public struct Maneuver: Codable, Equatable, Sendable {
        public let lat: Double
        public let lon: Double
        public let instruction: String
        public init(lat: Double, lon: Double, instruction: String) {
            self.lat = lat; self.lon = lon; self.instruction = instruction
        }
    }
    public let key: String        // 归一化目的地（normalizeKey）
    public let regionRaw: String  // "china" / "overseas"
    public let maneuvers: [Maneuver]
    public let route: [Coordinate]
    public let destLat: Double
    public let destLon: Double
    public let savedAtMs: Double
    public init(key: String, regionRaw: String, maneuvers: [Maneuver], route: [Coordinate],
                destLat: Double, destLon: Double, savedAtMs: Double) {
        self.key = key; self.regionRaw = regionRaw; self.maneuvers = maneuvers; self.route = route
        self.destLat = destLat; self.destLon = destLon; self.savedAtMs = savedAtMs
    }
}

/// 缓存的纯逻辑（LRU/匹配/时效）——存储壳（UserDefaults JSON）在 App 层。
public enum PlannedRouteCacheLogic {
    /// 目的地归一化：trim + 小写（"家乐福 " 与 "家乐福" 是同一目的地；中文无大小写、对英文目的地生效）。
    public static func normalizeKey(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// 写入：同 key+region 覆盖并置顶（列表头=最新）；超上限淘汰最旧。
    public static func upserting(_ entry: CachedPlannedRoute, into list: [CachedPlannedRoute],
                                 cap: Int = 10) -> [CachedPlannedRoute] {
        var next = list.filter { !($0.key == entry.key && $0.regionRaw == entry.regionRaw) }
        next.insert(entry, at: 0)
        if next.count > cap { next.removeLast(next.count - cap) }
        return next
    }

    /// 查找：同 key+同地区+未过期（默认 14 天——道路会变，越旧越不可信；过期条目宁缺勿给）。
    public static func lookup(key: String, regionRaw: String, in list: [CachedPlannedRoute],
                              nowMs: Double, maxAgeMs: Double = 14 * 86_400_000) -> CachedPlannedRoute? {
        list.first { $0.key == key && $0.regionRaw == regionRaw && nowMs - $0.savedAtMs <= maxAgeMs && $0.savedAtMs <= nowMs }
    }
}
