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
        let sensorFrame = SensorFrame(pixelBuffer: frame.capturedImage,
                                      depth: depthMap,
                                      timestamp: frame.timestamp)
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
