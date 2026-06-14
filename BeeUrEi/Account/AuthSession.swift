import Foundation
import Observation

/// 登录会话（@MainActor，@Observable）。token 存 Keychain，跨启动保留。
@MainActor
@Observable
final class AuthSession {
    private(set) var user: AccountInfo?
    private(set) var token: String?
    /// 全站功能开关（管理员后台可逐项关闭）。fail-open：拉取前/失败时保持全开，绝不误关功能。
    private(set) var features: RemoteFeatureFlags = .allOn
    private(set) var errorMessage: String?
    private(set) var isWorking = false
    private(set) var restoreFailed = false   // 恢复账号时遇网络错误（供 UI 显示重试/退出，见审查 #15）
    /// 刚用「新登录方式」（注册/Apple/邮箱验证码/passkey）完成认证：需在下一步引导自定义 userid + 绑定邮箱。
    /// 普通密码登录与重启恢复不置位（老用户不被反复打扰；换绑仍可在账号页进行）。
    private(set) var requiresSetup = false
    /// 本次认证**新建了账号**（服务端 created=true）：引导首步先选身份角色（所有注册方式统一在此选）。
    private(set) var accountCreated = false
    @ObservationIgnored private var isRestoring = false

    @ObservationIgnored private let api = APIClient()

    init() {
        token = KeychainStore.read()
    }

    var isLoggedIn: Bool { token != nil }

    /// 启动时若有 token 但还没账号信息，拉 /api/me 恢复账号与角色；
    /// access 过期则用 refresh token 自动换新；都失败才登出。
    /// 本地更新昵称（改昵称成功后同步内存态，让"你好，X"等处即时刷新）。
    func setLocalDisplayName(_ name: String) {
        guard var u = user else { return }
        u.displayName = name
        user = u
    }

    func restore() async {
        guard let token, user == nil, !isRestoring else { return }
        isRestoring = true
        restoreFailed = false
        defer { isRestoring = false }
        do {
            user = try await api.me(token: token)
            await refreshAppConfig()
            return
        } catch APIError.unauthorized {
            // 仅 401（access 真失效/被撤销）才继续 refresh（下方）。
        } catch {
            // 网络/解码/其它非鉴权 4xx(.server，如 403/429)：令牌仍可能有效，**保留**、给 UI 重试出口，
            // 绝不据此 refresh 或登出——否则一次解码漂移/限流就误烧 refresh 甚至误删有效令牌（见审查 #2/#4）。
            restoreFailed = true
            return
        }
        // access 失效(401) → 用 refresh 换新。
        guard let rt = KeychainStore.readRefresh() else { logout(); return }
        do {
            let result = try await api.refresh(refreshToken: rt)
            // 若刷新期间会话已被登出（token 置 nil），不要把新令牌写回，避免"死而复生"（见审查 #5）。
            guard token != nil else { return }
            self.token = result.token
            self.user = result.user
            KeychainStore.save(result.token)
            KeychainStore.saveRefresh(result.refreshToken)
        } catch APIError.network {
            restoreFailed = true // refresh 也遇网络错误：保留令牌、给出重试出口，下次再试。
        } catch APIError.unauthorized {
            logout() // refresh token 被服务端拒绝（401 失效）才真正登出。
        } catch {
            restoreFailed = true // refresh 遇其它瞬时错误(5xx 已是 .network；4xx/解码)：保留令牌，不贸然登出。
        }
    }

    func login(username: String, password: String) async {
        await run(isNewMethod: false) { try await self.api.login(username: username, password: password) }
    }

    /// 注册：用户名/手机号/邮箱至少给一个（手机号或邮箱即可当账号，后端自动生成用户名）。
    func register(username: String?, password: String, role: String,
                  phone: String? = nil, email: String? = nil) async {
        await run { try await self.api.register(username: username, password: password, role: role,
                                                phone: phone, email: email) }
    }

    /// Apple 登录：验签建号/登录由后端完成；displayName 仅首次授权由系统提供。
    func loginWithApple(identityToken: String, displayName: String?, role: String?) async {
        await run { try await self.api.loginWithApple(identityToken: identityToken, displayName: displayName, role: role) }
    }

    /// 邮箱验证码登录/注册（无密码）。
    func loginWithEmailCode(email: String, code: String, role: String? = nil) async {
        await run { try await self.api.loginWithEmailCode(email: email, code: code, role: role) }
    }

    /// Passkey 登录（系统生成断言后由后端验签）。
    func loginWithPasskey(flowId: String, response: [String: Any]) async {
        await run { try await self.api.loginWithPasskey(flowId: flowId, response: response) }
    }

    /// 登录入口的本地校验/授权失败提示（如 Apple 授权取消）——errorMessage 为 private(set)，统一经此设置。
    func presentAuthError(_ message: String) { errorMessage = message }

    /// 是否需要（重新）同意隐私/条款：任何已登录用户，其已同意版本与当前文本版本不符即需同意。
    /// 覆盖两类：① 新注册（同意版本为 nil）；② 既有用户在法律文本版本升级后首次进入。
    var needsLegalConsent: Bool {
        guard let u = user else { return false }
        return (u.legalConsentVersion ?? "") != LegalText.version
    }

    /// 补全流程是否需要：① 法律同意过期（对所有已登录用户生效）；或 ② 刚用新方式认证且需选身份/设 userid/绑邮箱。
    var needsAccountSetup: Bool {
        guard let u = user else { return false }
        if needsLegalConsent { return true } // 同意门控优先，且不依赖 requiresSetup（覆盖既有用户重新同意）
        guard requiresSetup else { return false }
        let needUserid = (u.usernameCustomized == false)
        let needEmail = (u.emailVerified != true)
        return accountCreated || needUserid || needEmail
    }

    /// 新账号身份角色已确认（引导首步完成）。
    func confirmRoleChosen() { accountCreated = false }

    /// 记录已同意当前法律版本（服务端记录成功后调用）：就地更新内存态，立即消除 needsLegalConsent，不依赖 refreshMe。
    func markLegalConsented(version: String) { user?.legalConsentVersion = version }

    /// 补全完成（或用户在账号页另行处理）：清除引导标记。
    func completeSetup() { requiresSetup = false; accountCreated = false }

    /// 重新拉取本人信息（改用户名/绑邮箱/绑 Apple/加 passkey 后同步内存态）。
    func refreshMe() async {
        guard let token else { return }
        if let full = try? await api.me(token: token) { user = full }
        await refreshAppConfig()
    }

    /// 拉取全站功能开关（登录/恢复/重进前台时）。fail-open：失败保持现状（默认全开），不影响主流程。
    func refreshAppConfig() async {
        guard let token else { return }
        if let f = try? await api.appConfig(token: token) { features = f }
    }

    func logout() {
        // 撤销服务端 refresh token + 解绑本机 VoIP token（尽力而为）——后者避免来电误投到已登出设备（见复审 #3）。
        if let token {
            let rt = KeychainStore.readRefresh()
            Task {
                await api.unregisterVoipToken(token: token)
                await api.unregisterApnsToken(token: token) // 解绑提醒推送，避免投到已登出设备
                if let rt { await api.revokeRefresh(token: token, refreshToken: rt) }
            }
        }
        token = nil
        user = nil
        requiresSetup = false
        KeychainStore.delete()
        KeychainStore.deleteRefresh()
    }

    private func run(isNewMethod: Bool = true, _ op: () async throws -> AuthResult) async {
        let lang = FeatureSettings().language
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let result = try await op()
            KeychainStore.save(result.token)
            KeychainStore.saveRefresh(result.refreshToken)
            token = result.token
            // 同步语言偏好（尽力而为）：推送文案（来电/好友请求横幅）按后端 users.language 选语言。
            let t = result.token
            Task { await api.setLanguage(token: t, language: lang.rawValue) }
            // 拉 /api/me 取完整本人信息（usernameCustomized/email/appleLinked/hasPasskey），一次性赋值避免闪屏。
            user = (try? await api.me(token: t)) ?? result.user
            await refreshAppConfig() // 同步全站功能开关，进 App 前按开关隐藏/禁用按钮
            // 仅**本次新建账号**才进引导（选身份→设 userid→绑邮箱，可跳过）。
            // 老账号无论用 Apple / Passkey / 邮箱验证码 / 密码登录都直接进 App——
            // 修复"绑过 Apple 后重登被跳去注册""passkey 登录被当成注册新用户"（用户反馈 #2/#4）。
            accountCreated = (result.created == true)
            requiresSetup = accountCreated
        } catch APIError.unauthorized {
            errorMessage = AccountStrings.wrongCredentials(lang)
        } catch let APIError.server(message) {
            errorMessage = AccountStrings.serverErrorText(message, lang) // 后端 code → 用户可读文案
        } catch {
            errorMessage = AccountStrings.networkError(lang)
        }
    }
}
