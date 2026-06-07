import Foundation

/// 【未来方向 · 占位】外接设备（眼镜/耳机，带相机+LiDAR）感知源。
///
/// 愿景：外部设备采集 → 经网络（如 Wi-Fi 直连 / 低延迟流）传到手机 →
/// 手机作为「算力机」跑端侧 AI → 把引导（语音/震动指令）回传外设播放。见 docs/PLAN.md §12。
///
/// 现在只占位，用来**固定架构边界**——真正实现涉及：传输协议、时间同步、
/// 相机/深度标定、带宽与延迟预算、断连降级（回退到手机自身传感器）。
/// 因为它同样实现 `FrameSource`，未来接入时上层无需改动。
final class ExternalDeviceSource: FrameSource {
    var onFrame: ((SensorFrame) -> Void)?
    var onStateChange: ((FrameSourceState) -> Void)?

    func start() {
        // TODO(未来): 建立与外接设备的连接，接收远端 SensorFrame 并通过 onFrame 上报。
        onStateChange?(.unsupported("外接设备支持尚未实现（未来方向，见 PLAN §12）"))
    }

    func stop() {}
}
