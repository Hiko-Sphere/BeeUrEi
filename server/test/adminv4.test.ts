import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User, normalizeAppConfig, mergeAppConfig, DEFAULT_APP_CONFIG } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

function withAdmin() {
  const store = new MemoryStore()
  const admin: User = {
    id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'),
    displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now(),
  }
  store.createUser(admin)
  return { store, app: buildApp(store) }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function login(app: ReturnType<typeof buildApp>, u: string, p: string) {
  return (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: p } })).json().token as string
}
async function adminAuth(app: ReturnType<typeof buildApp>) { return auth(await login(app, 'root', 'rootpass1')) }
async function makeUser(app: ReturnType<typeof buildApp>, username: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return { id: r.json().user.id as string, token: r.json().token as string }
}

describe('AppConfig 归一化/合并（向后兼容 + 逐键合并）', () => {
  it('旧配置只有 registrationEnabled → features 补全为默认全开', () => {
    const n = normalizeAppConfig({ registrationEnabled: false } as any)
    expect(n.registrationEnabled).toBe(false)
    expect(n.features.messaging).toBe(true)
    expect(n.features.locationSharing).toBe(true)
    expect(n.features.aiDescribe).toBe(true) // 新增 AI 场景描述功能键，旧配置平滑补默认
    expect(Object.keys(n.features).length).toBe(10)
  })
  it('merge 只改一个 feature 键，其它保持', () => {
    const merged = mergeAppConfig(DEFAULT_APP_CONFIG, { features: { messaging: false } })
    expect(merged.features.messaging).toBe(false)
    expect(merged.features.calls).toBe(true)
    expect(merged.registrationEnabled).toBe(true)
  })
})

describe('Admin v4：全站功能开关（服务端硬强制）', () => {
  it('关闭 messaging → POST /api/messages 403 feature_disabled；重开后不再被该开关拦', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const alice = await makeUser(app, 'alice')

    // 关闭 messaging
    const put = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { features: { messaging: false } } })
    expect(put.statusCode).toBe(200)
    expect(put.json().config.features.messaging).toBe(false)
    expect(put.json().config.features.calls).toBe(true) // 逐键合并，未动 calls

    const blocked = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(alice.token), payload: { toId: 'someone', kind: 'text', text: 'hi' } })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error).toBe('feature_disabled')
    expect(blocked.json().feature).toBe('messaging')

    // 重开
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { features: { messaging: true } } })
    const open = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(alice.token), payload: { toId: 'someone', kind: 'text', text: 'hi' } })
    expect(open.json().error).not.toBe('feature_disabled') // 可能因无绑定 403/400，但不再是功能开关拦截
  })

  it('关闭 calls → POST /api/assist/call 403 feature_disabled', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'caller1')
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { features: { calls: false } } })
    const r = await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(u.token), payload: { calleeId: 'x', callId: 'c1' } })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('feature_disabled')
  })

  it('关闭 navigation → GET /api/nav/walking 403（在 amap 检查之前拦下）', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'walker1')
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { features: { navigation: false } } })
    const r = await app.inject({ method: 'GET', url: '/api/nav/walking?originLat=31.2&originLon=121.4&destination=foo', headers: auth(u.token) })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('feature_disabled')
  })

  it('GET /api/app-config 返回功能开关 + 录制 + 注册状态', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { features: { groups: false } } })
    const u = await makeUser(app, 'reader1')
    const r = await app.inject({ method: 'GET', url: '/api/app-config', headers: auth(u.token) })
    expect(r.statusCode).toBe(200)
    const b = r.json()
    expect(b.features.groups).toBe(false)
    expect(b.features.messaging).toBe(true)
    expect(typeof b.recording.enabled).toBe('boolean')
    expect(b.registrationEnabled).toBe(true)
  })

  it('空补丁被拒（400）；安全功能不在 schema 内（紧急/拉黑/举报无法关停）', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const empty = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: {} })
    expect(empty.statusCode).toBe(400)
    const emptyFeat = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { features: {} } })
    expect(emptyFeat.statusCode).toBe(400)
    // 试图关停紧急（非法键）→ 被 zod 严格 schema 拒绝
    const emerg = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { features: { emergency: false } } })
    expect(emerg.statusCode).toBe(400)
  })
})

describe('Admin v4：全字段查看 + 编辑用户', () => {
  it('用户详情含全字段与关联（sessions/tokenVersion/reportsBy 等）', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'detail1')
    const d = await app.inject({ method: 'GET', url: `/api/admin/users/${u.id}`, headers: aa })
    expect(d.statusCode).toBe(200)
    const b = d.json()
    expect(b.user).toHaveProperty('tokenVersion')
    expect(b.user).toHaveProperty('sessions')
    expect(b.user).toHaveProperty('usernameCustomized')
    expect(b).toHaveProperty('reportsBy')
    expect(b).toHaveProperty('reportsAgainst')
    expect(b).toHaveProperty('blocking')
    expect(b).toHaveProperty('blockedBy')
    expect(b).toHaveProperty('passkeys')
    expect(b.user.sessions).toBeGreaterThanOrEqual(1) // 注册即建会话
  })

  it('PATCH 改昵称/用户名/邮箱/手机/语言；唯一性冲突 409；改邮箱重置验证态', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'edit1')
    await makeUser(app, 'taken')

    const ok = await app.inject({ method: 'PATCH', url: `/api/admin/users/${u.id}`, headers: aa,
      payload: { displayName: '新名字', email: 'New@Ex.com', phone: '13800138000', language: 'en' } })
    expect(ok.statusCode).toBe(200)
    const d = (await app.inject({ method: 'GET', url: `/api/admin/users/${u.id}`, headers: aa })).json()
    expect(d.user.displayName).toBe('新名字')
    expect(d.user.email).toBe('new@ex.com')
    expect(d.user.emailVerified).toBe(false)
    expect(d.user.language).toBe('en')

    const dup = await app.inject({ method: 'PATCH', url: `/api/admin/users/${u.id}`, headers: aa, payload: { username: 'taken' } })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error).toBe('username_taken')

    const badUser = await app.inject({ method: 'PATCH', url: `/api/admin/users/${u.id}`, headers: aa, payload: { username: 'has space' } })
    expect(badUser.statusCode).toBe(400)

    // 清除手机号
    const clr = await app.inject({ method: 'PATCH', url: `/api/admin/users/${u.id}`, headers: aa, payload: { phone: null } })
    expect(clr.statusCode).toBe(200)
    const d2 = (await app.inject({ method: 'GET', url: `/api/admin/users/${u.id}`, headers: aa })).json()
    expect(d2.user.phone).toBeNull()
  })

  it('管理员代设密码：新密码可登录、旧 token 失效、会话撤销', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'pwreset1')
    const me1 = await app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) })
    expect(me1.statusCode).toBe(200)

    const r = await app.inject({ method: 'POST', url: `/api/admin/users/${u.id}/reset-password`, headers: aa, payload: { newPassword: 'brandnew9' } })
    expect(r.statusCode).toBe(200)
    const me2 = await app.inject({ method: 'GET', url: '/api/me', headers: auth(u.token) })
    expect(me2.statusCode).toBe(401) // 旧 token 被 tokenVersion 击穿
    const relogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'pwreset1', password: 'brandnew9' } })
    expect(relogin.statusCode).toBe(200)
  })

  it('删除用户：级联 + 不能删自己 + 唯一管理员保护', async () => {
    const { app, store } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'doomed')

    const self = await app.inject({ method: 'DELETE', url: '/api/admin/users/admin1', headers: aa })
    expect(self.statusCode).toBe(400) // cannot_delete_self

    const del = await app.inject({ method: 'DELETE', url: `/api/admin/users/${u.id}`, headers: aa })
    expect(del.statusCode).toBe(200)
    expect(store.findById(u.id)).toBeUndefined()
    expect(store.countSessionsForUser(u.id, Date.now())).toBe(0) // 会话也清了
  })

  it('编辑/改密/删除都留审计', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'audited1')
    await app.inject({ method: 'PATCH', url: `/api/admin/users/${u.id}`, headers: aa, payload: { displayName: 'X' } })
    await app.inject({ method: 'POST', url: `/api/admin/users/${u.id}/reset-password`, headers: aa, payload: { newPassword: 'aaaaaa1' } })
    const audit = (await app.inject({ method: 'GET', url: '/api/admin/audit', headers: aa })).json()
    const actions = audit.entries.map((e: any) => e.action)
    expect(actions).toContain('user.edit')
    expect(actions).toContain('user.resetPassword')
  })
})

describe('Admin v4 评审修复：补全功能开关 + 删号级联', () => {
  it('关闭 messaging 后撤回也被拦（recall 受 messaging 开关约束）', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'recaller')
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { features: { messaging: false } } })
    const r = await app.inject({ method: 'POST', url: '/api/messages/anyid/recall', headers: auth(u.token) })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('feature_disabled')
  })

  it('关闭 helpRequests 后认领/匹配都被拦', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'volunteer1')
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { features: { helpRequests: false } } })
    const claim = await app.inject({ method: 'POST', url: '/api/assist/help/claim', headers: auth(u.token), payload: { callId: 'x' } })
    expect(claim.statusCode).toBe(403)
    expect(claim.json().error).toBe('feature_disabled')
    const match = await app.inject({ method: 'POST', url: '/api/assist/help/match', headers: auth(u.token), payload: {} })
    expect(match.statusCode).toBe(403)
    expect(match.json().error).toBe('feature_disabled')
  })

  it('删号级联：清空该用户单聊消息 + 自建群解散 + 参与群退出', async () => {
    const { app, store } = withAdmin()
    const aa = await adminAuth(app)
    const a = await makeUser(app, 'cascA')
    const b = await makeUser(app, 'cascB')
    // 建立可互发消息的绑定（accepted）
    store.createLink({ id: 'lk1', ownerId: a.id, memberId: b.id, relation: '朋友', isEmergency: false, status: 'accepted', createdAt: Date.now() })
    // a 给 b 发一条单聊
    store.createMessage({ id: 'm1', fromId: a.id, toId: b.id, kind: 'text', text: 'hi', createdAt: Date.now() })
    // a 自建一个含 b 的群；另有一个 b 建的群含 a
    store.createGroup({ id: 'gA', name: 'A群', ownerId: a.id, memberIds: [a.id, b.id], createdAt: Date.now() })
    store.createGroup({ id: 'gB', name: 'B群', ownerId: b.id, memberIds: [b.id, a.id], createdAt: Date.now() })

    const del = await app.inject({ method: 'DELETE', url: `/api/admin/users/${a.id}`, headers: aa })
    expect(del.statusCode).toBe(200)
    expect(store.findById(a.id)).toBeUndefined()
    // a 的单聊消息清空
    expect(store.messagesBetween(a.id, b.id, 50).length).toBe(0)
    // a 自建的群被解散
    expect(store.findGroup('gA')).toBeUndefined()
    // b 的群里 a 已被移除，群仍在
    const gB = store.findGroup('gB')
    expect(gB).toBeTruthy()
    expect(gB!.memberIds).not.toContain(a.id)
  })
})
