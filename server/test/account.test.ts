import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { AppleTokenVerifier } from '../src/auth/apple'

// fake Apple 验证器：token 形如 good:<sub>（与 authOverhaul 同口径）。
const fakeApple: AppleTokenVerifier = async (t) => (t.startsWith('good:') ? { sub: t.split(':')[1] } : null)

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

  it('deletes account（重输密码验证身份）; user can no longer log in', async () => {
    const a = app()
    const { token } = await reg(a, 'acc3')
    // 删号须重新验证身份（不可逆+级联清空）：带正确当前密码 → 204。
    const del = await a.inject({ method: 'DELETE', url: '/api/account', headers: auth(token), payload: { password: 'secret123' } })
    expect(del.statusCode).toBe(204)
    const login = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'acc3', password: 'secret123' } })
    expect(login.statusCode).toBe(401)
    await a.close()
  })

  it('删号须重新验证身份：不带凭据→401 reauth_required，且账号仍在', async () => {
    const a = app()
    const { token } = await reg(a, 'acc3b')
    const del = await a.inject({ method: 'DELETE', url: '/api/account', headers: auth(token) }) // 无 body
    expect(del.statusCode).toBe(401)
    expect(del.json()).toMatchObject({ error: 'reauth_required' })
    // 账号未被删除：仍可正常登录。
    expect((await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'acc3b', password: 'secret123' } })).statusCode).toBe(200)
    await a.close()
  })

  it('删号密码错误→401 invalid_credentials，账号仍在（被盗会话不能仅凭 token 毁号）', async () => {
    const a = app()
    const { token } = await reg(a, 'acc3c')
    const del = await a.inject({ method: 'DELETE', url: '/api/account', headers: auth(token), payload: { password: 'wrong-pass' } })
    expect(del.statusCode).toBe(401)
    expect(del.json()).toMatchObject({ error: 'invalid_credentials' })
    expect((await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'acc3c', password: 'secret123' } })).statusCode).toBe(200)
    await a.close()
  })

  it('Apple 账号删号：重走 Apple 登录且 sub 匹配→204；密码/错 sub→401（Apple 账号无用户已知密码，须走 Apple 重验）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store, { appleVerifier: fakeApple })
    const signIn = await a.inject({ method: 'POST', url: '/api/auth/apple', payload: { identityToken: 'good:apple-del-sub' } })
    expect([200, 201]).toContain(signIn.statusCode) // 新建 Apple 账号返回 201
    const token = signIn.json().token as string
    // 密码删不了：Apple 建号的 passwordHash 是随机值、用户不知情 → verifyPassword 失败。
    expect((await a.inject({ method: 'DELETE', url: '/api/account', headers: auth(token), payload: { password: 'anything' } })).statusCode).toBe(401)
    // 重走 Apple 但 sub 不匹配（换了个 Apple 账号）→ 401。
    expect((await a.inject({ method: 'DELETE', url: '/api/account', headers: auth(token), payload: { appleIdentityToken: 'good:someone-else' } })).statusCode).toBe(401)
    // sub 匹配 → 204，账号删除。
    expect((await a.inject({ method: 'DELETE', url: '/api/account', headers: auth(token), payload: { appleIdentityToken: 'good:apple-del-sub' } })).statusCode).toBe(204)
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

  it('改用户名/手机端级限流：循环改**不同值**连打超 10/min 被 429（防被盗令牌刷本人安全推送+写库放大；全局 300 远松，改前不 429）', async () => {
    const a = app()
    const t = (await reg(a, 'ratelimituser')).token
    // 循环改不同用户名（changed 恒真 → 每次都 notifySecurity）：端级 10/min，第 11 次起应 429。
    let userLimited = false
    for (let i = 0; i < 13; i++) {
      const res = await a.inject({ method: 'POST', url: '/api/account/username', headers: auth(t), payload: { username: `newname${i}` } })
      if (res.statusCode === 429) { userLimited = true; break }
    }
    expect(userLimited).toBe(true)
    // 手机同样限流（独立端点独立桶）：循环改不同号连打亦被 429。
    const t2 = (await reg(a, 'ratelimitphone')).token
    let phoneLimited = false
    for (let i = 0; i < 13; i++) {
      const res = await a.inject({ method: 'POST', url: '/api/account/phone', headers: auth(t2), payload: { phone: `1380000${String(1000 + i)}` } })
      if (res.statusCode === 429) { phoneLimited = true; break }
    }
    expect(phoneLimited).toBe(true)
    await a.close()
  })
})
