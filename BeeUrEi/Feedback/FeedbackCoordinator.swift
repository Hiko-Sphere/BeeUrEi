import Foundation

/// 反馈输出「出口」抽象——今天路由到手机本机；未来也可路由到外接设备（见 PLAN §12）。
protocol FeedbackSink: AnyObject {
    func play(_ event: FeedbackEvent)
}

/// 反馈协调器：用已单测的核心 `FeedbackArbiter` 做优先级抢占，再分发到各通道。
/// 语音通道播报结束时回调 `finishCurrent()` 释放通道。
final class FeedbackCoordinator {
    private var arbiter = FeedbackArbiter()
    private let verbosityPolicy = VerbosityPolicy()
    private let sinks: [FeedbackSink]

    init(sinks: [FeedbackSink]) {
        self.sinks = sinks
    }

    /// 提交事件；先按"播报详略"门控（安静模式只放危险），再用核心仲裁做优先级抢占。
    /// 返回该事件是否**真正进入播报**（被详略或更高优先级仲裁拦下则返回 false）——
    /// 调用方据此决定是否记账(isSpeaking/承诺式播报)，避免被吞事件造成"以为已播"而静音真实危险（见审查 #3/#4）。
    @discardableResult
    func submit(_ event: FeedbackEvent) -> Bool {
        let level = FeedbackVerbosity(rawValue: FeatureSettings().verbosity) ?? .full
        guard verbosityPolicy.shouldSpeak(priority: event.priority, verbosity: level) else { return false }
        guard arbiter.shouldPlay(event) else { return false }
        for sink in sinks {
            sink.play(event)
        }
        return true
    }

    /// 当前播报结束（由语音通道回调）。
    func finishCurrent() {
        arbiter.finish()
    }
}
