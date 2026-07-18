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
    var displayName: String  // 昵称，可改（用户名 username 是唯一登录标识，可在账号页修改）
    let role: String
    let status: String
    // 仅本人 /api/me 返回（selfView）；登录/注册/管理员列表为 publicUser，这些项为 nil。
    var email: String?
    var emailVerified: Bool?
    var avatar: String?   // 头像 data URL（publicUser 也带，供联系人/通话显示）
    var phone: String?            // 仅 /api/me
    var usernameCustomized: Bool? // /api/me：false=自动生成名，提示用户设置唯一 userid
    var appleLinked: Bool?        // /api/me：是否已绑定 Apple ID
    var hasPasskey: Bool?         // /api/me：是否已注册 passkey
    var twoFactorEnabled: Bool?   // /api/me：是否已开启两步验证（账号页展示开关态）
    var legalConsentVersion: String? // /api/me：已同意的隐私/条款版本；与当前版本不符则需（重新）同意
    var helperGuidelineAckAt: Double? // /api/me：协助守则首次确认时间（nil=首次协助前展示守则卡）
    var verified: Bool?           // publicUser/selfView：实名认证（KYC）是否已通过——仅布尔徽章，绝不含姓名
}

/// 一把 passkey（账号页列表/删除用）。
struct PasskeyInfo: Codable, Sendable, Identifiable {
    let id: String
    var deviceName: String?
    let createdAt: Double
}

/// 两步验证状态（账号页展示）。
struct TwoFAStatus: Codable, Sendable { let enabled: Bool; let recoveryCodesRemaining: Int }
/// 开始绑定 2FA 的返回：base32 密钥 + otpauth URI（盲人可复制密钥手动添加，或点链接自动添加）。
struct TwoFASetup: Codable, Sendable { let secret: String; let otpauthUri: String }
private struct TwoFACodesResult: Codable { let recoveryCodes: [String] }

/// 一个登录会话/设备（账号页「登录设备」列表）。
struct SessionInfo: Codable, Sendable, Identifiable {
    let sessionId: String
    var deviceLabel: String?
    var createdAt: Double?
    var lastSeenAt: Double?
    let expiresAt: Double
    var current: Bool
    var id: String { sessionId }
}
private struct SessionsResult: Codable { let sessions: [SessionInfo] }

/// 实名认证（KYC）状态（账号页展示；绝不含姓名/证件号/图片）。
struct VerificationStatusInfo: Codable, Sendable {
    let status: String                 // none | pending | verified | rejected
    var idType: String?
    var attempt: Int?
    var submittedAt: Double?
    var decidedAt: Double?
    var rejectReasonCode: String?
    var rejectReasonNote: String?
    var docsUploaded: [String]?
    var canResubmit: Bool?
}
private struct VerificationSubmitResult: Codable { let id: String; let attempt: Int? }

struct AuthResult: Codable, Sendable {
    let token: String
    let refreshToken: String
    let user: AccountInfo
    var created: Bool? // true=本次认证新建了账号 → 客户端走"选身份→设 userid→绑邮箱"引导
}

/// 全站功能开关（GET /api/app-config）。管理员可在后台逐项关闭某功能；App 据此隐藏/禁用对应按钮。
/// **fail-open**：默认全开，且任一键缺失按 true 解码——拉取失败/字段缺失绝不误关功能（避免误伤盲人）。
struct RemoteFeatureFlags: Codable, Sendable, Equatable {
    var messaging = true
    var calls = true
    var helpRequests = true
    var groups = true
    var familyLinks = true
    var mediaUpload = true
    var navigation = true
    var sceneScan = true
    var locationSharing = true
    static let allOn = RemoteFeatureFlags()

    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func b(_ k: CodingKeys) -> Bool { ((try? c.decodeIfPresent(Bool.self, forKey: k)) ?? nil) ?? true }
        messaging = b(.messaging); calls = b(.calls); helpRequests = b(.helpRequests); groups = b(.groups)
        familyLinks = b(.familyLinks); mediaUpload = b(.mediaUpload); navigation = b(.navigation); sceneScan = b(.sceneScan)
        locationSharing = b(.locationSharing)
    }
}

/// 全站公告（管理员推送的横幅）。
struct RemoteAnnouncement: Codable, Sendable, Equatable {
    var active = false
    var message = ""
    var level = "info" // info | warning
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        active = ((try? c.decodeIfPresent(Bool.self, forKey: .active)) ?? nil) ?? false
        message = ((try? c.decodeIfPresent(String.self, forKey: .message)) ?? nil) ?? ""
        level = ((try? c.decodeIfPresent(String.self, forKey: .level)) ?? nil) ?? "info"
    }
}
/// 维护模式横幅。
struct RemoteMaintenance: Codable, Sendable, Equatable {
    var active = false
    var message = ""
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        active = ((try? c.decodeIfPresent(Bool.self, forKey: .active)) ?? nil) ?? false
        message = ((try? c.decodeIfPresent(String.self, forKey: .message)) ?? nil) ?? ""
    }
}
/// 全站录制策略（/api/app-config.recording）：默认关闭、需双方同意（fail-safe：缺省即最严格）。
struct RemoteRecordingPolicy: Codable, Sendable, Equatable {
    var enabled = false
    var requireConsent = true
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = ((try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? nil) ?? false
        requireConsent = ((try? c.decodeIfPresent(Bool.self, forKey: .requireConsent)) ?? nil) ?? true
    }
}
/// 整个 /api/app-config 响应（功能开关 + 公告 + 维护 + 录制策略）。各块缺失按默认（fail-open；录制 fail-safe）。
struct RemoteAppConfig: Codable, Sendable, Equatable {
    var features = RemoteFeatureFlags()
    var announcement = RemoteAnnouncement()
    var maintenance = RemoteMaintenance()
    var recording = RemoteRecordingPolicy()
    var requireVerification = false // 是否要求实名认证（未认证的可门控角色将被门禁屏拦住）
    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        features = ((try? c.decodeIfPresent(RemoteFeatureFlags.self, forKey: .features)) ?? nil) ?? RemoteFeatureFlags()
        announcement = ((try? c.decodeIfPresent(RemoteAnnouncement.self, forKey: .announcement)) ?? nil) ?? RemoteAnnouncement()
        maintenance = ((try? c.decodeIfPresent(RemoteMaintenance.self, forKey: .maintenance)) ?? nil) ?? RemoteMaintenance()
        recording = ((try? c.decodeIfPresent(RemoteRecordingPolicy.self, forKey: .recording)) ?? nil) ?? RemoteRecordingPolicy()
        requireVerification = ((try? c.decodeIfPresent(Bool.self, forKey: .requireVerification)) ?? nil) ?? false
    }
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
    var reaction: String? // 旧单字段表情回应（最新覆盖）——仅老服务端兜底；新服务端以 reactions 为准
    var reactions: [MessageReactionInfo]? // 逐用户表情回应聚合（每 emoji 计数+我是否回应+谁回应）；此前 Codable 静默丢弃该字段
    var groupId: String?  // 群消息所属群（单聊为 nil）
    var forwarded: Bool?  // 转发标记：让收件人知道非发送者原创（含盲人——防误信转发的链式内容）
    var editedAt: Int?    // 编辑时刻（ms）；非 nil = 发出后被改过，标"已编辑"（与 web 对齐）
    var readBy: Int?      // 群已读回执：已读到本条的其他成员数（仅自己发的群消息由服务端附）
    var readTotal: Int?   // 群其他成员总数（配 readBy 显示"已读 N/总"；此前群消息无任何已读反馈）
    var replyTo: String?  // 引用回复的消息 id（同会话内）；渲染被引消息预览 + 盲人听到"回复X：…"（与 web 对齐）
}

/// 逐用户表情回应聚合（与网页 MessageReaction 同形状；服务端 aggregateReactions 产出）。
struct MessageReactionInfo: Codable, Sendable, Equatable {
    let emoji: String
    let count: Int
    let mine: Bool        // 我是否也回应了这个 emoji（胶囊高亮 + 点击语义"取消/也回应"）
    let names: [String]   // 回应者显示名（"谁回应了"——读屏念名单比只念数字有用）
}

extension ChatMessageInfo {
    /// 表情胶囊数据（与网页 reactionChips 同口径，纯逻辑可测）：优先服务端 reactions 聚合；
    /// 老服务端只回单字段 reaction 时兜底合成一枚（mine 未知置 false、无名单）。
    var reactionChips: [MessageReactionInfo] {
        if let rs = reactions { return rs }
        if let r = reaction, !r.isEmpty { return [MessageReactionInfo(emoji: r, count: 1, mine: false, names: [])] }
        return []
    }
    /// 我当前所选的表情（菜单"取消回应"入口 + 点胶囊切换判定）；老服务端兜底退回 legacy 单字段。
    var myReaction: String? {
        if let rs = reactions { return rs.first { $0.mine }?.emoji }
        return reaction
    }
}

/// 线程响应（GET /api/messages?with=|?group=）：消息窗口 + 会话当前置顶（无置顶为 nil）。
/// 此前 iOS 只解 messages、pinned 被 Codable 静默丢弃——置顶横幅无从渲染。
struct ChatThreadInfo: Codable, Sendable {
    let messages: [ChatMessageInfo]
    var pinned: PinnedMessageInfo?
}

/// 会话置顶消息（顶部横幅）：一条消息 + 谁置顶的（与网页 PinnedMessage 同形状；服务端 resolvePinned 产出，
/// 悬垂/已撤回已自愈清理）。只声明横幅所需字段，其余服务端字段忽略。
struct PinnedMessageInfo: Codable, Sendable, Equatable {
    let id: String
    let fromId: String
    let kind: String
    let text: String
    let createdAt: Int
    var pinnedBy: String?
    var pinnedByName: String?
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
    let muted: Bool?   // 我是否静音此群（服务端下发；静音只压推送横幅，不影响未读/站内）
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
    let muted: Bool?   // 我是否静音了与该对端的单聊（服务端下发；静音只压推送横幅，不影响未读/站内）
    var id: String { peer.id }
}

/// 安全报到（dead-man's switch）：出行前设一到期时刻，到期前未"报平安"则后台自动告警亲友。与服务端 /api/safety/checkin 契约一致。
struct SafetyTimer: Codable, Sendable {
    let id: String
    let note: String?
    let status: String       // active / fired（已到期告警）/ completed / canceled
    let startedAt: Double
    let dueAt: Double
    let remainingSec: Int     // 服务端按 now 算好的剩余秒（≥0）
    var isActive: Bool { status == "active" }
}

/// 每日报到日程（User.dailyCheckin）：每天 startMinute 自动开始一次 durationMinutes 的报到。
/// pausedUntil：暂停至该时刻(ms)自动恢复（住院/出行临时停用，比整体关闭安全——不必记得重开）；过去/缺省=未暂停。
struct DailyCheckinSchedule: Codable, Sendable {
    let enabled: Bool
    let startMinute: Int      // 0-1439，本地时区的每天开始分钟
    let durationMinutes: Int
    let tz: String            // IANA 时区（服务端按此判"每天"）
    let note: String?
    let pausedUntil: Double?
    /// 是否处于生效中的暂停（相对给定 now，可测）。
    func isPaused(nowMs: Double) -> Bool { (pausedUntil ?? 0) > nowMs }
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
    var online: Bool?     // 对方此刻在线/待命（服务端仅 accepted 关系才为 true；旧/缺省按离线）——盲人据此优先呼叫接得通的人
    var amOwner: Bool?    // 我是否为该链 owner（服务端 viewLink 提供）：定紧急联系人徽标方向——true/nil=对方是我的紧急联系人；false=我是对方的（我对 TA 负责）。此前 iOS 未解码=死字段。
    var verified: Bool?   // 对方已通过实名认证（KYC 真人核验，信任信号）：此前 Codable 静默丢弃 → 联系人列表无实名徽标
    var isPending: Bool { status == "pending" }
    var isAccepted: Bool { (status ?? "accepted") == "accepted" }
    /// 是否显示实名徽标（视图与测试共用同一门控）。
    var showsVerifiedBadge: Bool { verified == true }
}

struct IncomingLinkInfo: Codable, Sendable, Identifiable {
    let id: String
    let ownerId: String
    let ownerName: String
    var ownerAvatar: String?
    let relation: String
    let isEmergency: Bool
    let status: String?   // "pending" 表示待我接受；"accepted" 已生效（旧数据无此字段按已接受）
    var verified: Bool?   // 请求方已实名认证——决定是否接受一段安全关系时该看到（与列表徽标同源）
    var isPending: Bool { status == "pending" }
    var showsVerifiedBadge: Bool { verified == true }
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
    let peerId: String?    // 对端 userId：据此让通话记录可点进与其的聊天（跟进/回访）；已注销用户为 nil→不可点、无死链
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

/// 进行中的一通通话（管理员实时总览/旁观用）。
struct ActiveCallInfo: Codable, Sendable, Identifiable {
    let callId: String
    let startedAt: Double
    let durationSec: Int
    let hasAdminObserver: Bool
    let members: [Member]
    var id: String { callId }
    struct Member: Codable, Sendable, Identifiable {
        let userId: String
        let role: String
        let name: String?
        let online: Bool
        var id: String { userId }
    }
}

/// 一条通话录制（含详细元数据：时间/地点/人/时长）。用户端"我的录音"与管理员录制总览共用。
struct RecordingInfo: Codable, Sendable, Identifiable {
    let id: String
    let callId: String
    let ownerId: String
    let ownerName: String
    let reason: String
    let recordedAt: Double          // 录制时间（ms）
    let durationSec: Int?           // 时长（秒）
    let lat: Double?
    let lon: Double?
    let locationLabel: String?      // 可读地名
    let participantIds: [String]
    let participantNames: [String]  // 参与者显示名（"人"）
    let hasMedia: Bool              // 媒体文件是否仍在（可播放）
    let deletedAt: Double?          // 用户已软删除时间（仅管理员视图非空：标注"已删·留存中"）
}

/// 一条站内通知（持久化收件箱）：如"举报已处理"。
struct NotificationInfo: Codable, Sendable, Identifiable {
    let id: String
    let userId: String
    let kind: String
    let title: String
    let body: String
    let data: [String: String]?
    let createdAt: Double
    let readAt: Double?
    var isUnread: Bool { readAt == nil }
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

    /// 用 path（可含查询串，如 "/api/messages?with=X&limit=50"）构造请求 URL。
    /// 关键：URL.appendingPathComponent 会把 '?' 百分号编码成 %3F，使查询串被并入路径、
    /// 服务端收不到 with/group 等参数而 404 —— 这正是"消息历史无法显示"的根因。
    /// 改用相对 URL 解析（path 以 '/' 开头即 host 根相对）保留查询串；解析失败再退回旧法。
    private func apiURL(_ path: String) -> URL {
        URL(string: path, relativeTo: baseURL)?.absoluteURL ?? baseURL.appendingPathComponent(path)
    }

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

    /// 登录标识可为用户名/手机号/邮箱（后端依次匹配）。开了 2FA 的账号补交 totpCode（TOTP 或一次性恢复码）。
    func login(username: String, password: String, totpCode: String? = nil) async throws -> AuthResult {
        var body: [String: Any] = ["username": username, "password": password]
        if let totpCode, !totpCode.isEmpty { body["totpCode"] = totpCode }
        return try await postAuth("/api/auth/login", body: body)
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

    // MARK: 邮箱验证码登录/注册（无密码）

    /// 请求邮箱登录验证码（无论邮箱是否注册都成功，防枚举）。
    func requestEmailLoginCode(email: String) async throws {
        _ = try await postNoAuth("/api/auth/email/request-code", body: ["email": email])
    }

    /// 校验邮箱验证码 → 登录或注册。开了 2FA 的账号补交 totpCode（邮箱码也须二次验证）。
    func loginWithEmailCode(email: String, code: String, role: String? = nil, totpCode: String? = nil) async throws -> AuthResult {
        var body: [String: Any] = ["email": email, "code": code]
        if let role { body["role"] = role }
        if let totpCode, !totpCode.isEmpty { body["totpCode"] = totpCode }
        return try await postAuth("/api/auth/email/verify-code", body: body)
    }

    // MARK: Passkey 登录（WebAuthn）

    /// 取登录 options（返回 flowId + options JSON）。
    func passkeyLoginOptions() async throws -> (flowId: String, options: [String: Any]) {
        let data = try await postNoAuth("/api/auth/passkey/login/options", body: [:])
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let flowId = obj["flowId"] as? String,
              let options = obj["options"] as? [String: Any] else { throw APIError.decoding }
        return (flowId, options)
    }

    /// 提交登录断言 → 登录。
    func loginWithPasskey(flowId: String, response: [String: Any]) async throws -> AuthResult {
        try await postAuth("/api/auth/passkey/login/verify", body: ["flowId": flowId, "response": response])
    }

    /// 撤销 refresh token（登出，尽力而为）。
    func revokeRefresh(token: String, refreshToken: String) async {
        _ = try? await authedSend("POST", "/api/auth/logout", token: token, body: ["refreshToken": refreshToken])
    }

    private func postAuth(_ path: String, body: [String: Any]) async throws -> AuthResult {
        var req = URLRequest(url: apiURL(path))
        req.timeoutInterval = 30 // JSON 请求空闲超时：挂死的请求最多 30s 即落到可操作的 .network 错误（默认 60s 对盲人等待过久；媒体上传/下载另设更长超时）
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
        if http.statusCode == 401 {
            // 两步验证挑战不是凭据失效：透传错误码（two_factor_required / invalid_2fa），让登录流程提示输码重试；
            // 其余 401（凭据错误 / refresh 失效）仍归为 .unauthorized 由调用方分别处理。
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let code = obj["error"] as? String, code == "two_factor_required" || code == "invalid_2fa" {
                throw APIError.server(code)
            }
            throw APIError.unauthorized
        }
        if http.statusCode == 503,
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let code = obj["error"] as? String {
            throw APIError.server(code) // 503=后端明确的服务不可用信号（如 mail_unavailable/apple_login_not_configured），带码透传
        }
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
        var req = URLRequest(url: apiURL(path))
        req.timeoutInterval = 30 // JSON 请求空闲超时：挂死的请求最多 30s 即落到可操作的 .network 错误（默认 60s 对盲人等待过久；媒体上传/下载另设更长超时）
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch { throw APIError.network }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401 { throw APIError.unauthorized } // access 失效/被撤销 → 走刷新/登出（见审查 #2/#4）
        if http.statusCode == 503,
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let code = obj["error"] as? String {
            throw APIError.server(code) // 503=后端明确的服务不可用信号（如 mail_unavailable/apple_login_not_configured），带码透传
        }
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

    /// 拉取全站配置（功能开关 + 公告 + 维护）。失败由调用方按 fail-open 处理，不影响登录主流程。
    func appConfig(token: String) async throws -> RemoteAppConfig {
        let data = try await authedGet("/api/app-config", token: token)
        guard let r = try? JSONDecoder().decode(RemoteAppConfig.self, from: data) else { throw APIError.decoding }
        return r
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

    /// 进行中通话实时总览（供管理员旁观/强制结束）。
    func adminActiveCalls(token: String) async throws -> [ActiveCallInfo] {
        struct R: Codable { let calls: [ActiveCallInfo] }
        let data = try await authedGet("/api/admin/calls/active", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.calls
    }

    /// 强制结束某通话（违规处置）。
    func adminEndCall(token: String, callId: String) async throws {
        _ = try await authedSend("POST", "/api/admin/calls/\(callId)/end", token: token)
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
        var req = URLRequest(url: apiURL(path))
        req.timeoutInterval = 30 // JSON 请求空闲超时：挂死的请求最多 30s 即落到可操作的 .network 错误（默认 60s 对盲人等待过久；媒体上传/下载另设更长超时）
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
        if http.statusCode == 503,
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let code = obj["error"] as? String {
            throw APIError.server(code) // 503=后端明确的服务不可用信号（如 mail_unavailable/apple_login_not_configured），带码透传
        }
        if http.statusCode >= 500 { throw APIError.network } // 瞬时后端故障：可重试，不登出（见审查 #4）
        if http.statusCode >= 400 {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError.server((obj?["error"] as? String) ?? "HTTP \(http.statusCode)")
        }
        return data
    }

    // MARK: 保存的地点（家/公司/自定义，快捷导航）

    struct SavedPlace: Decodable, Equatable, Identifiable {
        let ownerId: String
        let label: String
        let address: String
        let lat: Double?   // WGS-84（服务端保存时 geocode 缓存）——供到达围栏"你到家了"自播报；geocode 失败/境外为 nil
        let lng: Double?
        let updatedAt: Double
        var id: String { label } // (ownerId 固定为本人) label 唯一
    }
    func savedPlaces(token: String) async throws -> [SavedPlace] {
        struct R: Decodable { let places: [SavedPlace] }
        let data = try await authedGet("/api/places", token: token)
        return try JSONDecoder().decode(R.self, from: data).places
    }
    private func placePath(_ label: String) -> String {
        "/api/places/\(label.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? label)"
    }
    func setSavedPlace(token: String, label: String, address: String) async throws {
        _ = try await authedSend("PUT", placePath(label), token: token, body: ["address": address])
    }
    func deleteSavedPlace(token: String, label: String) async throws {
        _ = try await authedSend("DELETE", placePath(label), token: token)
    }

    // MARK: 勿扰时段（Do-Not-Disturb）——只抑制软通知的推送横幅；紧急告警/来电/SOS 不受影响。

    /// 勿扰时段：分钟-of-day [0,1439] + IANA 时区。startMinute>endMinute 表跨午夜（22:00→07:00）。字段与服务端一致。
    struct QuietHours: Codable, Equatable, Sendable {
        var enabled: Bool
        var startMinute: Int
        var endMinute: Int
        var tz: String
    }
    /// 读勿扰时段设置（未设过→nil）。
    func quietHours(token: String) async throws -> QuietHours? {
        struct R: Decodable { let quietHours: QuietHours? }
        let data = try await authedGet("/api/notifications/quiet-hours", token: token)
        return try JSONDecoder().decode(R.self, from: data).quietHours
    }
    /// 存勿扰时段设置；回带服务端规范化后的值。tz 由调用方用**设备当前时区**填（TimeZone.current.identifier）。
    func setQuietHours(token: String, _ q: QuietHours) async throws -> QuietHours {
        struct R: Decodable { let quietHours: QuietHours }
        let body: [String: Any] = ["enabled": q.enabled, "startMinute": q.startMinute, "endMinute": q.endMinute, "tz": q.tz]
        let data = try await authedSend("PUT", "/api/notifications/quiet-hours", token: token, body: body)
        return try JSONDecoder().decode(R.self, from: data).quietHours
    }

    /// 按类别静音推送横幅（与勿扰时段正交：时段决定"何时静"、类别决定"哪类静"）。
    /// 危急类（紧急告警/来电/SOS/安全报到）服务端 notifCategory→null 保证**永不可静音**，不在 available 里。
    struct PushCategoriesInfo: Codable, Sendable {
        let muted: [String]
        var available: [String]?  // 服务端权威可静音类别表（旧服务端缺省→客户端内置表兜底）
    }
    func getPushCategories(token: String) async throws -> PushCategoriesInfo {
        let data = try await authedGet("/api/notifications/push-categories", token: token)
        return try JSONDecoder().decode(PushCategoriesInfo.self, from: data)
    }
    func setPushCategories(token: String, muted: [String]) async throws -> [String] {
        let data = try await authedSend("PUT", "/api/notifications/push-categories", token: token, body: ["muted": muted])
        struct R: Codable { let muted: [String] }
        return try JSONDecoder().decode(R.self, from: data).muted
    }

    // MARK: 遇险者医疗信息（施救按需查看）——仅其已接受**紧急**联系人可读；服务端会通知本人"X 查看了你的医疗信息"（GDPR Art.9 透明）。

    struct ContactMedical: Decodable, Sendable { let medicalInfo: String; let updatedAt: Double? }
    /// 查看某遇险用户的医疗信息（血型/过敏/用药，自由文本）。抛 APIError.server：
    /// "not_emergency_contact"(403，非紧急联系人/被拉黑)、"no_medical_info"(404，对方未填)。
    func contactMedicalInfo(token: String, userId: String) async throws -> ContactMedical {
        let data = try await authedGet("/api/family/\(userId)/medical", token: token)
        return try JSONDecoder().decode(ContactMedical.self, from: data)
    }

    /// 读本人医疗信息（供本人编辑）。复用 ContactMedical 形状（medicalInfo/updatedAt）。
    func myMedicalInfo(token: String) async throws -> ContactMedical {
        let data = try await authedGet("/api/account/medical", token: token)
        return try JSONDecoder().decode(ContactMedical.self, from: data)
    }
    /// 存本人医疗信息（空串=清除）。服务端 AES-256-GCM 加密落库。
    func setMyMedicalInfo(token: String, text: String) async throws {
        _ = try await authedSend("PUT", "/api/account/medical", token: token, body: ["text": text])
    }

    // MARK: 亲友 / 紧急

    func familyLinks(token: String) async throws -> [FamilyLinkInfo] {
        struct R: Codable { let links: [FamilyLinkInfo] }
        let data = try await authedGet("/api/family/links", token: token)
        let links = (try? JSONDecoder().decode(R.self, from: data))?.links ?? []
        EmergencyDialCache.update(from: links) // 无网兜底拨号缓存：每次拉到亲友列表顺手刷新（唯一数据入口）
        return links
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

    /// 按**精确**标识查人（用户名 / 邮箱 / 手机号）——用于"按邮箱或手机号添加"。查无则抛 not_found。
    func lookupUser(token: String, query: String) async throws -> AccountInfo {
        struct R: Codable { let user: AccountInfo }
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let data = try await authedGet("/api/users/lookup?q=\(q)", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.server("member_not_found") }
        return r.user
    }

    /// 按 userId 发起加好友请求（通话中加对方，或经 lookup 解析邮箱/手机号后添加）。
    func addFamilyLink(token: String, userId: String, relation: String? = nil, isEmergency: Bool = false, phone: String? = nil) async throws {
        var body: [String: Any] = ["userId": userId, "isEmergency": isEmergency]
        if let relation, !relation.isEmpty { body["relation"] = relation }
        if let phone, !phone.isEmpty { body["phone"] = phone }
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
    func unblock(token: String, id: String) async throws {
        _ = try await authedSend("DELETE", "/api/blocks/\(id)", token: token)
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
        // emergency:true → 被叫端（亲友/协助者）识别为紧急求助、突出显示+优先应答（服务端经此透传到 /api/assist/incoming）。
        _ = try await authedSend("POST", "/api/assist/call", token: token, body: ["callId": callId, "targetUserIds": targetUserIds, "emergency": true])
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
    /// 接听结果：won=抢到首接可入房；takenByOther=已被其他亲友先接；gone=呼叫已过期/取消（无人接、只是没了）。
    enum AnswerOutcome { case won, takenByOther, gone }

    /// 群呼首接抢占。网络失败按 won 处理（不阻断接听）。gone 与 takenByOther 都不入房，但措辞区分。
    func markAnswered(token: String, callId: String) async -> AnswerOutcome {
        struct R: Codable { let youWon: Bool?; let gone: Bool? }
        guard let data = try? await authedSend("POST", "/api/assist/call/answered", token: token, body: ["callId": callId]),
              let r = try? JSONDecoder().decode(R.self, from: data) else { return .won }
        if r.youWon == true { return .won }
        return r.gone == true ? .gone : .takenByOther
    }

    /// 求助前：我绑定的协助者/亲友中在线人数（online）与总数（total）。
    func onlineHelperCount(token: String) async -> (online: Int, total: Int) {
        struct R: Codable { let total: Int; let online: Int }
        guard let data = try? await authedGet("/api/assist/online-count", token: token),
              let r = try? JSONDecoder().decode(R.self, from: data) else { return (0, 0) }
        return (r.online, r.total)
    }

    /// 通话记录（呼出/呼入/未接）。
    /// 通话记录一页（服务端 createdAt 倒序，默认 100 条）。before/beforeId=向前翻页游标（"加载更早"）；
    /// 翻页请求服务端**不**刷新已看基线（翻历史≠又看过当前，防与未接角标竞态）。
    func callHistory(token: String, before: Int? = nil, beforeId: String? = nil) async throws -> CallHistoryPage {
        var path = "/api/calls"
        if let before {
            path += "?before=\(before)"
            if let beforeId { path += "&beforeId=\(beforeId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? beforeId)" }
        }
        let data = try await authedGet(path, token: token)
        return try JSONDecoder().decode(CallHistoryPage.self, from: data)
    }

    /// 通话记录页（此前 iOS 只解 {calls}、hasMore 被丢弃——只能看到头 100 条，更早的历史无入口）。
    struct CallHistoryPage: Codable, Sendable {
        let calls: [CallRecordInfo]
        var hasMore: Bool?   // 旧服务端无此字段 → nil（按无更多处理，不显"加载更早"）
        var more: Bool { hasMore == true }
        /// 下一页游标（纯逻辑可测，视图与测试共用）：取当前已载最旧一条（服务端倒序=末尾）。
        /// 空列表 → nil（无从翻页）。before 用整数毫秒（服务端 ^\d+$ 校验，Double 直接拼会带小数点被拒）。
        static func nextCursor(after calls: [CallRecordInfo]) -> (before: Int, beforeId: String)? {
            guard let oldest = calls.last else { return nil }
            return (before: Int(oldest.createdAt), beforeId: oldest.id)
        }
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
    /// 返回会被告知的亲友数：用 contacts（所有 accepted 亲友，均会收到持久化通知，含无推送 token 的
    /// web-only 协助者），而非 notified（仅实时推送数）——否则全是 web 端亲友时会误报"无人可通知"。失败返回 nil。
    /// 发紧急告警。alertId：同一次紧急事件的重试须带**同一** alertId，服务端据此幂等去重
    /// （客户端可安全重试提高送达率，亲友不会收到重复告警）。
    func postEmergencyAlert(token: String, kind: String, lat: Double?, lon: Double?, battery: Int? = nil, alertId: String) async -> Int? {
        var body: [String: Any] = ["kind": kind, "alertId": alertId]
        if let lat, let lon { body["lat"] = lat; body["lon"] = lon }
        if let battery, (0...100).contains(battery) { body["battery"] = battery } // 告警时刻电量%：亲友判断联系窗口
        guard let data = try? await authedSend("POST", "/api/emergency/alert", token: token, body: body),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj["contacts"] as? Int ?? 0
    }

    /// 报平安（all-clear）：告警发出后确认没事 → 广播给亲友解除。best-effort；alertId 关联那次告警。
    @discardableResult
    func postEmergencyAllClear(token: String, alertId: String?) async -> Bool {
        var body: [String: Any] = [:]
        if let alertId { body["alertId"] = alertId }
        return (try? await authedSend("POST", "/api/emergency/all-clear", token: token, body: body)) != nil
    }

    /// AI 场景描述（服务端 /api/vision/describe：云端视觉大模型，每日配额+10/min 限流+未配置 503 fail-closed）。
    /// remaining/dailyMax：服务端回带的当日剩余次数（付费额度，供临近上限时提醒盲人配给使用）。
    struct VisionDescribeResult: Codable, Sendable { let text: String; var remaining: Int?; var dailyMax: Int? }
    /// 图像问答的一轮（追问对话上下文）：用户问 q、模型答 a。与服务端 history 契约一致。
    struct VqaTurn: Codable, Sendable, Equatable { let q: String; let a: String }
    /// history=同一张图的**追问历史**（连续图像问答，对标 Be My AI）；无=单轮。
    func visionDescribe(token: String, jpegBase64: String, question: String? = nil, history: [VqaTurn]? = nil, lang: String) async throws -> VisionDescribeResult {
        var body: [String: Any] = ["image": jpegBase64, "mime": "image/jpeg", "lang": lang]
        if let question, !question.isEmpty { body["question"] = question }
        if let history, !history.isEmpty { body["history"] = history.map { ["q": $0.q, "a": $0.a] } }
        let data = try await authedSend("POST", "/api/vision/describe", token: token, body: body)
        return try JSONDecoder().decode(VisionDescribeResult.self, from: data)
    }

    /// 图像问答的**多轮对话状态**（纯逻辑，可单测）：按图片 key 归属对话——换图(key 变)即重置，同图追问带历史。
    /// 盲人对收到的图片连续追问（"这是什么"→"多少钱"→"保质期到哪"），对标 Be My AI；泛描述轮记默认问句供后续追问有上下文。
    struct VqaConversation: Equatable {
        private(set) var turns: [VqaTurn] = []
        private(set) var key: String?
        /// 开始一轮提问：换了图片(key 变)则先重置对话；返回应作为 history 发送的已有轮（空数组=单轮，调用方转 nil）。
        mutating func historyForNewQuestion(imageKey: String) -> [VqaTurn] {
            if key != imageKey { turns = []; key = imageKey }
            return turns
        }
        /// 上游**成功**后记录一轮（只记成功轮，失败不入对话）：泛描述(question 空)记 defaultQuestion 供后续追问上下文。
        mutating func record(question: String?, answer: String, defaultQuestion: String) {
            let q = (question?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 } ?? defaultQuestion
            turns.append(VqaTurn(q: q, a: answer))
        }
    }

    /// 响应者回执 SOS 告警：onMyWay=true「我在赶来」（更强安心信号）/ false「我已看到」（纯 ack）。
    /// 两者都让遇险者知道"有人在响应"并停止服务端升级重呼；服务端幂等去重（同状态 5 分钟内只回告一次）。
    /// 与网页通知列表/告警横幅同一后端流程（POST /api/emergency/ack）。best-effort：失败返回 false 供 UI 提示重试。
    @discardableResult
    func postEmergencyAck(token: String, fromId: String, eventId: String?, onMyWay: Bool) async -> Bool {
        var body: [String: Any] = ["fromId": fromId, "onMyWay": onMyWay]
        if let eventId { body["eventId"] = eventId }
        return (try? await authedSend("POST", "/api/emergency/ack", token: token, body: body)) != nil
    }

    // MARK: 聊天（绑定亲友/协助者互发）

    func sendMessage(token: String, toId: String, kind: String, text: String, replyTo: String? = nil, forwarded: Bool = false) async throws -> ChatMessageInfo {
        var body: [String: Any] = ["toId": toId, "kind": kind, "text": text]
        if let replyTo { body["replyTo"] = replyTo }
        if forwarded { body["forwarded"] = true } // 转发标记：收端显「已转发」（防误信非原创内容）
        let data = try await authedSend("POST", "/api/messages", token: token, body: body)
        struct R: Codable { let message: ChatMessageInfo }
        return try JSONDecoder().decode(R.self, from: data).message
    }

    func messages(token: String, with peerId: String, before: Int? = nil, beforeId: String? = nil) async throws -> ChatThreadInfo {
        var path = "/api/messages?with=\(peerId)&limit=50"
        if let before { path += "&before=\(before)" }
        if let beforeId { path += "&beforeId=\(beforeId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? beforeId)" }
        let data = try await authedGet(path, token: token)
        return try JSONDecoder().decode(ChatThreadInfo.self, from: data)
    }

    /// 置顶一条消息（每会话至多一条，新置顶取代旧）。服务端会通知其余参与者；返回最新置顶。
    func pinMessage(token: String, id: String) async throws -> PinnedMessageInfo? {
        let data = try await authedSend("POST", "/api/messages/\(id)/pin", token: token, body: [:])
        struct R: Codable { let pinned: PinnedMessageInfo? }
        return try JSONDecoder().decode(R.self, from: data).pinned
    }

    /// 取消该会话置顶。返回最新置顶（正常为 nil）。
    /// 复审 HIGH：服务端 DELETE 成功回 **204 空体**——对空体跑 JSONDecoder 恒抛 dataCorrupted，
    /// 曾把每次成功取消都报成"置顶操作失败"。经 parsePinResponse（纯函数已测）空体=无置顶。
    func unpinMessage(token: String, id: String) async throws -> PinnedMessageInfo? {
        let data = try await authedSend("DELETE", "/api/messages/\(id)/pin", token: token, body: [:])
        return Self.parsePinResponse(data)
    }

    /// 置顶响应解析（纯函数可测）：204 空体/无 pinned 字段 → nil（无置顶）；有 → 解出。
    nonisolated static func parsePinResponse(_ data: Data) -> PinnedMessageInfo? {
        guard !data.isEmpty else { return nil }
        struct R: Codable { let pinned: PinnedMessageInfo? }
        return (try? JSONDecoder().decode(R.self, from: data))?.pinned
    }

    func conversations(token: String) async throws -> [ConversationInfo] {
        let data = try await authedGet("/api/conversations", token: token)
        struct R: Codable { let conversations: [ConversationInfo] }
        return try JSONDecoder().decode(R.self, from: data).conversations
    }

    /// 商品条码在线查询结果：名字 + 包装标注过敏原（allergens=确定含有）+ 微量/交叉污染标注（traces=可能含微量）
    /// + 营养质量（nutriScore=Nutri-Score a..e / novaGroup=NOVA 加工程度 1..4，服务端已白名单过滤，缺省=无数据）。
    /// 两者语义不同、分开播报；空/缺省=无数据（缺数据≠不含）。
    struct ProductLookupInfo: Codable {
        let name: String
        let allergens: [String]?
        let traces: [String]?
        let nutriScore: String?
        let novaGroup: Int?
        let dietaryLabels: [String]? // 膳食/宗教认证标注（无麸质/纯素/清真…）——盲人看不到包装认证，刚需
        let quantity: String?        // 净含量/规格（"500 ml"/"200 g"）——盲人看不到包装规格，判份量/选对大小
        let nutrientLevels: [String: String]? // 逐营养素含量档（fat/saturated-fat/sugars/salt→low|moderate|high）——只警示 high（糖/盐/脂偏高），对标 Yuka
        let ingredients: String?     // 配料表原文（"生牛乳、白砂糖、食品添加剂…"）——盲人**读不到配料表**，查素食/忌口成分/"这是什么做的"的核心刚需，过敏原标注覆盖不了的具体成分靠它；空/缺省=无数据
        let energyKcal100g: Int?     // 热量（每 100 克/毫升千卡）——盲人读不到卡路里，而数卡/控糖控重(减肥/糖尿病)正需这个绝对值；nil/缺省=无数据
    }

    /// 商品条码 → 商品名+标注过敏原（服务端代理 Open Food Facts）。查不到/离线/任何错误一律 nil（上层回退"用户起名"，绝不编造）。
    func lookupProduct(token: String, barcode: String) async -> ProductLookupInfo? {
        guard let data = try? await authedGet("/api/product/\(barcode)", token: token) else { return nil }
        return try? JSONDecoder().decode(ProductLookupInfo.self, from: data)
    }

    func markMessagesRead(token: String, fromId: String) async {
        _ = try? await authedSend("POST", "/api/messages/read", token: token, body: ["fromId": fromId])
    }

    /// 撤回自己的消息（2 分钟内）。返回更新后的消息（recalled 占位），失败 nil。
    /// 撤回：**抛错**而非吞成 nil——撤回失败的真因（时限过/功能关停/维护/限流）须上抛给调用方区分并**朗读**给盲人
    /// （盲人看不到红字横幅；恒显"是不是超时了"会诱使其对注定失败的撤回反复重试，见 ChatStrings.recallErrorText）。
    func recallMessage(token: String, id: String) async throws -> ChatMessageInfo {
        let data = try await authedSend("POST", "/api/messages/\(id)/recall", token: token, body: [:])
        struct R: Codable { let message: ChatMessageInfo }
        return try JSONDecoder().decode(R.self, from: data).message
    }

    /// 编辑已发文字消息（仅本人、仅文字、15 分钟内；服务端同门控）。返回更新后的消息（带 editedAt）。同 web /messages/:id/edit。
    func editMessage(token: String, id: String, text: String) async throws -> ChatMessageInfo {
        let data = try await authedSend("POST", "/api/messages/\(id)/edit", token: token, body: ["text": text])
        struct R: Codable { let message: ChatMessageInfo }
        return try JSONDecoder().decode(R.self, from: data).message
    }

    /// 表情回应（空字符串=取消）。返回更新后的消息，失败 nil。
    func reactMessage(token: String, id: String, emoji: String) async -> ChatMessageInfo? {
        guard let data = try? await authedSend("POST", "/api/messages/\(id)/reaction", token: token, body: ["emoji": emoji]) else { return nil }
        struct R: Codable { let message: ChatMessageInfo }
        return try? JSONDecoder().decode(R.self, from: data).message
    }
    /// 单聊/群聊免打扰（静音只压推送横幅，站内通知与未读数照旧；与 web muteConversation/muteGroup 同端点）。
    func muteConversation(token: String, peerId: String, muted: Bool) async throws {
        _ = try await authedSend("POST", "/api/conversations/\(peerId)/mute", token: token, body: ["muted": muted])
    }
    func muteGroup(token: String, groupId: String, muted: Bool) async throws {
        _ = try await authedSend("POST", "/api/groups/\(groupId)/mute", token: token, body: ["muted": muted])
    }

    // MARK: 安全报到（dead-man's switch）——与服务端 /api/safety/checkin 契约一致。
    /// 当前进行中的报到（无则 nil）。
    func safetyCheckin(token: String) async throws -> SafetyTimer? {
        let data = try await authedGet("/api/safety/checkin", token: token)
        struct R: Codable { let timer: SafetyTimer? }
        return try JSONDecoder().decode(R.self, from: data).timer
    }
    /// 开始报到：durationMinutes(5–1440) + 可选备注（到期告警正文念给亲友）。
    func startSafetyCheckin(token: String, durationMinutes: Int, note: String?) async throws -> SafetyTimer {
        var body: [String: Any] = ["durationMinutes": durationMinutes]
        if let note, !note.isEmpty { body["note"] = note }
        let data = try await authedSend("POST", "/api/safety/checkin/start", token: token, body: body)
        struct R: Codable { let timer: SafetyTimer }
        return try JSONDecoder().decode(R.self, from: data).timer
    }
    /// 报平安（我平安到了）：结束进行中的报到；若已到期告警则等价 all-clear（服务端解除+广播）。
    /// 返回服务端 completed——false=当前没有进行中的报到（幂等 no-op），语音路径据此如实告知而非假装已报。
    @discardableResult
    func completeSafetyCheckin(token: String) async throws -> Bool {
        let data = try await authedSend("POST", "/api/safety/checkin/complete", token: token, body: [:])
        struct R: Codable { let completed: Bool? }
        return (try? JSONDecoder().decode(R.self, from: data))?.completed ?? true // 无字段兜底按已完成（保守不误报"没有报到"）
    }
    /// 延长报到（addMinutes，5–1440）。
    func extendSafetyCheckin(token: String, addMinutes: Int) async throws -> SafetyTimer {
        let data = try await authedSend("POST", "/api/safety/checkin/extend", token: token, body: ["addMinutes": addMinutes])
        struct R: Codable { let timer: SafetyTimer }
        return try JSONDecoder().decode(R.self, from: data).timer
    }
    /// 取消报到（不再计时、不告警）。
    func cancelSafetyCheckin(token: String) async throws {
        _ = try await authedSend("POST", "/api/safety/checkin/cancel", token: token, body: [:])
    }
    /// 每日报到日程：每天固定时刻自动开始一次报到（独居日常安全网）。null=从未配置。
    func getCheckinSchedule(token: String) async throws -> DailyCheckinSchedule? {
        let data = try await authedGet("/api/safety/checkin/schedule", token: token)
        struct R: Codable { let schedule: DailyCheckinSchedule? }
        return try JSONDecoder().decode(R.self, from: data).schedule
    }
    /// 保存每日报到日程。pausedUntil：未来时刻(ms)=暂停至该时刻自动恢复；0/nil=不暂停。
    /// 注意：改时间/时长/备注时须**回传当前 pausedUntil**，否则会静默清掉生效中的暂停（与网页同教训）。
    func setCheckinSchedule(token: String, enabled: Bool, startMinute: Int, durationMinutes: Int,
                            tz: String, note: String?, pausedUntil: Double?) async throws -> DailyCheckinSchedule {
        var body: [String: Any] = ["enabled": enabled, "startMinute": startMinute,
                                   "durationMinutes": durationMinutes, "tz": tz]
        if let note, !note.isEmpty { body["note"] = note }
        // 复审 HIGH：服务端 z.number().int() 拒绝带小数的毫秒（Date().timeIntervalSince1970*1000 必带
        // 亚毫秒尾数）——曾让"暂停 7/30 天"每次都 400。取整为 Int 再入 JSON。
        if let pausedUntil { body["pausedUntil"] = Int(pausedUntil.rounded()) }
        let data = try await authedSend("PUT", "/api/safety/checkin/schedule", token: token, body: body)
        struct R: Codable { let schedule: DailyCheckinSchedule }
        return try JSONDecoder().decode(R.self, from: data).schedule
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
    func groupMessages(token: String, groupId: String, before: Int? = nil, beforeId: String? = nil) async throws -> ChatThreadInfo {
        var path = "/api/messages?group=\(groupId)&limit=50"
        if let before { path += "&before=\(before)" }
        if let beforeId { path += "&beforeId=\(beforeId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? beforeId)" }
        let data = try await authedGet(path, token: token)
        return try JSONDecoder().decode(ChatThreadInfo.self, from: data)
    }

    /// 会话内搜索文本消息（时间倒序）。peerId 或 groupId 二选一；空查询后端返回空。
    func searchMessages(token: String, peerId: String? = nil, groupId: String? = nil, query: String) async throws -> [ChatMessageInfo] {
        // 作用域经 ChatSearch.scopeQuery（已测）：群/单聊/nil=全局（服务端搜本人全部单聊+所在群）。
        let scope = ChatSearch.scopeQuery(peerId: peerId, groupId: groupId)
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let data = try await authedGet("/api/messages/search?\(scope.map { $0 + "&" } ?? "")q=\(q)", token: token)
        struct R: Codable { let messages: [ChatMessageInfo] }
        return try JSONDecoder().decode(R.self, from: data).messages
    }

    /// 发群消息。
    func sendGroupMessage(token: String, groupId: String, kind: String, text: String, replyTo: String? = nil, forwarded: Bool = false) async throws -> ChatMessageInfo {
        var body: [String: Any] = ["groupId": groupId, "kind": kind, "text": text]
        if let replyTo { body["replyTo"] = replyTo }
        if forwarded { body["forwarded"] = true }
        let data = try await authedSend("POST", "/api/messages", token: token, body: body)
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
        req.timeoutInterval = 180 // 大视频上传：明确超时，断网时不无限挂起
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

    // MARK: 账号标识换绑（用户名 / 手机号 / Apple ID）

    /// 选择/更改身份角色（新账号引导统一在认证后选择；仅 blind/helper/family 自助切换）。
    func setRole(token: String, role: String) async throws {
        _ = try await authedSend("POST", "/api/account/role", token: token, body: ["role": role])
    }

    /// 记录用户对《隐私政策》《使用条款》的同意（注册门控 + GDPR 可证明同意）。
    func recordLegalConsent(token: String, version: String) async throws {
        _ = try await authedSend("POST", "/api/account/legal-consent", token: token, body: ["version": version])
    }

    /// 路线库：一条保存的路线（亲友替我画的或我自存的；坐标 WGS-84）。
    struct SavedRouteInfo: Codable, Sendable, Identifiable {
        let id: String
        let name: String
        var waypoints: [RouteWaypoint]
        let role: String      // owner=我的路线（可执行） / creator=我替别人画的
        var createdByName: String?  // 创建者显示名（亲友画的）；自存路线为 nil。信任透明：盲人须知"这条谁画的"
        let updatedAt: Double
    }
    struct RouteWaypoint: Codable, Sendable { let lat: Double; let lng: Double; var note: String? }

    /// 拉取路线库（我的 + 我替别人画的，服务端 updatedAt 倒序）。
    func listSavedRoutes(token: String) async throws -> [SavedRouteInfo] {
        struct R: Codable { let routes: [SavedRouteInfo] }
        let data = try await authedGet("/api/routes", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.routes
    }

    /// 确认协助者行为守则（只描述、不替对方做安全决策）：服务端留痕，keep-first 幂等。
    func ackHelperGuideline(token: String) async throws {
        _ = try await authedSend("POST", "/api/assist/guideline-ack", token: token, body: [:])
    }

    /// 修改/设置用户名（唯一登录标识；用于自定义 userid）。
    func setUsername(token: String, username: String) async throws {
        _ = try await authedSend("POST", "/api/account/username", token: token, body: ["username": username])
    }

    /// 绑定/换绑手机号（手机号+密码登录标识）。
    func setPhone(token: String, phone: String) async throws {
        _ = try await authedSend("POST", "/api/account/phone", token: token, body: ["phone": phone])
    }

    /// 绑定/换绑 Apple ID 到当前账号。
    func linkApple(token: String, identityToken: String) async throws {
        _ = try await authedSend("POST", "/api/account/apple", token: token, body: ["identityToken": identityToken])
    }

    /// 解绑 Apple ID（仅在保留其它登录方式时允许）。
    func unlinkApple(token: String) async throws {
        _ = try await authedSend("DELETE", "/api/account/apple", token: token)
    }

    // MARK: Passkey 注册/管理（WebAuthn）

    /// 取注册 options（交给系统创建凭据）。
    func passkeyRegisterOptions(token: String) async throws -> [String: Any] {
        let data = try await authedSend("POST", "/api/auth/passkey/register/options", token: token, body: [:])
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw APIError.decoding }
        return obj
    }

    /// 提交注册结果（response 为系统生成的凭据 JSON）。
    func passkeyRegisterVerify(token: String, response: [String: Any], deviceName: String?) async throws {
        var body: [String: Any] = ["response": response]
        if let deviceName, !deviceName.isEmpty { body["deviceName"] = deviceName }
        _ = try await authedSend("POST", "/api/auth/passkey/register/verify", token: token, body: body)
    }

    /// 列出我的 passkey。
    func passkeys(token: String) async throws -> [PasskeyInfo] {
        struct R: Codable { let passkeys: [PasskeyInfo] }
        let data = try await authedGet("/api/auth/passkey/list", token: token)
        return (try? JSONDecoder().decode(R.self, from: data))?.passkeys ?? []
    }

    /// 删除一把 passkey。
    func deletePasskey(token: String, id: String) async throws {
        _ = try await authedSend("DELETE", "/api/auth/passkey/\(id)", token: token)
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
        var req = URLRequest(url: apiURL(path))
        req.timeoutInterval = 30 // JSON 请求空闲超时：挂死的请求最多 30s 即落到可操作的 .network 错误（默认 60s 对盲人等待过久；媒体上传/下载另设更长超时）
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch { throw APIError.network }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 503,
           let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let code = obj["error"] as? String {
            throw APIError.server(code) // 503=后端明确的服务不可用信号（如 mail_unavailable/apple_login_not_configured），带码透传
        }
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
    /// 自助数据导出（GDPR 可携权）：返回服务端整装 JSON（web 端同一端点）。
    func exportMyData(token: String) async throws -> Data {
        try await authedGet("/api/account/export", token: token)
    }

    func deleteAccount(token: String) async throws {
        _ = try await authedSend("DELETE", "/api/account", token: token)
    }

    // MARK: 两步验证（2FA / TOTP）

    func twoFactorStatus(token: String) async throws -> TwoFAStatus {
        let data = try await authedGet("/api/account/2fa", token: token)
        guard let r = try? JSONDecoder().decode(TwoFAStatus.self, from: data) else { throw APIError.decoding }
        return r
    }
    /// 开始绑定：生成待启用密钥（返回密钥 + otpauth URI）。
    func twoFactorSetup(token: String) async throws -> TwoFASetup {
        let data = try await authedSend("POST", "/api/account/2fa/setup", token: token)
        guard let r = try? JSONDecoder().decode(TwoFASetup.self, from: data) else { throw APIError.decoding }
        return r
    }
    /// 确认启用：验码 → 返回一次性恢复码（只此一次）。
    func twoFactorEnable(token: String, code: String) async throws -> [String] {
        let data = try await authedSend("POST", "/api/account/2fa/enable", token: token, body: ["code": code])
        guard let r = try? JSONDecoder().decode(TwoFACodesResult.self, from: data) else { throw APIError.decoding }
        return r.recoveryCodes
    }
    /// 关闭 2FA（须再次验证本人：TOTP 或恢复码）。
    func twoFactorDisable(token: String, code: String) async throws {
        _ = try await authedSend("POST", "/api/account/2fa/disable", token: token, body: ["code": code])
    }
    /// 重新生成恢复码（旧码作废；须再次验证本人）。
    func twoFactorRegenerateRecovery(token: String, code: String) async throws -> [String] {
        let data = try await authedSend("POST", "/api/account/2fa/recovery-codes", token: token, body: ["code": code])
        guard let r = try? JSONDecoder().decode(TwoFACodesResult.self, from: data) else { throw APIError.decoding }
        return r.recoveryCodes
    }

    // MARK: 登录设备 / 会话管理

    func sessions(token: String) async throws -> [SessionInfo] {
        let data = try await authedGet("/api/account/sessions", token: token)
        guard let r = try? JSONDecoder().decode(SessionsResult.self, from: data) else { throw APIError.decoding }
        return r.sessions
    }
    /// 远程登出某台设备。
    func revokeSession(token: String, sessionId: String) async throws {
        _ = try await authedSend("POST", "/api/account/sessions/revoke", token: token, body: ["sessionId": sessionId])
    }
    /// 登出其它所有设备（保留当前这台）。
    func revokeOtherSessions(token: String) async throws {
        _ = try await authedSend("POST", "/api/account/sessions/revoke-others", token: token)
    }

    // MARK: 实名认证（KYC）

    /// 当前实名状态（不含任何 PII）。
    func verificationStatus(token: String) async throws -> VerificationStatusInfo {
        let data = try await authedGet("/api/account/verification", token: token)
        guard let r = try? JSONDecoder().decode(VerificationStatusInfo.self, from: data) else { throw APIError.decoding }
        return r
    }
    /// 发起一次实名提交（封存姓名/证件号），返回 verification id 供逐张上传证件。
    func submitVerification(token: String, legalName: String, idType: String, idNumberLast4: String, idNumber: String?, consentVersion: String) async throws -> String {
        var body: [String: Any] = ["legalName": legalName, "idType": idType, "idNumberLast4": idNumberLast4, "consentVersion": consentVersion]
        if let idNumber, !idNumber.isEmpty { body["idNumber"] = idNumber }
        let data = try await authedSend("POST", "/api/account/verification", token: token, body: body)
        guard let r = try? JSONDecoder().decode(VerificationSubmitResult.self, from: data) else { throw APIError.decoding }
        return r.id
    }
    /// 上传一张证件图（原始 JPEG 二进制；服务端再嗅探/剥 EXIF/加密落隔离盘）。kind: front|back|selfie。
    func uploadVerificationDoc(token: String, id: String, kind: String, jpeg: Data) async throws {
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/account/verification/\(id)/doc/\(kind)"))
        req.httpMethod = "POST"
        req.timeoutInterval = 120
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        let (data, resp): (Data, URLResponse)
        do { (data, resp) = try await URLSession.shared.upload(for: req, from: jpeg) } catch { throw APIError.network }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401 { throw APIError.unauthorized }
        if http.statusCode >= 400 {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            throw APIError.server((obj?["error"] as? String) ?? "HTTP \(http.statusCode)")
        }
    }
    /// 撤回一份待审核的提交。
    func withdrawVerification(token: String) async throws {
        _ = try await authedSend("DELETE", "/api/account/verification", token: token)
    }

    /// 通话中/后举报对方（信任与安全）。
    func submitReport(token: String, targetUserId: String, callId: String?, reason: String, evidenceRecordingId: String? = nil) async throws {
        var body: [String: Any] = ["targetUserId": targetUserId, "reason": reason]
        if let callId { body["callId"] = callId }
        if let evidenceRecordingId { body["evidenceRecordingId"] = evidenceRecordingId }
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

    /// 通话内登记一条录制（先经 uploadMedia 拿到 mediaId）。consentBy 由**服务端**据同意登记表权威判定，
    /// 客户端不再自报，杜绝伪造对端同意。返回新建录制的 id（供"附为举报证据"引用）。
    /// 可附详细元数据：时长（秒）、位置（已授权时）——"时间地点人"中的"地"和"时长"。
    @discardableResult
    func createRecording(token: String, callId: String, reason: String, mediaId: String?,
                         durationSec: Int? = nil, lat: Double? = nil, lon: Double? = nil, locationLabel: String? = nil) async throws -> String? {
        var body: [String: Any] = ["callId": callId, "reason": reason]
        if let mediaId { body["mediaId"] = mediaId }
        if let durationSec { body["durationSec"] = durationSec }
        if let lat { body["lat"] = lat }
        if let lon { body["lon"] = lon }
        if let locationLabel { body["locationLabel"] = locationLabel }
        let data = try await authedSend("POST", "/api/recordings", token: token, body: body)
        struct R: Codable { struct Rec: Codable { let id: String }; let recording: Rec }
        return (try? JSONDecoder().decode(R.self, from: data))?.recording.id
    }

    /// 被录方授予/撤回录制同意（服务端权威）：在 RecordingConsentView 选择后调用。
    func grantRecordingConsent(token: String, callId: String, granted: Bool) async throws {
        _ = try await authedSend("POST", "/api/recordings/consent", token: token, body: ["callId": callId, "granted": granted])
    }

    // MARK: 录制回看（用户端"我的录音" + 管理员总览）

    /// 我的录音（仅本人作为录制者、未被本人删除的）。
    func myRecordings(token: String) async throws -> [RecordingInfo] {
        struct R: Codable { let recordings: [RecordingInfo] }
        let data = try await authedGet("/api/recordings/mine", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.recordings
    }

    /// 管理员录制总览（含用户已软删除项，留存期内仍可查看）。
    func adminRecordings(token: String) async throws -> [RecordingInfo] {
        struct R: Codable { let recordings: [RecordingInfo] }
        let data = try await authedGet("/api/recordings", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return r.recordings
    }

    /// 用户软删除自己的录制（对其隐藏；管理员在留存期内仍可查看）。
    func deleteMyRecording(token: String, id: String) async throws {
        _ = try await authedSend("DELETE", "/api/recordings/mine/\(id)", token: token)
    }

    /// 清除本地缓存的录制文件（删除后调用，兑现"删除"意图，不留本机残留）。
    func evictCachedRecording(id: String) {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("recording-\(id).mov")
        try? FileManager.default.removeItem(at: url)
    }

    /// 管理员彻底删除一条录制（含媒体文件，真删）。
    func adminDeleteRecording(token: String, id: String) async throws {
        _ = try await authedSend("DELETE", "/api/recordings/\(id)", token: token)
    }

    /// 下载录制媒体到本地临时文件（按 id 缓存）。走录制作用域端点（参与者/管理员授权），用 .mov 扩展名（ReplayKit 输出）。
    func downloadRecording(token: String, id: String) async throws -> URL {
        let cached = FileManager.default.temporaryDirectory.appendingPathComponent("recording-\(id).mov")
        if FileManager.default.fileExists(atPath: cached.path) { return cached }
        var req = URLRequest(url: baseURL.appendingPathComponent("/api/recordings/\(id)/media"))
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (tmp, resp): (URL, URLResponse)
        do { (tmp, resp) = try await URLSession.shared.download(for: req) } catch { throw APIError.network }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard http.statusCode < 400 else { throw APIError.network }
        try? FileManager.default.removeItem(at: cached)
        try FileManager.default.moveItem(at: tmp, to: cached)
        return cached
    }

    // MARK: 站内通知

    func getNotifications(token: String) async throws -> (items: [NotificationInfo], unread: Int) {
        struct R: Codable { let notifications: [NotificationInfo]; let unread: Int }
        let data = try await authedGet("/api/notifications", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return (r.notifications, r.unread)
    }

    /// 未读汇总（单聊+群聊+铃铛通知）：一次轻量拉取，供应用内角标与 App 图标角标同步。
    struct UnreadSummary: Codable {
        let messages: Int; let notifications: Int; let total: Int
        var missedCalls: Int?  // 未看的未接来电数（total 已并入；此前 Codable 静默丢弃 → 应用内无独立未接指示）
        /// 通话记录入口角标数（视图与测试共用；坏值/缺省→0 不显）。
        var missedCallBadgeCount: Int { max(0, missedCalls ?? 0) }
    }
    func unreadSummary(token: String) async throws -> UnreadSummary {
        let data = try await authedGet("/api/unread", token: token)
        guard let r = try? JSONDecoder().decode(UnreadSummary.self, from: data) else { throw APIError.decoding }
        return r
    }

    func markNotificationRead(token: String, id: String) async throws {
        _ = try await authedSend("POST", "/api/notifications/\(id)/read", token: token)
    }

    func markAllNotificationsRead(token: String) async throws {
        _ = try await authedSend("POST", "/api/notifications/read-all", token: token)
    }

    // MARK: 实时位置共享（与亲友/协助者互相可见；服务端纯内存、按已接受绑定授权）

    /// 上报当前位置 + （重）激活共享。返回本次共享截止时刻（毫秒）。
    @discardableResult
    func updateLocation(token: String, lat: Double, lng: Double, accuracy: Double?, heading: Double?, battery: Int? = nil, ttlSec: Int? = nil) async throws -> Double {
        var body: [String: Any] = ["lat": lat, "lng": lng]
        if let accuracy, accuracy.isFinite, accuracy >= 0 { body["accuracy"] = accuracy }
        if let heading, heading.isFinite, heading >= 0, heading <= 360 { body["heading"] = heading }
        if let battery, (0...100).contains(battery) { body["battery"] = battery } // 电量%（越界/未知不带，服务端 schema 同界）
        if let ttlSec { body["ttlSec"] = ttlSec }
        let data = try await authedSend("POST", "/api/locations/update", token: token, body: body)
        struct R: Codable { let sharingUntil: Double }
        return (try? JSONDecoder().decode(R.self, from: data))?.sharingUntil ?? 0
    }

    /// 立即停止共享自己的位置。
    func stopSharingLocation(token: String) async throws {
        _ = try await authedSend("POST", "/api/locations/stop", token: token)
    }

    /// 拉取：我的共享状态 + 正在共享的联系人当前位置。
    func contactLocations(token: String) async throws -> (sharing: Bool, sharingUntil: Double, contacts: [ContactLocationInfo]) {
        struct R: Codable { let sharing: Bool; let sharingUntil: Double; let contacts: [ContactLocationInfo] }
        let data = try await authedGet("/api/locations/contacts", token: token)
        guard let r = try? JSONDecoder().decode(R.self, from: data) else { throw APIError.decoding }
        return (r.sharing, r.sharingUntil, r.contacts)
    }

    /// 逆地理编码某共享位置联系人的当前位置为可读地址（GET /api/locations/address）。坐标由服务端用其**权威**共享
    /// 位置（不传坐标），授权=可见其共享。盲人看不到地图，据此**听到**家人在哪条街/哪片区域。查不到/境外/任何错误 → nil
    /// （上层显式提示"暂查不到"，绝不编造地址）。仅境内高德有数据。
    func contactAddress(token: String, userId: String) async -> ContactAddressInfo? {
        guard let q = userId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return nil }
        guard let data = try? await authedGet("/api/locations/address?userId=\(q)", token: token) else { return nil }
        return try? JSONDecoder().decode(ContactAddressInfo.self, from: data)
    }
}

/// 联系人当前位置的可读地址（GET /api/locations/address；仅境内高德有数据）。landmark/intersection 等额外字段忽略。
struct ContactAddressInfo: Codable {
    let address: String
    let township: String
    let aoi: AOI?
    struct AOI: Codable { let name: String }
}

/// 正在共享位置的联系人（来自 GET /api/locations/contacts）。
struct ContactLocationInfo: Codable, Identifiable {
    let userId: String
    let displayName: String
    let avatar: String?
    let role: String
    let lat: Double
    let lng: Double
    let accuracy: Double?
    let heading: Double?
    let battery: Int?   // 对端手机电量%（0–100；老客户端不上报为 nil）——失联前主动联系的信号
    let updatedAt: Double
    var id: String { userId }
}
