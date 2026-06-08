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

  it('heartbeat requires auth', async () => {
    const a = app()
    const res = await a.inject({ method: 'POST', url: '/api/assist/heartbeat', payload: { available: true } })
    expect(res.statusCode).toBe(401)
    await a.close()
  })
})
