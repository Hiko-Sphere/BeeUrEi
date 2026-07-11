import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function reg(a: ReturnType<typeof buildApp>, u: string, role = 'blind') {
  return (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json() as {
    token: string; user: { id: string }
  }
}
async function link(a: ReturnType<typeof buildApp>, blind: any, helper: any) {
  const lk = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: 'cHelper' } })
  await a.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(helper.token) })
}

describe('通话记录 + 双向呼叫', () => {
  it('盲人呼叫协助者 → 双方各有一条记录（默认未接）；接听后变已接听', async () => {
    const a = buildApp(new MemoryStore())
    const blind = await reg(a, 'cBlind', 'blind')
    const helper = await reg(a, 'cHelper', 'helper')
    await link(a, blind, helper)

    await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'rec-1', targetUserIds: [helper.user.id] } })
    // 主叫看到"呼出/未接"
    let mine = (await a.inject({ method: 'GET', url: '/api/calls', headers: auth(blind.token) })).json().calls
    expect(mine.length).toBe(1)
    expect(mine[0].direction).toBe('outgoing')
    expect(mine[0].status).toBe('missed')
    expect(mine[0].peerId).toBe(helper.user.id) // 对端 id：供前端通话记录可点进聊天/回拨
    // 被叫看到"呼入/未接"
    let theirs = (await a.inject({ method: 'GET', url: '/api/calls', headers: auth(helper.token) })).json().calls
    expect(theirs[0].direction).toBe('incoming')
    expect(theirs[0].status).toBe('missed')
    expect(theirs[0].peerId).toBe(blind.user.id)
    // 被叫接听 → 已接听
    await a.inject({ method: 'POST', url: '/api/assist/call/answered', headers: auth(helper.token), payload: { callId: 'rec-1' } })
    theirs = (await a.inject({ method: 'GET', url: '/api/calls', headers: auth(helper.token) })).json().calls
    expect(theirs[0].status).toBe('answered')
    await a.close()
  })

  it('对端账号不存在（残留记录的防御态）→ peerId=null 且 peerName 为**空串**（语言中立，绝不服务端硬编码「已注销用户」中文）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const blind = await reg(a, 'cBlind', 'blind')
    // 直接建一条对端为"幽灵"（无对应用户）的通话记录——模拟对端账号已注销但记录残留的不一致防御态。
    store.createCallRecord({ id: 'cr-ghost', callId: 'call-ghost', callerId: blind.user.id, calleeId: 'ghost-id', status: 'missed', createdAt: Date.now() })
    const rec = (await a.inject({ method: 'GET', url: '/api/calls', headers: auth(blind.token) })).json().calls.find((c: { callId: string }) => c.callId === 'call-ghost')
    expect(rec.peerId).toBeNull()   // 幽灵对端 → 不可点进聊天/回拨
    expect(rec.peerName).toBe('')   // 语言中立空串，绝不硬编码「已注销用户」
    await a.close()
  })

  it('被叫拒绝 → 记录为已拒绝', async () => {
    const a = buildApp(new MemoryStore())
    const blind = await reg(a, 'cBlind', 'blind')
    const helper = await reg(a, 'cHelper', 'helper')
    await link(a, blind, helper)
    await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'rec-2', targetUserIds: [helper.user.id] } })
    await a.inject({ method: 'POST', url: '/api/assist/call/decline', headers: auth(helper.token), payload: { callId: 'rec-2' } })
    const theirs = (await a.inject({ method: 'GET', url: '/api/calls', headers: auth(helper.token) })).json().calls
    expect(theirs[0].status).toBe('declined')
    await a.close()
  })

  it('协助者可主动呼叫绑定的盲人（双向）', async () => {
    const a = buildApp(new MemoryStore())
    const blind = await reg(a, 'cBlind', 'blind')
    const helper = await reg(a, 'cHelper', 'helper')
    await link(a, blind, helper)
    // 协助者 → 盲人：应被允许（200），记录方向对盲人为"呼入"
    const r = await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth(helper.token), payload: { callId: 'rec-3', targetUserIds: [blind.user.id] } })
    expect(r.statusCode).toBe(200)
    const blindCalls = (await a.inject({ method: 'GET', url: '/api/calls', headers: auth(blind.token) })).json().calls
    expect(blindCalls.find((c: any) => c.callId === 'rec-3')?.direction).toBe('incoming')
    await a.close()
  })

  it('未绑定不能呼叫（403）', async () => {
    const a = buildApp(new MemoryStore())
    const blind = await reg(a, 'cBlind', 'blind')
    const stranger = await reg(a, 'cStranger', 'helper')
    const r = await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'rec-4', targetUserIds: [stranger.user.id] } })
    expect(r.statusCode).toBe(403)
    await a.close()
  })
})

describe('群呼首接抢占（信任圈群呼）', () => {
  it('两位亲友同时被呼：A 先接听 → B 的待接列表消失、B 接听得到 answeredBy=A', async () => {
    const a = buildApp(new MemoryStore())
    const blind = await reg(a, 'gBlind', 'blind')
    const h1 = await reg(a, 'gH1', 'helper')
    const h2 = await reg(a, 'gH2', 'helper')
    // 绑定两位（双向确认）
    for (const [u, t] of [['gH1', h1.token], ['gH2', h2.token]] as const) {
      const lk = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: u } })
      await a.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(t) })
    }
    await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'grp-1', targetUserIds: [h1.user.id, h2.user.id] } })
    // 双方都在响铃
    expect((await a.inject({ method: 'GET', url: '/api/assist/incoming', headers: auth(h1.token) })).json().calls.length).toBe(1)
    expect((await a.inject({ method: 'GET', url: '/api/assist/incoming', headers: auth(h2.token) })).json().calls.length).toBe(1)
    // h1 先接听 → 抢占
    const r1 = await a.inject({ method: 'POST', url: '/api/assist/call/answered', headers: auth(h1.token), payload: { callId: 'grp-1' } })
    expect(r1.json().answeredBy).toBe(h1.user.id)
    // h2 的振铃消失；h2 再接听得到先到者
    expect((await a.inject({ method: 'GET', url: '/api/assist/incoming', headers: auth(h2.token) })).json().calls.length).toBe(0)
    const r2 = await a.inject({ method: 'POST', url: '/api/assist/call/answered', headers: auth(h2.token), payload: { callId: 'grp-1' } })
    expect(r2.json().answeredBy).toBe(h1.user.id)
    // 状态端点对发起方可见接听者
    const st = await a.inject({ method: 'GET', url: '/api/assist/call/status?callId=grp-1', headers: auth(blind.token) })
    expect(st.json().answeredBy).toBe(h1.user.id)
    await a.close()
  })

  it('首接者 youWon:true、别人先接 youWon:false（首接抢占语义）', async () => {
    const a = buildApp(new MemoryStore())
    const blind = await reg(a, 'wBlind', 'blind')
    const h1 = await reg(a, 'wH1', 'helper')
    const h2 = await reg(a, 'wH2', 'helper')
    for (const [u, t, id] of [['wH1', h1.token, h1.user.id], ['wH2', h2.token, h2.user.id]] as const) {
      const lk = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: u } })
      await a.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(t) })
      void id
    }
    await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'w-1', targetUserIds: [h1.user.id, h2.user.id] } })
    const r1 = await a.inject({ method: 'POST', url: '/api/assist/call/answered', headers: auth(h1.token), payload: { callId: 'w-1' } })
    expect(r1.json()).toMatchObject({ youWon: true, answeredBy: h1.user.id, gone: false })
    const r2 = await a.inject({ method: 'POST', url: '/api/assist/call/answered', headers: auth(h2.token), payload: { callId: 'w-1' } })
    expect(r2.json()).toMatchObject({ youWon: false, answeredBy: h1.user.id }) // 别人先接 → 未赢
    await a.close()
  })

  it('/call/answered 对不存在/过期 callId → youWon:false + gone:true（不误导接听者进必失败的 join）', async () => {
    const a = buildApp(new MemoryStore())
    const helper = await reg(a, 'goneHelper', 'helper')
    const res = await a.inject({ method: 'POST', url: '/api/assist/call/answered', headers: auth(helper.token), payload: { callId: 'never-existed' } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ youWon: false, gone: true, answeredBy: null })
    await a.close()
  })
})
