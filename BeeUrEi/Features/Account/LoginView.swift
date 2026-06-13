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
    @State private var username = ""     // 登录=用户名/手机号/邮箱；注册=按 regMethod 解释的标识
    @State private var password = ""
    @State private var phone = ""        // 用户名注册时的可选手机号（之后可用手机号+密码登录）
    @State private var isRegister = false
    @State private var regMethod: RegMethod = .username // 注册标识类型（用户名/手机号/邮箱三选一）

    enum RegMethod: CaseIterable { case username, phone, email }
    @State private var role = "blind"
    @State private var serverURL = ServerConfig.baseURLString
    @State private var showChangePassword = false
    @State private var oldPassword = ""
    @State private var newPassword = ""
    @State private var showLogoutConfirm = false
    @State private var showDeleteConfirm = false
    @State private var accountMessage: String?
    @State private var detail: AccountInfo?     // /api/me（含邮箱/验证状态/头像）
    @State private var showEmail = false
    @State private var showForgot = false
    @State private var photoItem: PhotosPickerItem?
    @State private var avatarMsg: String?
    @State private var showNickname = false
    @State private var nickInput = ""
    @State private var showUsername = false
    @State private var usernameInput = ""
    @State private var showPhone = false
    @State private var phoneInput = ""
    @State private var passkeyList: [PasskeyInfo] = []
    @State private var securityMsg: String?
    @State private var passkeyBusy = false
    @State private var detailLoadFailed = false           // /api/me 拉取失败：别把已绑定账号显示成空
    @State private var passkeyToRemove: PasskeyInfo?       // 移除 Passkey 前确认（不可逆）
    @State private var showRoleChange = false              // 更改身份确认
    @State private var pendingRole: String?                // 待切换的目标身份

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
                    Button(AccountStrings.logout(lang), role: .destructive) { showLogoutConfirm = true }
                    Button(AccountStrings.deleteAccount(lang), role: .destructive) { showDeleteConfirm = true }
                }
                // 身份/角色（仅自助角色可改；admin/developer 由后台管理）。更改后 RootView 会按新角色自动切换界面。
                if let r = session.user?.role, r == "blind" || r == "helper" || r == "family" {
                    Section {
                        LabeledContent(AccountStrings.identityHeader(lang), value: AccountStrings.roleName(r, lang))
                        Button(AccountStrings.changeRole(lang)) { showRoleChange = true }
                    } footer: {
                        Text(AccountStrings.identityFooter(lang))
                    }
                }
                // 账号明细（邮箱/手机/Apple/Passkey）拉取中或失败时，先别显示"未绑定"误导态——给加载/重试。
                if detail == nil {
                    Section {
                        if detailLoadFailed {
                            VStack(alignment: .leading, spacing: BeeSpacing.sm) {
                                Text(AccountStrings.loadFailedRetry(lang)).foregroundStyle(.secondary)
                                Button(AccountStrings.retry(lang)) { Task { await loadMe() } }
                            }
                        } else {
                            HStack { Spacer(); ProgressView(); Spacer() }
                        }
                    }
                }
                if detail != nil { accountDetailSections }
                if let securityMsg {
                    Section { Text(securityMsg).foregroundStyle(.secondary) }
                }
                if let accountMessage {
                    Section { Text(accountMessage).foregroundStyle(.secondary) }
                }
            } else {
                Section(AccountStrings.accountHeader(lang)) {
                    if isRegister {
                        // 注册标识三选一：用户名 / 手机号 / 邮箱（手机号、邮箱可直接当账号登录）。
                        Picker(AccountStrings.registerMethod(lang), selection: $regMethod) {
                            Text(AccountStrings.username(lang)).tag(RegMethod.username)
                            Text(AccountStrings.methodPhone(lang)).tag(RegMethod.phone)
                            Text(AccountStrings.methodEmail(lang)).tag(RegMethod.email)
                        }
                        .pickerStyle(.segmented)
                        .accessibilityLabel(AccountStrings.registerMethod(lang))
                    }
                    TextField(identifierPlaceholder, text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(identifierKeyboard)
                    SecureField(AccountStrings.password(lang), text: $password)
                    if isRegister {
                        if regMethod == .username {
                            TextField(AccountStrings.phoneOptional(lang), text: $phone)
                                .keyboardType(.phonePad)
                        }
                        Picker(AccountStrings.rolePicker(lang), selection: $role) {
                            ForEach(roles, id: \.value) { Text($0.label).tag($0.value) }
                        }
                    }
                }

                if let err = session.errorMessage {
                    Section { Text(err).foregroundStyle(Color.beeDanger) }
                }

                Section {
                    Button(isRegister ? AccountStrings.registerAndLogin(lang) : AccountStrings.signIn(lang)) { submit() }
                        .disabled(session.isWorking
                                  || username.trimmingCharacters(in: .whitespaces).isEmpty
                                  || password.isEmpty)
                    Button(isRegister ? AccountStrings.toLogin(lang) : AccountStrings.toRegister(lang)) { isRegister.toggle() }
                    if !isRegister {
                        Button(AccountStrings.forgotPassword(lang)) { showForgot = true }.font(.footnote)
                    }
                }

                // Sign in with Apple：identityToken 交后端验签——已有账号即登录，新用户自动建号（注册）。
                // 注意：能力需付费开发者账号在 Xcode 勾选 Sign in with Apple；未配置时授权会失败并给出提示。
                Section {
                    SignInWithAppleButton(.continue) { request in
                        request.requestedScopes = [.fullName] // 不取邮箱也可；姓名仅首次授权提供
                    } onCompletion: { result in
                        handleApple(result)
                    }
                    .signInWithAppleButtonStyle(.black)
                    .frame(height: 48)
                    .accessibilityLabel(AccountStrings.appleContinue(lang))
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
        .onChange(of: securityMsg) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
        // 账号操作结果（改昵称失败、改密、删号等）也要朗读给盲人（见 P1 无障碍审计）。
        .onChange(of: accountMessage) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
        .alert(AccountStrings.nicknameTitle(lang), isPresented: $showNickname) {
            TextField(AccountStrings.nicknamePlaceholder(lang), text: $nickInput)
            Button(AccountStrings.save(lang)) { Task { await saveNickname() } }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: {
            Text(AccountStrings.nicknameMessage(lang))
        }
        .alert(AccountStrings.changeUsernameTitle(lang), isPresented: $showUsername) {
            TextField(AccountStrings.username(lang), text: $usernameInput)
                .textInputAutocapitalization(.never)
            Button(AccountStrings.save(lang)) { Task { await saveUsername() } }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: {
            Text(AccountStrings.setupUseridFooter(lang))
        }
        .sheet(isPresented: $showPhone) {
            PhoneBindSheet(title: AccountStrings.phoneSectionHeader(lang), initialPhone: phoneInput) { full in
                Task { await savePhone(full) }
            }
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
        // 退出登录是破坏性操作（误触即掉线）——与删号一样先确认（见审计 P1）。
        .confirmationDialog(AccountStrings.logout(lang), isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button(AccountStrings.logoutConfirmAction(lang), role: .destructive) { session.logout() }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: {
            Text(AccountStrings.logoutConfirmMessage(lang))
        }
        .confirmationDialog(AccountStrings.deleteConfirmTitle(lang), isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button(AccountStrings.deleteForever(lang), role: .destructive) { deleteAccount() }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        } message: {
            Text(AccountStrings.deleteConfirmMessage(lang))
        }
        // 更改身份（视障 ↔ 协助者/亲友）：选定后再确认（界面会随之切换）。
        .confirmationDialog(AccountStrings.changeRole(lang), isPresented: $showRoleChange, titleVisibility: .visible) {
            Button(AccountStrings.roleBlindCardTitle(lang)) { confirmRole("blind") }
            Button(AccountStrings.roleHelperCardTitle(lang)) { confirmRole("helper") }
            Button(AccountStrings.cancel(lang), role: .cancel) {}
        }
        .confirmationDialog(pendingRole.map { AccountStrings.roleChangeConfirm(AccountStrings.roleName($0, lang), lang) } ?? "",
                            isPresented: Binding(get: { pendingRole != nil }, set: { if !$0 { pendingRole = nil } }),
                            titleVisibility: .visible) {
            Button(AccountStrings.confirmChange(lang)) { if let r = pendingRole { pendingRole = nil; changeRole(r) } }
            Button(AccountStrings.cancel(lang), role: .cancel) { pendingRole = nil }
        }
        // 移除 Passkey 不可逆（移除后该设备需重新添加）——先确认（见审计 P2）。
        .confirmationDialog(AccountStrings.removePasskeyConfirmTitle(lang),
                            isPresented: Binding(get: { passkeyToRemove != nil },
                                                 set: { if !$0 { passkeyToRemove = nil } }),
                            titleVisibility: .visible) {
            Button(AccountStrings.removePasskey(lang), role: .destructive) {
                if let pk = passkeyToRemove { removePasskey(pk.id) }
                passkeyToRemove = nil
            }
            Button(AccountStrings.cancel(lang), role: .cancel) { passkeyToRemove = nil }
        } message: {
            Text(AccountStrings.removePasskeyConfirmMessage(lang))
        }
    }

    /// 账号明细（邮箱 / 登录与安全 / Passkey）三段——抽出以避免 Form 主体表达式过大致类型推断超时。
    @ViewBuilder private var accountDetailSections: some View {
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
        // 登录与安全：用户名 / 手机号 / Apple ID 换绑（现存账号也可重新绑定）。
        Section(AccountStrings.accountSecurityHeader(lang)) {
            HStack {
                Text(AccountStrings.usernameSectionHeader(lang))
                Spacer()
                Text("@\(session.user?.username ?? "—")").foregroundStyle(.secondary)
            }
            Button(AccountStrings.changeUsername(lang)) {
                usernameInput = session.user?.username ?? ""; showUsername = true
            }
            if let phone = detail?.phone, !phone.isEmpty {
                HStack { Text(AccountStrings.phoneSectionHeader(lang)); Spacer(); Text(phone).foregroundStyle(.secondary) }
                Button(AccountStrings.changePhone(lang)) { phoneInput = phone; showPhone = true }
            } else {
                Button(AccountStrings.bindPhone(lang)) { phoneInput = ""; showPhone = true }
            }
            if detail?.appleLinked == true {
                HStack {
                    Label(AccountStrings.appleSectionHeader(lang), systemImage: "apple.logo")
                    Spacer()
                    Text(AccountStrings.appleLinkedLabel(lang)).foregroundStyle(Color.beeSuccess).font(.caption)
                }
                Button(AccountStrings.unlinkAppleAction(lang), role: .destructive) { unlinkApple() }
            } else {
                SignInWithAppleButton(.continue) { req in
                    req.requestedScopes = [.fullName]
                } onCompletion: { handleAppleLink($0) }
                .signInWithAppleButtonStyle(.black)
                .frame(height: 44)
                .accessibilityLabel(AccountStrings.linkAppleAction(lang))
            }
        }
        Section(AccountStrings.passkeySectionHeader(lang)) {
            if passkeyList.isEmpty {
                Text(AccountStrings.noPasskeysYet(lang)).font(.footnote).foregroundStyle(.secondary)
            } else {
                ForEach(passkeyList) { pk in
                    HStack {
                        Label(pk.deviceName ?? AccountStrings.passkeyDeviceFallback(lang), systemImage: "key.fill")
                        Spacer()
                        Button(AccountStrings.removePasskey(lang), role: .destructive) { passkeyToRemove = pk }
                            .font(.caption).buttonStyle(.bordered)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            Button(AccountStrings.addPasskey(lang)) { addPasskey() }
                .disabled(passkeyBusy)
        }
    }

    private func loadMe() async {
        guard session.isLoggedIn, let token = KeychainStore.read() else { detail = nil; passkeyList = []; return }
        // 不能在瞬时失败时清空 detail——否则已绑邮箱/手机/Apple/Passkey 的账号会被显示成"全未绑定"，
        // 用户去重绑会撞 *_taken 错误（见 P1 审计）。失败保留旧值，仅标记 detailLoadFailed。
        do {
            detail = try await APIClient().me(token: token)
            passkeyList = (try? await APIClient().passkeys(token: token)) ?? []
            detailLoadFailed = false
        } catch {
            detailLoadFailed = true
            if detail == nil { A11y.announce(AccountStrings.loadFailedRetry(lang)) }
        }
    }

    /// 修改用户名（唯一登录标识；现存账号自定义 userid）。
    private func saveUsername() async {
        let name = usernameInput.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty, let token = KeychainStore.read() else { return }
        do {
            try await APIClient().setUsername(token: token, username: name)
            await session.refreshMe()
            await loadMe()
            securityMsg = AccountStrings.usernameUpdated(lang)
        } catch let APIError.server(code) {
            securityMsg = AccountStrings.accountErrorText(code, lang)
        } catch { securityMsg = AccountStrings.networkError(lang) }
    }

    /// 绑定/换绑手机号（含区号，来自 PhoneBindSheet 的完整 E.164 号码）。
    private func savePhone(_ raw: String) async {
        let p = raw.trimmingCharacters(in: .whitespaces)
        guard !p.isEmpty, let token = KeychainStore.read() else { return }
        do {
            try await APIClient().setPhone(token: token, phone: p)
            await loadMe()
            securityMsg = AccountStrings.phoneUpdated(lang)
        } catch let APIError.server(code) {
            securityMsg = AccountStrings.accountErrorText(code, lang)
        } catch { securityMsg = AccountStrings.networkError(lang) }
    }

    /// 绑定/换绑 Apple ID：取 identityToken 交后端验签绑定。
    private func handleAppleLink(_ result: Result<ASAuthorization, Error>) {
        guard case .success(let authorization) = result,
              let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let data = credential.identityToken,
              let identityToken = String(data: data, encoding: .utf8),
              let token = KeychainStore.read() else {
            securityMsg = AccountStrings.appleFailed(lang); return
        }
        Task {
            do {
                try await APIClient().linkApple(token: token, identityToken: identityToken)
                await loadMe()
                securityMsg = AccountStrings.appleLinkedDone(lang)
            } catch let APIError.server(code) {
                securityMsg = AccountStrings.accountErrorText(code, lang)
            } catch { securityMsg = AccountStrings.networkError(lang) }
        }
    }

    /// 解绑 Apple ID（后端校验须保留其它登录方式）。
    private func unlinkApple() {
        guard let token = KeychainStore.read() else { return }
        Task {
            do {
                try await APIClient().unlinkApple(token: token)
                await loadMe()
                securityMsg = AccountStrings.appleUnlinkedDone(lang)
            } catch let APIError.server(code) {
                securityMsg = AccountStrings.accountErrorText(code, lang)
            } catch { securityMsg = AccountStrings.networkError(lang) }
        }
    }

    /// 添加 Passkey：取 options → 系统创建凭据 → 提交验签存储。
    private func addPasskey() {
        guard let token = KeychainStore.read() else { return }
        passkeyBusy = true
        Task {
            defer { passkeyBusy = false }
            do {
                let options = try await APIClient().passkeyRegisterOptions(token: token)
                let response = try await PasskeyManager().register(options: options)
                try await APIClient().passkeyRegisterVerify(token: token, response: response, deviceName: UIDevice.current.name)
                await loadMe()
                securityMsg = AccountStrings.passkeyAdded(lang)
            } catch PasskeyError.cancelled {
                // 用户取消：静默
            } catch {
                securityMsg = AccountStrings.passkeyFailedMsg(lang)
            }
        }
    }

    /// 移除一把 Passkey（失败要反馈，不能静默）。
    private func removePasskey(_ id: String) {
        guard let token = KeychainStore.read() else { return }
        Task {
            do {
                try await APIClient().deletePasskey(token: token, id: id)
                await loadMe()
                securityMsg = AccountStrings.passkeyRemoved(lang)
            } catch let APIError.server(code) {
                securityMsg = AccountStrings.accountErrorText(code, lang)
            } catch {
                securityMsg = AccountStrings.passkeyRemoveFailed(lang)
            }
        }
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

    /// 选定目标身份后弹二次确认（与当前相同则忽略）。
    private func confirmRole(_ role: String) {
        guard session.user?.role != role else { return }
        pendingRole = role
    }

    /// 更改账号身份：写后端 + 刷新本人信息（RootView 监听 user.role 变化自动切到对应界面）。
    private func changeRole(_ role: String) {
        guard let token = KeychainStore.read() else { return }
        Task {
            do {
                try await APIClient().setRole(token: token, role: role)
                await session.refreshMe()
                accountMessage = AccountStrings.roleChangedTo(AccountStrings.roleName(role, lang), lang)
            } catch {
                accountMessage = AccountStrings.roleChangeFailed(lang)
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

    private func submit() {
        let identifier = username.trimmingCharacters(in: .whitespaces)
        Task {
            if isRegister {
                switch regMethod {
                case .username:
                    let p = phone.trimmingCharacters(in: .whitespaces)
                    await session.register(username: identifier, password: password, role: role,
                                           phone: p.isEmpty ? nil : p)
                case .phone:
                    await session.register(username: nil, password: password, role: role, phone: identifier)
                case .email:
                    await session.register(username: nil, password: password, role: role, email: identifier)
                }
            } else {
                await session.login(username: identifier, password: password)
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
        } catch let APIError.server(code) {
            // 精确透传业务错误（如 email_taken=已绑定到别的账号）——不要笼统说"发送失败/格式不对"。
            message = AccountStrings.accountErrorText(code, lang)
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
