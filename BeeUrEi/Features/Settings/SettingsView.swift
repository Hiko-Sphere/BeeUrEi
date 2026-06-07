import SwiftUI

/// 设置页：开关「开始避障时的简短语音提醒」+ 随时重听完整安全须知（见 docs/PLAN.md §1.3）。
/// 简短提醒可关；但首次/定期的完整知情同意不可省（由 OnboardingView + DisclaimerPolicy 把关）。
struct SettingsView: View {
    let store: ConsentStore
    let onClose: () -> Void

    @State private var briefReminderOn: Bool

    init(store: ConsentStore, onClose: @escaping () -> Void) {
        self.store = store
        self.onClose = onClose
        _briefReminderOn = State(initialValue: store.briefReminderSpeechEnabled)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle("开始避障时播报安全提醒", isOn: $briefReminderOn)
                        .onChange(of: briefReminderOn) { _, newValue in
                            store.briefReminderSpeechEnabled = newValue
                        }
                } header: {
                    Text("语音提醒")
                } footer: {
                    Text("关闭后，每次开始避障不再播报那句简短提醒；首次启动的完整安全须知仍会保留。")
                }

                Section("安全须知") {
                    Text(DisclaimerText.full)
                        .font(.body)
                        .accessibilityLabel(DisclaimerText.full)
                }
            }
            .navigationTitle("设置")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("完成") { onClose() }
                }
            }
        }
    }
}

#Preview {
    SettingsView(store: ConsentStore()) {}
}
