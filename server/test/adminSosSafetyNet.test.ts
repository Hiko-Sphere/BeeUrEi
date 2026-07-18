import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'
import { type WebPushSender, type WebPushSubscriptionKeys } from '../src/push/webPush'

// admin 总览「预防性 SOS 安全网」：事前看出多少活跃盲人的安全网已悄然失效（没设联系人 / 联系人全收不到即时推送）。
class ConfiguredWebPush implements WebPushSender {
  readonly configured = true
  async send(_s: WebPushSubscriptionKeys, _p: string): Promise<'sent'> { return 'sent' }
}

function seedWith(webPushConfigured: boolean) {
  const store = new MemoryStore()
  const admin: User = { id: 'a1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
  store.createUser(admin)
  const app = buildApp(store, webPushConfigured ? { webPushSender: new ConfiguredWebPush() } : {})
  return { app, store }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
const login = async (app: ReturnType<typeof buildApp>) =>
  (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string

describe('admin 总览 sosSafetyNet（预防性 SOS 安全网就绪）', () => {
  it('区分「没设联系人 / 联系人全不可达 / 就绪」，broken=前两者之和；只数活跃盲人', async () => {
    const { app, store } = seedWith(true)
    const adminTok = await login(app)

    // blindA：无任何联系人 → noContact
    store.createUser({ id: 'bA', username: 'bA', passwordHash: 'x', displayName: 'bA', role: 'blind', status: 'active', createdAt: 1 })
    // blindB：有联系人但无推送 → contactsUnreachable
    store.createUser({ id: 'bB', username: 'bB', passwordHash: 'x', displayName: 'bB', role: 'blind', status: 'active', createdAt: 1 })
    store.createUser({ id: 'cB', username: 'cB', passwordHash: 'x', displayName: 'cB', role: 'family', status: 'active', createdAt: 1 })
    store.createLink({ id: 'lB', ownerId: 'bB', memberId: 'cB', relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    // blindC：联系人有 APNs → ready（不计 broken）
    store.createUser({ id: 'bC', username: 'bC', passwordHash: 'x', displayName: 'bC', role: 'blind', status: 'active', createdAt: 1 })
    store.createUser({ id: 'cC', username: 'cC', passwordHash: 'x', displayName: 'cC', role: 'family', status: 'active', createdAt: 1, apnsToken: 'a'.repeat(64) })
    store.createLink({ id: 'lC', ownerId: 'bC', memberId: 'cC', relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    // 停用的盲人 + 非盲角色：都不计入 blindTotal
    store.createUser({ id: 'bD', username: 'bD', passwordHash: 'x', displayName: 'bD', role: 'blind', status: 'disabled', createdAt: 1 })

    const ov = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(adminTok) })).json()
    expect(ov.sosSafetyNet).toEqual({ blindTotal: 3, noContact: 1, contactsUnreachable: 1, broken: 2 })
    await app.close()
  })

  it('webPush 未配置时，仅有 web 订阅的联系人算不可达 → 该盲人计入 broken（与实际扇出一致，不假安心）', async () => {
    const { app, store } = seedWith(false) // NoopWebPush：configured=false
    const adminTok = await login(app)
    store.createUser({ id: 'bW', username: 'bW', passwordHash: 'x', displayName: 'bW', role: 'blind', status: 'active', createdAt: 1 })
    store.createUser({ id: 'cW', username: 'cW', passwordHash: 'x', displayName: 'cW', role: 'family', status: 'active', createdAt: 1 })
    store.upsertWebPushSubscription({ endpoint: 'https://p.example/cW', userId: 'cW', p256dh: 'k', auth: 'x', createdAt: 1 })
    store.createLink({ id: 'lW', ownerId: 'bW', memberId: 'cW', relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })

    const ov = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: auth(adminTok) })).json()
    expect(ov.sosSafetyNet).toEqual({ blindTotal: 1, noContact: 0, contactsUnreachable: 1, broken: 1 })
    await app.close()
  })
})
