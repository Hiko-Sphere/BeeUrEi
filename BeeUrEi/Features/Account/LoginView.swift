import SwiftUI

/// 账号登录 / 注册（接自托管后端）。VoiceOver 友好。
/// 设计为可被 NavigationLink 推入（不自带 NavigationStack）。
struct LoginView: View {
    @State private var session = AuthSession()
    @State private var username = ""
    @State private var password = ""
    @State private var isRegister = false
    @State private var role = "blind"
    @State private var serverURL = ServerConfig.baseURLString

    private let roles: [(label: String, value: String)] = [
        ("求助者（视障）", "blind"),
        ("协助者", "helper"),
        ("亲友", "family"),
    ]

    var body: some View {
        Form {
            if session.isLoggedIn {
                Section("当前账号") {
                    Text(session.user?.displayName ?? "已登录")
                    Text("角色：\(session.user?.role ?? "")").foregroundStyle(.secondary)
                    Button("退出登录", role: .destructive) { session.logout() }
                }
            } else {
                Section("账号") {
                    TextField("用户名", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
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
                    Button(isRegister ? "注册并登录" : "登录") { submit() }
                        .disabled(session.isWorking || username.isEmpty || password.isEmpty)
                    Button(isRegister ? "已有账号？去登录" : "没有账号？去注册") { isRegister.toggle() }
                }
            }

            Section("服务器地址") {
                TextField("如 http://192.168.1.10:8787", text: $serverURL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onChange(of: serverURL) { _, v in ServerConfig.setBaseURL(v) }
                Text("真机测试请填运行后端的电脑局域网地址（不是 localhost）。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("账号")
    }

    private func submit() {
        Task {
            if isRegister {
                await session.register(username: username, password: password, role: role)
            } else {
                await session.login(username: username, password: password)
            }
        }
    }
}
