import Foundation
import CoreVideo
import AVFoundation
import simd

/// 相机几何（仅 ARKit 源提供）：内参 + 相机→世界(CV 约定：相机看 +Z、y 下) + 世界上方向 + 画面尺寸。
/// 用于动态 ROI（碰撞走廊投影，核心 `CollisionCorridor`）。外接源/无 ARKit 时为 nil。
struct CameraGeometry {
    let intrinsics: CameraIntrinsics
    let cameraToWorld: simd_float4x4
    let worldUp: SIMD3<Float>
    let imageWidth: Float
    let imageHeight: Float
}

/// 一帧「感知输入」：画面 +（可选）深度 + 时间戳 +（可选）相机几何。
/// 关键点：它**不关心**数据来自手机自带相机/LiDAR，还是未来的外接设备（眼镜/耳机）。
struct SensorFrame {
    let pixelBuffer: CVPixelBuffer   // 画面
    let depth: DepthMap?             // 深度（仅 LiDAR 提供；本项目硬性要求 LiDAR）
    let timestamp: TimeInterval
    let camera: CameraGeometry?      // 相机几何（ARKit 源提供，用于动态 ROI）
}

/// 每像素深度（米）。Phase 1 由 ARKit `sceneDepth` 填充。
struct DepthMap {
    let depth: CVPixelBuffer          // 每像素深度（米）
    let confidence: CVPixelBuffer?    // 每像素置信度（可选）
    let width: Int
    let height: Int
}

/// 感知源状态。
enum FrameSourceState: Equatable {
    case idle
    case running
    case denied
    case unsupported(String)   // 例如：设备无 LiDAR
    case failed(String)
}

/// 感知输入「端口」（Port）。上层只依赖这个协议，不关心具体来源。
///
/// - 当前实现：`PhoneCameraSource`（手机自带相机/LiDAR）。
/// - 未来实现：`ExternalDeviceSource`（外接眼镜/耳机的相机+LiDAR 经网络流式接入），
///   手机届时作为「算力机」。新增来源只需实现本协议，**上层无需改动**。见 docs/PLAN.md §12。
protocol FrameSource: AnyObject {
    var onFrame: ((SensorFrame) -> Void)? { get set }
    var onStateChange: ((FrameSourceState) -> Void)? { get set }
    func start()
    func stop()
}

/// 「可提供 AVCaptureSession 预览」的能力——手机相机源特有；外接源不一定具备。
/// 这样预览成为一个可选能力，而不污染通用的 FrameSource 协议。
protocol CameraPreviewProviding: AnyObject {
    var previewSession: AVCaptureSession { get }
}
