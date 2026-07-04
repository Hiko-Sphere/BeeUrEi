import Foundation

/// 障碍时间稳定化（迟滞），消除手抖/身体抖导致的检测闪烁（见用户反馈）。
///
/// 规则：
/// - 首次检测到 → 立即作为当前目标（不延迟报警）。
/// - 已有目标时来了**不同**目标 → 需连续确认 `confirmFrames` 帧才切换（防抖动误切）。
/// - 某帧没检测到 → 迟滞保留，连续丢失超过 `releaseFrames` 帧才清除。
/// 这样当前目标保持稳定，上层就能"只在目标变化时播报、把话说完"。
public final class ObstacleStabilizer {
    public let confirmFrames: Int
    public let releaseFrames: Int

    private var held: Obstacle?
    private var missCount = 0
    private var candidate: Obstacle?
    private var candidateCount = 0

    public init(confirmFrames: Int = 2, releaseFrames: Int = 3) {
        self.confirmFrames = max(1, confirmFrames)
        self.releaseFrames = max(0, releaseFrames)
    }

    public var current: Obstacle? { held }

    /// 输入这一帧的候选障碍（可 nil），返回当前应播报/展示的稳定障碍（可 nil）。
    @discardableResult
    public func update(_ obstacle: Obstacle?) -> Obstacle? {
        guard let obs = obstacle else {
            missCount += 1
            candidate = nil
            candidateCount = 0
            if missCount > releaseFrames { held = nil }
            return held
        }

        // 同一目标：刷新距离/方向，"未再确认"计数清零。
        if let h = held, Self.isSame(h, obs) {
            held = obs
            missCount = 0
            candidate = nil
            candidateCount = 0
            return held
        }

        // 尚无目标：立即采用。
        if held == nil {
            held = obs
            missCount = 0
            candidate = nil
            candidateCount = 0
            return held
        }

        // 有旧目标、这一帧却是**不同**目标：旧目标本帧未获再确认 → 计入迟滞。
        // 关键：missCount 计"held 距上次被确认过了几帧"，**不能**因本帧检测到别的障碍就清零——否则当 held
        // 已消失、而另有两个障碍逐帧交替出现（B,C,B,C…）时，交替候选永远凑不满 confirmFrames、missCount 又被
        // 每帧检测清零，held 会**永久卡在已消失的旧目标上**（陈旧误报 + 漏报眼前真障碍，杂乱环境下的安全隐患）。
        missCount += 1
        if missCount > releaseFrames {
            // 旧目标已连续 >releaseFrames 帧未再被看到 → 判定已消失。眼前就有真实障碍 obs，直接采用
            // （不返回 nil：避免 1 帧假"畅通"空档，让上层立即拿到当前真障碍）。
            held = obs
            missCount = 0
            candidate = nil
            candidateCount = 0
            return held
        }

        // 旧目标尚未判定消失：不同目标需连续确认 confirmFrames 帧才切换（防抖动误切）。
        if let c = candidate, Self.isSame(c, obs) {
            candidate = obs
            candidateCount += 1
        } else {
            candidate = obs
            candidateCount = 1
        }
        if candidateCount >= confirmFrames {
            held = obs
            missCount = 0
            candidate = nil
            candidateCount = 0
        }
        return held
    }

    static func isSame(_ a: Obstacle, _ b: Obstacle) -> Bool {
        a.label == b.label && hourDistance(a.clock.hour, b.clock.hour) <= 1
    }

    /// 时钟点的环形距离（11 与 1 相距 2；12 与 1 相距 1）。
    static func hourDistance(_ a: Int, _ b: Int) -> Int {
        let d = abs(a - b) % 12
        return min(d, 12 - d)
    }
}
