import Foundation
import CoreMotion

/// AirPods 头部追踪（`CMHeadphoneMotionManager`），增强空间音方向（见 PLAN §14 Q8）。
/// 仅作增强：无兼容耳机时 `isAvailable == false`，调用方回退到手机朝向。
/// 配合核心 `BeaconDirection.relative(headingDegrees:headYawDegrees:bearingDegrees:)` 使用。
final class HeadTracker {
    private let manager = CMHeadphoneMotionManager()

    /// 头部偏航角（度）回调。
    var onYaw: ((Double) -> Void)?

    var isAvailable: Bool { manager.isDeviceMotionAvailable }

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let motion else { return }
            self?.onYaw?(motion.attitude.yaw * 180 / .pi)
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }
}
