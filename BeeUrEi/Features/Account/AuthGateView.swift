import SwiftUI

/// 登录 / 注册门（共享 AuthSession）。登录成功后由 RootView 自动路由到角色确认页。
struct AuthGateView: View {
    let session: AuthSession
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
