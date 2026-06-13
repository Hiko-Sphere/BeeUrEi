import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

async function reg(a: ReturnType<typeof buildApp>, username: string) {
  const r = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return r.json() as { token: string; refreshToken: string }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

describe('account management', () => {
  it('changes password, revokes refresh tokens, new password works', async () => {
    const a = app()
    const { token, refreshToken } = await reg(a, 'acc1')
    const res = await a.inject({
      method: 'POST', url: '/api/account/password', headers: auth(token),
      payload: { oldPassword: 'secret123', newPassword: 'newsecret456' },
    })
    expect(res.statusCode).toBe(200)
    // 旧 refresh 已撤销
    const refreshed = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
    expect(refreshed.statusCode).toBe(401)
    // 新密码可登录，旧密码不行
    const ok = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'acc1', password: 'newsecret456' } })
    expect(ok.statusCode).toBe(200)
    const bad = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'acc1', password: 'secret123' } })
    expect(bad.statusCode).toBe(401)
    await a.close()
  })

  it('rejects wrong old password', async () => {
    const a = app()
    const { token } = await reg(a, 'acc2')
    const res = await a.inject({
      method: 'POST', url: '/api/account/password', headers: auth(token),
      payload: { oldPassword: 'wrong', newPassword: 'newsecret456' },
    })
    expect(res.statusCode).toBe(401)
    await a.close()
  })

  it('deletes account; user can no longer log in', async () => {
    const a = app()
    const { token } = await reg(a, 'acc3')
    const del = await a.inject({ method: 'DELETE', url: '/api/account', headers: auth(token) })
    expect(del.statusCode).toBe(204)
    const login = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'acc3', password: 'secret123' } })
    expect(login.statusCode).toBe(401)
    await a.close()
  })

  it('account endpoints require auth', async () => {
    const a = app()
    const p = await a.inject({ method: 'POST', url: '/api/account/password', payload: { oldPassword: 'x', newPassword: 'yyyyyy' } })
    expect(p.statusCode).toBe(401)
    const d = await a.inject({ method: 'DELETE', url: '/api/account' })
    expect(d.statusCode).toBe(401)
    await a.close()
  })

  it('records legal consent (version + timestamp), reflected in /api/me; gated by auth/validation', async () => {
    const a = app()
    const { token } = await reg(a, 'consent1')
    // 同意前：/api/me 为空
    const me0 = await a.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect(me0.json().user.legalConsentVersion).toBeNull()
    // 记录同意
    const res = await a.inject({ method: 'POST', url: '/api/account/legal-consent', headers: auth(token), payload: { version: '2.0' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().legalConsentVersion).toBe('2.0')
    expect(typeof res.json().legalConsentAt).toBe('number')
    // /api/me 反映已同意（可证明同意：版本 + 时间）
    const me1 = await a.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect(me1.json().user.legalConsentVersion).toBe('2.0')
    expect(me1.json().user.legalConsentAt).toBeGreaterThan(0)
    // 空版本 → 400；未认证 → 401
    const bad = await a.inject({ method: 'POST', url: '/api/account/legal-consent', headers: auth(token), payload: { version: '' } })
    expect(bad.statusCode).toBe(400)
    const noauth = await a.inject({ method: 'POST', url: '/api/account/legal-consent', payload: { version: '2.0' } })
    expect(noauth.statusCode).toBe(401)
    await a.close()
  })
})
