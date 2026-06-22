import SwiftUI

/// 协助端（协助者 / 亲友）统一设置页。此前协助端没有真正的「设置」——语言无处可改（英文协助者被卡住）、
/// 匹配偏好藏在「帮助大家」标签的弹窗里、法律与关于无入口。对照行业顶尖做法（账号置顶、语言与外观、
/// 偏好、法律）重排为一处：身份 → 语言与外观 → 匹配偏好 → 法律与帮助。账号与安全复用共享的 LoginView。
///
/// 由 `AssistHomeView` 的「我的」标签经 NavigationLink 推入（已在 NavigationStack 内，故此处不再套）。
struct HelperSettingsView: View {
    let session: AuthSession

    @State private var languagePref: String
    @AppStorage("match.preferredLanguage") private var preferredLanguage = ""   // 与「帮助大家」偏好同键，自动同步
    @AppStorage("match.requireLanguage") private var requireLanguageMatch = false

    init(session: AuthSession) {
        self.session = session
        _languagePref = State(initialValue: FeatureSettings().languagePreference)
    }

    /// 切语言后界面即时跟随。
    private var lang: Language { Language.resolve(preference: languagePref,
                                                  systemCode: Locale.preferredLanguages.first) }

    var body: some View {
        Form {
            accountSection
            languageSection
            matchSection
            legalSection
            aboutSection
        }
        .navigationTitle(HelperStrings.settingsTitle(lang))
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: 1) 账户（身份卡 → 账号与安全）

    @ViewBuilder private var accountSection: some View {
        Section {
            NavigationLink { LoginView() } label: { identityCardLabel }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(identityA11yLabel)
                .accessibilityHint(HelperStrings.accountAndSecurity(lang))
                .accessibilityAddTraits(.isButton)   // .combine 会吞掉 NavigationLink 的可点语义，须显式补回
        } header: {
            Text(HelperStrings.accountHeader(lang))
        } footer: {
            Text(HelperStrings.mergedExplain(lang))
        }
    }

    private var identityCardLabel: some View {
        HStack(spacing: BeeSpacing.md) {
            if let u = session.user {
                AvatarView(dataURL: u.avatar, name: u.displayName, size: 52).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(u.displayName).font(.headline)
                    Text("@\(u.username) · \(AccountStrings.roleName(u.role, lang))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } else {
                Image(systemName: "person.crop.circle").font(.system(size: 44)).foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text(HelperStrings.accountAndSecurity(lang)).font(.headline)
            }
        }
        .padding(.vertical, 4)
    }

    private var identityA11yLabel: String {
        guard let u = session.user else { return HelperStrings.accountAndSecurity(lang) }
        return "\(u.displayName)，@\(u.username)，\(AccountStrings.roleName(u.role, lang))"
    }

    // MARK: 2) 语言与外观（界面与播报语言——补齐协助端此前完全缺失的语言开关）

    @ViewBuilder private var languageSection: some View {
        Section {
            Picker(HelperStrings.appLanguageLabel(lang), selection: $languagePref) {
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
        } header: {
            Text(HelperStrings.languageAppearanceHeader(lang))
        } footer: {
            Text(HelperStrings.languageAppearanceFooter(lang))
        }
    }

    // MARK: 3) 匹配偏好（从「帮助大家」弹窗上移为常驻设置；在线状态只读展示）

    @ViewBuilder private var matchSection: some View {
        Section {
            // 在线状态：只读展示真实「打开 App 即在线」的事实（无持久化待命开关，不臆造 toggle）。
            LabeledContent(HelperStrings.onlineStatusLabel(lang)) {
                BeeStatusPill(text: HelperStrings.onlineNow(lang))
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(HelperStrings.onlineStatusLabel(lang) + "：" + HelperStrings.onlineNow(lang))
            Picker(HelperStrings.preferredLanguageHeader(lang), selection: $preferredLanguage) {
                Text(HelperStrings.anyOption(lang)).tag("")
                Text("中文").tag("zh")
                Text("English").tag("en")
            }
            Toggle(HelperStrings.requireSameLanguage(lang), isOn: $requireLanguageMatch)
                .disabled(preferredLanguage.isEmpty)
        } header: {
            Text(HelperStrings.matchPrefsHeader(lang))
        } footer: {
            Text(HelperStrings.requireSameLanguageFooter(lang) + "\n" + HelperStrings.alwaysOnlineFooter(lang))
        }
    }

    // MARK: 4) 法律与帮助（协助端此前无入口——但同样同意了录制/旁观，必须可查阅）

    @ViewBuilder private var legalSection: some View {
        Section {
            NavigationLink {
                LegalCenterView()
            } label: {
                Label(LegalStrings.legalCenter(lang), systemImage: "lock.shield")
            }
        } header: {
            Text(HelperStrings.legalHelpHeader(lang))
        } footer: {
            Text(LegalStrings.versionLine(lang))
        }
    }

    // MARK: 5) 关于

    @ViewBuilder private var aboutSection: some View {
        Section(HelperStrings.aboutHeader(lang)) {
            LabeledContent(SettingsStrings.orgLabel(lang), value: "Hiko Sphere 彦穹科技")
            LabeledContent(SettingsStrings.producerLabel(lang), value: "Li Yanpei Hiko")
            LabeledContent(SettingsStrings.versionLabel(lang), value: beeAppVersion())
        }
    }
}
