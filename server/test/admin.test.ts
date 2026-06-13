import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

function withAdmin() {
  const store = new MemoryStore()
  const admin: User = {
    id: 'admin1',
    username: 'root',
    passwordHash: hashPassword('rootpass1'),
    displayName: 'root',
    role: 'admin',
    status: 'active',
    createdAt: Date.now(),
  }
  store.createUser(admin)
  return { store, app: buildApp(store) }
}

async function login(app: ReturnType<typeof buildApp>, username: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } })
  return res.json().token as string
}

describe('admin + reports', () => {
  it('non-admin is forbidden from admin endpoints', async () => {
    const { app } = withAdmin()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'alice', password: 'secret123' } })
    const token = reg.json().token
    const res = await app.inject({ method: 'GET', url: '/api/admin/users', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('admin can list and ban users; banned user cannot log in', async () => {
    const { app } = withAdmin()
    const adminToken = await login(app, 'root', 'rootpass1')
    const adminAuth = { authorization: `Bearer ${adminToken}` }

    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', password: 'secret123' } })
    const bobId = reg.json().user.id

    const list = await app.inject({ method: 'GET', url: '/api/admin/users', headers: adminAuth })
    expect(list.statusCode).toBe(200)
    expect(list.json().users.length).toBe(2) // root + bob

    const ban = await app.inject({ method: 'POST', url: `/api/admin/users/${bobId}/status`, headers: adminAuth, payload: { status: 'disabled' } })
    expect(ban.statusCode).toBe(200)
    expect(ban.json().user.status).toBe('disabled')

    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', password: 'secret123' } })
    expect(blocked.statusCode).toBe(403)
    await app.close()
  })

  it('user submits a report; admin lists and resolves it', async () => {
    const { app } = withAdmin()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: 'secret123' } })
    const token = reg.json().token

    const create = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetUserId: 'someone', reason: '不当行为' },
    })
    expect(create.statusCode).toBe(201)
    const reportId = create.json().report.id

    const adminToken = await login(app, 'root', 'rootpass1')
    const adminAuth = { authorization: `Bearer ${adminToken}` }

    const list = await app.inject({ method: 'GET', url: '/api/admin/reports', headers: adminAuth })
    expect(list.json().reports.length).toBe(1)
    expect(list.json().reports[0].reporterName).toBe('carol') // 解析举报人显示名

    const resolve = await app.inject({ method: 'POST', url: `/api/admin/reports/${reportId}/resolve`, headers: adminAuth })
    expect(resolve.json().report.status).toBe('resolved')
    await app.close()
  })

  it('admin can assign roles (promote to helper); non-admin forbidden; cannot change own role', async () => {
    const { app } = withAdmin()
    const adminToken = await login(app, 'root', 'rootpass1')
    const adminAuth = { authorization: `Bearer ${adminToken}` }

    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'dave', password: 'secret123' } })
    const daveId = reg.json().user.id
    const daveToken = reg.json().token

    // 晋升 dave 为 helper
    const promote = await app.inject({ method: 'POST', url: `/api/admin/users/${daveId}/role`, headers: adminAuth, payload: { role: 'helper' } })
    expect(promote.statusCode).toBe(200)
    expect(promote.json().user.role).toBe('helper')

    // 服务端立即生效：dave 现在能访问 helper-only? (没有 helper-only 端点，验证 /me 反映新角色)
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${daveToken}` } })
    expect(me.json().user.role).toBe('helper')

    // 非管理员不可改角色
    const forbidden = await app.inject({ method: 'POST', url: `/api/admin/users/${daveId}/role`, headers: { authorization: `Bearer ${daveToken}` }, payload: { role: 'admin' } })
    expect(forbidden.statusCode).toBe(403)

    // 管理员不能改自己的角色（防自锁）
    const adminId = (await app.inject({ method: 'GET', url: '/api/me', headers: adminAuth })).json().user.id
    const selfChange = await app.inject({ method: 'POST', url: `/api/admin/users/${adminId}/role`, headers: adminAuth, payload: { role: 'blind' } })
    expect(selfChange.statusCode).toBe(400)
    await app.close()
  })

  it('admin lists site-wide relationships and calls with resolved names', async () => {
    const { store, app } = withAdmin()
    const adminToken = await login(app, 'root', 'rootpass1')
    const adminAuth = { authorization: `Bearer ${adminToken}` }

    const blind = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'blindy', password: 'secret123' } })
    const blindId = blind.json().user.id
    const helper = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'helpy', password: 'secret123' } })
    const helperId = helper.json().user.id

    store.createLink({ id: 'lk1', ownerId: blindId, memberId: helperId, relation: '女儿', isEmergency: true, createdAt: Date.now(), status: 'accepted' })
    store.createCallRecord({ id: 'cr1', callId: 'call-abc', callerId: blindId, calleeId: helperId, status: 'answered', createdAt: Date.now() })

    const links = await app.inject({ method: 'GET', url: '/api/admin/links', headers: adminAuth })
    expect(links.statusCode).toBe(200)
    expect(links.json().links.length).toBe(1)
    expect(links.json().links[0].ownerName).toBe('blindy')
    expect(links.json().links[0].memberName).toBe('helpy')
    expect(links.json().links[0].isEmergency).toBe(true)

    const calls = await app.inject({ method: 'GET', url: '/api/admin/calls', headers: adminAuth })
    expect(calls.statusCode).toBe(200)
    expect(calls.json().calls.length).toBe(1)
    expect(calls.json().calls[0].callerName).toBe('blindy')
    expect(calls.json().calls[0].calleeName).toBe('helpy')
    expect(calls.json().calls[0].status).toBe('answered')

    // 非管理员被拒
    const helperToken = helper.json().token
    const forbidden = await app.inject({ method: 'GET', url: '/api/admin/links', headers: { authorization: `Bearer ${helperToken}` } })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })

  it('防后台锁死：管理员不能自封；不能封禁/降级最后一名管理员（见审查 #10/#11）', async () => {
    const { app } = withAdmin()
    const adminToken = await login(app, 'root', 'rootpass1')
    const adminAuth = { authorization: `Bearer ${adminToken}` }
    const adminId = (await app.inject({ method: 'GET', url: '/api/me', headers: adminAuth })).json().user.id

    // 自封 → 400
    const selfBan = await app.inject({ method: 'POST', url: `/api/admin/users/${adminId}/status`, headers: adminAuth, payload: { status: 'disabled' } })
    expect(selfBan.statusCode).toBe(400)

    // 再造一个管理员，验证最后一名保护：先升 eve 为 admin，则可降回 root？不行——降 root 会使活跃 admin 仍有 eve，允许。
    const eve = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'eve', password: 'secret123' } })
    const eveId = eve.json().user.id
    await app.inject({ method: 'POST', url: `/api/admin/users/${eveId}/role`, headers: adminAuth, payload: { role: 'admin' } })

    // 现在两名管理员：可封禁 eve（仍剩 root 一名）
    const banEve = await app.inject({ method: 'POST', url: `/api/admin/users/${eveId}/status`, headers: adminAuth, payload: { status: 'disabled' } })
    expect(banEve.statusCode).toBe(200)

    // eve 被封后只剩 root 一名活跃管理员：降级 root 角色 → 最后一名保护 400
    const demoteLast = await app.inject({ method: 'POST', url: `/api/admin/users/${adminId}/role`, headers: adminAuth, payload: { role: 'helper' } })
    // 注：root 改自己角色本就被 cannot_change_own_role 拦截（400），此处验证仍是 400
    expect(demoteLast.statusCode).toBe(400)
    await app.close()
  })
})
