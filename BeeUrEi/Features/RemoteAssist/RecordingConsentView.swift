import SwiftUI

/// 录制知情同意弹窗（Q6）：录制前征得同意。VoiceOver 友好。
/// 在通话中请求录制时弹出；`onDecision(true)` 表示本端同意。
struct RecordingConsentView: View {
    let onDecision: (Bool) -> Void

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "record.circle")
                .font(.system(size: 44))
                .foregroundStyle(.red)
            Text("录制本次通话？")
                .font(.title2).bold()
            Text("为留证或回看，本次通话可被录制。录制需双方同意；录制内容加密保存、到期自动删除，不作他用。")
                .multilineTextAlignment(.center)
                .padding(.horizontal)
            Button("同意录制") { onDecision(true) }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            Button("不录制", role: .cancel) { onDecision(false) }
        }
        .padding()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("是否录制本次通话？录制需双方同意，加密保存、到期自动删除，不作他用。")
    }
}

#Preview {
    RecordingConsentView { _ in }
}
