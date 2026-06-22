import SwiftUI
import AuthenticationServices

/// 登录 / 注册门（行业标准"方法优先"式，参照 Airbnb/Spotify 登录门 + 盲人优先大目标）：
/// 欢迎页只陈列登录方式（Apple / 邮箱验证码 / Passkey / 密码），点谁走谁；
/// 新用户用任意方式认证即自动建号，**身份角色在下一步引导里统一选择**（不在表单里前置）。
/// 老用户 token 未过期时由 RootView 直接恢复会话，根本不会见到本页。
struct AuthGateView: View {
    let session: AuthSession
    @State private var showPassword = false
    @State private var showEmailCode = false
    @State private var passkeyBusy = false
    @State private var serverURL = ServerConfig.baseURLString

    /// 登录门文案语言（E5）。
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: BeeSpacing.lg) {
                    hero
                    methods
                    if let err = session.errorMessage {
                        Text(err)
                            .font(.callout).foregroundStyle(Color.beeDanger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 4)
                    }
                    Text(AccountStrings.methodFootnote(lang))
                        .font(.footnote).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    if DevSettings().enabled { devServer }
                }
                .padding(.horizontal, BeeSpacing.lg)
                .padding(.top, BeeSpacing.xl)
                .padding(.bottom, BeeSpacing.lg)
            }
            .background(Color(.systemGroupedBackground))
            // 登录/注册失败主动朗读，否则盲人点完按钮听不到失败原因（见无障碍审计）。
            .onChange(of: session.errorMessage) { _, msg in if let msg, !msg.isEmpty { A11y.announce(msg) } }
            .sheet(isPresented: $showPassword) { PasswordAuthView(session: session) }
            .sheet(isPresented: $showEmailCode) { EmailCodeLoginView(session: session) }
        }
    }

    // MARK: 品牌头部

    private var hero: some View {
        VStack(spacing: BeeSpacing.sm) {
            Image("LaunchLogo")
                .resizable().scaledToFit()
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
                .accessibilityHidden(true)
            Text(AccountStrings.welcomeBack(lang)).font(.title.bold())
            Text(AccountStrings.tagline(lang))
                .font(.subheadline).foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.bottom, BeeSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    // MARK: 登录方式（方法优先按钮栈，统一 52pt 大目标）

    private var methods: some View {
        VStack(spacing: BeeSpacing.md) {
            // Apple：主推（最快、自动带已验证邮箱）。
            SignInWithAppleButton(.continue) { request in
                request.requestedScopes = [.fullName] // 姓名仅首次授权提供
            } onCompletion: { result in
                handleApple(result)
            }
            .signInWithAppleButtonStyle(.black)
            .frame(height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .accessibilityLabel(AccountStrings.appleContinue(lang))

            // 邮箱验证码（免密码，"魔法码"式）。
            Button {
                showEmailCode = true
            } label: {
                Label(AccountStrings.continueWithEmail(lang), systemImage: "envelope.fill")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .tint(Color.beeHoney)
            .foregroundStyle(Color.beeInk)
            .accessibilityLabel(AccountStrings.continueWithEmail(lang))

            // Passkey（已在账号页添加过 passkey 的老用户：免密免码，面容即登录）。
            Button {
                loginWithPasskey()
            } label: {
                Label(AccountStrings.methodPasskey(lang), systemImage: "person.badge.key.fill")
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.bordered)
            .disabled(passkeyBusy)
            .accessibilityLabel(AccountStrings.methodPasskey(lang))
            .accessibilityHint(AccountStrings.passkeyHint(lang))

            // 分隔线"或"。
            HStack {
                Rectangle().fill(Color.secondary.opacity(0.3)).frame(height: 1)
                Text(AccountStrings.orDivider(lang)).font(.footnote).foregroundStyle(.secondary)
                Rectangle().fill(Color.secondary.opacity(0.3)).frame(height: 1)
            }
            .accessibilityHidden(true)

            // 传统密码方式（登录 + 注册都在 sheet 里）。
            Button {
                showPassword = true
            } label: {
                Text(AccountStrings.continueWithPassword(lang))
                    .font(.body.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel(AccountStrings.continueWithPassword(lang))
        }
    }

    private var devServer: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(AccountStrings.devServerHeader(lang)).font(.caption).foregroundStyle(.secondary)
            TextField("如 http://192.168.1.10:8787", text: $serverURL)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
                .onChange(of: serverURL) { _, v in ServerConfig.setBaseURL(v) }
        }
        .padding(.top, BeeSpacing.md)
    }

    /// Passkey 登录：取 options → 系统断言 → 后端验签发 token。
    private func loginWithPasskey() {
        passkeyBusy = true
        Task {
            defer { passkeyBusy = false }
            do {
                let (flowId, options) = try await APIClient().passkeyLoginOptions()
                let response = try await PasskeyManager().assert(options: options)
                await session.loginWithPasskey(flowId: flowId, response: response)
            } catch PasskeyError.cancelled {
                // 用户取消：静默
            } catch {
                session.presentAuthError(AccountStrings.passkeyFailedMsg(lang))
            }
        }
    }

    /// Apple 授权回调：取 identityToken + 首次授权的姓名，交 AuthSession 走后端验签登录/建号。
    /// 角色不在此传——新账号在下一步引导里统一选择身份。
    private func handleApple(_ result: Result<ASAuthorization, Error>) {
        switch result {
        case .success(let authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let data = credential.identityToken,
                  let token = String(data: data, encoding: .utf8) else {
                session.presentAuthError(AccountStrings.appleFailed(lang))
                return
            }
            let name = [credential.fullName?.familyName, credential.fullName?.givenName]
                .compactMap { $0 }.joined()
            Task {
                await session.loginWithApple(identityToken: token,
                                             displayName: name.isEmpty ? nil : name,
                                             role: nil)
            }
        case .failure:
            // 用户取消或未配置 entitlement：给可理解的提示（不弹原始错误码）。
            session.presentAuthError(AccountStrings.appleFailed(lang))
        }
    }
}

/// 账号密码登录 / 注册（传统方式，sheet 呈现）。
/// 登录：一个标识框（用户名/手机号/邮箱皆可）+ 密码；注册：标识三选一 + 密码。
/// 注册不在此选身份角色——认证成功后的引导步骤统一选择。
struct PasswordAuthView: View {
    let session: AuthSession
    @Environment(\.dismiss) private var dismiss
    @State private var username = ""     // 登录=用户名/手机号/邮箱；注册=按 regMethod 解释的标识
    @State private var password = ""
    @State private var isRegister = false
    @State private var regMethod: LoginView.RegMethod = .username
    @State private var showForgot = false
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            Form {
                Section(isRegister ? AccountStrings.registerHeader(lang) : AccountStrings.loginHeader(lang)) {
                    if isRegister {
                        // 注册标识三选一：用户名 / 手机号 / 邮箱（手机号、邮箱可直接当账号登录）。
                        Picker(AccountStrings.registerMethod(lang), selection: $regMethod) {
                            Text(AccountStrings.username(lang)).tag(LoginView.RegMethod.username)
                            Text(AccountStrings.methodPhone(lang)).tag(LoginView.RegMethod.phone)
                            Text(AccountStrings.methodEmail(lang)).tag(LoginView.RegMethod.email)
                        }
                        .pickerStyle(.segmented)
                        .accessibilityLabel(AccountStrings.registerMethod(lang))
                    }
                    TextField(identifierPlaceholder, text: $username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .keyboardType(identifierKeyboard)
                    SecureField(AccountStrings.password(lang), text: $password)
                }

                if let err = session.errorMessage {
                    Section { Text(err).foregroundStyle(Color.beeDanger) }
                }

                Section {
                    Button(isRegister ? AccountStrings.registerAndLogin(lang) : AccountStrings.signIn(lang)) {
                        Task { await submit() }
                    }
                    .disabled(session.isWorking || username.isEmpty || password.isEmpty)
                    Button(isRegister ? AccountStrings.toLogin(lang) : AccountStrings.toRegister(lang)) { isRegister.toggle() }
                    if !isRegister {
                        Button(AccountStrings.forgotPassword(lang)) { showForgot = true }
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle(AccountStrings.continueWithPassword(lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AccountStrings.close(lang)) { dismiss() }
                }
            }
            .onChange(of: session.errorMessage) { _, msg in if let msg, !msg.isEmpty { A11y.announce(msg) } }
            .onChange(of: session.isLoggedIn) { _, loggedIn in if loggedIn { dismiss() } } // 登录成功自动关闭
            .sheet(isPresented: $showForgot) { ForgotPasswordView(presetUsername: username) }
            // 开了两步验证的账号：第一因子通过后弹验证码输入（嵌套 sheet）。
            .sheet(isPresented: Binding(get: { session.twoFactor != nil }, set: { if !$0 { session.cancelTwoFactor() } })) {
                TwoFactorChallengeView(session: session)
            }
        }
    }

    /// 注册标识输入框的占位与键盘（登录时统一"用户名/手机号/邮箱"）。
    private var identifierPlaceholder: String {
        guard isRegister else { return AccountStrings.loginIdentifier(lang) }
        switch regMethod {
        case .username: return AccountStrings.username(lang)
        case .phone: return AccountStrings.phoneField(lang)
        case .email: return AccountStrings.emailField(lang)
        }
    }
    private var identifierKeyboard: UIKeyboardType {
        guard isRegister else { return .default }
        switch regMethod {
        case .username: return .default
        case .phone: return .phonePad
        case .email: return .emailAddress
        }
    }

    private func submit() async {
        let identifier = username.trimmingCharacters(in: .whitespaces)
        if isRegister {
            // 角色先按默认建号，认证后的引导步骤统一选择身份（created=true 触发）。
            switch regMethod {
            case .username:
                await session.register(username: identifier, password: password, role: "blind")
            case .phone:
                await session.register(username: nil, password: password, role: "blind", phone: identifier)
            case .email:
                await session.register(username: nil, password: password, role: "blind", email: identifier)
            }
        } else {
            await session.login(username: identifier, password: password)
        }
    }
}

/// 找回密码（D1）：输入用户名 → 收验证码（邮箱）→ 凭码设新密码。
struct ForgotPasswordView: View {
    let presetUsername: String
    @Environment(\.dismiss) private var dismiss
    @State private var username: String
    @State private var code = ""
    @State private var newPassword = ""
    @State private var stage: Stage = .request
    @State private var message: String?
    @State private var working = false

    enum Stage { case request, reset }

    init(presetUsername: String) {
        self.presetUsername = presetUsername
        _username = State(initialValue: presetUsername)
    }

    /// 找回密码文案语言（E5）。
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(AccountStrings.username(lang), text: $username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                } footer: {
                    Text(AccountStrings.forgotFooter(lang))
                }

                if stage == .reset {
                    Section(AccountStrings.resetHeader(lang)) {
                        TextField(AccountStrings.codePlaceholder(lang), text: $code)
                            .keyboardType(.numberPad)
                            .accessibilityLabel(AccountStrings.codeA11y(lang))
                        SecureField(AccountStrings.newPasswordPlaceholder(lang), text: $newPassword)
                    }
                }

                if let message {
                    Section { Text(message).foregroundStyle(.secondary) }
                }

                Section {
                    if stage == .request {
                        Button(AccountStrings.sendCode(lang)) { Task { await sendCode() } }
                            .disabled(working || username.isEmpty)
                    } else {
                        Button(AccountStrings.confirmReset(lang)) { Task { await reset() } }
                            .disabled(working || code.isEmpty || newPassword.count < 6)
                        Button(AccountStrings.resendCode(lang)) { Task { await sendCode() } }.font(.footnote)
                    }
                }
            }
            .navigationTitle(AccountStrings.forgotTitle(lang))
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(AccountStrings.cancel(lang)) { dismiss() } } }
            // 发码/失败/重置结果主动朗读（见无障碍审计）。
            .onChange(of: message) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
        }
    }

    private func sendCode() async {
        working = true; defer { working = false }
        let sent = AccountStrings.codeSent(lang)
        do {
            try await APIClient().forgotPassword(username: username.trimmingCharacters(in: .whitespaces))
            message = sent // 不做枚举：无论账号/邮箱是否存在都提示已发送
            stage = .reset
        } catch APIError.network {
            // 真正的网络/5xx 失败：明确反馈并停留在当前步，避免断网仍误导"已发送"（见审查 #16）。
            message = AccountStrings.sendFailed(lang)
        } catch {
            message = sent // 其它（含 4xx）仍走统一文案，保持防枚举
            stage = .reset
        }
    }

    private func reset() async {
        working = true; defer { working = false }
        do {
            try await APIClient().resetPassword(username: username.trimmingCharacters(in: .whitespaces), code: code, newPassword: newPassword)
            message = AccountStrings.resetDone(lang) // 经 .onChange(message) 朗读
            dismiss()
        } catch {
            message = AccountStrings.codeInvalid(lang)
        }
    }
}

/// 邮箱验证码登录 / 注册（无密码）：输入邮箱 → 收码 → 验证即登录或自动建号。
/// 身份角色不在此选——新账号在认证后的引导步骤统一选择。
struct EmailCodeLoginView: View {
    let session: AuthSession
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var stage: Stage = .enter
    @State private var working = false
    @State private var message: String?
    private enum Stage { case enter, verify }
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            Form {
                if stage == .enter {
                    Section {
                        TextField(AccountStrings.emailPlaceholder(lang), text: $email)
                            .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    } header: {
                        Text(AccountStrings.emailCodeHeader(lang))
                    } footer: {
                        Text(AccountStrings.emailCodeFooter(lang))
                    }
                    Section {
                        Button(AccountStrings.sendLoginCode(lang)) { Task { await sendCode() } }
                            .disabled(working || !email.contains("@"))
                    }
                } else {
                    Section(AccountStrings.enterCodeHeader(lang)) {
                        TextField(AccountStrings.sixDigitCode(lang), text: $code)
                            .keyboardType(.numberPad)
                            .accessibilityLabel(AccountStrings.codeA11y(lang))
                    }
                    Section {
                        Button(AccountStrings.continueAction(lang)) { Task { await verify() } }
                            .disabled(working || code.isEmpty)
                        Button(AccountStrings.resend(lang)) { Task { await sendCode() } }.font(.footnote)
                    }
                }
                if let message { Section { Text(message).foregroundStyle(.secondary) } }
            }
            .navigationTitle(AccountStrings.methodEmailCode(lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(AccountStrings.close(lang)) { dismiss() } } }
            .onChange(of: message) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
            .onChange(of: session.isLoggedIn) { _, loggedIn in if loggedIn { dismiss() } } // 登录成功关闭
            // 开了两步验证的账号：邮箱码（第一因子）通过后弹验证码输入。
            .sheet(isPresented: Binding(get: { session.twoFactor != nil }, set: { if !$0 { session.cancelTwoFactor() } })) {
                TwoFactorChallengeView(session: session)
            }
        }
    }

    private func sendCode() async {
        working = true; defer { working = false }
        do {
            try await APIClient().requestEmailLoginCode(email: email.trimmingCharacters(in: .whitespaces))
            message = AccountStrings.emailCodeLoginSent(lang)
            stage = .verify
        } catch APIError.network {
            message = AccountStrings.sendFailed(lang)
        } catch let APIError.server(code) where code == "mail_unavailable" {
            message = AccountStrings.serverErrorText(code, lang) // 邮件服务故障：如实告知，不假装已发送
        } catch {
            message = AccountStrings.emailCodeLoginSent(lang) // 防枚举：其它情况也提示已发送
            stage = .verify
        }
    }

    private func verify() async {
        working = true; defer { working = false }
        await session.loginWithEmailCode(email: email.trimmingCharacters(in: .whitespaces), code: code, role: nil)
        if !session.isLoggedIn, let err = session.errorMessage { message = err } // 失败在表单内提示
    }
}
