import Foundation
import Observation

/// 登录会话（@MainActor，@Observable）。token 存 Keychain，跨启动保留。
@MainActor
@Observable
final class AuthSession {
    private(set) var user: AccountInfo?
    private(set) var token: String?
    private(set) var errorMessage: String?
    private(set) var isWorking = false
    private(set) var restoreFailed = false   // 恢复账号时遇网络错误（供 UI 显示重试/退出，见审查 #15）
    @ObservationIgnored private var isRestoring = false

    @ObservationIgnored private let api = APIClient()

    init() {
        token = KeychainStore.read()
    }

    var isLoggedIn: Bool { token != nil }

    /// 启动时若有 token 但还没账号信息，拉 /api/me 恢复账号与角色；
    /// access 过期则用 refresh token 自动换新；都失败才登出。
    func restore() async {
        guard let token, user == nil, !isRestoring else { return }
        isRestoring = true
        restoreFailed = false
        defer { isRestoring = false }
        do {
            user = try await api.me(token: token)
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
        await run { try await self.api.login(username: username, password: password) }
    }

    func register(username: String, password: String, role: String) async {
        await run { try await self.api.register(username: username, password: password, role: role) }
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
        KeychainStore.delete()
        KeychainStore.deleteRefresh()
    }

    private func run(_ op: () async throws -> AuthResult) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let result = try await op()
            token = result.token
            user = result.user
            KeychainStore.save(result.token)
            KeychainStore.saveRefresh(result.refreshToken)
        } catch APIError.unauthorized {
            errorMessage = "用户名或密码错误"
        } catch let APIError.server(message) {
            errorMessage = message
        } catch {
            errorMessage = "网络错误，请检查服务器地址"
        }
    }
}
