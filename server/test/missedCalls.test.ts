import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'

// 未接来电角标（与手机通话 App 一致）：盲人离开手机回来，从图标/导航角标就知道"有人来过电话"。
describe('未看未接来电计数 missedCallCountForUser（Memory↔Sqlite parity）', () => {
  for (const makeStore of [() => new MemoryStore(), () => new SqliteStore(':memory:')]) {
    const name = makeStore().constructor.name
    it(`${name}: 只数我作为被叫的 missed、晚于 sinceMs；answered/declined/呼出不计`, () => {
      const store = makeStore()
      const rec = (over: Partial<{ id: string; callId: string; callerId: string; calleeId: string; status: 'missed' | 'answered' | 'declined'; createdAt: number }>) =>
        store.createCallRecord({ id: over.id!, callId: over.callId ?? 'c', callerId: over.callerId ?? 'x', calleeId: over.calleeId ?? 'me', status: over.status ?? 'missed', createdAt: over.createdAt ?? 1000 })
      rec({ id: 'r1', calleeId: 'me', status: 'missed', createdAt: 1000 })       // 计
      rec({ id: 'r2', calleeId: 'me', status: 'missed', createdAt: 2000 })       // 计
      rec({ id: 'r3', calleeId: 'me', status: 'answered', createdAt: 3000 })     // 已接，不计
      rec({ id: 'r4', calleeId: 'me', status: 'declined', createdAt: 3000 })     // 我拒的，不计
      rec({ id: 'r5', callerId: 'me', calleeId: 'other', status: 'missed', createdAt: 3000 }) // 呼出，不计
      expect(store.missedCallCountForUser('me', 0)).toBe(2)      // r1+r2
      expect(store.missedCallCountForUser('me', 1000)).toBe(1)   // 只 r2（>1000）
      expect(store.missedCallCountForUser('me', 2000)).toBe(0)   // 都已看过
      expect(store.missedCallCountForUser('nobody', 0)).toBe(0)
    })
  }
})

describe('未接来电并入总角标 + 打开通话记录即清（端到端）', () => {
  async function setup() {
    const app = buildApp(new MemoryStore())
    const reg = async (u: string, role: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'strong-pass-9x', role } })).json()
    const blind = await reg('mcblind', 'blind')
    const helper = await reg('mchelper', 'helper')
    const bh = { authorization: `Bearer ${blind.token}` }
    const hh = { authorization: `Bearer ${helper.token}` }
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: bh, payload: { username: 'mchelper', relation: '志愿者', isEmergency: false } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: hh })
    return { app, blind, helper, bh, hh }
  }
  const unread = async (app: any, h: any) => (await app.inject({ method: 'GET', url: '/api/unread', headers: h })).json()

  it('对方来电未接→盲人 missedCalls:1 且并入 total；盲人查通话记录后→missedCalls:0', async () => {
    const { app, blind, bh, hh } = await setup()
    const u0 = await unread(app, bh)
    expect(u0.missedCalls).toBe(0)
    const baseTotal = u0.total

    // helper 呼叫 blind（未接）→ 生成 blind 作为被叫的 missed 记录。
    const call = await app.inject({ method: 'POST', url: '/api/assist/call', headers: hh, payload: { callId: 'call-1', targetUserIds: [blind.user.id] } })
    expect(call.statusCode).toBe(200)

    const u1 = await unread(app, bh)
    expect(u1.missedCalls).toBe(1)
    expect(u1.total).toBe(baseTotal + 1) // 并入总角标

    // 盲人打开通话记录 → 标记看过。
    const hist = await app.inject({ method: 'GET', url: '/api/calls', headers: bh })
    expect(hist.json().calls[0]).toMatchObject({ direction: 'incoming', status: 'missed' }) // 列表仍标未接（供标红）

    const u2 = await unread(app, bh)
    expect(u2.missedCalls).toBe(0) // 角标已清
    expect(u2.total).toBe(baseTotal)
    await app.close()
  })

  it('?peek=1（首页仪表盘预览）：返回同样的列表但**不**清未接来电角标；真正打开通话记录页才清', async () => {
    const { app, blind, bh, hh } = await setup()
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: hh, payload: { callId: 'call-3', targetUserIds: [blind.user.id] } })
    expect((await unread(app, bh)).missedCalls).toBe(1)
    // 首页预览（peek）：列表照常返回（含 missed 供标红），但角标基线**不动**——瞟一眼首页 ≠ 看过通话记录，
    // 角标是"去看看"的提示，预览若清基线则并行的 unreadSummary 会与之竞态、"未接来电"卡时而 1 时而 0。
    const peek = await app.inject({ method: 'GET', url: '/api/calls?peek=1', headers: bh })
    expect(peek.statusCode).toBe(200)
    expect(peek.json().calls[0]).toMatchObject({ direction: 'incoming', status: 'missed' })
    expect((await unread(app, bh)).missedCalls).toBe(1) // 角标仍在
    // 真正打开通话记录页（无 peek）→ 角标清零（原行为不变）。
    await app.inject({ method: 'GET', url: '/api/calls', headers: bh })
    expect((await unread(app, bh)).missedCalls).toBe(0)
    await app.close()
  })

  it('呼出方（helper）不因自己发起的未接而计未接来电角标', async () => {
    const { app, blind, bh, hh } = await setup()
    void bh
    // helper 呼叫 blind（未接）：blind 有未接来电，但作为**主叫**的 helper 不计。
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: hh, payload: { callId: 'call-2', targetUserIds: [blind.user.id] } })
    expect((await unread(app, hh)).missedCalls).toBe(0)  // 主叫方 0
    expect((await unread(app, bh)).missedCalls).toBe(1)  // 被叫方 1
    await app.close()
  })
})

describe('通话记录留存清扫 deleteCallRecordsOlderThan（PII 数据最小化，Memory↔Sqlite parity）', () => {
  for (const makeStore of [() => new MemoryStore(), () => new SqliteStore(':memory:')]) {
    const name = makeStore().constructor.name
    it(`${name}: 删早于 cutoff 的记录、保留 cutoff 当刻及更新的；返回删除条数`, () => {
      const store = makeStore()
      const rec = (id: string, createdAt: number) =>
        store.createCallRecord({ id, callId: 'c-' + id, callerId: 'a', calleeId: 'b', status: 'answered', createdAt })
      rec('old1', 1000)
      rec('old2', 1999)
      rec('edge', 2000)   // 恰在 cutoff：createdAt < cutoff 为假 → 保留
      rec('new', 3000)
      const removed = store.deleteCallRecordsOlderThan(2000)
      expect(removed).toBe(2) // old1 + old2
      const remaining = store.callRecordsForUser('b', 100).map((r) => r.id).sort()
      expect(remaining).toEqual(['edge', 'new']) // 边界（=cutoff）与更新的都留
      expect(store.deleteCallRecordsOlderThan(2000)).toBe(0) // 幂等：再扫无更早的
    })
  }
})
