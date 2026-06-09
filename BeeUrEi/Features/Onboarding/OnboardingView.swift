import SwiftUI

/// 首次启动 / 定期重申的免责知情同意页（见 docs/PLAN.md §1.3）。
/// 必须可被 VoiceOver 完全朗读与操作。
struct OnboardingView: View {
    let onAccept: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Text("安全须知")
                .font(.largeTitle).bold()
                .accessibilityAddTraits(.isHeader)

            ScrollView {
                Text(DisclaimerText.full)
                    .font(.body)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
            }

            BeeBigButton("我已理解并同意", systemImage: "checkmark.circle.fill", action: onAccept)
                .padding(.horizontal)
                .accessibilityHint("点击表示你已知悉本 App 的局限并同意使用")
        }
        .padding()
    }
}

#Preview {
    OnboardingView(onAccept: {})
}
