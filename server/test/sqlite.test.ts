import { describe, it, expect } from 'vitest'
import { SqliteStore } from '../src/db/sqliteStore'
import { MemoryStore, type User } from '../src/db/store'

function user(id: string, username: string): User {
  return { id, username, passwordHash: 'h', displayName: username, role: 'blind', status: 'active', createdAt: 1000 }
}

describe('SqliteStore (node:sqlite)', () => {
  it('热路径索引存在（授权/拉黑/通话历史/媒体不退化为全表扫描）', () => {
    const store = new SqliteStore(':memory:') as unknown as { db: { prepare: (s: string) => { all: () => { name: string }[] } } }
    const names = new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name))
    for (const idx of ['idx_links_owner', 'idx_links_member', 'idx_blocks_blocker', 'idx_blocks_blocked',
      'idx_callrec_caller', 'idx_callrec_callee', 'idx_recordings_owner', 'idx_media_owner', 'idx_notif_user',
      'idx_users_username_nocase', 'idx_users_email_nocase', 'idx_users_phone', 'idx_users_apple']) {
      expect(names.has(idx)).toBe(true)
    }
  })

  it('username 大小写不敏感查询走索引而非全表扫描（COLLATE NOCASE 索引匹配）', () => {
    const store = new SqliteStore(':memory:') as unknown as { db: { prepare: (s: string) => { all: (...a: unknown[]) => { detail: string }[] } } }
    const plan = store.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM users WHERE username = ? COLLATE NOCASE').all('x')
    const detail = plan.map((r) => r.detail).join(' ')
    expect(detail).toMatch(/USING INDEX/)    // NOCASE 索引被用上（UNIQUE 的 BINARY 索引对 NOCASE 查询用不上）
    expect(detail).not.toMatch(/SCAN users/) // 确非全表扫描
  })

  it('round-trips users, links, reports, recordings, config', () => {
    const store = new SqliteStore(':memory:')

    store.createUser(user('u1', 'alice'))
    expect(store.findByUsername('alice')?.id).toBe('u1')
    expect(store.findById('u1')?.username).toBe('alice')
    store.updateUser('u1', { status: 'disabled' })
    expect(store.findById('u1')?.status).toBe('disabled')
    expect(store.allUsers().length).toBe(1)
    // tokenVersion 必须持久化(否则改密/封禁令旧 token 失效在生产 SqliteStore 上不生效，见审查 #2)。
    store.updateUser('u1', { tokenVersion: 3 })
    expect(store.findById('u1')?.tokenVersion).toBe(3)

    store.createLink({ id: 'l1', ownerId: 'u1', memberId: 'u2', relation: '妈妈', isEmergency: true, createdAt: 2000, status: 'pending' })
    const links = store.linksByOwner('u1')
    expect(links.length).toBe(1)
    expect(links[0].isEmergency).toBe(true) // 0/1 ↔ bool 映射
    expect(links[0].status).toBe('pending') // 双向同意状态必须持久化(否则 #6 门控在生产失效，见 tokenVersion 教训)
    store.createLink({ ...links[0], status: 'accepted' })
    expect(store.findLink('l1')?.status).toBe('accepted')
    store.deleteLink('l1')
    expect(store.linksByOwner('u1').length).toBe(0)

    store.createReport({ id: 'r1', reporterId: 'u1', targetUserId: 'u2', reason: 'x', status: 'open', createdAt: 3000 })
    store.updateReport('r1', { status: 'resolved' })
    expect(store.findReport('r1')?.status).toBe('resolved')

    expect(store.getRecordingConfig().enabled).toBe(false)
    store.setRecordingConfig({ enabled: true, retentionDays: 14 })
    expect(store.getRecordingConfig()).toMatchObject({ enabled: true, retentionDays: 14 })

    store.createRecording({ id: 'rec1', callId: 'c', ownerId: 'u1', consentBy: ['u1', 'u2'], reason: '', recordedAt: 4000 })
    expect(store.allRecordings()[0].consentBy).toEqual(['u1', 'u2'])
    store.deleteRecording('rec1')
    expect(store.allRecordings().length).toBe(0)
  })

  it('round-trips groups / group reads / media / group messages', () => {
    const store = new SqliteStore(':memory:')
    store.createGroup({ id: 'g1', name: '家人群', ownerId: 'u1', memberIds: ['u1', 'u2'], createdAt: 1000 })
    expect(store.findGroup('g1')?.memberIds).toEqual(['u1', 'u2'])
    expect(store.groupsFor('u2').map((g) => g.id)).toEqual(['g1'])
    expect(store.groupsFor('u3').length).toBe(0)
    store.updateGroup('g1', { memberIds: ['u1', 'u2', 'u3'], name: '一家人' })
    expect(store.findGroup('g1')).toMatchObject({ name: '一家人', memberIds: ['u1', 'u2', 'u3'] })

    // 群消息与按人已读。
    store.createMessage({ id: 'm1', fromId: 'u1', toId: '', groupId: 'g1', kind: 'text', text: '到家了', createdAt: 2000 })
    store.createMessage({ id: 'm2', fromId: 'u2', toId: '', groupId: 'g1', kind: 'text', text: '好', createdAt: 3000 })
    expect(store.groupMessages('g1', 10).map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(store.groupMessages('g1', 10, 3000).map((m) => m.id)).toEqual(['m1']) // 翻页
    expect(store.groupReadAt('g1', 'u3')).toBe(0)
    store.setGroupRead('g1', 'u3', 2500)
    expect(store.groupReadAt('g1', 'u3')).toBe(2500)
    store.setGroupRead('g1', 'u3', 3500) // 覆盖更新
    expect(store.groupReadAt('g1', 'u3')).toBe(3500)

    // 群消息不得混入单聊查询（toId=''，且显式按 groupId 过滤）。
    store.createMessage({ id: 'd1', fromId: 'u1', toId: 'u2', kind: 'text', text: '私聊', createdAt: 4000 })
    expect(store.messagesBetween('u1', 'u2', 10).map((m) => m.id)).toEqual(['d1'])
    expect(store.latestMessagesPerPeer('u1').map((m) => m.id)).toEqual(['d1'])
    // 单聊未读：u2 对 u1 有 1 条未读；撤回后(kind=recalled)不再计未读（SQL 路径，与群口径/MemoryStore 一致）。
    expect(store.unreadCount('u2', 'u1')).toBe(1)
    store.updateMessage('d1', { kind: 'recalled', text: '' })
    expect(store.unreadCount('u2', 'u1')).toBe(0)
    // 复原 d1 供后续"群解散不影响单聊"断言（保持原计数语义）。
    store.updateMessage('d1', { kind: 'text', text: '私聊' })

    // 搜索（SQL LIKE 路径）：群内/单聊文本命中、大小写不敏感、% 字面量、非文本不命中。
    store.createMessage({ id: 's1', fromId: 'u1', toId: '', groupId: 'g1', kind: 'text', text: 'Meeting 100%', createdAt: 6000 })
    store.createMessage({ id: 's2', fromId: 'u1', toId: 'u2', kind: 'text', text: '去医院meeting', createdAt: 6100 })
    store.createMessage({ id: 's3', fromId: 'u1', toId: 'u2', kind: 'image', text: 'meeting-photo', createdAt: 6200 })
    expect(store.searchGroupMessages('g1', 'meeting', 10).map((m) => m.id)).toEqual(['s1']) // 大小写不敏感
    expect(store.searchGroupMessages('g1', '100%', 10).map((m) => m.id)).toEqual(['s1'])     // % 按字面量
    const dir = store.searchDirectMessages('u1', 'u2', 'meeting', 10)
    expect(dir.map((m) => m.id)).toEqual(['s2']) // image(s3) 不命中（仅 kind=text）
    expect(store.searchDirectMessages('u1', 'u2', '', 10)).toEqual([]) // 空查询

    // 媒体元数据。
    store.createMedia({ id: 'v1', ownerId: 'u1', mime: 'video/mp4', size: 12345, createdAt: 5000 })
    expect(store.findMedia('v1')).toMatchObject({ ownerId: 'u1', mime: 'video/mp4', size: 12345 })
    store.deleteMedia('v1')
    expect(store.findMedia('v1')).toBeUndefined()

    // 解散：级联删群消息与已读标记，单聊不受影响。
    store.deleteGroup('g1')
    expect(store.findGroup('g1')).toBeUndefined()
    expect(store.groupMessages('g1', 10).length).toBe(0)
    expect(store.groupReadAt('g1', 'u3')).toBe(0)
    expect(store.messagesBetween('u1', 'u2', 10).length).toBe(3) // d1 + 搜索测试加的 s2(text)/s3(image)，群解散不影响单聊
  })

  it('翻页复合游标 (createdAt,id)：同毫秒边界消息不漏（修严格 < 游标的历史丢失）', () => {
    const store = new SqliteStore(':memory:')
    // 三条同毫秒(1000) + 一条更早(900)；id 决定同毫秒内顺序。
    store.createMessage({ id: 'mA', fromId: 'u1', toId: 'u2', kind: 'text', text: 'A', createdAt: 1000 })
    store.createMessage({ id: 'mB', fromId: 'u1', toId: 'u2', kind: 'text', text: 'B', createdAt: 1000 })
    store.createMessage({ id: 'mC', fromId: 'u1', toId: 'u2', kind: 'text', text: 'C', createdAt: 1000 })
    store.createMessage({ id: 'm0', fromId: 'u1', toId: 'u2', kind: 'text', text: '0', createdAt: 900 })
    // 第一页：最新 2 条（稳定序 mA<mB<mC → 取 mB,mC）。
    const p1 = store.messagesBetween('u1', 'u2', 2)
    expect(p1.map((m) => m.id)).toEqual(['mB', 'mC'])
    // 旧客户端只给 before=1000（严格 <）：会漏掉同毫秒的 mA（历史丢失，这是被修的 bug）。
    expect(store.messagesBetween('u1', 'u2', 2, 1000).map((m) => m.id)).toEqual(['m0']) // mA 被严格游标漏掉
    // 复合游标 before=(1000, 'mB')：正确取到边界前的 mA 与更早的 m0，不漏。
    expect(store.messagesBetween('u1', 'u2', 10, 1000, 'mB').map((m) => m.id)).toEqual(['m0', 'mA'])
  })

  it('搜索结果同毫秒命中：(createdAt,id) 稳定降序，且两存储口径一致', () => {
    // 三条同毫秒(7000)命中 + 一条更早(6000)；同毫秒内必须按 id 降序、且 Sqlite 与 Memory 一致，
    // 否则同一搜索在 SQLite/JSON 部署下结果顺序不同（用户体验漂移、测试随机失败）。
    const seed = (s: SqliteStore | MemoryStore) => {
      s.createMessage({ id: 'q1', fromId: 'u1', toId: 'u2', kind: 'text', text: '老地方 meeting', createdAt: 7000 })
      s.createMessage({ id: 'q3', fromId: 'u2', toId: 'u1', kind: 'text', text: 'meeting 改时间', createdAt: 7000 })
      s.createMessage({ id: 'q2', fromId: 'u1', toId: 'u2', kind: 'text', text: 'meeting 取消', createdAt: 7000 })
      s.createMessage({ id: 'q0', fromId: 'u1', toId: 'u2', kind: 'text', text: '上次 meeting', createdAt: 6000 })
    }
    const sq = new SqliteStore(':memory:'); seed(sq)
    const mem = new MemoryStore(); seed(mem)
    const expected = ['q3', 'q2', 'q1', 'q0'] // 同毫秒 id 降序 q3>q2>q1，再接更早 q0
    expect(sq.searchDirectMessages('u1', 'u2', 'meeting', 10).map((m) => m.id)).toEqual(expected)
    expect(mem.searchDirectMessages('u1', 'u2', 'meeting', 10).map((m) => m.id)).toEqual(expected)
    // 群搜索同理。
    const seedG = (s: SqliteStore | MemoryStore) => {
      s.createMessage({ id: 'g1', fromId: 'u1', toId: '', groupId: 'G', kind: 'text', text: 'meeting A', createdAt: 8000 })
      s.createMessage({ id: 'g3', fromId: 'u2', toId: '', groupId: 'G', kind: 'text', text: 'meeting B', createdAt: 8000 })
      s.createMessage({ id: 'g2', fromId: 'u3', toId: '', groupId: 'G', kind: 'text', text: 'meeting C', createdAt: 8000 })
    }
    const sq2 = new SqliteStore(':memory:'); seedG(sq2)
    const mem2 = new MemoryStore(); seedG(mem2)
    expect(sq2.searchGroupMessages('G', 'meeting', 10).map((m) => m.id)).toEqual(['g3', 'g2', 'g1'])
    expect(mem2.searchGroupMessages('G', 'meeting', 10).map((m) => m.id)).toEqual(['g3', 'g2', 'g1'])
  })

  it('latestMessagesPerPeer：对端最新两条同毫秒时只返回一条（不重复出现在会话列表）', () => {
    const store = new SqliteStore(':memory:')
    store.createMessage({ id: 'x1', fromId: 'u1', toId: 'u2', kind: 'text', text: '1', createdAt: 5000 })
    // u2 最新两条都在 5000ms：旧实现 MAX(createdAt) JOIN 会双双命中 → u2 重复。
    store.createMessage({ id: 'x2', fromId: 'u2', toId: 'u1', kind: 'text', text: '2', createdAt: 5000 })
    store.createMessage({ id: 'x3', fromId: 'u1', toId: 'u2', kind: 'text', text: '3', createdAt: 5000 })
    const latest = store.latestMessagesPerPeer('u1')
    expect(latest.length).toBe(1) // u2 只出现一次
    expect(latest[0].id).toBe('x3') // (createdAt,id) 最大者为最新
    // MemoryStore 同口径（两存储对"同毫秒哪条为最新"必须一致，否则 Sqlite/JSON 预览不一致）。
    const mem = new MemoryStore()
    mem.createMessage({ id: 'x1', fromId: 'u1', toId: 'u2', kind: 'text', text: '1', createdAt: 5000 })
    mem.createMessage({ id: 'x2', fromId: 'u2', toId: 'u1', kind: 'text', text: '2', createdAt: 5000 })
    mem.createMessage({ id: 'x3', fromId: 'u1', toId: 'u2', kind: 'text', text: '3', createdAt: 5000 })
    const memLatest = mem.latestMessagesPerPeer('u1')
    expect(memLatest.length).toBe(1)
    expect(memLatest[0].id).toBe('x3')
  })

  it('persists across reopen (file-backed)', () => {
    const path = `/tmp/beeurei-test-${Math.floor(performance.now())}.db`
    const a = new SqliteStore(path)
    a.createUser(user('p1', 'persist'))
    const b = new SqliteStore(path)
    expect(b.findByUsername('persist')?.id).toBe('p1')
  })
})
