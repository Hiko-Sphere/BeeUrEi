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
            // 盲人优先信息架构：核心安全置顶 → 语音播报 → 障碍提示 → 显示 → 屏幕 →
            // 账号 → 帮助 → 法律 → 关于 → 开发者（次要项依次下沉，开发者垫底）。
            Form {
                coreSafetySection
                voiceSection
                obstacleSection
                displaySection
                screenSection
                accountSection
                helpSection
                legalSection
                aboutSection
                developerSection
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

    // MARK: - 分区（拆成计算属性：盲人优先排序 + 规避 SwiftUI 单表达式类型检查超时）

    /// 1) 核心安全——最重要，置顶。实时避障 / 步行导航 / 摔倒报警。
    @ViewBuilder private var coreSafetySection: some View {
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

    /// 3) 障碍提示——可选的额外感知：开始提醒 / 声呐 / 空间音 / 通畅确认。
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

    /// 4) 触觉与显示——低视力相关：高对比状态条 + 试触振动。
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

    /// 5) 屏幕与省电——避障常亮时长。
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

    /// 6) 账号与亲友——登录 / 亲友与紧急呼叫。
    @ViewBuilder private var accountSection: some View {
        Section(SettingsStrings.accountHeader(lang)) {
            NavigationLink(SettingsStrings.loginRegister(lang)) { LoginView() }
            NavigationLink(SettingsStrings.familyAndEmergency(lang)) { FamilyLinksView() }
        }
    }

    /// 7) 帮助——重看教程 + 恢复默认（破坏性，放此处而非和安全开关混在一起）。
    @ViewBuilder private var helpSection: some View {
        Section(SettingsStrings.helpHeader(lang)) {
            Button(SettingsStrings.replayTutorial(lang)) { showTutorial = true }
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
        }
    }

    /// 8) 法律与隐私——法律中心（隐私政策 / 使用条款 / EULA / 安全须知）。
    @ViewBuilder private var legalSection: some View {
        Section {
            NavigationLink {
                LegalCenterView()
            } label: {
                Label(LegalStrings.legalCenter(lang), systemImage: "lock.shield")
            }
        } header: {
            Text(SettingsStrings.disclaimerHeader(lang))
        } footer: {
            Text(LegalStrings.versionLine(lang))
        }
    }

    /// 9) 关于——组织 / 制作人 / 版本。
    @ViewBuilder private var aboutSection: some View {
        Section(SettingsStrings.aboutHeader(lang)) {
            LabeledContent(SettingsStrings.orgLabel(lang), value: "Hiko Sphere 彦穹科技")
            LabeledContent(SettingsStrings.producerLabel(lang), value: "Li Yanpei Hiko")
            LabeledContent(SettingsStrings.versionLabel(lang), value: appVersion)
        }
    }

    /// 10) 开发者——次要项垫底，避免干扰盲人日常使用。
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
