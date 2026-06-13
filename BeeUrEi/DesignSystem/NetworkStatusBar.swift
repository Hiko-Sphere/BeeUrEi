import SwiftUI

/// 帮助/通话界面顶部网络状态条：当前网络类型（WiFi / 移动数据 / 有线链接）+（通话中）信号强弱。
/// 信号强弱来自 WebRTC 实测往返时延（iOS 不开放原始信号格数 API），仅在通话中传入 callQuality。
struct NetworkStatusBar: View {
    var callQuality: CallQuality?
    var lang: Language
    @State private var net = NetworkMonitor.shared

    init(callQuality: CallQuality? = nil, lang: Language = FeatureSettings().language) {
        self.callQuality = callQuality
        self.lang = lang
    }

    var body: some View {
        HStack(spacing: BeeSpacing.sm) {
            Image(systemName: net.systemImage)
            Text(net.label(lang)).font(.subheadline.weight(.medium))
            if net.isExpensive {
                Text(meteredText).font(.caption2).foregroundStyle(Color.beeWarn)
            }
            Spacer(minLength: BeeSpacing.sm)
            if let q = callQuality {
                signalBars(q)
                Text(CallStrings.signalLabel(q, lang)).font(.caption)
                    .foregroundStyle(q == .weak ? Color.beeDanger : .secondary)
            }
        }
        .padding(.horizontal, BeeSpacing.md).padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial, in: Capsule())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(a11yLabel)
    }

    private func signalBars(_ q: CallQuality) -> some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(0..<3, id: \.self) { i in
                Capsule()
                    .fill(i < q.bars ? barColor(q) : Color.secondary.opacity(0.3))
                    .frame(width: 4, height: CGFloat(6 + i * 4))
            }
        }
        .accessibilityHidden(true)
    }

    private func barColor(_ q: CallQuality) -> Color {
        switch q {
        case .good: return .beeSuccess
        case .fair: return .beeWarn
        case .weak: return .beeDanger
        case .unknown: return .secondary
        }
    }

    private var meteredText: String { lang == .zh ? "按流量" : "Metered" }

    private var a11yLabel: String {
        var s = (lang == .zh ? "当前网络：" : "Current network: ") + net.label(lang)
        if net.isExpensive { s += lang == .zh ? "，按流量计费" : ", metered connection" }
        if let q = callQuality { s += "，\(CallStrings.signalLabel(q, lang))" }
        return s
    }
}
