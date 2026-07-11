import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'

// 通话时长上报 POST /api/assist/call/duration：参与方挂断时上报连接时长 → 通话记录两端显示"3:24"。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function seed() {
  const store = new MemoryStore()
  const app = buildApp(store)
  const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
  const caller = await reg('cdCaller', 'blind')
  const callee = await reg('cdCallee', 'helper')
  const stranger = await reg('cdStranger', 'helper')
  // 通话记录（主叫→被叫），callId=k1。
  store.createCallRecord({ id: 'r1', callId: 'k1', callerId: caller.user.id, calleeId: callee.user.id, status: 'answered', createdAt: 1000 })
  return { store, app, caller, callee, stranger }
}

describe('通话时长上报 /api/assist/call/duration', () => {
  it('参与方上报 → durationSec 写入该 callId 的记录，且 /api/calls 两端都读到', async () => {
    const { store, app, caller, callee } = await seed()
    const r = await app.inject({ method: 'POST', url: '/api/assist/call/duration', headers: auth(callee.token), payload: { callId: 'k1', seconds: 204 } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true })
    expect(store.callRecordsForUser(caller.user.id).find((x) => x.callId === 'k1')?.durationSec).toBe(204)
    // 两端的 /api/calls 都带 durationSec（供显示 3:24）。
    const callerCalls = (await app.inject({ method: 'GET', url: '/api/calls', headers: auth(caller.token) })).json().calls
    expect(callerCalls.find((c: { callId: string }) => c.callId === 'k1').durationSec).toBe(204)
    await app.close()
  })

  it('非参与方上报 → 403 not_participant，不改记录', async () => {
    const { store, app, stranger, caller } = await seed()
    const r = await app.inject({ method: 'POST', url: '/api/assist/call/duration', headers: auth(stranger.token), payload: { callId: 'k1', seconds: 999 } })
    expect(r.statusCode).toBe(403)
    expect(store.callRecordsForUser(caller.user.id).find((x) => x.callId === 'k1')?.durationSec).toBeUndefined()
    await app.close()
  })

  it('坏输入 → 400（负数/超 24h/缺 callId）；未登录 → 401', async () => {
    const { app, callee } = await seed()
    expect((await app.inject({ method: 'POST', url: '/api/assist/call/duration', headers: auth(callee.token), payload: { callId: 'k1', seconds: -1 } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/assist/call/duration', headers: auth(callee.token), payload: { callId: 'k1', seconds: 90000 } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/assist/call/duration', headers: auth(callee.token), payload: { seconds: 10 } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/assist/call/duration', payload: { callId: 'k1', seconds: 10 } })).statusCode).toBe(401)
    await app.close()
  })

  it('SqliteStore 列往返：durationSec 存取一致；setCallDuration 只更新参与方的记录', () => {
    const s = new SqliteStore(':memory:')
    s.createCallRecord({ id: 'r1', callId: 'k1', callerId: 'a', calleeId: 'b', status: 'answered', createdAt: 1 })
    s.createCallRecord({ id: 'r2', callId: 'k2', callerId: 'c', calleeId: 'd', status: 'answered', createdAt: 2 }) // 另一通，不该被动
    s.setCallDuration('k1', 'a', 125)
    expect(s.callRecordsForUser('a').find((x) => x.callId === 'k1')?.durationSec).toBe(125)
    expect(s.callRecordsForUser('c').find((x) => x.callId === 'k2')?.durationSec).toBeUndefined() // 未被误更
  })
})

// 平价：allCallRecords(管理端全站通话) 也须带 durationSec，两 Store 一致。此前 SqliteStore.allCallRecords 漏读
// durationSec → 生产下「全站通话」视图 + CSV 导出时长恒 null（已接通有时长也不显），而 MemoryStore 返回整对象
// 含时长 → 测试盲区（见平价审计）。故此测试**两 Store 都跑**。
describe.each([['MemoryStore', () => new MemoryStore()], ['SqliteStore', () => new SqliteStore(':memory:')]] as const)('allCallRecords 保留 durationSec (%s)', (_n, make) => {
  it('setCallDuration 后 allCallRecords 读回该记录的 durationSec（不丢字段）', () => {
    const store = make()
    store.createCallRecord({ id: 'r1', callId: 'k1', callerId: 'a', calleeId: 'b', status: 'answered', createdAt: 1000 })
    store.setCallDuration('k1', 'a', 204) // 参与方(主叫)上报时长
    const rec = store.allCallRecords().find((c) => c.callId === 'k1')
    expect(rec?.durationSec).toBe(204)
  })
})
