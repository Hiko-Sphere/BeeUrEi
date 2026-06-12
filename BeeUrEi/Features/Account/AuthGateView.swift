import SwiftUI
import AuthenticationServices

/// 登录 / 注册门（共享 AuthSession）。登录成功后由 RootView 自动路由到角色确认页。
struct AuthGateView: View {
    let session: AuthSession
    @State private var username = ""     // 登录=用户名/手机号/邮箱；注册=按 regMethod 解释的标识
    @State private var password = ""
    @State private var isRegister = false
    @State private var regMethod: LoginView.RegMethod = .username // 注册标识类型（与账号页同一套）
    @State private var role = "blind"
    @State private var serverURL = ServerConfig.baseURLString
    @State private var showForgot = false

    /// 登录门文案语言（E5）。
    private var lang: Language { FeatureSettings().language }
    private var roles: [(label: String, value: String)] {
        [(AccountStrings.roleBlind(lang), "blind"),
         (AccountStrings.roleHelper(lang), "helper")] // 合并：协助者与亲友同一套界面与权限
    }

    var body: some View {
        NavigationStack {
            Form {
                // 品牌头部：Logo + 一句话定位。
                Section {
                    VStack(spacing: BeeSpacing.sm) {
                        Image("LaunchLogo")
                            .resizable().scaledToFit()
                            .frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .accessibilityHidden(true)
                        Text("BeeUrEi").font(.title2.bold())
                        Text(AccountStrings.tagline(lang))
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, BeeSpacing.sm)
                    .accessibilityElement(children: .combine)
                }
                .listRowBackground(Color.clear)

                Section {
                    Text(AccountStrings.loginExplain(lang))
                        .font(.footnote).foregroundStyle(.secondary)
                }

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
                    if isRegister {
                        Picker(AccountStrings.rolePicker(lang), selection: $role) {
                            ForEach(roles, id: \.value) { Text($0.label).tag($0.value) }
                        }
                    }
                }

                if let err = session.errorMessage {
                    Section { Text(err).foregroundStyle(.red) }
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

                // Sign in with Apple：已有账号即登录，新用户自动建号（注册）。
                Section {
                    SignInWithAppleButton(.continue) { request in
                        request.requestedScopes = [.fullName] // 姓名仅首次授权提供
                    } onCompletion: { result in
                        handleApple(result)
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 48)
                    .accessibilityLabel(AccountStrings.appleContinue(lang))
                }

                if DevSettings().enabled {
                    Section(AccountStrings.devServerHeader(lang)) {
                        TextField("如 http://192.168.1.10:8787", text: $serverURL)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .onChange(of: serverURL) { _, v in ServerConfig.setBaseURL(v) }
                    }
                }
            }
            .navigationTitle("BeeUrEi")
            // 登录/注册失败主动朗读，否则盲人点完按钮听不到失败原因（见无障碍审计）。
            .onChange(of: session.errorMessage) { _, msg in if let msg, !msg.isEmpty { A11y.announce(msg) } }
            .sheet(isPresented: $showForgot) { ForgotPasswordView(presetUsername: username) }
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
            switch regMethod {
            case .username:
                await session.register(username: identifier, password: password, role: role)
            case .phone:
                await session.register(username: nil, password: password, role: role, phone: identifier)
            case .email:
                await session.register(username: nil, password: password, role: role, email: identifier)
            }
        } else {
            await session.login(username: identifier, password: password)
        }
    }

    /// Apple 授权回调：取 identityToken + 首次授权的姓名，交 AuthSession 走后端验签登录/建号。
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
                                             role: role)
            }
        case .failure:
            // 用户取消或未配置 entitlement：给可理解的提示（不弹原始错误码）。
            session.presentAuthError(AccountStrings.appleFailed(lang))
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
