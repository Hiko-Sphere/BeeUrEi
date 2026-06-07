import SwiftUI

/// 开发者模式叠层：显示温度/帧率/检测器/距离等调试信息（见 PLAN §14.4）。
/// 仅给明眼开发者看，对 VoiceOver 隐藏。
struct DevOverlayView: View {
    let model: HomeViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("开发者模式").bold()
            Text("FPS: \(model.fps)")
            Text("温度: \(model.thermalText)")
            Text("检测: \(model.detectorActive ? "YOLO" : "深度兜底")")
            Text("距离: \(model.proximityText)")
            if !model.advisoryText.isEmpty { Text("降级: \(model.advisoryText)") }
        }
        .font(.system(.caption2, design: .monospaced))
        .padding(8)
        .background(.black.opacity(0.55))
        .foregroundStyle(.green)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .accessibilityHidden(true)
    }
}
