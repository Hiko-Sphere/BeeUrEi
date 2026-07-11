import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { cascadeDeleteUser } from '../src/db/cascade'

async function setup(store = new MemoryStore()) {
  const app = buildApp(store)
  const reg = async (u: string, role: string) => {
    const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    return { token: r.token as string, id: r.user.id as string, h: { authorization: `Bearer ${r.token}` } }
  }
  const blind = await reg('blinduser', 'blind')
  const family = await reg('familyuser', 'family')
  const stranger = await reg('stranger', 'helper')
  // blind ↔ family 建立 accepted 互链
  const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: blind.h,
    payload: { username: 'familyuser', relation: '家人', isEmergency: false } })
  await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: family.h })
  return { app, store, blind, family, stranger }
}

const WP = [{ lat: 31.23, lng: 121.47 }, { lat: 31.24, lng: 121.48, note: '过了报亭右转' }]

describe('路线库（亲友远程路线编排 Phase 1：服务端）', () => {
  it('亲友可替互链盲人建路线；盲人 GET 可见（role=owner），亲友可见（role=creator）', async () => {
    const { app, blind, family } = await setup()
    const res = await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { forUserId: blind.id, name: '家到菜场', waypoints: WP } })
    expect(res.statusCode).toBe(200)
    const route = res.json().route
    expect(route.ownerId).toBe(blind.id)
    expect(route.createdBy).toBe(family.id)
    expect(route.waypoints).toEqual(WP)

    const mine = (await app.inject({ method: 'GET', url: '/api/routes', headers: blind.h })).json().routes
    expect(mine).toHaveLength(1)
    expect(mine[0].role).toBe('owner')
    expect(mine[0].createdByName).toBe('familyuser') // 盲人看到"谁画的"（信任透明）
    const theirs = (await app.inject({ method: 'GET', url: '/api/routes', headers: family.h })).json().routes
    expect(theirs).toHaveLength(1)
    expect(theirs[0].role).toBe('creator')
    await app.close()
  })

  it('亲友替盲人建路线 → 盲人收到 route_added 通知（附 routeId）；给自己建不通知自己', async () => {
    const { app, blind, family } = await setup()
    // 亲友替盲人建
    const res = await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { forUserId: blind.id, name: '家到菜场', waypoints: WP } })
    const routeId = res.json().route.id
    const notifs = (await app.inject({ method: 'GET', url: '/api/notifications', headers: blind.h })).json().notifications
    const added = notifs.find((n: { kind: string }) => n.kind === 'route_added')
    expect(added).toBeTruthy()
    expect(added.body).toContain('家到菜场')       // 含路线名
    expect(added.body).toContain('familyuser')     // 含创建者名
    expect(added.data.routeId).toBe(routeId)       // 附 routeId 供客户端跳转
    // 盲人给自己建路线：不通知自己
    await app.inject({ method: 'POST', url: '/api/routes', headers: blind.h, payload: { name: '自存', waypoints: WP } })
    const notifs2 = (await app.inject({ method: 'GET', url: '/api/notifications', headers: blind.h })).json().notifications
    expect(notifs2.filter((n: { kind: string }) => n.kind === 'route_added')).toHaveLength(1) // 仍只有 1 条（亲友那条）
    await app.close()
  })

  it('亲友改盲人路线 → 盲人收到 route_updated 通知（含新名+改动者，附 routeId）；盲人改自己拥有的不通知自己', async () => {
    const { app, blind, family } = await setup()
    const routeId = (await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { forUserId: blind.id, name: '家到菜场', waypoints: WP } })).json().route.id
    // 亲友改动这条盲人实地要走的路线 → 盲人须知情、先复核再走。
    const upd = await app.inject({ method: 'PUT', url: `/api/routes/${routeId}`, headers: family.h,
      payload: { name: '家到菜场（绕开工地）' } })
    expect(upd.statusCode).toBe(200)
    const notifs = (await app.inject({ method: 'GET', url: '/api/notifications', headers: blind.h })).json().notifications
    const updated = notifs.find((n: { kind: string }) => n.kind === 'route_updated')
    expect(updated).toBeTruthy()
    expect(updated.body).toContain('家到菜场（绕开工地）') // 含新名
    expect(updated.body).toContain('familyuser')           // 含改动者名
    expect(updated.data.routeId).toBe(routeId)             // 附 routeId 供跳转
    // 盲人改自己拥有的路线：不通知自己（editor===owner）。
    await app.inject({ method: 'PUT', url: `/api/routes/${routeId}`, headers: blind.h, payload: { name: '我改回来了' } })
    const notifs2 = (await app.inject({ method: 'GET', url: '/api/notifications', headers: blind.h })).json().notifications
    expect(notifs2.filter((n: { kind: string }) => n.kind === 'route_updated')).toHaveLength(1) // 仍只有亲友那条
    await app.close()
  })

  it('亲友删盲人路线 → 盲人收到 route_deleted 通知（含路线名+删除者，不附 routeId）；盲人删自己拥有的不通知自己', async () => {
    const { app, blind, family } = await setup()
    const routeId = (await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { forUserId: blind.id, name: '家到菜场', waypoints: WP } })).json().route.id
    // 亲友删掉盲人实地依赖的这条路线 → 盲人须知情、别再依赖它（补 CREATE/UPDATE 已通知、DELETE 静默的姊妹缺口）。
    const del = await app.inject({ method: 'DELETE', url: `/api/routes/${routeId}`, headers: family.h })
    expect(del.statusCode).toBe(204)
    const notifs = (await app.inject({ method: 'GET', url: '/api/notifications', headers: blind.h })).json().notifications
    const deleted = notifs.find((n: { kind: string }) => n.kind === 'route_deleted')
    expect(deleted).toBeTruthy()
    expect(deleted.body).toContain('家到菜场')   // 含路线名（盲人据此知哪条没了）
    expect(deleted.body).toContain('familyuser') // 含删除者名
    expect(deleted.data?.routeId).toBeUndefined() // 路线已删，不附可跳 routeId
    // 盲人删自己拥有的路线：不通知自己（deleter===owner）。
    const own = (await app.inject({ method: 'POST', url: '/api/routes', headers: blind.h,
      payload: { name: '自存', waypoints: WP } })).json().route.id
    await app.inject({ method: 'DELETE', url: `/api/routes/${own}`, headers: blind.h })
    const notifs2 = (await app.inject({ method: 'GET', url: '/api/notifications', headers: blind.h })).json().notifications
    expect(notifs2.filter((n: { kind: string }) => n.kind === 'route_deleted')).toHaveLength(1) // 仍只有亲友那条
    await app.close()
  })

  it('盲人可给自己建路线（实走存路线通道）；own+created 列表去重', async () => {
    const { app, blind } = await setup()
    const res = await app.inject({ method: 'POST', url: '/api/routes', headers: blind.h,
      payload: { name: '家到公交站', waypoints: WP } })
    expect(res.statusCode).toBe(200)
    expect(res.json().route.ownerId).toBe(blind.id)
    expect(res.json().route.createdBy).toBe(blind.id)
    expect(res.json().route.createdByName).toBeNull() // 自存路线：无"谁画的"（客户端显示"自存"）
    // owner 与 creator 都是我 → 列表只出现一次
    const mine = (await app.inject({ method: 'GET', url: '/api/routes', headers: blind.h })).json().routes
    expect(mine).toHaveLength(1)
    await app.close()
  })

  it('陌生人替他人建路线 403 not_linked；拉黑后 403 blocked；目标不存在 404', async () => {
    const { app, blind, family, stranger } = await setup()
    const r1 = await app.inject({ method: 'POST', url: '/api/routes', headers: stranger.h,
      payload: { forUserId: blind.id, name: 'x', waypoints: WP } })
    expect(r1.statusCode).toBe(403)
    expect(r1.json().error).toBe('not_linked')

    await app.inject({ method: 'POST', url: '/api/blocks', headers: blind.h, payload: { userId: family.id } })
    const r2 = await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { forUserId: blind.id, name: 'x', waypoints: WP } })
    expect(r2.statusCode).toBe(403)
    expect(r2.json().error).toBe('blocked')

    const r3 = await app.inject({ method: 'POST', url: '/api/routes', headers: stranger.h,
      payload: { forUserId: 'nonexistent-user', name: 'x', waypoints: WP } })
    expect(r3.statusCode).toBe(404)
    await app.close()
  })

  it('校验：<2 航点 / >200 航点 / 越界坐标 / 空名 → 400；违禁名 → 403 content_blocked', async () => {
    const { app, store, blind } = await setup()
    const bad = async (payload: unknown) => (await app.inject({ method: 'POST', url: '/api/routes', headers: blind.h, payload: payload as object })).statusCode
    expect(await bad({ name: 'x', waypoints: [WP[0]] })).toBe(400)
    expect(await bad({ name: 'x', waypoints: Array(201).fill(WP[0]) })).toBe(400)
    expect(await bad({ name: 'x', waypoints: [{ lat: 91, lng: 0 }, WP[0]] })).toBe(400)
    expect(await bad({ name: 'x', waypoints: [{ lat: 0, lng: 181 }, WP[0]] })).toBe(400)
    expect(await bad({ name: '  ', waypoints: WP })).toBe(400)

    store.setAppConfig({ contentFilter: { enabled: true, terms: ['badname'] } })
    const r = await app.inject({ method: 'POST', url: '/api/routes', headers: blind.h,
      payload: { name: '有 BADNAME 的路线', waypoints: WP } })
    expect(r.statusCode).toBe(403)
    expect(r.json().error).toBe('content_blocked')
    await app.close()
  })

  it('滥用上限：单归属者第 51 条 → 429 route_limit', async () => {
    // 直接经 store 播种 50 条（绕过 HTTP 20/min 限流——本测试要验的是每人 50 条上限，非请求速率）。
    const { app, store, blind } = await setup()
    for (let i = 0; i < 50; i++) {
      store.createSavedRoute({ id: `seed-${i}`, ownerId: blind.id, createdBy: blind.id,
        name: `路线${i}`, waypoints: WP, createdAt: i, updatedAt: i })
    }
    const over = await app.inject({ method: 'POST', url: '/api/routes', headers: blind.h,
      payload: { name: '超限', waypoints: WP } })
    expect(over.statusCode).toBe(429)
    expect(over.json().error).toBe('route_limit')
    await app.close()
  })

  it('写端点限流：POST /api/routes 21 次/分 → 429 too_many_requests（防 churn 型 I/O 放大）', async () => {
    const { app, blind } = await setup()
    let sawRateLimit = false
    for (let i = 0; i < 22; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/routes', headers: blind.h,
        payload: { name: `r${i}`, waypoints: WP } })
      if (r.statusCode === 429) { sawRateLimit = true; break }
    }
    expect(sawRateLimit).toBe(true) // 20/min 上限，第 21 条起被限流
    await app.close()
  })

  it('编辑/删除：绘制者与归属者都可；无关者 404（不泄露存在性）；删除幂等 gone→204', async () => {
    const { app, blind, family, stranger } = await setup()
    const id = (await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { forUserId: blind.id, name: '家到菜场', waypoints: WP } })).json().route.id

    // 绘制者改名
    const upd = await app.inject({ method: 'PUT', url: `/api/routes/${id}`, headers: family.h, payload: { name: '家到新菜场' } })
    expect(upd.statusCode).toBe(200)
    expect(upd.json().route.name).toBe('家到新菜场')
    // 无关者编辑 → 404（不泄露存在性）；无关者删除 → 204 no-op（幂等且不泄露存在性 oracle）
    expect((await app.inject({ method: 'PUT', url: `/api/routes/${id}`, headers: stranger.h, payload: { name: 'x' } })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: `/api/routes/${id}`, headers: stranger.h })).statusCode).toBe(204)
    // 空补丁 → 400
    expect((await app.inject({ method: 'PUT', url: `/api/routes/${id}`, headers: blind.h, payload: {} })).statusCode).toBe(400)
    // 归属者删除 → 204；重复删除幂等 204
    expect((await app.inject({ method: 'DELETE', url: `/api/routes/${id}`, headers: blind.h })).statusCode).toBe(204)
    expect((await app.inject({ method: 'DELETE', url: `/api/routes/${id}`, headers: blind.h })).statusCode).toBe(204)
    await app.close()
  })

  it('拉黑后绘制者不可改写/删除/读取盲人路线（使用时刻复查，非只在建路线时）', async () => {
    const { app, blind, family } = await setup()
    const id = (await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { forUserId: blind.id, name: '家到菜场', waypoints: WP } })).json().route.id
    // 盲人拉黑亲友
    await app.inject({ method: 'POST', url: '/api/blocks', headers: blind.h, payload: { userId: family.id } })
    // 绘制者 PUT → 403 blocked（不能静默改写盲人实地执行的路线）
    const upd = await app.inject({ method: 'PUT', url: `/api/routes/${id}`, headers: family.h, payload: { name: '恶意改名' } })
    expect(upd.statusCode).toBe(403)
    expect(upd.json().error).toBe('blocked')
    // 绘制者 DELETE → 204 no-op（不泄露存在性），但路线实际未被删
    expect((await app.inject({ method: 'DELETE', url: `/api/routes/${id}`, headers: family.h })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/routes', headers: blind.h })).json().routes).toHaveLength(1)
    // 绘制者 GET → 不再看到该盲人的路线
    expect((await app.inject({ method: 'GET', url: '/api/routes', headers: family.h })).json().routes).toHaveLength(0)
    await app.close()
  })

  it('航点 note 过违禁词过滤（唯一直达盲人 TTS 的自由文本）：建/改两路径命中 → 403', async () => {
    const { app, store, blind } = await setup()
    store.setAppConfig({ contentFilter: { enabled: true, terms: ['badword'] } })
    const create = await app.inject({ method: 'POST', url: '/api/routes', headers: blind.h,
      payload: { name: '干净名', waypoints: [{ lat: 31.2, lng: 121.4, note: '含 BADWORD 的备注' }, WP[0]] } })
    expect(create.statusCode).toBe(403)
    expect(create.json().error).toBe('content_blocked')
    // 先建干净路线，再 PUT 注入违禁 note → 403
    const id = (await app.inject({ method: 'POST', url: '/api/routes', headers: blind.h, payload: { name: '干净', waypoints: WP } })).json().route.id
    const upd = await app.inject({ method: 'PUT', url: `/api/routes/${id}`, headers: blind.h,
      payload: { waypoints: [{ lat: 31.2, lng: 121.4, note: 'badword' }, WP[0]] } })
    expect(upd.statusCode).toBe(403)
    // 改**路线名**为违禁词也须 403（update 的 name 分支——与 note 分支同一 if 但独立子条件，回归其一时另一支仍绿会假绿）。
    // 路线名对盲人执行时可见、也进"亲友改了你的路线"通知，脏名不得经改名漏出。
    const updName = await app.inject({ method: 'PUT', url: `/api/routes/${id}`, headers: blind.h, payload: { name: '改成 BADWORD 的名' } })
    expect(updName.statusCode).toBe(403)
    expect(updName.json().error).toBe('content_blocked')
    await app.close()
  })

  it('删号级联：归属者删号清其全部路线；绘制者删号不影响归属者路线', async () => {
    const { app, store, blind, family } = await setup()
    await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { forUserId: blind.id, name: '亲友画的', waypoints: WP } })
    await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { name: '亲友自己的', waypoints: WP } })

    cascadeDeleteUser(store, family.id) // 绘制者删号
    expect(store.savedRoutesForUser(blind.id)).toHaveLength(1)  // 盲人的路线仍在
    expect(store.savedRoutesForUser(family.id)).toHaveLength(0) // 其自有路线随删号清除

    cascadeDeleteUser(store, blind.id) // 归属者删号
    expect(store.savedRoutesForUser(blind.id)).toHaveLength(0)
    await app.close()
  })

  it('SqliteStore parity：建/查/改/删/级联 与 MemoryStore 同语义（waypoints JSON 往返无损）', async () => {
    const { app, blind, family } = await setup(new SqliteStore(':memory:') as unknown as MemoryStore)
    const res = await app.inject({ method: 'POST', url: '/api/routes', headers: family.h,
      payload: { forUserId: blind.id, name: '家到菜场', waypoints: WP } })
    expect(res.statusCode).toBe(200)
    const mine = (await app.inject({ method: 'GET', url: '/api/routes', headers: blind.h })).json().routes
    expect(mine[0].waypoints).toEqual(WP) // JSON 列往返：note 可选字段无损
    const upd = await app.inject({ method: 'PUT', url: `/api/routes/${mine[0].id}`, headers: blind.h,
      payload: { waypoints: [...WP, { lat: 31.25, lng: 121.49 }] } })
    expect(upd.json().route.waypoints).toHaveLength(3)
    expect((await app.inject({ method: 'DELETE', url: `/api/routes/${mine[0].id}`, headers: blind.h })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/routes', headers: blind.h })).json().routes).toHaveLength(0)
    await app.close()
  })
})
