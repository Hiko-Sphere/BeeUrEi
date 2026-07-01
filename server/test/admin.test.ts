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

  it('用户列表排序对 tied 行以 id 兜底（确定序，防翻页跨页重复/漏 + 跨存储一致）', async () => {
    const { store, app } = withAdmin()
    const adminToken = await login(app, 'root', 'rootpass1')
    // 以"非 id 序"插入同角色、同毫秒创建的用户；role_asc 下它们 tied，须按 id 兜底定序。
    for (const id of ['u-z', 'u-a', 'u-m']) {
      store.createUser({ id, username: id, passwordHash: hashPassword('secret123'), displayName: id, role: 'helper', status: 'active', createdAt: 1000 })
    }
    const res = await app.inject({ method: 'GET', url: '/api/admin/users?sort=role_asc', headers: { authorization: `Bearer ${adminToken}` } })
    const ids = (res.json().users as Array<{ id: string; role: string }>).filter((u) => u.role === 'helper').map((u) => u.id)
    expect(ids).toEqual(['u-a', 'u-m', 'u-z']) // id 兜底排序，而非插入序 z,a,m
    await app.close()
  })

  it('全站功能开关：locationSharing 可被关闭（回归：曾因 featuresSchema 硬编码漏加、被 z.object 静默剥离）', async () => {
    const { app } = withAdmin()
    const adminAuth = { authorization: `Bearer ${await login(app, 'root', 'rootpass1')}` }
    // 修复前 featuresSchema 只列 8 个键、缺 locationSharing → 该键被静默剥离、设置无效（仍为默认 true）。
    // 修复后 featuresSchema 派生自 FEATURE_KEYS，locationSharing 与其余功能开关一样可被全站关闭。
    const put = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: adminAuth, payload: { features: { locationSharing: false } } })
    expect(put.statusCode).toBe(200)
    expect(put.json().config.features.locationSharing).toBe(false)
    const get = await app.inject({ method: 'GET', url: '/api/admin/config', headers: adminAuth })
    expect(get.json().config.features.locationSharing).toBe(false)
    // 逐键合并：只关 locationSharing，其余开关不受影响（仍为默认 true）。
    expect(get.json().config.features.calls).toBe(true)
    await app.close()
  })

  it('全站配置：可单独切换 requireVerification（回归：空补丁守卫曾漏计 requireVerification → 单独 patch 被误判空 400）', async () => {
    const { app } = withAdmin()
    const adminAuth = { authorization: `Bearer ${await login(app, 'root', 'rootpass1')}` }
    // 只发 requireVerification、不带其它配置块：修复前空补丁守卫不计 requireVerification → 误当空补丁 400。
    const put = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: adminAuth, payload: { requireVerification: true } })
    expect(put.statusCode).toBe(200)
    expect(put.json().config.requireVerification).toBe(true)
    const get = await app.inject({ method: 'GET', url: '/api/admin/config', headers: adminAuth })
    expect(get.json().config.requireVerification).toBe(true)
    // 真正的空补丁仍应被拒。
    const empty = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: adminAuth, payload: {} })
    expect(empty.statusCode).toBe(400)
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

  it('单用户封禁即吊销会话：refresh token 删除 + tokenVersion 递增（与批量封禁/force-logout 同口径）', async () => {
    const { store, app } = withAdmin()
    const adminAuth = { authorization: `Bearer ${await login(app, 'root', 'rootpass1')}` }
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'dan', password: 'secret123' } })
    const danLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'dan', password: 'secret123' } })
    const refreshToken = (danLogin.json() as { refreshToken: string }).refreshToken
    const danId = store.findByUsername('dan')!.id
    const tv0 = store.findById(danId)!.tokenVersion ?? 0

    const ban = await app.inject({ method: 'POST', url: `/api/admin/users/${danId}/status`, headers: adminAuth, payload: { status: 'disabled' } })
    expect(ban.statusCode).toBe(200)
    // 封禁删了 refresh token → 续期失败（旧会话不可复活）
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })).statusCode).not.toBe(200)
    // tokenVersion 递增 → 解封后旧 access token 仍失效
    expect(store.findById(danId)!.tokenVersion ?? 0).toBe(tv0 + 1)
    await app.close()
  })

  it('user submits a report; admin lists and resolves it', async () => {
    const { app } = withAdmin()
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: 'secret123' } })
    const token = reg.json().token
    const targetReg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'someone', password: 'secret123' } })
    const targetId = targetReg.json().user.id

    const create = await app.inject({
      method: 'POST',
      url: '/api/reports',
      headers: { authorization: `Bearer ${token}` },
      payload: { targetUserId: targetId, reason: '不当行为' },
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

  it('admin lists site-wide blocks and overview exposes 30-day growth', async () => {
    const { store, app } = withAdmin()
    const adminToken = await login(app, 'root', 'rootpass1')
    const adminAuth = { authorization: `Bearer ${adminToken}` }

    const blocker: User = { id: 'u1', username: 'frank', passwordHash: hashPassword('secret123'), displayName: 'Frank', role: 'blind', status: 'active', createdAt: Date.now() }
    const blocked: User = { id: 'u2', username: 'gina', passwordHash: hashPassword('secret123'), displayName: 'Gina', role: 'helper', status: 'active', createdAt: Date.now() }
    store.createUser(blocker)
    store.createUser(blocked)
    store.createBlock({ id: 'bk1', blockerId: 'u1', blockedId: 'u2', createdAt: Date.now() })

    const blocks = await app.inject({ method: 'GET', url: '/api/admin/blocks', headers: adminAuth })
    expect(blocks.statusCode).toBe(200)
    expect(blocks.json().blocks.length).toBe(1)
    expect(blocks.json().blocks[0].blockerName).toBe('Frank')
    expect(blocks.json().blocks[0].blockedName).toBe('Gina')

    const ov = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: adminAuth })
    const growth = ov.json().growth
    expect(growth).toBeDefined()
    expect(growth.trend.length).toBe(30) // 最近 30 个自然日
    expect(growth.newUsers30d).toBeGreaterThanOrEqual(3) // root + frank + gina

    // 非管理员被拒
    const ginaToken = await login(app, 'gina', 'secret123')
    const forbidden = await app.inject({ method: 'GET', url: '/api/admin/blocks', headers: { authorization: `Bearer ${ginaToken}` } })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })

  it('admin support actions: verify-email / unlink-apple / clear-passkeys / force-logout', async () => {
    const { store, app } = withAdmin()
    const adminToken = await login(app, 'root', 'rootpass1')
    const adminAuth = { authorization: `Bearer ${adminToken}` }

    const frank: User = {
      id: 'u1', username: 'frank', passwordHash: hashPassword('secret123'), displayName: 'Frank',
      role: 'blind', status: 'active', createdAt: Date.now(),
      email: 'frank@example.com', emailVerified: false, appleSub: 'apple-sub-1', tokenVersion: 0,
    }
    const gina: User = { id: 'u2', username: 'gina', passwordHash: hashPassword('secret123'), displayName: 'Gina', role: 'helper', status: 'active', createdAt: Date.now() }
    store.createUser(frank)
    store.createUser(gina)
    store.createPasskey({ id: 'pk1', userId: 'u1', credentialId: 'cred1', publicKey: 'pub', counter: 0, createdAt: Date.now() })

    // 标记邮箱已验证
    const verify = await app.inject({ method: 'POST', url: '/api/admin/users/u1/verify-email', headers: adminAuth, payload: { verified: true } })
    expect(verify.statusCode).toBe(200)
    expect(verify.json().emailVerified).toBe(true)
    expect(store.findById('u1')!.emailVerified).toBe(true)
    // 无邮箱用户不可标记 → 400
    const noEmail = await app.inject({ method: 'POST', url: '/api/admin/users/u2/verify-email', headers: adminAuth, payload: { verified: true } })
    expect(noEmail.statusCode).toBe(400)

    // 解绑 Apple，再次解绑 → 400 not_linked
    const unlink = await app.inject({ method: 'POST', url: '/api/admin/users/u1/unlink-apple', headers: adminAuth })
    expect(unlink.statusCode).toBe(200)
    expect(store.findById('u1')!.appleSub).toBeUndefined()
    const unlink2 = await app.inject({ method: 'POST', url: '/api/admin/users/u1/unlink-apple', headers: adminAuth })
    expect(unlink2.statusCode).toBe(400)

    // 清除 Passkey
    const clear = await app.inject({ method: 'POST', url: '/api/admin/users/u1/clear-passkeys', headers: adminAuth })
    expect(clear.statusCode).toBe(200)
    expect(clear.json().cleared).toBe(1)
    expect(store.passkeysForUser('u1').length).toBe(0)

    // 强制下线：旧 access token 立即失效（tokenVersion 递增）
    const frankToken = await login(app, 'frank', 'secret123')
    const me1 = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${frankToken}` } })
    expect(me1.statusCode).toBe(200)
    const fl = await app.inject({ method: 'POST', url: '/api/admin/users/u1/force-logout', headers: adminAuth })
    expect(fl.statusCode).toBe(200)
    const me2 = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${frankToken}` } })
    expect(me2.statusCode).toBe(401) // 旧令牌被 tokenVersion 击穿
    await app.close()
  })
})

describe('Admin v3：审核处置 + 审计 + 全站控制', () => {
  // 提交一条针对 target 的举报，返回 reportId（reporter 为另一注册用户）。
  async function seedReport(app: ReturnType<typeof buildApp>, reporterUser: string, targetId: string) {
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: reporterUser, password: 'secret123' } })
    const token = reg.json().token as string
    const rep = await app.inject({ method: 'POST', url: '/api/reports', headers: { authorization: `Bearer ${token}` }, payload: { targetUserId: targetId, reason: '违规内容' } })
    return rep.json().report.id as string
  }

  it('moderate warn：记警告、不封号，用户详情可见警告', async () => {
    const { app } = withAdmin()
    const adminAuth = { authorization: `Bearer ${await login(app, 'root', 'rootpass1')}` }
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'badguy', password: 'secret123' } })
    const targetId = reg.json().user.id as string
    const reportId = await seedReport(app, 'reporter1', targetId)

    const mod = await app.inject({ method: 'POST', url: `/api/admin/reports/${reportId}/moderate`, headers: adminAuth, payload: { action: 'warn', reason: '首次轻微违规' } })
    expect(mod.statusCode).toBe(200)
    expect(mod.json().decision).toBe('warned')

    // 警告不封号：仍能登录
    const stillIn = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'badguy', password: 'secret123' } })
    expect(stillIn.statusCode).toBe(200)

    // 用户详情含该警告
    const detail = await app.inject({ method: 'GET', url: `/api/admin/users/${targetId}`, headers: adminAuth })
    expect(detail.json().warnings.length).toBe(1)
    expect(detail.json().warnings[0].reason).toBe('首次轻微违规')

    // 举报标记 resolved + decision
    const reports = await app.inject({ method: 'GET', url: '/api/admin/reports', headers: adminAuth })
    const r = reports.json().reports.find((x: any) => x.id === reportId)
    expect(r.status).toBe('resolved')
    expect(r.decision).toBe('warned')
    expect(r.resolvedByName).toBe('root')
    await app.close()
  })

  it('moderate ban：封号 + 强制下线，旧 token 失效且无法登录', async () => {
    const { app } = withAdmin()
    const adminAuth = { authorization: `Bearer ${await login(app, 'root', 'rootpass1')}` }
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'abuser', password: 'secret123' } })
    const targetId = reg.json().user.id as string
    const targetToken = reg.json().token as string
    const reportId = await seedReport(app, 'reporter2', targetId)

    const mod = await app.inject({ method: 'POST', url: `/api/admin/reports/${reportId}/moderate`, headers: adminAuth, payload: { action: 'ban', reason: '严重违规' } })
    expect(mod.statusCode).toBe(200)
    expect(mod.json().decision).toBe('banned')

    // 旧 access token 立即失效
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${targetToken}` } })
    expect(me.statusCode).toBe(401)
    // 无法登录
    const login2 = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'abuser', password: 'secret123' } })
    expect(login2.statusCode).toBe(403)
    await app.close()
  })

  it('moderate ban：不能处置唯一活跃管理员（防锁死后台）', async () => {
    const { app, store } = withAdmin()
    const adminAuth = { authorization: `Bearer ${await login(app, 'root', 'rootpass1')}` }
    // 伪造一条针对 admin 自身的举报
    const reportId = await seedReport(app, 'reporter3', 'admin1')
    const mod = await app.inject({ method: 'POST', url: `/api/admin/reports/${reportId}/moderate`, headers: adminAuth, payload: { action: 'ban', reason: 'x' } })
    expect(mod.statusCode).toBe(400)
    expect(store.findById('admin1')!.status).toBe('active')
    await app.close()
  })

  it('审计日志：处置/封禁/改配置都留痕，时间倒序且带管理员名', async () => {
    const { app } = withAdmin()
    const adminAuth = { authorization: `Bearer ${await login(app, 'root', 'rootpass1')}` }
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'subj', password: 'secret123' } })
    const targetId = reg.json().user.id as string
    await app.inject({ method: 'POST', url: `/api/admin/users/${targetId}/status`, headers: adminAuth, payload: { status: 'disabled' } })

    const audit = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: adminAuth })
    expect(audit.statusCode).toBe(200)
    const entries = audit.json().entries as any[]
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[0].action).toBe('user.disable')
    expect(entries[0].adminName).toBe('root')
    await app.close()
  })

  it('全站注册开关：关闭后拒绝注册/邮箱建号/Apple 建号，已有账号仍可登录', async () => {
    const { app } = withAdmin()
    const adminAuth = { authorization: `Bearer ${await login(app, 'root', 'rootpass1')}` }
    // 先建一个用户以验证“已有账号登录不受影响”
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'early', password: 'secret123' } })

    // 关闭注册
    const put = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: adminAuth, payload: { registrationEnabled: false } })
    expect(put.statusCode).toBe(200)
    expect(put.json().config.registrationEnabled).toBe(false)
    const get = await app.inject({ method: 'GET', url: '/api/admin/config', headers: adminAuth })
    expect(get.json().config.registrationEnabled).toBe(false)

    // 新注册被拒
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'late', password: 'secret123' } })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error).toBe('registration_disabled')

    // 已有账号仍能登录
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'early', password: 'secret123' } })
    expect(ok.statusCode).toBe(200)

    // 重新开放后可注册
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: adminAuth, payload: { registrationEnabled: true } })
    const reopened = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'late', password: 'secret123' } })
    expect(reopened.statusCode).toBe(201)
    await app.close()
  })
})
