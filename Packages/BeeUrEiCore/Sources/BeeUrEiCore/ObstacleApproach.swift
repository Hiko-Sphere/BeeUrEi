import Foundation

/// 障碍逼近紧迫度（纯逻辑，可单测）：跟踪到的障碍**即将碰上**时给一句可闻的紧迫前导（"小心！"），
/// 让盲人**听出**危险等级，而不只体现在打断行为里——静态电线杆与快速逼近的车/自行车此前措辞一样。
///
/// 判据用 **TTC（碰撞时间 = 距离 / 相对逼近速度）**，与业界（biped.ai 等）一致：TTC 阈值天然随速度伸缩
/// ——逼近越快、越早预警（8m/s 相对速度下 1.5s TTC=12m 处就提醒；1.5m/s 步速下才 2.25m）。
///
/// 保守：TTC 无效/为负（未在逼近、或在远离）→ `.normal`（绝不凭空制造紧迫感）。imminentBelow 为
/// 保守缺省，实时安全路径真机可调（与过街门控/绕行建议同范式）。仅**附加**前导，不改既有安全/打断逻辑。
public enum ObstacleApproach: Equatable, Sendable {
    case normal    // 静态或缓慢逼近：无额外措辞
    case imminent  // TTC 低于阈值：即将到达，加"小心！"前导

    /// timeToCollisionSeconds：ObstacleTracker 算出的碰撞时间（相对逼近速度 > 0 才有值）。
    public static func classify(timeToCollisionSeconds t: Double?, imminentBelow: Double = 1.5) -> ObstacleApproach {
        guard let t, t.isFinite, t >= 0 else { return .normal }
        return t < imminentBelow ? .imminent : .normal
    }

    /// 紧迫前导（拼在障碍播报**之前**）；`.normal` → nil（不添噪）。
    public func lead(_ language: Language = .zh) -> String? {
        switch self {
        case .imminent: return language == .zh ? "小心！" : "Careful — "
        case .normal: return nil
        }
    }

    /// 把前导拼到既有障碍播报之前（纯函数）：`.normal` 原样返回，`.imminent` 前置"小心！"。
    public func prepending(_ phrase: String, language: Language = .zh) -> String {
        guard let lead = lead(language) else { return phrase }
        return lead + phrase
    }
}
