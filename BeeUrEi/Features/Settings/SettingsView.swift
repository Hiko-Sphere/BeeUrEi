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
    @State private var spatialCuesOn: Bool
    @State private var verbosity: Int
    @State private var clearConfirm: Bool
    @State private var fallDetectOn: Bool
    @State private var keepAwakeSeconds: Int
    @State private var languagePref: String
    @State private var showTutorial = false
    @State private var showAvoidanceOffConfirm = false   // 关闭实时避障二次确认（安全攸关）
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
        _spatialCuesOn = State(initialValue: features.spatialObstacleCues)
        _verbosity = State(initialValue: features.verbosity)
        _clearConfirm = State(initialValue: features.clearPathConfirm)
        _fallDetectOn = State(initialValue: features.fallDetectionEnabled)
        _keepAwakeSeconds = State(initialValue: features.keepAwakeSeconds)
        _languagePref = State(initialValue: features.languagePreference)
    }

    /// 设置页文案语言（E5）：每次渲染解析；切换「播报语言」后界面即时跟随。
    private var lang: Language { Language.resolve(preference: languagePref,
                                                  systemCode: Locale.preferredLanguages.first) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Toggle(SettingsStrings.briefReminderToggle(lang), isOn: $briefReminderOn)
                        .onChange(of: briefReminderOn) { _, newValue in
                            store.briefReminderSpeechEnabled = newValue
                        }
                } header: {
                    Text(SettingsStrings.reminderHeader(lang))
                } footer: {
                    Text(SettingsStrings.reminderFooter(lang))
                }

                Section {
                    // 语言切换刻意双语并排（看不懂当前语言的用户也要能找到它）。
                    Picker(SettingsStrings.languagePickerLabel(lang), selection: $languagePref) {
                        Text(SettingsStrings.languageSystemOption(lang)).tag("system")
                        Text("中文").tag("zh")
                        Text("English").tag("en")
                    }
                    .onChange(of: languagePref) { _, v in
                        var f = FeatureSettings(); f.languagePreference = v
                        // 同步到后端（尽力而为）：来电/好友请求等推送文案按 users.language 选语言。
                        if let token = KeychainStore.read() {
                            let resolved = Language.resolve(preference: v,
                                                            systemCode: Locale.preferredLanguages.first)
                            Task { await APIClient().setLanguage(token: token, language: resolved.rawValue) }
                        }
                    }
                } header: {
                    Text(SettingsStrings.languageHeader(lang))
                } footer: {
                    Text(SettingsStrings.languageFooter(lang))
                }

                Section {
                    Toggle(SettingsStrings.conciseToggle(lang), isOn: $concise)
                        .onChange(of: concise) { _, v in
                            var f = FeatureSettings(); f.conciseAnnouncements = v
                        }
                    VStack(alignment: .leading) {
                        Text(SettingsStrings.speechRate(lang))
                        Slider(value: $rate, in: 0...1, step: 0.05) {
                            Text(SettingsStrings.speechRate(lang))
                        } minimumValueLabel: {
                            Text(SettingsStrings.slow(lang))
                        } maximumValueLabel: {
                            Text(SettingsStrings.fast(lang))
                        }
                        .onChange(of: rate) { _, v in
                            var f = FeatureSettings(); f.speechRate = Float(v)
                        }
                        .accessibilityLabel(SettingsStrings.speechRate(lang))
                        .accessibilityValue("\(Int(rate * 100)) %")
                    }
                    Toggle(SettingsStrings.sonarToggle(lang), isOn: $sonarOn)
                        .onChange(of: sonarOn) { _, v in
                            var f = FeatureSettings(); f.proximitySonar = v
                        }
                    Toggle(SettingsStrings.spatialToggle(lang), isOn: $spatialCuesOn)
                        .onChange(of: spatialCuesOn) { _, v in
                            var f = FeatureSettings(); f.spatialObstacleCues = v
                        }
                        .accessibilityHint(SettingsStrings.spatialHint(lang))
                    Picker(SettingsStrings.verbosityPicker(lang), selection: $verbosity) {
                        Text(SettingsStrings.verbosityQuiet(lang)).tag(0)
                        Text(SettingsStrings.verbosityNormal(lang)).tag(1)
                        Text(SettingsStrings.verbosityDetailed(lang)).tag(2)
                    }
                    .onChange(of: verbosity) { _, v in
                        var f = FeatureSettings(); f.verbosity = v
                    }
                    Toggle(SettingsStrings.clearConfirmToggle(lang), isOn: $clearConfirm)
                        .onChange(of: clearConfirm) { _, v in
                            var f = FeatureSettings(); f.clearPathConfirm = v
                        }
                    Toggle(SettingsStrings.fallDetectToggle(lang), isOn: $fallDetectOn)
                        .onChange(of: fallDetectOn) { _, v in
                            var f = FeatureSettings(); f.fallDetectionEnabled = v
                        }
                        .accessibilityHint(SettingsStrings.fallDetectHint(lang))
                    Button(SettingsStrings.previewSpeech(lang)) {
                        previewSpeech.play(FeedbackEvent(priority: .obstacle, speech: sampleAnnouncement()))
                    }
                    .accessibilityHint(SettingsStrings.previewSpeechHint(lang))
                } header: {
                    Text(SettingsStrings.speechHeader(lang))
                } footer: {
                    Text(SettingsStrings.speechFooter(lang))
                }

                Section {
                    Picker(SettingsStrings.keepAwakePicker(lang), selection: $keepAwakeSeconds) {
                        Text(SettingsStrings.keepAwakeForever(lang)).tag(0)
                        Text(SettingsStrings.keepAwakeAfter(300, lang)).tag(300)
                        Text(SettingsStrings.keepAwakeAfter(120, lang)).tag(120)
                        Text(SettingsStrings.keepAwakeAfter(60, lang)).tag(60)
                        Text(SettingsStrings.keepAwakeAfter(30, lang)).tag(30)
                    }
                    .onChange(of: keepAwakeSeconds) { _, v in
                        var f = FeatureSettings(); f.keepAwakeSeconds = v
                    }
                } header: {
                    Text(SettingsStrings.screenHeader(lang))
                } footer: {
                    Text(SettingsStrings.screenFooter(lang))
                }

                Section {
                    Toggle(SettingsStrings.highContrastToggle(lang), isOn: $highContrastOn)
                        .onChange(of: highContrastOn) { _, v in
                            var f = FeatureSettings(); f.highContrast = v
                        }
                    Button(SettingsStrings.previewHaptic(lang)) {
                        previewHaptic.play(FeedbackEvent(priority: .obstacle, speech: nil))
                    }
                    .accessibilityHint(SettingsStrings.previewHapticHint(lang))
                    Button(SettingsStrings.resetDefaults(lang), role: .destructive) {
                        FeatureSettings.resetToDefaults()
                        let f = FeatureSettings()
                        concise = f.conciseAnnouncements
                        rate = Double(f.speechRate)
                        verbosity = f.verbosity
                        clearConfirm = f.clearPathConfirm
                        highContrastOn = f.highContrast
                        sonarOn = f.proximitySonar
                    }
                    .accessibilityHint(SettingsStrings.resetDefaultsHint(lang))
                } header: {
                    Text(SettingsStrings.a11yHeader(lang))
                } footer: {
                    Text(SettingsStrings.a11yFooter(lang))
                }

                Section(SettingsStrings.accountHeader(lang)) {
                    NavigationLink(SettingsStrings.loginRegister(lang)) { LoginView() }
                    NavigationLink(SettingsStrings.familyAndEmergency(lang)) { FamilyLinksView() }
                }

                Section {
                    Toggle(SettingsStrings.avoidanceToggle(lang), isOn: $avoidanceOn)
                        .onChange(of: avoidanceOn) { _, v in
                            var f = FeatureSettings(); f.avoidanceEnabled = v
                            // 关闭实时避障是安全攸关：立刻朗读告知 + 二次确认（误关核心安全功能须可感知，见 P1 审计）。
                            if !v {
                                SpeechHub.shared.speak(SpokenStrings.avoidanceOff(lang), channel: .navigation, voiceCode: lang.voiceCode)
                                showAvoidanceOffConfirm = true
                            }
                        }
                    Toggle(SettingsStrings.navigationToggle(lang), isOn: $navigationOn)
                        .onChange(of: navigationOn) { _, v in
                            var f = FeatureSettings(); f.navigationEnabled = v
                        }
                } header: {
                    Text(SettingsStrings.featuresHeader(lang))
                } footer: {
                    Text(SettingsStrings.featuresFooter(lang))
                }

                Section {
                    Toggle(SettingsStrings.devModeToggle(lang), isOn: $devModeOn)
                        .onChange(of: devModeOn) { _, v in
                            var d = DevSettings(); d.enabled = v
                        }
                    if devModeOn {
                        Toggle(SettingsStrings.dynamicROIToggle(lang), isOn: $dynamicROIOn)
                            .onChange(of: dynamicROIOn) { _, v in
                                var d = DevSettings(); d.dynamicROIEnabled = v
                            }
                    }
                } header: {
                    Text(SettingsStrings.devHeader(lang))
                } footer: {
                    Text(SettingsStrings.devFooter(lang))
                }

                Section(SettingsStrings.helpHeader(lang)) {
                    Button(SettingsStrings.replayTutorial(lang)) { showTutorial = true }
                }

                Section(SettingsStrings.aboutHeader(lang)) {
                    LabeledContent(SettingsStrings.orgLabel(lang), value: "Hiko Sphere 彦穹科技")
                    LabeledContent(SettingsStrings.producerLabel(lang), value: "Li Yanpei Hiko")
                    LabeledContent(SettingsStrings.versionLabel(lang), value: appVersion)
                }

                Section(SettingsStrings.disclaimerHeader(lang)) {
                    Text(DisclaimerText.full(lang))
                        .font(.body)
                        .accessibilityLabel(DisclaimerText.full(lang))
                }
            }
            .navigationTitle(SettingsStrings.navTitle(lang))
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(SettingsStrings.done(lang)) { onClose() }
                }
            }
            .fullScreenCover(isPresented: $showTutorial) {
                TutorialView { showTutorial = false }
            }
            .confirmationDialog(SettingsStrings.avoidanceOffConfirmTitle(lang),
                                isPresented: $showAvoidanceOffConfirm, titleVisibility: .visible) {
                Button(SettingsStrings.keepOn(lang)) {
                    avoidanceOn = true // 反悔：重新开启核心安全功能
                    var f = FeatureSettings(); f.avoidanceEnabled = true
                }
                Button(SettingsStrings.turnOff(lang), role: .destructive) {} // 维持关闭（已在 onChange 持久化）
            } message: {
                Text(SettingsStrings.avoidanceOffConfirmMessage(lang))
            }
        }
    }

    /// 版本号从打包信息读取，避免硬编码与真实版本脱节（见审计 P3）。
    private var appVersion: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String
        return b.map { "\(v) (\($0))" } ?? v
    }

    private func sampleAnnouncement() -> String {
        let language = FeatureSettings().language
        let o = Obstacle(label: LabelCatalog(language: language).localizedName("person"),
                         clock: ClockDirection(angleDegrees: 30), distanceMeters: 1.5, confidence: 1)
        return SpeechComposer().announce(o, concise: FeatureSettings().conciseAnnouncements, language: language)
    }
}

#Preview {
    SettingsView(store: ConsentStore()) {}
}
