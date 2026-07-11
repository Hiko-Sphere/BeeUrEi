import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/// Service Worker 处理器逻辑测试：sw.js 是浏览器脚本，无法直接 import——读源码在受控全局下执行，
/// 捕获注册的事件处理器逐一驱动。headless 预览无法真实断网（杀 dev server 连预览会话一起死），
/// 离线兜底路径由本测试锁住；push/click 分级同样在此回归。
type Handler = (event: unknown) => void
const handlers = new Map<string, Handler>()

class FakeResponse {
  body: string
  init: { status?: number; headers?: Record<string, string> }
  constructor(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
    this.body = body
    this.init = init
  }
  get status() { return this.init.status ?? 200 }
}

beforeAll(() => {
  const src = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8')
  const self = {
    addEventListener: (name: string, fn: Handler) => handlers.set(name, fn),
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { showNotification: () => {} },
    location: { origin: 'https://beeurei.hikosphere.com' },
  }
  // fetch 传转发器而非直传引用：sw.js 内的 fetch 形参会遮蔽全局——转发器让每个用例改 globalThis.fetch 即时生效。
  new Function('self', 'Response', 'URL', 'fetch', src)(self, FakeResponse, URL, (...a: unknown[]) => (globalThis.fetch as (...x: unknown[]) => unknown)(...a))
})

describe('sw.js 离线兜底（fetch 处理器）', () => {
  it('导航请求且网络失败 → 503 诚实离线页（含中英文与重试）', async () => {
    const h = handlers.get('fetch')!
    let captured: Promise<FakeResponse> | null = null
    globalThis.fetch = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    h({ request: { mode: 'navigate' }, respondWith: (p: Promise<FakeResponse>) => { captured = p } })
    const res = await captured!
    expect(res.status).toBe(503)
    expect(res.body).toContain('当前离线')
    expect(res.body).toContain('Offline')
    expect(res.body).toContain('location.reload()')
    expect(res.init.headers?.['content-type']).toContain('text/html')
  })

  it('导航请求且网络正常 → 原响应透传（不缓存不改写）', async () => {
    const h = handlers.get('fetch')!
    const real = new FakeResponse('app html', { status: 200 })
    let captured: Promise<FakeResponse> | null = null
    globalThis.fetch = (() => Promise.resolve(real)) as unknown as typeof fetch
    h({ request: { mode: 'navigate' }, respondWith: (p: Promise<FakeResponse>) => { captured = p } })
    expect(await captured!).toBe(real) // 同一对象——绝无缓存/改写
  })

  it('非导航请求（资源/接口）不拦截——由应用层各自处理失败', () => {
    const h = handlers.get('fetch')!
    let intercepted = false
    h({ request: { mode: 'cors' }, respondWith: () => { intercepted = true } })
    h({ request: { mode: 'no-cors' }, respondWith: () => { intercepted = true } })
    expect(intercepted).toBe(false)
  })
})

describe('sw.js 通知分级（push 处理器）', () => {
  function firePush(data: Record<string, unknown>) {
    const h = handlers.get('push')!
    let shown: { title: string; opts: { tag: string; requireInteraction: boolean; renotify: boolean; vibrate?: number[] } } | null = null
    const event = {
      data: { json: () => data },
      waitUntil: () => {},
    }
    // 临时替换 registration.showNotification 捕获参数
    const src = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8')
    const self = {
      addEventListener: (name: string, fn: Handler) => { if (name === 'push') (firePush as unknown as { h: Handler }).h = fn },
      skipWaiting: () => {}, clients: { claim: () => {} },
      registration: { showNotification: (title: string, opts: never) => { shown = { title, opts } } },
      location: { origin: 'https://x.example' },
    }
    new Function('self', 'Response', 'URL', 'fetch', src)(self, FakeResponse, URL, undefined)
    ;(firePush as unknown as { h: Handler }).h(event)
    void h
    return shown!
  }

  it('紧急告警（kind=fall/crash/manual）→ requireInteraction + emergency tag', () => {
    for (const kind of ['fall', 'crash', 'manual']) {
      const r = firePush({ title: 'T', body: 'B', data: { kind, fromId: 'u1' } })
      expect(r.opts.requireInteraction).toBe(true)
      expect(r.opts.tag).toBe('emergency-u1')
    }
  })

  it('安全报到未到（kind=checkin, type=emergency_alert）→ 紧急：requireInteraction + 按 fromId 分条不折叠', () => {
    // dead-man's switch 告警：kind=checkin 不在旧枚举里，靠统一的 type=emergency_alert 判紧急。
    const r = firePush({ title: 'T', body: 'B', data: { kind: 'checkin', type: 'emergency_alert', fromId: 'blindA', eventId: 'e1' } })
    expect(r.opts.requireInteraction).toBe(true)
    expect(r.opts.tag).toBe('emergency-blindA')
    // 两位亲人各自的"未报到"告警按 fromId 分条，绝不折叠成一条（否则第二个人的告警覆盖第一个）。
    const r2 = firePush({ data: { kind: 'checkin', type: 'emergency_alert', fromId: 'blindB', eventId: 'e2' } })
    expect(r2.opts.tag).toBe('emergency-blindB')
    expect(r2.opts.tag).not.toBe(r.opts.tag)
  })

  it('紧急标记优先于 kind 枚举：任何带 type=emergency_alert 的未知 kind 也判紧急', () => {
    const r = firePush({ data: { kind: 'some_future_alert', type: 'emergency_alert', fromId: 'u9' } })
    expect(r.opts.requireInteraction).toBe(true)
    expect(r.opts.tag).toBe('emergency-u9')
  })

  it('报平安 emergency_clear：**非** requireInteraction（安心通知，非告警），但共用 fromId 线替换掉常驻 SOS 横幅', () => {
    // 告警本身：requireInteraction + emergency-blindA。
    const alert = firePush({ data: { kind: 'fall', type: 'emergency_alert', fromId: 'blindA' } })
    expect(alert.opts.requireInteraction).toBe(true)
    expect(alert.opts.tag).toBe('emergency-blindA')
    // 同一人报平安：不 requireInteraction（自动消退），但同 tag → 替换掉上面那条常驻告警横幅。
    const clear = firePush({ data: { kind: 'emergency_clear', fromId: 'blindA' } })
    expect(clear.opts.requireInteraction).toBe(false)
    expect(clear.opts.tag).toBe('emergency-blindA') // 与告警同线 → 取代而非并排
    expect(clear.opts.renotify).toBe(false) // 报平安悄悄替换，不再拉响警报（语义正确）
  })

  it('renotify 只给紧急告警：升级重呼与首呼共用 emergency-<fromId> tag，须 renotify=true 才能重新惊动漏看首呼的人', () => {
    // 首呼与升级同 tag（emergency-blindA）：默认 renotify=false 时升级会静默替换横幅、不再响铃——
    // 抹掉升级"抓住漏看首呼者"的全部意义。故所有紧急告警 renotify=true；报平安/聊天/通用不 renotify。
    expect(firePush({ data: { kind: 'fall', type: 'emergency_alert', fromId: 'blindA' } }).opts.renotify).toBe(true)     // SOS 首呼
    expect(firePush({ data: { kind: 'checkin', type: 'emergency_alert', fromId: 'blindA' } }).opts.renotify).toBe(true) // 未报到
    expect(firePush({ data: { kind: 'incoming_call', callId: 'c1' } }).opts.renotify).toBe(true)                        // 来电
    // 非紧急：不重复惊动（同会话消息静默更新、报平安悄悄替换）。
    expect(firePush({ data: { kind: 'chat_message', fromId: 'u2' } }).opts.renotify).toBe(false)
    expect(firePush({ data: { kind: 'friend_request', fromId: 'u3' } }).opts.renotify).toBe(false)
  })

  it('紧急告警加振动（让告警被感知，非仅看到）；非紧急不覆盖系统默认振动', () => {
    // 紧急：三段振动模式（Android Chrome 等生效，余者忽略无害）。
    expect(firePush({ data: { kind: 'fall', type: 'emergency_alert', fromId: 'blindA' } }).opts.vibrate).toEqual([300, 120, 300, 120, 300])
    expect(firePush({ data: { kind: 'checkin', type: 'emergency_alert', fromId: 'blindA' } }).opts.vibrate).toEqual([300, 120, 300, 120, 300])
    expect(firePush({ data: { kind: 'incoming_call', callId: 'c1' } }).opts.vibrate).toEqual([300, 120, 300, 120, 300])
    // 非紧急：vibrate 未覆盖（undefined → 交由系统默认，免频繁震动打扰）。
    expect(firePush({ data: { kind: 'chat_message', fromId: 'u2' } }).opts.vibrate).toBeUndefined()
    expect(firePush({ data: { kind: 'emergency_clear', fromId: 'blindA' } }).opts.vibrate).toBeUndefined() // 报平安不震
  })

  it('紧急后续（响应中/已确认）不再被 indexOf 误判为紧急常驻横幅', () => {
    // 曾因 kind.indexOf("emergency")===0 把这些也判紧急；现只认 type=emergency_alert，它们无 type → 普通通知。
    expect(firePush({ data: { kind: 'emergency_responding', fromId: 'r1' } }).opts.requireInteraction).toBe(false)
    expect(firePush({ data: { kind: 'emergency_ack', fromId: 'a1' } }).opts.requireInteraction).toBe(false)
  })

  it('来电 → requireInteraction + call tag；聊天/通用 → 自然消退 + 各自折叠 tag', () => {
    expect(firePush({ data: { kind: 'incoming_call', callId: 'c1' } }).opts)
      .toMatchObject({ requireInteraction: true, tag: 'call-c1' })
    expect(firePush({ data: { kind: 'chat_message', fromId: 'u2' } }).opts)
      .toMatchObject({ requireInteraction: false, tag: 'dm-u2' })
    expect(firePush({ data: { kind: 'chat_message', groupId: 'g1' } }).opts)
      .toMatchObject({ requireInteraction: false, tag: 'group-g1' })
    expect(firePush({ data: { kind: 'friend_request', fromId: 'u3' } }).opts)
      .toMatchObject({ requireInteraction: false, tag: 'n-friend_request' }) // 不误挂 emergency-
  })
})

describe('sw.js 通知点击深链（notificationclick 路由）', () => {
  // 重载 sw.js、注入捕获 openWindow 的 clients（matchAll 返回空 → 走 openWindow 开新窗口），取回目标 URL。
  async function fireClick(data: Record<string, unknown>): Promise<string | null> {
    const src = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8')
    let clickHandler: Handler | undefined
    let opened: string | null = null
    const self = {
      addEventListener: (name: string, fn: Handler) => { if (name === 'notificationclick') clickHandler = fn },
      skipWaiting: () => {},
      clients: { claim: () => {}, matchAll: async () => [], openWindow: async (url: string) => { opened = url } },
      registration: { showNotification: () => {} },
      location: { origin: 'https://beeurei.hikosphere.com' },
    }
    new Function('self', 'Response', 'URL', 'fetch', src)(self, FakeResponse, URL, undefined)
    let awaited: Promise<unknown> | undefined
    clickHandler!({ notification: { close: () => {}, data }, waitUntil: (p: Promise<unknown>) => { awaited = p } })
    await awaited
    return opened
  }
  const O = 'https://beeurei.hikosphere.com'

  it('单聊消息 → /app/chat/<fromId>（对端会话直达）', async () => {
    expect(await fireClick({ kind: 'chat_message', fromId: 'peer1' })).toBe(`${O}/app/chat/peer1`)
  })
  it('群消息 → /app/chat/g/<groupId>（此前只到列表，须再找那个群）', async () => {
    expect(await fireClick({ kind: 'chat_message', groupId: 'grp9' })).toBe(`${O}/app/chat/g/grp9`)
  })
  it('聊天但既无 fromId 又无 groupId → 聊天列表兜底', async () => {
    expect(await fireClick({ kind: 'chat_message' })).toBe(`${O}/app/chat`)
  })
  it('来电 → 首页（IncomingCallHost 全局轮询，任何页都弹铃，首页最快）', async () => {
    expect(await fireClick({ kind: 'incoming_call', callId: 'c1' })).toBe(`${O}/app/`)
  })
  it('告警/其它 kind → 通知页（诚实位置标注 + 回拨都在那）', async () => {
    expect(await fireClick({ kind: 'emergency_alert', fromId: 'u1' })).toBe(`${O}/app/notifications`)
    expect(await fireClick({ kind: 'friend_request', fromId: 'u2' })).toBe(`${O}/app/notifications`)
  })
})

describe('sw.js 订阅轮换（pushsubscriptionchange 处理器）', () => {
  it('用旧三元组 POST /api/push/web-rotate 换新（含浏览器未给 newSubscription 时的重订阅）', async () => {
    const calls: { url: string; body: unknown }[] = []
    globalThis.fetch = (async (url: string, init: { body: string }) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true } }) as unknown as typeof fetch
    const h = handlers.get('pushsubscriptionchange')!
    const oldSub = { toJSON: () => ({ endpoint: 'https://e/old', keys: { p256dh: 'oldP', auth: 'oldA' } }), options: { applicationServerKey: 'KEY' } }
    let waited: Promise<void> | null = null
    // 浏览器未给 newSubscription → SW 自行重订阅（用旧 applicationServerKey）
    const subscribe = async (opts: { applicationServerKey: string }) => {
      expect(opts.applicationServerKey).toBe('KEY')
      return { toJSON: () => ({ endpoint: 'https://e/new', keys: { p256dh: 'newP', auth: 'newA' } }) }
    }
    // 重建 self（本 describe 需要 registration.pushManager.subscribe）
    const src2 = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8')
    const localHandlers = new Map<string, Handler>()
    const self2 = {
      addEventListener: (n: string, f: Handler) => localHandlers.set(n, f),
      skipWaiting: () => {}, clients: { claim: () => {} },
      registration: { pushManager: { subscribe }, showNotification: () => {} },
      location: { origin: 'https://x.example' },
    }
    new Function('self', 'Response', 'URL', 'fetch', src2)(self2, FakeResponse, URL, (...a: unknown[]) => (globalThis.fetch as (...x: unknown[]) => unknown)(...a))
    localHandlers.get('pushsubscriptionchange')!({ oldSubscription: oldSub, newSubscription: null, waitUntil: (p: Promise<void>) => { waited = p } })
    await waited!
    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('/api/push/web-rotate')
    expect(calls[0].body).toEqual({
      old: { endpoint: 'https://e/old', p256dh: 'oldP', auth: 'oldA' },
      sub: { endpoint: 'https://e/new', keys: { p256dh: 'newP', auth: 'newA' } },
    })
    void h
  })

  it('无 oldSubscription（无凭据可证）→ 静默不请求', async () => {
    const calls: unknown[] = []
    globalThis.fetch = (async () => { calls.push(1); return { ok: true } }) as unknown as typeof fetch
    let waited: Promise<void> | null = null
    handlers.get('pushsubscriptionchange')!({ oldSubscription: null, newSubscription: null, waitUntil: (p: Promise<void>) => { waited = p } })
    await waited!
    expect(calls.length).toBe(0)
  })

  it('跨源部署：SW URL 携 apiBase 查询串 → 轮换 POST 打到**正确的 API 源**（非站点相对路径）', async () => {
    const calls: { url: string }[] = []
    globalThis.fetch = (async (url: string) => { calls.push({ url }); return { ok: true } }) as unknown as typeof fetch
    const oldSub = { toJSON: () => ({ endpoint: 'https://e/old', keys: { p256dh: 'p', auth: 'a' } }), options: { applicationServerKey: 'KEY' } }
    const newSub = { toJSON: () => ({ endpoint: 'https://e/new', keys: { p256dh: 'p2', auth: 'a2' } }) }
    let waited: Promise<void> | null = null
    // SW 自身 URL 带注册方注入的 apiBase（生产跨源），apiBase() 应读出并拼成绝对 API 源。
    const src2 = readFileSync(join(__dirname, '../../public/sw.js'), 'utf8')
    const localHandlers = new Map<string, Handler>()
    const self2 = {
      addEventListener: (n: string, f: Handler) => localHandlers.set(n, f),
      skipWaiting: () => {}, clients: { claim: () => {} },
      registration: { pushManager: { subscribe: async () => newSub }, showNotification: () => {} },
      location: { origin: 'https://beeurei.hikosphere.com',
        href: 'https://beeurei.hikosphere.com/app/sw.js?apiBase=' + encodeURIComponent('https://beeurei-api.hikosphere.com') },
    }
    new Function('self', 'Response', 'URL', 'fetch', src2)(self2, FakeResponse, URL, (...a: unknown[]) => (globalThis.fetch as (...x: unknown[]) => unknown)(...a))
    localHandlers.get('pushsubscriptionchange')!({ oldSubscription: oldSub, newSubscription: newSub, waitUntil: (p: Promise<void>) => { waited = p } })
    await waited!
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe('https://beeurei-api.hikosphere.com/api/push/web-rotate') // 绝对 API 源，非站点相对（此前相对→打站点 404→轮换丢失）
  })
})
