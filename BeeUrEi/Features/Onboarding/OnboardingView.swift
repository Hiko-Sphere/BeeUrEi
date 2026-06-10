import SwiftUI

/// 首次启动 / 定期重申的免责知情同意页（见 docs/PLAN.md §1.3）。
/// 必须可被 VoiceOver 完全朗读与操作。
struct OnboardingView: View {
    let onAccept: () -> Void
    /// 知情同意页文案语言（E5）。英文安全须知为草稿，上架前需法务/母语者校对。
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        VStack(spacing: 20) {
            Text(lang == .zh ? "安全须知" : "Safety Notice")
                .font(.largeTitle).bold()
                .accessibilityAddTraits(.isHeader)

            ScrollView {
                Text(DisclaimerText.full(lang))
                    .font(.body)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }

            BeeBigButton(lang == .zh ? "我已理解并同意" : "I understand and agree",
                         systemImage: "checkmark.circle.fill", action: onAccept)
                .padding(.horizontal)
                .accessibilityHint(lang == .zh ? "点击表示你已知悉本 App 的局限并同意使用"
                                               : "Tapping means you acknowledge the app's limits and agree to use it")
        }
        .padding()
    }
}

#Preview {
    OnboardingView(onAccept: {})
}
