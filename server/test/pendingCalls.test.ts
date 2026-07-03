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

  it('activeCountFor：只数某发起人未过期的待接来电（防灌待接表限流依据）', () => {
    const r = new PendingCallRegistry() // 默认 TTL 180s
    r.register({ callId: 'a1', fromUserId: 'A', fromName: 'A', toUserIds: ['x'], createdAt: 0 })
    r.register({ callId: 'a2', fromUserId: 'A', fromName: 'A', toUserIds: ['y'], createdAt: 0 })
    r.register({ callId: 'b1', fromUserId: 'B', fromName: 'B', toUserIds: ['z'], createdAt: 0 })
    expect(r.activeCountFor('A', 0)).toBe(2)
    expect(r.activeCountFor('B', 0)).toBe(1)
    expect(r.activeCountFor('A', 200_000)).toBe(0) // 过期(>180s)后归零
  })

  it('硬上限优先淘汰未接听的振铃积压，保留已接听通话——接听者掉线仍能凭 participants 重接', () => {
    const r = new PendingCallRegistry(180_000, 2) // maxEntries=2
    r.register(base({ callId: 'active', toUserIds: ['helper1'], createdAt: 0 }))
    r.claimAnswer('active', 'helper1', 1)                                          // 老 createdAt 的**已接听**通话
    r.register(base({ callId: 'ringing', toUserIds: ['helper2'], createdAt: 10 })) // 未接听振铃，size=2
    r.register(base({ callId: 'newest', toUserIds: ['helper3'], createdAt: 20 }))  // 触发 cap
    // 旧实现按 createdAt 淘汰最旧 → 会淘汰 'active'(createdAt=0，却已接听)；新实现优先淘汰未接听。
    expect(r.participants('active')).toEqual(['blind1', 'helper1']) // 已接听通话保留（可重接）
    expect(r.participants('ringing')).toBeNull()                    // 未接听积压被淘汰（可重拨）
    expect(r.participants('newest')).toBeTruthy()                   // 新条目入队
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

  it('participants(now) 在响铃窗口内可入会、超窗才拒（见复审 #4）', () => {
    const r = new PendingCallRegistry(180_000)
    r.register(base({ createdAt: 0, toUserIds: ['helper1'] }))
    // 晚接听（120s，仍在 180s 窗口内）：合法亲友能拿到参与者列表入会
    expect(r.participants('c1', 120_000)).toEqual(['blind1', 'helper1'])
    // 超过窗口（200s）：清理并拒绝
    expect(r.participants('c1', 200_000)).toBeNull()
  })

  it('hasActive 反映未过期登记（跨注册表去重用）', () => {
    const r = new PendingCallRegistry(180_000)
    r.register(base({ createdAt: 0 }))
    expect(r.hasActive('c1', 100_000)).toBe(true)
    expect(r.hasActive('c1', 200_000)).toBe(false)
  })

  it('returns most recent first', () => {
    const r = new PendingCallRegistry()
    r.register(base({ callId: 'old', createdAt: 1 }))
    r.register(base({ callId: 'new', createdAt: 2 }))
    expect(r.incomingFor('helper1', 3).map((c) => c.callId)).toEqual(['new', 'old'])
  })

  it('本人拒绝后不再在其设备重复振铃，但其它未拒目标仍可接（可靠性复审）', () => {
    const r = new PendingCallRegistry()
    r.register(base({ callId: 'g', toUserIds: ['h1', 'h2'] }))
    r.decline('g', 'h1', 0)
    expect(r.incomingFor('h1', 1).length).toBe(0) // h1 拒绝后本机不再振铃
    expect(r.incomingFor('h2', 1).length).toBe(1) // h2 仍能接听
    // 发起方仍能经 status 看到 h1 已拒绝。
    expect(r.status('g', 1).declinedAll).toBe(false)
  })

  it('roomParticipants：群呼首接后房间只放行「发起者+赢家」，落败/未接目标被挡（防挤占名额）', () => {
    const r = new PendingCallRegistry()
    r.register(base({ callId: 'g', toUserIds: ['h1', 'h2'] }))
    // 未接听前：全体目标都可入房（盲人可能先入房等待）。
    expect(r.roomParticipants('g', 1)).toEqual(['blind1', 'h1', 'h2'])
    // h1 首接后：房间只剩 [发起者, h1]，h2 不在其中 → ws join 会被 not_a_participant 拒。
    expect(r.claimAnswer('g', 'h1', 1)).toBe('h1')
    expect(r.roomParticipants('g', 2)).toEqual(['blind1', 'h1'])
    expect(r.roomParticipants('g', 2)!.includes('h2')).toBe(false)
    // 而旧的 participants（用于其它场景）仍是全体——本次只收紧了信令房间视图。
    expect(r.participants('g', 2)).toEqual(['blind1', 'h1', 'h2'])
  })
})
