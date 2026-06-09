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

    store.createLink({ id: 'l1', ownerId: 'u1', memberId: 'u2', relation: '妈妈', isEmergency: true, createdAt: 2000 })
    const links = store.linksByOwner('u1')
    expect(links.length).toBe(1)
    expect(links[0].isEmergency).toBe(true) // 0/1 ↔ bool 映射
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

  it('persists across reopen (file-backed)', () => {
    const path = `/tmp/beeurei-test-${Math.floor(performance.now())}.db`
    const a = new SqliteStore(path)
    a.createUser(user('p1', 'persist'))
    const b = new SqliteStore(path)
    expect(b.findByUsername('persist')?.id).toBe('p1')
  })
})
