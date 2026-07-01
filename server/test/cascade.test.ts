import { describe, it, expect } from 'vitest'
import { MemoryStore } from '../src/db/store'
import { cascadeDeleteUser } from '../src/db/cascade'

function user(id: string) {
  return { id, username: id, passwordHash: 'h', displayName: id, role: 'blind', status: 'active', createdAt: 1 } as any
}

describe('cascadeDeleteUser — 抹除完整性', () => {
  it('清除被删用户的黑名单(任一方向)与站内通知；不波及他人无关数据', () => {
    const store = new MemoryStore()
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
    const store = new MemoryStore()
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
    const store = new MemoryStore()
    store.createUser(user('u1'))
    store.createUser(user('u2'))
    store.createMedia({ id: 'vid-u1', ownerId: 'u1', mime: 'video/mp4', size: 100, createdAt: 1 })
    store.createMedia({ id: 'vid-u2', ownerId: 'u2', mime: 'video/mp4', size: 200, createdAt: 2 })

    cascadeDeleteUser(store, 'u1')

    expect(store.findMedia('vid-u1')).toBeUndefined()  // 被删用户上传的媒体随删号清除（不留孤儿 PII）
    expect(store.mediaByOwner('u1')).toHaveLength(0)
    expect(store.findMedia('vid-u2')).toBeTruthy()      // 他人媒体不受影响
  })

  it('群主删号 → 解散其群时一并清群内视频消息媒体（含他人发的，与解散端点同口径）', () => {
    const store = new MemoryStore()
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
    const store = new MemoryStore()
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
})
