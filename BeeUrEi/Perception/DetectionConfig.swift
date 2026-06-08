import CoreGraphics

/// 检测配置（检测器与开发者叠层共用，保证 ROI 框与实际检测区域一致）。
enum DetectionConfig {
    /// 检测感兴趣区域（归一化，原点左下，同 Vision）。聚焦正前方中央带。
    static let regionOfInterest = CGRect(x: 0.15, y: 0.15, width: 0.7, height: 0.8)
}
