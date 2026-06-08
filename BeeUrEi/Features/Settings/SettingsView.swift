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
    @State private var dynamicROIOn: Bool
    @State private var concise: Bool
    @State private var rate: Double
    @State private var highContrastOn: Bool
    @State private var sonarOn: Bool
    @State private var verbosity: Int
    @State private var showTutorial = false
    @State private var previewSpeech = SpeechFeedback()
    @State private var previewHaptic = HapticFeedback()

    init(store: ConsentStore, onClose: @escaping () -> Void) {
        self.store = store
        self.onClose = onClose
        _briefReminderOn = State(initialValue: store.briefReminderSpeechEnabled)
        let features = FeatureSettings()
        _avoidanceOn = State(initialValue: features.avoidanceEnabled)
        _navigationOn = State(initialValue: features.navigationEnabled)
        _devModeOn = State(initialValue: DevSettings().enabled)
        _dynamicROIOn = State(initialValue: DevSettings().dynamicROIEnabled)
        _concise = State(initialValue: features.conciseAnnouncements)
        _rate = State(initialValue: Double(features.speechRate))
        _highContrastOn = State(initialValue: features.highContrast)
        _sonarOn = State(initialValue: features.proximitySonar)
        _verbosity = State(initialValue: features.verbosity)
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

                Section {
                    Toggle("简短播报", isOn: $concise)
                        .onChange(of: concise) { _, v in
                            var f = FeatureSettings(); f.conciseAnnouncements = v
                        }
                    VStack(alignment: .leading) {
                        Text("语速")
                        Slider(value: $rate, in: 0...1, step: 0.05) {
                            Text("语速")
                        } minimumValueLabel: {
                            Text("慢")
                        } maximumValueLabel: {
                            Text("快")
                        }
                        .onChange(of: rate) { _, v in
                            var f = FeatureSettings(); f.speechRate = Float(v)
                        }
                        .accessibilityLabel("语速")
                        .accessibilityValue("\(Int(rate * 100)) %")
                    }
                    Toggle("接近声呐（越近蜂鸣越密）", isOn: $sonarOn)
                        .onChange(of: sonarOn) { _, v in
                            var f = FeatureSettings(); f.proximitySonar = v
                        }
                    Picker("播报详略", selection: $verbosity) {
                        Text("安静（只危险）").tag(0)
                        Text("正常（转向+危险）").tag(1)
                        Text("详细（全部）").tag(2)
                    }
                    .onChange(of: verbosity) { _, v in
                        var f = FeatureSettings(); f.verbosity = v
                    }
                    Button("试听播报") {
                        previewSpeech.play(FeedbackEvent(priority: .obstacle, speech: sampleAnnouncement()))
                    }
                    .accessibilityHint("用当前语速和详略念一句示例")
                } header: {
                    Text("播报")
                } footer: {
                    Text("简短播报更快说完、降低认知负荷；语速可按习惯调整。接近声呐像倒车雷达，正前方越近蜂鸣越急。")
                }

                Section {
                    Toggle("高对比大字状态条", isOn: $highContrastOn)
                        .onChange(of: highContrastOn) { _, v in
                            var f = FeatureSettings(); f.highContrast = v
                        }
                    Button("试一下震动") {
                        previewHaptic.play(FeedbackEvent(priority: .obstacle, speech: nil))
                    }
                    .accessibilityHint("播放一次危险等级的震动")
                } header: {
                    Text("无障碍")
                } footer: {
                    Text("为低视力用户：避障状态用实底深色 + 高亮大字显示。文字大小同时跟随系统「字体大小」设置。")
                }

                Section("账号") {
                    NavigationLink("登录 / 注册") { LoginView() }
                    NavigationLink("亲友与紧急呼叫") { FamilyLinksView() }
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
                    if devModeOn {
                        Toggle("动态 ROI 碰撞走廊（实验）", isOn: $dynamicROIOn)
                            .onChange(of: dynamicROIOn) { _, v in
                                var d = DevSettings(); d.dynamicROIEnabled = v
                            }
                    }
                } header: {
                    Text("开发者")
                } footer: {
                    Text("开启开发者模式后首屏叠加显示温度、帧率、检测器、ROI 等。动态 ROI 用碰撞走廊随相机姿态投影检测区（实验，需真机调参；绿框即当前检测区）。")
                }

                Section("帮助") {
                    Button("重看使用教程") { showTutorial = true }
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
            .fullScreenCover(isPresented: $showTutorial) {
                TutorialView { showTutorial = false }
            }
        }
    }

    private func sampleAnnouncement() -> String {
        let o = Obstacle(label: "行人", clock: ClockDirection(angleDegrees: 30), distanceMeters: 1.5, confidence: 1)
        return SpeechComposer().announce(o, concise: FeatureSettings().conciseAnnouncements)
    }
}

#Preview {
    SettingsView(store: ConsentStore()) {}
}
