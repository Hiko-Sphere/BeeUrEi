import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User, normalizeAppConfig, matchBannedTerm, DEFAULT_APP_CONFIG } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

function withAdmin() {
  const store = new MemoryStore()
  store.createUser({ id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() })
  return { store, app: buildApp(store) }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function adminAuth(app: ReturnType<typeof buildApp>) {
  const t = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token
  return auth(t)
}
async function makeUser(app: ReturnType<typeof buildApp>, username: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return { id: r.json().user.id as string, token: r.json().token as string }
}

describe('AppConfig v5 归一化（向后兼容新区块）', () => {
  it('旧配置无 announcement/maintenance/contentFilter → 补默认（不报错、不误开）', () => {
    const n = normalizeAppConfig({ registrationEnabled: true, features: { messaging: false } } as any)
    expect(n.announcement.active).toBe(false)
    expect(n.maintenance.active).toBe(false)
    expect(n.contentFilter.enabled).toBe(false)
    expect(n.contentFilter.terms).toEqual([])
    expect(n.features.messaging).toBe(false)
  })
  it('matchBannedTerm：关闭/空表恒不命中；启用+命中子串（大小写不敏感）才返回', () => {
    expect(matchBannedTerm(DEFAULT_APP_CONFIG, '任意文字 BadWord')).toBeNull() // 默认关闭
    const cfg = normalizeAppConfig({ contentFilter: { enabled: true, terms: ['badword', '违禁'] } } as any)
    expect(matchBannedTerm(cfg, 'hello WORLD')).toBeNull()
    expect(matchBannedTerm(cfg, 'a BADWORD here')).toBe('badword')
    expect(matchBannedTerm(cfg, '含违禁内容')).toBe('违禁')
  })
})

describe('v5 用户搜索/筛选/排序/分页', () => {
  it('q 搜索 + role 筛选 + 分页 total', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    await makeUser(app, 'alice')
    await makeUser(app, 'bob')
    await makeUser(app, 'alicia')
    const all = await app.inject({ method: 'GET', url: '/api/admin/users', headers: aa })
    expect(all.json().total).toBe(4) // root + 3
    const q = await app.inject({ method: 'GET', url: '/api/admin/users?q=ali', headers: aa })
    expect(q.json().total).toBe(2) // alice + alicia
    const paged = await app.inject({ method: 'GET', url: '/api/admin/users?limit=2&offset=0', headers: aa })
    expect(paged.json().users.length).toBe(2)
    expect(paged.json().total).toBe(4)
    const admins = await app.inject({ method: 'GET', url: '/api/admin/users?role=admin', headers: aa })
    expect(admins.json().total).toBe(1)
  })
})

describe('v5 批量操作', () => {
  it('批量封禁/改角色/删除，逐个保护（自己/最后管理员）', async () => {
    const { app, store } = withAdmin()
    const aa = await adminAuth(app)
    const a = await makeUser(app, 'bulk1')
    const b = await makeUser(app, 'bulk2')

    const ban = await app.inject({ method: 'POST', url: '/api/admin/users/bulk', headers: aa, payload: { ids: [a.id, b.id], action: 'disable' } })
    expect(ban.json().succeeded).toBe(2)
    expect(store.findById(a.id)!.status).toBe('disabled')
    expect(store.findById(b.id)!.status).toBe('disabled')

    const role = await app.inject({ method: 'POST', url: '/api/admin/users/bulk', headers: aa, payload: { ids: [a.id], action: 'role', role: 'helper' } })
    expect(role.json().succeeded).toBe(1)
    expect(store.findById(a.id)!.role).toBe('helper')

    // 含自己 + 唯一管理员保护：批量删 [admin1, b2] → admin1 失败(cannot_target_self)，b2 成功
    const del = await app.inject({ method: 'POST', url: '/api/admin/users/bulk', headers: aa, payload: { ids: ['admin1', b.id], action: 'delete' } })
    expect(del.json().succeeded).toBe(1)
    expect(del.json().failed).toBe(1)
    expect(store.findById('admin1')).toBeTruthy()
    expect(store.findById(b.id)).toBeUndefined()

    // 批量改**自己**角色 → cannot_change_own_role。bulk 与单条 /role 是**独立代码路径**，单条端点已测、bulk 的自
    // 角色保护此前漏测——回归掉它时（多管理员下 last_admin 不兜底），管理员会经批量把自己降级、误失后台权限。
    // 造第二名管理员，使 last_admin 保护不兜底、纯验"不可改自己角色"这一支（否则单管理员下 last_admin 会掩盖回归）。
    const admin2 = await makeUser(app, 'admin2')
    store.updateUser(admin2.id, { role: 'admin' })
    const selfRole = await app.inject({ method: 'POST', url: '/api/admin/users/bulk', headers: aa, payload: { ids: ['admin1'], action: 'role', role: 'helper' } })
    expect(selfRole.json().results.find((r: { id: string; error?: string }) => r.id === 'admin1')?.error).toBe('cannot_change_own_role')
    expect(store.findById('admin1')!.role).toBe('admin') // 自角色未被改
  })
})

describe('v5 公告 / 维护模式 / 内容过滤（端到端强制）', () => {
  it('公告与维护写入 config 并经 app-config 下发', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'reader')
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { announcement: { active: true, message: '系统升级中', level: 'warning' } } })
    const cfg = await app.inject({ method: 'GET', url: '/api/app-config', headers: auth(u.token) })
    expect(cfg.json().announcement.active).toBe(true)
    expect(cfg.json().announcement.message).toBe('系统升级中')
    expect(cfg.json().announcement.level).toBe('warning')
  })

  it('维护模式开启 → 功能写操作 503 maintenance；登录与后台不受影响', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'mnt')
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { maintenance: { active: true, message: '维护中' } } })
    const send = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(u.token), payload: { toId: 'x', kind: 'text', text: 'hi' } })
    expect(send.statusCode).toBe(503)
    expect(send.json().error).toBe('maintenance')
    // 登录仍可用（撤销维护需要管理员能进来）
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })
    expect(login.statusCode).toBe(200)
    // 关闭维护后恢复
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { maintenance: { active: false } } })
    const send2 = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(u.token), payload: { toId: 'x', kind: 'text', text: 'hi' } })
    expect(send2.json().error).not.toBe('maintenance')
  })

  it('内容过滤：默认不拦；启用+命中 → 发消息/建群/改昵称 403 content_blocked', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'cf1')
    // 默认关闭：含敏感词也能过功能门（可能因无绑定 403/400，但不是 content_blocked）
    const before = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(u.token), payload: { toId: 'x', kind: 'text', text: '违禁词' } })
    expect(before.json().error).not.toBe('content_blocked')
    // 启用 + 配置词表（含一个 ASCII 词，用于测用户名——用户名字符集不含中文）
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { contentFilter: { enabled: true, terms: ['违禁词', 'badword'] } } })
    const msg = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(u.token), payload: { toId: 'x', kind: 'text', text: '这是违禁词内容' } })
    expect(msg.statusCode).toBe(403)
    expect(msg.json().error).toBe('content_blocked')
    const grp = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(u.token), payload: { name: '违禁词群', memberIds: ['y'] } })
    expect(grp.statusCode).toBe(403)
    expect(grp.json().error).toBe('content_blocked')
    const name = await app.inject({ method: 'POST', url: '/api/account/profile', headers: auth(u.token), payload: { displayName: '违禁词昵称' } })
    expect(name.statusCode).toBe(403)
    expect(name.json().error).toBe('content_blocked')
    // 位置名同样过审：违禁词塞进位置 name 不能绕过文本过滤。
    const loc = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(u.token),
      payload: { toId: 'x', kind: 'location', text: JSON.stringify({ lat: 31.2, lng: 121.5, name: '违禁词大厦' }) } })
    expect(loc.statusCode).toBe(403)
    expect(loc.json().error).toBe('content_blocked')
    // 用户名同样过审：用户名 everyone 可见，违禁词(ASCII，在用户名字符集内)不能塞进用户名绕过昵称过滤。
    const un = await app.inject({ method: 'POST', url: '/api/account/username', headers: auth(u.token), payload: { username: 'badword99' } })
    expect(un.statusCode).toBe(403)
    expect(un.json().error).toBe('content_blocked')
    // 注册时用户名也过审（否则注册即可塞入违禁用户名）。
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'xbadwordx', password: 'secret123' } })
    expect(reg.statusCode).toBe(403)
    expect(reg.json().error).toBe('content_blocked')
  })

  it('app-config 不下发 contentFilter 词表（不泄露违禁词）', async () => {
    const { app } = withAdmin()
    const aa = await adminAuth(app)
    const u = await makeUser(app, 'leak')
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: aa, payload: { contentFilter: { enabled: true, terms: ['secret-term'] } } })
    const cfg = await app.inject({ method: 'GET', url: '/api/app-config', headers: auth(u.token) })
    expect(JSON.stringify(cfg.json())).not.toContain('secret-term')
    // 但管理员 config 可见
    const admincfg = await app.inject({ method: 'GET', url: '/api/admin/config', headers: aa })
    expect(admincfg.json().config.contentFilter.terms).toContain('secret-term')
  })
})
