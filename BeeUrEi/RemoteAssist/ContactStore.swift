import Foundation

/// 一个本地保存的亲友联系人（MVP：亲友名单定向呼叫，见 docs/PLAN.md §8.7）。
struct StoredContact: Codable, Identifiable, Equatable {
    let id: String
    var name: String
    var language: String
}

/// 亲友名单的本地持久化（UserDefaults + Codable）。在线状态来自未来的匹配后端，这里不持久化。
final class ContactStore {
    private let defaults: UserDefaults
    private let key = "remoteAssist.contacts"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> [StoredContact] {
        guard let data = defaults.data(forKey: key),
              let list = try? JSONDecoder().decode([StoredContact].self, from: data) else { return [] }
        return list
    }

    func save(_ list: [StoredContact]) {
        if let data = try? JSONEncoder().encode(list) {
            defaults.set(data, forKey: key)
        }
    }

    func add(_ contact: StoredContact) {
        var list = load()
        list.append(contact)
        save(list)
    }

    func remove(id: String) {
        save(load().filter { $0.id != id })
    }
}
