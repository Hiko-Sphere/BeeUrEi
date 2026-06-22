import SwiftUI

/// 设置页（盲人优先 v3）：信息架构对照行业顶尖做法（iOS 系统设置 / Be My Eyes / Seeing AI）重排——
/// **身份卡置顶**（账号与安全一处管理），随后按 **安全 → 语音 → 外观与屏幕 → 法律与帮助** 分组；
/// 把摔倒的「亲友与紧急联系」挪到安全区（接收人与触发器同处）、把低视力必备的「高对比」与「常亮时长」
/// 从二级「更多设置」上移到主屏；仅保留真正次要、设一次即可的项（声呐/空间音/通畅确认、导航地区、开发者、关于）于二级页。
struct SettingsView: View {
    let store: ConsentStore
    let onClose: () -> Void
    @Environment(AuthSession.self) private var session

    // 安全
    @State private var avoidanceOn: Bool
    @State private var navigationOn: Bool
    @State private var fallDetectOn: Bool
    // 语音播报
    @State private var languagePref: String
    @State private var rate: Double
    @State private var verbosity: Int
    @State private var concise: Bool
    @State private var briefReminderOn: Bool   // 开始避障时的提醒语音（属语音偏好，从原「更多设置」上移）
    // 外观与屏幕
    @State private var highContrastOn: Bool
    @State private var keepAwakeSeconds: Int

    @State private var showTutorial = false
    @State private var showAvoidanceOffConfirm = false   // 关闭实时避障二次确认（安全攸关）
    @State private var previewSpeech = SpeechFeedback()
    @State private var previewHaptic = HapticFeedback()

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
        _briefReminderOn = State(initialValue: store.briefReminderSpeechEnabled)
        _highContrastOn = State(initialValue: f.highContrast)
        _keepAwakeSeconds = State(initialValue: f.keepAwakeSeconds)
    }

    /// 设置页文案语言（E5）：每次渲染解析；切换「播报语言」后界面即时跟随。
    private var lang: Language { Language.resolve(preference: languagePref,
                                                  systemCode: Locale.preferredLanguages.first) }

    var body: some View {
        NavigationStack {
            Form {
                identitySection      // 0) 身份与账号（置顶）
                safetySection        // 1) 安全
                voiceSection         // 2) 语音播报
                displayScreenSection // 3) 外观与屏幕
                legalHelpSection     // 4) 法律与帮助（含更多设置）
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

    // MARK: - 0) 身份与账号（置顶身份卡 + 我的录音 / 实时位置 直达）

    @ViewBuilder private var identitySection: some View {
        // 实时位置、我的录音、亲友与紧急呼叫已移出设置，作为「主要功能」放在首屏 Hub（见 HubView）。
        Section {
            NavigationLink { LoginView() } label: { identityCardLabel }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(identityA11yLabel)
                .accessibilityHint(AccountStrings.navTitle(lang))
                .accessibilityAddTraits(.isButton)   // .combine 会吞掉 NavigationLink 的可点语义，须显式补回
        } footer: {
            Text(SettingsStrings.identityFooter(lang))
        }
    }

    private var identityCardLabel: some View {
        HStack(spacing: BeeSpacing.md) {
            if let u = session.user {
                AvatarView(dataURL: u.avatar, name: u.displayName, size: 52)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(u.displayName).font(.headline)
                    Text("@\(u.username) · \(AccountStrings.roleName(u.role, lang))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Image(systemName: "person.crop.circle").font(.system(size: 44)).foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(SettingsStrings.signInPrompt(lang)).font(.headline)
                    Text(SettingsStrings.signInSubtitle(lang)).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var identityA11yLabel: String {
        if let u = session.user {
            return "\(u.displayName)，@\(u.username)，\(AccountStrings.roleName(u.role, lang))"
        }
        // 未登录：把视觉上的副标题也读给 VoiceOver（显式 label 会取代自动合并的子视图）。
        return SettingsStrings.signInPrompt(lang) + "，" + SettingsStrings.signInSubtitle(lang)
    }

    // MARK: - 1) 安全（避障 / 导航 / 摔倒 + 亲友与紧急联系）

    @ViewBuilder private var safetySection: some View {
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
            // 「亲友与紧急呼叫」已移到首屏 Hub 作为主要功能（摔倒会通知那里设置的家人）。
        } header: {
            Text(SettingsStrings.safetyHeader(lang))
        } footer: {
            Text(SettingsStrings.safetyFooter(lang))
        }
    }

    // MARK: - 2) 语音播报（语言 / 语速 / 详略 / 简短 / 开始提醒 / 试听）

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
                    let resolved = Language.resolve(preference: v, systemCode: Locale.preferredLanguages.first)
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
            Toggle(SettingsStrings.briefReminderToggle(lang), isOn: $briefReminderOn)
                .onChange(of: briefReminderOn) { _, v in store.briefReminderSpeechEnabled = v }
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

    // MARK: - 3) 外观与屏幕（高对比 + 常亮时长 + 试触；低视力必备，从「更多设置」上移）

    @ViewBuilder private var displayScreenSection: some View {
        Section {
            Toggle(SettingsStrings.highContrastToggle(lang), isOn: $highContrastOn)
                .onChange(of: highContrastOn) { _, v in
                    var f = FeatureSettings(); f.highContrast = v
                }
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
            Button(SettingsStrings.previewHaptic(lang)) {
                previewHaptic.play(FeedbackEvent(priority: .obstacle, speech: nil))
            }
            .accessibilityHint(SettingsStrings.previewHapticHint(lang))
        } header: {
            Text(SettingsStrings.displayScreenHeader(lang))
        } footer: {
            Text(SettingsStrings.displayScreenFooter(lang))
        }
    }

    // MARK: - 4) 法律与帮助（法律中心 / 重看教程 / 恢复默认 / 更多设置）

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
            NavigationLink {
                AdvancedSettingsView()
            } label: {
                Label(SettingsStrings.moreSettings(lang), systemImage: "slider.horizontal.3")
            }
            // 唯一的破坏性操作：垫底；尾注诚实说明只还原语音/显示偏好。
            Button(role: .destructive) {
                FeatureSettings.resetToDefaults()
                let f = FeatureSettings()
                concise = f.conciseAnnouncements
                rate = Double(f.speechRate)
                verbosity = f.verbosity
                highContrastOn = f.highContrast
            } label: {
                Label(SettingsStrings.resetDefaults(lang), systemImage: "arrow.counterclockwise")
            }
            .accessibilityHint(SettingsStrings.resetDefaultsHint(lang))
        } header: {
            Text(SettingsStrings.legalHelpHeader(lang))
        } footer: {
            Text(SettingsStrings.resetScopeFooter(lang) + "\n" + LegalStrings.versionLine(lang))
        }
    }

    private func sampleAnnouncement() -> String {
        let language = FeatureSettings().language
        let o = Obstacle(label: LabelCatalog(language: language).localizedName("person"),
                         clock: ClockDirection(angleDegrees: 30), distanceMeters: 1.5, confidence: 1)
        return SpeechComposer().announce(o, concise: FeatureSettings().conciseAnnouncements, language: language)
    }
}

/// 「更多设置」二级页（设置 v3 精简）：只留真正次要、设一次即可的项——
/// 障碍提示细节（声呐/空间音/通畅确认）、导航地区、开发者、关于。
/// 高对比 / 常亮时长 / 试触 / 开始提醒 已上移到主屏对应分区。
struct AdvancedSettingsView: View {
    @State private var sonarOn: Bool
    @State private var spatialCuesOn: Bool
    @State private var clearConfirm: Bool
    @State private var devModeOn: Bool
    @State private var dynamicROIOn: Bool
    @AppStorage("nav.region") private var regionRaw = ""   // ""=自动；"china"=高德；"overseas"=MapKit（NavigationView 读取）

    init() {
        let f = FeatureSettings()
        _sonarOn = State(initialValue: f.proximitySonar)
        _spatialCuesOn = State(initialValue: f.spatialObstacleCues)
        _clearConfirm = State(initialValue: f.clearPathConfirm)
        _devModeOn = State(initialValue: DevSettings().enabled)
        _dynamicROIOn = State(initialValue: DevSettings().dynamicROIEnabled)
    }

    private var lang: Language { FeatureSettings().language }

    var body: some View {
        Form {
            obstacleDetailSection
            navRegionSection
            developerSection
            aboutSection
        }
        .navigationTitle(SettingsStrings.moreSettings(lang))
        .navigationBarTitleDisplayMode(.inline)
    }

    /// 障碍提示细节——可选的额外感知：声呐 / 空间音 / 通畅确认。
    @ViewBuilder private var obstacleDetailSection: some View {
        Section {
            Toggle(SettingsStrings.sonarToggle(lang), isOn: $sonarOn)
                .onChange(of: sonarOn) { _, v in var f = FeatureSettings(); f.proximitySonar = v }
            Toggle(SettingsStrings.spatialToggle(lang), isOn: $spatialCuesOn)
                .onChange(of: spatialCuesOn) { _, v in var f = FeatureSettings(); f.spatialObstacleCues = v }
                .accessibilityHint(SettingsStrings.spatialHint(lang))
            Toggle(SettingsStrings.clearConfirmToggle(lang), isOn: $clearConfirm)
                .onChange(of: clearConfirm) { _, v in var f = FeatureSettings(); f.clearPathConfirm = v }
        } header: {
            Text(SettingsStrings.obstacleHeader(lang))
        } footer: {
            Text(SettingsStrings.obstacleFooter(lang))
        }
    }

    /// 导航地区——很少需要改；以前只在导航屏内自动判定，这里上升为可常驻设置。
    @ViewBuilder private var navRegionSection: some View {
        Section {
            Picker(NavStrings.regionPickerLabel(lang), selection: $regionRaw) {
                Text(NavStrings.regionAuto(lang)).tag("")
                Text(NavStrings.regionChina(lang)).tag("china")
                Text(NavStrings.regionOverseas(lang)).tag("overseas")
            }
        } header: {
            Text(NavStrings.regionHeader(lang))
        } footer: {
            Text(NavStrings.regionFooter(lang))
        }
    }

    /// 开发者——次要项垫底。
    @ViewBuilder private var developerSection: some View {
        Section {
            Toggle(SettingsStrings.devModeToggle(lang), isOn: $devModeOn)
                .onChange(of: devModeOn) { _, v in var d = DevSettings(); d.enabled = v }
            if devModeOn {
                Toggle(SettingsStrings.dynamicROIToggle(lang), isOn: $dynamicROIOn)
                    .onChange(of: dynamicROIOn) { _, v in var d = DevSettings(); d.dynamicROIEnabled = v }
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
