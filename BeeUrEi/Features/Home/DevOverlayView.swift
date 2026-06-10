import SwiftUI

/// 开发者模式叠层：显示温度档/帧率/检测器/ROI/跟踪/分辨率等详细调试信息（见 PLAN §14.4）。
/// 仅给明眼开发者看，对 VoiceOver 隐藏。
/// 说明：iOS 公开 API 不提供具体摄氏温度，仅有 thermalState 四档；故以「热状态 + 电量」呈现。
struct DevOverlayView: View {
    let model: HomeViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("开发者模式").bold()
            row("FPS", "\(model.fps)")
            row("延迟", model.latencyText) // 端到端 p50/p95（§5.6 预算 0.8s/1.3s），B6 真机实测仪表
            row("热状态", model.thermalText)
            row("电量", model.batteryText)
            row("检测器", model.detectorActive ? "YOLO" : "深度兜底")
            row("检测数", model.detectionCountText)
            row("ROI", model.roiText)
            row("跟踪", model.trackingStateText)
            row("画面", model.resolutionText)
            row("深度图", model.depthSizeText)
            row("距离", model.proximityText)
            if !model.advisoryText.isEmpty { row("降级", model.advisoryText) }
        }
        .font(.system(.caption2, design: .monospaced))
        .padding(8)
        .background(.black.opacity(0.6))
        .foregroundStyle(.green)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityHidden(true)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(spacing: 6) {
            Text(label).foregroundStyle(.green.opacity(0.7))
            Text(value)
        }
    }
}

/// 在相机预览上叠加 ROI 框（Vision 坐标原点左下 → SwiftUI 原点左上需翻转 y）。
struct DevROIOverlay: View {
    let roi: CGRect

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let h = geo.size.height
            let rect = CGRect(
                x: roi.origin.x * w,
                y: (1 - roi.origin.y - roi.height) * h,
                width: roi.width * w,
                height: roi.height * h
            )
            Rectangle()
                .strokeBorder(Color.green.opacity(0.9), style: StrokeStyle(lineWidth: 2, dash: [6, 4]))
                .frame(width: rect.width, height: rect.height)
                .position(x: rect.midX, y: rect.midY)
                .overlay(alignment: .topLeading) {
                    Text("ROI 检测区")
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.green)
                        .padding(2)
                        .background(.black.opacity(0.5))
                        .position(x: rect.minX + 36, y: rect.minY + 8)
                }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
