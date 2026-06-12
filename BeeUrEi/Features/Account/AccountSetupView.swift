import SwiftUI

/// 新登录方式（注册 / Apple / 邮箱验证码 / passkey）后的账号补全引导：
/// ① 若用户名为自动生成 → 自定义唯一 userid；② 若邮箱未验证 → 绑定并验证邮箱（重要通知/找回账号）。
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

    private var needUserid: Bool { session.user?.usernameCustomized == false }
    private var needEmail: Bool { session.user?.emailVerified != true }
    private var onUseridStep: Bool { needUserid && !useridDone }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: BeeSpacing.sm) {
                        Image(systemName: onUseridStep ? "person.text.rectangle.fill" : "envelope.badge.shield.half.filled.fill")
                            .font(.system(size: 46)).foregroundStyle(Color.beeHoney)
                        Text(onUseridStep ? AccountStrings.setupUseridHeader(lang) : AccountStrings.setupEmailHeader(lang))
                            .font(.title2.bold()).multilineTextAlignment(.center)
                        if needUserid {
                            Text(onUseridStep ? AccountStrings.setupStepUserid(lang) : AccountStrings.setupStepEmail(lang))
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, BeeSpacing.sm)
                    .accessibilityElement(children: .combine)
                }
                .listRowBackground(Color.clear)

                if onUseridStep { useridSection } else { emailSection }

                if let message { Section { Text(message).foregroundStyle(.secondary) } }
            }
            .navigationTitle(AccountStrings.setupTitle(lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AccountStrings.logout(lang), role: .destructive) { session.logout() }
                }
            }
            .onChange(of: message) { _, m in if let m, !m.isEmpty { A11y.announce(m) } }
            .task {
                if let e = session.user?.email, !e.isEmpty, email.isEmpty { email = e } // Apple 邮箱预填
                if !needUserid && !needEmail { session.completeSetup() } // 防御：无需补全则直接放行
            }
        }
    }

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
        }
    }

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
                Button(AccountStrings.setupSkip(lang)) { session.completeSetup() }.font(.footnote)
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
