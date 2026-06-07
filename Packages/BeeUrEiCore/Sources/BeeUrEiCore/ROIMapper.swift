import Foundation

/// ROI（感兴趣区域）坐标映射：把"在 ROI 内的归一化横坐标"映射回"整帧归一化横坐标"，
/// 以便 ROI 裁剪检测后仍能正确计算「几点钟方向」（见用户反馈）。
/// 用归一化标量（originX/width），避免核心包依赖 CoreGraphics。
public struct ROIMapper: Sendable {
    public let originX: Double
    public let width: Double

    public init(originX: Double, width: Double) {
        self.originX = originX
        self.width = width
    }

    public func fullNormalizedX(_ roiX: Double) -> Double {
        originX + roiX * width
    }
}
