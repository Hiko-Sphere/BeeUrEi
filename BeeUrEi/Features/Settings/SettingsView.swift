import SwiftUI

/// 设置页：开关「开始避障时的简短语音提醒」+ 随时重听完整安全须知（见 docs/PLAN.md §1.3）。
/// 简短提醒可关；但首次/定期的完整知情同意不可省（由 OnboardingView + DisclaimerPolicy 把关）。
struct SettingsView: View {
    let store: ConsentStore
    let onClose: () -> Void

    @State private var briefReminderOn: Bool
    @State private var avoidanceOn: Bool
    @State private var navigationOn: Bool
    @State private var devModeOn: Bool

    init(store: ConsentStore, onClose: @escaping () -> Void) {
        self.store = store
        self.onClose = onClose
        _briefReminderOn = State(initialValue: store.briefReminderSpeechEnabled)
        let features = FeatureSettings()
        _avoidanceOn = State(initialValue: features.avoidanceEnabled)
        _navigationOn = State(initialValue: features.navigationEnabled)
        _devModeOn = State(initialValue: DevSettings().enabled)
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

                Section("账号") {
                    NavigationLink("登录 / 注册") { LoginView() }
                }

                Section {
                    Toggle("实时避障", isOn: $avoidanceOn)
                        .onChange(of: avoidanceOn) { _, v in
                            var f = FeatureSettings(); f.avoidanceEnabled = v
                        }
                    Toggle("步行导航", isOn: $navigationOn)
                        .onChange(of: navigationOn) { _, v in
                            var f = FeatureSettings(); f.navigationEnabled = v
                        }
                } header: {
                    Text("功能")
                } footer: {
                    Text("避障与导航可分别开关。导航功能仍在开发中。")
                }

                Section {
                    Toggle("开发者模式（显示温度/帧率）", isOn: $devModeOn)
                        .onChange(of: devModeOn) { _, v in
                            var d = DevSettings(); d.enabled = v
                        }
                } header: {
                    Text("开发者")
                } footer: {
                    Text("开启后首屏左上角叠加显示温度、帧率、检测器等调试信息，用于开发测试。")
                }

                Section("关于") {
                    LabeledContent("组织", value: "Hiko Sphere 彦穹科技")
                    LabeledContent("软件制作人", value: "Li Yanpei Hiko")
                    LabeledContent("版本", value: "0.1.0")
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
