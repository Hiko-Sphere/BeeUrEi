import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

async function reg(a: ReturnType<typeof buildApp>, username: string, role = 'blind') {
  const res = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123', role } })
  return res.json() as { token: string; user: { id: string } }
}

describe('assist presence + match', () => {
  it('matches only online-available linked helpers, ordered by emergency', async () => {
    const a = app()
    const owner = await reg(a, 'owner1', 'blind')
    const helper = await reg(a, 'helper1', 'helper')
    const family = await reg(a, 'family1', 'family')

    const auth = (t: string) => ({ authorization: `Bearer ${t}` })

    // owner 绑定两位（family 设为紧急联系人）。
    await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'helper1' } })
    await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'family1', isEmergency: true } })

    // 都不在线 → 匹配为空。
    let m = await a.inject({ method: 'POST', url: '/api/assist/match', headers: auth(owner.token), payload: { emergency: true } })
    expect(m.json().count).toBe(0)

    // helper + family 心跳上线。
    await a.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: auth(helper.token), payload: { available: true } })
    await a.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: auth(family.token), payload: { available: true } })

    m = await a.inject({ method: 'POST', url: '/api/assist/match', headers: auth(owner.token), payload: { emergency: true } })
    const body = m.json()
    expect(body.count).toBe(2)
    expect(body.targets[0].memberId).toBe(family.user.id) // 紧急联系人优先

    // family 下线 → 仅剩 helper。
    await a.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: auth(family.token), payload: { available: false } })
    m = await a.inject({ method: 'POST', url: '/api/assist/match', headers: auth(owner.token), payload: { emergency: true } })
    expect(m.json().count).toBe(1)
    expect(m.json().targets[0].memberId).toBe(helper.user.id)

    await a.close()
  })

  it('preferredLanguage 真正影响排序（注册时带 language）', async () => {
    const a = app()
    const owner = await reg(a, 'owner2', 'blind')
    const auth = (t: string) => ({ authorization: `Bearer ${t}` })
    // 两位非紧急协助者，一位母语 en、一位 zh。
    const en = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'helperEn', password: 'secret123', role: 'helper', language: 'en' } })).json()
    const zh = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'helperZh', password: 'secret123', role: 'helper', language: 'zh' } })).json()
    await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'helperEn' } })
    await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'helperZh' } })
    await a.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: auth(en.token), payload: { available: true } })
    await a.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: auth(zh.token), payload: { available: true } })

    const m = await a.inject({ method: 'POST', url: '/api/assist/match', headers: auth(owner.token), payload: { emergency: false, preferredLanguage: 'zh' } })
    expect(m.json().count).toBe(2)
    expect(m.json().targets[0].memberId).toBe(zh.user.id) // 偏好 zh → zh 协助者排首
    await a.close()
  })

  it('紧急呼叫前台会合：视障登记呼叫，目标协助者轮询到、他人收不到、取消后清除', async () => {
    const a = app()
    const owner = await reg(a, 'caller9', 'blind')
    const helper = await reg(a, 'helper9', 'helper')
    const other = await reg(a, 'other9', 'helper')
    const auth = (t: string) => ({ authorization: `Bearer ${t}` })
    // owner 须与目标有亲友绑定才能呼叫（越权防护）。
    await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'helper9' } })

    // 未绑定的目标 → 403（不能向任意用户强推来电）。
    const forbidden = await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth(owner.token), payload: { callId: 'c-bad', targetUserIds: [other.user.id] } })
    expect(forbidden.statusCode).toBe(403)

    const r1 = await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth(owner.token), payload: { callId: 'call-xyz', targetUserIds: [helper.user.id] } })
    expect(r1.statusCode).toBe(200)

    const inc = await a.inject({ method: 'GET', url: '/api/assist/incoming', headers: auth(helper.token) })
    expect(inc.json().calls.length).toBe(1)
    expect(inc.json().calls[0].callId).toBe('call-xyz')
    expect(inc.json().calls[0].fromName).toBe('caller9')

    const inc2 = await a.inject({ method: 'GET', url: '/api/assist/incoming', headers: auth(other.token) })
    expect(inc2.json().calls.length).toBe(0)

    await a.inject({ method: 'POST', url: '/api/assist/call/cancel', headers: auth(owner.token), payload: { callId: 'call-xyz' } })
    const inc3 = await a.inject({ method: 'GET', url: '/api/assist/incoming', headers: auth(helper.token) })
    expect(inc3.json().calls.length).toBe(0)
    await a.close()
  })

  it('heartbeat requires auth', async () => {
    const a = app()
    const res = await a.inject({ method: 'POST', url: '/api/assist/heartbeat', payload: { available: true } })
    expect(res.statusCode).toBe(401)
    await a.close()
  })
})
