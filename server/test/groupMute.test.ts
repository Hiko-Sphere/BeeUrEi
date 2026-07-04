import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import type { PushSender } from '../src/push/apns'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function reg(app: ReturnType<typeof buildApp>, u: string, role = 'blind') {
  return (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json() as { token: string; user: { id: string } }
}
async function bind(app: ReturnType<typeof buildApp>, ownerT: string, memberT: string, memberU: string) {
  await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(ownerT), payload: { username: memberU, relation: '亲友' } })
  const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(memberT) })
  await app.inject({ method: 'POST', url: `/api/family/links/${(inc.json() as any).links[0].id}/accept`, headers: auth(memberT) })
}
/// 记录 sendAlert 命中的 apnsToken，用于断言"静音成员不被推送"。
class SpyPush implements PushSender {
  alerts: string[] = []
  onOutcome?: (ok: boolean) => void
  async sendCallInvite(): Promise<void> {}
  async sendAlert(token: string): Promise<void> { this.alerts.push(token) }
}

describe('群免打扰 mute', () => {
  it('静音成员不收群推送，但消息照常存库、未读数照增；未静音成员正常收', async () => {
    const store = new MemoryStore()
    const spy = new SpyPush()
    const app = buildApp(store, { pushSender: spy })
    const owner = await reg(app, 'muteown', 'blind')
    const m1 = await reg(app, 'mutem1', 'helper')
    const m2 = await reg(app, 'mutem2', 'helper')
    await bind(app, owner.token, m1.token, 'mutem1')
    await bind(app, owner.token, m2.token, 'mutem2')
    store.updateUser(m1.user.id, { apnsToken: 'tok-m1' })
    store.updateUser(m2.user.id, { apnsToken: 'tok-m2' })
    const gid = (await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token), payload: { name: '大群', memberIds: [m1.user.id, m2.user.id] } })).json().group.id as string

    // m2 静音此群。
    const mute = await app.inject({ method: 'POST', url: `/api/groups/${gid}/mute`, headers: auth(m2.token), payload: { muted: true } })
    expect(mute.statusCode).toBe(200)
    expect(mute.json()).toMatchObject({ muted: true })

    spy.alerts.length = 0 // 清掉建群时的 group_added 推送，只观察下面这条消息的推送扇出
    // 群主发消息。
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token), payload: { groupId: gid, kind: 'text', text: '晚上聚餐' } })
    // 推送：m1 收到、m2（静音）不收。
    expect(spy.alerts).toContain('tok-m1')
    expect(spy.alerts).not.toContain('tok-m2')
    // 但消息对 m2 照常存库、未读数照增（静音只压推送横幅，不丢消息）。
    const g2 = (await app.inject({ method: 'GET', url: '/api/groups', headers: auth(m2.token) })).json().groups[0]
    expect(g2.muted).toBe(true)
    expect(g2.unread).toBe(1)
    expect(g2.last.text).toBe('晚上聚餐')

    // m2 取消静音 → 之后能收到推送、列表 muted=false。
    await app.inject({ method: 'POST', url: `/api/groups/${gid}/mute`, headers: auth(m2.token), payload: { muted: false } })
    spy.alerts.length = 0
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(owner.token), payload: { groupId: gid, kind: 'text', text: '再提醒一次' } })
    expect(spy.alerts).toContain('tok-m2')
    const g2b = (await app.inject({ method: 'GET', url: '/api/groups', headers: auth(m2.token) })).json().groups[0]
    expect(g2b.muted).toBe(false)
    await app.close()
  })

  it('mute 端点鉴权：非成员 403、坏 body 400', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const owner = await reg(app, 'muteauth1', 'blind')
    const m1 = await reg(app, 'muteauth2', 'helper')
    const outsider = await reg(app, 'muteauth3', 'helper')
    await bind(app, owner.token, m1.token, 'muteauth2')
    const gid = (await app.inject({ method: 'POST', url: '/api/groups', headers: auth(owner.token), payload: { name: 'g', memberIds: [m1.user.id] } })).json().group.id as string
    expect((await app.inject({ method: 'POST', url: `/api/groups/${gid}/mute`, headers: auth(outsider.token), payload: { muted: true } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/api/groups/${gid}/mute`, headers: auth(owner.token), payload: { muted: 'yes' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/groups/nope/mute', headers: auth(owner.token), payload: { muted: true } })).statusCode).toBe(404)
    await app.close()
  })

  it('SqliteStore 群静音往返 + 级联（解散清、删号清、他人保留）与 MemoryStore 同形', () => {
    for (const store of [new SqliteStore(':memory:'), new MemoryStore()] as const) {
      store.setGroupMuted('g1', 'u1', true)
      store.setGroupMuted('g1', 'u2', true)
      expect(store.isGroupMuted('g1', 'u1')).toBe(true)
      store.setGroupMuted('g1', 'u1', false)          // 取消
      expect(store.isGroupMuted('g1', 'u1')).toBe(false)
      expect(store.isGroupMuted('g1', 'u2')).toBe(true)
      // 删号级联：清 u2 的静音，不动别群/别人。
      store.setGroupMuted('g2', 'u2', true)
      store.deleteGroupMutesForUser('u2')
      expect(store.isGroupMuted('g1', 'u2')).toBe(false)
      expect(store.isGroupMuted('g2', 'u2')).toBe(false)
      // 解散清：g3 里 u3 静音，deleteGroup 后清除。
      store.setGroupMuted('g3', 'u3', true)
      store.deleteGroup('g3')
      expect(store.isGroupMuted('g3', 'u3')).toBe(false)
    }
  })
})
