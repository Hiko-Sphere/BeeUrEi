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

    /// 前置红/黄相位的**最短驻留**（秒）：只有绿灯之前那段红/黄相位持续 ≥ 此时长，才认这段绿是"亲见新绿"。
    /// 用于挡掉稳定态里偶发的 1–2 帧红/黄误判（眩光/车灯/遮挡）——真实信号周期里黄+红相长达数十秒，此门槛
    /// （默认 3s）远高于抖动、远低于任何真实红相，既拒毛刺又不误拒真周期。**否则单帧黄误判会把陈旧绿重新
    /// 武装成 crossNow＝假安心，让盲人踏进随时会变红的绿灯**（对抗复审 HIGH）。宁可偶尔多等一轮（安全），
    /// 绝不在毛刺后误判新绿。
    public let minRedYellowDwellSeconds: TimeInterval

    private var lastConfirmed: TrafficLightState = .unknown
    private var greenIsFresh = false
    private var greenStartedAt: TimeInterval = 0
    private var nonGreenSince: TimeInterval?   // 当前这段"非绿"连续相位的起始时刻；nil=尚未观察到非绿相

    public init(freshWindow: TimeInterval = 5, minRedYellowDwellSeconds: TimeInterval = 3) {
        self.freshWindow = max(0, freshWindow)
        self.minRedYellowDwellSeconds = max(0, minRedYellowDwellSeconds)
    }

    /// 喂入本次**已稳定**的 confirmed 状态与单调递增时间戳（秒），返回当前起步建议。
    @discardableResult
    public func update(confirmed: TrafficLightState, at t: TimeInterval) -> Advice {
        if confirmed == .green {
            if lastConfirmed != .green {
                // 进入新的一段绿：只有见证 红/黄 → 绿 的跳变、**且那段红/黄相位够长**才算"新绿"。
                // unknown → 绿 视为"半路赶到"（很可能一直是绿、只是先前判不出），保守当陈旧绿。
                // dwell = 本次绿之前那段连续非绿相位的持续时长；未观察到非绿相(nonGreenSince=nil)→dwell=0。
                // 够长门槛挡掉稳定绿里 1–2 帧红/黄误判把陈旧绿误武装成新绿（对抗复审 HIGH）。
                let priorWasRedYellow = (lastConfirmed == .red || lastConfirmed == .yellow)
                let priorDwell = nonGreenSince.map { t - $0 } ?? 0
                greenIsFresh = priorWasRedYellow && priorDwell >= minRedYellowDwellSeconds
                greenStartedAt = t
            }
            // 同一段绿持续（green → green）：保持既有 fresh 判定与起始时刻不变。
        } else {
            // 非绿（红/黄/未知）：开始/延续对这段非绿相位计时——从"刚离开绿"或首次出现非绿那刻起，
            // 跨 yellow→red 不重置（一整段非绿的总驻留才是判据）。
            if lastConfirmed == .green || nonGreenSince == nil {
                nonGreenSince = t
            }
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
        nonGreenSince = nil
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
