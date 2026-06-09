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
    // 仅本人 /api/me 返回（selfView）；登录/注册/管理员列表为 publicUser，这两项为 nil。
    var email: String?
    var emailVerified: Bool?
}

struct AuthResult: Codable, Sendable {
    let token: String
    let refreshToken: String
    let user: AccountInfo
}

struct FamilyLinkInfo: Codable, Sendable, Identifiable {
    let id: String
    let memberId: String   // 对方 userId（无论我是 owner 还是 member）
    let memberName: String // 对方显示名
    let relation: String
    let isEmergency: Bool
    let phone: String?
    let status: String?   // "pending"=待确认，"accepted"=已生效（旧数据无此字段按已接受）
    var outgoing: Bool?   // true=我发起、待对方确认；false/nil=对方发起或已生效
    var isPending: Bool { status == "pending" }
    var isAccepted: Bool { (status ?? "accepted") == "accepted" }
}

struct IncomingLinkInfo: Codable, Sendable, Identifiable {
    let id: String
    let ownerId: String
    let ownerName: String
    let relation: String
    let isEmergency: Bool
    let status: String?   // "pending" 表示待我接受；"accepted" 已生效（旧数据无此字段按已接受）
    var isPending: Bool { status == "pending" }
}

struct EmergencyTarget: Codable, Sendable, Identifiable {
    var id: String { memberId }
    let memberId: String
    let memberName: String
    let relation: String?
    let isEmergency: Bool
}

/// 待接来电（协助者/亲友轮询得到）：发起人 + 用于加入的 callId。
struct IncomingCall: Codable, Sendable, Identifiable {
    var id: String { callId }
    let callId: String
    let fromName: String
    let fromUserId: String
}

/// 公开求助队列摘要（协助者浏览）：粗粒度信息，不含发起人 userId（隐私）。
struct HelpRequestSummary: Codable, Sendable, Identifiable {
    var id: String { callId }
    let callId: String
    let fromName: String
    let language: String?
    let locality: String?
    let topic: String?
    let waitedSeconds: Int
}

/// 认领/匹配成功后返回的求助详情（供协助者决定是否帮助 + 入会）。
struct HelpRequestDetail: Codable, Sendable, Identifiable {
    var id: String { callId }
    let callId: String
    let fromName: String
    let language: String?
    let locality: String?
    let topic: String?
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

/// 黑名单条目（我拉黑的人）。
struct BlockedUser: Codable, Sendable, Identifiable {
    var id: String { recordId }
    let recordId: String
    let user: AccountInfo
    enum CodingKeys: String, CodingKey { case recordId = "id"; case user }
}

struct ReportInfo: Codable, Sendable, Identifiable {
    let id: String
    let reporterId: String
    let targetUserId: String
    let reason: String
    let status: String
    let reporterName: String?
    let targetName: String?
}

enum APIError: Error {
    case server(String)
    case decoding
    case network
    case unauthorized // 401：access token 失效/被撤销——已登录请求据此走刷新/登出，区别于其它 4xx 业务错误（见审查 #2/#4）
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
        // 5xx 是后端瞬时故障（token 仍有效）→ 归为可重试的 .network，绝不据此登出/删令牌（见审查 #4）。
        if http.statusCode == 401 { throw APIError.unauthorized } // 登录:凭据错误 / refresh:失效——调用方分别处理（见审查 #2/#4）
        if http.statusCode >= 500 { throw APIError.network }
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
        if http.statusCode == 401 { throw APIError.unauthorized } // access 失效/被撤销 → 走刷新/登出（见审查 #2/#4）
        if http.statusCode >= 500 { throw APIError.network } // 瞬时后端故障：可重试，不登出（见审查 #4）
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
        // 走 authedSend：401→.unauthorized（调用方据此登出）、其它 4xx→.server(真实原因)，与其余管理端点一致。
        _ = try await authedSend("POST", "/api/admin/users/\(userId)/status", token: token, body: ["status": status])
    }

    /// 管理员分配/变更用户角色。
    func setUserRole(token: String, userId: String, role: String) async throws {
        _ = try await authedSend("POST", "/api/admin/users/\(userId)/role", token: token, body: ["role": role])
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
        if http.statusCode == 401 { throw APIError.unauthorized } // access 失效/被撤销 → 走刷新/登出（见审查 #2/#4）
        if http.statusCode >= 500 { throw APIError.network } // 瞬时后端故障：可重试，不登出（见审查 #4）
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

    /// 协助者/亲友接受一条绑定请求（双向同意，见审查 #6）。
    func acceptFamilyLink(token: String, id: String) async throws {
        _ = try await authedSend("POST", "/api/family/links/\(id)/accept", token: token)
    }

    func deleteFamilyLink(token: String, id: String) async throws {
        _ = try await authedSend("DELETE", "/api/family/links/\(id)", token: token)
    }

    /// 按 userId 发起加好友请求（通话中加对方为常用亲友/协助者）。
    func addFamilyLink(token: String, userId: String, relation: String? = nil) async throws {
        var body: [String: Any] = ["userId": userId]
        if let relation, !relation.isEmpty { body["relation"] = relation }
        _ = try await authedSend("POST", "/api/family/links", token: token, body: body)
    }

    // MARK: 黑名单

    func blockUser(token: String, username: String) async throws {
        _ = try await authedSend("POST", "/api/blocks", token: token, body: ["username": username])
    }
    func blockUser(token: String, userId: String) async throws {
        _ = try await authedSend("POST", "/api/blocks", token: token, body: ["userId": userId])
    }
    func blocks(token: String) async throws -> [BlockedUser] {
        struct R: Codable { let blocks: [BlockedUser] }
        let data = try await authedGet("/api/blocks", token: token)
        return (try? JSONDecoder().decode(R.self, from: data))?.blocks ?? []
    }
    func unblock(token: String, id: String) async {
        _ = try? await authedSend("DELETE", "/api/blocks/\(id)", token: token)
    }

    func emergencyTargets(token: String) async throws -> [EmergencyTarget] {
        struct R: Codable { let targets: [EmergencyTarget] }
        let data = try await authedSend("POST", "/api/emergency/trigger", token: token, body: [:])
        // 区分"解码失败"与"确实没有联系人"：紧急路径上把解码失败抛成 .decoding，让调用方提示
        // "发起失败请重试"，而非误报"没有可呼叫的亲友"（见审查 round5 #3）。
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.targets
    }

    // MARK: 在线待命 / 匹配

    func assistHeartbeat(token: String, available: Bool) async {
        // 带客户端发起时刻：后端据此忽略乱序到达的过期心跳，避免切页时把在线亲友错标离线（见审查 #1）。
        let at = Int(Date().timeIntervalSince1970 * 1000)
        _ = try? await authedSend("POST", "/api/assist/heartbeat", token: token, body: ["available": available, "at": at])
    }

    func assistMatch(token: String, emergency: Bool) async throws -> [EmergencyTarget] {
        struct R: Codable { let targets: [EmergencyTarget] }
        let data = try await authedSend("POST", "/api/assist/match", token: token, body: ["emergency": emergency])
        // 同上：解码失败抛错而非静默空数组，避免紧急路径误报"没有亲友"（见审查 round5 #3）。
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.targets
    }

    // MARK: 免推送前台会合（视障登记呼叫 → 在线协助者/亲友轮询接听）

    /// 视障侧发起呼叫：登记 callId + 目标用户，供对端轮询发现并加入。
    func startEmergencyCall(token: String, callId: String, targetUserIds: [String]) async throws {
        _ = try await authedSend("POST", "/api/assist/call", token: token, body: ["callId": callId, "targetUserIds": targetUserIds])
    }

    /// 取消/结束待接来电（尽力而为）。
    func cancelCall(token: String, callId: String) async {
        _ = try? await authedSend("POST", "/api/assist/call/cancel", token: token, body: ["callId": callId])
    }

    /// 协助者/亲友轮询自己的待接来电。
    func incomingCalls(token: String) async throws -> [IncomingCall] {
        struct R: Codable { let calls: [IncomingCall] }
        let data = try await authedGet("/api/assist/incoming", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.calls
    }

    // MARK: 公开求助队列（面向陌生志愿者的众包协助）

    /// 视障侧广播一条公开求助（登记 callId + 粗粒度信息），随后进入通话界面等待志愿者接入。
    func postHelpRequest(token: String, callId: String, language: String?, locality: String?, topic: String?) async throws {
        var body: [String: Any] = ["callId": callId]
        if let language, !language.isEmpty { body["language"] = language }
        if let locality, !locality.isEmpty { body["locality"] = locality }
        if let topic, !topic.isEmpty { body["topic"] = topic }
        _ = try await authedSend("POST", "/api/assist/help/request", token: token, body: body)
    }

    /// 协助者浏览公开求助队列。
    func helpQueue(token: String) async throws -> [HelpRequestSummary] {
        struct R: Codable { let requests: [HelpRequestSummary] }
        let data = try await authedGet("/api/assist/help/queue", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.requests
    }

    /// 协助者认领指定求助（成功返回详情；已被他人认领时抛 .server("already_claimed_or_gone")）。
    func claimHelp(token: String, callId: String) async throws -> HelpRequestDetail {
        struct R: Codable { let request: HelpRequestDetail }
        let data = try await authedSend("POST", "/api/assist/help/claim", token: token, body: ["callId": callId])
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.request
    }

    /// 协助者随机/偏好匹配一条公开求助并认领。无可匹配返回 nil。
    func matchHelp(token: String, preferredLanguage: String?, requireLanguageMatch: Bool) async throws -> HelpRequestDetail? {
        struct R: Codable { let request: HelpRequestDetail? }
        var body: [String: Any] = ["requireLanguageMatch": requireLanguageMatch]
        if let preferredLanguage, !preferredLanguage.isEmpty { body["preferredLanguage"] = preferredLanguage }
        let data = try await authedSend("POST", "/api/assist/help/match", token: token, body: body)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.request
    }

    /// 取消公开求助（发起人撤销）/ 放弃认领（志愿者释放回队列）。尽力而为。
    func cancelHelp(token: String, callId: String) async {
        _ = try? await authedSend("POST", "/api/assist/help/cancel", token: token, body: ["callId": callId])
    }

    // MARK: PushKit VoIP token（A1 后台来电）

    /// 上报本机 VoIP 推送 token（尽力而为）。
    func registerVoipToken(token: String, voipToken: String) async {
        _ = try? await authedSend("POST", "/api/push/register", token: token, body: ["voipToken": voipToken])
    }

    /// 注销 VoIP token（尽力而为）。
    func unregisterVoipToken(token: String) async {
        _ = try? await authedSend("DELETE", "/api/push/register", token: token)
    }

    // MARK: 邮箱验证 / 找回密码（D1）

    /// 设置/更新邮箱（随后服务端发一封验证码邮件）。
    func setEmail(token: String, email: String) async throws {
        _ = try await authedSend("POST", "/api/account/email", token: token, body: ["email": email])
    }

    /// 校验邮箱验证码。
    func verifyEmail(token: String, code: String) async throws {
        _ = try await authedSend("POST", "/api/account/email/verify", token: token, body: ["code": code])
    }

    /// 发起找回密码（向账号邮箱发验证码；不论账号是否存在均返回成功，防枚举）。
    func forgotPassword(username: String) async throws {
        _ = try await postNoAuth("/api/auth/forgot-password", body: ["username": username])
    }

    /// 凭验证码重置密码。
    func resetPassword(username: String, code: String, newPassword: String) async throws {
        _ = try await postNoAuth("/api/auth/reset-password", body: ["username": username, "code": code, "newPassword": newPassword])
    }

    /// 未登录的简单 POST（找回密码等）。返回原始 Data；4xx 抛 .server，5xx/网络抛 .network。
    @discardableResult
    private func postNoAuth(_ path: String, body: [String: Any]) async throws -> Data {
        var req = URLRequest(url: baseURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch { throw APIError.network }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode >= 500 { throw APIError.network }
        if http.statusCode >= 400 {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError.server((obj?["error"] as? String) ?? "HTTP \(http.statusCode)")
        }
        return data
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
