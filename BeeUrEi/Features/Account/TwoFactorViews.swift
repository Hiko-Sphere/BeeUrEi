import SwiftUI
import UIKit

/// 登录时的两步验证挑战：输入 TOTP 验证码或一次性恢复码继续登录。
/// 由 PasswordAuthView / EmailCodeLoginView 在 `session.twoFactor != nil` 时以 sheet 呈现。
struct TwoFactorChallengeView: View {
    let session: AuthSession
    @State private var code = ""
    private var lang: Language { FeatureSettings().language }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(TwoFactorStrings.challengePrompt(lang)).font(.subheadline).foregroundStyle(.secondary)
                } header: { Text(TwoFactorStrings.challengeTitle(lang)) }
                Section {
                    TextField(TwoFactorStrings.codeField(lang), text: $code)
                        .keyboardType(.asciiCapable)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .accessibilityLabel(TwoFactorStrings.codeField(lang))
                    if session.twoFactor?.invalidCode == true {
                        Text(TwoFactorStrings.invalidCode(lang)).foregroundStyle(Color.beeDanger)
                    }
                }
                Section {
                    Button(TwoFactorStrings.verify(lang)) { Task { await session.submitTwoFactor(code: code) } }
                        .disabled(session.isWorking || code.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .navigationTitle(TwoFactorStrings.title(lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(TwoFactorStrings.cancel(lang)) { session.cancelTwoFactor() }
                }
            }
            .onAppear { A11y.announce(TwoFactorStrings.challengePrompt(lang)) }
            .onChange(of: session.twoFactor?.invalidCode) { _, v in if v == true { A11y.announce(TwoFactorStrings.invalidCode(lang)) } }
        }
    }
}

/// 两步验证管理（账号与安全里推入）：未开启→引导绑定；已开启→剩余恢复码 / 重新生成 / 关闭。
/// 盲人友好：密钥以可选中文本 + 「复制密钥」+「添加到验证器」呈现（**不依赖扫码**）；恢复码可整组复制。
struct TwoFactorSetupView: View {
    let token: String
    var onChanged: () -> Void = {}

    @State private var status: TwoFAStatus?
    @State private var loading = true
    @State private var busy = false
    @State private var err: String?
    @State private var toast: String?

    // 绑定流程
    @State private var setup: TwoFASetup?
    @State private var enableCode = ""
    @State private var recoveryCodes: [String]?

    // 关闭 / 重生成：需再次验证本人
    @State private var codeAction: CodeAction?
    @State private var promptCode = ""

    enum CodeAction: Identifiable { case disable, regenerate; var id: Int { hashValue } }
    private var lang: Language { FeatureSettings().language }
    private let api = APIClient()

    var body: some View {
        Form {
            if loading {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            } else if let codes = recoveryCodes {
                recoveryCodesSection(codes)
            } else if let s = setup {
                setupSection(s)
            } else if status?.enabled == true {
                enabledSections
            } else {
                offSection
            }
            if let err { Section { Text(err).foregroundStyle(Color.beeDanger) } }
        }
        .navigationTitle(TwoFactorStrings.title(lang))
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadStatus() }
        .alert(item: $codeAction) { action in codePromptAlert(action) }
        .overlay(alignment: .bottom) { if let toast { ToastView(text: toast) } }
        .onChange(of: toast) { _, t in if let t { A11y.announce(t) } }
    }

    // MARK: 未开启

    private var offSection: some View {
        Section {
            Button(TwoFactorStrings.setupTitle(lang)) { Task { await beginSetup() } }
                .disabled(busy)
        } header: {
            Text(TwoFactorStrings.title(lang))
        } footer: {
            Text(TwoFactorStrings.intro(lang))
        }
    }

    // MARK: 绑定中（显示密钥 + 输码）

    private func setupSection(_ s: TwoFASetup) -> some View {
        Group {
            Section {
                Text(s.secret).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                    .accessibilityLabel(spelledOut(s.secret))
                Button(TwoFactorStrings.copyKey(lang)) { UIPasteboard.general.string = s.secret; toast = TwoFactorStrings.keyCopied(lang) }
                if let url = URL(string: s.otpauthUri) {
                    Button(TwoFactorStrings.addToApp(lang)) { UIApplication.shared.open(url) }
                }
            } header: { Text(TwoFactorStrings.secretLabel(lang)) } footer: { Text(TwoFactorStrings.step1(lang)) }
            Section {
                TextField(TwoFactorStrings.codeField(lang), text: $enableCode)
                    .keyboardType(.numberPad).accessibilityLabel(TwoFactorStrings.codeField(lang))
                Button(TwoFactorStrings.enable(lang)) { Task { await confirmEnable() } }
                    .disabled(busy || enableCode.trimmingCharacters(in: .whitespaces).count < 6)
            } header: { Text(TwoFactorStrings.setupTitle(lang)) } footer: { Text(TwoFactorStrings.step2(lang)) }
        }
    }

    // MARK: 已开启

    private var enabledSections: some View {
        Group {
            Section {
                LabeledContent(TwoFactorStrings.title(lang), value: TwoFactorStrings.statusOn(lang))
                if let n = status?.recoveryCodesRemaining {
                    Text(TwoFactorStrings.remaining(n, lang)).font(.footnote).foregroundStyle(.secondary)
                }
            } footer: { Text(TwoFactorStrings.intro(lang)) }
            Section {
                Button(TwoFactorStrings.regenerate(lang)) { promptCode = ""; codeAction = .regenerate }.disabled(busy)
            } footer: { Text(TwoFactorStrings.regenerateNote(lang)) }
            Section {
                Button(TwoFactorStrings.disable(lang), role: .destructive) { promptCode = ""; codeAction = .disable }.disabled(busy)
            }
        }
    }

    // MARK: 恢复码展示

    private func recoveryCodesSection(_ codes: [String]) -> some View {
        Group {
            Section {
                ForEach(codes, id: \.self) { c in
                    Text(c).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                        .accessibilityLabel(spelledOut(c))
                }
            } header: { Text(TwoFactorStrings.recoveryTitle(lang)) } footer: { Text(TwoFactorStrings.recoveryIntro(lang)) }
            Section {
                Button(TwoFactorStrings.copyAll(lang)) { UIPasteboard.general.string = codes.joined(separator: "\n"); toast = TwoFactorStrings.codesCopied(lang) }
                Button(TwoFactorStrings.done(lang)) { recoveryCodes = nil; Task { await loadStatus() } }
            }
        }
    }

    // MARK: 关闭 / 重生成 的验证码弹窗

    private func codePromptAlert(_ action: CodeAction) -> Alert {
        Alert(
            title: Text(action == .disable ? TwoFactorStrings.disable(lang) : TwoFactorStrings.regenerate(lang)),
            message: Text(TwoFactorStrings.disablePrompt(lang)),
            primaryButton: .destructive(Text(TwoFactorStrings.verify(lang))) { Task { await runCodeAction(action) } },
            secondaryButton: .cancel(Text(TwoFactorStrings.cancel(lang)))
        )
    }

    // MARK: 逻辑

    private func loadStatus() async {
        loading = true; err = nil
        status = try? await api.twoFactorStatus(token: token)
        loading = false
    }
    private func beginSetup() async {
        busy = true; err = nil; defer { busy = false }
        do { setup = try await api.twoFactorSetup(token: token); enableCode = "" }
        catch { err = AccountStrings.networkError(lang) }
    }
    private func confirmEnable() async {
        busy = true; err = nil; defer { busy = false }
        do {
            let codes = try await api.twoFactorEnable(token: token, code: enableCode.trimmingCharacters(in: .whitespaces))
            setup = nil; recoveryCodes = codes; toast = TwoFactorStrings.enabledToast(lang)
            onChanged()
        } catch let APIError.server(msg) where msg == "invalid_code" { err = TwoFactorStrings.invalidCode(lang) }
        catch { err = AccountStrings.networkError(lang) }
    }
    private func runCodeAction(_ action: CodeAction) async {
        let code = promptCode.trimmingCharacters(in: .whitespaces)
        guard !code.isEmpty else { return }
        busy = true; err = nil; defer { busy = false }
        do {
            switch action {
            case .disable:
                try await api.twoFactorDisable(token: token, code: code)
                toast = TwoFactorStrings.disabledToast(lang); onChanged(); await loadStatus()
            case .regenerate:
                recoveryCodes = try await api.twoFactorRegenerateRecovery(token: token, code: code)
            }
        } catch let APIError.server(msg) where msg == "invalid_code" { err = TwoFactorStrings.invalidCode(lang) }
        catch { err = AccountStrings.networkError(lang) }
    }

    /// 盲人无障碍：把密钥/恢复码逐字符朗读（避免 VoiceOver 把字母串读成奇怪单词）。
    private func spelledOut(_ s: String) -> String {
        s.map { String($0) }.joined(separator: " ")
    }
}

/// 轻量提示条（复制成功等）。
private struct ToastView: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.subheadline.weight(.semibold)).foregroundStyle(.white)
            .padding(.horizontal, 16).padding(.vertical, 10)
            .background(Color.beeInk.opacity(0.92), in: Capsule())
            .padding(.bottom, 24)
            .transition(.opacity)
    }
}
