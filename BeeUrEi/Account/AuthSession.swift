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
        } catch APIError.network {
            // 纯网络问题（离线/超时/后端暂不可用）：令牌仍有效，保留、稍后重试，绝不登出（见审查 #6）。
            // 标记失败，让 UI 给出重试/退出出口，而非永久卡在「正在登录…」（见审查 #15）。
            restoreFailed = true
            return
        } catch {
            // access 失效等 → 继续尝试 refresh。
        }
        // access 失效 → 用 refresh 换新。
        guard let rt = KeychainStore.readRefresh() else { logout(); return }
        do {
            let result = try await api.refresh(refreshToken: rt)
            self.token = result.token
            self.user = result.user
            KeychainStore.save(result.token)
            KeychainStore.saveRefresh(result.refreshToken)
        } catch APIError.network {
            restoreFailed = true // refresh 也遇网络错误：保留令牌、给出重试出口，下次再试。
        } catch {
            logout() // refresh 被服务端拒绝（失效）才真正登出。
        }
    }

    func login(username: String, password: String) async {
        await run { try await self.api.login(username: username, password: password) }
    }

    func register(username: String, password: String, role: String) async {
        await run { try await self.api.register(username: username, password: password, role: role) }
    }

    func logout() {
        // 撤销服务端 refresh token（尽力而为）。
        if let token, let rt = KeychainStore.readRefresh() {
            Task { await api.revokeRefresh(token: token, refreshToken: rt) }
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
        } catch let APIError.server(message) {
            errorMessage = message
        } catch {
            errorMessage = "网络错误，请检查服务器地址"
        }
    }
}
