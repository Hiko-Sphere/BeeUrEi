import Foundation
import simd

/// 碰撞走廊（动态 ROI 的核心，见 docs/PERCEPTION_ALGORITHM.md §2）：
/// 一个沿前进方向、与用户等宽、从地面到头高、前向 N 米的竖直长方体。
/// 世界系定义 → 投影成图像 ROI；3D inside 门控剔除墙/天花板。
public struct CollisionCorridor: Sendable {
    public let width: Float     // W：肩宽 + 余量
    public let height: Float    // H：地面→头顶
    public let groundMin: Float // 忽略贴地噪声
    public let depth: Float     // N：前向纵深

    public init(width: Float = 0.8, height: Float = 1.7, groundMin: Float = 0.05, depth: Float = 3.0) {
        self.width = width; self.height = height; self.groundMin = groundMin; self.depth = depth
    }

    /// 纵深随步速自适应：N = v·t_react + v²/(2·a_dec)，clamp。
    public static func adaptiveDepth(speed v: Float, reactionTime t: Float = 1.0, decel a: Float = 1.0,
                                     minDepth: Float = 1.5, maxDepth: Float = 6) -> Float {
        let raw = max(0, v) * t + (a > 0 ? v * v / (2 * a) : 0)
        return min(max(raw, minDepth), maxDepth)
    }

    /// 世界点是否落在走廊体内。走廊系：origin 为脚下、forward 为水平前向、up 为重力反向。
    public func contains(_ p: SIMD3<Float>, origin: SIMD3<Float>, forward: SIMD3<Float>, up: SIMD3<Float>) -> Bool {
        let f = simd_normalize(forward), u = simd_normalize(up)
        let r = simd_normalize(simd_cross(f, u))
        let rel = p - origin
        let xL = simd_dot(rel, r), yL = simd_dot(rel, u), zL = simd_dot(rel, f)
        return abs(xL) <= width / 2 && yL >= groundMin && yL <= height && zL >= 0 && zL <= depth
    }

    /// 走廊 8 个世界角点。
    public func corners(origin: SIMD3<Float>, forward: SIMD3<Float>, up: SIMD3<Float>) -> [SIMD3<Float>] {
        let f = simd_normalize(forward), u = simd_normalize(up)
        let r = simd_normalize(simd_cross(f, u))
        var pts: [SIMD3<Float>] = []
        for sx: Float in [-width / 2, width / 2] {
            for sy: Float in [groundMin, height] {
                for sz: Float in [0, depth] {
                    pts.append(origin + r * sx + u * sy + f * sz)
                }
            }
        }
        return pts
    }

    /// 投影成图像 ROI（归一化 bbox，原点左上，clamp 到 0...1）。投影不到则返回整帧。
    public func imageROI(origin: SIMD3<Float>, forward: SIMD3<Float>, up: SIMD3<Float>,
                         cameraToWorld: simd_float4x4, intrinsics k: CameraIntrinsics,
                         imageWidth: Float, imageHeight: Float) -> NormalizedBox {
        var minU = Float.greatestFiniteMagnitude, minV = Float.greatestFiniteMagnitude
        var maxU = -Float.greatestFiniteMagnitude, maxV = -Float.greatestFiniteMagnitude
        var any = false
        var allProjected = true
        for p in corners(origin: origin, forward: forward, up: up) {
            if let (u, v, _) = PinholeCamera.project(p, cameraToWorld: cameraToWorld, intrinsics: k) {
                any = true
                minU = min(minU, u); maxU = max(maxU, u)
                minV = min(minV, v); maxV = max(maxV, v)
            } else {
                allProjected = false
            }
        }
        // 任一角点在相机后方（投影失败，常见于水平持机时走廊近端落在光心后方）：
        // 仅用剩余角点会算出过小且偏移的 ROI 而漏判障碍 → 保守回退整帧扫描（安全优先，见审查 #3）。
        guard allProjected, any, maxU > minU, maxV > minV else { return .full }
        let x0 = Double(max(0, minU / imageWidth)), x1 = Double(min(1, maxU / imageWidth))
        let y0 = Double(max(0, minV / imageHeight)), y1 = Double(min(1, maxV / imageHeight))
        return NormalizedBox(x: x0, y: y0, width: max(0, x1 - x0), height: max(0, y1 - y0))
    }
}
