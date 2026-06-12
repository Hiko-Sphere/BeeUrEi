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
    var displayName: String  // 昵称，可改（用户名 username 才唯一不可改）
    let role: String
    let status: String
    // 仅本人 /api/me 返回（selfView）；登录/注册/管理员列表为 publicUser，这两项为 nil。
    var email: String?
    var emailVerified: Bool?
    var avatar: String?   // 头像 data URL（publicUser 也带，供联系人/通话显示）
}

struct AuthResult: Codable, Sendable {
    let token: String
    let refreshToken: String
    let user: AccountInfo
}

/// 一条聊天消息（kind=audio/image 时 text 为 data URL；kind=video 时 text 为 mediaId；recalled=已撤回占位）。
struct ChatMessageInfo: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let fromId: String
    let toId: String
    let kind: String
    let text: String
    let createdAt: Int
    var readAt: Int?
    var reaction: String? // 表情回应（单 emoji，最新覆盖）
    var groupId: String?  // 群消息所属群（单聊为 nil）
}

/// 群组（WhatsApp 式：群主建群/加人/踢人/解散，成员可退群）。
struct GroupInfo: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let name: String
    let ownerId: String
    let memberIds: [String]
    let createdAt: Int
}

/// 群会话列表项：群 + 成员公开资料 + 最后一条 + 未读数。
struct GroupConversationInfo: Codable, Sendable, Identifiable {
    struct Member: Codable, Sendable {
        let id: String
        let username: String
        let displayName: String
        let avatar: String?
    }
    let group: GroupInfo
    let members: [Member]
    let last: ChatMessageInfo?
    let unread: Int
    var id: String { group.id }
}

/// 会话列表项：对端公开资料 + 最后一条 + 未读数。
struct ConversationInfo: Codable, Sendable, Identifiable {
    struct Peer: Codable, Sendable {
        let id: String
        let username: String
        let displayName: String
        let avatar: String?
    }
    let peer: Peer
    let last: ChatMessageInfo
    let unread: Int
    var id: String { peer.id }
}

struct FamilyLinkInfo: Codable, Sendable, Identifiable {
    let id: String
    let memberId: String   // 对方 userId（无论我是 owner 还是 member）
    let memberName: String // 对方显示名
    var memberAvatar: String?
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
    var ownerAvatar: String?
    let relation: String
    let isEmergency: Bool
    let status: String?   // "pending" 表示待我接受；"accepted" 已生效（旧数据无此字段按已接受）
    var isPending: Bool { status == "pending" }
}

struct EmergencyTarget: Codable, Sendable, Identifiable {
    var id: String { memberId }
    let memberId: String
    let memberName: String
    var avatar: String?
    let relation: String?
    let isEmergency: Bool
}

/// 待接来电（协助者/亲友轮询得到）：发起人 + 用于加入的 callId。
struct IncomingCall: Codable, Sendable, Identifiable {
    var id: String { callId }
    let callId: String
    let fromName: String
    let fromUserId: String
    var fromAvatar: String?
}

/// 公开求助队列摘要（协助者浏览）：粗粒度信息，不含发起人 userId（隐私）。
struct HelpRequestSummary: Codable, Sendable, Identifiable {
    var id: String { callId }
    let callId: String
    let fromName: String
    var fromAvatar: String?
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
    var fromAvatar: String?
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

/// 通话记录条目。
struct CallRecordInfo: Codable, Sendable, Identifiable {
    let id: String
    let callId: String
    let direction: String  // "outgoing" 呼出 / "incoming" 呼入
    let status: String     // "missed" 未接 / "answered" 已接 / "declined" 已拒绝
    let peerName: String
    var peerAvatar: String?
    let createdAt: Double   // 毫秒时间戳
    var isMissed: Bool { status == "missed" }
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

    /// 注册：用户名/手机号/邮箱至少给一个（手机号或邮箱即可当账号，后端自动生成用户名）。
    func register(username: String?, password: String, role: String?,
                  phone: String? = nil, email: String? = nil) async throws -> AuthResult {
        var body: [String: Any] = ["password": password]
        if let username, !username.isEmpty { body["username"] = username }
        if let role { body["role"] = role }
        if let phone, !phone.isEmpty { body["phone"] = phone }
        if let email, !email.isEmpty { body["email"] = email }
        return try await postAuth("/api/auth/register", body: body)
    }

    /// 登录标识可为用户名/手机号/邮箱（后端依次匹配）。
    func login(username: String, password: String) async throws -> AuthResult {
        try await postAuth("/api/auth/login", body: ["username": username, "password": password])
    }

    /// Sign in with Apple：identityToken 由系统授权回调提供，服务端验签后登录/自动建号。
    func loginWithApple(identityToken: String, displayName: String?, role: String?) async throws -> AuthResult {
        var body: [String: Any] = ["identityToken": identityToken]
        if let displayName, !displayName.isEmpty { body["displayName"] = displayName }
        if let role { body["role"] = role }
        return try await postAuth("/api/auth/apple", body: body)
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

    /// 目标"拒绝"来电（尽力而为）——发起方据此显示"对方已拒绝"。
    func declineCall(token: String, callId: String) async {
        _ = try? await authedSend("POST", "/api/assist/call/decline", token: token, body: ["callId": callId])
    }

    /// 被叫接听 → 首接抢占 + 通话记录标记已接听。
    /// 返回是否"抢到"了这通群呼（false=已被其他亲友先接，应提示并退出而非加入）。网络失败按抢到处理（不阻断接听）。
    @discardableResult
    func markAnswered(token: String, callId: String) async -> Bool {
        struct R: Codable { let youWon: Bool? }
        guard let data = try? await authedSend("POST", "/api/assist/call/answered", token: token, body: ["callId": callId]),
              let r = try? JSONDecoder().decode(R.self, from: data) else { return true }
        return r.youWon ?? true
    }

    /// 求助前：我绑定的协助者/亲友中在线人数（online）与总数（total）。
    func onlineHelperCount(token: String) async -> (online: Int, total: Int) {
        struct R: Codable { let total: Int; let online: Int }
        guard let data = try? await authedGet("/api/assist/online-count", token: token),
              let r = try? JSONDecoder().decode(R.self, from: data) else { return (0, 0) }
        return (r.online, r.total)
    }

    /// 通话记录（呼出/呼入/未接）。
    func callHistory(token: String) async throws -> [CallRecordInfo] {
        struct R: Codable { let calls: [CallRecordInfo] }
        let data = try await authedGet("/api/calls", token: token)
        return (try? JSONDecoder().decode(R.self, from: data))?.calls ?? []
    }

    /// 发起方轮询呼叫状态：是否所有目标已拒绝。
    func callDeclined(token: String, callId: String) async -> Bool {
        struct R: Codable { let exists: Bool; let declinedAll: Bool }
        guard let data = try? await authedGet("/api/assist/call/status?callId=\(callId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? callId)", token: token),
              let r = try? JSONDecoder().decode(R.self, from: data) else { return false }
        return r.declinedAll
    }

    /// 设置昵称（displayName）。用户名唯一不可改；昵称可改可重复，用于通话/CallKit/列表显示。
    func setDisplayName(token: String, displayName: String) async throws {
        _ = try await authedSend("POST", "/api/account/profile", token: token, body: ["displayName": displayName])
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

    /// 上报普通 APNs 提醒推送 token（软件外通知；尽力而为）。
    func registerApnsToken(token: String, apnsToken: String) async {
        _ = try? await authedSend("POST", "/api/push/apns-register", token: token, body: ["token": apnsToken])
    }

    /// 同步播报语言偏好到后端（推送文案/匹配排序按此选语言；尽力而为）。
    func setLanguage(token: String, language: String) async {
        _ = try? await authedSend("POST", "/api/account/language", token: token, body: ["language": language])
    }

    /// 摔倒/车祸警报：推送给所有 accepted 绑定亲友。成功返回通知到的人数，失败返回 nil。
    func postEmergencyAlert(token: String, kind: String, lat: Double?, lon: Double?) async -> Int? {
        var body: [String: Any] = ["kind": kind]
        if let lat, let lon { body["lat"] = lat; body["lon"] = lon }
        guard let data = try? await authedSend("POST", "/api/emergency/alert", token: token, body: body),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj["notified"] as? Int ?? 0
    }

    // MARK: 聊天（绑定亲友/协助者互发）

    func sendMessage(token: String, toId: String, kind: String, text: String) async throws -> ChatMessageInfo {
        let data = try await authedSend("POST", "/api/messages", token: token,
                                        body: ["toId": toId, "kind": kind, "text": text])
        struct R: Codable { let message: ChatMessageInfo }
        return try JSONDecoder().decode(R.self, from: data).message
    }

    func messages(token: String, with peerId: String, before: Int? = nil) async throws -> [ChatMessageInfo] {
        var path = "/api/messages?with=\(peerId)&limit=50"
        if let before { path += "&before=\(before)" }
        let data = try await authedGet(path, token: token)
        struct R: Codable { let messages: [ChatMessageInfo] }
        return try JSONDecoder().decode(R.self, from: data).messages
    }

    func conversations(token: String) async throws -> [ConversationInfo] {
        let data = try await authedGet("/api/conversations", token: token)
        struct R: Codable { let conversations: [ConversationInfo] }
        return try JSONDecoder().decode(R.self, from: data).conversations
    }

    func markMessagesRead(token: String, fromId: String) async {
        _ = try? await authedSend("POST", "/api/messages/read", token: token, body: ["fromId": fromId])
    }

    /// 撤回自己的消息（2 分钟内）。返回更新后的消息（recalled 占位），失败 nil。
    func recallMessage(token: String, id: String) async -> ChatMessageInfo? {
        guard let data = try? await authedSend("POST", "/api/messages/\(id)/recall", token: token, body: [:]) else { return nil }
        struct R: Codable { let message: ChatMessageInfo }
        return try? JSONDecoder().decode(R.self, from: data).message
    }

    /// 表情回应（空字符串=取消）。返回更新后的消息，失败 nil。
    func reactMessage(token: String, id: String, emoji: String) async -> ChatMessageInfo? {
        guard let data = try? await authedSend("POST", "/api/messages/\(id)/reaction", token: token, body: ["emoji": emoji]) else { return nil }
        struct R: Codable { let message: ChatMessageInfo }
        return try? JSONDecoder().decode(R.self, from: data).message
    }
    func unregisterApnsToken(token: String) async {
        _ = try? await authedSend("DELETE", "/api/push/apns-register", token: token)
    }

    // MARK: 群聊

    /// 建群（初始成员必须都是我的 accepted 绑定好友）。
    func createGroup(token: String, name: String, memberIds: [String]) async throws -> GroupInfo {
        let data = try await authedSend("POST", "/api/groups", token: token,
                                        body: ["name": name, "memberIds": memberIds])
        struct R: Codable { let group: GroupInfo }
        return try JSONDecoder().decode(R.self, from: data).group
    }

    /// 我的群会话列表（最近活跃在前）。
    func groups(token: String) async throws -> [GroupConversationInfo] {
        let data = try await authedGet("/api/groups", token: token)
        struct R: Codable { let groups: [GroupConversationInfo] }
        return try JSONDecoder().decode(R.self, from: data).groups
    }

    /// 加人（群主；新成员须是群主好友）。失败返回 nil。
    func addGroupMember(token: String, groupId: String, userId: String) async -> GroupInfo? {
        guard let data = try? await authedSend("POST", "/api/groups/\(groupId)/members", token: token,
                                               body: ["userId": userId]) else { return nil }
        struct R: Codable { let group: GroupInfo }
        return try? JSONDecoder().decode(R.self, from: data).group
    }

    /// 移出成员：群主踢人，或成员移出自己（退群）。
    func removeGroupMember(token: String, groupId: String, userId: String) async -> Bool {
        (try? await authedSend("DELETE", "/api/groups/\(groupId)/members/\(userId)", token: token)) != nil
    }

    /// 解散（群主）。
    func dissolveGroup(token: String, groupId: String) async -> Bool {
        (try? await authedSend("DELETE", "/api/groups/\(groupId)", token: token)) != nil
    }

    /// 群消息（时间正序）。
    func groupMessages(token: String, groupId: String, before: Int? = nil) async throws -> [ChatMessageInfo] {
        var path = "/api/messages?group=\(groupId)&limit=50"
        if let before { path += "&before=\(before)" }
        let data = try await authedGet(path, token: token)
        struct R: Codable { let messages: [ChatMessageInfo] }
        return try JSONDecoder().decode(R.self, from: data).messages
    }

    /// 发群消息。
    func sendGroupMessage(token: String, groupId: String, kind: String, text: String) async throws -> ChatMessageInfo {
        let data = try await authedSend("POST", "/api/messages", token: token,
                                        body: ["groupId": groupId, "kind": kind, "text": text])
        struct R: Codable { let message: ChatMessageInfo }
        return try JSONDecoder().decode(R.self, from: data).message
    }

    /// 标记群已读（按人记"读到的时间戳"）。
    func markGroupRead(token: String, groupId: String) async {
        _ = try? await authedSend("POST", "/api/messages/read", token: token, body: ["groupId": groupId])
    }

    // MARK: 媒体（视频消息：实体文件走服务器磁盘，不挤 JSON）

    /// 上传视频二进制，返回 mediaId（随后作为 kind=video 消息的 text 发送）。
    func uploadMedia(token: String, data body: Data, mime: String) async throws -> String {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/media"))
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(mime, forHTTPHeaderField: "Content-Type")
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await URLSession.shared.upload(for: req, from: body) } catch { throw APIError.network }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if http.statusCode >= 400 {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError.server((obj?["error"] as? String) ?? "HTTP \(http.statusCode)")
        }
        struct R: Codable { struct M: Codable { let id: String }; let media: M }
        return try JSONDecoder().decode(R.self, from: data).media.id
    }

    /// 下载媒体到本地临时文件（按 mediaId 缓存，重复播放不重复下载）。返回本地 URL。
    func downloadMedia(token: String, id: String) async throws -> URL {
        let cached = FileManager.default.temporaryDirectory.appendingPathComponent("media-\(id).mp4")
        if FileManager.default.fileExists(atPath: cached.path) { return cached }
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/media/\(id)"))
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (tmp, resp): (URL, URLResponse)
        do { (tmp, resp) = try await URLSession.shared.download(for: req) } catch { throw APIError.network }
        guard let http = resp as? HTTPURLResponse, http.statusCode < 400 else { throw APIError.network }
        try? FileManager.default.removeItem(at: cached)
        try FileManager.default.moveItem(at: tmp, to: cached)
        return cached
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

    /// 设置头像（小尺寸 data URL，客户端已压缩）。
    func setAvatar(token: String, dataURL: String) async throws {
        _ = try await authedSend("POST", "/api/account/avatar", token: token, body: ["avatar": dataURL])
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
