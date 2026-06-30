import { describe, it, expect } from 'vitest'
import { SqliteStore } from '../src/db/sqliteStore'
import type { User } from '../src/db/store'

function user(id: string, username: string): User {
  return { id, username, passwordHash: 'h', displayName: username, role: 'blind', status: 'active', createdAt: 1000 }
}

describe('SqliteStore (node:sqlite)', () => {
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

  it('persists across reopen (file-backed)', () => {
    const path = `/tmp/beeurei-test-${Math.floor(performance.now())}.db`
    const a = new SqliteStore(path)
    a.createUser(user('p1', 'persist'))
    const b = new SqliteStore(path)
    expect(b.findByUsername('persist')?.id).toBe('p1')
  })
})
