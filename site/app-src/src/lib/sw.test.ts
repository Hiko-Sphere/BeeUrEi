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
    registration: { showNotification: (..._a: unknown[]) => {} },
    location: { origin: 'https://beeurei.hikosphere.com' },
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
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
    let shown: { title: string; opts: { tag: string; requireInteraction: boolean } } | null = null
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
})
