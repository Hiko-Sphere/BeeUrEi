import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 群改名（群主）：WhatsApp/Signal 标配。此前群名定了改不了。owner-only + 违禁词过滤 + 通知其余成员。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function setup() {
  const store = new MemoryStore()
  const app = buildApp(store)
  const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
  const owner = await reg('grOwner', 'blind')
  const helper = await reg('grHelper', 'helper')
  await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(owner.token), payload: { username: 'grHelper', relation: '志愿者' } })
  const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(helper.token) })
  await app.inject({ method: 'POST', url: `/api/family/links/${inc.json().links[0].id}/accept`, headers: auth(helper.token) })
  const g = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token), payload: { name: '出行群', memberIds: [helper.user.id] } })
  return { app, store, owner, helper, gid: g.json().group.id }
}
const nameOf = async (app: Awaited<ReturnType<typeof setup>>['app'], token: string, gid: string) =>
  ((await app.inject({ method: 'GET', url: '/api/groups', headers: auth(token) })).json().groups.find((x: { group: { id: string } }) => x.group.id === gid)).group.name

describe('群改名 POST /api/groups/:id/rename', () => {
  it('群主改名 → 群名更新，且其余成员收到 group_renamed 通知（群主自己不收）', async () => {
    const { app, owner, helper, gid, store } = await setup()
    const r = await app.inject({ method: 'POST', url: `/api/groups/${gid}/rename`, headers: auth(owner.token), payload: { name: '看病陪同群' } })
    expect(r.statusCode).toBe(200)
    expect(r.json().group.name).toBe('看病陪同群')
    expect(await nameOf(app, helper.token, gid)).toBe('看病陪同群') // 成员侧也看到新名
    // helper 收到 group_renamed 站内通知 + 推送；owner（改名者）不收。
    const helperNotifs = store.notificationsForUser(helper.user.id).filter((n) => n.kind === 'group_renamed')
    expect(helperNotifs).toHaveLength(1)
    expect(helperNotifs[0].title).toContain('群名已更改')
    expect(store.notificationsForUser(owner.user.id).filter((n) => n.kind === 'group_renamed')).toHaveLength(0)
    await app.close()
  })

  it('非群主改名 → 403 not_owner，群名不变、无通知', async () => {
    const { app, helper, owner, gid } = await setup()
    const r = await app.inject({ method: 'POST', url: `/api/groups/${gid}/rename`, headers: auth(helper.token), payload: { name: '恶意改名' } })
    expect(r.statusCode).toBe(403)
    expect(await nameOf(app, owner.token, gid)).toBe('出行群') // 未变
    await app.close()
  })

  it('违禁词群名 → 403 content_blocked（防先起干净名再改违禁绕过建群审核）', async () => {
    const { app, store, owner, gid } = await setup()
    store.setAppConfig({ contentFilter: { enabled: true, terms: ['敏感词'] } })
    const r = await app.inject({ method: 'POST', url: `/api/groups/${gid}/rename`, headers: auth(owner.token), payload: { name: '含敏感词的群' } })
    expect(r.statusCode).toBe(403)
    expect(await nameOf(app, owner.token, gid)).toBe('出行群')
    await app.close()
  })

  it('空名/超长 → 400；改成与原名相同 → 200 但不发通知（无实质变更）', async () => {
    const { app, owner, helper, gid, store } = await setup()
    expect((await app.inject({ method: 'POST', url: `/api/groups/${gid}/rename`, headers: auth(owner.token), payload: { name: '   ' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: `/api/groups/${gid}/rename`, headers: auth(owner.token), payload: { name: 'x'.repeat(51) } })).statusCode).toBe(400)
    const same = await app.inject({ method: 'POST', url: `/api/groups/${gid}/rename`, headers: auth(owner.token), payload: { name: '出行群' } })
    expect(same.statusCode).toBe(200)
    expect(store.notificationsForUser(helper.user.id).filter((n) => n.kind === 'group_renamed')).toHaveLength(0) // 名字没变，不打扰成员
    await app.close()
  })

  it('不存在的群 → 404', async () => {
    const { app, owner } = await setup()
    const r = await app.inject({ method: 'POST', url: '/api/groups/nonexistent/rename', headers: auth(owner.token), payload: { name: '新名' } })
    expect(r.statusCode).toBe(404)
    await app.close()
  })
})
