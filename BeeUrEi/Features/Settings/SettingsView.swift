import SwiftUI

/// 设置页（盲人优先 v2）：主屏只放高优先级、日常会用的项（核心安全 / 语音 / 账户 / 法律与帮助），
/// 把次要、设一次就好的项（障碍提示细节 / 外观 / 屏幕 / 开发者 / 关于）收进「更多设置」二级页，
/// 解决「主次不清、太长」的问题。核心安全置顶；法律文件入口显著。
struct SettingsView: View {
    let store: ConsentStore
    let onClose: () -> Void

    // 主屏（高优先级）状态
    @State private var avoidanceOn: Bool
    @State private var navigationOn: Bool
    @State private var fallDetectOn: Bool
    @State private var languagePref: String
    @State private var rate: Double
    @State private var verbosity: Int
    @State private var concise: Bool
    @State private var showTutorial = false
    @State private var showAvoidanceOffConfirm = false   // 关闭实时避障二次确认（安全攸关）
    @State private var previewSpeech = SpeechFeedback()

    init(store: ConsentStore, onClose: @escaping () -> Void) {
        self.store = store
        self.onClose = onClose
        let f = FeatureSettings()
        _avoidanceOn = State(initialValue: f.avoidanceEnabled)
        _navigationOn = State(initialValue: f.navigationEnabled)
        _fallDetectOn = State(initialValue: f.fallDetectionEnabled)
        _languagePref = State(initialValue: f.languagePreference)
        _rate = State(initialValue: Double(f.speechRate))
        _verbosity = State(initialValue: f.verbosity)
        _concise = State(initialValue: f.conciseAnnouncements)
    }

    /// 设置页文案语言（E5）：每次渲染解析；切换「播报语言」后界面即时跟随。
    private var lang: Language { Language.resolve(preference: languagePref,
                                                  systemCode: Locale.preferredLanguages.first) }

    var body: some View {
        NavigationStack {
            // 主屏只保留高优先项；其余进入「更多设置」。
            Form {
                coreSafetySection
                voiceSection
                accountSection
                legalHelpSection
                moreSection
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

    // MARK: - 主屏分区

    /// 1) 核心安全——最重要，置顶。
    @ViewBuilder private var coreSafetySection: some View {
        Section {
            Toggle(SettingsStrings.avoidanceToggle(lang), isOn: $avoidanceOn)
                .onChange(of: avoidanceOn) { _, v in
                    var f = FeatureSettings(); f.avoidanceEnabled = v
                    if !v {
                        SpeechHub.shared.speak(SpokenStrings.avoidanceOff(lang), channel: .navigation, voiceCode: lang.voiceCode)
                        showAvoidanceOffConfirm = true
                    }
                }
            Toggle(SettingsStrings.navigationToggle(lang), isOn: $navigationOn)
                .onChange(of: navigationOn) { _, v in
                    var f = FeatureSettings(); f.navigationEnabled = v
                }
            Toggle(SettingsStrings.fallDetectToggle(lang), isOn: $fallDetectOn)
                .onChange(of: fallDetectOn) { _, v in
                    var f = FeatureSettings(); f.fallDetectionEnabled = v
                }
                .accessibilityHint(SettingsStrings.fallDetectHint(lang))
        } header: {
            Text(SettingsStrings.coreSafetyHeader(lang))
        } footer: {
            Text(SettingsStrings.coreSafetyFooter(lang))
        }
    }

    /// 2) 语音播报——日常最常调：语言 / 语速 / 详略 / 简短 / 试听。
    @ViewBuilder private var voiceSection: some View {
        Section {
            Picker(SettingsStrings.languagePickerLabel(lang), selection: $languagePref) {
                Text(SettingsStrings.languageSystemOption(lang)).tag("system")
                Text("中文").tag("zh")
                Text("English").tag("en")
            }
            .onChange(of: languagePref) { _, v in
                var f = FeatureSettings(); f.languagePreference = v
                if let token = KeychainStore.read() {
                    let resolved = Language.resolve(preference: v,
                                                    systemCode: Locale.preferredLanguages.first)
                    Task { await APIClient().setLanguage(token: token, language: resolved.rawValue) }
                }
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
            Picker(SettingsStrings.verbosityPicker(lang), selection: $verbosity) {
                Text(SettingsStrings.verbosityQuiet(lang)).tag(0)
                Text(SettingsStrings.verbosityNormal(lang)).tag(1)
                Text(SettingsStrings.verbosityDetailed(lang)).tag(2)
            }
            .onChange(of: verbosity) { _, v in
                var f = FeatureSettings(); f.verbosity = v
            }
            Toggle(SettingsStrings.conciseToggle(lang), isOn: $concise)
                .onChange(of: concise) { _, v in
                    var f = FeatureSettings(); f.conciseAnnouncements = v
                }
            Button(SettingsStrings.previewSpeech(lang)) {
                previewSpeech.play(FeedbackEvent(priority: .obstacle, speech: sampleAnnouncement()))
            }
            .accessibilityHint(SettingsStrings.previewSpeechHint(lang))
        } header: {
            Text(SettingsStrings.voiceHeader(lang))
        } footer: {
            Text(SettingsStrings.voiceFooter(lang))
        }
    }

    /// 3) 账户与亲友。
    @ViewBuilder private var accountSection: some View {
        Section(SettingsStrings.accountHeader(lang)) {
            NavigationLink(SettingsStrings.loginRegister(lang)) { LoginView() }
            NavigationLink(SettingsStrings.familyAndEmergency(lang)) { FamilyLinksView() }
        }
    }

    /// 4) 法律与帮助——法律文件入口显著置于此；含重看教程与恢复默认。
    @ViewBuilder private var legalHelpSection: some View {
        Section {
            NavigationLink {
                LegalCenterView()
            } label: {
                Label(LegalStrings.legalCenter(lang), systemImage: "lock.shield")
            }
            Button {
                showTutorial = true
            } label: {
                Label(SettingsStrings.replayTutorial(lang), systemImage: "play.circle")
            }
            Button(role: .destructive) {
                FeatureSettings.resetToDefaults()
                let f = FeatureSettings()
                concise = f.conciseAnnouncements
                rate = Double(f.speechRate)
                verbosity = f.verbosity
            } label: {
                Label(SettingsStrings.resetDefaults(lang), systemImage: "arrow.counterclockwise")
            }
            .accessibilityHint(SettingsStrings.resetDefaultsHint(lang))
        } header: {
            Text(SettingsStrings.legalHelpHeader(lang))
        } footer: {
            Text(LegalStrings.versionLine(lang))
        }
    }

    /// 5) 更多设置——次要项收进二级页，保持主屏简洁、主次分明。
    @ViewBuilder private var moreSection: some View {
        Section {
            NavigationLink {
                AdvancedSettingsView(store: store)
            } label: {
                Label(SettingsStrings.moreSettings(lang), systemImage: "slider.horizontal.3")
            }
        } footer: {
            Text(SettingsStrings.moreSettingsHint(lang))
        }
    }

    /// 版本号从打包信息读取，避免硬编码与真实版本脱节（见审计 P3）。
    private var appVersion: String { beeAppVersion() }

    private func sampleAnnouncement() -> String {
        let language = FeatureSettings().language
        let o = Obstacle(label: LabelCatalog(language: language).localizedName("person"),
                         clock: ClockDirection(angleDegrees: 30), distanceMeters: 1.5, confidence: 1)
        return SpeechComposer().announce(o, concise: FeatureSettings().conciseAnnouncements, language: language)
    }
}

/// 「更多设置」二级页：障碍提示细节 / 触觉与显示 / 屏幕与省电 / 开发者 / 关于。
/// 这些是次要、设一次即可的项，从主屏下沉于此，让盲人在主屏更快找到核心开关。
struct AdvancedSettingsView: View {
    let store: ConsentStore

    @State private var briefReminderOn: Bool
    @State private var sonarOn: Bool
    @State private var spatialCuesOn: Bool
    @State private var clearConfirm: Bool
    @State private var highContrastOn: Bool
    @State private var keepAwakeSeconds: Int
    @State private var devModeOn: Bool
    @State private var dynamicROIOn: Bool
    @State private var previewHaptic = HapticFeedback()

    init(store: ConsentStore) {
        self.store = store
        let f = FeatureSettings()
        _briefReminderOn = State(initialValue: store.briefReminderSpeechEnabled)
        _sonarOn = State(initialValue: f.proximitySonar)
        _spatialCuesOn = State(initialValue: f.spatialObstacleCues)
        _clearConfirm = State(initialValue: f.clearPathConfirm)
        _highContrastOn = State(initialValue: f.highContrast)
        _keepAwakeSeconds = State(initialValue: f.keepAwakeSeconds)
        _devModeOn = State(initialValue: DevSettings().enabled)
        _dynamicROIOn = State(initialValue: DevSettings().dynamicROIEnabled)
    }

    private var lang: Language { FeatureSettings().language }

    var body: some View {
        Form {
            obstacleSection
            displaySection
            screenSection
            developerSection
            aboutSection
        }
        .navigationTitle(SettingsStrings.moreSettings(lang))
        .navigationBarTitleDisplayMode(.inline)
    }

    /// 障碍提示——可选的额外感知：开始提醒 / 声呐 / 空间音 / 通畅确认。
    @ViewBuilder private var obstacleSection: some View {
        Section {
            Toggle(SettingsStrings.briefReminderToggle(lang), isOn: $briefReminderOn)
                .onChange(of: briefReminderOn) { _, newValue in
                    store.briefReminderSpeechEnabled = newValue
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
            Toggle(SettingsStrings.clearConfirmToggle(lang), isOn: $clearConfirm)
                .onChange(of: clearConfirm) { _, v in
                    var f = FeatureSettings(); f.clearPathConfirm = v
                }
        } header: {
            Text(SettingsStrings.obstacleHeader(lang))
        } footer: {
            Text(SettingsStrings.obstacleFooter(lang))
        }
    }

    /// 触觉与显示——低视力相关：高对比状态条 + 试触振动。
    @ViewBuilder private var displaySection: some View {
        Section {
            Toggle(SettingsStrings.highContrastToggle(lang), isOn: $highContrastOn)
                .onChange(of: highContrastOn) { _, v in
                    var f = FeatureSettings(); f.highContrast = v
                }
            Button(SettingsStrings.previewHaptic(lang)) {
                previewHaptic.play(FeedbackEvent(priority: .obstacle, speech: nil))
            }
            .accessibilityHint(SettingsStrings.previewHapticHint(lang))
        } header: {
            Text(SettingsStrings.displayHeader(lang))
        } footer: {
            Text(SettingsStrings.a11yFooter(lang))
        }
    }

    /// 屏幕与省电——避障常亮时长。
    @ViewBuilder private var screenSection: some View {
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
    }

    /// 开发者——次要项垫底。
    @ViewBuilder private var developerSection: some View {
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
    }

    /// 关于——组织 / 制作人 / 版本。
    @ViewBuilder private var aboutSection: some View {
        Section(SettingsStrings.aboutHeader(lang)) {
            LabeledContent(SettingsStrings.orgLabel(lang), value: "Hiko Sphere 彦穹科技")
            LabeledContent(SettingsStrings.producerLabel(lang), value: "Li Yanpei Hiko")
            LabeledContent(SettingsStrings.versionLabel(lang), value: beeAppVersion())
        }
    }
}

/// App 版本号（主屏与「更多设置」共用）：从打包信息读取，避免硬编码脱节。
func beeAppVersion() -> String {
    let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String
    return b.map { "\(v) (\($0))" } ?? v
}

#Preview {
    SettingsView(store: ConsentStore()) {}
}
