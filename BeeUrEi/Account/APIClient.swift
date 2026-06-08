import Foundation

/// 后端服务器地址。默认固定为生产域名；**仅开发者模式**可自定义（用于本地联调）。
enum ServerConfig {
    private static let key = "server.baseURL"
    static let production = "https://beeurei-api.hikosphere.com"

    static var baseURLString: String {
        // 非开发者模式：一律用生产地址，忽略任何自定义覆盖。
        guard DevSettings().enabled,
              let custom = UserDefaults.standard.string(forKey: key),
              !custom.isEmpty else {
            return production
        }
        return custom
    }
    static var baseURL: URL {
        URL(string: baseURLString) ?? URL(string: production)!
    }
    static func setBaseURL(_ s: String) {
        UserDefaults.standard.set(s, forKey: key)
    }
}

struct AccountInfo: Codable, Sendable, Equatable, Identifiable {
    let id: String
    let username: String
    let displayName: String
    let role: String
    let status: String
}

struct AuthResult: Codable, Sendable {
    let token: String
    let refreshToken: String
    let user: AccountInfo
}

struct FamilyLinkInfo: Codable, Sendable, Identifiable {
    let id: String
    let memberId: String
    let memberName: String
    let relation: String
    let isEmergency: Bool
    let phone: String?
}

struct IncomingLinkInfo: Codable, Sendable, Identifiable {
    let id: String
    let ownerId: String
    let ownerName: String
    let relation: String
    let isEmergency: Bool
}

struct EmergencyTarget: Codable, Sendable, Identifiable {
    var id: String { memberId }
    let memberId: String
    let memberName: String
    let relation: String?
    let isEmergency: Bool
}

struct RecordingConfig: Codable, Sendable {
    let enabled: Bool
    let retentionDays: Int
    let requireConsent: Bool
}

/// WebRTC ICE 服务器（STUN/TURN）。
struct IceServerInfo: Codable, Sendable {
    let urls: [String]
    let username: String?
    let credential: String?
}

struct ReportInfo: Codable, Sendable, Identifiable {
    let id: String
    let reporterId: String
    let targetUserId: String
    let reason: String
    let status: String
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

    func refresh(refreshToken: String) async throws -> AuthResult {
        try await postAuth("/api/auth/refresh", body: ["refreshToken": refreshToken])
    }

    /// 撤销 refresh token（登出，尽力而为）。
    func revokeRefresh(token: String, refreshToken: String) async {
        _ = try? await authedSend("POST", "/api/auth/logout", token: token, body: ["refreshToken": refreshToken])
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

    // MARK: 已登录请求

    private func authedGet(_ path: String, token: String) async throws -> Data {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch { throw APIError.network }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode >= 400 {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError.server((obj?["error"] as? String) ?? "HTTP \(http.statusCode)")
        }
        return data
    }

    func me(token: String) async throws -> AccountInfo {
        struct R: Codable { let user: AccountInfo }
        let data = try await authedGet("/api/me", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.user
    }

    func adminUsers(token: String) async throws -> [AccountInfo] {
        struct R: Codable { let users: [AccountInfo] }
        let data = try await authedGet("/api/admin/users", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.users
    }

    func adminReports(token: String) async throws -> [ReportInfo] {
        struct R: Codable { let reports: [ReportInfo] }
        let data = try await authedGet("/api/admin/reports", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.reports
    }

    func setUserStatus(token: String, userId: String, status: String) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/admin/users/\(userId)/status"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["status": status])
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode < 400 else { throw APIError.server("操作失败") }
    }

    func devStats(token: String) async throws -> [String: Any] {
        let data = try await authedGet("/api/dev/stats", token: token)
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    func resolveReport(token: String, id: String) async throws {
        _ = try await authedSend("POST", "/api/admin/reports/\(id)/resolve", token: token)
    }

    @discardableResult
    private func authedSend(_ method: String, _ path: String, token: String, body: [String: Any]? = nil) async throws -> Data {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch { throw APIError.network }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode >= 400 {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError.server((obj?["error"] as? String) ?? "HTTP \(http.statusCode)")
        }
        return data
    }

    // MARK: 亲友 / 紧急

    func familyLinks(token: String) async throws -> [FamilyLinkInfo] {
        struct R: Codable { let links: [FamilyLinkInfo] }
        let data = try await authedGet("/api/family/links", token: token)
        return (try? JSONDecoder().decode(R.self, from: data))?.links ?? []
    }

    func incomingLinks(token: String) async throws -> [IncomingLinkInfo] {
        struct R: Codable { let links: [IncomingLinkInfo] }
        let data = try await authedGet("/api/family/incoming", token: token)
        return (try? JSONDecoder().decode(R.self, from: data))?.links ?? []
    }

    func addFamilyLink(token: String, username: String, relation: String?, isEmergency: Bool, phone: String?) async throws {
        var body: [String: Any] = ["username": username, "isEmergency": isEmergency]
        if let relation, !relation.isEmpty { body["relation"] = relation }
        if let phone, !phone.isEmpty { body["phone"] = phone }
        _ = try await authedSend("POST", "/api/family/links", token: token, body: body)
    }

    func deleteFamilyLink(token: String, id: String) async throws {
        _ = try await authedSend("DELETE", "/api/family/links/\(id)", token: token)
    }

    func emergencyTargets(token: String) async throws -> [EmergencyTarget] {
        struct R: Codable { let targets: [EmergencyTarget] }
        let data = try await authedSend("POST", "/api/emergency/trigger", token: token, body: [:])
        return (try? JSONDecoder().decode(R.self, from: data))?.targets ?? []
    }

    // MARK: 在线待命 / 匹配

    func assistHeartbeat(token: String, available: Bool) async {
        _ = try? await authedSend("POST", "/api/assist/heartbeat", token: token, body: ["available": available])
    }

    func assistMatch(token: String, emergency: Bool) async throws -> [EmergencyTarget] {
        struct R: Codable { let targets: [EmergencyTarget] }
        let data = try await authedSend("POST", "/api/assist/match", token: token, body: ["emergency": emergency])
        return (try? JSONDecoder().decode(R.self, from: data))?.targets ?? []
    }

    /// 通话前拉取 ICE 服务器（STUN + 短时效 TURN 凭据）。
    func iceServers(token: String) async throws -> [IceServerInfo] {
        struct R: Codable { let iceServers: [IceServerInfo] }
        let data = try await authedGet("/api/assist/turn", token: token)
        return (try? JSONDecoder().decode(R.self, from: data))?.iceServers ?? []
    }

    /// 修改密码（旧密码验证；成功后服务端撤销所有 refresh token）。
    func changePassword(token: String, oldPassword: String, newPassword: String) async throws {
        _ = try await authedSend("POST", "/api/account/password", token: token,
                                 body: ["oldPassword": oldPassword, "newPassword": newPassword])
    }

    /// 删除账号（App Store 要求）。
    func deleteAccount(token: String) async throws {
        _ = try await authedSend("DELETE", "/api/account", token: token)
    }

    /// 通话中/后举报对方（信任与安全）。
    func submitReport(token: String, targetUserId: String, callId: String?, reason: String) async throws {
        var body: [String: Any] = ["targetUserId": targetUserId, "reason": reason]
        if let callId { body["callId"] = callId }
        _ = try await authedSend("POST", "/api/reports", token: token, body: body)
    }

    // MARK: 录制策略（管理员）

    func recordingConfig(token: String) async throws -> RecordingConfig {
        let data = try await authedGet("/api/recordings/config", token: token)
        guard let c = try? JSONDecoder().decode(RecordingConfig.self, from: data) else { throw APIError.decoding }
        return c
    }

    func setRecordingConfig(token: String, enabled: Bool? = nil, requireConsent: Bool? = nil, retentionDays: Int? = nil) async throws -> RecordingConfig {
        var body: [String: Any] = [:]
        if let enabled { body["enabled"] = enabled }
        if let requireConsent { body["requireConsent"] = requireConsent }
        if let retentionDays { body["retentionDays"] = retentionDays }
        let data = try await authedSend("PUT", "/api/recordings/config", token: token, body: body)
        guard let c = try? JSONDecoder().decode(RecordingConfig.self, from: data) else { throw APIError.decoding }
        return c
    }
}
