import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 越权访问（IDOR）回归：passkey 删除与通知已读**只在存储层**按 userId 作用域（路由本身不显式查归属，
// 完全依赖 store 的 `WHERE id=? AND userId=?`）。若日后有人"优化"掉那半个 WHERE，攻击者就能删他人的
// 认证凭据(passkey)或篡改他人通知状态。此测把该不变量钉死：拿着**别人资源的 id** 也动不了它。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function reg(app: ReturnType<typeof buildApp>, username: string) {
  return (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } }))
    .json() as { token: string; user: { id: string } }
}

describe('IDOR 作用域回归（store 层 userId 门控）', () => {
  it('A 拿 B 的 passkey id 删不动（认证凭据越权删除防护）；B 删自己的正常', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const a = await reg(app, 'idora')
    const b = await reg(app, 'idorb')
    // 直接种一把 B 的 passkey（真实注册需设备验签，这里只验删除的作用域）。
    store.createPasskey({ id: 'pk-b', userId: b.user.id, credentialId: 'cred-b', publicKey: 'pub', counter: 0, createdAt: 1000 })
    expect(store.passkeysForUser(b.user.id).map((p) => p.id)).toEqual(['pk-b'])

    // A 以自己的身份删 B 的 passkey → 端点幂等回 204，但**绝不能真删** B 的凭据。
    const attack = await app.inject({ method: 'DELETE', url: '/api/auth/passkey/pk-b', headers: auth(a.token) })
    expect(attack.statusCode).toBe(204)
    expect(store.passkeysForUser(b.user.id).map((p) => p.id)).toEqual(['pk-b']) // 仍在

    // B 删自己的 → 真删。
    const own = await app.inject({ method: 'DELETE', url: '/api/auth/passkey/pk-b', headers: auth(b.token) })
    expect(own.statusCode).toBe(204)
    expect(store.passkeysForUser(b.user.id)).toEqual([])
  })

  it('A 拿 B 的通知 id 标不了已读；B 标自己的正常', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const a = await reg(app, 'idorc')
    const b = await reg(app, 'idord')
    store.createNotification({ id: 'ntf-b', userId: b.user.id, kind: 'friend_request', title: 't', body: 'x', createdAt: 1000 })

    // A 标 B 的通知已读 → 端点幂等 204，但 B 的通知仍未读。
    const attack = await app.inject({ method: 'POST', url: '/api/notifications/ntf-b/read', headers: auth(a.token) })
    expect(attack.statusCode).toBe(204)
    expect(store.notificationsForUser(b.user.id)[0].readAt).toBeUndefined() // 仍未读

    // B 标自己的 → 真已读。
    await app.inject({ method: 'POST', url: '/api/notifications/ntf-b/read', headers: auth(b.token) })
    expect(store.notificationsForUser(b.user.id)[0].readAt).toBeTypeOf('number')
  })
})
