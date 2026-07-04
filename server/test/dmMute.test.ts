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
class SpyPush implements PushSender {
  alerts: string[] = []
  onOutcome?: (ok: boolean) => void
  async sendCallInvite(): Promise<void> {}
  async sendAlert(token: string): Promise<void> { this.alerts.push(token) }
}

describe('单聊免打扰 mute', () => {
  it('静音后不收对端单聊推送，但消息照常存库、未读照增；取消后恢复', async () => {
    const store = new MemoryStore()
    const spy = new SpyPush()
    const app = buildApp(store, { pushSender: spy })
    const a = await reg(app, 'dmmutea', 'blind')
    const b = await reg(app, 'dmmuteb', 'helper')
    await bind(app, a.token, b.token, 'dmmuteb')
    store.updateUser(a.user.id, { apnsToken: 'tok-a' }) // a 收 b 的消息推送

    // a 静音与 b 的会话。
    const mute = await app.inject({ method: 'POST', url: `/api/conversations/${b.user.id}/mute`, headers: auth(a.token), payload: { muted: true } })
    expect(mute.statusCode).toBe(200)
    expect(mute.json()).toMatchObject({ muted: true })

    // b 给 a 发消息 → a 静音了 → 无推送，但消息存库、a 未读+1。
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(b.token), payload: { toId: a.user.id, kind: 'text', text: '在吗' } })
    expect(spy.alerts).not.toContain('tok-a')
    const convA = (await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(a.token) })).json().conversations[0]
    expect(convA.muted).toBe(true)
    expect(convA.unread).toBe(1)
    expect(convA.last.text).toBe('在吗')

    // 有向：a 静音 b，不代表 b 静音 a——b 仍能收到 a 的消息推送。
    store.updateUser(b.user.id, { apnsToken: 'tok-b' })
    spy.alerts.length = 0
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: '在的' } })
    expect(spy.alerts).toContain('tok-b')

    // a 取消静音 → 之后能收 b 的推送、会话 muted=false。
    await app.inject({ method: 'POST', url: `/api/conversations/${b.user.id}/mute`, headers: auth(a.token), payload: { muted: false } })
    spy.alerts.length = 0
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(b.token), payload: { toId: a.user.id, kind: 'text', text: '再问一次' } })
    expect(spy.alerts).toContain('tok-a')
    const convA2 = (await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(a.token) })).json().conversations[0]
    expect(convA2.muted).toBe(false)
    await app.close()
  })

  it('mute 端点鉴权：坏 body 400、静音自己/不存在对端 404', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const a = await reg(app, 'dmauth1', 'blind')
    expect((await app.inject({ method: 'POST', url: `/api/conversations/${a.user.id}/mute`, headers: auth(a.token), payload: { muted: 'x' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: `/api/conversations/${a.user.id}/mute`, headers: auth(a.token), payload: { muted: true } })).statusCode).toBe(404) // 自己
    expect((await app.inject({ method: 'POST', url: '/api/conversations/nobody/mute', headers: auth(a.token), payload: { muted: true } })).statusCode).toBe(404)
    await app.close()
  })

  it('SqliteStore 单聊静音往返 + 有向 + 删号级联（muter/peer 两侧都清）与 MemoryStore 同形', () => {
    for (const store of [new SqliteStore(':memory:'), new MemoryStore()] as const) {
      store.setDmMuted('u1', 'u2', true)
      expect(store.isDmMuted('u1', 'u2')).toBe(true)
      expect(store.isDmMuted('u2', 'u1')).toBe(false) // 有向：u1 静音 u2 ≠ u2 静音 u1
      store.setDmMuted('u1', 'u2', false)
      expect(store.isDmMuted('u1', 'u2')).toBe(false)
      // 删号级联：清 u3 作为 muter 或 peer 的所有静音。
      store.setDmMuted('u3', 'u4', true)   // u3 作 muter
      store.setDmMuted('u5', 'u3', true)   // u3 作 peer
      store.setDmMuted('u6', 'u7', true)   // 无关，须保留
      store.deleteDmMutesForUser('u3')
      expect(store.isDmMuted('u3', 'u4')).toBe(false)
      expect(store.isDmMuted('u5', 'u3')).toBe(false)
      expect(store.isDmMuted('u6', 'u7')).toBe(true)
    }
  })
})
