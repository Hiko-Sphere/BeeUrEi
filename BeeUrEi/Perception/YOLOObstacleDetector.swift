import Foundation
import Vision
import CoreML
import CoreVideo

/// 用 Vision + Core ML 跑目标检测，输出核心 `DetectedObject`（是什么 + 检测框中心横坐标）。
///
/// 模型文件本身是**外部资产**（见 docs/PLAN.md §13.3）：把一个含 NMS 的 YOLO Core ML 模型
/// （如用 Ultralytics 导出的 YOLO11n，`model.export(format="coreml", nms=True)`）加入 App target
/// 后即自动生效；**模型缺失时本类返回空**，App 自动降级为「深度兜底」避障，不会崩溃。
///
/// 这是 I/O 适配层（真机 + 模型验证）；几点钟方向/距离融合的可测逻辑在核心 `ObstacleFusion`。
final class YOLOObstacleDetector: ObstacleDetecting {

    private let request: VNCoreMLRequest?
    private let confidenceThreshold: Float

    /// - Parameters:
    ///   - modelName: 不带扩展名的模型资源名（编译后为 .mlmodelc）。
    ///   - confidenceThreshold: 低于此置信度的检测被丢弃。
    init(modelName: String = "YOLO", confidenceThreshold: Float = 0.35) {
        self.confidenceThreshold = confidenceThreshold
        if let visionModel = YOLOObstacleDetector.loadModel(named: modelName) {
            let request = VNCoreMLRequest(model: visionModel)
            request.imageCropAndScaleOption = .scaleFill
            self.request = request
        } else {
            self.request = nil
        }
    }

    /// 是否成功加载到模型（否则 App 走深度兜底）。
    var isAvailable: Bool { request != nil }

    func detect(in pixelBuffer: CVPixelBuffer) -> [DetectedObject] {
        guard let request else { return [] }
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }
        let observations = (request.results as? [VNRecognizedObjectObservation]) ?? []
        return observations.compactMap { obs in
            guard let top = obs.labels.first, top.confidence >= confidenceThreshold else { return nil }
            // Vision boundingBox：归一化、原点左下；midX 即检测框中心横坐标（0 左 … 1 右）。
            return DetectedObject(label: top.identifier,
                                  normalizedX: Double(obs.boundingBox.midX),
                                  confidence: top.confidence)
        }
    }

    private static func loadModel(named name: String) -> VNCoreMLModel? {
        guard let url = Bundle.main.url(forResource: name, withExtension: "mlmodelc"),
              let mlModel = try? MLModel(contentsOf: url),
              let visionModel = try? VNCoreMLModel(for: mlModel) else {
            return nil
        }
        return visionModel
    }
}
