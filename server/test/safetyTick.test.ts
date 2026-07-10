import { describe, it, expect } from 'vitest'
import { MemoryStore, type User } from '../src/db/store'
import { NoopPushSender } from '../src/push/apns'
import { NoopWebPushSender } from '../src/push/webPush'
import { runSafetyTick, type SafetyTickDeps } from '../src/safety/tick'

const user = (id: string): User => ({ id, username: id, passwordHash: 'h', displayName: id, role: 'blind', status: 'active', createdAt: 1000 })

function deps(store: MemoryStore, metrics: { inc(n: string, by?: number): void }): SafetyTickDeps {
  return { store, push: new NoopPushSender(), webPush: new NoopWebPushSender(), metrics, escalateAfterMs: 5 * 60_000, staleGraceMs: 60 * 60_000, remindLeadMs: 10 * 60_000 }
}

describe('runSafetyTick 编排', () => {
  it('到期报到 → fire 步骤跑通并计数 safety_checkin_fires_total（dead-man\'s-switch 引擎正常）', () => {
    const store = new MemoryStore()
    store.createUser(user('blindA'))
    const now = Date.now()
    store.createSafetyTimer({ id: 'st1', ownerId: 'blindA', startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    const incs: Record<string, number> = {}
    const metrics = { inc: (n: string, by = 1) => { incs[n] = (incs[n] ?? 0) + by } }
    runSafetyTick(deps(store, metrics), now)
    expect(incs['safety_checkin_fires_total']).toBe(1) // 到期计时器被 fire
    expect(incs['safety_tick_errors_total']).toBeUndefined() // 无步骤报错
    expect(store.getSafetyTimer('st1')!.status).toBe('fired')
  })

  it('故障隔离：一步抛错 → safety_tick_errors_total++ 且**其余步骤照跑**（一处坏绝不拖垮 dead-man\'s-switch）', () => {
    // 令 escalate 步骤所依赖的 store 读抛错，同时留一个到期计时器给 fire 步骤——验证 fire 仍执行。
    class ThrowingEscalateStore extends MemoryStore {
      unacknowledgedEmergencyEvents(): never { throw new Error('DB locked') }
    }
    const store = new ThrowingEscalateStore()
    store.createUser(user('blindB'))
    const now = Date.now()
    store.createSafetyTimer({ id: 'st2', ownerId: 'blindB', startedAt: now - 30 * 60_000, dueAt: now - 1000, status: 'active' })
    const incs: Record<string, number> = {}
    const metrics = { inc: (n: string, by = 1) => { incs[n] = (incs[n] ?? 0) + by } }
    runSafetyTick(deps(store, metrics), now)
    expect(incs['safety_tick_errors_total']).toBe(1)     // escalate 步骤抛错被计入
    expect(incs['safety_checkin_fires_total']).toBe(1)   // 但 fire 步骤仍照跑（未被 escalate 的失败阻断）
    expect(store.getSafetyTimer('st2')!.status).toBe('fired')
  })

  it('无事可做 → 不计任何成/败（计数为 0 与报错区分开）', () => {
    const store = new MemoryStore()
    const incs: Record<string, number> = {}
    const metrics = { inc: (n: string, by = 1) => { incs[n] = (incs[n] ?? 0) + by } }
    runSafetyTick(deps(store, metrics), Date.now())
    expect(incs).toEqual({}) // 既无成功计数也无 error 计数
  })
})
