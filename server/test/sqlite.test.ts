import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from '../src/db/sqliteStore'
import { MemoryStore, type User } from '../src/db/store'

function user(id: string, username: string): User {
  return { id, username, passwordHash: 'h', displayName: username, role: 'blind', status: 'active', createdAt: 1000 }
}

describe('SqliteStore (node:sqlite)', () => {
  it('文件库启用 WAL + NORMAL + busy_timeout（服务端标准配置；崩溃安全不降级）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beeurei-wal-'))
    try {
      const store = new SqliteStore(join(dir, 'wal.db')) as unknown as { db: { prepare: (s: string) => { get: () => any } }; backupTo: (p: string) => void }
      expect(store.db.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal')
      expect(Number(store.db.prepare('PRAGMA synchronous').get().synchronous)).toBe(1) // NORMAL
      expect(Number(store.db.prepare('PRAGMA busy_timeout').get().timeout)).toBe(5000)
      // WAL 下 VACUUM INTO 备份仍产出可恢复快照（写入 → 备份 → 重开查到）。
      ;(store as unknown as SqliteStore).createUser(user('w1', 'waluser'))
      store.backupTo(join(dir, 'snap.db'))
      expect(new SqliteStore(join(dir, 'snap.db')).findByUsername('waluser')?.id).toBe('w1')
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('热路径索引存在（授权/拉黑/通话历史/媒体不退化为全表扫描）', () => {
    const store = new SqliteStore(':memory:') as unknown as { db: { prepare: (s: string) => { all: () => { name: string }[] } } }
    const names = new Set(store.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name))
    for (const idx of ['idx_links_owner', 'idx_links_member', 'idx_blocks_blocker', 'idx_blocks_blocked',
      'idx_callrec_caller', 'idx_callrec_callee', 'idx_recordings_owner', 'idx_media_owner', 'idx_notif_user',
      'idx_users_username_nocase', 'idx_users_email_nocase', 'idx_users_phone', 'idx_users_apple',
      'idx_recordings_media', 'idx_reports_evidence']) {
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
    // 删号级联：清该用户在所有群的已读游标（SQL DELETE WHERE userId 路径），仅清本人、不波及他人。
    store.setGroupRead('g1', 'u2', 4000)
    store.deleteGroupReadsForUser('u3')
    expect(store.groupReadAt('g1', 'u3')).toBe(0)     // 已清
    expect(store.groupReadAt('g1', 'u2')).toBe(4000)  // 他人游标保留

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

  it('消息可选元数据 replyTo/editedAt/reaction 往返（SqliteStore 列+映射，与 MemoryStore 同形）', () => {
    // 这三个可选字段都是分批加列的（reaction/编辑/引用回复）；prod 走 SqliteStore 而测试多用 MemoryStore，
    // 列 DDL/迁移/INSERT/toMessage 任一处漏掉都不会被 MemoryStore 测试发现。此处直接比对两库形状一致。
    const stores = [new SqliteStore(':memory:'), new MemoryStore()] as const
    for (const store of stores) {
      const full: import('../src/db/store').ChatMessage =
        { id: 'r1', fromId: 'u1', toId: 'u2', kind: 'text', text: '收到', createdAt: 1000, reaction: '👍', editedAt: 1500, replyTo: 'orig1', forwarded: true }
      store.createMessage(full)
      // 全字段完整还原。
      expect(store.findMessage('r1')).toMatchObject({ reaction: '👍', editedAt: 1500, replyTo: 'orig1', forwarded: true })
      // 经列表路径（messagesBetween）同样保留 replyTo（不只 findMessage）。
      expect(store.messagesBetween('u1', 'u2', 10).find((m) => m.id === 'r1')?.replyTo).toBe('orig1')
      // 不设可选字段 → 读回 undefined（不是 null/0），两库一致（映射须用 ?? undefined）。
      store.createMessage({ id: 'r2', fromId: 'u1', toId: 'u2', kind: 'text', text: '无附加', createdAt: 2000 })
      const bare = store.findMessage('r2')!
      expect(bare.replyTo).toBeUndefined()
      expect(bare.editedAt).toBeUndefined()
      expect(bare.reaction).toBeUndefined()
      expect(bare.forwarded).toBeUndefined() // 未转发 → undefined（不是 false/0）
      // 编辑更新后 editedAt 落库并读回（updateMessage 路径）。
      store.updateMessage('r2', { text: '改了', editedAt: 2500 })
      expect(store.findMessage('r2')).toMatchObject({ text: '改了', editedAt: 2500 })
    }
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

  it('跨会话全局搜索 searchAllMessagesFor：只含本人参与的单聊+所在群、稳定序，Sqlite 与 Memory 一致', () => {
    const seed = (s: SqliteStore | MemoryStore) => {
      s.createGroup({ id: 'gm', name: '我的群', ownerId: 'u1', memberIds: ['u1', 'u9'], createdAt: 1000 })
      s.createGroup({ id: 'gx', name: '别人的群', ownerId: 'u8', memberIds: ['u8', 'u9'], createdAt: 1000 })
      s.createMessage({ id: 'a1', fromId: 'u1', toId: 'u2', kind: 'text', text: '医院地址发你', createdAt: 5000 })  // 我发的单聊 ✓
      s.createMessage({ id: 'a2', fromId: 'u3', toId: 'u1', kind: 'text', text: '地址收到了', createdAt: 6000 })   // 发给我的单聊 ✓
      s.createMessage({ id: 'a3', fromId: 'u1', toId: '', groupId: 'gm', kind: 'text', text: '群里发个地址', createdAt: 7000 }) // 我在的群 ✓
      s.createMessage({ id: 'x1', fromId: 'u8', toId: 'u9', kind: 'text', text: '他们的地址', createdAt: 8000 })   // 他人单聊 ✗
      s.createMessage({ id: 'x2', fromId: 'u8', toId: '', groupId: 'gx', kind: 'text', text: '外群的地址', createdAt: 9000 }) // 非成员群 ✗
      s.createMessage({ id: 'x3', fromId: 'u1', toId: 'u2', kind: 'image', text: '地址截图data', createdAt: 9500 }) // 非文本 ✗
    }
    const sq = new SqliteStore(':memory:'); seed(sq)
    const mem = new MemoryStore(); seed(mem)
    const expected = ['a3', 'a2', 'a1'] // 时间倒序；绝不含他人单聊/外群/非文本
    expect(sq.searchAllMessagesFor('u1', '地址', 10).map((m) => m.id)).toEqual(expected)
    expect(mem.searchAllMessagesFor('u1', '地址', 10).map((m) => m.id)).toEqual(expected)
    // 空查询与无命中。
    expect(sq.searchAllMessagesFor('u1', '', 10)).toEqual([])
    expect(sq.searchAllMessagesFor('u1', '查无此词zzz', 10)).toEqual([])
    // 无任何群成员身份的用户（SQL groupClause 空分支）也正常：u2 只有单聊命中。
    expect(sq.searchAllMessagesFor('u2', '地址', 10).map((m) => m.id)).toEqual(['a1'])
    expect(mem.searchAllMessagesFor('u2', '地址', 10).map((m) => m.id)).toEqual(['a1'])
  })

  it('搜索大小写不敏感覆盖非 ASCII（重音拉丁/西里尔/全大写拼音）：Sqlite 与 Memory 一致', () => {
    // SQLite 内置 LOWER() 只折叠 ASCII，会漏掉大写非 ASCII 文本（CAFÉ/MÜLLER/ПРИВЕТ）；已改用 ulower
    // 镜像 JS toLowerCase。此测确保生产 SqliteStore 与 MemoryStore 对这些查询给出相同（非空）结果，
    // 否则盲人在会话内搜欧洲人名/品牌/西里尔时线上漏搜而测试却过（存储实现分叉）。
    const seed = (s: SqliteStore | MemoryStore) => {
      s.createMessage({ id: 'n1', fromId: 'u1', toId: 'u2', kind: 'text', text: '在 CAFÉ 见面', createdAt: 9000 })
      s.createMessage({ id: 'n2', fromId: 'u1', toId: 'u2', kind: 'text', text: '联系 MÜLLER 先生', createdAt: 9100 })
      s.createMessage({ id: 'n3', fromId: 'u1', toId: 'u2', kind: 'text', text: 'ПРИВЕТ 你好', createdAt: 9200 })
    }
    const sq = new SqliteStore(':memory:'); seed(sq)
    const mem = new MemoryStore(); seed(mem)
    for (const [q, id] of [['café', 'n1'], ['müller', 'n2'], ['привет', 'n3']] as const) {
      const sqIds = sq.searchDirectMessages('u1', 'u2', q, 10).map((m) => m.id)
      expect(sqIds).toEqual([id])                                        // 生产存储不再漏搜大写非 ASCII
      expect(mem.searchDirectMessages('u1', 'u2', q, 10).map((m) => m.id)).toEqual(sqIds) // 两存储同口径
    }
  })

  it('AI 视觉每日配额计数：Sqlite 与 Memory 同口径（同日累加 / 跨日重置 / 用户隔离）', () => {
    // recordVisionCall 的 upsert 用 SQL 的 ON CONFLICT+CASE WHEN day=excluded.day，是"prod SQLite vs 测试
    // Memory 语义分叉"的高危处——必须两存储行为逐格一致，否则线上配额与测试不符（漏计=烧超额，多计=误封）。
    const exercise = (s: SqliteStore | MemoryStore) => {
      const seq: number[] = []
      seq.push(s.visionCallsOnDay('u1', '2026-07-04'))            // 0：初始
      s.recordVisionCall('u1', '2026-07-04'); seq.push(s.visionCallsOnDay('u1', '2026-07-04')) // 1
      s.recordVisionCall('u1', '2026-07-04'); seq.push(s.visionCallsOnDay('u1', '2026-07-04')) // 2：同日累加
      seq.push(s.visionCallsOnDay('u1', '2026-07-05'))            // 0：另一日独立
      s.recordVisionCall('u1', '2026-07-05'); seq.push(s.visionCallsOnDay('u1', '2026-07-05')) // 1：跨日重置为 1
      seq.push(s.visionCallsOnDay('u1', '2026-07-04'))            // 0：单行/用户，旧日的计数已被覆盖
      seq.push(s.visionCallsOnDay('u2', '2026-07-05'))            // 0：用户隔离
      s.deleteVisionUsageForUser('u1'); seq.push(s.visionCallsOnDay('u1', '2026-07-05')) // 0：删号级联清
      return seq
    }
    const sq = exercise(new SqliteStore(':memory:'))
    const mem = exercise(new MemoryStore())
    expect(sq).toEqual([0, 1, 2, 0, 1, 0, 0, 0])
    expect(mem).toEqual(sq) // 两存储逐格一致
  })

  it('AI 视觉配额退还 refundVisionCall：Sqlite 与 Memory 同口径（下限0退还 / 跨日不误减 / 陌生用户 no-op）', () => {
    // refundVisionCall 是"先占额、上游失败再退还"并发安全设计的关键（route 在 await 前 reserve、失败 catch 里 refund）：
    // SqliteStore 用 `UPDATE ... WHERE day=? AND count>0`，与 Memory 的 `e.day===day && e.count>0` 必须逐格一致，
    // 否则线上要么**少退**（失败也烧用户额度→付费功能假报"今日已用完"）、要么**误退为负/退错日**（配额泄漏→烧超运维预算）。
    const exercise = (s: SqliteStore | MemoryStore) => {
      const seq: number[] = []
      s.recordVisionCall('u1', '2026-07-04')
      s.recordVisionCall('u1', '2026-07-04'); seq.push(s.visionCallsOnDay('u1', '2026-07-04')) // 2：占两次
      s.refundVisionCall('u1', '2026-07-04'); seq.push(s.visionCallsOnDay('u1', '2026-07-04')) // 1：退还一次
      s.refundVisionCall('u1', '2026-07-04'); seq.push(s.visionCallsOnDay('u1', '2026-07-04')) // 0
      s.refundVisionCall('u1', '2026-07-04'); seq.push(s.visionCallsOnDay('u1', '2026-07-04')) // 0：下限 0，绝不退为负
      // 跨日不误减：当前单行桶已是 07-05，退还旧日 07-04 绝不动今日计数（WHERE day=? / e.day===day 守卫）。
      s.recordVisionCall('u1', '2026-07-05'); seq.push(s.visionCallsOnDay('u1', '2026-07-05')) // 1：跨日重置
      s.refundVisionCall('u1', '2026-07-04'); seq.push(s.visionCallsOnDay('u1', '2026-07-05')) // 1：退旧日不减今日
      s.refundVisionCall('u2', '2026-07-05'); seq.push(s.visionCallsOnDay('u2', '2026-07-05')) // 0：陌生用户 no-op，不建行不抛
      return seq
    }
    const sq = exercise(new SqliteStore(':memory:'))
    const mem = exercise(new MemoryStore())
    expect(sq).toEqual([2, 1, 0, 0, 1, 1, 0])
    expect(mem).toEqual(sq) // 两存储逐格一致
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

  it('allLinks / passkeysForUser 顺序两存储一致：createdAt 降序（最新在前）', () => {
    // 列表读接口在 SqliteStore(ORDER BY createdAt DESC) 与 MemoryStore 必须同序，否则管理后台/账户导出/passkey
    // 管理列表在测试(Memory)与线上(SQLite)看到不同排序，且测试可能锁死 Memory 插入序而线上悄悄不符（prod/test 分叉）。
    const seedLinks = (s: SqliteStore | MemoryStore) => {
      s.createLink({ id: 'lB', ownerId: 'u1', memberId: 'u2', relation: '', isEmergency: false, createdAt: 2000, status: 'accepted' })
      s.createLink({ id: 'lC', ownerId: 'u1', memberId: 'u3', relation: '', isEmergency: false, createdAt: 3000, status: 'accepted' }) // 最新
      s.createLink({ id: 'lA', ownerId: 'u1', memberId: 'u4', relation: '', isEmergency: false, createdAt: 1000, status: 'accepted' }) // 最早
    }
    const sq = new SqliteStore(':memory:'); seedLinks(sq)
    const mem = new MemoryStore(); seedLinks(mem)
    const expectedLinks = ['lC', 'lB', 'lA'] // createdAt 3000>2000>1000
    expect(sq.allLinks().map((l) => l.id)).toEqual(expectedLinks)
    expect(mem.allLinks().map((l) => l.id)).toEqual(expectedLinks) // 修复前 Memory 返回插入序 [lB,lC,lA] → 失败

    const seedKeys = (s: SqliteStore | MemoryStore) => {
      s.createPasskey({ id: 'kB', userId: 'u1', credentialId: 'cB', publicKey: 'p', counter: 0, createdAt: 2000 })
      s.createPasskey({ id: 'kC', userId: 'u1', credentialId: 'cC', publicKey: 'p', counter: 0, createdAt: 3000 }) // 最新
      s.createPasskey({ id: 'kA', userId: 'u1', credentialId: 'cA', publicKey: 'p', counter: 0, createdAt: 1000 })
      s.createPasskey({ id: 'kX', userId: 'u9', credentialId: 'cX', publicKey: 'p', counter: 0, createdAt: 9000 }) // 他人：不混入
    }
    const sq2 = new SqliteStore(':memory:'); seedKeys(sq2)
    const mem2 = new MemoryStore(); seedKeys(mem2)
    const expectedKeys = ['kC', 'kB', 'kA']
    expect(sq2.passkeysForUser('u1').map((k) => k.id)).toEqual(expectedKeys)
    expect(mem2.passkeysForUser('u1').map((k) => k.id)).toEqual(expectedKeys)
  })

  it('persists across reopen (file-backed)', () => {
    const path = `/tmp/beeurei-test-${Math.floor(performance.now())}.db`
    const a = new SqliteStore(path)
    a.createUser(user('p1', 'persist'))
    const b = new SqliteStore(path)
    expect(b.findByUsername('persist')?.id).toBe('p1')
  })

  it('app-config 持久化两存储一致：features 逐键合并 + requireVerification（生产 SqliteStore 整库 JSON 路径）', () => {
    // 最高产分叉类（SQLite vs Memory）：SqliteStore 把整份 config 以 JSON 存入 config 行，
    // 若日后改成按列存储会静默丢键。此测锁死：关某个功能开关只影响该键、requireVerification 标量可单独持久化，
    // 且生产(SqliteStore) 与测试(MemoryStore) 完全一致。
    const check = (s: SqliteStore | MemoryStore) => {
      s.setAppConfig({ features: { locationSharing: false } }) // 只关 locationSharing
      s.setAppConfig({ requireVerification: true })            // 再单独开实名门禁
      const c = s.getAppConfig()
      expect(c.features.locationSharing).toBe(false) // 关掉的键持久化
      expect(c.features.calls).toBe(true)            // 逐键合并：其余功能仍默认 true，未被覆盖
      expect(c.requireVerification).toBe(true)       // 标量字段单独持久化
    }
    check(new SqliteStore(':memory:'))
    check(new MemoryStore())
  })

  it('createPasskey credentialId 冲突防护两存储一致：夺他人凭据(异 id 同 credentialId)抛、绝不删/覆盖既有 passkey', () => {
    // 同 createUser 夺舍类：SqliteStore 曾用 INSERT OR REPLACE→credentialId UNIQUE 冲突会删掉他人免密凭据；
    // MemoryStore 裸 set→留两条同 credentialId。锁死：异 id 同 credentialId 一律抛、既有 passkey 保住。
    const check = (s: SqliteStore | MemoryStore) => {
      s.createPasskey({ id: 'pkA', userId: 'uA', credentialId: 'credX', publicKey: 'pub', counter: 0, createdAt: 1000 })
      expect(() => s.createPasskey({ id: 'pkB', userId: 'uB', credentialId: 'credX', publicKey: 'pub2', counter: 0, createdAt: 2000 })).toThrow()
      const found = s.findPasskeyByCredentialId('credX')
      expect(found?.id).toBe('pkA')       // 原凭据仍在（未被删/覆盖）
      expect(found?.userId).toBe('uA')     // 仍属原主，非被 uB 夺取
      expect(s.passkeysForUser('uB')).toHaveLength(0) // uB 未获得该凭据
      // 不同 credentialId 正常并存。
      s.createPasskey({ id: 'pkC', userId: 'uA', credentialId: 'credY', publicKey: 'pub3', counter: 0, createdAt: 3000 })
      expect(s.passkeysForUser('uA')).toHaveLength(2)
    }
    check(new SqliteStore(':memory:'))
    check(new MemoryStore())
  })

  it('createUser 同名夺舍防护两存储一致：重名(异 id)抛错、绝不删既有账号；同 id(updateUser) 覆盖放行', () => {
    // 严重地雷类：SqliteStore createUser 用 INSERT OR REPLACE，username UNIQUE 冲突会**删掉他人账号**（静默接管/丢号）；
    // MemoryStore 裸 set 则留两个同名账号。两存储都错、方向相反。锁死：重名(异 id) 一律抛、既有账号保住、同 id 覆盖仍可。
    const check = (s: SqliteStore | MemoryStore) => {
      s.createUser(user('idA', 'alice'))
      // 另一个 id 用同名（大小写不敏感）→ 抛 username_taken，且**绝不**删掉 idA。
      expect(() => s.createUser(user('idB', 'ALICE'))).toThrow()
      expect(s.findByUsername('alice')?.id).toBe('idA') // idA 仍在（未被 INSERT OR REPLACE 删掉）
      expect(s.findById('idB')).toBeUndefined()         // idB 未建（MemoryStore 也不再留两条同名）
      // 同 id 覆盖（updateUser 复用 createUser）：不抛，改昵称保住用户名。
      expect(() => s.updateUser('idA', { displayName: 'Alice A.' })).not.toThrow()
      expect(s.findById('idA')?.displayName).toBe('Alice A.')
      expect(s.findByUsername('alice')?.id).toBe('idA')
      // 改用户名到一个空闲名：放行。
      s.updateUser('idA', { username: 'alice2' })
      expect(s.findByUsername('alice2')?.id).toBe('idA')
    }
    check(new SqliteStore(':memory:'))
    check(new MemoryStore())
  })
})
