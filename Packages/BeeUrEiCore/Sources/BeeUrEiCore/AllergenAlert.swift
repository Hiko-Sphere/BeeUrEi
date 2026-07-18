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
    /// 具体过敏原 → 其所属 EU 大类（用户勾选的是 EU 14 大类，见 FramingStrings.selectableAllergens；而 OFF 的
    /// allergens_tags 常给**具体品类**——产品标 "almonds"、用户只标了大类 "nuts"）。不做此归并则个人化预警**漏判**：
    /// 树坚果过敏者扫到标"杏仁"的产品，醒目预警不触发（全量清单仍会读到，故不致命，但个人化提醒失效——安全价值受损）。
    /// **只做"具体 → 大类"单向归并**（杏仁⊂坚果、小麦⊂麸质），映射均为分类学正确的包含关系，故只**增加**命中、
    /// 绝不误报（花生≠树坚果，不在表中；泛"gluten"不反推为"wheat"）。键用 OFF 规范拼写 + 常见变体；大类值须与
    /// 用户键（selectableAllergens）逐字一致。不全也无妨（fail-safe：全量清单照读）。
    static let categoryOfSpecific: [String: String] = [
        // 树坚果具体品类 → "nuts"
        "almonds": "nuts", "hazelnuts": "nuts", "walnuts": "nuts", "cashew-nuts": "nuts", "cashews": "nuts",
        "pecan-nuts": "nuts", "pecans": "nuts", "pistachios": "nuts", "pistachio-nuts": "nuts", "pistachio": "nuts",
        "brazil-nuts": "nuts", "macadamia-nuts": "nuts", "macadamia": "nuts", "queensland-nuts": "nuts", "pine-nuts": "nuts",
        // 含麸质谷物 → "gluten"（小麦另有独立键，故 wheat 同时命中 "wheat" 与 "gluten"）
        "wheat": "gluten", "barley": "gluten", "rye": "gluten", "oats": "gluten", "spelt": "gluten",
        "kamut": "gluten", "triticale": "gluten",
        // 甲壳类具体 → "crustaceans"
        "shrimps": "crustaceans", "prawns": "crustaceans", "crab": "crustaceans", "lobster": "crustaceans",
        "crayfish": "crustaceans", "langoustine": "crustaceans",
        // 软体动物具体 → "molluscs"
        "mussels": "molluscs", "oysters": "molluscs", "clams": "molluscs", "scallops": "molluscs",
        "squid": "molluscs", "octopus": "molluscs", "snails": "molluscs", "cuttlefish": "molluscs",
        // 鱼类具体 → "fish"（常见品类；漏收的稀有鱼仍走全量清单）
        "salmon": "fish", "tuna": "fish", "cod": "fish", "mackerel": "fish", "sardines": "fish",
        "anchovies": "fish", "herring": "fish", "trout": "fish", "haddock": "fish", "hake": "fish", "pollock": "fish",
        // 大豆/芝麻别名 → 规范键
        "soy": "soybeans", "soya": "soybeans", "sesame": "sesame-seeds",
    ]

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
                // 命中：用户直接标了该键；或该键是某大类的具体品类、而用户标了那个大类（如产品"almonds"∈用户"nuts"）。
                // 报回**产品标注的原键**（保留包装文本，与全量清单一致），只是把"是否算命中"扩到大类。
                let hit = user.contains(k) || (categoryOfSpecific[k].map(user.contains) ?? false)
                if hit, seen.insert(k).inserted { out.append(k) }
            }
            return out
        }
        let contained = hits(productAllergens)
        let containedSet = Set(contained)
        let traces = hits(productTraces).filter { !containedSet.contains($0) } // 含有更严重，不在微量里重复报
        return (contained, traces)
    }
}
