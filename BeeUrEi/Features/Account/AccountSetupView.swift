import SwiftUI

/// 新登录方式（注册 / Apple / 邮箱验证码 / passkey）后的账号补全引导：
/// ⓪ 新建账号 → 先选身份角色（所有注册方式统一在此选，账号页随时可改）；
/// ① 若用户名为自动生成 → 自定义唯一 userid；② 若邮箱未验证 → 绑定并验证邮箱（必绑：找回账号/重要通知）。
/// 由 RootView 在 `session.needsAccountSetup` 时全屏呈现；完成后 `session.completeSetup()` 进入 App。
/// 盲人友好：大字、清晰分步、结果主动朗读，并保留「退出登录」出口避免卡死。
struct AccountSetupView: View {
    let session: AuthSession
    private var lang: Language { FeatureSettings().language }

    @State private var userid = ""
    @State private var email = ""
    @State private var code = ""
    @State private var codeSent = false
    @State private var useridDone = false
    @State private var working = false
    @State private var message: String?
    @State private var showLogoutConfirm = false
    @State private var consentChecked = false
    @State private var consentDone = false

    // 注册门控：新账号必须先同意《隐私政策》《使用条款》才能继续（早于选身份等步骤）。
    private var needConsent: Bool { session.accountCreated && !consentDone }
    private var needRole: Bool { session.accountCreated }
    private var needUserid: Bool { session.user?.usernameCustomized == false }
    private var needEmail: Bool { session.user?.emailVerified != true }
    private var onUseridStep: Bool { !needRole && needUserid && !useridDone }

    private enum Step { case consent, role, userid, email }
    private var step: Step {
        if needConsent { return .consent }
        if needRole { return .role }
        if onUseridStep { return .userid }
        return .email
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: BeeSpacing.sm) {
                        Image(systemName: headerIcon)
                            .font(.system(size: 46)).foregroundStyle(Color.beeHoney)
                        Text(headerTitle)
                            .font(.title2.bold()).multilineTextAlignment(.center)
                        Text(stepLabel)
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, BeeSpacing.sm)
                    .accessibilityElement(children: .combine)
                }
                .listRowBackground(Color.clear)

                switch step {
                case .consent: consentSection
                case .role: roleSection
                case .userid: useridSection
                case .email: emailSection
                }

                if let message { Section { Text(message).foregroundStyle(.secondary) } }
            }
            .navigationTitle(AccountStrings.setupTitle(lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AccountStrings.logout(lang), role: .destructive) { showLogoutConfirm = true }
                }
            }
            // 退出登录是破坏性操作（误触即掉线，需重新登录）——先确认（与各账号入口一致）。
            .confirmationDialog(AccountStrings.logout(lang), isPresented: $showLogoutConfirm, titleVisibility: .visible) {
                Button(AccountStrings.logoutConfirmAction(lang), role: .destructive) { session.logout() }
                Button(AccountStrings.cancel(lang), role: .cancel) {}
            } message: {
                Text(AccountStrings.logoutConfirmMessage(lang))
            }
            .onChange(of: message) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
            .task {
                if let e = session.user?.email, !e.isEmpty, email.isEmpty { email = e } // Apple 邮箱预填
                if !needRole && !needUserid && !needEmail { session.completeSetup() } // 防御：无需补全则直接放行
            }
        }
    }

    private var headerIcon: String {
        switch step {
        case .consent: return "lock.shield.fill"
        case .role: return "person.2.circle.fill"
        case .userid: return "person.text.rectangle.fill"
        case .email: return "envelope.badge.shield.half.filled.fill"
        }
    }
    private var headerTitle: String {
        switch step {
        case .consent: return LegalStrings.consentHeader(lang)
        case .role: return AccountStrings.setupRoleHeader(lang)
        case .userid: return AccountStrings.setupUseridHeader(lang)
        case .email: return AccountStrings.setupEmailHeader(lang)
        }
    }
    /// "第 x 步，共 n 步"：按实际需要的步数动态计算（VoiceOver 用户能知道进度）。
    private var stepLabel: String {
        var steps: [Step] = []
        if needConsent || step == .consent { steps.append(.consent) }
        if needRole || step == .role { steps.append(.role) }
        if needUserid { steps.append(.userid) }
        if needEmail { steps.append(.email) }
        let total = max(steps.count, 1)
        let index = (steps.firstIndex(of: step) ?? 0) + 1
        return lang == .zh ? "第 \(index) 步，共 \(total) 步" : "Step \(index) of \(total)"
    }

    // MARK: ⓪ 同意《隐私政策》《使用条款》（新账号注册门控——同意后方可继续）

    @ViewBuilder private var consentSection: some View {
        Section {
            Text(LegalStrings.consentIntro(lang))
                .font(.callout).foregroundStyle(.secondary)
        }
        Section {
            NavigationLink {
                LegalDocumentView(document: .privacy)
            } label: {
                Label(LegalStrings.readDocument(.privacy, lang), systemImage: LegalDocument.privacy.systemImage)
            }
            NavigationLink {
                LegalDocumentView(document: .terms)
            } label: {
                Label(LegalStrings.readDocument(.terms, lang), systemImage: LegalDocument.terms.systemImage)
            }
        } footer: {
            Text(LegalStrings.versionLine(lang))
        }
        Section {
            Toggle(isOn: $consentChecked) {
                Text(LegalStrings.consentCheckbox(lang)).font(.callout)
            }
            Button(LegalStrings.agreeAndContinue(lang)) { Task { await agreeToLegal() } }
                .fontWeight(.semibold)
                .disabled(working || !consentChecked)
        } footer: {
            Text(LegalStrings.consentRequiredHint(lang))
        }
    }

    /// 记录同意：服务端做可证明同意（版本+时间），成功后再放行；并在本机留一份。
    /// 注册时本就在线（账号刚在服务端建好），故要求服务端记录成功是合理且更严密的。
    private func agreeToLegal() async {
        guard consentChecked, let token = session.token else { return }
        working = true; defer { working = false }
        do {
            try await APIClient().recordLegalConsent(token: token, version: LegalText.version)
            ConsentStore().recordLegalAgreement(version: LegalText.version)
            consentDone = true
            message = nil
        } catch {
            message = AccountStrings.networkError(lang)
        }
    }

    // MARK: ① 选择身份（大卡片，两种自助角色）

    @ViewBuilder private var roleSection: some View {
        Section {
            roleCard(title: AccountStrings.roleBlindCardTitle(lang),
                     subtitle: AccountStrings.roleBlindCardSub(lang),
                     icon: "figure.walk.motion", role: "blind")
            roleCard(title: AccountStrings.roleHelperCardTitle(lang),
                     subtitle: AccountStrings.roleHelperCardSub(lang),
                     icon: "person.2.wave.2.fill", role: "helper")
        } footer: {
            Text(AccountStrings.setupRoleFooter(lang))
        }
    }

    private func roleCard(title: String, subtitle: String, icon: String, role: String) -> some View {
        Button {
            Task { await chooseRole(role) }
        } label: {
            HStack(spacing: BeeSpacing.md) {
                Image(systemName: icon)
                    .font(.system(size: 30))
                    .foregroundStyle(Color.beeHoney)
                    .frame(width: 46)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.headline).foregroundStyle(.primary)
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.tertiary)
            }
            .padding(.vertical, BeeSpacing.sm)
        }
        .disabled(working)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title)，\(subtitle)")
        .accessibilityAddTraits(.isButton)
    }

    private func chooseRole(_ role: String) async {
        guard let token = session.token else { return }
        working = true; defer { working = false }
        do {
            try await APIClient().setRole(token: token, role: role)
            await session.refreshMe()
            session.confirmRoleChosen()
            message = nil
            if !needUserid && !needEmail { session.completeSetup() }
        } catch {
            message = AccountStrings.roleSaveFailed(lang)
        }
    }

    // MARK: ① 自定义唯一 userid

    @ViewBuilder private var useridSection: some View {
        Section {
            TextField(AccountStrings.useridPlaceholder(lang), text: $userid)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
        } footer: {
            Text(AccountStrings.setupUseridFooter(lang))
        }
        Section {
            Button(AccountStrings.continueAction(lang)) { Task { await submitUserid() } }
                .disabled(working || userid.trimmingCharacters(in: .whitespaces).count < 3)
            // 用户名可选：自动生成的用户名也能用，允许跳过直接进入 App（见用户反馈：不该被反复卡在设置）。
            Button(AccountStrings.setupSkip(lang)) { skipToEmailOrFinish() }
                .font(.footnote)
        }
    }

    /// 跳过用户名：若还需绑邮箱则进邮箱步，否则直接完成。
    private func skipToEmailOrFinish() {
        useridDone = true
        if !needEmail { session.completeSetup() }
    }

    // MARK: ② 绑定验证邮箱（必绑：Apple 登录的邮箱已自动绑定并验证，不会走到这步）

    @ViewBuilder private var emailSection: some View {
        if !codeSent {
            Section {
                TextField(AccountStrings.emailPlaceholder(lang), text: $email)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
            } footer: {
                Text(AccountStrings.setupEmailFooter(lang))
            }
            Section {
                Button(AccountStrings.sendLoginCode(lang)) { Task { await sendEmailCode() } }
                    .disabled(working || !email.contains("@"))
                // 邮箱可选：可稍后在账号页绑定/验证，允许跳过直接进入 App。
                Button(AccountStrings.setupSkip(lang)) { session.completeSetup() }
                    .font(.footnote)
            }
        } else {
            Section(AccountStrings.enterCodeHeader(lang)) {
                TextField(AccountStrings.sixDigitCode(lang), text: $code)
                    .keyboardType(.numberPad)
                    .accessibilityLabel(AccountStrings.codeA11y(lang))
            }
            Section {
                Button(AccountStrings.setupDone(lang)) { Task { await verifyEmail() } }
                    .disabled(working || code.isEmpty)
                Button(AccountStrings.resend(lang)) { Task { await sendEmailCode() } }.font(.footnote)
            }
        }
    }

    private func submitUserid() async {
        guard let token = session.token else { return }
        working = true; defer { working = false }
        do {
            try await APIClient().setUsername(token: token, username: userid.trimmingCharacters(in: .whitespaces))
            await session.refreshMe()
            useridDone = true
            message = nil
            if !needEmail { session.completeSetup() }
        } catch let APIError.server(code) {
            message = AccountStrings.accountErrorText(code, lang)
        } catch {
            message = AccountStrings.networkError(lang)
        }
    }

    private func sendEmailCode() async {
        guard let token = session.token else { return }
        working = true; defer { working = false }
        do {
            try await APIClient().setEmail(token: token, email: email.trimmingCharacters(in: .whitespaces))
            codeSent = true
            message = AccountStrings.emailCodeSent(lang)
        } catch let APIError.server(code) {
            // 精确透传业务错误（如 email_taken=已绑定到别的账号）——不要笼统说"发送失败/格式不对"。
            message = AccountStrings.accountErrorText(code, lang)
        } catch {
            message = AccountStrings.emailSendFailed(lang)
        }
    }

    private func verifyEmail() async {
        guard let token = session.token else { return }
        working = true; defer { working = false }
        do {
            try await APIClient().verifyEmail(token: token, code: code)
            await session.refreshMe()
            session.completeSetup()
        } catch {
            message = AccountStrings.codeInvalid(lang)
        }
    }
}
