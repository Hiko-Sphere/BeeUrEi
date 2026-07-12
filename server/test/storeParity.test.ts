import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, JsonFileStore, convKeyFor, type Store, type User } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'

/// 双存储差分一致性套件。生产跑的是 SqliteStore，但覆盖率显示 51 个 Sqlite 方法从未被任何
/// 测试命中——它们只在 MemoryStore 上被验证过。这与 mock drift 同构：SQL 实现悄悄偏离内存
/// 语义时，全套测试照绿、只有生产出错（本库已两次实证：JsonFileStore 复合键、消息稳定序）。
/// 方法：同一确定性动作序列分阶段打两个 store，每阶段比对「动作返回值 + 全量观测快照」。
/// 时间戳全部显式传参（store 契约如此），快照完全确定，零 flake。
const T = 1_700_000_000_000 // 固定基准时刻
const FUTURE = T + 30 * 24 * 3600_000

const user = (id: string, over?: Partial<User>): User =>
  ({ id, username: id, passwordHash: 'h', displayName: id, role: 'helper', status: 'active', createdAt: T, ...over }) as User

const DM_KEY = convKeyFor({ fromId: 'alice', toId: 'bob' })

/// 全量观测快照：涵盖本轮零命中的读方法 + 相邻语义（排序/过滤/所有权检查都在比对之内）。
function snapshot(s: Store) {
  return {
    userCount: s.userCount(),
    byPhone: s.findByPhone('+8613800001111')?.id ?? null,
    byEmail: s.findByEmail('ALICE@example.com')?.id ?? null, // 大小写不敏感契约
    byAppleSub: s.findByAppleSub('apple-sub-alice')?.id ?? null,
    aliceTokens: (({ apnsToken, voipToken }) => ({ apnsToken: apnsToken ?? null, voipToken: voipToken ?? null }))(
      (s.findById('alice') ?? {}) as { apnsToken?: string; voipToken?: string }),
    bobApns: ((s.findById('bob') ?? {}) as { apnsToken?: string }).apnsToken ?? null,
    sessionsAlice: s.sessionsForUser('alice', T + 1000).map((x) => x.sessionId),
    sessionCountAlice: s.countSessionsForUser('alice', T + 1000),
    sessionCountBob: s.countSessionsForUser('bob', T + 1000),
    rt1: s.findRefreshToken('rt1')
      ? { rotatedAt: s.findRefreshToken('rt1')!.rotatedAt ?? null, sessionId: s.findRefreshToken('rt1')!.sessionId ?? null }
      : null,
    hasS1: s.hasActiveSession('alice', 's1', T + 1000),
    hasS2: s.hasActiveSession('alice', 's2', T + 1000),
    recoveryLeft: s.countUnusedRecoveryCodes('alice'),
    recoveryHasH1: s.hasUnusedRecoveryCode('alice', 'h1'),
    recoveryHasH2: s.hasUnusedRecoveryCode('alice', 'h2'),
    passkeys: s.passkeysForUser('alice').map((p) => ({ id: p.id, counter: p.counter })),
    pkByCred: s.findPasskeyByCredentialId('cred-1')?.id ?? null,
    blocks: s.allBlocks().map((b) => b.id).sort(),
    blocksAlice: s.blocksInvolving('alice').map((b) => b.id).sort(),
    blockB1: s.findBlock('b1')?.blockedId ?? null,
    callsBob: s.callRecordsForUser('bob', 10).map((c) => ({ id: c.id, status: c.status })),
    missedBob: s.missedCallCountForUser('bob', 0),
    reports: s.allReports().map((r) => ({ id: r.id, status: r.status })).sort((a, b) => a.id < b.id ? -1 : 1),
    reportsCitingRec1: s.reportsCitingRecording('rec-1').map((r) => r.id),
    warningsAlice: s.warningsForUser('alice').map((w) => w.id), // 契约：时间倒序
    recAlice: s.recordingsForUser('alice').map((r) => ({ id: r.id, durationSec: r.durationSec ?? null })),
    rec1: (() => { const r = s.findRecording('rec-1'); return r ? { id: r.id, durationSec: r.durationSec ?? null } : null })(),
    recByMedia: s.recordingByMediaId('m-rec')?.id ?? null,
    verifPending: s.countPendingVerifications(),
    verifAll: s.allVerifications().map((v) => ({ id: v.id, status: v.status })).sort((a, b) => a.id < b.id ? -1 : 1),
    notifUnreadAlice: s.unreadNotificationCount('alice'),
    notifAlice: s.notificationsForUser('alice', 10).map((n) => ({ id: n.id, read: n.readAt != null })),
    notifBob: s.notificationsForUser('bob', 10).map((n) => n.id),
    emergencies: s.recentEmergencyEvents(10).map((e) => ({ id: e.id, ackedAt: e.ackedAt ?? null, escalatedAt: (e as { escalatedAt?: number }).escalatedAt ?? null, resolvedAt: e.resolvedAt ?? null })),
    emergUnacked: s.unacknowledgedEmergencyEvents(T + 100, T + 100).map((e) => e.id),
    webPushSub: s.findWebPushSubscription('https://push.example/ep-1')?.userId ?? null,
    webPushAlice: s.webPushSubscriptionsForUser('alice').map((x) => x.endpoint).sort(),
    unreadFromBob: s.unreadCount('alice', 'bob'),
    sentByAlice: s.messagesSentBy('alice', 10).map((m) => m.id), // 契约：时间正序
    dmAliceBob: s.messagesBetween('alice', 'bob', 10).map((m) => ({ id: m.id, read: m.readAt != null })),
    videoByMedia: s.findVideoMessageByMediaId('m-vid')?.id ?? null,
    mediaAlice: s.mediaByOwner('alice').map((m) => m.id).sort(),
    dmMutesAlice: s.dmMutesForUser('alice').sort(),
    groupMutesAlice: s.groupMutesForUser('alice').sort(),
    routesAlice: s.savedRoutesForUser('alice').map((r) => r.id),
    routesBob: s.savedRoutesForUser('bob').map((r) => r.id),
    reactionM1: s.messageReactionsFor(['m1']).get('m1') ?? null,
    pinDm: s.getPin(DM_KEY) ?? null,
    groupReadAlice: s.groupReadAt('g-x', 'alice'),
    placesAlice: s.savedPlacesForUser('alice'),
    safetyActive: s.activeSafetyTimerForOwner('alice')?.id ?? null,
    safetyHistory: s.safetyTimersForUser('alice').map((t) => ({ id: t.id, status: t.status })),
    safetyExpiredCand: s.expiredActiveSafetyTimers(T + 4_000_000).map((t) => t.id),
    medical: s.getMedicalInfo('alice') ?? null,
    audit: s.allAuditEntries(5).map((a) => a.id),
    appConfigReg: s.getAppConfig().registrationEnabled,
    recordingConfig: s.getRecordingConfig(),
  }
}

/// 阶段化动作序列：每个阶段的返回值也参与比对（consumeRecoveryCode 的布尔、markAllNotificationsRead 的条数……）。
const stages: [string, (s: Store) => unknown][] = [
  ['seed', (s) => {
    s.createUser(user('alice', { role: 'blind', phone: '+8613800001111', email: 'Alice@Example.com', appleSub: 'apple-sub-alice', apnsToken: 'apns-A', voipToken: 'voip-A' } as Partial<User>))
    s.createUser(user('bob', { apnsToken: 'apns-B' } as Partial<User>))
    s.createUser(user('carol'))
    // 会话/refresh：alice 两设备，bob 一台。
    s.createRefreshToken({ tokenHash: 'rt1', userId: 'alice', expiresAt: FUTURE, sessionId: 's1', deviceLabel: 'iPhone', createdAt: T, lastSeenAt: T })
    s.createRefreshToken({ tokenHash: 'rt2', userId: 'alice', expiresAt: FUTURE, sessionId: 's2', deviceLabel: 'Chrome · Mac', createdAt: T + 1, lastSeenAt: T + 1 })
    s.createRefreshToken({ tokenHash: 'rt3', userId: 'bob', expiresAt: FUTURE, sessionId: 's3', createdAt: T, lastSeenAt: T })
    s.replaceRecoveryCodes('alice', ['h1', 'h2'])
    s.createPasskey({ id: 'pk1', userId: 'alice', credentialId: 'cred-1', publicKey: 'pub', counter: 0, createdAt: T })
    s.createBlock({ id: 'b1', blockerId: 'alice', blockedId: 'bob', createdAt: T })
    s.createBlock({ id: 'b2', blockerId: 'carol', blockedId: 'alice', createdAt: T + 1 })
    s.createCallRecord({ id: 'c1', callId: 'call-1', callerId: 'alice', calleeId: 'bob', status: 'missed', createdAt: T })
    s.createRecording({ id: 'rec-1', callId: 'call-1', ownerId: 'alice', consentBy: ['alice', 'bob'], reason: 'evidence', recordedAt: T, mediaId: 'm-rec' })
    s.createReport({ id: 'rp1', reporterId: 'bob', targetUserId: 'alice', reason: 'test', status: 'open', createdAt: T, evidenceRecordingId: 'rec-1' })
    s.createWarning({ id: 'w1', userId: 'alice', reason: 'r1', byAdminId: 'root', at: T })
    s.createWarning({ id: 'w2', userId: 'alice', reason: 'r2', byAdminId: 'root', at: T + 5 })
    s.createVerification({ id: 'v1', userId: 'alice', status: 'pending', idType: 'national_id', submittedVia: 'self', submittedById: 'alice', submittedAt: T, attempt: 1 })
    s.createNotification({ id: 'n1', userId: 'alice', kind: 'k', title: 't', body: 'b', createdAt: T })
    s.createNotification({ id: 'n2', userId: 'alice', kind: 'k', title: 't', body: 'b', createdAt: T + 1 })
    s.createNotification({ id: 'n3', userId: 'bob', kind: 'k', title: 't', body: 'b', createdAt: T })
    s.createEmergencyEvent({ id: 'e1', userId: 'alice', kind: 'manual', notified: 1, contacts: 2, at: T })
    s.upsertWebPushSubscription({ endpoint: 'https://push.example/ep-1', userId: 'alice', p256dh: 'p', auth: 'a', createdAt: T })
    s.createMessage({ id: 'm1', fromId: 'alice', toId: 'bob', kind: 'text', text: '你好', createdAt: T })
    s.createMessage({ id: 'm2', fromId: 'bob', toId: 'alice', kind: 'text', text: '在吗', createdAt: T + 1 })
    s.createMessage({ id: 'm3', fromId: 'bob', toId: 'alice', kind: 'text', text: '收到没', createdAt: T + 2 })
    s.createMedia({ id: 'm-vid', ownerId: 'alice', mime: 'video/mp4', size: 9, createdAt: T })
    s.createMedia({ id: 'm-rec', ownerId: 'alice', mime: 'video/quicktime', size: 9, createdAt: T })
    s.createMessage({ id: 'm4', fromId: 'alice', toId: 'bob', kind: 'video', text: 'm-vid', createdAt: T + 3 })
    s.setDmMuted('alice', 'bob', true)
    s.setGroupMuted('g-x', 'alice', true)
    s.createSavedRoute({ id: 'route1', ownerId: 'alice', createdBy: 'bob', name: '去医院', waypoints: [{ lat: 31, lng: 121 }, { lat: 31.1, lng: 121.1 }], createdAt: T, updatedAt: T })
    s.createSavedRoute({ id: 'route2', ownerId: 'bob', createdBy: 'bob', name: 'b 的路线', waypoints: [{ lat: 30, lng: 120 }, { lat: 30.1, lng: 120.1 }], createdAt: T, updatedAt: T })
    s.setMessageReaction('m1', 'bob', '👍')
    s.setPin(DM_KEY, 'm1', 'alice', T + 4)
    s.setGroupRead('g-x', 'alice', T + 2)
    s.upsertSavedPlace({ ownerId: 'alice', label: 'home', address: '幸福路 1 号', lat: 31, lng: 121, updatedAt: T })
    s.createSafetyTimer({ id: 'st1', ownerId: 'alice', note: '步行回家', startedAt: T, dueAt: T + 3_600_000, status: 'active' })
    s.setMedicalInfo({ userId: 'alice', sealed: '{"v":1,"ct":"sealed-demo-free"}', updatedAt: T })
    s.createAuditEntry({ id: 'a1', adminId: 'root', action: 'user.ban', targetType: 'user', targetId: 'bob', at: T })
    s.setAppConfig({ registrationEnabled: false })
    s.setRecordingConfig({ retentionDays: 14 })
  }],
  ['会话级状态：表情取消/置顶换条/报到完成/常用地点覆盖写', (s) => {
    s.setMessageReaction('m1', 'bob', '')                 // 取消本人表情
    s.setPin(DM_KEY, 'm2', 'bob', T + 6)                  // 覆盖式换置顶
    s.updateSafetyTimer('st1', { status: 'completed', completedAt: T + 100 })
    s.upsertSavedPlace({ ownerId: 'alice', label: 'home', address: '幸福路 2 号', lat: 31.2, lng: 121.2, updatedAt: T + 7 }) // (owner,label) 覆盖
  }],
  ['会话：轮换墓碑+按会话撤销+撤销其它', (s) => {
    s.markRefreshTokenRotated('rt1', T + 10)
    s.createRefreshToken({ tokenHash: 'rt1b', userId: 'alice', expiresAt: FUTURE, sessionId: 's1', createdAt: T, lastSeenAt: T + 10 })
    s.revokeSession('alice', 's2')                       // 远程登出 Chrome
    s.revokeOtherSessions('alice', 's1')                 // 只留当前设备（s2 已没、无其它）
    s.deleteRefreshTokensForUser('bob')                  // bob 全下线
  }],
  ['恢复码：消费一次成功、重复消费失败', (s) => [
    s.consumeRecoveryCode('alice', 'h1', T + 20),        // → true
    s.consumeRecoveryCode('alice', 'h1', T + 21),        // 已用 → false
    s.consumeRecoveryCode('alice', 'nope', T + 22),      // 不存在 → false
  ]],
  ['passkey：计数推进 + 所有权保护删除', (s) => {
    s.updatePasskeyCounter('pk1', 7)
    s.deletePasskey('pk1', 'bob')   // 非本人删：必须无效（所有权检查的差分）
  }],
  ['推送 token 独占回收', (s) => {
    s.clearApnsTokenFromOthers('apns-A', 'bob')  // 设备换账号：从 alice 收回
    s.clearVoipTokenFromOthers('voip-A', 'bob')
    s.clearPushToken('apns-B')                   // APNs 410：按 token 清
  }],
  ['通话状态更新 + 拉黑删除', (s) => {
    s.updateCallStatus('call-1', 'bob', 'answered')
    s.deleteBlock('b1')
  }],
  ['录制补元数据（软删除口径见 recAlice 探针）', (s) => {
    s.updateRecording('rec-1', { durationSec: 42 })
  }],
  ['通知：全部已读（返回条数也比对）+ 删 bob 的', (s) => {
    const n = s.markAllNotificationsRead('alice')
    s.deleteNotificationsForUser('bob')
    return n
  }],
  ['紧急：ack 首个不覆盖 + 升级标记', (s) => {
    s.markEmergencyAcked('e1', T + 30)
    s.markEmergencyAcked('e1', T + 99) // 后续确认不得覆盖首个
    s.markEmergencyEscalated('e1', T + 40)
  }],
  ['消息：标读（返回条数比对）', (s) => s.markMessagesRead('alice', 'bob', T + 50)],
  ['级联删除组曲（carol 无数据=幂等；alice 定向清理）', (s) => {
    s.deleteCallRecordsForUser('carol')
    s.deleteVerificationsForUser('carol')
    s.deleteEmergencyEventsForUser('carol')
    s.deleteMessagesForUser('carol')
    s.deleteRecoveryCodesForUser('alice')
    s.deleteSavedRoutesForOwner('alice')
    s.deleteWebPushSubscription('https://push.example/ep-1')
    s.deleteSavedPlacesForOwner('carol')
    s.deleteSafetyTimersForOwner('carol')
    s.deleteMedicalInfoForUser('carol')
  }],
]

describe('MemoryStore ↔ SqliteStore 差分一致性（生产存储的行为契约）', () => {
  it('同一动作序列逐阶段：返回值与全量观测快照完全一致', () => {
    const mem = new MemoryStore()
    const sq = new SqliteStore(':memory:')
    for (const [name, act] of stages) {
      const rm = act(mem)
      const rs = act(sq)
      expect(rs, `阶段「${name}」返回值漂移`).toEqual(rm)
      expect(snapshot(sq), `阶段「${name}」后快照漂移`).toEqual(snapshot(mem))
    }
  })

  it('JsonFileStore 落盘→重载往返：与内存语义完全一致（防"加了状态忘了序列化"的姊妹缺口）', () => {
    // JsonFileStore 每次变更同步 afterMutate() 落盘；真实风险不在读写逻辑（继承 MemoryStore），
    // 而在**序列化清单**：MemoryStore 新增一块状态而 afterMutate/构造器载入漏了它 → 运行期全对、
    // 重启后数据蒸发（placekey bug 即此类）。故先跑完整动作序列，再用同一文件**新建实例**模拟重启比对。
    const dir = mkdtempSync(join(tmpdir(), 'beeurei-jsonstore-'))
    try {
      const mem = new MemoryStore()
      const jf = new JsonFileStore(join(dir, 'data.json'))
      for (const [name, act] of stages) {
        const rm = act(mem)
        const rj = act(jf)
        expect(rj, `阶段「${name}」返回值漂移（JsonFile）`).toEqual(rm)
      }
      expect(snapshot(jf), '运行期快照漂移').toEqual(snapshot(mem))
      const reloaded = new JsonFileStore(join(dir, 'data.json')) // 重启
      expect(snapshot(reloaded), '重载后快照漂移=有状态没进序列化清单').toEqual(snapshot(mem))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('恢复码消费语义（绝对断言，防两 store 一起错）：h1 消费一次后 h2 仍可用', () => {
    for (const s of [new MemoryStore(), new SqliteStore(':memory:') as Store]) {
      s.createUser(user('alice'))
      s.replaceRecoveryCodes('alice', ['h1', 'h2'])
      expect(s.consumeRecoveryCode('alice', 'h1', T)).toBe(true)
      expect(s.consumeRecoveryCode('alice', 'h1', T)).toBe(false)
      expect(s.countUnusedRecoveryCodes('alice')).toBe(1)
      expect(s.hasUnusedRecoveryCode('alice', 'h2')).toBe(true)
    }
  })

  it('passkey 所有权删除语义（绝对断言）：他人删无效、本人删生效', () => {
    for (const s of [new MemoryStore(), new SqliteStore(':memory:') as Store]) {
      s.createUser(user('alice'))
      s.createPasskey({ id: 'pk1', userId: 'alice', credentialId: 'c1', publicKey: 'p', counter: 0, createdAt: T })
      s.deletePasskey('pk1', 'mallory')
      expect(s.passkeysForUser('alice'), '他人不得删我的 passkey').toHaveLength(1)
      s.deletePasskey('pk1', 'alice')
      expect(s.passkeysForUser('alice')).toHaveLength(0)
    }
  })
})
