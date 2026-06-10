import Foundation
import simd

/// 相机内参（针孔）。
public struct CameraIntrinsics: Sendable, Equatable {
    public let fx: Float, fy: Float, cx: Float, cy: Float
    public init(fx: Float, fy: Float, cx: Float, cy: Float) {
        self.fx = fx; self.fy = fy; self.cx = cx; self.cy = cy
    }
}

/// 相机视场角（纯几何，可单测）：由内参算水平 FOV，替代硬编码经验值（68°），
/// 让"几点钟方向"在不同机型/变焦下都准。
public enum CameraFOV {
    /// 水平视场角（度）= 2·atan(width / 2fx)。非法输入回退 68°（后置广角经验值）。
    public static func horizontalDegrees(fx: Float, imageWidth: Float) -> Double {
        guard fx.isFinite, imageWidth.isFinite, fx > 0, imageWidth > 0 else { return 68 }
        return 2 * atan(Double(imageWidth) / (2 * Double(fx))) * 180 / .pi
    }
}

/// 归一化矩形（原点左上，0...1），用于动态 ROI。
public struct NormalizedBox: Sendable, Equatable {
    public let x: Double, y: Double, width: Double, height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
    public static let full = NormalizedBox(x: 0, y: 0, width: 1, height: 1)
    public var midX: Double { x + width / 2 }
    public var midY: Double { y + height / 2 }
}

/// 针孔相机投影/反投影。CV 约定：相机看 +Z、x 右、y 下；`cameraToWorld` 为相机→世界变换。
/// iOS 适配层负责把 ARKit 的位姿转成该约定后传入（保持核心纯净可测）。
public enum PinholeCamera {
    public static func project(_ worldPoint: SIMD3<Float>,
                               cameraToWorld: simd_float4x4,
                               intrinsics k: CameraIntrinsics) -> (u: Float, v: Float, z: Float)? {
        let pc = cameraToWorld.inverse * SIMD4<Float>(worldPoint, 1)
        guard pc.z > 0 else { return nil }
        return (k.fx * pc.x / pc.z + k.cx, k.fy * pc.y / pc.z + k.cy, pc.z)
    }

    public static func unproject(u: Float, v: Float, depth z: Float,
                                 cameraToWorld: simd_float4x4,
                                 intrinsics k: CameraIntrinsics) -> SIMD3<Float> {
        let pc = SIMD3<Float>((u - k.cx) / k.fx * z, (v - k.cy) / k.fy * z, z)
        let w = cameraToWorld * SIMD4<Float>(pc, 1)
        return SIMD3<Float>(w.x, w.y, w.z)
    }
}
