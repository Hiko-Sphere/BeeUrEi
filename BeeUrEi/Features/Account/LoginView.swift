import SwiftUI
import UIKit
import PhotosUI

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
    @State private var detail: AccountInfo?     // /api/me（含邮箱/验证状态/头像）
    @State private var showEmail = false
    @State private var showForgot = false
    @State private var photoItem: PhotosPickerItem?
    @State private var avatarMsg: String?
    @State private var showNickname = false
    @State private var nickInput = ""

    private let roles: [(label: String, value: String)] = [
        ("求助者（视障）", "blind"),
        ("协助者 / 亲友", "helper"), // 合并：协助者与亲友同一套界面与权限
    ]

    var body: some View {
        Form {
            if session.isLoggedIn {
                // 个人资料头部：大头像 + 昵称 + @用户名 · 角色，一眼识别当前账号。
                Section {
                    VStack(spacing: BeeSpacing.sm) {
                        AvatarView(dataURL: detail?.avatar, name: session.user?.displayName ?? "", size: 84)
                            .overlay(Circle().strokeBorder(Color.beeHoney.opacity(0.5), lineWidth: 2))
                        Text(session.user?.displayName ?? "已登录").font(.title3.bold())
                        Text("@\(session.user?.username ?? "—") · \(roleDisplayName(session.user?.role ?? ""))")
                            .font(.footnote).foregroundStyle(.secondary)
                        HStack(spacing: BeeSpacing.md) {
                            PhotosPicker(selection: $photoItem, matching: .images) {
                                Label(detail?.avatar == nil ? "上传头像" : "更换头像", systemImage: "camera.fill")
                                    .font(.subheadline)
                            }
                            .buttonStyle(.bordered)
                            Button {
                                nickInput = session.user?.displayName ?? ""; showNickname = true
                            } label: {
                                Label("改昵称", systemImage: "pencil").font(.subheadline)
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

                Section("账号") {
                    NavigationLink("通话记录") { CallHistoryView() }
                    NavigationLink("黑名单") { BlocklistView() }
                    Button("修改密码") { showChangePassword = true }
                    Button("退出登录", role: .destructive) { session.logout() }
                    Button("删除账号", role: .destructive) { showDeleteConfirm = true }
                }
                Section("邮箱（用于找回密码）") {
                    if let email = detail?.email, !email.isEmpty {
                        HStack {
                            Text(email)
                            Spacer()
                            if detail?.emailVerified == true {
                                Label("已验证", systemImage: "checkmark.seal.fill").foregroundStyle(Color.beeSuccess).font(.caption)
                            } else {
                                Text("未验证").foregroundStyle(Color.beeWarn).font(.caption)
                            }
                        }
                        Button(detail?.emailVerified == true ? "更换邮箱" : "更换 / 验证邮箱") { showEmail = true }
                    } else {
                        Text("尚未绑定邮箱。绑定后可在忘记密码时自助找回。").foregroundStyle(.secondary)
                        Button("绑定邮箱") { showEmail = true }
                    }
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
                    if !isRegister {
                        Button("忘记密码？") { showForgot = true }.font(.footnote)
                    }
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
        // 登录/注册失败主动朗读（见无障碍审计）。
        .onChange(of: session.errorMessage) { _, msg in if let msg, !msg.isEmpty { A11y.announce(msg) } }
        .onChange(of: photoItem) { _, item in if let item { Task { await uploadAvatar(item) } } }
        .alert("修改昵称", isPresented: $showNickname) {
            TextField("昵称", text: $nickInput)
            Button("保存") { Task { await saveNickname() } }
            Button("取消", role: .cancel) {}
        } message: {
            Text("昵称用于通话、来电界面和联系人显示，可重复。用户名是唯一登录标识，不可修改。")
        }
        .task { await loadMe() }
        .sheet(isPresented: $showEmail, onDismiss: { Task { await loadMe() } }) {
            EmailManageView()
        }
        .sheet(isPresented: $showForgot) { ForgotPasswordView(presetUsername: username) }
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
            A11y.announce("昵称已更新为 \(name)")
        } catch { accountMessage = "昵称修改失败，请重试。" }
    }

    private func uploadAvatar(_ item: PhotosPickerItem) async {
        guard let token = KeychainStore.read() else { return }
        avatarMsg = "正在上传头像…"
        guard let data = try? await item.loadTransferable(type: Data.self),
              let img = UIImage(data: data),
              let dataURL = AvatarEncoder.dataURL(from: img) else { avatarMsg = "读取图片失败"; return }
        do {
            try await APIClient().setAvatar(token: token, dataURL: dataURL)
            avatarMsg = "头像已更新"
            A11y.announce("头像已更新")
            await loadMe()
        } catch { avatarMsg = "上传失败：图片太大或网络错误" }
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

/// 绑定 / 更换邮箱并验证（D1）。
struct EmailManageView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var stage: Stage = .enter
    @State private var message: String?
    @State private var working = false

    enum Stage { case enter, verify }

    var body: some View {
        NavigationStack {
            Form {
                if stage == .enter {
                    Section {
                        TextField("you@example.com", text: $email)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    } header: {
                        Text("邮箱")
                    } footer: {
                        Text("绑定后会发一封验证码邮件。验证后即可在忘记密码时自助找回。")
                    }
                    Section {
                        Button("发送验证码") { Task { await setEmail() } }
                            .disabled(working || !email.contains("@"))
                    }
                } else {
                    Section("输入验证码") {
                        TextField("邮箱收到的 6 位验证码", text: $code).keyboardType(.numberPad)
                            .accessibilityLabel("验证码")
                    }
                    Section {
                        Button("确认验证") { Task { await verify() } }
                            .disabled(working || code.isEmpty)
                        Button("重新发送") { Task { await setEmail() } }.font(.footnote)
                    }
                }
                if let message { Section { Text(message).foregroundStyle(.secondary) } }
            }
            .navigationTitle("邮箱验证")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("关闭") { dismiss() } } }
            // 发码/失败/验证结果主动朗读（见无障碍审计）。
            .onChange(of: message) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
        }
    }

    private func setEmail() async {
        guard let token = KeychainStore.read() else { return }
        working = true; defer { working = false }
        do {
            try await APIClient().setEmail(token: token, email: email.trimmingCharacters(in: .whitespaces))
            message = "验证码已发送，请查收邮箱后填写。"
            stage = .verify
        } catch { message = "发送失败，请检查邮箱格式或稍后再试。" }
    }

    private func verify() async {
        guard let token = KeychainStore.read() else { return }
        working = true; defer { working = false }
        do {
            try await APIClient().verifyEmail(token: token, code: code)
            message = "邮箱已验证。" // 经 .onChange(message) 朗读
            dismiss()
        } catch { message = "验证码无效或已过期，请重试。" }
    }
}
