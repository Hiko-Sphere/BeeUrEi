import Foundation

/// 云端 AI 视觉描述（"看一看/AI 描述"）上传图的编码口径（纯逻辑，可单测）。此前 App 有两处各自硬编码、
/// 且**不一致**：FramingAssistView.visionJPEG 用质量 0.6、ChatViews 描述照片用 0.7——都偏低。云端已请求
/// image_url.detail=high（见 server vision，为读准药盒剂量/价签/电话/门牌等细字），而 0.6 的 JPEG 压缩会在
/// **高对比文字边缘**产生振铃伪影、把数字/字母压糊，正好抵消 high-detail 的收益。此处统一口径供两处复用。
public enum VisionImageEncoding {
    /// 上传 JPEG 质量。0.85：保住文字边缘、显著减少压缩伪影，上传仍很小（1024px 长边 @0.85 约 200–400KB，
    /// 远低于服务端 5MB 上限）——**读字准确度 > 省几十 KB 流量**，与 detail=high 的读字目标一致。
    public static let jpegQuality: Double = 0.85

    /// 上传长边上限（像素）。OpenAI 兼容 high-detail 会把图缩放进 2048×2048、短边再压到 768 后 512px 分块——
    /// 1024 长边的 4:3 图短边恰 768，正好喂满 high-detail 而不浪费带宽；更大也会被上游降采样、徒增流量。
    public static let maxLongSidePixels: Double = 1024

    /// 等比缩放到长边 ≤ maxLongSidePixels：**绝不放大**（小图原样，放大只会糊且徒增体积）；等比保形；
    /// 非有限 / ≤0（坏帧尺寸）→ (0,0)，调用方据此走原图或跳过，绝不产生 NaN 尺寸让渲染崩溃。
    public static func fittedSize(width: Double, height: Double) -> (width: Double, height: Double) {
        guard width.isFinite, height.isFinite, width > 0, height > 0 else { return (0, 0) }
        let longSide = max(width, height)
        guard longSide > maxLongSidePixels else { return (width, height) } // 未超上限：不放大、原样
        let scale = maxLongSidePixels / longSide
        return (width * scale, height * scale)
    }
}
