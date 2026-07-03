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
    /// 全站公告 / 维护模式横幅（管理员后台推送）。
    private(set) var announcement: RemoteAnnouncement = .init()
    private(set) var maintenance: RemoteMaintenance = .init()
    /// 是否要求实名认证（管理员开启）。开启时未通过 KYC 的可门控角色被门禁屏拦住，仅可提交认证 + 紧急。
    private(set) var requireVerification = false
    private(set) var errorMessage: String?
    private(set) var isWorking = false
    /// 登录遇两步验证挑战：第一因子已过、需补交 TOTP / 一次性恢复码。UI 据此弹出验证码输入，经 submitTwoFactor(code) 重试。
    private(set) var twoFactor: TwoFactorChallenge?
    private(set) var restoreFailed = false   // 恢复账号时遇网络错误（供 UI 显示重试/退出，见审查 #15）
    /// 刚用「新登录方式」（注册/Apple/邮箱验证码/passkey）完成认证：需在下一步引导自定义 userid + 绑定邮箱。
    /// 普通密码登录与重启恢复不置位（老用户不被反复打扰；换绑仍可在账号页进行）。
    private(set) var requiresSetup = false
    /// 本次认证**新建了账号**（服务端 created=true）：引导首步先选身份角色（所有注册方式统一在此选）。
    private(set) var accountCreated = false
    @ObservationIgnored private var isRestoring = false
    @ObservationIgnored private var isRenewing = false

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

    /// 主动续期：access token 仅 1h，但运行时各功能调用并不会在撞 401 后自动续期（仅启动 restore() 会续）。
    /// 长时间前台使用（盲人开着导航/避障可能数小时）期间 access 一旦过期，下一次「求助/呼叫亲友/收发消息」
    /// 就会失败而无法自动恢复（须杀进程重开）。故由 App 在回前台与定时轮询时调用本方法，临近过期就先换新。
    /// **纯增益**：只会成功换新或空转——任何失败（网络/refresh 失效）都保留现状、绝不据此登出，
    /// 避免后台定时器把可能正在导航的盲人突然踢下线；真过期仍由用户下次操作的 401 走既有路径处理。
    /// 单飞（isRenewing 防并发）；换新逻辑与 restore() 同口径（含刷新期间已登出则不复活，见审查 #5）。
    func renewIfNeeded() async {
        guard let current = token, user != nil, !isRenewing else { return }
        // 仅在 access 临近过期（剩 < 15min）时续；还早就不打扰。解不出 exp 则保守地续一次。
        if let exp = jwtExpiry(current), exp.timeIntervalSinceNow > 15 * 60 { return }
        guard let rt = KeychainStore.readRefresh() else { return }
        isRenewing = true
        defer { isRenewing = false }
        do {
            let result = try await api.refresh(refreshToken: rt)
            guard token != nil else { return } // 刷新期间已登出 → 不复活
            token = result.token
            user = result.user
            KeychainStore.save(result.token)
            KeychainStore.saveRefresh(result.refreshToken)
        } catch {
            // 纯增益：失败一律保留现状、不登出（见上）。
        }
    }

    /// 读 JWT 的 exp（unix 秒）。解析失败返回 nil（调用方按"该续了"保守处理）。仅用于本地判断是否临近过期，不做验签。
    private func jwtExpiry(_ jwt: String) -> Date? {
        let parts = jwt.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var s = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        guard let data = Data(base64Encoded: s),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let exp = obj["exp"] as? Double else { return nil }
        return Date(timeIntervalSince1970: exp)
    }

    func login(username: String, password: String, totpCode: String? = nil) async {
        await run(isNewMethod: false,
                  twoFactorRetry: { [weak self] code in await self?.login(username: username, password: password, totpCode: code) }) {
            try await self.api.login(username: username, password: password, totpCode: totpCode)
        }
    }

    /// 提交两步验证码（TOTP 或一次性恢复码）继续登录。
    func submitTwoFactor(code: String) async {
        let c = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !c.isEmpty, let tf = twoFactor else { return }
        await tf.retry(c)
    }
    /// 放弃两步验证（返回登录入口）。
    func cancelTwoFactor() { twoFactor = nil }

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

    /// 邮箱验证码登录/注册（无密码）。开了 2FA 的账号会再要求 TOTP/恢复码（经 submitTwoFactor 补交）。
    func loginWithEmailCode(email: String, code: String, role: String? = nil, totpCode: String? = nil) async {
        await run(twoFactorRetry: { [weak self] tc in await self?.loginWithEmailCode(email: email, code: code, role: role, totpCode: tc) }) {
            try await self.api.loginWithEmailCode(email: email, code: code, role: role, totpCode: totpCode)
        }
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

    /// 记录已确认协助守则（服务端留痕后调用）：就地更新内存态，首次接单闸门立即放行，不依赖 refreshMe。
    func markGuidelineAcked() { user?.helperGuidelineAckAt = Date().timeIntervalSince1970 * 1000 }

    /// 补全完成（或用户在账号页另行处理）：清除引导标记。
    func completeSetup() { requiresSetup = false; accountCreated = false }

    /// 重新拉取本人信息（改用户名/绑邮箱/绑 Apple/加 passkey 后同步内存态）。
    func refreshMe() async {
        guard let token else { return }
        if let full = try? await api.me(token: token) { user = full }
        await refreshAppConfig()
    }

    /// 拉取全站配置（登录/恢复/重进前台时）。fail-open：失败保持现状（默认全开/无横幅），不影响主流程。
    func refreshAppConfig() async {
        guard let token else { return }
        if let cfg = try? await api.appConfig(token: token) {
            features = cfg.features
            announcement = cfg.announcement
            maintenance = cfg.maintenance
            requireVerification = cfg.requireVerification
        }
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
        LiveLocationManager.shared.reset() // 停止位置共享/轮询，清联系人，防跨账号泄漏
        EmergencyDialCache.clear() // 清无网兜底拨号缓存——防换账号后拨给前任用户的紧急联系人
        token = nil
        user = nil
        requiresSetup = false
        KeychainStore.delete()
        KeychainStore.deleteRefresh()
    }

    private func run(isNewMethod: Bool = true,
                     twoFactorRetry: ((String) async -> Void)? = nil,
                     _ op: () async throws -> AuthResult) async {
        let lang = FeatureSettings().language
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let result = try await op()
            twoFactor = nil // 成功：清掉两步验证挑战
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
        } catch let APIError.server(message) where (message == "two_factor_required" || message == "invalid_2fa") && twoFactorRetry != nil {
            // 第一因子已过、需两步验证：弹验证码输入（不当作错误）；invalid_2fa=上次补码错误。
            twoFactor = TwoFactorChallenge(retry: twoFactorRetry!, invalidCode: message == "invalid_2fa")
        } catch APIError.unauthorized {
            errorMessage = AccountStrings.wrongCredentials(lang)
        } catch let APIError.server(message) {
            errorMessage = AccountStrings.serverErrorText(message, lang) // 后端 code → 用户可读文案
        } catch {
            errorMessage = AccountStrings.networkError(lang)
        }
    }
}

/// 两步验证挑战：登录第一因子已过、需补交 TOTP / 一次性恢复码。`retry` 用所给验证码再次尝试登录。
@MainActor
struct TwoFactorChallenge {
    let retry: (String) async -> Void
    var invalidCode: Bool   // 上次补码错误（UI 提示"验证码不对，请重试"）
}
