import Foundation

/// 媒体引擎抽象（WebRTC）。把"真实音视频"与"信令/UI"解耦。
///
/// 视频隐私模型（见 BACKEND_PLAN §5）：
/// - 协助者(asCaller=false)：不发视频、收对方视频 + 双向语音。
/// - 视障侧(asCaller=true)：默认只发音频；`setLocalVideoSending(true)` 时才发视频轨。
protocol MediaEngine: AnyObject {
    func start(asCaller: Bool)
    func setLocalVideoSending(_ sending: Bool)
    func stop()
}

/// 占位实现：编译可用、逻辑/UI/信令可端到端联调；真实 RTCPeerConnection 需引入
/// WebRTC SPM 包并在双真机验证（外部依赖，见 PLAN §13.3）。
final class StubMediaEngine: MediaEngine {
    func start(asCaller: Bool) {}
    func setLocalVideoSending(_ sending: Bool) {}
    func stop() {}
}
