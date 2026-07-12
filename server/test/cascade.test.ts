import { describe, it, expect } from 'vitest'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { cascadeDeleteUser } from '../src/db/cascade'

function user(id: string) {
  return { id, username: id, passwordHash: 'h', displayName: id, role: 'blind', status: 'active', createdAt: 1 } as any
}

// 双存储参数化：生产跑 SqliteStore，级联抹除（GDPR 承诺）此前只在 MemoryStore 上验证过。
for (const [storeName, makeStore] of [['MemoryStore', () => new MemoryStore()], ['SqliteStore', () => new SqliteStore(':memory:')]] as const) {
describe(`cascadeDeleteUser — 抹除完整性（${storeName}）`, () => {
  it('清除被删用户的黑名单(任一方向)与站内通知；不波及他人无关数据', () => {
    const store = makeStore()
    store.createUser(user('u1'))
    store.createUser(user('u2'))
    store.createUser(user('u3'))
    // u1 拉黑 u2；u3 拉黑 u1（任一方向都须随 u1 删号清除）。u2 拉黑 u3（与 u1 无关，须保留）。
    store.createBlock({ id: 'b1', blockerId: 'u1', blockedId: 'u2', createdAt: 1 })
    store.createBlock({ id: 'b2', blockerId: 'u3', blockedId: 'u1', createdAt: 2 })
    store.createBlock({ id: 'b3', blockerId: 'u2', blockedId: 'u3', createdAt: 3 })
    // u1 的通知 + u2 的通知（u2 的须保留）。
    store.createNotification({ id: 'n1', userId: 'u1', kind: 'kyc_verified', title: 't', body: 'b', createdAt: 1 })
    store.createNotification({ id: 'n2', userId: 'u2', kind: 'report_resolved', title: 't', body: 'b', createdAt: 2 })

    cascadeDeleteUser(store, 'u1')

    // u1 已删；涉及 u1 的拉黑(b1/b2)清除，无关的 b3 保留。
    expect(store.findById('u1')).toBeUndefined()
    expect(store.findBlock('b1')).toBeUndefined()
    expect(store.findBlock('b2')).toBeUndefined()
    expect(store.findBlock('b3')).toBeTruthy()
    expect(store.blocksInvolving('u1')).toHaveLength(0) // 被删用户 id 不再残留于任何黑名单
    // u1 的通知清空，u2 的保留。
    expect(store.notificationsForUser('u1')).toHaveLength(0)
    expect(store.notificationsForUser('u2')).toHaveLength(1)
  })

  it('清除被删用户的 2FA 一次性恢复码（无主安全凭据不残留）；他人恢复码保留', () => {
    const store = makeStore()
    store.createUser(user('u1'))
    store.createUser(user('u2'))
    store.replaceRecoveryCodes('u1', ['h1', 'h2', 'h3'])
    store.replaceRecoveryCodes('u2', ['h4', 'h5'])
    expect(store.countUnusedRecoveryCodes('u1')).toBe(3)
    cascadeDeleteUser(store, 'u1')
    expect(store.countUnusedRecoveryCodes('u1')).toBe(0) // 随删号清空
    expect(store.countUnusedRecoveryCodes('u2')).toBe(2) // 他人不受影响
  })

  it('清除被删用户上传的媒体(视频消息文件元数据)；他人媒体保留', () => {
    const store = makeStore()
    store.createUser(user('u1'))
    store.createUser(user('u2'))
    store.createMedia({ id: 'vid-u1', ownerId: 'u1', mime: 'video/mp4', size: 100, createdAt: 1 })
    store.createMedia({ id: 'vid-u2', ownerId: 'u2', mime: 'video/mp4', size: 200, createdAt: 2 })

    cascadeDeleteUser(store, 'u1')

    expect(store.findMedia('vid-u1')).toBeUndefined()  // 被删用户上传的媒体随删号清除（不留孤儿 PII）
    expect(store.mediaByOwner('u1')).toHaveLength(0)
    expect(store.findMedia('vid-u2')).toBeTruthy()      // 他人媒体不受影响
  })

  it('录制方删号：其**录制**媒体随刻意保留的录制记录一并保留（不掏空成悬垂证据）；普通视频媒体照清', () => {
    const store = makeStore()
    store.createUser(user('rec'))
    // 该用户既有一条录制媒体（挂在录制记录上，作证据保留），又有一条普通视频消息媒体（应随删号清）。
    store.createMedia({ id: 'rec-media', ownerId: 'rec', mime: 'video/quicktime', size: 500, createdAt: 1 })
    store.createMedia({ id: 'plain-vid', ownerId: 'rec', mime: 'video/mp4', size: 100, createdAt: 2 })
    store.createRecording({ id: 'r1', callId: 'c1', ownerId: 'rec', consentBy: ['rec', 'peer'], reason: 'evidence', recordedAt: 1, mediaId: 'rec-media' })

    cascadeDeleteUser(store, 'rec')

    // 录制记录刻意保留（证据）；其媒体也须保留——否则记录指向已删文件成悬垂证据（Recording.mediaId 契约：同生共死）。
    expect(store.findRecording('r1')).toBeTruthy()
    expect(store.findMedia('rec-media')).toBeTruthy()
    // 普通视频消息媒体照常随删号清除（不留孤儿 PII）。
    expect(store.findMedia('plain-vid')).toBeUndefined()
  })

  it('群主删号 → 解散其群时一并清群内视频消息媒体（含他人发的，与解散端点同口径）', () => {
    const store = makeStore()
    store.createUser(user('owner'))
    store.createUser(user('mem'))
    store.createGroup({ id: 'g1', name: 'g', ownerId: 'owner', memberIds: ['owner', 'mem'], createdAt: 1 } as never)
    // mem（非群主）在群里发了视频消息——媒体 owned by mem，但随群解散应一并清（不留孤儿）。
    store.createMedia({ id: 'gv', ownerId: 'mem', mime: 'video/mp4', size: 1, createdAt: 1 })
    store.createMessage({ id: 'gmsg', fromId: 'mem', toId: '', groupId: 'g1', kind: 'video', text: 'gv', createdAt: 2 })

    cascadeDeleteUser(store, 'owner')

    expect(store.findGroup('g1')).toBeUndefined()  // 群主删号 → 群解散
    expect(store.findMedia('gv')).toBeUndefined()  // 群内视频媒体一并清（旧实现直接 deleteGroup 会漏）
    expect(store.findById('mem')).toBeTruthy()     // 其他成员账号不受影响
  })

  it('非群主成员删号 → 其在他人群里的已读游标(group_reads)一并清除（不留孤儿），不波及群与他人游标', () => {
    const store = makeStore()
    store.createUser(user('owner'))
    store.createUser(user('mem'))
    store.createGroup({ id: 'g1', name: 'g', ownerId: 'owner', memberIds: ['owner', 'mem'], createdAt: 1 } as never)
    store.setGroupRead('g1', 'owner', 100)
    store.setGroupRead('g1', 'mem', 200)
    expect(store.groupReadAt('g1', 'mem')).toBe(200)

    cascadeDeleteUser(store, 'mem') // 非群主成员删号：走 updateGroup(memberIds) 退群，不经 deleteGroup

    expect(store.findGroup('g1')).toBeTruthy()               // 群仍在（群主未删）
    expect(store.findGroup('g1')!.memberIds).toEqual(['owner']) // mem 已退群
    expect(store.groupReadAt('g1', 'mem')).toBe(0)           // mem 的已读游标已清（旧实现残留孤儿）
    expect(store.groupReadAt('g1', 'owner')).toBe(100)       // 群主游标不受影响
  })

  it('删号清除该用户**所设**的置顶（pinnedBy 幽灵引用）——被置顶消息仍在时读路径自愈不触发，须显式清；他人所设置顶保留', () => {
    const store = makeStore()
    store.createUser(user('owner'))
    store.createUser(user('mem'))
    store.createGroup({ id: 'g1', name: 'g', ownerId: 'owner', memberIds: ['owner', 'mem'], createdAt: 1 } as never)
    store.createGroup({ id: 'g2', name: 'g2', ownerId: 'owner', memberIds: ['owner', 'mem'], createdAt: 1 } as never)
    // 关键：被置顶消息由**群主(存活者)**发出（fromId=owner、toId=''）——mem 删号不会删掉它，
    // 故读路径"消息不存/已撤回才清"的悬垂自愈**永不触发**；唯有按 pinnedBy 清才能除掉这条幽灵置顶。
    store.createMessage({ id: 'm1', fromId: 'owner', toId: '', groupId: 'g1', kind: 'text', text: 'hi', createdAt: 2 })
    store.createMessage({ id: 'm2', fromId: 'owner', toId: '', groupId: 'g2', kind: 'text', text: 'yo', createdAt: 3 })
    store.setPin('g:g1', 'm1', 'mem', 4)     // mem（将删号）设的置顶
    store.setPin('g:g2', 'm2', 'owner', 5)   // owner（存活）设的置顶——须保留

    cascadeDeleteUser(store, 'mem') // 非群主成员删号：群 g1/g2 仍在

    expect(store.findMessage('m1')).toBeTruthy()          // 被置顶消息仍在（证明这不是悬垂自愈能处理的场景）
    expect(store.getPin('g:g1')).toBeUndefined()          // mem 所设置顶已清（旧实现：残留 pinnedBy='mem' 的幽灵，群里长期显示"置顶人 —"）
    expect(store.getPin('g:g2')?.pinnedBy).toBe('owner')  // owner 所设置顶不受影响
  })

  it('清除被删用户参与的通话记录（PII，非证据）；他人无关记录保留', () => {
    const store = makeStore()
    store.createUser(user('u1')); store.createUser(user('u2')); store.createUser(user('u3'))
    // u1 主叫 u2、u3 主叫 u1（任一方向含 u1，须随删号清）；u2 主叫 u3（与 u1 无关，须保留）。
    store.createCallRecord({ id: 'c1', callId: 'call1', callerId: 'u1', calleeId: 'u2', status: 'answered', createdAt: 1 })
    store.createCallRecord({ id: 'c2', callId: 'call2', callerId: 'u3', calleeId: 'u1', status: 'missed', createdAt: 2 })
    store.createCallRecord({ id: 'c3', callId: 'call3', callerId: 'u2', calleeId: 'u3', status: 'declined', createdAt: 3 })
    expect(store.callRecordsForUser('u1')).toHaveLength(2)

    cascadeDeleteUser(store, 'u1')

    // 涉及 u1 的记录(c1/c2)清除，无关的 c3 保留——被删 id 不再残留于任何通话记录（否则"谁给谁打过电话"成孤儿 PII）。
    expect(store.callRecordsForUser('u1')).toHaveLength(0)
    expect(store.callRecordsForUser('u2')).toHaveLength(1) // 只剩 c3
    expect(store.callRecordsForUser('u3')).toHaveLength(1) // 只剩 c3
    expect(store.allCallRecords().map((r) => r.id)).toEqual(['c3'])
  })
})
}
