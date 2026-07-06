import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

// 群成员在线/待命状态（与亲友列表 online 同口径：presence 待命 ∨ 在通话中）——盲人在群里一眼看出谁能即时接应。
describe('GET /api/groups 群成员含 online 状态', () => {
  async function setup() {
    const app = buildApp(new MemoryStore())
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const owner = await reg('gmoOwner', 'blind')
    const helper = await reg('gmoHelper', 'helper')
    // owner ↔ helper 建 accepted 绑定（建群前置）。
    await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'gmoHelper', relation: '志愿者' } })
    const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(helper.token) })
    await app.inject({ method: 'POST', url: `/api/family/links/${inc.json().links[0].id}/accept`, headers: auth(helper.token) })
    // 建群。
    const g = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token), payload: { name: '出行群', memberIds: [helper.user.id] } })
    return { app, owner, helper, gid: g.json().group.id }
  }

  it('成员心跳待命 → members[helper].online:true；下线 → false', async () => {
    const { app, owner, helper } = await setup()
    const memberOnline = async () => {
      const g = (await app.inject({ method: 'GET', url: '/api/groups', headers: auth(owner.token) })).json().groups[0]
      return g.members.find((m: { id: string }) => m.id === helper.user.id)?.online
    }
    // 默认离线。
    expect(await memberOnline()).toBe(false)
    // helper 待命 → online:true。
    await app.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: auth(helper.token), payload: { available: true } })
    expect(await memberOnline()).toBe(true)
    // 下线 → false。
    await app.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: auth(helper.token), payload: { available: false } })
    expect(await memberOnline()).toBe(false)
    await app.close()
  })

  it('每个成员都带 online 字段（含群主自己，默认离线不误显在线）', async () => {
    const { app, owner } = await setup()
    const g = (await app.inject({ method: 'GET', url: '/api/groups', headers: auth(owner.token) })).json().groups[0]
    expect(g.members).toHaveLength(2)
    for (const m of g.members) expect(typeof m.online).toBe('boolean')
    // 群主未心跳待命 → 自己也离线（不因是请求者就误显在线）。
    expect(g.members.find((m: { id: string }) => m.id === owner.user.id)?.online).toBe(false)
    await app.close()
  })
})
