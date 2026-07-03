import Foundation

/// 已规划路线的本地持久化（UserDefaults JSON）。逻辑（LRU/匹配/14 天时效）在核心
/// `PlannedRouteCacheLogic`（已测）。断网/服务失败时导航降级用（Waymap 全离线对标）。
struct PlannedRouteCacheStore {
    private let key = "nav.plannedRouteCache"
    private let defaults = UserDefaults.standard

    var all: [CachedPlannedRoute] {
        guard let data = defaults.data(forKey: key),
              let list = try? JSONDecoder().decode([CachedPlannedRoute].self, from: data) else { return [] }
        return list
    }

    func save(_ entry: CachedPlannedRoute) {
        let next = PlannedRouteCacheLogic.upserting(entry, into: all)
        if let data = try? JSONEncoder().encode(next) { defaults.set(data, forKey: key) }
    }

    func find(destination: String, regionRaw: String) -> CachedPlannedRoute? {
        PlannedRouteCacheLogic.lookup(key: PlannedRouteCacheLogic.normalizeKey(destination),
                                      regionRaw: regionRaw, in: all,
                                      nowMs: Date().timeIntervalSince1970 * 1000)
    }
}
