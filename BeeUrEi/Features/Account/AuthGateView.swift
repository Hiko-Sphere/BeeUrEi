import SwiftUI

/// 登录 / 注册门（共享 AuthSession）。登录成功后由 RootView 自动路由到角色确认页。
struct AuthGateView: View {
    let session: AuthSession
    @State private var username = ""
    @State private var password = ""
    @State private var isRegister = false
    @State private var role = "blind"
    @State private var serverURL = ServerConfig.baseURLString
    @State private var showForgot = false

    private let roles: [(label: String, value: String)] = [
        ("求助者（视障）", "blind"),
        ("协助者 / 亲友", "helper"), // 合并：协助者与亲友同一套界面与权限
    ]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("登录后选择你的角色再进入。求助者也需登录以使用呼叫帮助（实时避障可离线使用）。")
                        .font(.footnote).foregroundStyle(.secondary)
                }

                Section(isRegister ? "注册" : "登录") {
                    TextField("用户名", text: $username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("密码", text: $password)
                    if isRegister {
                        Picker("身份", selection: $role) {
                            ForEach(roles, id: \.value) { Text($0.label).tag($0.value) }
                        }
                    }
                }

                if let err = session.errorMessage {
                    Section { Text(err).foregroundStyle(.red) }
                }

                Section {
                    Button(isRegister ? "注册并登录" : "登录") { Task { await submit() } }
                        .disabled(session.isWorking || username.isEmpty || password.isEmpty)
                    Button(isRegister ? "已有账号？去登录" : "没有账号？去注册") { isRegister.toggle() }
                    if !isRegister {
                        Button("忘记密码？") { showForgot = true }
                            .font(.footnote)
                    }
                }

                if DevSettings().enabled {
                    Section("服务器地址（开发者）") {
                        TextField("如 http://192.168.1.10:8787", text: $serverURL)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .onChange(of: serverURL) { _, v in ServerConfig.setBaseURL(v) }
                    }
                }
            }
            .navigationTitle("BeeUrEi")
            .sheet(isPresented: $showForgot) { ForgotPasswordView(presetUsername: username) }
        }
    }

    private func submit() async {
        if isRegister {
            await session.register(username: username, password: password, role: role)
        } else {
            await session.login(username: username, password: password)
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

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("用户名", text: $username)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                } footer: {
                    Text("我们会把验证码发到你账号绑定的邮箱。若未绑定邮箱，请联系管理员重置。")
                }

                if stage == .reset {
                    Section("重置密码") {
                        TextField("邮箱收到的验证码", text: $code)
                            .keyboardType(.numberPad)
                        SecureField("新密码（至少 6 位）", text: $newPassword)
                    }
                }

                if let message {
                    Section { Text(message).foregroundStyle(.secondary) }
                }

                Section {
                    if stage == .request {
                        Button("发送验证码") { Task { await sendCode() } }
                            .disabled(working || username.isEmpty)
                    } else {
                        Button("确认重置密码") { Task { await reset() } }
                            .disabled(working || code.isEmpty || newPassword.count < 6)
                        Button("重新发送验证码") { Task { await sendCode() } }.font(.footnote)
                    }
                }
            }
            .navigationTitle("找回密码")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } } }
        }
    }

    private func sendCode() async {
        working = true; defer { working = false }
        try? await APIClient().forgotPassword(username: username.trimmingCharacters(in: .whitespaces))
        // 不做枚举：无论账号/邮箱是否存在都提示已发送。
        message = "如果该账号绑定了邮箱，验证码已发送。请查收后填写下方验证码。"
        stage = .reset
    }

    private func reset() async {
        working = true; defer { working = false }
        do {
            try await APIClient().resetPassword(username: username.trimmingCharacters(in: .whitespaces), code: code, newPassword: newPassword)
            message = "密码已重置，请用新密码登录。"
            A11y.announce("密码已重置，请用新密码登录")
            dismiss()
        } catch {
            message = "验证码无效或已过期，请重试。"
        }
    }
}
