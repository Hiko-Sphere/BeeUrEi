import CoreVideo
import CoreGraphics

/// 在画面的一个归一化矩形内采样平均 RGB（0...1）。支持 ARKit 的 YCbCr(420 双平面) 与 BGRA。
/// 用于红绿灯颜色判别（配合核心 `TrafficLightClassifier`）。原点左上、稀疏网格采样以省时。
enum ColorSampler {
    static func averageRGB(in pixelBuffer: CVPixelBuffer, rect: CGRect, gridSteps: Int = 6) -> (r: Double, g: Double, b: Double)? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let x0 = max(0, min(width - 1, Int(rect.minX * CGFloat(width))))
        let x1 = max(0, min(width - 1, Int(rect.maxX * CGFloat(width))))
        let y0 = max(0, min(height - 1, Int(rect.minY * CGFloat(height))))
        let y1 = max(0, min(height - 1, Int(rect.maxY * CGFloat(height))))
        guard x1 > x0, y1 > y0 else { return nil }

        let stepX = max(1, (x1 - x0) / gridSteps)
        let stepY = max(1, (y1 - y0) / gridSteps)
        var rs = 0.0, gs = 0.0, bs = 0.0, n = 0.0
        let fmt = CVPixelBufferGetPixelFormatType(pixelBuffer)

        if fmt == kCVPixelFormatType_32BGRA {
            guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }
            let bpr = CVPixelBufferGetBytesPerRow(pixelBuffer)
            let ptr = base.assumingMemoryBound(to: UInt8.self)
            var y = y0
            while y <= y1 {
                var x = x0
                while x <= x1 {
                    let p = y * bpr + x * 4
                    bs += Double(ptr[p]); gs += Double(ptr[p + 1]); rs += Double(ptr[p + 2]); n += 1
                    x += stepX
                }
                y += stepY
            }
        } else {
            // YCbCr 420 双平面（ARKit capturedImage）。full-range YCbCr → RGB。
            guard let yBase = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0),
                  let cBase = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 1) else { return nil }
            let yBPR = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
            let cBPR = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 1)
            let yPtr = yBase.assumingMemoryBound(to: UInt8.self)
            let cPtr = cBase.assumingMemoryBound(to: UInt8.self)
            var y = y0
            while y <= y1 {
                var x = x0
                while x <= x1 {
                    let yy = Double(yPtr[y * yBPR + x])
                    let cx = (x / 2) * 2
                    let cb = Double(cPtr[(y / 2) * cBPR + cx])
                    let cr = Double(cPtr[(y / 2) * cBPR + cx + 1])
                    rs += yy + 1.402 * (cr - 128)
                    gs += yy - 0.344136 * (cb - 128) - 0.714136 * (cr - 128)
                    bs += yy + 1.772 * (cb - 128)
                    n += 1
                    x += stepX
                }
                y += stepY
            }
        }

        guard n > 0 else { return nil }
        func norm(_ v: Double) -> Double { min(max(v / n / 255, 0), 1) }
        return (norm(rs), norm(gs), norm(bs))
    }
}
