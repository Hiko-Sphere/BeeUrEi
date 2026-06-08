import { describe, it, expect } from 'vitest'
import { PendingCallRegistry } from '../src/assist/pendingCalls'

describe('PendingCallRegistry', () => {
  const base = (over: Partial<{ callId: string; toUserIds: string[]; createdAt: number }> = {}) => ({
    callId: over.callId ?? 'c1',
    fromUserId: 'blind1',
    fromName: '小明',
    toUserIds: over.toUserIds ?? ['helper1'],
    createdAt: over.createdAt ?? 0,
  })

  it('delivers a pending call only to its targets', () => {
    const r = new PendingCallRegistry()
    r.register(base({ toUserIds: ['helper1', 'family1'] }))
    expect(r.incomingFor('helper1', 0).map((c) => c.callId)).toEqual(['c1'])
    expect(r.incomingFor('family1', 0).length).toBe(1)
    expect(r.incomingFor('stranger', 0).length).toBe(0)
  })

  it('prunes expired calls past TTL', () => {
    const r = new PendingCallRegistry(60_000)
    r.register(base({ createdAt: 0 }))
    expect(r.incomingFor('helper1', 30_000).length).toBe(1) // 未过期
    expect(r.incomingFor('helper1', 61_000).length).toBe(0) // 过期清除
    expect(r.size).toBe(0)
  })

  it('cancel removes a call', () => {
    const r = new PendingCallRegistry()
    r.register(base())
    r.cancel('c1')
    expect(r.incomingFor('helper1', 0).length).toBe(0)
  })

  it('returns most recent first', () => {
    const r = new PendingCallRegistry()
    r.register(base({ callId: 'old', createdAt: 1 }))
    r.register(base({ callId: 'new', createdAt: 2 }))
    expect(r.incomingFor('helper1', 3).map((c) => c.callId)).toEqual(['new', 'old'])
  })
})
