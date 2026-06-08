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

    /// 启动时若有 token 但还没账号信息，拉 /api/me 恢复账号与角色；token 失效则登出。
    func restore() async {
        guard let token, user == nil else { return }
        do { user = try await api.me(token: token) }
        catch { logout() }
    }

    func login(username: String, password: String) async {
        await run { try await self.api.login(username: username, password: password) }
    }

    func register(username: String, password: String, role: String) async {
        await run { try await self.api.register(username: username, password: password, role: role) }
    }

    func logout() {
        token = nil
        user = nil
        KeychainStore.delete()
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
        } catch let APIError.server(message) {
            errorMessage = message
        } catch {
            errorMessage = "网络错误，请检查服务器地址"
        }
    }
}
