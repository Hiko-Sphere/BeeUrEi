import Foundation
import CoreMotion

/// AirPods 头部追踪（`CMHeadphoneMotionManager`），增强空间音方向（见 PLAN §14 Q8）。
/// 仅作增强：无兼容耳机时 `isAvailable == false`，调用方回退到手机朝向。
/// 配合核心 `BeaconDirection.relative(headingDegrees:headYawDegrees:bearingDegrees:)` 使用。
final class HeadTracker {
    private let manager = CMHeadphoneMotionManager()

    /// 头部偏航角（度）回调。
    var onYaw: ((Double) -> Void)?
    /// 耳机断连/运动数据不可用时回调，让上层回退到"手机朝向驱动信标"（见审查 #14）。
    var onUnavailable: (() -> Void)?

    var isAvailable: Bool { manager.isDeviceMotionAvailable }

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, error in
            guard let self else { return }
            // 耳机中途断连/取下或出错：motion 为 nil 或有 error。通知上层回退，避免听者朝向冻结在陈旧值。
            guard error == nil, let motion else {
                self.onUnavailable?()
                return
            }
            self.onYaw?(motion.attitude.yaw * 180 / .pi)
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }
}
