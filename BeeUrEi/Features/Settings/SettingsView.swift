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
    @State private var keepAwakeSeconds: Int
    @State private var languagePref: String
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
        _spatialCuesOn = State(initialValue: features.spatialObstacleCues)
        _verbosity = State(initialValue: features.verbosity)
        _clearConfirm = State(initialValue: features.clearPathConfirm)
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
                    // 双语标签：英文用户也能變出这个选项（播报语言）。
                    Picker("播报语言 / Speech language", selection: $languagePref) {
                        Text("跟随系统 / System").tag("system")
                        Text("中文").tag("zh")
                        Text("English").tag("en")
                    }
                    .onChange(of: languagePref) { _, v in
                        var f = FeatureSettings(); f.languagePreference = v
                    }
                } header: {
                    Text("语言 / Language")
                } footer: {
                    Text("决定避障实时语音引导的语言与嗓音（中文/English）。Sets the language and voice for real-time obstacle guidance.")
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
                    LabeledContent(SettingsStrings.versionLabel(lang), value: "0.1.0")
                }

                Section(SettingsStrings.disclaimerHeader(lang)) {
                    Text(DisclaimerText.full)
                        .font(.body)
                        .accessibilityLabel(DisclaimerText.full)
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
        }
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
