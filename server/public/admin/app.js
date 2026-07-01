/* BeeUrEi Admin — vanilla SPA, zero runtime deps. Talks to the same-origin API with a Bearer token. */
'use strict';

// ---------------------------------------------------------------- state
const LS = { token: 'beeurei.admin.token', user: 'beeurei.admin.user', lang: 'beeurei.admin.lang', theme: 'beeurei.admin.theme' };
const state = {
  token: localStorage.getItem(LS.token) || null,
  user: safeParse(localStorage.getItem(LS.user)),
  lang: localStorage.getItem(LS.lang) || (navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh',
  theme: localStorage.getItem(LS.theme) || 'auto',
  overview: null,
  users: [],
  reports: [],
  recordings: [],
  recConfig: null,
  links: [],
  calls: [],
  blocks: [],
  audit: [],
  live: [], liveTimer: null, liveNow: 0,
  appConfig: null,
  usersQuery: '', usersRole: 'all', usersStatus: 'all',
  usersSort: 'created_desc', usersOffset: 0, usersLimit: 50, usersTotal: 0,
  usersSelected: new Set(), usersSearchTimer: null,
  linksQuery: '', callsQuery: '', blocksQuery: '',
  refreshTimer: null,
};
// fix lang init (ternary precedence above): recompute cleanly
state.lang = localStorage.getItem(LS.lang) || ((navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'zh');

function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

// ---------------------------------------------------------------- i18n
const I18N = {
  zh: {
    appName: 'BeeUrEi 管理后台', console: '后台', signInTitle: '管理员登录', signInSub: '请用管理员账号登录后台',
    username: '用户名 / 手机号 / 邮箱', password: '密码', signIn: '登录', signingIn: '登录中…',
    notAdmin: '该账号不是管理员，无权访问后台。', loginFailed: '登录失败，请检查账号密码。',
    dashboard: '总览', users: '用户', reports: '举报', recordings: '录制', logout: '退出登录',
    totalUsers: '用户总数', active: '正常', disabled: '已封禁', online: '在线', onlineHelpers: '在线协助者',
    openReports: '待处理举报', recordingsCount: '录制记录', byRole: '按角色分布', version: '版本', uptime: '运行时长',
    refresh: '刷新', search: '搜索用户名 / 昵称…', allRoles: '全部角色', allStatus: '全部状态',
    role: '角色', status: '状态', created: '注册时间', actions: '操作', lastActive: '在线',
    ban: '封禁', unban: '解封', changeRole: '角色', confirmBan: '确认封禁该用户？封禁后其令牌立即失效、无法登录。',
    confirmUnban: '确认解封该用户？', confirmRole: '确认把该用户的角色改为「%s」？',
    banned: '已封禁', unbanned: '已解封', roleChanged: '角色已更新', noUsers: '没有匹配的用户',
    resolve: '标记已处理', open: '待处理', resolved: '已处理', reportResolved: '举报已处理', noReports: '暂无举报',
    reporter: '举报人', target: '被举报', reason: '原因',
    recPolicy: '录制策略', allowRecording: '允许录制', allowRecordingDesc: '全局开关：关闭时任何端都无法发起录制。',
    requireConsent: '录制需各方同意', requireConsentDesc: '开启后，录制必须取得被录制方的明确同意。',
    retentionDays: '保留天数', retentionDesc: '到期自动删除录制元数据。', days: '天', save: '保存', saved: '已保存',
    recList: '录制记录', deleteRec: '删除', confirmDeleteRec: '确认彻底删除这条录制（含媒体文件，不可恢复）？', noRecordings: '暂无录制记录',
    playRec: '播放', recParticipants: '参与者', recDuration: '时长', recLocation: '地点', recUserDeleted: '用户已删除·留存中', recNoMedia: '媒体不可用', playFailed: '无法播放该录制', closeBtn: '关闭',
    evidence: '附带录制证据', viewEvidence: '查看证据录制',
    idReview: '实名审核', idQueue: '待审核', idStatusAll: '全部', idStatusPending: '待审核', idStatusVerified: '已通过', idStatusRejected: '已拒绝',
    idApplicant: '申请人', idDocType: '证件类型', idSubmittedVia: '提交方式', idAttempt: '次数', idSubmittedAt: '提交时间', idDecidedAt: '审核时间', idDecidedBy: '审核人',
    idViaSelf: '本人', idViaAssisted: '亲友协助', noVerifications: '暂无实名申请',
    idReview1: '审核：核对证件与自拍', idLegalName: '证件姓名', idNumber: '证件号', idLast4: '尾号', idDocFront: '证件正面', idDocBack: '证件反面', idSelfie: '自拍',
    idCompareHint: '请核对：① 填写姓名与证件是否一致；② 证件是否真实/未过期/未篡改；③ 自拍与证件是否同一人；④ 证件是否清晰可读。',
    idChkName: '姓名与证件一致', idChkValid: '证件真实·未过期·未篡改', idChkFace: '自拍与证件同一人', idChkClear: '证件清晰可读',
    idApprove: '通过', idReject: '拒绝', idRevoke: '撤销认证', idHold: '法务保留', idHoldOn: '已保留', idHoldOff: '未保留',
    idRejectReason: '拒绝原因', idRejectNote: '补充说明（可选）', idConfirmRevoke: '确认撤销该用户的实名认证？徽章将被移除。',
    idApproveBlocked: '请先勾选全部核对项再通过', idDocType_national_id: '身份证', idDocType_passport: '护照', idDocType_drivers_license: '驾照', idDocType_residence_permit: '居住证',
    idReason_blurry: '照片模糊', idReason_glare: '反光', idReason_name_mismatch: '姓名不符', idReason_face_mismatch: '人脸不符', idReason_expired: '证件过期', idReason_unsupported_doc: '证件不支持', idReason_incomplete: '资料不完整', idReason_suspected_fraud: '疑似伪造', idReason_other: '其他',
    idDocLoadFail: '证件图片加载失败', idNoDoc: '未上传', idDecided: '已审核', idVerifiedBadge: '已认证',
    detail: '用户详情', email: '邮箱', phone: '手机号', language: '语言', verified: '已验证', notVerified: '未验证',
    none: '未设置', appleId: 'Apple ID', linked: '已绑定', notLinked: '未绑定', passkeys: 'Passkey', online2: '在线状态',
    linkedRelations: '绑定关系', blockedRelations: '拉黑记录', recentCalls: '近期通话', noCalls: '暂无通话记录',
    close: '关闭', never: '从未', justNow: '刚刚',
    err_last_admin_protected: '不能操作最后一名管理员', err_cannot_change_own_role: '不能修改自己的角色',
    err_cannot_disable_self: '不能封禁自己', err_not_found: '对象不存在', err_invalid_input: '输入有误',
    err_forbidden: '无权操作', err_unauthorized: '登录已过期，请重新登录', err_network: '网络错误，请重试',
    sessionExpired: '登录已过期，请重新登录', loading: '加载中…',
    relationships: '关系', calls: '通话', owner: '视障用户', member: '协助者 / 亲友', relationCol: '关系',
    emergency: '紧急', exportCsv: '导出 CSV', noLinks: '暂无绑定关系', caller: '主叫', callee: '被叫', time: '时间',
    callCount: '通话记录', searchLinks: '搜索姓名…', searchCalls: '搜索姓名…',
    linkAccepted: '已绑定', linkPending: '待确认', linkDeclined: '已拒绝',
    newUsers7d: '近 7 天新增', newUsers30d: '近 30 天新增', regTrend: '注册趋势（近 30 天）',
    blocks: '拉黑', blocker: '拉黑方', blocked: '被拉黑', noBlocks: '暂无拉黑记录', searchBlocks: '搜索姓名…',
    support: '账号支持', markVerified: '标记邮箱已验证', markUnverified: '撤销邮箱验证', unlinkApple: '解绑 Apple',
    clearPasskeys: '清除 Passkey', forceLogout: '强制下线',
    confirmMarkVerified: '确认将该用户邮箱标记为「已验证」？', confirmMarkUnverified: '确认撤销该用户的邮箱验证状态？',
    confirmUnlinkApple: '确认解绑该用户的 Apple 账号？解绑后该用户需用正确的 Apple 账号重新绑定。',
    confirmClearPasskeys: '确认清除该用户的全部 Passkey？清除后该用户需用密码登录并重新注册 Passkey。',
    confirmForceLogout: '确认强制该用户下线？其所有设备上的登录将立即失效，需重新登录。',
    emailMarkedVerified: '已标记邮箱为已验证', emailMarkedUnverified: '已撤销邮箱验证',
    appleUnlinked: '已解绑 Apple', passkeysCleared: '已清除 Passkey（%s 把）', forcedLogout: '已强制下线',
    err_no_email: '该用户未绑定邮箱', err_not_linked: '该用户未绑定 Apple',
    err_target_not_found: '被举报用户不存在', err_registration_disabled: '注册已关闭',
    // 审核处置
    moderation: '审核', moderate: '审核处置', modTitle: '审核处置举报',
    modDismiss: '忽略', modWarn: '警告', modSuspend: '暂停', modBan: '封禁',
    modDismissDesc: '判定无需处置，关闭该举报。', modWarnDesc: '记一条警告，不封号。',
    modSuspendDesc: '封禁账号并强制下线（可日后解封）。', modBanDesc: '封禁账号并强制下线（最重处置）。',
    modReason: '处置理由（必填，将记入审计）', modReasonPh: '简述判定依据与处置原因…',
    modReasonRequired: '请填写处置理由', moderated: '已处置', decision: '处置',
    dec_dismissed: '已忽略', dec_warned: '已警告', dec_suspended: '已暂停', dec_banned: '已封禁',
    resolvedBy: '处置人', warnings: '警告记录', noWarnings: '无警告记录', warnedBy: '处置人',
    // 审计日志
    audit: '审计日志', auditLog: '后台操作审计', noAudit: '暂无审计记录',
    auditAdmin: '管理员', auditAction: '操作', auditTarget: '对象', auditDetail: '详情', auditWhen: '时间',
    // 全站控制
    controls: '全站控制', siteControls: '全站运行开关', registration: '开放注册',
    registrationDesc: '关闭后，任何人都无法新建账号（已有账号登录不受影响）。', recPolicyLink: '录制策略在「录制」页设置。',
    requireVerif: '要求实名认证', requireVerifDesc: '开启后，未通过实名审核的盲人/协助/亲友用户除「提交认证」与紧急功能外一律无法使用；管理员不受限。可随时关闭作为兜底。',
    // 功能开关（Admin v4）
    siteFeatures: '功能开关', siteFeaturesDesc: '逐项控制 App 的每个功能。关闭后服务端立即拒绝该操作，客户端也会隐藏对应按钮。',
    safetyLocked: '安全功能（始终开启）', safetyLockedDesc: '紧急报警、拉黑、举报为安全攸关功能，刻意不可关闭，以保护用户安全与审核闭环。',
    alwaysOn: '始终开启',
    featLabels: { messaging: '消息', calls: '远程协助通话', helpRequests: '公开求助', groups: '群组', familyLinks: '亲友绑定', mediaUpload: '媒体上传', navigation: '步行导航', sceneScan: '看一看（场景识别）', emergency: '紧急报警', blocks: '拉黑', reports: '举报' },
    featDescs: { messaging: '私聊/群聊发送消息', calls: '发起远程协助音视频呼叫', helpRequests: '发起/认领公开求助', groups: '创建群组、管理成员', familyLinks: '绑定亲友/协助者', mediaUpload: '上传图片/视频', navigation: '步行路径导航', sceneScan: '端侧场景识别（仅客户端隐藏）' },
    // 用户编辑（Admin v4）
    editUser: '编辑资料', cancelEdit: '取消', profileSaved: '资料已保存',
    fldDisplayName: '昵称', fldUsername: '用户名', fldEmail: '邮箱', fldPhone: '手机号', fldLanguage: '语言（如 zh/en）', clearAvatarBtn: '清除头像',
    resetPassword: '重设密码', newPasswordPh: '新密码（至少 6 位）', confirmResetPassword: '确认为该用户设置新密码？这会撤销其所有设备的登录。', passwordResetDone: '密码已重设',
    deleteUser: '删除用户', confirmDeleteUser: '确认永久删除该用户？将级联清除其全部绑定、Passkey 与会话，且不可恢复。', userDeleted: '用户已删除', dangerZone: '危险操作',
    sessionsLabel: '活跃会话', tokenVersionLabel: '令牌版本', usernameCustomizedLabel: '自定义用户名', legalConsentLabel: '合规同意', avatarLabel: '头像', voipLabel: 'VoIP 推送', apnsLabel: 'APNs 推送', yes: '是', no: '否',
    reportsByLabel: '发起的举报', reportsAgainstLabel: '收到的举报', recordingsOwnLabel: '录制', blockingLabel: '已拉黑', blockedByLabel: '被拉黑',
    err_username_taken: '用户名已被占用', err_email_taken: '邮箱已被占用', err_phone_taken: '手机号已被占用', err_invalid_username: '用户名格式不合法（仅字母数字 _.-）', err_invalid_phone: '手机号不合法', err_cannot_delete_self: '不能删除自己',
    // v5：分页/排序/批量
    sortBy: '排序', sort_created_desc: '注册时间（新→旧）', sort_created_asc: '注册时间（旧→新）', sort_name_asc: '昵称 A→Z', sort_role_asc: '按角色', sort_status_asc: '按状态',
    pagePrev: '上一页', pageNext: '下一页', pageInfo: '第 %a–%b / 共 %t', selectAll: '全选本页', selectedN: '已选 %n',
    bulkBan: '批量封禁', bulkUnban: '批量解封', bulkRole: '批量改角色', bulkDelete: '批量删除', clearSel: '清除选择',
    bulkConfirmBan: '确认封禁所选 %n 个用户？', bulkConfirmUnban: '确认解封所选 %n 个用户？',
    bulkConfirmDelete: '确认永久删除所选 %n 个用户？将级联清除其数据，不可恢复。', bulkConfirmRole: '确认把所选 %n 个用户角色改为「%s」？',
    bulkDone: '完成：成功 %s，失败 %f', pickRole: '选择角色',
    // v5：公告 / 维护 / 内容过滤
    announce: '全站公告', announceActive: '启用公告', announceMsg: '公告内容', announceLevel: '级别', lvl_info: '信息', lvl_warning: '警告',
    maintenance: '维护模式', maintActive: '启用维护模式', maintDesc: '开启后所有功能写操作返回 503，App 显示维护横幅；登录与后台不受影响。', maintMsg: '维护提示',
    contentFilterTitle: '内容过滤（防违规违法）', cfEnabled: '启用内容过滤', cfDesc: '命中违禁词的消息/群名/昵称会被拒收。每行一个词，大小写不敏感，子串匹配。默认空=不生效。',
    cfTerms: '违禁词（每行一个）', saveBtn: '保存', err_content_blocked: '内容含违禁词，已拦截', err_maintenance: '系统维护中',
    // v6：单用户功能覆盖
    featOverrides: '功能覆盖（仅此用户）', featOverridesDesc: '对该用户单独关停某功能（精准处置滥用者，不影响其他人）。开=随全站，关=对其强制禁用。', featuresSaved: '功能覆盖已更新', exportData: '导出数据', dataExported: '数据已导出',
    // 实时通话
    liveCalls: '实时通话', liveCallsDesc: '当前进行中的通话。可强制结束；点参与者查看/封禁。监看(声音画面)需在 App 端进行且会通知用户。',
    liveDuration: '时长', liveParticipants: '参与者', liveForceEnd: '强制结束', liveConfirmEnd: '确认强制结束这通通话？双方都会收到挂断。', liveCallEnded: '通话已结束', noLiveCalls: '当前没有进行中的通话', liveObserved: '管理员监看中', liveRefresh: '自动刷新中',
    observe: '旁观', observeTitle: '旁观通话', observeConnecting: '正在接入旁观…', observeWaiting: '等待对方音视频…', observeSpeak: '开麦说话', observeMute: '静音', observeLeave: '结束旁观', observeForceEnd: '强制结束', observeNoVideo: '（未共享画面）', observeMicDenied: '麦克风不可用', observeNotObservable: '该通话参与方的 App 版本不支持被旁观（需双方升级到最新版）', observeExists: '已有管理员在旁观该通话', observeNotActive: '该通话已结束', observeFailed: '旁观接入失败', observeNotice: '旁观会实时通知通话双方（横幅+语音），合规监管。',
    auditActions: {
      'user.role': '修改角色', 'user.disable': '封禁用户', 'user.enable': '解封用户',
      'user.verifyEmail': '标记邮箱已验证', 'user.unverifyEmail': '撤销邮箱验证', 'user.unlinkApple': '解绑 Apple',
      'user.clearPasskeys': '清除 Passkey', 'user.forceLogout': '强制下线', 'report.resolve': '处理举报',
      'report.dismiss': '审核·忽略', 'report.warn': '审核·警告', 'report.suspend': '审核·暂停', 'report.ban': '审核·封禁',
      'config.update': '修改全站配置', 'user.edit': '编辑资料', 'user.resetPassword': '重设密码', 'user.delete': '删除用户', 'user.features': '功能覆盖', 'user.export': '导出数据',
    },
    roles: { blind: '视障用户', helper: '协助者', family: '亲友', admin: '管理员', developer: '开发者' },
    callStatus: { answered: '已接通', declined: '已拒绝', missed: '未接', ended: '已结束', ongoing: '进行中', ringing: '振铃中' },
    dir: { incoming: '呼入', outgoing: '呼出' },
  },
  en: {
    appName: 'BeeUrEi Admin', console: 'Console', signInTitle: 'Admin sign-in', signInSub: 'Sign in with an admin account',
    username: 'Username / phone / email', password: 'Password', signIn: 'Sign in', signingIn: 'Signing in…',
    notAdmin: 'This account is not an admin and cannot access the console.', loginFailed: 'Sign-in failed — check your credentials.',
    dashboard: 'Overview', users: 'Users', reports: 'Reports', recordings: 'Recordings', logout: 'Sign out',
    totalUsers: 'Total users', active: 'Active', disabled: 'Banned', online: 'Online', onlineHelpers: 'Online helpers',
    openReports: 'Open reports', recordingsCount: 'Recordings', byRole: 'By role', version: 'Version', uptime: 'Uptime',
    refresh: 'Refresh', search: 'Search username / name…', allRoles: 'All roles', allStatus: 'All status',
    role: 'Role', status: 'Status', created: 'Joined', actions: 'Actions', lastActive: 'Online',
    ban: 'Ban', unban: 'Unban', changeRole: 'Role', confirmBan: 'Ban this user? Their tokens expire immediately and they cannot sign in.',
    confirmUnban: 'Unban this user?', confirmRole: 'Change this user’s role to “%s”?',
    banned: 'Banned', unbanned: 'Unbanned', roleChanged: 'Role updated', noUsers: 'No matching users',
    resolve: 'Resolve', open: 'Open', resolved: 'Resolved', reportResolved: 'Report resolved', noReports: 'No reports',
    reporter: 'Reporter', target: 'Reported', reason: 'Reason',
    recPolicy: 'Recording policy', allowRecording: 'Allow recording', allowRecordingDesc: 'Master switch: when off, no side can start a recording.',
    requireConsent: 'Require everyone’s consent', requireConsentDesc: 'When on, recording requires the recorded party’s explicit consent.',
    retentionDays: 'Retention', retentionDesc: 'Recording metadata is auto-deleted after this many days.', days: 'days', save: 'Save', saved: 'Saved',
    recList: 'Recordings', deleteRec: 'Delete', confirmDeleteRec: 'Permanently delete this recording (incl. media file, cannot be undone)?', noRecordings: 'No recordings',
    playRec: 'Play', recParticipants: 'Participants', recDuration: 'Duration', recLocation: 'Location', recUserDeleted: 'User-deleted · retained', recNoMedia: 'Media unavailable', playFailed: "Couldn't play this recording", closeBtn: 'Close',
    evidence: 'Recording evidence', viewEvidence: 'View evidence recording',
    idReview: 'Identity review', idQueue: 'Queue', idStatusAll: 'All', idStatusPending: 'Pending', idStatusVerified: 'Verified', idStatusRejected: 'Rejected',
    idApplicant: 'Applicant', idDocType: 'Document', idSubmittedVia: 'Via', idAttempt: 'Attempt', idSubmittedAt: 'Submitted', idDecidedAt: 'Decided', idDecidedBy: 'Reviewer',
    idViaSelf: 'Self', idViaAssisted: 'Assisted', noVerifications: 'No identity submissions',
    idReview1: 'Review: compare document and selfie', idLegalName: 'Name on document', idNumber: 'ID number', idLast4: 'Last 4', idDocFront: 'Document front', idDocBack: 'Document back', idSelfie: 'Selfie',
    idCompareHint: 'Check: ① name matches the document; ② document is genuine / not expired / not altered; ③ selfie is the same person as the document; ④ document is legible.',
    idChkName: 'Name matches document', idChkValid: 'Document genuine · not expired · not altered', idChkFace: 'Selfie matches document', idChkClear: 'Document legible',
    idApprove: 'Approve', idReject: 'Reject', idRevoke: 'Revoke', idHold: 'Legal hold', idHoldOn: 'On hold', idHoldOff: 'Not held',
    idRejectReason: 'Reject reason', idRejectNote: 'Note (optional)', idConfirmRevoke: 'Revoke this user’s verification? The badge will be removed.',
    idApproveBlocked: 'Tick all checklist items before approving', idDocType_national_id: 'National ID', idDocType_passport: 'Passport', idDocType_drivers_license: 'Driver’s license', idDocType_residence_permit: 'Residence permit',
    idReason_blurry: 'Blurry', idReason_glare: 'Glare', idReason_name_mismatch: 'Name mismatch', idReason_face_mismatch: 'Face mismatch', idReason_expired: 'Expired', idReason_unsupported_doc: 'Unsupported document', idReason_incomplete: 'Incomplete', idReason_suspected_fraud: 'Suspected fraud', idReason_other: 'Other',
    idDocLoadFail: 'Failed to load document image', idNoDoc: 'Not uploaded', idDecided: 'Decided', idVerifiedBadge: 'Verified',
    detail: 'User detail', email: 'Email', phone: 'Phone', language: 'Language', verified: 'Verified', notVerified: 'Unverified',
    none: 'Not set', appleId: 'Apple ID', linked: 'Linked', notLinked: 'Not linked', passkeys: 'Passkeys', online2: 'Presence',
    linkedRelations: 'Linked relations', blockedRelations: 'Blocks', recentCalls: 'Recent calls', noCalls: 'No calls',
    close: 'Close', never: 'never', justNow: 'just now',
    err_last_admin_protected: 'Can’t act on the last admin', err_cannot_change_own_role: 'Can’t change your own role',
    err_cannot_disable_self: 'Can’t ban yourself', err_not_found: 'Not found', err_invalid_input: 'Invalid input',
    err_forbidden: 'Forbidden', err_unauthorized: 'Session expired — sign in again', err_network: 'Network error, try again',
    sessionExpired: 'Session expired — sign in again', loading: 'Loading…',
    relationships: 'Relations', calls: 'Calls', owner: 'Blind user', member: 'Helper / family', relationCol: 'Relation',
    emergency: 'Emergency', exportCsv: 'Export CSV', noLinks: 'No relationships yet', caller: 'Caller', callee: 'Callee', time: 'Time',
    callCount: 'Call records', searchLinks: 'Search name…', searchCalls: 'Search name…',
    linkAccepted: 'Linked', linkPending: 'Pending', linkDeclined: 'Declined',
    newUsers7d: 'New · 7d', newUsers30d: 'New · 30d', regTrend: 'Registrations (last 30 days)',
    blocks: 'Blocks', blocker: 'Blocker', blocked: 'Blocked', noBlocks: 'No blocks', searchBlocks: 'Search name…',
    support: 'Account support', markVerified: 'Mark email verified', markUnverified: 'Unverify email', unlinkApple: 'Unlink Apple',
    clearPasskeys: 'Clear passkeys', forceLogout: 'Force sign-out',
    confirmMarkVerified: 'Mark this user’s email as verified?', confirmMarkUnverified: 'Revoke this user’s email verification?',
    confirmUnlinkApple: 'Unlink this user’s Apple account? They’ll need to re-link with the correct Apple account.',
    confirmClearPasskeys: 'Clear all of this user’s passkeys? They’ll need to sign in with a password and re-register.',
    confirmForceLogout: 'Force this user to sign out? Sessions on all their devices expire immediately.',
    emailMarkedVerified: 'Email marked verified', emailMarkedUnverified: 'Email verification revoked',
    appleUnlinked: 'Apple unlinked', passkeysCleared: 'Passkeys cleared (%s)', forcedLogout: 'Signed out everywhere',
    err_no_email: 'User has no email', err_not_linked: 'User has no Apple link',
    err_target_not_found: 'Reported user not found', err_registration_disabled: 'Registration is closed',
    // Moderation
    moderation: 'Moderation', moderate: 'Moderate', modTitle: 'Moderate report',
    modDismiss: 'Dismiss', modWarn: 'Warn', modSuspend: 'Suspend', modBan: 'Ban',
    modDismissDesc: 'No action needed — close this report.', modWarnDesc: 'Record a warning, no ban.',
    modSuspendDesc: 'Ban the account and force sign-out (can unban later).', modBanDesc: 'Ban the account and force sign-out (most severe).',
    modReason: 'Reason (required, recorded in the audit log)', modReasonPh: 'Briefly state the basis and reason…',
    modReasonRequired: 'Please provide a reason', moderated: 'Moderated', decision: 'Decision',
    dec_dismissed: 'Dismissed', dec_warned: 'Warned', dec_suspended: 'Suspended', dec_banned: 'Banned',
    resolvedBy: 'By', warnings: 'Warnings', noWarnings: 'No warnings', warnedBy: 'By',
    // Audit log
    audit: 'Audit', auditLog: 'Admin action audit', noAudit: 'No audit records',
    auditAdmin: 'Admin', auditAction: 'Action', auditTarget: 'Target', auditDetail: 'Detail', auditWhen: 'When',
    // Site controls
    controls: 'Controls', siteControls: 'Site-wide switches', registration: 'Open registration',
    registrationDesc: 'When off, no one can create a new account (existing accounts can still sign in).', recPolicyLink: 'Recording policy is on the Recordings page.',
    requireVerif: 'Require identity verification', requireVerifDesc: 'When on, blind/helper/family users who have not passed KYC review cannot use anything except submitting verification and emergency features; admins are unaffected. Can be turned off at any time as a fallback.',
    // Feature switches (Admin v4)
    siteFeatures: 'Feature switches', siteFeaturesDesc: 'Control every app function individually. When off, the server rejects the action and the app hides the matching button.',
    safetyLocked: 'Safety features (always on)', safetyLockedDesc: 'Emergency alerts, blocking, and reporting are safety-critical and deliberately cannot be turned off — to protect users and the moderation loop.',
    alwaysOn: 'Always on',
    featLabels: { messaging: 'Messaging', calls: 'Remote-assist calls', helpRequests: 'Public help', groups: 'Groups', familyLinks: 'Family links', mediaUpload: 'Media upload', navigation: 'Walking navigation', sceneScan: 'Look (scene scan)', emergency: 'Emergency alerts', blocks: 'Blocking', reports: 'Reporting' },
    featDescs: { messaging: 'Send 1:1 / group messages', calls: 'Start remote-assist calls', helpRequests: 'Start / claim public help', groups: 'Create groups, manage members', familyLinks: 'Link family / helpers', mediaUpload: 'Upload images / video', navigation: 'Walking route guidance', sceneScan: 'On-device scene scan (client-hidden)' },
    // User editor (Admin v4)
    editUser: 'Edit profile', cancelEdit: 'Cancel', profileSaved: 'Profile saved',
    fldDisplayName: 'Display name', fldUsername: 'Username', fldEmail: 'Email', fldPhone: 'Phone', fldLanguage: 'Language (e.g. zh/en)', clearAvatarBtn: 'Clear avatar',
    resetPassword: 'Reset password', newPasswordPh: 'New password (min 6 chars)', confirmResetPassword: 'Set a new password for this user? It signs them out on all devices.', passwordResetDone: 'Password reset',
    deleteUser: 'Delete user', confirmDeleteUser: 'Permanently delete this user? Their links, passkeys, and sessions are cascade-deleted. This cannot be undone.', userDeleted: 'User deleted', dangerZone: 'Danger zone',
    sessionsLabel: 'Active sessions', tokenVersionLabel: 'Token version', usernameCustomizedLabel: 'Custom username', legalConsentLabel: 'Legal consent', avatarLabel: 'Avatar', voipLabel: 'VoIP push', apnsLabel: 'APNs push', yes: 'yes', no: 'no',
    reportsByLabel: 'Reports filed', reportsAgainstLabel: 'Reports received', recordingsOwnLabel: 'Recordings', blockingLabel: 'Blocking', blockedByLabel: 'Blocked by',
    err_username_taken: 'Username taken', err_email_taken: 'Email taken', err_phone_taken: 'Phone taken', err_invalid_username: 'Invalid username (letters, digits, _.- only)', err_invalid_phone: 'Invalid phone', err_cannot_delete_self: 'Cannot delete yourself',
    // v5: pagination / sort / bulk
    sortBy: 'Sort', sort_created_desc: 'Joined (newest)', sort_created_asc: 'Joined (oldest)', sort_name_asc: 'Name A→Z', sort_role_asc: 'By role', sort_status_asc: 'By status',
    pagePrev: 'Prev', pageNext: 'Next', pageInfo: '%a–%b of %t', selectAll: 'Select page', selectedN: '%n selected',
    bulkBan: 'Ban', bulkUnban: 'Unban', bulkRole: 'Set role', bulkDelete: 'Delete', clearSel: 'Clear',
    bulkConfirmBan: 'Ban the %n selected users?', bulkConfirmUnban: 'Unban the %n selected users?',
    bulkConfirmDelete: 'Permanently delete the %n selected users? Their data is cascade-deleted; cannot be undone.', bulkConfirmRole: 'Change the %n selected users’ role to “%s”?',
    bulkDone: 'Done: %s ok, %f failed', pickRole: 'Pick a role',
    // v5: announcement / maintenance / content filter
    announce: 'Announcement', announceActive: 'Enable announcement', announceMsg: 'Message', announceLevel: 'Level', lvl_info: 'Info', lvl_warning: 'Warning',
    maintenance: 'Maintenance mode', maintActive: 'Enable maintenance mode', maintDesc: 'When on, all feature writes return 503 and the app shows a maintenance banner; sign-in and admin are unaffected.', maintMsg: 'Maintenance message',
    contentFilterTitle: 'Content filter (block violations)', cfEnabled: 'Enable content filter', cfDesc: 'Messages/group names/display names containing a banned term are rejected. One term per line, case-insensitive, substring match. Empty = no effect.',
    cfTerms: 'Banned terms (one per line)', saveBtn: 'Save', err_content_blocked: 'Content contains a banned term', err_maintenance: 'Under maintenance',
    // v6: per-user feature overrides
    featOverrides: 'Feature overrides (this user)', featOverridesDesc: 'Disable specific features for just this user (precise abuse handling, no global impact). On = follow global, Off = force-disabled for them.', featuresSaved: 'Feature overrides updated', exportData: 'Export data', dataExported: 'Data exported',
    // Live calls
    liveCalls: 'Live calls', liveCallsDesc: 'Calls in progress. You can force-end; click a participant to view/ban. Observing (audio/video) happens in the app and notifies the users.',
    liveDuration: 'Duration', liveParticipants: 'Participants', liveForceEnd: 'Force end', liveConfirmEnd: 'Force-end this call? Both sides will be hung up.', liveCallEnded: 'Call ended', noLiveCalls: 'No calls in progress', liveObserved: 'Admin observing', liveRefresh: 'Auto-refreshing',
    observe: 'Observe', observeTitle: 'Observe call', observeConnecting: 'Connecting observer…', observeWaiting: 'Waiting for audio/video…', observeSpeak: 'Speak', observeMute: 'Mute', observeLeave: 'Stop observing', observeForceEnd: 'Force end', observeNoVideo: '(no video shared)', observeMicDenied: 'Microphone unavailable', observeNotObservable: "Participants' app version doesn't support being observed (both must update)", observeExists: 'An admin is already observing this call', observeNotActive: 'This call has ended', observeFailed: 'Failed to connect observer', observeNotice: 'Observing notifies both parties in real time (banner + voice) — compliant supervision.',
    auditActions: {
      'user.role': 'Change role', 'user.disable': 'Ban user', 'user.enable': 'Unban user',
      'user.verifyEmail': 'Mark email verified', 'user.unverifyEmail': 'Unverify email', 'user.unlinkApple': 'Unlink Apple',
      'user.clearPasskeys': 'Clear passkeys', 'user.forceLogout': 'Force sign-out', 'report.resolve': 'Resolve report',
      'report.dismiss': 'Moderate · dismiss', 'report.warn': 'Moderate · warn', 'report.suspend': 'Moderate · suspend', 'report.ban': 'Moderate · ban',
      'config.update': 'Update site config', 'user.edit': 'Edit profile', 'user.resetPassword': 'Reset password', 'user.delete': 'Delete user', 'user.features': 'Feature override', 'user.export': 'Export data',
    },
    roles: { blind: 'Blind / low-vision', helper: 'Helper', family: 'Family', admin: 'Admin', developer: 'Developer' },
    callStatus: { answered: 'Answered', declined: 'Declined', missed: 'Missed', ended: 'Ended', ongoing: 'Ongoing', ringing: 'Ringing' },
    dir: { incoming: 'Incoming', outgoing: 'Outgoing' },
  },
};
function t(key) { return I18N[state.lang][key] ?? I18N.zh[key] ?? key; }
function roleName(r) { return (I18N[state.lang].roles[r]) || r; }
function auditActionName(a) { return (I18N[state.lang].auditActions[a]) || a; }
function decisionLabel(d) { return d ? t('dec_' + d) : '—'; }
function featLabel(k) { return (I18N[state.lang].featLabels[k]) || k; }
function featDesc(k) { return (I18N[state.lang].featDescs[k]) || ''; }
function localeCode() { return state.lang === 'en' ? 'en-US' : 'zh-CN'; }

// ---------------------------------------------------------------- dom helpers
const $ = (sel, root = document) => root.querySelector(sel);
const app = () => document.getElementById('app');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function initials(name) {
  const n = (name || '?').trim();
  return n ? n.slice(0, 1).toUpperCase() : '?';
}
function avatarHTML(u, big) {
  const cls = 'avatar' + (big ? ' lg' : '');
  if (u.avatar) return `<img class="${cls}" src="${esc(u.avatar)}" alt="" />`;
  return `<span class="${cls}" aria-hidden="true">${esc(initials(u.displayName || u.username))}</span>`;
}
function fmtDate(ms) {
  if (!ms) return '—';
  try { return new Date(ms).toLocaleString(localeCode(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return new Date(ms).toISOString(); }
}
function fmtUptime(sec) {
  if (!sec && sec !== 0) return '—';
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (state.lang === 'en') return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
  return [d && `${d}天`, h && `${h}小时`, `${m}分`].filter(Boolean).join('');
}

// ---------------------------------------------------------------- toast
function toast(msg, kind = '') {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(6px)'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}
function errText(code) { return I18N[state.lang]['err_' + code] || code || t('err_network'); }

// ---------------------------------------------------------------- api
async function api(path, { method = 'GET', body, auth = true } = {}) {
  // 仅在确有 body 时才声明 application/json——否则 Fastify 对"空 body + json"直接 400
  // （影响所有无 body 的 POST，如强制结束通话/标记已读，见反馈）。
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && state.token) headers.authorization = 'Bearer ' + state.token;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw { code: 'network' };
  }
  if (res.status === 401 || res.status === 403) {
    if (auth) { logout(true); throw { code: res.status === 403 ? 'forbidden' : 'unauthorized' }; }
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body (204) */ }
  if (!res.ok) throw { code: (data && data.error) || 'network', status: res.status };
  return data;
}

// ---------------------------------------------------------------- theme
function applyTheme() {
  const tm = state.theme;
  if (tm === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', tm);
}
function cycleTheme() {
  state.theme = state.theme === 'auto' ? 'light' : state.theme === 'light' ? 'dark' : 'auto';
  localStorage.setItem(LS.theme, state.theme); applyTheme(); renderChrome();
}
function themeIcon() { return state.theme === 'light' ? '☀️' : state.theme === 'dark' ? '🌙' : '🌗'; }
function toggleLang() { state.lang = state.lang === 'zh' ? 'en' : 'zh'; localStorage.setItem(LS.lang, state.lang); document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-Hans'; render(); }

// ---------------------------------------------------------------- auth
function setAuth(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem(LS.token, token); localStorage.setItem(LS.user, JSON.stringify(user));
}
function logout(silent) {
  state.token = null; state.user = null;
  localStorage.removeItem(LS.token); localStorage.removeItem(LS.user);
  if (state.refreshTimer) { clearInterval(state.refreshTimer); state.refreshTimer = null; }
  if (!silent) toast(t('logout'));
  location.hash = '';
  render();
}

// ---------------------------------------------------------------- login view
function renderLogin(errMsg) {
  applyTheme();
  app().innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm" autocomplete="on">
        <div class="login-brand"><span class="logo" aria-hidden="true">🐝</span><h1>${esc(t('appName'))}</h1></div>
        <p class="login-sub">${esc(t('signInSub'))}</p>
        ${errMsg ? `<div class="err-banner" role="alert">${esc(errMsg)}</div>` : ''}
        <div class="field">
          <label for="u">${esc(t('username'))}</label>
          <input id="u" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required />
        </div>
        <div class="field">
          <label for="p">${esc(t('password'))}</label>
          <input id="p" name="password" type="password" autocomplete="current-password" required />
        </div>
        <button class="btn primary block" type="submit" id="loginBtn">${esc(t('signIn'))}</button>
        <div class="login-actions">
          <button class="btn ghost sm" type="button" data-action="lang">${state.lang === 'zh' ? 'English' : '中文'}</button>
          <button class="btn ghost sm" type="button" data-action="theme">${themeIcon()}</button>
        </div>
      </form>
    </div>`;
  $('#loginForm').addEventListener('submit', onLogin);
  app().querySelector('[data-action="lang"]').addEventListener('click', toggleLang);
  app().querySelector('[data-action="theme"]').addEventListener('click', cycleTheme);
  $('#u').focus();
}
async function onLogin(e) {
  e.preventDefault();
  const btn = $('#loginBtn');
  const username = $('#u').value.trim(), password = $('#p').value;
  if (!username || !password) return;
  btn.disabled = true; btn.textContent = t('signingIn');
  try {
    const data = await api('/api/auth/login', { method: 'POST', auth: false, body: { username, password } });
    if (!data || !data.user || data.user.role !== 'admin') { renderLogin(t('notAdmin')); return; }
    setAuth(data.token, data.user);
    location.hash = '#/';
    render();
  } catch (err) {
    btn.disabled = false; btn.textContent = t('signIn');
    renderLogin(err.code === 'network' ? t('err_network') : t('loginFailed'));
  }
}

// ---------------------------------------------------------------- shell + router
const ROUTES = ['', 'users', 'relationships', 'live', 'calls', 'blocks', 'reports', 'verifications', 'audit', 'recordings', 'controls'];
function currentRoute() { const h = (location.hash || '#/').replace(/^#\/?/, ''); return ROUTES.includes(h) ? h : ''; }

function renderChrome() {
  const route = currentRoute();
  const openReports = state.overview ? state.overview.reports.open : 0;
  const pendingVerif = state.overview && state.overview.verifications ? state.overview.verifications.pending : 0;
  const nav = [
    ['', '📊', t('dashboard')],
    ['users', '👤', t('users')],
    ['relationships', '🔗', t('relationships')],
    ['live', '🔴', t('liveCalls')],
    ['calls', '📞', t('calls')],
    ['blocks', '🚫', t('blocks')],
    ['reports', '🚩', t('reports'), openReports],
    ['verifications', '🪪', t('idReview'), pendingVerif],
    ['audit', '🧾', t('audit')],
    ['recordings', '⏺', t('recordings')],
    ['controls', '🎛️', t('controls')],
  ].map(([r, ico, label, badge]) => `
    <button class="nav-item ${r === route ? 'active' : ''}" data-route="${r}">
      <span class="ico" aria-hidden="true">${ico}</span><span>${esc(label)}</span>
      ${badge ? `<span class="badge">${badge}</span>` : ''}
    </button>`).join('');
  const titleMap = { '': t('dashboard'), users: t('users'), relationships: t('relationships'), live: t('liveCalls'), calls: t('calls'), blocks: t('blocks'), reports: t('reports'), verifications: t('idReview'), audit: t('auditLog'), recordings: t('recordings'), controls: t('siteControls') };
  app().innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><span class="logo" aria-hidden="true">🐝</span>
          <div><div class="name">BeeUrEi</div><div class="tag">${esc(t('console'))}</div></div></div>
        <nav>${nav}</nav>
        <div class="spacer"></div>
        <div class="foot">Hiko Sphere 彦穹科技<br/>v${esc(state.overview ? state.overview.version : '')}</div>
      </aside>
      <main class="main">
        <header class="topbar">
          <button class="btn icon ghost menu-btn" data-action="menu" aria-label="menu">☰</button>
          <h2>${esc(titleMap[route])}</h2>
          <div class="grow"></div>
          <button class="btn ghost sm" data-action="lang" aria-label="language">${state.lang === 'zh' ? 'EN' : '中'}</button>
          <button class="btn ghost sm" data-action="theme" aria-label="theme">${themeIcon()}</button>
          <span class="who">${esc(state.user ? state.user.displayName : '')} · <b>${esc(roleName('admin'))}</b></span>
          <button class="btn sm" data-action="logout">${esc(t('logout'))}</button>
        </header>
        <section class="content" id="view"></section>
      </main>
    </div>`;
  app().querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.route; $('#sidebar')?.classList.remove('open'); }));
  app().querySelector('[data-action="lang"]').addEventListener('click', toggleLang);
  app().querySelector('[data-action="theme"]').addEventListener('click', cycleTheme);
  app().querySelector('[data-action="logout"]').addEventListener('click', () => logout());
  app().querySelector('[data-action="menu"]').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
}

function viewEl() { return document.getElementById('view'); }
function showLoading() { const v = viewEl(); if (v) v.innerHTML = `<div class="loading"><span class="spinner"></span> ${esc(t('loading'))}</div>`; }

// ---------------------------------------------------------------- dashboard
async function loadDashboard() {
  showLoading();
  try {
    state.overview = await api('/api/admin/overview');
    renderChrome();
    renderDashboard();
    if (!state.refreshTimer) state.refreshTimer = setInterval(async () => {
      if (currentRoute() === '') { try { state.overview = await api('/api/admin/overview'); renderDashboard(); } catch {} }
    }, 15000);
  } catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function statCard(k, v, sub, cls) {
  return `<div class="card stat"><div class="k">${esc(k)}</div><div class="v ${cls || ''}">${v}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
}
function renderDashboard() {
  const o = state.overview; if (!o) return;
  const roleOrder = ['blind', 'helper', 'family', 'admin', 'developer'];
  const max = Math.max(1, ...roleOrder.map((r) => o.users.byRole[r] || 0));
  const bars = roleOrder.map((r) => {
    const n = o.users.byRole[r] || 0;
    return `<div class="bar-row"><span>${esc(roleName(r))}</span><span class="bar-track"><span class="bar-fill" data-pct="${Math.round((n / max) * 100)}"></span></span><span class="n">${n}</span></div>`;
  }).join('');
  const g = o.growth || { newUsers7d: 0, newUsers30d: 0, trend: [] };
  const trend = g.trend || [];
  const tmax = Math.max(1, ...trend.map((d) => d.count));
  const cols = trend.map((d) => {
    const h = Math.round((d.count / tmax) * 100);
    return `<span class="col" title="${esc(d.date)} · ${d.count}"><i data-h="${h}"></i></span>`;
  }).join('');
  const trendCard = trend.length ? `
    <div class="section">
      <h3>${esc(t('regTrend'))}</h3>
      <div class="card">
        <div class="trend">${cols}</div>
        <div class="trend-axis"><span>${esc(trend[0].date)}</span><span>${esc(trend[trend.length - 1].date)}</span></div>
      </div>
    </div>` : '';
  viewEl().innerHTML = `
    <div class="cards">
      ${statCard(t('totalUsers'), o.users.total)}
      ${statCard(t('active'), o.users.active, '', 'success')}
      ${statCard(t('disabled'), o.users.disabled, '', o.users.disabled ? 'danger' : '')}
      ${statCard(t('online'), o.online.total, t('onlineHelpers') + ': ' + o.online.helpers)}
      ${statCard(t('newUsers7d'), g.newUsers7d, t('newUsers30d') + ': ' + g.newUsers30d, g.newUsers7d ? 'success' : '')}
      ${statCard(t('openReports'), o.reports.open, (state.lang === 'en' ? 'of ' : '共 ') + o.reports.total, o.reports.open ? 'danger' : '')}
      ${statCard(t('recordingsCount'), o.recordings.total)}
    </div>
    ${trendCard}
    <div class="section">
      <h3>${esc(t('byRole'))}</h3>
      <div class="card"><div class="bars">${bars}</div></div>
    </div>
    <div class="section">
      <h3>${esc(t('version'))} · ${esc(t('uptime'))}</h3>
      <div class="card"><div class="kv"><dt>${esc(t('version'))}</dt><dd>v${esc(o.version)}</dd><dt>${esc(t('uptime'))}</dt><dd>${esc(fmtUptime(o.uptimeSeconds))}</dd></div></div>
    </div>`;
  applyDims(viewEl()); // 动态尺寸经 CSSOM 落定（CSP style-src 'self' 禁内联 style）
}
// 把 data-pct / data-h 落成实际宽高——CSSOM 赋值不受 CSP 内联样式限制。
function applyDims(root) {
  root.querySelectorAll('[data-pct]').forEach((el) => { el.style.width = el.dataset.pct + '%'; });
  root.querySelectorAll('[data-h]').forEach((el) => { el.style.height = el.dataset.h + '%'; });
}

// ---------------------------------------------------------------- users（服务端搜索/筛选/排序/分页 + 批量）
function usersQueryString() {
  const p = new URLSearchParams();
  if (state.usersQuery.trim()) p.set('q', state.usersQuery.trim());
  if (state.usersRole !== 'all') p.set('role', state.usersRole);
  if (state.usersStatus !== 'all') p.set('status', state.usersStatus);
  p.set('sort', state.usersSort);
  p.set('limit', String(state.usersLimit));
  p.set('offset', String(state.usersOffset));
  return p.toString();
}
async function loadUsers() {
  showLoading();
  try {
    const r = await api('/api/admin/users?' + usersQueryString());
    state.users = r.users || [];
    state.usersTotal = r.total ?? state.users.length;
    renderUsers();
  } catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
// 改了搜索/筛选/排序 → 回到第一页并从服务端重取（搜索带 300ms 防抖）。
function reloadUsersFromStart() { state.usersOffset = 0; state.usersSelected.clear(); loadUsers(); }
function rolePill(r) { return `<span class="pill role-${esc(r)}">${esc(roleName(r))}</span>`; }
function renderUsers() {
  const list = state.users;
  const sel = state.usersSelected;
  const roleOpts = ['all', 'blind', 'helper', 'family', 'admin', 'developer']
    .map((r) => `<option value="${r}" ${state.usersRole === r ? 'selected' : ''}>${r === 'all' ? esc(t('allRoles')) : esc(roleName(r))}</option>`).join('');
  const statusOpts = [['all', t('allStatus')], ['active', t('active')], ['disabled', t('disabled')]]
    .map(([v, l]) => `<option value="${v}" ${state.usersStatus === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const sortOpts = ['created_desc', 'created_asc', 'name_asc', 'role_asc', 'status_asc']
    .map((s) => `<option value="${s}" ${state.usersSort === s ? 'selected' : ''}>${esc(t('sort_' + s))}</option>`).join('');
  const pageStart = list.length ? state.usersOffset + 1 : 0;
  const pageEnd = state.usersOffset + list.length;
  const allOnPageSelected = list.length > 0 && list.every((u) => sel.has(u.id));
  const rows = list.map((u) => `
    <tr class="clickable ${sel.has(u.id) ? 'sel' : ''}" data-uid="${esc(u.id)}">
      <td data-stop="1"><input type="checkbox" class="rowsel" data-uid="${esc(u.id)}" ${sel.has(u.id) ? 'checked' : ''} aria-label="${esc(u.username)}"/></td>
      <td><div class="user-cell">${avatarHTML(u)}<div><div class="nm">${esc(u.displayName || '—')}</div><div class="un">@${esc(u.username)}</div></div></div></td>
      <td>${rolePill(u.role)}</td>
      <td>${u.status === 'active' ? `<span class="pill ok">${esc(t('active'))}</span>` : `<span class="pill role-admin">${esc(t('disabled'))}</span>`}</td>
      <td><span class="dot ${u.online ? 'on' : 'gone'}" title="${u.online ? esc(t('online')) : ''}"></span></td>
      <td class="cell-date">${esc(fmtDate(u.createdAt))}</td>
      <td><div class="actions" data-stop="1">
        <select class="sel sm role-select" data-uid="${esc(u.id)}" aria-label="${esc(t('changeRole'))}">
          ${['blind', 'helper', 'family', 'admin', 'developer'].map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc(roleName(r))}</option>`).join('')}
        </select>
        ${u.status === 'active'
          ? `<button class="btn danger sm" data-act="ban" data-uid="${esc(u.id)}">${esc(t('ban'))}</button>`
          : `<button class="btn sm" data-act="unban" data-uid="${esc(u.id)}">${esc(t('unban'))}</button>`}
      </div></td>
    </tr>`).join('');
  const bulkBar = sel.size > 0 ? `
    <div class="bulk-bar">
      <span class="bulk-n">${esc(t('selectedN').replace('%n', String(sel.size)))}</span>
      <button class="btn sm" data-bulk="enable">${esc(t('bulkUnban'))}</button>
      <button class="btn danger sm" data-bulk="disable">${esc(t('bulkBan'))}</button>
      <button class="btn sm" data-bulk="role">${esc(t('bulkRole'))}</button>
      <button class="btn danger sm" data-bulk="delete">${esc(t('bulkDelete'))}</button>
      <button class="btn ghost sm" data-bulk="clear">${esc(t('clearSel'))}</button>
    </div>` : '';
  viewEl().innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="q" type="search" placeholder="${esc(t('search'))}" value="${esc(state.usersQuery)}" /></div>
      <select class="sel" id="fRole">${roleOpts}</select>
      <select class="sel" id="fStatus">${statusOpts}</select>
      <select class="sel" id="fSort">${sortOpts}</select>
      <button class="btn ghost" data-action="reloadUsers">↻ ${esc(t('refresh'))}</button>
      <button class="btn ghost" data-action="exportUsers" ${list.length ? '' : 'disabled'}>⬇ ${esc(t('exportCsv'))}</button>
    </div>
    ${bulkBar}
    <div class="table-wrap">
      ${list.length ? `<table><thead><tr>
        <th><input type="checkbox" id="selAll" ${allOnPageSelected ? 'checked' : ''} aria-label="${esc(t('selectAll'))}"/></th>
        <th>${esc(t('users'))}</th><th>${esc(t('role'))}</th><th>${esc(t('status'))}</th><th>${esc(t('lastActive'))}</th><th>${esc(t('created'))}</th><th class="ta-end">${esc(t('actions'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="ico">🗂️</div><p>${esc(t('noUsers'))}</p></div>`}
    </div>
    <div class="pager">
      <button class="btn ghost sm" id="pgPrev" ${state.usersOffset <= 0 ? 'disabled' : ''}>← ${esc(t('pagePrev'))}</button>
      <span class="page-info">${esc(t('pageInfo').replace('%a', String(pageStart)).replace('%b', String(pageEnd)).replace('%t', String(state.usersTotal)))}</span>
      <button class="btn ghost sm" id="pgNext" ${pageEnd >= state.usersTotal ? 'disabled' : ''}>${esc(t('pageNext'))} →</button>
    </div>`;
  $('#q').addEventListener('input', (e) => {
    state.usersQuery = e.target.value;
    if (state.usersSearchTimer) clearTimeout(state.usersSearchTimer);
    state.usersSearchTimer = setTimeout(reloadUsersFromStart, 300);
  });
  $('#fRole').addEventListener('change', (e) => { state.usersRole = e.target.value; reloadUsersFromStart(); });
  $('#fStatus').addEventListener('change', (e) => { state.usersStatus = e.target.value; reloadUsersFromStart(); });
  $('#fSort').addEventListener('change', (e) => { state.usersSort = e.target.value; reloadUsersFromStart(); });
  $('#pgPrev')?.addEventListener('click', () => { state.usersOffset = Math.max(0, state.usersOffset - state.usersLimit); loadUsers(); });
  $('#pgNext')?.addEventListener('click', () => { state.usersOffset += state.usersLimit; loadUsers(); });
  $('#selAll')?.addEventListener('change', (e) => {
    if (e.target.checked) list.forEach((u) => sel.add(u.id)); else list.forEach((u) => sel.delete(u.id));
    renderUsers();
  });
  viewEl().querySelectorAll('.rowsel').forEach((c) => c.addEventListener('change', (e) => {
    if (e.target.checked) sel.add(e.target.dataset.uid); else sel.delete(e.target.dataset.uid);
    renderUsers();
  }));
  viewEl().querySelectorAll('[data-bulk]').forEach((b) => b.addEventListener('click', () => onBulk(b.dataset.bulk)));
  viewEl().querySelector('[data-action="reloadUsers"]').addEventListener('click', loadUsers);
  viewEl().querySelector('[data-action="exportUsers"]').addEventListener('click', () => {
    const yn = (b) => (b ? (state.lang === 'en' ? 'yes' : '是') : (state.lang === 'en' ? 'no' : '否'));
    downloadCSV('beeurei-users.csv', [
      [t('username'), '@', t('role'), t('status'), t('email'), t('verified'), t('phone'), t('appleId'), t('language'), t('online'), t('created')],
      ...list.map((u) => [u.displayName || '', u.username, roleName(u.role), u.status === 'active' ? t('active') : t('disabled'), yn(u.hasEmail), yn(u.emailVerified), yn(u.hasPhone), yn(u.appleLinked), u.language || '', yn(u.online), fmtDate(u.createdAt)]),
    ]);
  });
  viewEl().querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return; openUserDrawer(tr.dataset.uid);
  }));
  viewEl().querySelectorAll('.role-select').forEach((s) => s.addEventListener('change', (e) => onRoleChange(e.target.dataset.uid, e.target.value, e.target)));
  viewEl().querySelectorAll('[data-act="ban"]').forEach((b) => b.addEventListener('click', () => onStatus(b.dataset.uid, 'disabled')));
  viewEl().querySelectorAll('[data-act="unban"]').forEach((b) => b.addEventListener('click', () => onStatus(b.dataset.uid, 'active')));
}
// 批量操作：确认 → 调 /bulk → 报告成功/失败 → 重载当页。
async function onBulk(action) {
  const ids = [...state.usersSelected];
  if (action === 'clear') { state.usersSelected.clear(); renderUsers(); return; }
  if (ids.length === 0) return;
  const n = ids.length;
  let role;
  if (action === 'role') {
    role = await promptRole();
    if (!role) return;
    if (!(await confirmDialog(t('bulkConfirmRole').replace('%n', String(n)).replace('%s', roleName(role))))) return;
  } else {
    const msgKey = action === 'disable' ? 'bulkConfirmBan' : action === 'enable' ? 'bulkConfirmUnban' : 'bulkConfirmDelete';
    if (!(await confirmDialog(t(msgKey).replace('%n', String(n))))) return;
  }
  try {
    const r = await api('/api/admin/users/bulk', { method: 'POST', body: { ids, action, ...(role ? { role } : {}) } });
    toast(t('bulkDone').replace('%s', String(r.succeeded)).replace('%f', String(r.failed)), r.failed ? 'error' : 'success');
    state.usersSelected.clear();
    loadUsers(); loadOverviewBadge();
  } catch (err) { toast(errText(err.code), 'error'); }
}
// 角色选择弹窗（批量改角色用），返回角色或 null。
function promptRole() {
  return new Promise((resolve) => {
    const mask = document.createElement('div'); mask.className = 'drawer-mask'; mask.style.zIndex = '70';
    const box = document.createElement('div'); box.className = 'modal-overlay';
    const opts = ['blind', 'helper', 'family', 'admin', 'developer']
      .map((r) => `<button class="btn block role-pick" data-role="${r}">${esc(roleName(r))}</button>`).join('');
    box.innerHTML = `<div class="card confirm-card" role="dialog" aria-modal="true">
      <p class="confirm-msg">${esc(t('pickRole'))}</p>
      <div class="role-picks">${opts}</div>
      <div class="confirm-actions"><button class="btn ghost" data-no>${esc(state.lang === 'en' ? 'Cancel' : '取消')}</button></div></div>`;
    document.body.appendChild(mask); document.body.appendChild(box);
    const done = (v) => { mask.remove(); box.remove(); resolve(v); };
    mask.addEventListener('click', () => done(null));
    box.querySelector('[data-no]').addEventListener('click', () => done(null));
    box.querySelectorAll('.role-pick').forEach((b) => b.addEventListener('click', () => done(b.dataset.role)));
  });
}
async function onRoleChange(uid, role, selectEl) {
  const u = state.users.find((x) => x.id === uid); if (!u || u.role === role) return;
  if (!(await confirmDialog(t('confirmRole').replace('%s', roleName(role))))) { if (selectEl) selectEl.value = u.role; return; }
  try {
    const r = await api(`/api/admin/users/${uid}/role`, { method: 'POST', body: { role } });
    u.role = r.user.role; toast(t('roleChanged'), 'success'); renderUsers();
  } catch (err) { if (selectEl) selectEl.value = u.role; toast(errText(err.code), 'error'); }
}
async function onStatus(uid, status) {
  if (!(await confirmDialog(status === 'disabled' ? t('confirmBan') : t('confirmUnban')))) return;
  try {
    const r = await api(`/api/admin/users/${uid}/status`, { method: 'POST', body: { status } });
    const u = state.users.find((x) => x.id === uid); if (u) u.status = r.user.status;
    toast(status === 'disabled' ? t('banned') : t('unbanned'), 'success'); renderUsers();
  } catch (err) { toast(errText(err.code), 'error'); }
}

// ---------------------------------------------------------------- user drawer
async function openUserDrawer(uid) {
  const mask = document.createElement('div'); mask.className = 'drawer-mask';
  const drawer = document.createElement('aside'); drawer.className = 'drawer'; drawer.setAttribute('role', 'dialog'); drawer.setAttribute('aria-modal', 'true');
  drawer.innerHTML = `<div class="drawer-head"><b>${esc(t('detail'))}</b><div class="grow1"></div><button class="btn ghost sm" data-close>${esc(t('close'))}</button></div><div class="drawer-body"><div class="loading"><span class="spinner"></span></div></div>`;
  document.body.appendChild(mask); document.body.appendChild(drawer);
  const close = () => { mask.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  mask.addEventListener('click', close);
  drawer.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  try {
    const d = await api(`/api/admin/users/${uid}`);
    const u = d.user; // 客服操作后就地改写本对象并重绘，避免整页刷新
    const body = drawer.querySelector('.drawer-body');
    let editing = false;
    const yn = (b) => (b ? t('yes') : t('no'));
    const emptyMini = (txt) => `<div class="mini text-faint">${esc(txt || '—')}</div>`;
    const linksHTML = (d.links || []).map((l) => `<div class="mini"><b>${esc(l.otherName)}</b> · ${esc(l.relation || '—')} ${l.isEmergency ? '· ⚠️' : ''} <span class="pill ${l.status === 'accepted' ? 'ok' : 'off'} fr">${esc(l.status === 'accepted' ? (state.lang === 'en' ? 'linked' : '已绑定') : (state.lang === 'en' ? 'pending' : '待确认'))}</span></div>`).join('') || emptyMini();
    const callsHTML = (d.recentCalls || []).map((c) => `<div class="mini">${esc(t('dir')[c.direction] || c.direction)} · ${esc(c.peerName)} · <span class="text-dim">${esc(t('callStatus')[c.status] || c.status)}</span><span class="when">${esc(fmtDate(c.createdAt))}</span></div>`).join('') || `<div class="empty pad"><p>${esc(t('noCalls'))}</p></div>`;
    const warnings = d.warnings || [];
    const warningsHTML = warnings.map((w) => `<div class="mini warn-mini"><span class="pill off">⚠</span> ${esc(w.reason)}<span class="when">${esc(t('warnedBy'))} ${esc(w.byAdminName)} · ${esc(fmtDate(w.at))}</span></div>`).join('') || emptyMini(t('noWarnings'));
    const blockingHTML = (d.blocking || []).map((b) => `<div class="mini">🚫 ${esc(b.otherName)}<span class="when">${esc(fmtDate(b.createdAt))}</span></div>`).join('') || emptyMini();
    const blockedByHTML = (d.blockedBy || []).map((b) => `<div class="mini">${esc(b.otherName)} 🚫<span class="when">${esc(fmtDate(b.createdAt))}</span></div>`).join('') || emptyMini();
    const repBy = (d.reportsBy || []).map((r) => `<div class="mini">→ ${esc(r.targetName)} · ${esc(r.reason)} <span class="pill ${r.status === 'open' ? 'off' : 'ok'} fr">${esc(r.decision ? decisionLabel(r.decision) : (r.status === 'open' ? t('open') : t('resolved')))}</span></div>`).join('') || emptyMini();
    const repAg = (d.reportsAgainst || []).map((r) => `<div class="mini">${esc(r.reporterName)} → · ${esc(r.reason)} <span class="pill ${r.status === 'open' ? 'off' : 'ok'} fr">${esc(r.decision ? decisionLabel(r.decision) : (r.status === 'open' ? t('open') : t('resolved')))}</span></div>`).join('') || emptyMini();
    const recsHTML = (d.recordings || []).map((r) => `<div class="mini">call ${esc((r.callId || '').slice(0, 10))} · ${esc(r.reason || '—')}<span class="when">${esc(fmtDate(r.recordedAt))}</span></div>`).join('') || emptyMini();
    const passkeysHTML = (d.passkeys || []).map((p) => `<div class="mini">🔑 ${esc(p.deviceName || p.id.slice(0, 8))}<span class="when">${esc(fmtDate(p.createdAt))}</span></div>`).join('') || emptyMini();
    function supportButtons() {
      const btns = [`<button class="btn sm" data-sup="edit">✎ ${esc(t('editUser'))}</button>`];
      if (u.email) btns.push(`<button class="btn sm" data-sup="verify">${esc(u.emailVerified ? t('markUnverified') : t('markVerified'))}</button>`);
      if (u.appleLinked) btns.push(`<button class="btn sm" data-sup="unlink">${esc(t('unlinkApple'))}</button>`);
      if ((u.passkeyCount || 0) > 0) btns.push(`<button class="btn sm" data-sup="clearpk">${esc(t('clearPasskeys'))}</button>`);
      btns.push(`<button class="btn sm" data-sup="resetpw">${esc(t('resetPassword'))}</button>`);
      btns.push(`<button class="btn sm" data-sup="export">⬇ ${esc(t('exportData'))}</button>`);
      btns.push(`<button class="btn danger sm" data-sup="logout">${esc(t('forceLogout'))}</button>`);
      return btns.join('');
    }
    // 只读资料卡。
    function infoHTML() {
      return `<dl class="kv">
          <dt>${esc(t('role'))}</dt><dd>${rolePill(u.role)}</dd>
          <dt>${esc(t('status'))}</dt><dd>${u.status === 'active' ? `<span class="pill ok">${esc(t('active'))}</span>` : `<span class="pill role-admin">${esc(t('disabled'))}</span>`}</dd>
          <dt>${esc(t('online2'))}</dt><dd><span class="dot ${u.online ? 'on' : 'gone'}"></span> ${u.online ? esc(t('online')) : '—'}</dd>
          <dt>${esc(t('email'))}</dt><dd>${u.email ? esc(u.email) + (u.emailVerified ? ` <span class="pill ok">${esc(t('verified'))}</span>` : ` <span class="pill off">${esc(t('notVerified'))}</span>`) : `<span class="text-faint">${esc(t('none'))}</span>`}</dd>
          <dt>${esc(t('phone'))}</dt><dd>${u.phone ? esc(u.phone) : `<span class="text-faint">${esc(t('none'))}</span>`}</dd>
          <dt>${esc(t('language'))}</dt><dd>${u.language ? esc(u.language) : '—'}</dd>
          <dt>${esc(t('appleId'))}</dt><dd>${u.appleLinked ? esc(t('linked')) : `<span class="text-faint">${esc(t('notLinked'))}</span>`}</dd>
          <dt>${esc(t('passkeys'))}</dt><dd>${u.passkeyCount || 0}</dd>
          <dt>${esc(t('sessionsLabel'))}</dt><dd>${u.sessions ?? 0}</dd>
          <dt>${esc(t('tokenVersionLabel'))}</dt><dd>${u.tokenVersion ?? 0}</dd>
          <dt>${esc(t('usernameCustomizedLabel'))}</dt><dd>${yn(u.usernameCustomized)}</dd>
          <dt>${esc(t('avatarLabel'))}</dt><dd>${yn(u.hasAvatar)}</dd>
          <dt>${esc(t('voipLabel'))}</dt><dd>${yn(u.hasVoipToken)}</dd>
          <dt>${esc(t('apnsLabel'))}</dt><dd>${yn(u.hasApnsToken)}</dd>
          <dt>${esc(t('legalConsentLabel'))}</dt><dd>${u.legalConsentVersion ? esc(u.legalConsentVersion) + (u.legalConsentAt ? ' · ' + esc(fmtDate(u.legalConsentAt)) : '') : '—'}</dd>
          <dt>${esc(t('created'))}</dt><dd>${esc(fmtDate(u.createdAt))}</dd>
        </dl>`;
    }
    // 可编辑表单（CSP 友好：用 class，不内联 style）。
    function editHTML() {
      const f = (id, label, val, type) => `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type || 'text'}" value="${esc(val ?? '')}" autocapitalize="none" spellcheck="false"/></div>`;
      return `<div class="edit-form">
        ${f('eDisplay', t('fldDisplayName'), u.displayName)}
        ${f('eUsername', t('fldUsername'), u.username)}
        ${f('eEmail', t('fldEmail'), u.email)}
        ${f('ePhone', t('fldPhone'), u.phone)}
        ${f('eLang', t('fldLanguage'), u.language)}
        ${u.hasAvatar ? `<label class="chk"><input type="checkbox" id="eClearAvatar"/> ${esc(t('clearAvatarBtn'))}</label>` : ''}
        <div class="confirm-actions">
          <button class="btn ghost" data-edit="cancel">${esc(t('cancelEdit'))}</button>
          <button class="btn primary" data-edit="save">${esc(t('save'))}</button>
        </div>
      </div>`;
    }
    function paint() {
      body.innerHTML = `
        <div class="user-cell drawer-user">${avatarHTML(u, true)}<div><div class="nm">${esc(u.displayName || '—')}</div><div class="un">@${esc(u.username)}</div></div></div>
        ${editing ? editHTML() : infoHTML()}
        ${editing ? '' : `
        <div class="section"><h3>${esc(t('support'))}</h3><div class="support">${supportButtons()}</div></div>
        <div class="section"><h3>${esc(t('featOverrides'))}</h3>
          <p class="section-sub">${esc(t('featOverridesDesc'))}</p>
          <div class="card">${FEATURE_ORDER.map((k) => `
            <div class="form-row"><div class="lab">${esc(featLabel(k))}</div>
              <label class="switch"><input type="checkbox" data-fov="${esc(k)}" ${(u.featureOverrides || {})[k] === false ? '' : 'checked'}/><span class="track"></span></label></div>`).join('')}</div>
        </div>
        <div class="section"><h3>${esc(t('warnings'))} (${warnings.length})</h3><div class="mini-list">${warningsHTML}</div></div>
        <div class="section"><h3>${esc(t('linkedRelations'))} (${(d.links || []).length})</h3><div class="mini-list">${linksHTML}</div></div>
        <div class="section"><h3>${esc(t('blockingLabel'))} (${(d.blocking || []).length}) · ${esc(t('blockedByLabel'))} (${(d.blockedBy || []).length})</h3><div class="mini-list">${blockingHTML}${blockedByHTML}</div></div>
        <div class="section"><h3>${esc(t('reportsByLabel'))} (${(d.reportsBy || []).length})</h3><div class="mini-list">${repBy}</div></div>
        <div class="section"><h3>${esc(t('reportsAgainstLabel'))} (${(d.reportsAgainst || []).length})</h3><div class="mini-list">${repAg}</div></div>
        <div class="section"><h3>${esc(t('passkeys'))} (${(d.passkeys || []).length})</h3><div class="mini-list">${passkeysHTML}</div></div>
        <div class="section"><h3>${esc(t('recordingsOwnLabel'))} (${(d.recordings || []).length})</h3><div class="mini-list">${recsHTML}</div></div>
        <div class="section"><h3>${esc(t('recentCalls'))}</h3><div class="mini-list">${callsHTML}</div></div>
        <div class="section danger-zone"><h3>${esc(t('dangerZone'))}</h3><div class="support"><button class="btn danger sm" data-sup="delete">🗑 ${esc(t('deleteUser'))}</button></div></div>`}`;
      if (editing) {
        body.querySelector('[data-edit="cancel"]').addEventListener('click', () => { editing = false; paint(); });
        body.querySelector('[data-edit="save"]').addEventListener('click', () => onSaveEdit(u, body, () => { editing = false; paint(); }));
      } else {
        body.querySelectorAll('[data-sup]').forEach((b) => b.addEventListener('click', () => {
          if (b.dataset.sup === 'edit') { editing = true; paint(); return; }
          onSupport(b.dataset.sup, u, paint, close);
        }));
        body.querySelectorAll('[data-fov]').forEach((c) => c.addEventListener('change', (e) =>
          onFeatureOverride(u, e.target.dataset.fov, e.target.checked, e.target)));
      }
    }
    paint();
  } catch (err) {
    drawer.querySelector('.drawer-body').innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`;
  }
}
// 客服操作：确认 → 调接口 → 就地更新内存中的 user 字段 → 重绘抽屉 + 顶部统计/列表保持一致。
async function onSupport(action, u, repaint, closeDrawer) {
  try {
    if (action === 'verify') {
      const next = !u.emailVerified;
      if (!(await confirmDialog(next ? t('confirmMarkVerified') : t('confirmMarkUnverified')))) return;
      const r = await api(`/api/admin/users/${u.id}/verify-email`, { method: 'POST', body: { verified: next } });
      u.emailVerified = !!r.emailVerified;
      const su = state.users.find((x) => x.id === u.id); if (su) su.emailVerified = u.emailVerified;
      toast(u.emailVerified ? t('emailMarkedVerified') : t('emailMarkedUnverified'), 'success');
    } else if (action === 'unlink') {
      if (!(await confirmDialog(t('confirmUnlinkApple')))) return;
      await api(`/api/admin/users/${u.id}/unlink-apple`, { method: 'POST' });
      u.appleLinked = false;
      const su = state.users.find((x) => x.id === u.id); if (su) su.appleLinked = false;
      toast(t('appleUnlinked'), 'success');
    } else if (action === 'clearpk') {
      if (!(await confirmDialog(t('confirmClearPasskeys')))) return;
      const r = await api(`/api/admin/users/${u.id}/clear-passkeys`, { method: 'POST' });
      const n = u.passkeyCount || 0; u.passkeyCount = r.passkeys || 0;
      toast(t('passkeysCleared').replace('%s', String(r.cleared ?? n)), 'success');
    } else if (action === 'logout') {
      if (!(await confirmDialog(t('confirmForceLogout')))) return;
      await api(`/api/admin/users/${u.id}/force-logout`, { method: 'POST' });
      u.sessions = 0;
      toast(t('forcedLogout'), 'success');
    } else if (action === 'resetpw') {
      const pw = await promptDialog(t('resetPassword'), t('newPasswordPh'), 'password');
      if (pw === null) return;
      if (pw.length < 6) { toast(t('err_invalid_input'), 'error'); return; }
      if (!(await confirmDialog(t('confirmResetPassword')))) return;
      await api(`/api/admin/users/${u.id}/reset-password`, { method: 'POST', body: { newPassword: pw } });
      u.sessions = 0;
      toast(t('passwordResetDone'), 'success');
    } else if (action === 'export') {
      const data = await api(`/api/admin/users/${u.id}/export`);
      downloadJSON(`beeurei-user-${u.username}.json`, data);
      toast(t('dataExported'), 'success');
    } else if (action === 'delete') {
      if (!(await confirmDialog(t('confirmDeleteUser')))) return;
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      toast(t('userDeleted'), 'success');
      state.users = state.users.filter((x) => x.id !== u.id);
      if (currentRoute() === 'users') renderUsers();
      if (typeof closeDrawer === 'function') closeDrawer();
      return; // 用户已删，不再重绘抽屉
    }
    if (typeof repaint === 'function') repaint();
    if (currentRoute() === 'users') renderUsers();
  } catch (err) { toast(errText(err.code), 'error'); }
}

// 单用户功能覆盖：勾选=随全站(清除覆盖→null)，取消勾选=对该用户强制关(false)。乐观，失败回滚。
async function onFeatureOverride(u, key, enabled, el) {
  try {
    const r = await api(`/api/admin/users/${u.id}/features`, { method: 'PUT', body: { overrides: { [key]: enabled ? null : false } } });
    u.featureOverrides = r.featureOverrides || {};
    toast(t('featuresSaved'), 'success');
  } catch (err) { if (el) el.checked = !enabled; toast(errText(err.code), 'error'); }
}
// 保存用户资料编辑：只提交相对当前值有变化的字段（空串=清除→null）。
async function onSaveEdit(u, body, done) {
  const val = (id) => (body.querySelector('#' + id)?.value ?? '').trim();
  const patch = {};
  const displayName = val('eDisplay'); if (displayName && displayName !== (u.displayName || '')) patch.displayName = displayName;
  const username = val('eUsername'); if (username && username !== (u.username || '')) patch.username = username;
  const email = val('eEmail'); if (email !== (u.email || '')) patch.email = email === '' ? null : email;
  const phone = val('ePhone'); if (phone !== (u.phone || '')) patch.phone = phone === '' ? null : phone;
  const language = val('eLang'); if (language !== (u.language || '')) patch.language = language === '' ? null : language;
  if (body.querySelector('#eClearAvatar')?.checked) patch.clearAvatar = true;
  if (Object.keys(patch).length === 0) { done(); return; }
  try {
    const r = await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: patch });
    // 用返回的 publicUser 同步内存对象（含 displayName/username/role/status/avatar），其余明细下次打开重取。
    Object.assign(u, { displayName: r.user.displayName, username: r.user.username });
    if (patch.email !== undefined) { u.email = patch.email === null ? null : patch.email; u.emailVerified = patch.email === null ? false : false; }
    if (patch.phone !== undefined) u.phone = patch.phone === null ? null : patch.phone;
    if (patch.language !== undefined) u.language = patch.language === null ? null : patch.language;
    if (patch.clearAvatar) { u.hasAvatar = false; u.avatar = undefined; }
    const su = state.users.find((x) => x.id === u.id);
    if (su) { su.displayName = u.displayName; su.username = u.username; }
    toast(t('profileSaved'), 'success');
    done();
    if (currentRoute() === 'users') renderUsers();
  } catch (err) { toast(errText(err.code), 'error'); }
}

// 简单输入弹窗（返回字符串或 null=取消）。CSP 友好。
function promptDialog(title, placeholder, type) {
  return new Promise((resolve) => {
    const mask = document.createElement('div'); mask.className = 'drawer-mask'; mask.style.zIndex = '70';
    const box = document.createElement('div'); box.className = 'modal-overlay';
    box.innerHTML = `<div class="card confirm-card" role="dialog" aria-modal="true">
      <p class="confirm-msg">${esc(title)}</p>
      <div class="field"><input id="promptInput" type="${type || 'text'}" placeholder="${esc(placeholder || '')}" autocapitalize="none" spellcheck="false"/></div>
      <div class="confirm-actions">
        <button class="btn" data-no>${esc(state.lang === 'en' ? 'Cancel' : '取消')}</button>
        <button class="btn ink" data-yes>${esc(state.lang === 'en' ? 'OK' : '确定')}</button>
      </div></div>`;
    document.body.appendChild(mask); document.body.appendChild(box);
    const done = (v) => { mask.remove(); box.remove(); resolve(v); };
    mask.addEventListener('click', () => done(null));
    box.querySelector('[data-no]').addEventListener('click', () => done(null));
    box.querySelector('[data-yes]').addEventListener('click', () => done(box.querySelector('#promptInput').value));
    const inp = box.querySelector('#promptInput');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(inp.value); });
    inp.focus();
  });
}

// ---------------------------------------------------------------- csv export
function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => {
    let s = String(c ?? '');
    // 防 CSV 公式注入：以 = + - @ 或制表/回车开头的单元格前置 '，令 Excel/Sheets 当文本而非公式。
    // 否则恶意 displayName（不受字符集限制）如 =HYPERLINK(...)/=cmd|... 会在管理员导出打开时执行、泄数据。
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
  // 前置 BOM：Excel 据此识别 UTF-8，避免中文乱码。
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}
// JSON 导出（GDPR 数据导出用）：缩进 2、UTF-8。
function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------- relationships (links)
async function loadLinks() {
  showLoading();
  try { state.links = (await api('/api/admin/links')).links || []; renderLinks(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function filteredLinks() {
  const q = state.linksQuery.trim().toLowerCase();
  const list = q ? state.links.filter((l) => (l.ownerName || '').toLowerCase().includes(q) || (l.memberName || '').toLowerCase().includes(q)) : state.links;
  return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function linkStatusPill(s) {
  const map = { accepted: ['ok', t('linkAccepted')], pending: ['off', t('linkPending')], declined: ['role-admin', t('linkDeclined')] };
  const [cls, label] = map[s] || ['off', s];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}
function renderLinks() {
  const list = filteredLinks();
  const rows = list.map((l) => `
    <tr>
      <td><div class="nm">${esc(l.ownerName)}</div><div class="un">${esc(roleName(l.ownerRole) || '—')}</div></td>
      <td><div class="nm">${esc(l.memberName)}</div><div class="un">${esc(roleName(l.memberRole) || '—')}</div></td>
      <td>${esc(l.relation || '—')}</td>
      <td>${l.isEmergency ? `<span class="pill role-admin">⚠️ ${esc(t('emergency'))}</span>` : '—'}</td>
      <td>${linkStatusPill(l.status)}</td>
      <td class="cell-date">${esc(fmtDate(l.createdAt))}</td>
    </tr>`).join('');
  viewEl().innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="lq" type="search" placeholder="${esc(t('searchLinks'))}" value="${esc(state.linksQuery)}" /></div>
      <button class="btn ghost" data-action="reloadLinks">↻ ${esc(t('refresh'))}</button>
      <button class="btn ghost" data-action="exportLinks" ${list.length ? '' : 'disabled'}>⬇ ${esc(t('exportCsv'))}</button>
    </div>
    <div class="table-wrap">
      ${list.length ? `<table><thead><tr>
        <th>${esc(t('owner'))}</th><th>${esc(t('member'))}</th><th>${esc(t('relationCol'))}</th><th>${esc(t('emergency'))}</th><th>${esc(t('status'))}</th><th>${esc(t('created'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="ico">🔗</div><p>${esc(t('noLinks'))}</p></div>`}
    </div>`;
  $('#lq').addEventListener('input', (e) => { state.linksQuery = e.target.value; renderLinks(); $('#lq').focus(); });
  viewEl().querySelector('[data-action="reloadLinks"]').addEventListener('click', loadLinks);
  viewEl().querySelector('[data-action="exportLinks"]').addEventListener('click', () => {
    downloadCSV('beeurei-relationships.csv', [
      [t('owner'), t('role'), t('member'), t('role'), t('relationCol'), t('emergency'), t('status'), t('created')],
      ...filteredLinks().map((l) => [l.ownerName, roleName(l.ownerRole), l.memberName, roleName(l.memberRole), l.relation || '', l.isEmergency ? 'yes' : 'no', l.status, fmtDate(l.createdAt)]),
    ]);
  });
}

// ---------------------------------------------------------------- calls (site-wide)
async function loadCalls() {
  showLoading();
  try { state.calls = (await api('/api/admin/calls?limit=300')).calls || []; renderCalls(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function filteredCalls() {
  const q = state.callsQuery.trim().toLowerCase();
  return q ? state.calls.filter((c) => (c.callerName || '').toLowerCase().includes(q) || (c.calleeName || '').toLowerCase().includes(q)) : state.calls;
}
function callStatusName(s) { return (I18N[state.lang].callStatus[s]) || s; }
function renderCalls() {
  const list = filteredCalls();
  const rows = list.map((c) => `
    <tr>
      <td><div class="nm">${esc(c.callerName)}</div></td>
      <td><span class="arrow">→</span></td>
      <td><div class="nm">${esc(c.calleeName)}</div></td>
      <td>${esc(callStatusName(c.status))}</td>
      <td class="cell-date">${esc(fmtDate(c.createdAt))}</td>
    </tr>`).join('');
  viewEl().innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="cq" type="search" placeholder="${esc(t('searchCalls'))}" value="${esc(state.callsQuery)}" /></div>
      <button class="btn ghost" data-action="reloadCalls">↻ ${esc(t('refresh'))}</button>
      <button class="btn ghost" data-action="exportCalls" ${list.length ? '' : 'disabled'}>⬇ ${esc(t('exportCsv'))}</button>
    </div>
    <div class="table-wrap">
      ${list.length ? `<table><thead><tr>
        <th>${esc(t('caller'))}</th><th></th><th>${esc(t('callee'))}</th><th>${esc(t('status'))}</th><th>${esc(t('time'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="ico">📞</div><p>${esc(t('noCalls'))}</p></div>`}
    </div>`;
  $('#cq').addEventListener('input', (e) => { state.callsQuery = e.target.value; renderCalls(); $('#cq').focus(); });
  viewEl().querySelector('[data-action="reloadCalls"]').addEventListener('click', loadCalls);
  viewEl().querySelector('[data-action="exportCalls"]').addEventListener('click', () => {
    downloadCSV('beeurei-calls.csv', [
      [t('caller'), t('callee'), t('status'), t('time')],
      ...filteredCalls().map((c) => [c.callerName, c.calleeName, callStatusName(c.status), fmtDate(c.createdAt)]),
    ]);
  });
}

// ---------------------------------------------------------------- blocks (site-wide)
async function loadBlocks() {
  showLoading();
  try { state.blocks = (await api('/api/admin/blocks')).blocks || []; renderBlocks(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function filteredBlocks() {
  const q = state.blocksQuery.trim().toLowerCase();
  return q ? state.blocks.filter((b) => (b.blockerName || '').toLowerCase().includes(q) || (b.blockedName || '').toLowerCase().includes(q)) : state.blocks;
}
function renderBlocks() {
  const list = filteredBlocks();
  const rows = list.map((b) => `
    <tr>
      <td><div class="nm">${esc(b.blockerName)}</div></td>
      <td><span class="arrow">🚫</span></td>
      <td><div class="nm">${esc(b.blockedName)}</div></td>
      <td class="cell-date">${esc(fmtDate(b.createdAt))}</td>
    </tr>`).join('');
  viewEl().innerHTML = `
    <div class="toolbar">
      <div class="search"><input id="bq" type="search" placeholder="${esc(t('searchBlocks'))}" value="${esc(state.blocksQuery)}" /></div>
      <button class="btn ghost" data-action="reloadBlocks">↻ ${esc(t('refresh'))}</button>
      <button class="btn ghost" data-action="exportBlocks" ${list.length ? '' : 'disabled'}>⬇ ${esc(t('exportCsv'))}</button>
    </div>
    <div class="table-wrap">
      ${list.length ? `<table><thead><tr>
        <th>${esc(t('blocker'))}</th><th></th><th>${esc(t('blocked'))}</th><th>${esc(t('time'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="ico">🚫</div><p>${esc(t('noBlocks'))}</p></div>`}
    </div>`;
  $('#bq').addEventListener('input', (e) => { state.blocksQuery = e.target.value; renderBlocks(); $('#bq').focus(); });
  viewEl().querySelector('[data-action="reloadBlocks"]').addEventListener('click', loadBlocks);
  viewEl().querySelector('[data-action="exportBlocks"]').addEventListener('click', () => {
    downloadCSV('beeurei-blocks.csv', [
      [t('blocker'), t('blocked'), t('time')],
      ...filteredBlocks().map((b) => [b.blockerName, b.blockedName, fmtDate(b.createdAt)]),
    ]);
  });
}

// ---------------------------------------------------------------- live calls（实时通话）
function fmtCallDuration(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
async function loadLiveCalls() {
  showLoading();
  try {
    const r = await api('/api/admin/calls/active');
    state.live = r.calls || []; state.liveNow = r.nowMs || Date.now();
    renderLiveCalls();
    // 实时性：每 5s 自动刷新（仅在本路由时）。沿用 dashboard 的单一持久定时器约定。
    if (!state.liveTimer) state.liveTimer = setInterval(async () => {
      if (currentRoute() === 'live') {
        try { const rr = await api('/api/admin/calls/active'); state.live = rr.calls || []; state.liveNow = rr.nowMs || Date.now(); renderLiveCalls(); } catch {}
      }
    }, 5000);
  } catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function renderLiveCalls() {
  const list = state.live;
  const roleDot = (m) => `<span class="dot ${m.online ? 'on' : 'gone'}" title="${m.online ? esc(t('online')) : ''}"></span>`;
  const memberChip = (m) => `<button class="live-member" data-uid="${esc(m.userId)}">${roleDot(m)} <span class="nm">${esc(m.name)}</span> <span class="pill role-${esc(m.role)}">${esc(roleName(m.role))}</span></button>`;
  const card = (c) => `
    <div class="card live-call">
      <div class="live-head">
        <span class="live-dot" aria-hidden="true"></span>
        <b>${esc(fmtCallDuration(c.durationSec))}</b>
        <span class="text-dim">${esc(t('liveParticipants'))}: ${c.members.length}</span>
        ${c.hasAdminObserver ? `<span class="pill role-admin">${esc(t('liveObserved'))}</span>` : ''}
        <span class="grow1"></span>
        ${c.hasAdminObserver ? '' : `<button class="btn sm" data-observe="${esc(c.callId)}">👁 ${esc(t('observe'))}</button>`}
        <button class="btn danger sm" data-end="${esc(c.callId)}">${esc(t('liveForceEnd'))}</button>
      </div>
      <div class="live-members">${c.members.map(memberChip).join('')}</div>
    </div>`;
  viewEl().innerHTML = `
    <div class="toolbar">
      <span class="section-sub">${esc(t('liveCallsDesc'))}</span>
      <span class="grow1"></span>
      <button class="btn ghost" data-action="reloadLive">↻ ${esc(t('refresh'))}</button>
    </div>
    ${list.length ? `<div class="live-list">${list.map(card).join('')}</div>`
      : `<div class="empty"><div class="ico">📞</div><p>${esc(t('noLiveCalls'))}</p></div>`}`;
  viewEl().querySelector('[data-action="reloadLive"]').addEventListener('click', loadLiveCalls);
  viewEl().querySelectorAll('[data-end]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(t('liveConfirmEnd')))) return;
    try { await api(`/api/admin/calls/${b.dataset.end}/end`, { method: 'POST' }); toast(t('liveCallEnded'), 'success'); loadLiveCalls(); }
    catch (err) { toast(errText(err.code), 'error'); }
  }));
  viewEl().querySelectorAll('[data-observe]').forEach((b) => b.addEventListener('click', () => {
    const c = state.live.find((x) => x.callId === b.dataset.observe);
    if (c) startObserver(c);
  }));
}

// ---------------------------------------------------------------- web observer (WebRTC)
// 浏览器内旁观通话：与 iOS 旁观一致，经 /ws 用 obs-* 定向握手接收各参与者音视频，可开麦说话、强制结束。
// 合规：服务端在管理员加入时即通知通话双方（横幅+语音），绝非隐蔽。
function startObserver(call) {
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const pcs = {};            // peerId -> RTCPeerConnection
  const tiles = {};          // peerId -> { wrap, video, label } DOM
  const pendingIce = {};     // peerId -> [candidate] (在 setRemoteDescription 前缓冲)
  const hasRemote = {};      // peerId -> bool
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  let ws = null, localStream = null, speaking = false, muted = false, closed = false;

  // —— UI 覆盖层 ——
  const mask = document.createElement('div'); mask.className = 'drawer-mask'; mask.style.zIndex = '70';
  const box = document.createElement('div'); box.className = 'modal-overlay';
  box.innerHTML = `<div class="card observe-card" role="dialog" aria-modal="true" aria-label="${esc(t('observeTitle'))}">
    <div class="observe-head">
      <span class="live-dot" aria-hidden="true"></span>
      <b>${esc(t('observeTitle'))}</b>
      <span class="observe-status text-dim">${esc(t('observeConnecting'))}</span>
      <span class="grow1"></span>
      <span class="text-dim observe-note">${esc(t('observeNotice'))}</span>
    </div>
    <div class="observe-grid"></div>
    <div class="observe-actions">
      <button class="btn" data-speak>🎤 ${esc(t('observeSpeak'))}</button>
      <button class="btn" data-mute hidden>🔇 ${esc(t('observeMute'))}</button>
      <span class="grow1"></span>
      <button class="btn danger" data-forceend>${esc(t('observeForceEnd'))}</button>
      <button class="btn ink" data-leave>${esc(t('observeLeave'))}</button>
    </div>
  </div>`;
  document.body.appendChild(mask); document.body.appendChild(box);
  const grid = box.querySelector('.observe-grid');
  const statusEl = box.querySelector('.observe-status');
  const setStatus = (s) => { statusEl.textContent = s; };

  function ensureTile(peerId, name) {
    if (tiles[peerId]) { if (name) tiles[peerId].label.textContent = name; return tiles[peerId]; }
    const wrap = document.createElement('div'); wrap.className = 'observe-tile';
    const video = document.createElement('video'); video.autoplay = true; video.playsInline = true;
    const label = document.createElement('div'); label.className = 'observe-label'; label.textContent = name || peerId;
    const hint = document.createElement('div'); hint.className = 'observe-hint'; hint.textContent = t('observeWaiting');
    wrap.appendChild(video); wrap.appendChild(hint); wrap.appendChild(label); grid.appendChild(wrap);
    const tile = { wrap, video, label, hint };
    tiles[peerId] = tile; return tile;
  }
  function dropTile(peerId) { const x = tiles[peerId]; if (x) { x.wrap.remove(); delete tiles[peerId]; } }

  function ensurePC(peerId) {
    if (pcs[peerId]) return pcs[peerId];
    const pc = new RTCPeerConnection({ iceServers });
    pcs[peerId] = pc;
    pc.onicecandidate = (e) => { if (e.candidate && ws && ws.readyState === 1) send({ type: 'obs-ice', to: peerId, candidate: e.candidate.candidate, sdpMid: e.candidate.sdpMid, sdpMLineIndex: e.candidate.sdpMLineIndex }); };
    pc.ontrack = (e) => { const tile = ensureTile(peerId); if (tile.video.srcObject !== e.streams[0]) tile.video.srcObject = e.streams[0]; if (e.track.kind === 'video') tile.hint.hidden = true; };
    if (localStream) localStream.getTracks().forEach((tr) => pc.addTrack(tr, localStream)); // 开麦后新建的 PC 直接带麦
    return pc;
  }

  function send(obj) { try { ws.send(JSON.stringify(obj)); } catch { /* socket closed */ } }

  async function onObsOffer(peerId, sdp) {
    const pc = ensurePC(peerId);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    hasRemote[peerId] = true; flushIce(peerId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: 'obs-answer', to: peerId, sdp: answer.sdp });
    setStatus(t('observeTitle'));
  }
  async function onObsAnswer(peerId, sdp) {
    const pc = pcs[peerId]; if (!pc) return;
    await pc.setRemoteDescription({ type: 'answer', sdp });
    hasRemote[peerId] = true; flushIce(peerId);
  }
  function onObsIce(peerId, c) {
    const cand = new RTCIceCandidate({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });
    if (hasRemote[peerId] && pcs[peerId]) pcs[peerId].addIceCandidate(cand).catch(() => {});
    else (pendingIce[peerId] = pendingIce[peerId] || []).push(cand);
  }
  function flushIce(peerId) { (pendingIce[peerId] || []).forEach((c) => pcs[peerId] && pcs[peerId].addIceCandidate(c).catch(() => {})); pendingIce[peerId] = []; }

  // 开麦说话：取麦克风 → 加到所有现有 PC → 各自重协商（admin 作为 offerer，对端 iOS 应答）。
  async function enableSpeak() {
    try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast(t('observeMicDenied'), 'error'); return; }
    speaking = true;
    box.querySelector('[data-speak]').hidden = true;
    box.querySelector('[data-mute]').hidden = false;
    for (const [peerId, pc] of Object.entries(pcs)) {
      localStream.getAudioTracks().forEach((tr) => pc.addTrack(tr, localStream));
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: 'obs-offer', to: peerId, sdp: offer.sdp });
      } catch { /* ignore single-peer renegotiation failure */ }
    }
  }
  function toggleMute() {
    muted = !muted;
    if (localStream) localStream.getAudioTracks().forEach((tr) => (tr.enabled = !muted));
    const mb = box.querySelector('[data-mute]');
    mb.textContent = (muted ? '🎙 ' : '🔇 ') + (muted ? t('observeSpeak') : t('observeMute'));
  }

  function teardown() {
    if (closed) return; closed = true;
    try { if (ws) ws.close(); } catch {}
    Object.values(pcs).forEach((pc) => { try { pc.close(); } catch {} });
    if (localStream) localStream.getTracks().forEach((tr) => tr.stop());
    document.removeEventListener('keydown', onKey);
    mask.remove(); box.remove();
    loadLiveCalls();
  }
  function onKey(e) { if (e.key === 'Escape') teardown(); }
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', teardown);
  box.querySelector('[data-leave]').addEventListener('click', teardown);
  box.querySelector('[data-speak]').addEventListener('click', enableSpeak);
  box.querySelector('[data-mute]').addEventListener('click', toggleMute);
  box.querySelector('[data-forceend]').addEventListener('click', async () => {
    if (!(await confirmDialog(t('liveConfirmEnd')))) return;
    try { await api(`/api/admin/calls/${call.callId}/end`, { method: 'POST' }); } catch (err) { toast(errText(err.code), 'error'); }
    teardown();
  });

  // —— 连接 ——
  (async () => {
    try { const r = await api('/api/assist/turn'); if (r && r.iceServers && r.iceServers.length) iceServers = r.iceServers; } catch { /* fall back to public STUN */ }
    ws = new WebSocket(wsProto + '//' + location.host + '/ws?token=' + encodeURIComponent(state.token));
    ws.onopen = () => send({ type: 'join', callId: call.callId, role: 'admin', observe: true, caps: ['adminObserver'] });
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.type) {
        case 'joined':
          (m.peers || []).forEach((p) => { if (p.role !== 'admin') ensureTile(p.userId, p.userName || p.userId); });
          setStatus(t('observeWaiting'));
          break;
        case 'peer-joined':
          if (m.role !== 'admin') ensureTile(m.userId, m.userName || m.userId); // 晚到参与者（其会向我发 obs-offer）
          break;
        case 'obs-offer': if (m.from) onObsOffer(m.from, m.sdp); break;
        case 'obs-answer': if (m.from) onObsAnswer(m.from, m.sdp); break;
        case 'obs-ice': if (m.from) onObsIce(m.from, m); break;
        case 'peer-left': if (m.userId) { const pc = pcs[m.userId]; if (pc) { try { pc.close(); } catch {} delete pcs[m.userId]; } dropTile(m.userId); } break;
        case 'end': toast(t('liveCallEnded')); teardown(); break;
      }
    };
    ws.onclose = (ev) => {
      if (closed) return;
      const reason = (ev.reason || '').toString();
      const msg = reason === 'call_not_observable' ? t('observeNotObservable')
        : reason === 'observer_exists' ? t('observeExists')
        : reason === 'call_not_active' ? t('observeNotActive')
        : (ev.code === 1000 ? null : t('observeFailed'));
      if (msg) toast(msg, 'error');
      teardown();
    };
    ws.onerror = () => { /* surfaced via onclose */ };
  })();
  viewEl().querySelectorAll('.live-member').forEach((el) => el.addEventListener('click', () => openUserDrawer(el.dataset.uid)));
}

// ---------------------------------------------------------------- reports
async function loadReports() {
  showLoading();
  try { state.reports = (await api('/api/admin/reports')).reports || []; renderReports(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function renderReports() {
  const open = state.reports.filter((r) => r.status === 'open');
  const resolved = state.reports.filter((r) => r.status !== 'open');
  const decPillCls = { dismissed: 'ok', warned: 'off', suspended: 'role-admin', banned: 'role-admin' };
  const row = (r) => `
    <div class="rep">
      <div class="body">
        <div class="who">${esc(r.reporterName)} <span class="arrow">→</span> ${esc(r.targetName)}</div>
        <div class="reason">${esc(r.reason || '—')}</div>
        <div class="meta">${esc(fmtDate(r.createdAt))}${r.callId ? ' · call ' + esc(r.callId.slice(0, 8)) : ''}${r.evidenceRecordingId ? ' · ' + esc(t('evidence')) : ''}${r.status !== 'open' && r.resolvedByName ? ' · ' + esc(t('resolvedBy')) + ' ' + esc(r.resolvedByName) : ''}</div>
      </div>
      <div class="rep-actions">
        ${r.evidenceRecordingId ? `<button class="btn sm" data-playev="${esc(r.evidenceRecordingId)}">${esc(t('viewEvidence'))}</button>` : ''}
        ${r.status === 'open'
          ? `<button class="btn sm primary" data-moderate="${esc(r.id)}">${esc(t('moderate'))}</button>`
          : `<span class="pill ${decPillCls[r.decision] || 'ok'}">${esc(r.decision ? decisionLabel(r.decision) : t('resolved'))}</span>`}
      </div>
    </div>`;
  viewEl().innerHTML = !state.reports.length
    ? `<div class="empty"><div class="ico">✅</div><p>${esc(t('noReports'))}</p></div>`
    : `${open.length ? `<div class="section"><h3>${esc(t('open'))} (${open.length})</h3><div class="table-wrap">${open.map(row).join('')}</div></div>` : ''}
       ${resolved.length ? `<div class="section"><h3>${esc(t('resolved'))} (${resolved.length})</h3><div class="table-wrap">${resolved.map(row).join('')}</div></div>` : ''}`;
  viewEl().querySelectorAll('[data-moderate]').forEach((b) => b.addEventListener('click', () => {
    const r = state.reports.find((x) => x.id === b.dataset.moderate);
    if (r) openModerateDialog(r);
  }));
  viewEl().querySelectorAll('[data-playev]').forEach((b) => b.addEventListener('click', () => playRecordingModal(b.dataset.playev)));
}

// 审核处置模态：展示举报 → 必填理由 → 选择 忽略/警告/暂停/封禁 → 调 /moderate → 落审计并刷新。
function openModerateDialog(report) {
  const mask = document.createElement('div'); mask.className = 'drawer-mask'; mask.style.zIndex = '70';
  const box = document.createElement('div'); box.className = 'modal-overlay';
  const actions = [
    ['dismiss', 'modDismiss', 'modDismissDesc', 'btn'],
    ['warn', 'modWarn', 'modWarnDesc', 'btn ink'],
    ['suspend', 'modSuspend', 'modSuspendDesc', 'btn danger'],
    ['ban', 'modBan', 'modBanDesc', 'btn danger'],
  ].map(([act, label, desc, cls]) => `
    <button class="${cls} mod-act" data-act="${act}">
      <span class="mod-act-label">${esc(t(label))}</span>
      <span class="mod-act-desc">${esc(t(desc))}</span>
    </button>`).join('');
  box.innerHTML = `<div class="card mod-card" role="dialog" aria-modal="true" aria-label="${esc(t('modTitle'))}">
    <h3 class="mod-title">${esc(t('modTitle'))}</h3>
    <div class="mod-summary"><b>${esc(report.reporterName)}</b> <span class="arrow">→</span> <b>${esc(report.targetName)}</b>
      <div class="reason">${esc(report.reason || '—')}</div></div>
    <label class="mod-reason-label" for="modReason">${esc(t('modReason'))}</label>
    <textarea id="modReason" class="mod-reason" rows="3" placeholder="${esc(t('modReasonPh'))}"></textarea>
    <div class="mod-actions">${actions}</div>
    <div class="confirm-actions"><button class="btn ghost" data-no>${esc(state.lang === 'en' ? 'Cancel' : '取消')}</button></div>
  </div>`;
  document.body.appendChild(mask); document.body.appendChild(box);
  const close = () => { mask.remove(); box.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', close);
  box.querySelector('[data-no]').addEventListener('click', close);
  box.querySelectorAll('.mod-act').forEach((b) => b.addEventListener('click', async () => {
    const reason = box.querySelector('#modReason').value.trim();
    if (!reason) { box.querySelector('#modReason').focus(); toast(t('modReasonRequired'), 'error'); return; }
    box.querySelectorAll('.mod-act').forEach((x) => (x.disabled = true));
    try {
      await api(`/api/admin/reports/${report.id}/moderate`, { method: 'POST', body: { action: b.dataset.act, reason } });
      toast(t('moderated'), 'success'); close();
      loadReports(); loadOverviewBadge();
    } catch (err) {
      box.querySelectorAll('.mod-act').forEach((x) => (x.disabled = false));
      toast(errText(err.code), 'error');
    }
  }));
  box.querySelector('#modReason').focus();
}

// ---------------------------------------------------------------- audit log
async function loadAudit() {
  showLoading();
  try { state.audit = (await api('/api/admin/audit?limit=500')).entries || []; renderAudit(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function renderAudit() {
  const rows = state.audit.map((e) => `
    <tr>
      <td class="cell-date">${esc(fmtDate(e.at))}</td>
      <td><div class="nm">${esc(e.adminName || '—')}</div></td>
      <td>${esc(auditActionName(e.action))}</td>
      <td><span class="pill off">${esc(e.targetType)}</span> <span class="mono">${esc((e.targetId || '').slice(0, 12))}</span></td>
      <td class="audit-detail">${esc(e.detail || '—')}</td>
    </tr>`).join('');
  viewEl().innerHTML = `
    <div class="toolbar">
      <button class="btn ghost" data-action="reloadAudit">↻ ${esc(t('refresh'))}</button>
      <button class="btn ghost" data-action="exportAudit" ${state.audit.length ? '' : 'disabled'}>⬇ ${esc(t('exportCsv'))}</button>
    </div>
    <div class="table-wrap">
      ${state.audit.length ? `<table><thead><tr>
        <th>${esc(t('auditWhen'))}</th><th>${esc(t('auditAdmin'))}</th><th>${esc(t('auditAction'))}</th><th>${esc(t('auditTarget'))}</th><th>${esc(t('auditDetail'))}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty"><div class="ico">🧾</div><p>${esc(t('noAudit'))}</p></div>`}
    </div>`;
  viewEl().querySelector('[data-action="reloadAudit"]').addEventListener('click', loadAudit);
  viewEl().querySelector('[data-action="exportAudit"]').addEventListener('click', () => {
    downloadCSV('beeurei-audit.csv', [
      [t('auditWhen'), t('auditAdmin'), t('auditAction'), 'targetType', 'targetId', t('auditDetail')],
      ...state.audit.map((e) => [fmtDate(e.at), e.adminName || '', auditActionName(e.action), e.targetType, e.targetId, e.detail || '']),
    ]);
  });
}

// ---------------------------------------------------------------- controls (site-wide switches)
async function loadControls() {
  showLoading();
  try { state.appConfig = (await api('/api/admin/config')).config; renderControls(); }
  catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
const FEATURE_ORDER = ['messaging', 'calls', 'helpRequests', 'groups', 'familyLinks', 'mediaUpload', 'navigation', 'sceneScan'];
const SAFETY_LOCKED = ['emergency', 'blocks', 'reports']; // 刻意不可关停
function renderControls() {
  const c = state.appConfig || { registrationEnabled: true, features: {} };
  const feats = c.features || {};
  const a = c.announcement || { active: false, message: '', level: 'info' };
  const m = c.maintenance || { active: false, message: '' };
  const cf = c.contentFilter || { enabled: false, terms: [] };
  const featRow = (k) => `
    <div class="form-row"><div><div class="lab">${esc(featLabel(k))}</div><div class="desc">${esc(featDesc(k))}</div></div>
      <label class="switch"><input type="checkbox" data-feat="${esc(k)}" ${feats[k] !== false ? 'checked' : ''}/><span class="track"></span></label></div>`;
  const lockedRow = (k) => `
    <div class="form-row locked"><div><div class="lab">${esc(featLabel(k))}</div></div>
      <span class="pill ok">${esc(t('alwaysOn'))}</span></div>`;
  viewEl().innerHTML = `
    <div class="section"><h3>${esc(t('siteControls'))}</h3>
      <div class="card">
        <div class="form-row"><div><div class="lab">${esc(t('registration'))}</div><div class="desc">${esc(t('registrationDesc'))}</div></div>
          <label class="switch"><input type="checkbox" id="cReg" ${c.registrationEnabled ? 'checked' : ''}/><span class="track"></span></label></div>
        <div class="form-row"><div><div class="lab">${esc(t('requireVerif'))}</div><div class="desc">${esc(t('requireVerifDesc'))}</div></div>
          <label class="switch"><input type="checkbox" id="cReqVerif" ${c.requireVerification ? 'checked' : ''}/><span class="track"></span></label></div>
        <div class="form-row"><div class="desc">${esc(t('recPolicyLink'))}</div></div>
      </div>
    </div>
    <div class="section"><h3>${esc(t('siteFeatures'))}</h3>
      <p class="section-sub">${esc(t('siteFeaturesDesc'))}</p>
      <div class="card">${FEATURE_ORDER.map(featRow).join('')}</div>
    </div>
    <div class="section"><h3>${esc(t('safetyLocked'))}</h3>
      <p class="section-sub">${esc(t('safetyLockedDesc'))}</p>
      <div class="card">${SAFETY_LOCKED.map(lockedRow).join('')}</div>
    </div>
    <div class="section"><h3>${esc(t('announce'))}</h3>
      <div class="card">
        <div class="form-row"><div class="lab">${esc(t('announceActive'))}</div>
          <label class="switch"><input type="checkbox" id="aActive" ${a.active ? 'checked' : ''}/><span class="track"></span></label></div>
        <div class="field"><label for="aMsg">${esc(t('announceMsg'))}</label><input id="aMsg" type="text" maxlength="500" value="${esc(a.message || '')}"/></div>
        <div class="field"><label for="aLevel">${esc(t('announceLevel'))}</label>
          <select class="sel" id="aLevel"><option value="info" ${a.level !== 'warning' ? 'selected' : ''}>${esc(t('lvl_info'))}</option><option value="warning" ${a.level === 'warning' ? 'selected' : ''}>${esc(t('lvl_warning'))}</option></select></div>
        <div class="save-row"><button class="btn primary" id="saveAnnounce">${esc(t('saveBtn'))}</button></div>
      </div>
    </div>
    <div class="section"><h3>${esc(t('maintenance'))}</h3>
      <p class="section-sub">${esc(t('maintDesc'))}</p>
      <div class="card">
        <div class="form-row"><div class="lab">${esc(t('maintActive'))}</div>
          <label class="switch"><input type="checkbox" id="mActive" ${m.active ? 'checked' : ''}/><span class="track"></span></label></div>
        <div class="field"><label for="mMsg">${esc(t('maintMsg'))}</label><input id="mMsg" type="text" maxlength="500" value="${esc(m.message || '')}"/></div>
        <div class="save-row"><button class="btn primary" id="saveMaint">${esc(t('saveBtn'))}</button></div>
      </div>
    </div>
    <div class="section"><h3>${esc(t('contentFilterTitle'))}</h3>
      <p class="section-sub">${esc(t('cfDesc'))}</p>
      <div class="card">
        <div class="form-row"><div class="lab">${esc(t('cfEnabled'))}</div>
          <label class="switch"><input type="checkbox" id="cfEnabled" ${cf.enabled ? 'checked' : ''}/><span class="track"></span></label></div>
        <div class="field"><label for="cfTerms">${esc(t('cfTerms'))}</label><textarea id="cfTerms" class="mod-reason" rows="5">${esc((cf.terms || []).join('\n'))}</textarea></div>
        <div class="save-row"><button class="btn primary" id="saveCf">${esc(t('saveBtn'))}</button></div>
      </div>
    </div>`;
  $('#cReg').addEventListener('change', (e) => saveConfig({ registrationEnabled: e.target.checked }, e.target));
  $('#cReqVerif').addEventListener('change', (e) => saveConfig({ requireVerification: e.target.checked }, e.target));
  viewEl().querySelectorAll('[data-feat]').forEach((el) => el.addEventListener('change', (e) =>
    saveConfig({ features: { [e.target.dataset.feat]: e.target.checked } }, e.target)));
  $('#saveAnnounce').addEventListener('click', () => saveConfig({ announcement: { active: $('#aActive').checked, message: $('#aMsg').value, level: $('#aLevel').value } }));
  $('#saveMaint').addEventListener('click', () => saveConfig({ maintenance: { active: $('#mActive').checked, message: $('#mMsg').value } }));
  $('#saveCf').addEventListener('click', () => {
    const terms = $('#cfTerms').value.split('\n').map((s) => s.trim()).filter(Boolean);
    saveConfig({ contentFilter: { enabled: $('#cfEnabled').checked, terms } });
  });
}
// 单项开关变更即保存（乐观；失败回滚 checkbox）。
async function saveConfig(patch, el) {
  const prev = el ? !el.checked : null;
  try { state.appConfig = (await api('/api/admin/config', { method: 'PUT', body: patch })).config; toast(t('saved'), 'success'); }
  catch (err) { if (el) el.checked = prev; toast(errText(err.code), 'error'); }
}

// ---------------------------------------------------------------- recordings
async function loadRecordings() {
  showLoading();
  try {
    state.recConfig = await api('/api/recordings/config');
    state.recordings = (await api('/api/recordings')).recordings || [];
    renderRecordings();
  } catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function renderRecordings() {
  const c = state.recConfig || { enabled: false, requireConsent: true, retentionDays: 30 };
  const recRows = state.recordings.map((r) => {
    const names = (r.participantNames || []).join(', ');
    const dur = (r.durationSec != null) ? ` · ${t('recDuration')} ${Math.floor(r.durationSec / 60)}:${String(r.durationSec % 60).padStart(2, '0')}` : '';
    const loc = r.locationLabel ? ` · ${t('recLocation')} ${esc(r.locationLabel)}` : '';
    const deleted = r.deletedAt ? ` <span class="pill off">${esc(t('recUserDeleted'))}</span>` : '';
    const playBtn = r.hasMedia
      ? `<button class="btn sm" data-playrec="${esc(r.id)}">${esc(t('playRec'))}</button>`
      : `<span class="muted-note">${esc(t('recNoMedia'))}</span>`;
    return `<div class="rep"><div class="body">
        <div class="who">${esc(names || ('call ' + (r.callId || '').slice(0, 12)))}${deleted}</div>
        <div class="meta">${esc(fmtDate(r.recordedAt))}${dur}${loc}${r.reason ? ' · ' + esc(r.reason) : ''}</div></div>
        <div class="rep-actions">${playBtn}<button class="btn danger sm" data-delrec="${esc(r.id)}">${esc(t('deleteRec'))}</button></div></div>`;
  }).join('');
  viewEl().innerHTML = `
    <div class="section"><h3>${esc(t('recPolicy'))}</h3>
      <div class="card">
        <div class="form-row"><div><div class="lab">${esc(t('allowRecording'))}</div><div class="desc">${esc(t('allowRecordingDesc'))}</div></div>
          <label class="switch"><input type="checkbox" id="cEnabled" ${c.enabled ? 'checked' : ''}/><span class="track"></span></label></div>
        <div class="form-row"><div><div class="lab">${esc(t('requireConsent'))}</div><div class="desc">${esc(t('requireConsentDesc'))}</div></div>
          <label class="switch"><input type="checkbox" id="cConsent" ${c.requireConsent ? 'checked' : ''}/><span class="track"></span></label></div>
        <div class="form-row"><div><div class="lab">${esc(t('retentionDays'))}</div><div class="desc">${esc(t('retentionDesc'))}</div></div>
          <div><input class="num" type="number" id="cDays" min="1" max="3650" value="${Number(c.retentionDays) || 30}"/> <span class="days-unit">${esc(t('days'))}</span></div></div>
        <div class="save-row"><button class="btn primary" id="saveRec">${esc(t('save'))}</button></div>
      </div>
    </div>
    <div class="section"><h3>${esc(t('recList'))} (${state.recordings.length})</h3>
      <div class="table-wrap">${state.recordings.length ? recRows : `<div class="empty"><div class="ico">⏺</div><p>${esc(t('noRecordings'))}</p></div>`}</div>
    </div>`;
  $('#saveRec').addEventListener('click', async () => {
    const body = { enabled: $('#cEnabled').checked, requireConsent: $('#cConsent').checked, retentionDays: Math.max(1, Math.min(3650, Number($('#cDays').value) || 30)) };
    try { state.recConfig = await api('/api/recordings/config', { method: 'PUT', body }); toast(t('saved'), 'success'); }
    catch (err) { toast(errText(err.code), 'error'); }
  });
  viewEl().querySelectorAll('[data-delrec]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog(t('confirmDeleteRec')))) return;
    try { await api(`/api/recordings/${b.dataset.delrec}`, { method: 'DELETE' }); loadRecordings(); }
    catch (err) { toast(errText(err.code), 'error'); }
  }));
  viewEl().querySelectorAll('[data-playrec]').forEach((b) => b.addEventListener('click', () => playRecordingModal(b.dataset.playrec)));
}

// 播放录制：先取短时签名媒体令牌（Bearer 无法随 <video src> 传），再以 ?t= 加载同源 <video>。
// 关闭时清空 src 停止下载。CSP：default-src 'self' 已允许同源媒体，无需放宽。
async function playRecordingModal(recordingId) {
  let token;
  try { token = (await api(`/api/recordings/${recordingId}/play-token`)).token; }
  catch (err) { toast(errText(err.code) || t('playFailed'), 'error'); return; }
  const mask = document.createElement('div'); mask.className = 'drawer-mask'; mask.style.zIndex = '70';
  const box = document.createElement('div'); box.className = 'modal-overlay';
  box.innerHTML = `<div class="card video-card" role="dialog" aria-modal="true" aria-label="${esc(t('playRec'))}">
    <video class="rec-video" controls autoplay playsinline src="/api/recordings/${encodeURIComponent(recordingId)}/media?t=${encodeURIComponent(token)}"></video>
    <div class="confirm-actions"><button class="btn ink" data-close>${esc(t('closeBtn'))}</button></div>
  </div>`;
  document.body.appendChild(mask); document.body.appendChild(box);
  const close = () => {
    const v = box.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    mask.remove(); box.remove(); document.removeEventListener('keydown', onKey);
  };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', close);
  box.querySelector('[data-close]').addEventListener('click', close);
}

// ---------------------------------------------------------------- identity verification (KYC)
async function loadVerifications() {
  showLoading();
  state.verifFilter = state.verifFilter || 'pending';
  try {
    const r = await api('/api/admin/verifications?status=' + encodeURIComponent(state.verifFilter));
    state.verifications = r.verifications || [];
    renderVerifications();
  } catch (err) { viewEl().innerHTML = `<div class="err-banner">${esc(errText(err.code))}</div>`; }
}
function verifStatusPill(s) {
  const cls = s === 'verified' ? 'on' : s === 'rejected' ? 'off' : '';
  const label = s === 'verified' ? t('idStatusVerified') : s === 'rejected' ? t('idStatusRejected') : t('idStatusPending');
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}
function docTypeName(idType) { return t('idDocType_' + idType) || idType; }
function renderVerifications() {
  const filters = ['pending', 'all', 'verified', 'rejected'].map((f) => {
    const lbl = f === 'pending' ? t('idStatusPending') : f === 'all' ? t('idStatusAll') : f === 'verified' ? t('idStatusVerified') : t('idStatusRejected');
    return `<button class="seg ${state.verifFilter === f ? 'active' : ''}" data-vf="${f}">${esc(lbl)}</button>`;
  }).join('');
  const rows = state.verifications.map((v) => {
    const via = v.submittedVia === 'assisted' ? t('idViaAssisted') : t('idViaSelf');
    const hold = v.legalHold ? ` <span class="pill">⚖︎ ${esc(t('idHoldOn'))}</span>` : '';
    const decided = v.decidedAt ? ` · ${esc(t('idDecided'))} ${esc(fmtDate(v.decidedAt))}` : '';
    return `<div class="rep" data-vrow="${esc(v.id)}" tabindex="0" role="button">
        <div class="body">
          <div class="who">${esc(v.userName)} ${verifStatusPill(v.status)}${hold}</div>
          <div class="meta">${esc(docTypeName(v.idType))}${v.idLast4 ? ' ····' + esc(v.idLast4) : ''} · ${esc(via)} · ${esc(t('idAttempt'))} ${v.attempt} · ${esc(fmtDate(v.submittedAt))}${decided}${v.rejectReasonCode ? ' · ' + esc(t('idReason_' + v.rejectReasonCode) || v.rejectReasonCode) : ''}</div>
        </div>
        <div class="rep-actions"><span class="muted-note">${(v.docsUploaded || []).length} 📄</span></div>
      </div>`;
  }).join('');
  viewEl().innerHTML = `
    <div class="section">
      <div class="seg-row">${filters}</div>
      <div class="table-wrap">${state.verifications.length ? rows : `<div class="empty"><div class="ico">🪪</div><p>${esc(t('noVerifications'))}</p></div>`}</div>
    </div>`;
  viewEl().querySelectorAll('[data-vf]').forEach((b) => b.addEventListener('click', () => { state.verifFilter = b.dataset.vf; loadVerifications(); }));
  viewEl().querySelectorAll('[data-vrow]').forEach((el) => {
    const open = () => openVerifReview(el.dataset.vrow);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}

// 取一张证件图：带 Authorization 头 fetch → object URL（no token-in-URL；用完撤销）。
async function fetchDocBlob(id, kind) {
  const res = await fetch(`/api/admin/verifications/${encodeURIComponent(id)}/doc/${encodeURIComponent(kind)}`, { headers: { authorization: 'Bearer ' + state.token } });
  if (!res.ok) throw new Error('doc');
  return URL.createObjectURL(await res.blob());
}

async function openVerifReview(id) {
  let d;
  try { d = await api('/api/admin/verifications/' + encodeURIComponent(id)); }
  catch (err) { toast(errText(err.code), 'error'); return; }
  const objectUrls = [];
  const docs = d.docsUploaded || [];
  const pending = d.status === 'pending';
  const checklist = pending ? `
    <div class="kyc-checklist">
      <label><input type="checkbox" class="kchk"/> ${esc(t('idChkName'))}</label>
      <label><input type="checkbox" class="kchk"/> ${esc(t('idChkValid'))}</label>
      <label><input type="checkbox" class="kchk"/> ${esc(t('idChkFace'))}</label>
      <label><input type="checkbox" class="kchk"/> ${esc(t('idChkClear'))}</label>
    </div>` : '';
  const reasons = ['blurry', 'glare', 'name_mismatch', 'face_mismatch', 'expired', 'unsupported_doc', 'incomplete', 'suspected_fraud', 'other'];
  const reasonOpts = reasons.map((rc) => `<option value="${rc}">${esc(t('idReason_' + rc))}</option>`).join('');
  const docCell = (kind, label) => docs.includes(kind)
    ? `<div class="kyc-doc"><div class="kyc-doc-lab">${esc(label)}</div><img class="kyc-img" data-kind="${kind}" alt="${esc(label)}"/></div>`
    : `<div class="kyc-doc"><div class="kyc-doc-lab">${esc(label)}</div><div class="kyc-img empty-doc">${esc(t('idNoDoc'))}</div></div>`;
  const actions = pending ? `
      <div class="kyc-decide">
        <div class="kyc-reject"><select class="kyc-reason">${reasonOpts}</select>
          <input class="inp kyc-note" type="text" maxlength="280" placeholder="${esc(t('idRejectNote'))}"/>
          <button class="btn danger" data-act="reject">${esc(t('idReject'))}</button></div>
        <button class="btn primary" data-act="approve" disabled>${esc(t('idApprove'))}</button>
      </div>`
    : (d.status === 'verified'
      ? `<div class="kyc-decide"><button class="btn danger" data-act="revoke">${esc(t('idRevoke'))}</button></div>`
      : `<div class="kyc-decide"><span class="muted-note">${esc(t('idStatusRejected'))}${d.rejectReasonCode ? ' · ' + esc(t('idReason_' + d.rejectReasonCode) || d.rejectReasonCode) : ''}</span></div>`);
  const holdBtn = `<button class="btn ghost sm" data-act="hold">${d.legalHold ? '⚖︎ ' + esc(t('idHoldOn')) : esc(t('idHold'))}</button>`;

  const mask = document.createElement('div'); mask.className = 'drawer-mask'; mask.style.zIndex = '70';
  const box = document.createElement('div'); box.className = 'modal-overlay';
  box.innerHTML = `<div class="card kyc-card" role="dialog" aria-modal="true" aria-label="${esc(t('idReview1'))}">
    <div class="kyc-head"><h3>${esc(t('idReview1'))}</h3>${holdBtn}</div>
    <div class="kyc-grid">
      ${docCell('selfie', t('idSelfie'))}
      ${docCell('front', t('idDocFront'))}
      ${docs.includes('back') ? docCell('back', t('idDocBack')) : ''}
    </div>
    <div class="kyc-fields">
      <div><span class="lab">${esc(t('idApplicant'))}</span> <b>${esc(d.userName)}</b></div>
      <div><span class="lab">${esc(t('idLegalName'))}</span> <b>${esc(d.legalName || '—')}</b></div>
      <div><span class="lab">${esc(t('idDocType'))}</span> ${esc(docTypeName(d.idType))}</div>
      <div><span class="lab">${esc(t('idNumber'))}</span> ${esc(d.idNumber || (d.idLast4 ? '····' + d.idLast4 : '—'))}</div>
    </div>
    <p class="kyc-hint">${esc(t('idCompareHint'))}</p>
    ${checklist}
    ${actions}
    <div class="confirm-actions"><button class="btn ink" data-close>${esc(t('closeBtn'))}</button></div>
  </div>`;
  document.body.appendChild(mask); document.body.appendChild(box);
  let closed = false;
  const close = () => { closed = true; objectUrls.forEach((u) => URL.revokeObjectURL(u)); mask.remove(); box.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', close);
  box.querySelector('[data-close]').addEventListener('click', close);

  // 异步加载证件图（带鉴权 → object URL）。若加载完成时弹窗已关闭，立刻撤销该 URL——
  // 否则晚到的（已解密证件图）blob URL 会漏过 close() 的同步撤销，泄漏到标签页生命周期（见复审 LOW）。
  box.querySelectorAll('img.kyc-img[data-kind]').forEach(async (img) => {
    try {
      const u = await fetchDocBlob(id, img.dataset.kind);
      if (closed) { URL.revokeObjectURL(u); return; }
      objectUrls.push(u); img.src = u;
    }
    catch { if (!closed) img.replaceWith(Object.assign(document.createElement('div'), { className: 'kyc-img empty-doc', textContent: t('idDocLoadFail') })); }
  });

  // 核对项全勾选才放开「通过」。
  const approveBtn = box.querySelector('[data-act="approve"]');
  if (approveBtn) {
    const chks = [...box.querySelectorAll('.kchk')];
    const refresh = () => { approveBtn.disabled = !chks.every((c) => c.checked); };
    chks.forEach((c) => c.addEventListener('change', refresh));
    approveBtn.title = t('idApproveBlocked');
  }
  const decide = async (path, body) => {
    try { await api(path, { method: 'POST', body }); toast(t('saved'), 'success'); close(); await loadVerifications(); await refreshVerifBadge(); }
    catch (err) { toast(errText(err.code), 'error'); }
  };
  approveBtn?.addEventListener('click', () => decide(`/api/admin/verifications/${encodeURIComponent(id)}/approve`));
  box.querySelector('[data-act="reject"]')?.addEventListener('click', () => {
    const reasonCode = box.querySelector('.kyc-reason').value;
    const note = box.querySelector('.kyc-note').value.trim();
    decide(`/api/admin/verifications/${encodeURIComponent(id)}/reject`, note ? { reasonCode, note } : { reasonCode });
  });
  box.querySelector('[data-act="revoke"]')?.addEventListener('click', async () => {
    if (!(await confirmDialog(t('idConfirmRevoke')))) return;
    decide(`/api/admin/verifications/${encodeURIComponent(id)}/revoke`);
  });
  box.querySelector('[data-act="hold"]')?.addEventListener('click', async () => {
    try { await api(`/api/admin/verifications/${encodeURIComponent(id)}/hold`, { method: 'POST' }); close(); await loadVerifications(); }
    catch (err) { toast(errText(err.code), 'error'); }
  });
}

async function refreshVerifBadge() { try { state.overview = await api('/api/admin/overview'); renderChrome(); } catch {} }

// keep the reports badge fresh after resolving
async function loadOverviewBadge() { try { state.overview = await api('/api/admin/overview'); renderChrome(); route(); } catch {} }

// ---------------------------------------------------------------- confirm dialog
function confirmDialog(message) {
  return new Promise((resolve) => {
    const mask = document.createElement('div'); mask.className = 'drawer-mask'; mask.style.zIndex = '70';
    const box = document.createElement('div');
    box.className = 'modal-overlay';
    box.innerHTML = `<div class="card confirm-card" role="alertdialog" aria-modal="true">
      <p class="confirm-msg">${esc(message)}</p>
      <div class="confirm-actions">
        <button class="btn" data-no>${esc(state.lang === 'en' ? 'Cancel' : '取消')}</button>
        <button class="btn ink" data-yes>${esc(state.lang === 'en' ? 'Confirm' : '确认')}</button>
      </div></div>`;
    document.body.appendChild(mask); document.body.appendChild(box);
    const done = (v) => { mask.remove(); box.remove(); resolve(v); };
    mask.addEventListener('click', () => done(false));
    box.querySelector('[data-no]').addEventListener('click', () => done(false));
    box.querySelector('[data-yes]').addEventListener('click', () => done(true));
    box.querySelector('[data-yes]').focus();
  });
}

// ---------------------------------------------------------------- router + boot
function route() {
  const r = currentRoute();
  if (r === '') loadDashboard();
  else if (r === 'users') loadUsers();
  else if (r === 'relationships') loadLinks();
  else if (r === 'calls') loadCalls();
  else if (r === 'blocks') loadBlocks();
  else if (r === 'live') loadLiveCalls();
  else if (r === 'reports') loadReports();
  else if (r === 'verifications') loadVerifications();
  else if (r === 'audit') loadAudit();
  else if (r === 'recordings') loadRecordings();
  else if (r === 'controls') loadControls();
}
function render() {
  document.documentElement.lang = state.lang === 'en' ? 'en' : 'zh-Hans';
  applyTheme();
  if (!state.token) { renderLogin(); return; }
  renderChrome();
  route();
}
window.addEventListener('hashchange', () => { if (state.token) { renderChrome(); route(); } });
render();
