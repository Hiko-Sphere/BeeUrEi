import SwiftUI
import UIKit

/// 首次启动 / 定期重申的免责知情同意页（见 docs/PLAN.md §1.3）。
/// 必须可被 VoiceOver 完全朗读与操作。这是法律/安全关键页：盲人必须**听到**局限后才同意。
struct OnboardingView: View {
    let onAccept: () -> Void
    /// 知情同意页文案语言（E5）。英文安全须知为草稿，上架前需法务/母语者校对。
    private var lang: Language { FeatureSettings().language }
    /// 进入时把 VoiceOver 焦点落到免责正文，确保盲人先听到局限再到"同意"按钮。
    @AccessibilityFocusState private var disclaimerFocused: Bool
    @State private var showDoc: LegalDocument?

    var body: some View {
        VStack(spacing: BeeSpacing.lg) {
            Text(lang == .zh ? "安全须知" : "Safety Notice")
                .font(.largeTitle).bold()
                .accessibilityAddTraits(.isHeader)

            ScrollView {
                Text(DisclaimerText.full(lang))
                    .font(.body)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding()
                    .accessibilityLabel(DisclaimerText.full(lang)) // 与设置页一致：显式可读全文
                    .accessibilityFocused($disclaimerFocused)
            }

            // 同意同时覆盖《使用条款》与《隐私政策》——可点开完整阅读（无障碍：各为独立按钮）。
            VStack(spacing: BeeSpacing.sm) {
                Text(LegalStrings.agreePrefix(lang))
                    .font(.footnote).foregroundStyle(.secondary)
                HStack(spacing: BeeSpacing.md) {
                    Button(LegalDocument.terms.title(lang)) { showDoc = .terms }
                    Text(LegalStrings.and(lang)).foregroundStyle(.secondary)
                    Button(LegalDocument.privacy.title(lang)) { showDoc = .privacy }
                }
                .font(.footnote.weight(.semibold))
            }

            BeeBigButton(lang == .zh ? "我已理解并同意" : "I understand and agree",
                         systemImage: "checkmark.circle.fill") {
                SpeechHub.shared.stopChannel(.query) // 同意即停掉正在朗读的免责语音
                onAccept()
            }
                .padding(.horizontal)
                .accessibilityHint(lang == .zh ? "点击表示你已知悉本 App 的局限，并同意《使用条款》与《隐私政策》"
                                               : "Tapping means you acknowledge the app's limits and agree to the Terms of Service and Privacy Policy")
        }
        .padding()
        .sheet(item: $showDoc) { doc in
            NavigationStack { LegalDocumentView(document: doc) }
        }
        // 法律/安全关键页：开 VoiceOver 时把焦点落到免责正文（VO 自行朗读，不再额外公告以免重读）；
        // 未开 VoiceOver 的盲人则用 App 自身 TTS 主动朗读全文（见 P0 无障碍审计）。
        .task {
            if UIAccessibility.isVoiceOverRunning {
                try? await Task.sleep(for: .milliseconds(450))
                disclaimerFocused = true
            } else {
                SpeechHub.shared.speak(DisclaimerText.full(lang), channel: .query, voiceCode: lang.voiceCode)
            }
        }
    }
}

#Preview {
    OnboardingView(onAccept: {})
}
