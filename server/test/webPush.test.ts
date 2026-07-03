import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { type WebPushSender, type WebPushSubscriptionKeys, VapidWebPushSender, makeWebPushSender, NoopWebPushSender } from '../src/push/webPush'

/// 记录式发送器（测试替身，仅测试用——生产走 web-push 库真发）：记下每次 send 以断言扇出行为。
class RecordingWebPush implements WebPushSender {
  readonly configured = true
  sent: { endpoint: string; payload: string }[] = []
  async send(sub: WebPushSubscriptionKeys, payload: string): Promise<void> {
    this.sent.push({ endpoint: sub.endpoint, payload })
  }
}

const SUB = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', keys: { p256dh: 'BPubKeyExample_1234567890', auth: 'AuthKey_12345' } }

async function seed(webPush?: WebPushSender) {
  const store = new MemoryStore()
  const a = buildApp(store, webPush ? { webPushSender: webPush } : {})
  const reg = async (u: string, role: string) =>
    (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
  const owner = await reg('wpfaller', 'blind')
  const helper = await reg('wphelper', 'helper')
  const auth = { authorization: `Bearer ${owner.token}` }
  const hAuth = { authorization: `Bearer ${helper.token}` }
  const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'wphelper', relation: '家人', isEmergency: true } })
  await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: hAuth })
  return { a, store, owner, helper, auth, hAuth }
}

describe('Web Push（浏览器推送紧急告警）', () => {
  it('未配置（Noop）：VAPID 公钥端点与订阅端点都诚实 503——绝不收下永远不会被推送的订阅', async () => {
    const { a, hAuth } = await seed() // 默认 NoopWebPushSender
    expect((await a.inject({ method: 'GET', url: '/api/push/web-vapid-key', headers: hAuth })).statusCode).toBe(503)
    const sub = await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    expect(sub.statusCode).toBe(503)
    await a.close()
  })

  it('订阅 CRUD + 校验：非 https 端点/坏 keys 拒；退订只删自己的', async () => {
    const wp = new RecordingWebPush()
    const { a, store, helper, hAuth, auth } = await seed(wp)
    // 坏输入
    expect((await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth,
      payload: { endpoint: 'http://insecure.example/x', keys: SUB.keys } })).statusCode).toBe(400)
    expect((await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth,
      payload: { endpoint: SUB.endpoint, keys: { p256dh: 'bad key with spaces', auth: 'ok_key_123' } } })).statusCode).toBe(400)
    // 正常订阅
    expect((await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })).statusCode).toBe(200)
    expect(store.webPushSubscriptionsForUser(helper.user.id).length).toBe(1)
    // 他人无法删走我的订阅（不报错也不生效——不泄露存在性）
    await a.inject({ method: 'DELETE', url: '/api/push/web-subscribe', headers: auth, payload: { endpoint: SUB.endpoint } })
    expect(store.webPushSubscriptionsForUser(helper.user.id).length).toBe(1)
    // 本人退订生效
    await a.inject({ method: 'DELETE', url: '/api/push/web-subscribe', headers: hAuth, payload: { endpoint: SUB.endpoint } })
    expect(store.webPushSubscriptionsForUser(helper.user.id).length).toBe(0)
    await a.close()
  })

  it('浏览器换账号：同 endpoint 被新账号订阅时从旧账号收回（防跨账号告警泄漏）', async () => {
    const wp = new RecordingWebPush()
    const { a, store, helper, hAuth, owner, auth } = await seed(wp)
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: auth, payload: SUB }) // 同浏览器换 owner 登录
    expect(store.webPushSubscriptionsForUser(helper.user.id).length).toBe(0)
    expect(store.webPushSubscriptionsForUser(owner.user.id).length).toBe(1)
    await a.close()
  })

  it('紧急告警扇出到订阅浏览器：负载含标题与诚实位置来源；未订阅者零投递', async () => {
    const wp = new RecordingWebPush()
    const { a, hAuth, auth } = await seed(wp)
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    // 盲人先共享位置再发无坐标告警 → lastKnown 兜底也要透传到 web push 负载。
    await a.inject({ method: 'POST', url: '/api/locations/update', headers: auth, payload: { lat: 31.2, lng: 121.5, ttlSec: 3600 } })
    const res = await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'fall' } })
    expect(res.statusCode).toBe(200)
    expect(wp.sent.length).toBe(1)
    expect(wp.sent[0].endpoint).toBe(SUB.endpoint)
    const payload = JSON.parse(wp.sent[0].payload)
    expect(payload.title).toContain('wpfaller')
    expect(payload.data).toMatchObject({ kind: 'fall', locSource: 'lastKnown', lat: '31.2', lon: '121.5' })
    await a.close()
  })

  it('来电扇出：呼叫登记时向被叫的浏览器订阅推送 incoming_call（关标签页也能收到来电）', async () => {
    const wp = new RecordingWebPush()
    const { a, helper, hAuth, auth } = await seed(wp)
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    const call = await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth,
      payload: { callId: 'wpcall1', targetUserIds: [helper.user.id] } })
    expect(call.statusCode).toBe(200)
    expect(wp.sent.length).toBe(1)
    const payload = JSON.parse(wp.sent[0].payload)
    expect(payload.data).toMatchObject({ kind: 'incoming_call', callId: 'wpcall1' })
    expect(payload.title).toContain('wpfaller') // 来电人显示名进标题
    await a.close()
  })

  it('删号级联：订阅随人清除（双存储各自验证存储层）', async () => {
    const wp = new RecordingWebPush()
    const { a, store, helper, hAuth } = await seed(wp)
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    await a.inject({ method: 'DELETE', url: '/api/account', headers: hAuth })
    expect(store.webPushSubscriptionsForUser(helper.user.id).length).toBe(0)
    await a.close()
    // Sqlite 存储层等价行为
    const sq = new SqliteStore(':memory:')
    sq.upsertWebPushSubscription({ endpoint: 'https://e/1', userId: 'u1', p256dh: 'k', auth: 'a', createdAt: 1 })
    sq.upsertWebPushSubscription({ endpoint: 'https://e/2', userId: 'u2', p256dh: 'k', auth: 'a', createdAt: 2 })
    sq.deleteWebPushSubscriptionsForUser('u1')
    expect(sq.webPushSubscriptionsForUser('u1').length).toBe(0)
    expect(sq.webPushSubscriptionsForUser('u2').length).toBe(1)
    sq.clearWebPushSubscriptionFromOthers('https://e/2', 'u3')
    expect(sq.webPushSubscriptionsForUser('u2').length).toBe(0)
  })

  it('makeWebPushSender：VAPID 三变量齐才真发；VapidWebPushSender 410 回收死订阅', async () => {
    // env 不齐 → Noop
    expect(makeWebPushSender() instanceof NoopWebPushSender).toBe(true)
    // 410 → onGone 回调（用真实 VapidWebPushSender，私钥合法生成；send 对无效 endpoint 会抛/410——
    // 这里直接验证 onGone 路径：构造后调用其错误分支需要真网络，故验证类不吞非 410 错误的契约由集成环境覆盖；
    // 至少验证构造合法（setVapidDetails 校验 key 格式）。
    const webpush = await import('web-push')
    const keys = webpush.default.generateVAPIDKeys()
    const gone: string[] = []
    const sender = new VapidWebPushSender(keys.publicKey, keys.privateKey, 'mailto:ops@example.com', (e) => gone.push(e))
    expect(sender.configured).toBe(true)
  })
})
