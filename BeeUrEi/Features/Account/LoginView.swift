import SwiftUI
import UIKit
import PhotosUI
import AuthenticationServices

/// 账号登录 / 注册（接自托管后端）。VoiceOver 友好。
/// 设计为可被 NavigationLink 推入（不自带 NavigationStack）。
struct LoginView: View {
    // 用 App 共享的同一个 AuthSession（由 RootView .environment 注入），避免本地另起实例
    // 致登出/删号后内存态不同步（见审查 #5）。
    @Environment(AuthSession.self) private var session
    @State private var username = ""
    @State private var password = ""
    @State private var phone = ""        // 注册可选手机号（之后可用手机号+密码登录）
    @State private var isRegister = false
    @State private var role = "blind"
    @State private var serverURL = ServerConfig.baseURLString
    @State private var showChangePassword = false
    @State private var oldPassword = ""
    @State private var newPassword = ""
    @State private var showDeleteConfirm = false
    @State private var accountMessage: String?
    @State private var detail: AccountInfo?     // /api/me（含邮箱/验证状态/头像）
    @State private var showEmail = false
    @State private var showForgot = false
    @State private var photoItem: PhotosPickerItem?
    @State private var avatarMsg: String?
    @State private var showNickname = false
    @State private var nickInput = ""

    /// 账号页文案语言（E5）。
    private var lang: Language { FeatureSettings().language }
    private var roles: [(label: String, value: String)] {
        [(AccountStrings.roleBlind(lang), "blind"),
         (AccountStrings.roleHelper(lang), "helper")] // 合并：协助者与亲友同一套界面与权限
    }

    var body: some View {
        Form {
            if session.isLoggedIn {
                // 个人资料头部：大头像 + 昵称 + @用户名 · 角色，一眼识别当前账号。
                Section {
                    VStack(spacing: BeeSpacing.sm) {
                        AvatarView(dataURL: detail?.avatar, name: session.user?.displayName ?? "", size: 84)
                            .overlay(Circle().strokeBorder(Color.beeHoney.opacity(0.5), lineWidth: 2))
                        Text(session.user?.displayName ?? AccountStrings.loggedIn(lang)).font(.title3.bold())
                        Text("@\(session.user?.username ?? "—") · \(AccountStrings.roleName(session.user?.role ?? "", lang))")
                            .font(.footnote).foregroundStyle(.secondary)
                        HStack(spacing: BeeSpacing.md) {
                            PhotosPicker(selection: $photoItem, matching: .images) {
                                Label(detail?.avatar == nil ? AccountStrings.uploadAvatar(lang)
                                                            : AccountStrings.changeAvatar(lang),
                                      systemImage: "camera.fill")
                                    .font(.subheadline)
                            }
                            .buttonStyle(.bordered)
                            Button {
                                nickInput = session.user?.displayName ?? ""; showNickname = true
                            } label: {
                                Label(AccountStrings.editNickname(lang), systemImage: "pencil").font(.subheadline)
                            }
                            .buttonStyle(.bordered)
                        }
                        if let avatarMsg { Text(avatarMsg).font(.footnote).foregroundStyle(.secondary) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, BeeSpacing.sm)
                    .accessibilityElement(children: .contain)
                }
                .listRowBackground(Color.clear)

                Section(AccountStrings.accountHeader(lang)) {
                    NavigationLink(AccountStrings.callHistory(lang)) { CallHistoryView() }
                    NavigationLink(AccountStrings.blocklist(lang)) { BlocklistView() }
                    Button(AccountStrings.changePassword(lang)) { showChangePassword = true }
                    Button(AccountStrings.logout(lang), role: .destructive) { session.logout() }
                    Button(AccountStrings.deleteAccount(lang), role: .destructive) { showDeleteConfirm = true }
                }
                Section(AccountStrings.emailHeader(lang)) {
                    if let email = detail?.email, !email.isEmpty {
                        HStack {
                            Text(email)
                            Spacer()
                            if detail?.emailVerified == true {
                                Label(AccountStrings.verified(lang), systemImage: "checkmark.seal.fill")
                                    .foregroundStyle(Color.beeSuccess).font(.caption)
                            } else {
                                Text(AccountStrings.unverified(lang)).foregroundStyle(Color.beeWarn).font(.caption)
                            }
                        }
                        Button(detail?.emailVerified == true ? AccountStrings.changeEmail(lang)
                                                             : AccountStrings.changeOrVerifyEmail(lang)) { showEmail = true }
                    } else {
                        Text(AccountStrings.noEmailYet(lang)).foregroundStyle(.secondary)
                        Button(AccountStrings.bindEmail(lang)) { showEmail = true }
                    }
                }
                if let accountMessage {
                    Section { Text(accountMessage).foregroundStyle(.secondary) }
                }
            } else {
                Section(AccountStrings.accountHeader(lang)) {
                    // 登录标识：用户名或手机号皆可（注册时仍是用户名）。
                    TextField(isRegister ? AccountStrings.username(lang) : AccountStrings.usernameOrPhone(lang),
                              text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(AccountStrings.password(lang), text: $password)
                    if isRegister {
                        TextField(AccountStrings.phoneOptional(lang), text: $phone)
                            .keyboardType(.phonePad)
                        Picker(AccountStrings.rolePicker(lang), selection: $role) {
                            ForEach(roles, id: \.value) { Text($0.label).tag($0.value) }
                        }
                    }
                }

                if let err = session.errorMessage {
                    Section { Text(err).foregroundStyle(.red) }
                }

                Section {
                    Button(isRegister ? AccountStrings.registerAndLogin(lang) : AccountStrings.signIn(lang)) { submit() }
                        .disabled(session.isWorking || username.isEmpty || password.isEmpty)
                    Button(isRegister ? AccountStrings.toLogin(lang) : AccountStrings.toRegister(lang)) { isRegister.toggle() }
                    if !isRegister {
                        Button(AccountStrings.forgotPassword(lang)) { showForgot = true }.font(.footnote)
                    }
                }

                // Sign in with Apple：identityToken 交后端验签登录/自动建号。
                // 注意：能力需付费开发者账号在 Xcode 勾选 Sign in with Apple；未配置时授权会失败并给出提示。
                Section {
                    SignInWithAppleButton(.signIn) { request in
                        request.requestedScopes = [.fullName] // 不取邮箱也可；姓名仅首次授权提供
                    } onCompletion: { result in
                        handleApple(result)
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 48)
                    .accessibilityLabel(lang == .zh ? "通过 Apple 登录" : "Sign in with Apple")
                }
            }

            // 服务器地址仅在开发者模式下可自定义；否则一律用默认生产地址。
            if DevSettings().enabled {
                Section(AccountStrings.devServerHeader(lang)) {
                    TextField("如 http://192.168.1.10:8787", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: serverURL) { _, v in ServerConfig.setBaseURL(v) }
                    Text("默认 \(ServerConfig.production)。本地联调可改为运行后端的电脑局域网地址（不是 localhost）。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(AccountStrings.navTitle(lang))
        // 登录/注册失败主动朗读（见无障碍审计）。
        .onChange(of: session.errorMessage) { _, msg in if let msg, !msg.isEmpty { A11y.announce(msg) } }
        .onChange(of: photoItem) { _, item in if let item { Task { await uploadAvatar(item) } } }
        .alert(AccountStrings.nicknameTitle(lang), isPresented: $showNickname) {
            TextField(AccountStrings.nicknamePlaceholder(lang), text: $nickInput)
            Button(AccountStrings.save(lang)) { Task { await saveNickname() } }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: {
            Text(AccountStrings.nicknameMessage(lang))
        }
        .task { await loadMe() }
        .sheet(isPresented: $showEmail, onDismiss: { Task { await loadMe() } }) {
            EmailManageView()
        }
        .sheet(isPresented: $showForgot) { ForgotPasswordView(presetUsername: username) }
        .sheet(isPresented: $showChangePassword) {
            NavigationStack {
                Form {
                    SecureField(AccountStrings.currentPassword(lang), text: $oldPassword)
                    SecureField(AccountStrings.newPasswordPlaceholder(lang), text: $newPassword)
                    Button(AccountStrings.confirmChange(lang)) { changePassword() }
                        .disabled(oldPassword.isEmpty || newPassword.count < 6)
                }
                .navigationTitle(AccountStrings.changePasswordTitle(lang))
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(AccountStrings.cancel(lang)) { showChangePassword = false; oldPassword = ""; newPassword = "" }
                    }
                }
            }
        }
        .confirmationDialog(AccountStrings.deleteConfirmTitle(lang), isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button(AccountStrings.deleteForever(lang), role: .destructive) { deleteAccount() }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: {
            Text(AccountStrings.deleteConfirmMessage(lang))
        }
    }

    private func loadMe() async {
        guard session.isLoggedIn, let token = KeychainStore.read() else { detail = nil; return }
        detail = try? await APIClient().me(token: token)
    }

    private func saveNickname() async {
        let name = nickInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let token = KeychainStore.read() else { return }
        do {
            try await APIClient().setDisplayName(token: token, displayName: name)
            session.setLocalDisplayName(name)
            await loadMe()
            A11y.announce(AccountStrings.nicknameUpdated(name, lang))
        } catch { accountMessage = AccountStrings.nicknameFailed(lang) }
    }

    private func uploadAvatar(_ item: PhotosPickerItem) async {
        guard let token = KeychainStore.read() else { return }
        avatarMsg = AccountStrings.uploadingAvatar(lang)
        guard let data = try? await item.loadTransferable(type: Data.self),
              let img = UIImage(data: data),
              let dataURL = AvatarEncoder.dataURL(from: img) else { avatarMsg = AccountStrings.readImageFailed(lang); return }
        do {
            try await APIClient().setAvatar(token: token, dataURL: dataURL)
            avatarMsg = AccountStrings.avatarUpdated(lang)
            A11y.announce(AccountStrings.avatarUpdated(lang))
            await loadMe()
        } catch { avatarMsg = AccountStrings.avatarUploadFailed(lang) }
    }

    private func changePassword() {
        guard let token = KeychainStore.read() else { accountMessage = AccountStrings.loginFirstShort(lang); return }
        let old = oldPassword, new = newPassword
        Task {
            do {
                try await APIClient().changePassword(token: token, oldPassword: old, newPassword: new)
                accountMessage = AccountStrings.passwordChanged(lang)
                // 登出会立刻切回登录界面，文字反馈来不及看到——给 VoiceOver 用户语音确认（见审查 #6）。
                UIAccessibility.post(notification: .announcement, argument: AccountStrings.passwordChanged(lang))
                showChangePassword = false; oldPassword = ""; newPassword = ""
                session.logout()
            } catch {
                accountMessage = AccountStrings.passwordChangeFailed(lang)
            }
        }
    }

    private func deleteAccount() {
        guard let token = KeychainStore.read() else { return }
        Task {
            try? await APIClient().deleteAccount(token: token)
            accountMessage = AccountStrings.accountDeleted(lang)
            UIAccessibility.post(notification: .announcement, argument: AccountStrings.accountDeleted(lang)) // 见审查 #6
            session.logout()
        }
    }

    private func submit() {
        Task {
            if isRegister {
                let p = phone.trimmingCharacters(in: .whitespaces)
                await session.register(username: username, password: password, role: role,
                                       phone: p.isEmpty ? nil : p)
            } else {
                await session.login(username: username, password: password)
            }
        }
    }

    /// Apple 授权回调：取 identityToken + 首次授权的姓名，交 AuthSession 走后端验签登录。
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

/// 绑定 / 更换邮箱并验证（D1）。
struct EmailManageView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var stage: Stage = .enter
    @State private var message: String?
    @State private var working = false

    enum Stage { case enter, verify }

    /// 邮箱验证文案语言（E5）。
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            Form {
                if stage == .enter {
                    Section {
                        TextField("you@example.com", text: $email)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    } header: {
                        Text(AccountStrings.emailFieldHeader(lang))
                    } footer: {
                        Text(AccountStrings.emailFooter(lang))
                    }
                    Section {
                        Button(AccountStrings.sendCode(lang)) { Task { await setEmail() } }
                            .disabled(working || !email.contains("@"))
                    }
                } else {
                    Section(AccountStrings.enterCodeHeader(lang)) {
                        TextField(AccountStrings.sixDigitCode(lang), text: $code).keyboardType(.numberPad)
                            .accessibilityLabel(AccountStrings.codeA11y(lang))
                    }
                    Section {
                        Button(AccountStrings.confirmVerify(lang)) { Task { await verify() } }
                            .disabled(working || code.isEmpty)
                        Button(AccountStrings.resend(lang)) { Task { await setEmail() } }.font(.footnote)
                    }
                }
                if let message { Section { Text(message).foregroundStyle(.secondary) } }
            }
            .navigationTitle(AccountStrings.emailVerifyTitle(lang))
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(AccountStrings.close(lang)) { dismiss() } } }
            // 发码/失败/验证结果主动朗读（见无障碍审计）。
            .onChange(of: message) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
        }
    }

    private func setEmail() async {
        guard let token = KeychainStore.read() else { return }
        working = true; defer { working = false }
        do {
            try await APIClient().setEmail(token: token, email: email.trimmingCharacters(in: .whitespaces))
            message = AccountStrings.emailCodeSent(lang)
            stage = .verify
        } catch { message = AccountStrings.emailSendFailed(lang) }
    }

    private func verify() async {
        guard let token = KeychainStore.read() else { return }
        working = true; defer { working = false }
        do {
            try await APIClient().verifyEmail(token: token, code: code)
            message = AccountStrings.emailVerified(lang) // 经 .onChange(message) 朗读
            dismiss()
        } catch { message = AccountStrings.codeInvalid(lang) }
    }
}
