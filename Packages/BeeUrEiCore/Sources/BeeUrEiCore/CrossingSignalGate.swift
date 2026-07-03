import Foundation

/// 过街「起步」门控（安全攸关，纯逻辑可单测）：裁决**此刻能否起步过街**。
///
/// 行业原则（无障碍过街信号 APS / 定向行走教学 / Oko 等）：**只在"刚变绿"时起步**——
/// 即亲眼见证信号由红/黄跳变到绿，才知道整个通行相位在前方、够时间走完整条斑马线。
/// **半路赶到时灯已是绿（stale green）无法保证剩余时间**，起步后很可能走到一半变红、踩进车流；
/// 明眼人靠人行灯倒计时/闪烁手掌判断剩余秒数，盲人没有，故必须靠"是否见证了这段新绿的起始"来把关。
///
/// 与 `TrafficLightClassifier`（判色）+ `TrafficLightStabilizer`（时间稳定化）配套：
/// 喂入**已稳定的 confirmed 状态** + 单调时间戳，查询 `advice(at:)`。
/// 本门控只补充"新绿 / 陈旧绿"这一层判断；红/黄/未知返回 nil，由调用方用
/// `TrafficLightClassifier.hint` 播报具体颜色，避免重复。
///
/// 边界：只裁决"是否起步"，**不管过街途中**——一旦已在斑马线上，途中变灯是另一套流程
/// （需知用户已在路中，属设备/情境层），不由本门控处理。
public final class CrossingSignalGate {
    public enum Advice: String, Sendable, Equatable {
        case crossNow          // 新绿且在稳定步行窗内：可起步
        case waitForNextGreen  // 已是绿灯但非亲见起始、或新绿已超窗：等下一个绿灯再走
        case wait              // 红 / 黄：等待
        case unknown           // 判不出
    }

    /// 新绿有效窗口（秒）：MUTCD 稳定"步行(WALK)"相位下限约 4–7s，此后进入"闪烁禁止通行"清空相位
    /// （此时应已在路中、而非在路缘起步）。起步须落在稳定绿相位内；**即便亲见新绿，超此窗也保守
    /// 降级为"等下一个绿灯"**——宁可多等一轮（白等，安全），绝不在相位末尾起步（走不完，致命）。
    /// 默认 5s 偏保守；盲人步速慢、清空相位按明眼人标定，起步窗应取相位下限而非全程。
    public let freshWindow: TimeInterval

    private var lastConfirmed: TrafficLightState = .unknown
    private var greenIsFresh = false
    private var greenStartedAt: TimeInterval = 0

    public init(freshWindow: TimeInterval = 5) {
        self.freshWindow = max(0, freshWindow)
    }

    /// 喂入本次**已稳定**的 confirmed 状态与单调递增时间戳（秒），返回当前起步建议。
    @discardableResult
    public func update(confirmed: TrafficLightState, at t: TimeInterval) -> Advice {
        if confirmed == .green {
            if lastConfirmed != .green {
                // 进入新的一段绿：只有见证 红/黄 → 绿 的跳变才算"新绿"。
                // unknown → 绿 视为"半路赶到"（很可能一直是绿、只是先前判不出），保守当陈旧绿。
                greenIsFresh = (lastConfirmed == .red || lastConfirmed == .yellow)
                greenStartedAt = t
            }
            // 同一段绿持续（green → green）：保持既有 fresh 判定与起始时刻不变。
        }
        lastConfirmed = confirmed
        return advice(at: t)
    }

    /// 只读查询当前建议（不改状态；供无新帧时按时间轮询——新绿会随时间超窗而降级）。
    public func advice(at t: TimeInterval) -> Advice {
        switch lastConfirmed {
        case .red, .yellow: return .wait
        case .unknown: return .unknown
        case .green:
            guard greenIsFresh else { return .waitForNextGreen }
            let elapsed = max(0, t - greenStartedAt)
            return elapsed <= freshWindow ? .crossNow : .waitForNextGreen
        }
    }

    public func reset() {
        lastConfirmed = .unknown
        greenIsFresh = false
        greenStartedAt = 0
    }

    /// 起步建议的播报语；红/黄/未知返回 nil（由 `TrafficLightClassifier.hint` 播报具体色，避免重复）。
    public func hint(_ advice: Advice, language: Language = .zh) -> String? {
        switch advice {
        case .crossNow: return SpokenStrings.crossFreshGreen(language)
        case .waitForNextGreen: return SpokenStrings.crossWaitNextGreen(language)
        case .wait, .unknown: return nil
        }
    }
}
