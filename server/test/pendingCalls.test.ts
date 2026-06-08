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

  it('cancel only by owner or target (归属校验)', () => {
    const r = new PendingCallRegistry()
    r.register(base())
    expect(r.cancel('c1', 'stranger')).toBe(false) // 非发起人/目标不可取消
    expect(r.incomingFor('helper1', 0).length).toBe(1)
    expect(r.cancel('c1', 'helper1')).toBe(true)    // 目标可取消
    expect(r.incomingFor('helper1', 0).length).toBe(0)
  })

  it('rejects overwriting another user’s callId', () => {
    const r = new PendingCallRegistry()
    expect(r.register(base())).toBe(true)
    // 同 callId、不同发起人 → 拒绝覆盖
    expect(r.register({ ...base(), fromUserId: 'attacker', toUserIds: ['victim'] })).toBe(false)
    expect(r.incomingFor('victim', 0).length).toBe(0) // 攻击者注入失败
    expect(r.incomingFor('helper1', 0).length).toBe(1)
    // 同发起人可更新自己的
    expect(r.register({ ...base(), toUserIds: ['family1'] })).toBe(true)
  })

  it('target cancel only removes self in a multi-target group call (见审查 #5)', () => {
    const r = new PendingCallRegistry()
    r.register(base({ toUserIds: ['h1', 'h2'] }))
    expect(r.cancel('c1', 'h1')).toBe(true)
    expect(r.incomingFor('h1', 0).length).toBe(0) // h1 退出
    expect(r.incomingFor('h2', 0).length).toBe(1) // h2 仍能接听
    expect(r.cancel('c1', 'h2')).toBe(true)        // 最后一个目标退出 → 整条删除
    expect(r.incomingFor('h2', 0).length).toBe(0)
  })

  it('register prunes expired entries before ownership check (见审查 #4)', () => {
    const r = new PendingCallRegistry(60_000)
    expect(r.register(base({ createdAt: 0 }))).toBe(true) // A(blind1) at t=0
    // B 在 A 过期(t=70s)后用同一 callId 登记 → 不应被僵尸条目挡住
    expect(r.register({ callId: 'c1', fromUserId: 'B', fromName: 'b', toUserIds: ['x'], createdAt: 70_000 })).toBe(true)
    expect(r.incomingFor('x', 70_000).length).toBe(1)
  })

  it('returns most recent first', () => {
    const r = new PendingCallRegistry()
    r.register(base({ callId: 'old', createdAt: 1 }))
    r.register(base({ callId: 'new', createdAt: 2 }))
    expect(r.incomingFor('helper1', 3).map((c) => c.callId)).toEqual(['new', 'old'])
  })
})
