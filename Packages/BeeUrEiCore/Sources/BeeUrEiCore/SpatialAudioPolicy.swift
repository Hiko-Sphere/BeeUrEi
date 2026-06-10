import Foundation

/// 空间音渲染算法（与 AVFoundation 的 `AVAudio3DMixingRenderingAlgorithm` rawValue 对齐，便于 App 层直接映射）。
///
/// ⚠️ AVAudio3DMixingRenderingAlgorithm 的**默认值是 `.equalPowerPanning`**——只做左右声像（pan），
/// **不是**真正的双耳 3D。想让 AirPods「听出」具体方位（前/后/侧）并配合头追踪保持世界固定，
/// 必须显式选 **HRTF**（头相关传输函数，双耳渲染）。这是本项目导航信标空间音此前缺失的关键一环。
///
/// rawValue 对齐 AVFoundation（注意 4 被官方跳过；soundField/stereoPassThrough/auto 不适合点声源信标）。
public enum SpatialRenderingAlgorithm: Int, Sendable, CaseIterable {
    case equalPowerPanning = 0
    case sphericalHead = 1
    case hrtf = 2
    case soundField = 3
    case stereoPassThrough = 5
    case hrtfHQ = 6
    case auto = 7

    /// 适合「点声源导航信标」的双耳算法，质量从高到低：HRTFHQ > HRTF > sphericalHead > equalPowerPanning。
    /// soundField/stereoPassThrough/auto 不在此列（非点声源 / 由系统接管，不利于精确方位）。
    static let beaconPreference: [SpatialRenderingAlgorithm] = [.hrtfHQ, .hrtf, .sphericalHead, .equalPowerPanning]
}

/// 空间音策略（见 docs/PLAN.md §7.2）。纯函数、平台无关，可单测；具体的 AVAudioEngine 渲染在 App 层。
public enum SpatialAudioPolicy {
    /// 从「环境节点当前输出格式所支持的算法 rawValue 集合」里挑出对导航信标最优的双耳算法。
    ///
    /// 必须从 `AVAudioEnvironmentNode.applicableRenderingAlgorithms` 取可用集合再挑——
    /// 因为可用算法依赖输出声道布局，盲目设 `.HRTFHQ` 在某些输出格式下会被忽略或降级。
    /// 偏好集合里都不可用时，回退 `.equalPowerPanning`（任何格式下都可用，至少保左右声像）。
    public static func bestBeaconAlgorithm(availableRawValues: [Int]) -> SpatialRenderingAlgorithm {
        let available = Set(availableRawValues)
        for algo in SpatialRenderingAlgorithm.beaconPreference where available.contains(algo.rawValue) {
            return algo
        }
        return .equalPowerPanning
    }

    /// 是否启用了真正的双耳空间化（HRTF 系）。equalPowerPanning 只是左右声像，不算空间化。
    public static func isBinaural(_ algo: SpatialRenderingAlgorithm) -> Bool {
        algo == .hrtf || algo == .hrtfHQ
    }
}
