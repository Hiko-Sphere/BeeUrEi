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
    // 被叫看到"呼入/未接"
    let theirs = (await a.inject({ method: 'GET', url: '/api/calls', headers: auth(helper.token) })).json().calls
    expect(theirs[0].direction).toBe('incoming')
    expect(theirs[0].status).toBe('missed')
    // 被叫接听 → 已接听
    await a.inject({ method: 'POST', url: '/api/assist/call/answered', headers: auth(helper.token), payload: { callId: 'rec-1' } })
    theirs = (await a.inject({ method: 'GET', url: '/api/calls', headers: auth(helper.token) })).json().calls
    expect(theirs[0].status).toBe('answered')
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
