import Foundation

/// 反馈通道协议（F1）：把避障主链路（HomeViewModel）对各反馈组件的依赖收敛为协议，
/// 可注入 mock 单测——音频组件在构造期做 AVAudioEngine 图连接，无头测试环境必崩
/// （CoreAudio RPC abort），注入后测试零音频。生产默认实现与初始化时序完全不变。

/// 语音播报通道（兼作反馈分发 sink）。
protocol SpeechFeeding: FeedbackSink {
    var onFinish: (() -> Void)? { get set }
    func speakUserInitiated(_ text: String)
    func stopAll()
}

/// 接近声呐（倒车雷达式蜂鸣）。
protocol Sonifying: AnyObject {
    func update(_ cue: ProximityCue?)
    func stop()
}

/// 避障空间音提示（HRTF 方位音）。
protocol SpatialCueing: AnyObject {
    func playCue(azimuthDegrees: Float, distanceMeters: Double?)
    func setListenerYaw(_ yaw: Float)
    func stop()
}

/// 红绿灯节奏反馈（节奏音+震动）。
protocol CrossingSignaling: AnyObject {
    func update(_ state: TrafficLightState)
    func stop()
}

/// 反馈仲裁协调器。
protocol FeedbackCoordinating: AnyObject {
    @discardableResult
    func submit(_ event: FeedbackEvent) -> Bool
    func finishCurrent()
}

extension SpeechFeedback: SpeechFeeding {}
extension ProximitySonifier: Sonifying {}
extension SpatialAudioFeedback: SpatialCueing {}
extension CrossingSignalFeedback: CrossingSignaling {}
extension FeedbackCoordinator: FeedbackCoordinating {}
