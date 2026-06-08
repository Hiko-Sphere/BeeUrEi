import Foundation

/// 常用目的地列表逻辑（纯，可单测）：新增即去重 + 置顶（最近用在前）+ 限量。
/// 盲人输入目的地费力，保存常去地点以便一键导航。
public enum FavoritePlaces {
    public static func adding(_ name: String, to list: [String], cap: Int = 8) -> [String] {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return list }
        var result = list.filter { $0 != trimmed }
        result.insert(trimmed, at: 0)
        if result.count > cap { result = Array(result.prefix(cap)) }
        return result
    }

    public static func removing(_ name: String, from list: [String]) -> [String] {
        list.filter { $0 != name }
    }
}
