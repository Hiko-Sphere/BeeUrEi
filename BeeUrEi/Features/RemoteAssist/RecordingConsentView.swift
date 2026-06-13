import SwiftUI

/// 录制知情同意弹窗（Q6）：录制前征得同意。VoiceOver 友好。
/// 在通话中请求录制时弹出；`onDecision(true)` 表示本端同意。
struct RecordingConsentView: View {
    let onDecision: (Bool) -> Void
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "record.circle")
                .font(.system(size: 44))
                .foregroundStyle(Color.beeDanger)
                .accessibilityHidden(true)
            Text(CallStrings.recordTitle(lang))
                .font(.title2).bold()
            // 说明文字合并为单一可读元素；两个决定按钮**不**并入（否则 .combine 吞掉按钮，VoiceOver 无法操作，见审计 P2）。
            Text(CallStrings.recordExplain(lang))
                .multilineTextAlignment(.center)
                .padding(.horizontal)
                .accessibilityElement(children: .combine)
                .accessibilityLabel(CallStrings.recordTitle(lang) + "。" + CallStrings.recordExplain(lang))
            Button(CallStrings.recordAgree(lang)) { onDecision(true) }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            Button(CallStrings.recordDecline(lang), role: .cancel) { onDecision(false) }
        }
        .padding()
    }
}

#Preview {
    RecordingConsentView { _ in }
}
