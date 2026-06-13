import Foundation
import CoreVideo
import CoreGraphics

/// 感知层协议：输入一帧画面，输出检测到的目标（核心模型 `DetectedObject`）。
/// 几点钟方向/距离由 `ObstacleFusion`（核心、已单测）融合。
protocol ObstacleDetecting: AnyObject {
    /// 在给定（可选动态）ROI 内检测。regionOfInterest 为 nil 时用检测器默认 ROI。
    func detect(in pixelBuffer: CVPixelBuffer, regionOfInterest: CGRect?) -> [DetectedObject]
}

extension ObstacleDetecting {
    func detect(in pixelBuffer: CVPixelBuffer) -> [DetectedObject] {
        detect(in: pixelBuffer, regionOfInterest: nil)
    }
}

// 唯一实现是真实的 `YOLOObstacleDetector`（Core ML/Vision）；模型缺失时它返回空检测、
// 避障自动降级为纯 LiDAR 深度兜底，因此不再需要任何占位/桩实现（去 demo 化）。
