import Foundation

/// 反馈输出「出口」抽象——今天路由到手机本机；未来也可路由到外接设备（见 PLAN §12）。
protocol FeedbackSink: AnyObject {
    func play(_ event: FeedbackEvent)
}

/// 反馈协调器：用已单测的核心 `FeedbackArbiter` 做优先级抢占，再分发到各通道。
/// 语音通道播报结束时回调 `finishCurrent()` 释放通道。
final class FeedbackCoordinator {
    private var arbiter = FeedbackArbiter()
    private let sinks: [FeedbackSink]

    init(sinks: [FeedbackSink]) {
        self.sinks = sinks
    }

    /// 提交事件；仅当核心仲裁允许（抢占/空闲）时才真正分发播放。
    func submit(_ event: FeedbackEvent) {
        guard arbiter.shouldPlay(event) else { return }
        for sink in sinks {
            sink.play(event)
        }
    }

    /// 当前播报结束（由语音通道回调）。
    func finishCurrent() {
        arbiter.finish()
    }
}
