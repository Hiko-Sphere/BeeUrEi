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

    @ObservationIgnored private let api = APIClient()

    init() {
        token = KeychainStore.read()
    }

    var isLoggedIn: Bool { token != nil }

    /// 启动时若有 token 但还没账号信息，拉 /api/me 恢复账号与角色；
    /// access 过期则用 refresh token 自动换新；都失败才登出。
    func restore() async {
        guard let token, user == nil else { return }
        if let me = try? await api.me(token: token) {
            user = me
            return
        }
        // access 失效 → 用 refresh 换新。
        if let rt = KeychainStore.readRefresh(), let result = try? await api.refresh(refreshToken: rt) {
            self.token = result.token
            self.user = result.user
            KeychainStore.save(result.token)
            KeychainStore.saveRefresh(result.refreshToken)
            return
        }
        logout()
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
