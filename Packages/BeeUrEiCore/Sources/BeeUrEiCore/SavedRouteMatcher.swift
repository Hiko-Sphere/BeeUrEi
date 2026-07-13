import Foundation

/// 语音说出的路线名 → 已保存路线的模糊匹配（纯逻辑，可单测）。
/// 语音识别与用户记忆都不精确（"家到菜场" vs 存名"家到菜市场"、大小写/空格/"的"差异），
/// 归一化后 全等优先、其次**唯一**互向包含；0 个或 ≥2 个候选返回 nil（宁可读出全部路线名让用户再说一遍，
/// 也绝不猜错一条让盲人走错路——人工路线是安全路径，选错路线比选不中更危险）。
public enum SavedRouteMatcher {
    static func normalize(_ s: String) -> String {
        s.lowercased()
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "的", with: "")
    }

    /// 返回唯一匹配的路线索引；无匹配或歧义（多条命中）→ nil。
    /// 全等（归一化后）优先——重名路线取首条（语音无从区分同名，取首与列表序一致）。
    public static func match(spoken: String, names: [String]) -> Int? {
        let s = normalize(spoken)
        guard !s.isEmpty else { return nil }
        let norm = names.map(normalize)
        if let i = norm.firstIndex(of: s) { return i }
        let hits = norm.enumerated()
            .filter { !$0.element.isEmpty && ($0.element.contains(s) || s.contains($0.element)) }
            .map(\.offset)
        return hits.count == 1 ? hits[0] : nil
    }
}
