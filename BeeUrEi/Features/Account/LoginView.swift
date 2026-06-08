import SwiftUI
import UIKit

/// 账号登录 / 注册（接自托管后端）。VoiceOver 友好。
/// 设计为可被 NavigationLink 推入（不自带 NavigationStack）。
struct LoginView: View {
    // 用 App 共享的同一个 AuthSession（由 RootView .environment 注入），避免本地另起实例
    // 致登出/删号后内存态不同步（见审查 #5）。
    @Environment(AuthSession.self) private var session
    @State private var username = ""
    @State private var password = ""
    @State private var isRegister = false
    @State private var role = "blind"
    @State private var serverURL = ServerConfig.baseURLString
    @State private var showChangePassword = false
    @State private var oldPassword = ""
    @State private var newPassword = ""
    @State private var showDeleteConfirm = false
    @State private var accountMessage: String?

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
                    Button("修改密码") { showChangePassword = true }
                    Button("退出登录", role: .destructive) { session.logout() }
                    Button("删除账号", role: .destructive) { showDeleteConfirm = true }
                }
                if let accountMessage {
                    Section { Text(accountMessage).foregroundStyle(.secondary) }
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

            // 服务器地址仅在开发者模式下可自定义；否则一律用默认生产地址。
            if DevSettings().enabled {
                Section("服务器地址（开发者）") {
                    TextField("如 http://192.168.1.10:8787", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: serverURL) { _, v in ServerConfig.setBaseURL(v) }
                    Text("默认 \(ServerConfig.production)。本地联调可改为运行后端的电脑局域网地址（不是 localhost）。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle("账号")
        .sheet(isPresented: $showChangePassword) {
            NavigationStack {
                Form {
                    SecureField("当前密码", text: $oldPassword)
                    SecureField("新密码（至少 6 位）", text: $newPassword)
                    Button("确认修改") { changePassword() }
                        .disabled(oldPassword.isEmpty || newPassword.count < 6)
                }
                .navigationTitle("修改密码")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { showChangePassword = false; oldPassword = ""; newPassword = "" }
                    }
                }
            }
        }
        .confirmationDialog("删除账号", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("永久删除我的账号", role: .destructive) { deleteAccount() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("将永久删除你的账号、亲友绑定与登录信息，且不可恢复。")
        }
    }

    private func changePassword() {
        guard let token = KeychainStore.read() else { accountMessage = "请先登录"; return }
        let old = oldPassword, new = newPassword
        Task {
            do {
                try await APIClient().changePassword(token: token, oldPassword: old, newPassword: new)
                accountMessage = "密码已修改，请用新密码重新登录。"
                // 登出会立刻切回登录界面，文字反馈来不及看到——给 VoiceOver 用户语音确认（见审查 #6）。
                UIAccessibility.post(notification: .announcement, argument: "密码已修改，请用新密码重新登录。")
                showChangePassword = false; oldPassword = ""; newPassword = ""
                session.logout()
            } catch {
                accountMessage = "修改失败：当前密码不正确或网络错误。"
            }
        }
    }

    private func deleteAccount() {
        guard let token = KeychainStore.read() else { return }
        Task {
            try? await APIClient().deleteAccount(token: token)
            accountMessage = "账号已删除。"
            UIAccessibility.post(notification: .announcement, argument: "账号已删除。") // 见审查 #6
            session.logout()
        }
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
