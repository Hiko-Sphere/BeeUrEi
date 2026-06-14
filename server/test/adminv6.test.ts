import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User, effectiveFeatures, DEFAULT_APP_CONFIG } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

function withAdmin() {
  const store = new MemoryStore()
  store.createUser({ id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() })
  return { store, app: buildApp(store) }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function adminAuth(app: ReturnType<typeof buildApp>) {
  return auth((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token)
}
async function makeUser(app: ReturnType<typeof buildApp>, username: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return { id: r.json().user.id as string, token: r.json().token as string }
}

describe('effectiveFeatures（全站 AND 单用户覆盖）', () => {
  it('覆盖只能 force off；缺省/true 跟随全站', () => {
    const e1 = effectiveFeatures(DEFAULT_APP_CONFIG, { messaging: false })
    expect(e1.messaging).toBe(false)
    expect(e1.calls).toBe(true)
    const e2 = effectiveFeatures(DEFAULT_APP_CONFIG, { messaging: true }) // true 不强开，跟随全站(仍 true)
    expect(e2.messaging).toBe(true)
    // 全站已关时，单用户 true 不能反向打开
    const off = { ...DEFAULT_APP_CONFIG, features: { ...DEFAULT_APP_CONFIG.features, calls: false } }
    expect(effectiveFeatures(off, { calls: true }).calls).toBe(false)
  })
})

describe('Admin v6：单用户功能覆盖（精准处置，不波及全站）', () => {
  it('对某用户关停 messaging → 仅其被拦，其他用户不受影响', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const bad = await makeUser(app, 'baduser')
    const good = await makeUser(app, 'gooduser')

    const put = await app.inject({ method: 'PUT', url: `/api/admin/users/${bad.id}/features`, headers: aa, payload: { overrides: { messaging: false } } })
    expect(put.statusCode).toBe(200)
    expect(put.json().featureOverrides.messaging).toBe(false)

    // 被处置用户：发消息 403 feature_disabled
    const badSend = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(bad.token), payload: { toId: 'x', kind: 'text', text: 'hi' } })
    expect(badSend.statusCode).toBe(403)
    expect(badSend.json().error).toBe('feature_disabled')

    // 其他用户：不被该覆盖影响（不会因功能开关被拦；可能因无绑定 403/400，但 error 不是 feature_disabled）
    const goodSend = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(good.token), payload: { toId: 'x', kind: 'text', text: 'hi' } })
    expect(goodSend.json().error).not.toBe('feature_disabled')
  })

  it('app-config 下发该用户的有效开关（被覆盖者 messaging=false，他人=true）', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const bad = await makeUser(app, 'bad2')
    const good = await makeUser(app, 'good2')
    await app.inject({ method: 'PUT', url: `/api/admin/users/${bad.id}/features`, headers: aa, payload: { overrides: { messaging: false, calls: false } } })

    const badCfg = await app.inject({ method: 'GET', url: '/api/app-config', headers: auth(bad.token) })
    expect(badCfg.json().features.messaging).toBe(false)
    expect(badCfg.json().features.calls).toBe(false)
    const goodCfg = await app.inject({ method: 'GET', url: '/api/app-config', headers: auth(good.token) })
    expect(goodCfg.json().features.messaging).toBe(true)
  })

  it('清除覆盖（true/null）→ 恢复跟随全站', async () => {
    const { app, store } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'restore1')
    await app.inject({ method: 'PUT', url: `/api/admin/users/${u.id}/features`, headers: aa, payload: { overrides: { messaging: false } } })
    expect(store.findById(u.id)!.featureOverrides).toEqual({ messaging: false })
    const clr = await app.inject({ method: 'PUT', url: `/api/admin/users/${u.id}/features`, headers: aa, payload: { overrides: { messaging: null } } })
    expect(clr.statusCode).toBe(200)
    expect(store.findById(u.id)!.featureOverrides).toBeUndefined() // 全清空 → undefined
    const send = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(u.token), payload: { toId: 'x', kind: 'text', text: 'hi' } })
    expect(send.json().error).not.toBe('feature_disabled')
  })

  it('用户详情含 featureOverrides；审计留痕 user.features', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'det6')
    await app.inject({ method: 'PUT', url: `/api/admin/users/${u.id}/features`, headers: aa, payload: { overrides: { groups: false } } })
    const d = await app.inject({ method: 'GET', url: `/api/admin/users/${u.id}`, headers: aa })
    expect(d.json().user.featureOverrides.groups).toBe(false)
    const audit = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: aa })
    expect(audit.json().entries.map((e: any) => e.action)).toContain('user.features')
  })
})
