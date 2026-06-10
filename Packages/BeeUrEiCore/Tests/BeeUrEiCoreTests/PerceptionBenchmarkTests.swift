import XCTest
@testable import BeeUrEiCore

/// 感知热路径**性能基准**（B6 仪表的纯核心部分）。
///
/// 验证「每帧：多障碍融合 → 多目标跟踪(含 TTC) → 危险度排序」这条 App 每帧都跑的纯核心仲裁，
/// 其开销远低于端到端延迟预算（PLAN §5.6：目标 ≤0.8s、上限 ≤1.3s），从而把延迟预算几乎全部
/// 留给 Core ML 推理。既产出一个可比的基准数字，也作为**性能回归门槛**（变慢会让测试失败/标红）。
///
/// 注意边界：这里只度量**平台无关的纯核心**；相机取帧、Core ML 推理、TTS 合成的真机端到端延迟
/// 需在真机上用 `LatencyBudget` 打点度量（B6，依赖硬件，不在本机单测范围）。
final class PerceptionBenchmarkTests: XCTestCase {

    /// 一帧典型街景的检测结果（~6 目标，含高危类别 pole / fire hydrant / stairs）。
    private func sceneObjects() -> [DetectedObject] {
        [
            DetectedObject(label: "person", normalizedX: 0.50, confidence: 0.92),
            DetectedObject(label: "car", normalizedX: 0.72, confidence: 0.88),
            DetectedObject(label: "bicycle", normalizedX: 0.31, confidence: 0.77),
            DetectedObject(label: "pole", normalizedX: 0.60, confidence: 0.65),
            DetectedObject(label: "fire hydrant", normalizedX: 0.18, confidence: 0.71),
            DetectedObject(label: "stairs", normalizedX: 0.45, confidence: 0.69),
        ]
    }

    /// 单帧纯核心管线：融合 → 跟踪 → 危险排序（与 App 每帧逻辑一致，去掉 ML/IO）。
    private func processFrame(objects: [DetectedObject], distances: [Double],
                             fusion: ObstacleFusion, ranker: ObstacleRanker,
                             tracker: ObstacleTracker, dt: Double) {
        var obstacles: [Obstacle] = []
        obstacles.reserveCapacity(objects.count)
        var observations: [TrackObservation] = []
        observations.reserveCapacity(objects.count)
        for (i, obj) in objects.enumerated() {
            let d = distances[i]
            let o = fusion.fuse(obj, distanceMeters: d)
            obstacles.append(o)
            observations.append(TrackObservation(label: o.label, bearingDegrees: o.clock.angleDegrees, distanceMeters: d))
        }
        _ = tracker.update(observations, dt: dt)
        _ = ranker.mostDangerous(obstacles)
    }

    /// 基准 + 回归门槛：连续 2000 帧（约 2 分钟步行 @15fps）的每帧仲裁均摊耗时必须远低于预算。
    func testPerFrameArbitrationWithinBudget() {
        let fusion = ObstacleFusion(horizontalFOVDegrees: 65)
        let ranker = ObstacleRanker()
        let tracker = ObstacleTracker(confirmHits: 2, maxMisses: 5)
        let objects = sceneObjects()
        let frames = 2000
        let dt = 1.0 / 15.0

        let start = DispatchTime.now()
        for f in 0..<frames {
            // 距离随时间逼近再复位（模拟边走边靠近），制造跟踪续接/TTC 计算的真实负载。
            let phase = Double(f % 60) / 60.0
            let distances = objects.indices.map { idx in max(0.5, 6.0 - phase * 5.0 - Double(idx) * 0.2) }
            processFrame(objects: objects, distances: distances, fusion: fusion, ranker: ranker, tracker: tracker, dt: dt)
        }
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - start.uptimeNanoseconds) / 1e9
        let perFrameMs = elapsed / Double(frames) * 1000.0

        // 纯核心每帧仲裁应远低于端到端预算（实测 Mac 上通常 <0.1ms/帧）。阈值取宽松的 5ms/帧：
        // 既是基准，也是防性能回归门槛——若某次改动把它拖慢一个数量级，此断言会失败。
        XCTAssertLessThan(perFrameMs, 5.0, "纯核心每帧仲裁 \(perFrameMs)ms 超 5ms 预算，疑似性能回归")

        // 端到端预算判定：纯核心耗时连「目标线(0.8s)」的零头都不到 → .good。
        XCTAssertEqual(LatencyBudget().verdict(latencySeconds: perFrameMs / 1000.0), .good)
    }

    /// XCTest 标准性能度量：记录基线，Xcode 下回归会标红（CI 可观测趋势）。
    func testFramePipelinePerformance() {
        let fusion = ObstacleFusion(horizontalFOVDegrees: 65)
        let ranker = ObstacleRanker()
        let objects = sceneObjects()
        let distances = objects.indices.map { 3.0 - Double($0) * 0.2 }
        measure {
            let tracker = ObstacleTracker(confirmHits: 2, maxMisses: 5)
            for _ in 0..<500 {
                processFrame(objects: objects, distances: distances, fusion: fusion, ranker: ranker, tracker: tracker, dt: 1.0 / 15.0)
            }
        }
    }
}
