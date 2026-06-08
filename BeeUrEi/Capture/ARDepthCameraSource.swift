import Foundation
import ARKit
import CoreVideo

/// 可提供 ARSession 用于预览的能力。
protocol ARSessionProviding: AnyObject {
    var session: ARSession { get }
}

/// 基于 ARKit 的感知源：同时提供画面 + LiDAR 每像素深度（见 docs/PLAN.md §5.2）。
/// 取代 AVFoundation 成为本 LiDAR-only 项目的主采集层。
final class ARDepthCameraSource: NSObject, FrameSource, ARSessionProviding {

    var onFrame: ((SensorFrame) -> Void)?
    var onStateChange: ((FrameSourceState) -> Void)?
    /// 跟踪质量回调（映射到核心 `TrackingQuality`，供 `TrackingGate` 门控降级）。
    var onTracking: ((TrackingQuality) -> Void)?

    let session = ARSession()

    override init() {
        super.init()
        session.delegate = self
        session.delegateQueue = .main   // 回调在主线程，便于直接更新 @Observable
    }

    func start() {
        guard ARWorldTrackingConfiguration.isSupported else {
            onStateChange?(.unsupported("此设备不支持 ARKit 世界跟踪"))
            return
        }
        guard ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) else {
            onStateChange?(.unsupported("此设备没有 LiDAR（缺少 sceneDepth）"))
            return
        }
        let config = ARWorldTrackingConfiguration()
        config.frameSemantics.insert(.sceneDepth)
        session.run(config)
        onStateChange?(.running)
    }

    func stop() {
        session.pause()
    }

    static func map(_ state: ARCamera.TrackingState) -> TrackingQuality {
        switch state {
        case .normal:
            return .normal
        case .notAvailable:
            return .notAvailable
        case .limited(let reason):
            switch reason {
            case .initializing:         return .limited(reason: .initializing)
            case .excessiveMotion:      return .limited(reason: .excessiveMotion)
            case .insufficientFeatures: return .limited(reason: .insufficientFeatures)
            case .relocalizing:         return .limited(reason: .relocalizing)
            @unknown default:           return .limited(reason: .other)
            }
        }
    }
}

extension ARDepthCameraSource: ARSessionDelegate {
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        var depthMap: DepthMap?
        if let sd = frame.sceneDepth {
            depthMap = DepthMap(
                depth: sd.depthMap,
                confidence: sd.confidenceMap,
                width: CVPixelBufferGetWidth(sd.depthMap),
                height: CVPixelBufferGetHeight(sd.depthMap)
            )
        }
        // 相机几何（用于动态 ROI）：ARKit→CV 约定（翻转 Y、Z）。
        let cam = frame.camera
        let K = cam.intrinsics
        let res = cam.imageResolution
        let flip = simd_float4x4(diagonal: SIMD4<Float>(1, -1, -1, 1))
        let geometry = CameraGeometry(
            intrinsics: CameraIntrinsics(fx: K[0][0], fy: K[1][1], cx: K[2][0], cy: K[2][1]),
            cameraToWorld: cam.transform * flip,
            worldUp: SIMD3<Float>(0, 1, 0),
            imageWidth: Float(res.width),
            imageHeight: Float(res.height))

        let sensorFrame = SensorFrame(pixelBuffer: frame.capturedImage,
                                      depth: depthMap,
                                      timestamp: frame.timestamp,
                                      camera: geometry)
        onFrame?(sensorFrame)
        onTracking?(Self.map(frame.camera.trackingState))
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        if let arError = error as? ARError, arError.code == .cameraUnauthorized {
            onStateChange?(.denied)
        } else {
            onStateChange?(.failed(error.localizedDescription))
        }
    }
}
