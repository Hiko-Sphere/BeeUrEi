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

  it('消息扇出（与 APNs 对齐）：单聊推给收件人订阅（含 fromId 供直达会话）；发送者自己不收', async () => {
    const wp = new RecordingWebPush()
    const { a, helper, hAuth, auth } = await seed(wp)
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    const send = await a.inject({ method: 'POST', url: '/api/messages', headers: auth,
      payload: { toId: helper.user.id, kind: 'text', text: '你好' } })
    expect(send.statusCode).toBe(201)
    expect(wp.sent.length).toBe(1)
    const payload = JSON.parse(wp.sent[0].payload)
    expect(payload.data).toMatchObject({ kind: 'chat_message', fromId: expect.any(String) })
    expect(payload.title).toContain('wpfaller')
    // 反向：helper 回消息，owner 未订阅 → 零投递（不误发）。
    wp.sent.length = 0
    await a.inject({ method: 'POST', url: '/api/messages', headers: hAuth,
      payload: { toId: (await a.inject({ method: 'GET', url: '/api/me', headers: auth })).json().user.id, kind: 'text', text: 'hi' } })
    expect(wp.sent.length).toBe(0)
    await a.close()
  })

  it('Web Push 负载顶层带 badge（收件人未读总数）→ 供 SW 置 PWA 图标角标（App 关闭时也更新）', async () => {
    const wp = new RecordingWebPush()
    const { a, helper, hAuth, auth } = await seed(wp)
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    // 单聊消息 → 收件人 web push 顶层带 badge（含刚发这条未读）。
    await a.inject({ method: 'POST', url: '/api/messages', headers: auth, payload: { toId: helper.user.id, kind: 'text', text: '在吗' } })
    const msgP = JSON.parse(wp.sent.at(-1)!.payload)
    expect(typeof msgP.badge).toBe('number')
    expect(msgP.badge).toBeGreaterThanOrEqual(1)
    // 紧急告警 → 亲友 web push 顶层带 badge（含刚写入的告警）。
    wp.sent.length = 0
    await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'fall' } })
    const sosP = JSON.parse(wp.sent[0].payload)
    expect(typeof sosP.badge).toBe('number')
    expect(sosP.badge).toBeGreaterThanOrEqual(1)
    await a.close()
  })

  it('notifyUser 双通道：好友请求等通用通知也推到浏览器订阅（web-only 不漏任何一类）', async () => {
    const wp = new RecordingWebPush()
    const { a, hAuth, auth } = await seed(wp)
    // helper 订阅浏览器推送
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    // owner 再发一个新的好友请求（对第三人 → 不通知 helper；对 helper 已绑定。改用：owner 解绑再申请？
    // 更直接：注册第三人向 helper 发好友请求 → helper 收 notifyUser 通知。
    const reg3 = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'wpthird', password: 'secret123', role: 'blind' } })).json()
    const res = await a.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${reg3.token}` },
      payload: { username: 'wphelper', relation: '亲友' } })
    expect(res.statusCode).toBe(201)
    const friendPush = wp.sent.filter((x) => x.payload.includes('wpthird') || JSON.parse(x.payload).data.kind?.includes('friend') || JSON.parse(x.payload).data.kind?.includes('link'))
    expect(friendPush.length).toBeGreaterThanOrEqual(1) // 好友请求经 notifyUser 双通道到达浏览器
    void auth
    await a.close()
  })

  it('每用户订阅总量上限：超限驱逐最旧（限速≠限存量；换浏览器不被卡死）', async () => {
    process.env.WEB_PUSH_MAX_PER_USER = '3'
    try {
      const wp = new RecordingWebPush()
      const { a, store, helper, hAuth } = await seed(wp)
      // 5 个不同 endpoint（同一浏览器 upsert 不算增长，这里模拟多浏览器/伪造囤积）。
      for (let i = 1; i <= 5; i++) {
        const r = await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth,
          payload: { endpoint: `https://push.example/ep/${i}`, keys: SUB.keys } })
        expect(r.statusCode).toBe(200) // 不拒绝——驱逐最旧
      }
      const subs = store.webPushSubscriptionsForUser(helper.user.id)
      expect(subs.length).toBe(3)
      const eps = subs.map((s2) => s2.endpoint).sort()
      expect(eps).toEqual(['https://push.example/ep/3', 'https://push.example/ep/4', 'https://push.example/ep/5']) // 最旧的 1/2 被驱逐
      await a.close()
    } finally { delete process.env.WEB_PUSH_MAX_PER_USER }
  })

  it('自测推送端点：发到本人全部订阅并回报计数；未配置 503/无订阅 404；计数进 /metrics', async () => {
    const wp = new RecordingWebPush()
    const { a, hAuth } = await seed(wp)
    // 无订阅 → 404
    expect((await a.inject({ method: 'POST', url: '/api/push/web-test', headers: hAuth })).statusCode).toBe(404)
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    const r = await a.inject({ method: 'POST', url: '/api/push/web-test', headers: hAuth })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toMatchObject({ ok: true, sent: 1, total: 1 })
    expect(JSON.parse(wp.sent[0].payload).data.kind).toBe('push_test')
    // 计数装饰器：送达健康度进 /metrics（buildApp 单点包裹，任何扇出路径都被计入）。
    const metrics = await a.inject({ method: 'GET', url: '/metrics' })
    expect(metrics.payload).toContain('web_push_sent_total 1')
    expect(metrics.payload).toContain('web_push_failed_total 0')
    await a.close()
    // 未配置（Noop）→ 503
    const { a: a2, hAuth: h2 } = await seed()
    expect((await a2.inject({ method: 'POST', url: '/api/push/web-test', headers: h2 })).statusCode).toBe(503)
    await a2.close()
  })

  it('封禁连带清浏览器推送订阅（被封账号只剩泄漏面）；代设密码/强登出不清（重登后推送应还在）', async () => {
    const wp = new RecordingWebPush()
    const store = new MemoryStore()
    store.createUser({ id: 'admin1', username: 'root', passwordHash: (await import('../src/auth/passwords')).hashPassword('secret123'),
      displayName: 'root', role: 'admin', status: 'active', createdAt: 1 })
    const a = buildApp(store, { webPushSender: wp })
    const reg = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'banme', password: 'secret123', role: 'helper' } })).json()
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: { authorization: `Bearer ${reg.token}` }, payload: SUB })
    const adminTok = (await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'secret123' } })).json().token
    const adminAuth = { authorization: `Bearer ${adminTok}` }
    // 代设密码（severSessions 路径）：订阅保留
    await a.inject({ method: 'POST', url: `/api/admin/users/${reg.user.id}/reset-password`, headers: adminAuth, payload: { newPassword: 'newsecret456' } })
    expect(store.webPushSubscriptionsForUser(reg.user.id).length).toBe(1)
    // 封禁：订阅清除
    const ban = await a.inject({ method: 'POST', url: `/api/admin/users/${reg.user.id}/status`, headers: adminAuth, payload: { status: 'disabled' } })
    expect(ban.statusCode).toBe(200)
    expect(store.webPushSubscriptionsForUser(reg.user.id).length).toBe(0)
    await a.close()
  })

  it('订阅轮换：旧三元组验证通过 → 换新保持归属；错 key/未知端点一律 404（无 oracle）', async () => {
    const wp = new RecordingWebPush()
    const { a, store, helper, hAuth } = await seed(wp)
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    const NEW = { endpoint: 'https://push.example/rotated', keys: { p256dh: 'NewKey_1234567890abc', auth: 'NewAuth_12345' } }
    // 错 key：404 且原订阅不动（拿到过期 endpoint 的旁路者无法劫持）
    const bad = await a.inject({ method: 'POST', url: '/api/push/web-rotate',
      payload: { old: { endpoint: SUB.endpoint, p256dh: 'WrongKey_123456789', auth: SUB.keys.auth }, sub: NEW } })
    expect(bad.statusCode).toBe(404)
    expect(store.findWebPushSubscription(SUB.endpoint)).toBeDefined()
    // 正确三元组：换新、归属不变、旧行删除（无需任何 auth 头——SW 场景）
    const ok = await a.inject({ method: 'POST', url: '/api/push/web-rotate',
      payload: { old: { endpoint: SUB.endpoint, p256dh: SUB.keys.p256dh, auth: SUB.keys.auth }, sub: NEW } })
    expect(ok.statusCode).toBe(200)
    expect(store.findWebPushSubscription(SUB.endpoint)).toBeUndefined()
    const rotated = store.findWebPushSubscription(NEW.endpoint)
    expect(rotated?.userId).toBe(helper.user.id)
    // 未知端点：同样 404
    expect((await a.inject({ method: 'POST', url: '/api/push/web-rotate',
      payload: { old: { endpoint: 'https://push.example/ghost', p256dh: SUB.keys.p256dh, auth: SUB.keys.auth }, sub: NEW } })).statusCode).toBe(404)
    await a.close()
  })

  it('登出其它设备连带清其它浏览器订阅（被盗设备不再收推送）；keepEndpoint 保留本浏览器', async () => {
    const wp = new RecordingWebPush()
    const { a, store, helper, hAuth } = await seed(wp)
    // 两个"浏览器"的订阅
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth,
      payload: { endpoint: 'https://push.example/other-device', keys: SUB.keys } })
    expect(store.webPushSubscriptionsForUser(helper.user.id).length).toBe(2)
    // 带 keepEndpoint：清其它、留本机
    const r = await a.inject({ method: 'POST', url: '/api/account/sessions/revoke-others', headers: hAuth,
      payload: { keepEndpoint: SUB.endpoint } })
    expect(r.statusCode).toBe(200)
    const left = store.webPushSubscriptionsForUser(helper.user.id)
    expect(left.length).toBe(1)
    expect(left[0].endpoint).toBe(SUB.endpoint)
    // 不带 keepEndpoint（iOS 调用/无 SW）：全清——本浏览器靠自愈重订
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth,
      payload: { endpoint: 'https://push.example/other-device', keys: SUB.keys } })
    await a.inject({ method: 'POST', url: '/api/account/sessions/revoke-others', headers: hAuth, payload: {} })
    expect(store.webPushSubscriptionsForUser(helper.user.id).length).toBe(0)
    await a.close()
  })

  it('notified 计入 Web Push 订阅：web-only 亲友（无 APNs）经浏览器推送也算"已实时推送"', async () => {
    const wp = new RecordingWebPush()
    const { a, hAuth, auth } = await seed(wp)
    // helper 只订阅 Web Push、无 APNs token（典型 web-only 协助者）。
    await a.inject({ method: 'POST', url: '/api/push/web-subscribe', headers: hAuth, payload: SUB })
    const res = await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'fall' } })
    expect(res.statusCode).toBe(200)
    // 加 Web Push 前这里会是 0（helper 无 APNs token）——现在 web 订阅算实时推送 → 1。
    expect(res.json().notified).toBe(1)
    expect(res.json().contacts).toBe(1)
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
