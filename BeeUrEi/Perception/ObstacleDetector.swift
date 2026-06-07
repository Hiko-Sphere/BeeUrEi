import Foundation
import CoreVideo

/// 感知层协议：输入一帧画面，输出检测到的目标（核心模型 `DetectedObject`）。
/// Week 2 用现成 Core ML 检测模型实现「是什么」；几点钟方向/距离由 `ObstacleFusion`
/// （核心、已单测）融合。当前为占位返回空。
protocol ObstacleDetecting: AnyObject {
    func detect(in pixelBuffer: CVPixelBuffer) -> [DetectedObject]
}

/// 占位实现：返回空，保证工程能编译运行。
final class StubObstacleDetector: ObstacleDetecting {
    func detect(in pixelBuffer: CVPixelBuffer) -> [DetectedObject] {
        // TODO(Week 2): VNCoreMLModel + VNCoreMLRequest 跑检测，输出 DetectedObject。
        []
    }
}
