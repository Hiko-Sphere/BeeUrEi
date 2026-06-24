import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

function withAdmin() {
  const store = new MemoryStore()
  const admin: User = { id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
  store.createUser(admin)
  store.setAppConfig({ requireVerification: true }) // 门禁默认关，测试显式开启
  return { store, app: buildApp(store) }
}
async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p } })).json().token as string
}
async function reg(app: ReturnType<typeof buildApp>, username: string, role = 'blind') {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123', role } })
  return r.json() as { token: string; user: { id: string } }
}

describe('实名认证门禁（verification gate）', () => {
  it('未认证的可门控角色：受保护端点 403 verification_required，豁免端点放行', async () => {
    const { app } = withAdmin()
    const { token } = await reg(app, 'alice', 'blind')

    // 受保护端点（默认门控，且不限角色，避免 role 检查先于门禁触发）→ 403 verification_required
    for (const url of ['/api/family/links', '/api/family/incoming', '/api/blocks']) {
      const r = await app.inject({ method: 'GET', url, headers: auth(token) })
      expect(r.statusCode, url).toBe(403)
      expect(r.json().error, url).toBe('verification_required')
    }

    // 豁免端点 → 放行（非 403 verification_required）
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect(me.statusCode).toBe(200)
    expect(me.json().user.verified).toBe(false)
    for (const url of ['/api/account/verification', '/api/notifications', '/api/app-config']) {
      const r = await app.inject({ method: 'GET', url, headers: auth(token) })
      expect(r.statusCode, url).toBe(200)
    }
    // 紧急端点不被实名门禁拦（可能因 body 校验返回其它码，但绝不是 verification_required）
    const emerg = await app.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth(token), payload: { kind: 'fall' } })
    expect(emerg.json()?.error).not.toBe('verification_required')
    // 推送注册（紧急/通知所需）豁免
    const push = await app.inject({ method: 'POST', url: '/api/push/apns-register', headers: auth(token), payload: { token: 'devtok' } })
    expect(push.json()?.error).not.toBe('verification_required')
    await app.close()
  })

  it('通过实名后同一令牌即可访问（门禁读库实时状态）', async () => {
    const { app, store } = withAdmin()
    const { token } = await reg(app, 'bob', 'helper')
    const id = store.findByUsername('bob')!.id

    expect((await app.inject({ method: 'GET', url: '/api/family/links', headers: auth(token) })).statusCode).toBe(403)
    store.updateUser(id, { identityVerified: true }) // 管理员通过 KYC 的效果
    const ok = await app.inject({ method: 'GET', url: '/api/family/links', headers: auth(token) })
    expect(ok.statusCode).toBe(200) // 同一令牌，门禁现放行
    await app.close()
  })

  it('admin/developer 不受实名门禁约束（否则无人能审核=死锁）', async () => {
    const { app } = withAdmin()
    const adminToken = await login(app, 'root', 'rootpass1') // root 未做 KYC
    const r = await app.inject({ method: 'GET', url: '/api/family/links', headers: auth(adminToken) })
    expect(r.statusCode).toBe(200) // admin 直接放行
    // 管理端点也可用（审核 KYC 不被自己的未认证状态挡住）
    const q = await app.inject({ method: 'GET', url: '/api/admin/verifications', headers: auth(adminToken) })
    expect(q.statusCode).toBe(200)
    await app.close()
  })

  it('非 requireAuth 路由也门控：录制媒体流端点 GET /api/recordings/:id/media 未实名 403', async () => {
    const { app, store } = withAdmin()
    const { token } = await reg(app, 'dave', 'blind')
    const uid = store.findByUsername('dave')!.id
    // 该用户拥有一条录制(带 mediaId)；门禁在所有权/文件校验之前触发。
    store.createRecording({ id: 'rec1', callId: 'c1', ownerId: uid, consentBy: [uid], reason: 'test', recordedAt: Date.now(), mediaId: 'm1', participants: [uid] })
    const r = await app.inject({ method: 'GET', url: '/api/recordings/rec1/media', headers: auth(token) })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('verification_required')
    // 通过实名后不再被门禁拦（改为后续的文件/所有权逻辑）。
    store.updateUser(uid, { identityVerified: true })
    const r2 = await app.inject({ method: 'GET', url: '/api/recordings/rec1/media', headers: auth(token) })
    expect(r2.json()?.error).not.toBe('verification_required')
    await app.close()
  })

  it('已认证用户正常通过', async () => {
    const { app, store } = withAdmin()
    const { token } = await reg(app, 'carol', 'family')
    store.updateUser(store.findByUsername('carol')!.id, { identityVerified: true })
    const r = await app.inject({ method: 'GET', url: '/api/family/links', headers: auth(token) })
    expect(r.statusCode).toBe(200)
    await app.close()
  })
})
