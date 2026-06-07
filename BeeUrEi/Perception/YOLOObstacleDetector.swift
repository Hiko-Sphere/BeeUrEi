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
    private let roi: CGRect
    private let roiMapper: ROIMapper

    /// - Parameters:
    ///   - modelName: 不带扩展名的模型资源名（编译后为 .mlmodelc）。
    ///   - confidenceThreshold: 低于此置信度的检测被丢弃。
    ///   - regionOfInterest: 检测的感兴趣区域（归一化，原点左下，同 Vision）。默认聚焦正前方
    ///     中央带，提升居中障碍召回、减少外围误检、加快推理（见用户反馈）。检测框横坐标会用
    ///     `ROIMapper`（已单测）映射回整帧，保证「几点钟方向」正确。
    ///     ⚠️ 真机验证：若方向偏移，说明该 iOS 版本 Vision 已按整帧坐标返回，去掉重映射即可。
    init(modelName: String = "YOLO",
         confidenceThreshold: Float = 0.35,
         regionOfInterest: CGRect = CGRect(x: 0.15, y: 0.15, width: 0.7, height: 0.8)) {
        self.confidenceThreshold = confidenceThreshold
        self.roi = regionOfInterest
        self.roiMapper = ROIMapper(originX: Double(regionOfInterest.origin.x), width: Double(regionOfInterest.width))
        if let visionModel = YOLOObstacleDetector.loadModel(named: modelName) {
            let request = VNCoreMLRequest(model: visionModel)
            request.imageCropAndScaleOption = .scaleFill
            request.regionOfInterest = regionOfInterest
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
            // ROI 内的归一化 midX → 整帧归一化 X（保证几点钟方向正确）。
            let fullX = roiMapper.fullNormalizedX(Double(obs.boundingBox.midX))
            return DetectedObject(label: top.identifier,
                                  normalizedX: fullX,
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
