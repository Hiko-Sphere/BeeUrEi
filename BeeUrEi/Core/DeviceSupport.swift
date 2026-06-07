import ARKit

/// 设备能力检查。BeeUrEi **硬性要求 LiDAR**（见 docs/PLAN.md §12.1）。
enum DeviceSupport {
    /// 是否具备 LiDAR 场景深度（sceneDepth）能力。
    /// 只有带 LiDAR 的 iPhone（12 Pro 及更新的 Pro 机型）返回 true。
    static var hasLiDAR: Bool {
        ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
    }
}
