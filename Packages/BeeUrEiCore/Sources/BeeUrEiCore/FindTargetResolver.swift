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

        // ① 精确匹配优先（跨两表）：已教精确 → 类别精确。
        // 否则模糊命中的已教物会盖过精确命中的类别（如已教"杯子架"在用户说"杯子"时抢过精确类别"杯子"，对抗复审 MED）。
        if let t = taughtNames.first(where: { norm($0) == q }) { return .taught(t) }
        if let c = categories.first(where: { norm($0.name) == q }) { return .category(c.label) }
        // ② 再模糊（双向包含）：已教模糊 → 类别模糊（同层已教优先，本人的东西）。
        if let t = taughtNames.first(where: { contains(norm($0), q) }) { return .taught(t) }
        if let c = categories.first(where: { contains(norm($0.name), q) }) { return .category(c.label) }
        return .none
    }

    private static func norm(_ s: String) -> String {
        s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
    /// 双向包含（"我的钥匙"含"钥匙"；"keys"含于"my keys"）。**内子串须 ≥2 字符**——否则 1 字候选（"机"含于"手机"）
    /// 会劫持无关查询；**含 ASCII 字母的内子串还须落在词边界**——否则 "key" 会命中 "monkey"（对抗复审 MED）。
    private static func contains(_ candidate: String, _ query: String) -> Bool {
        guard candidate.count >= 2, query.count >= 2 else { return false }
        if candidate.contains(query), boundarySafe(query, in: candidate) { return true }   // 查询是内子串
        if query.contains(candidate), boundarySafe(candidate, in: query) { return true }   // 候选是内子串
        return false
    }
    /// 内子串 sub 若含 ASCII 字母，须在容器 str 中落在词边界（前后非字母/数字）；纯 CJK 子串无词边界概念，恒 true。
    private static func boundarySafe(_ sub: String, in str: String) -> Bool {
        guard sub.contains(where: { $0.isASCII && $0.isLetter }) else { return true }
        func isWord(_ c: Character) -> Bool { c.isASCII && (c.isLetter || c.isNumber) }
        var lo = str.startIndex
        while let r = str.range(of: sub, range: lo..<str.endIndex) {
            let leftOK = r.lowerBound == str.startIndex || !isWord(str[str.index(before: r.lowerBound)])
            let rightOK = r.upperBound == str.endIndex || !isWord(str[r.upperBound])
            if leftOK && rightOK { return true }
            lo = str.index(after: r.lowerBound)
        }
        return false
    }
}
