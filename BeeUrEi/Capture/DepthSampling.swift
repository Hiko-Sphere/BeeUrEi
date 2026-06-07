import Foundation
import CoreVideo

/// 从 LiDAR 深度图（`Float32` 每像素米数）抽取若干样本，喂给核心 `DepthSampler`。
/// 这是「像素读取」的 I/O 适配（真机验证）；分级决策逻辑在核心、已单测。
enum DepthSampling {

    /// 取深度图**中央**区域的样本。
    static func centerSamples(depth: CVPixelBuffer,
                              confidence: CVPixelBuffer?,
                              gridRadius: Int = 3) -> (depths: [Double], confidences: [Float]?) {
        samples(depth: depth, confidence: confidence, normalizedX: 0.5, normalizedY: 0.5, gridRadius: gridRadius)
    }

    /// 取深度图中**指定归一化位置**附近的样本（用于按检测框位置取距离）。
    static func samples(depth: CVPixelBuffer,
                        confidence: CVPixelBuffer?,
                        normalizedX: Double,
                        normalizedY: Double = 0.5,
                        gridRadius: Int = 3) -> (depths: [Double], confidences: [Float]?) {
        CVPixelBufferLockBaseAddress(depth, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(depth, .readOnly) }

        let w = CVPixelBufferGetWidth(depth)
        let h = CVPixelBufferGetHeight(depth)
        guard w > 0, h > 0, let base = CVPixelBufferGetBaseAddress(depth) else { return ([], nil) }
        let rowBytes = CVPixelBufferGetBytesPerRow(depth)
        let cx = clampIndex(normalizedX, count: w)
        let cy = clampIndex(normalizedY, count: h)

        var depths: [Double] = []
        for dy in -gridRadius...gridRadius {
            let y = cy + dy
            guard y >= 0, y < h else { continue }
            let row = base.advanced(by: y * rowBytes).assumingMemoryBound(to: Float32.self)
            for dx in -gridRadius...gridRadius {
                let x = cx + dx
                guard x >= 0, x < w else { continue }
                depths.append(Double(row[x]))
            }
        }

        var confidences: [Float]?
        if let confidence {
            CVPixelBufferLockBaseAddress(confidence, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
            let cw = CVPixelBufferGetWidth(confidence)
            let ch = CVPixelBufferGetHeight(confidence)
            if cw > 0, ch > 0, let cbase = CVPixelBufferGetBaseAddress(confidence) {
                let crow = CVPixelBufferGetBytesPerRow(confidence)
                let ccx = clampIndex(normalizedX, count: cw)
                let ccy = clampIndex(normalizedY, count: ch)
                var arr: [Float] = []
                for dy in -gridRadius...gridRadius {
                    let y = ccy + dy
                    guard y >= 0, y < ch else { continue }
                    let rowp = cbase.advanced(by: y * crow).assumingMemoryBound(to: UInt8.self)
                    for dx in -gridRadius...gridRadius {
                        let x = ccx + dx
                        guard x >= 0, x < cw else { continue }
                        // ARConfidenceLevel: 0 low / 1 medium / 2 high → 归一化 0...1
                        arr.append(Float(rowp[x]) / 2.0)
                    }
                }
                confidences = arr
            }
        }
        return (depths, confidences)
    }

    private static func clampIndex(_ normalized: Double, count: Int) -> Int {
        let clamped = min(max(normalized, 0), 1)
        return min(Int(clamped * Double(count - 1)), count - 1)
    }
}
