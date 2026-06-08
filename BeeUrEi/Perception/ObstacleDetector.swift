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

/// 占位实现：返回空，保证工程能编译运行。
final class StubObstacleDetector: ObstacleDetecting {
    func detect(in pixelBuffer: CVPixelBuffer, regionOfInterest: CGRect?) -> [DetectedObject] {
        []
    }
}
