import Foundation

/// 个人化过敏原预警（纯逻辑，可单测）：把用户**自己标记**的过敏原与扫码所得产品的过敏原标注比对，命中即预警。
/// 盲人看不到包装、更读不出配料表——对标 Yuka/Spoonful 的过敏原提醒，但对"看不见标签"的人是**安全刚需**。
///
/// 安全红线（与 FramingStrings 过敏原播报一致）：
/// - **只在有交集时报警**，绝不因"无交集"报"安全/不含"——缺数据≠不含，假安心可致命；
/// - 本比对是**叠加**在既有"包装标注含有：X"全量播报之上的额外醒目提醒，绝不替代它——即便本比对漏判，
///   用户仍能听到完整过敏原清单（fail-safe，安全路径只增不减）；
/// - "标注含有"(contained) 与"可能含微量"(traces) **分开返回**——严重过敏者据此分级决策；含有里已命中的不在微量里重复。
public enum AllergenAlert {
    /// 用户过敏原（canonical key，如 "peanuts"/"milk"，与 OFF 规范化标签同一套键）∩ 产品标注。
    /// 大小写不敏感、去重、保持产品标注中的出现顺序（确定性、可测）。用户集为空 → 无预警（([],[])）。
    public static func matched(productAllergens: [String],
                               productTraces: [String],
                               userAllergens: Set<String>) -> (contained: [String], traces: [String]) {
        guard !userAllergens.isEmpty else { return ([], []) }
        let user = Set(userAllergens.map { $0.lowercased() })
        func hits(_ tags: [String]) -> [String] {
            var seen = Set<String>()
            var out: [String] = []
            for t in tags {
                let k = t.lowercased()
                if user.contains(k), seen.insert(k).inserted { out.append(k) }
            }
            return out
        }
        let contained = hits(productAllergens)
        let containedSet = Set(contained)
        let traces = hits(productTraces).filter { !containedSet.contains($0) } // 含有更严重，不在微量里重复报
        return (contained, traces)
    }
}
