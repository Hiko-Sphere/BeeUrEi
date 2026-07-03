import Foundation

/// 把用户说的物名解析成一次"找东西"动作（纯逻辑，可单测）。
/// 语音"找我的钥匙"里的"钥匙"需映射到：① 用户已教的个人物品（TaughtItemsStore）——优先，因为是本人的东西；
/// ② 通用可找类别（如椅子/瓶子，findableCategories 的本地化名）；③ 都不匹配 → none（上层提示"没有该物品，
/// 先教一下或换个常见物名"）。iOS 适配层把 taughtItems 与类别（label+本地化名）喂进来。
public enum FindResolution: Equatable, Sendable {
    case taught(String)    // 匹配到的已教物品名（原样，供 startFinding）
    case category(String)  // 匹配到的可找类别英文 label（供 startCategoryFind）
    case none
}

public enum FindTargetResolver {
    /// 解析。spoken=用户说的物名；taughtNames=已教物品名；categories=(label 英文, name 本地化名)。
    /// 匹配：先精确（大小写/空白无关），再双向包含（"钥匙"↔"我的钥匙"、"keys"↔"my keys"）。已教优先于类别。
    public static func resolve(spoken: String, taughtNames: [String], categories: [(label: String, name: String)]) -> FindResolution {
        let q = norm(spoken)
        guard !q.isEmpty else { return .none }

        // ① 已教物品（本人的东西）优先。
        if let t = taughtNames.first(where: { norm($0) == q })
            ?? taughtNames.first(where: { contains(norm($0), q) }) {
            return .taught(t)
        }
        // ② 通用类别（按本地化名匹配）。
        if let c = categories.first(where: { norm($0.name) == q })
            ?? categories.first(where: { contains(norm($0.name), q) }) {
            return .category(c.label)
        }
        return .none
    }

    private static func norm(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
    /// 双向包含：候选含查询、或查询含候选（"我的钥匙"含"钥匙"；"keys"含于"my keys"）。候选须非空防空串误配。
    private static func contains(_ candidate: String, _ query: String) -> Bool {
        !candidate.isEmpty && (candidate.contains(query) || query.contains(candidate))
    }
}
