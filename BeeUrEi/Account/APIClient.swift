import Foundation

/// 后端服务器地址（可在登录页修改；真机测试要填 Mac 的局域网 IP，而非 localhost）。
enum ServerConfig {
    private static let key = "server.baseURL"
    static let fallback = "http://localhost:8787"

    static var baseURLString: String {
        UserDefaults.standard.string(forKey: key) ?? fallback
    }
    static var baseURL: URL {
        URL(string: baseURLString) ?? URL(string: fallback)!
    }
    static func setBaseURL(_ s: String) {
        UserDefaults.standard.set(s, forKey: key)
    }
}

struct AccountInfo: Codable, Sendable, Equatable {
    let id: String
    let username: String
    let displayName: String
    let role: String
    let status: String
}

struct AuthResult: Codable, Sendable {
    let token: String
    let user: AccountInfo
}

enum APIError: Error {
    case server(String)
    case decoding
    case network
}

/// 极简 REST 客户端（接自托管后端 /api/auth）。
struct APIClient {
    private var baseURL: URL { ServerConfig.baseURL }

    func register(username: String, password: String, role: String?) async throws -> AuthResult {
        var body: [String: Any] = ["username": username, "password": password]
        if let role { body["role"] = role }
        return try await postAuth("/api/auth/register", body: body)
    }

    func login(username: String, password: String) async throws -> AuthResult {
        try await postAuth("/api/auth/login", body: ["username": username, "password": password])
    }

    private func postAuth(_ path: String, body: [String: Any]) async throws -> AuthResult {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, resp): (Data, URLResponse)
        do {
            (data, resp) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.network
        }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode >= 400 {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let msg = (obj?["error"] as? String) ?? "HTTP \(http.statusCode)"
            throw APIError.server(msg)
        }
        do {
            return try JSONDecoder().decode(AuthResult.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}
