import Foundation

/// 常用目的地本地持久化（UserDefaults）。逻辑(去重/置顶/限量)在核心 `FavoritePlaces`（已测）。
struct FavoritePlacesStore {
    private let key = "nav.favorites"
    private let defaults = UserDefaults.standard

    var all: [String] { defaults.stringArray(forKey: key) ?? [] }

    func add(_ name: String) {
        defaults.set(FavoritePlaces.adding(name, to: all), forKey: key)
    }

    func remove(_ name: String) {
        defaults.set(FavoritePlaces.removing(name, from: all), forKey: key)
    }
}
