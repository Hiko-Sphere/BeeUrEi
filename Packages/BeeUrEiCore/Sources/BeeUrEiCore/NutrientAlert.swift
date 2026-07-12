import Foundation

/// 个人化营养预警（纯逻辑，可单测）：把用户**关注**的营养素与扫码产品的逐营养素含量档比对，命中 high 即预警。
/// 盲人看不到营养标签；糖尿病者关注糖、高血压者关注盐——对标 Yuka/Spoonful 的营养灯，但对"看不见标签"者
/// 是健康管理刚需。是 iter291 过敏原预警的姊妹（同一"个人化食品健康提醒"能力）。
///
/// 安全/设计红线（与 AllergenAlert 一致）：
/// - **只报 high**（moderate/low 不预警——既有全量 nutrientLevels 播报已覆盖）；
/// - 是**叠加**在既有全量含量播报之上的额外醒目提醒，绝不替代（即便本比对漏判，用户仍听得到完整含量档，fail-safe）；
/// - flagged 为空 → 无预警；无交集 → 无预警（不因"没命中"报任何"健康"结论）。
public enum NutrientAlert {
    /// 用户关注的营养素中，本产品含量档为 **high** 的那些（canonical key，如 "sugars"/"salt"）。
    /// 大小写不敏感比较档位；按 `order`（调用方给的固定 canonical 次序）返回以保证确定性、可测。
    public static func highFlagged(levels: [String: String], flagged: Set<String>, order: [String]) -> [String] {
        guard !flagged.isEmpty else { return [] }
        let flaggedLower = Set(flagged.map { $0.lowercased() })
        return order.filter { key in
            flaggedLower.contains(key.lowercased()) && levels[key]?.lowercased() == "high"
        }
    }
}
